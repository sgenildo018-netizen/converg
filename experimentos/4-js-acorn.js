// Experimento 4: eventos JS lidos com acorn (AST) contra as regex de analisarScripts do script.js.
//
// Pergunta: lendo o JS como árvore, os mesmos listeners aparecem, ligados aos
// mesmos elementos? E resolve F-26 (onclick em várias linhas), F-27
// (querySelector("form")) e F-28 (listener comentado)?
//
// O seletor de cada listener é resolvido com css-select sobre a árvore do parse5,
// então qualquer seletor CSS funciona, e querySelector devolve só o primeiro.

const acorn = require("acorn");
const walk = require("acorn-walk");
const parse5 = require("parse5");
const { adapter } = require("parse5-htmlparser2-tree-adapter");
const cssSelect = require("css-select");
const { ARQUIVOS, ler, linhaDe, analisarComScript, ok } = require("./comum");

const METODOS = new Set(["getElementById", "querySelector", "querySelectorAll", "getElementsByClassName", "getElementsByTagName"]);

function parseJs(codigo) {
  const opcoes = { ecmaVersion: "latest", allowReturnOutsideFunction: true, allowHashBang: true };
  try {
    return acorn.parse(codigo, { ...opcoes, sourceType: "script" });
  } catch {
    return acorn.parse(codigo, { ...opcoes, sourceType: "module" });
  }
}

/** document.getElementById("x") etc. -> { metodo, argumento } */
function consultaDom(no) {
  if (no?.type !== "CallExpression" || no.callee.type !== "MemberExpression") return null;
  const metodo = no.callee.property.name;
  const alvo = no.callee.object;
  if (!METODOS.has(metodo) || alvo.type !== "Identifier" || alvo.name !== "document") return null;
  const arg = no.arguments[0];
  if (arg?.type !== "Literal" || typeof arg.value !== "string") return { metodo, argumento: null };
  return { metodo, argumento: arg.value };
}

/** Elementos (nós do parse5) que uma consulta devolve. */
function resolverConsulta(consulta, doc) {
  const { metodo, argumento } = consulta;
  if (argumento === null) return [];
  const seletor = {
    getElementById: `[id="${argumento}"]`,
    getElementsByClassName: argumento.trim().split(/\s+/).map((c) => `.${c}`).join(""),
    getElementsByTagName: argumento,
  }[metodo] ?? argumento;
  try {
    const nos = cssSelect.selectAll(seletor, doc);
    return metodo === "querySelector" || metodo === "getElementById" ? nos.slice(0, 1) : nos;
  } catch {
    return [];
  }
}

function tipoHandler(no) {
  if (!no) return "desconhecido";
  if (no.type === "ArrowFunctionExpression") return "arrow_function";
  if (no.type === "FunctionExpression") return no.id ? "funcao_nomeada" : "funcao_anonima";
  if (no.type === "Identifier") return "referencia";
  return no.type;
}

/** Ids que o código consulta (getElementById("x")): dependências do handler. */
function idsConsultados(no) {
  const ids = new Set();
  walk.full(no, (n) => {
    const c = consultaDom(n);
    if (c?.metodo === "getElementById" && c.argumento) ids.add(c.argumento);
  });
  return [...ids];
}

/** Listeners de um <script>: addEventListener e .onX = ... */
function listenersDoScript(codigo, offsetBase, html, doc) {
  const ast = parseJs(codigo);
  const variaveis = new Map(); // nome -> consulta
  const funcoes = new Map(); // nome -> nó da FunctionDeclaration
  walk.full(ast, (n) => {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier") {
      const c = consultaDom(n.init);
      if (c) variaveis.set(n.id.name, c);
    }
    if (n.type === "FunctionDeclaration" && n.id) funcoes.set(n.id.name, n);
  });

  const alvoDe = (obj) => {
    const direta = consultaDom(obj);
    if (direta) return { consulta: direta, via: "direto" };
    if (obj.type === "Identifier" && variaveis.has(obj.name)) return { consulta: variaveis.get(obj.name), via: `variável ${obj.name}` };
    if (obj.type === "Identifier") return { global: obj.name };
    return { global: codigo.slice(obj.start, obj.end) };
  };

  const listeners = [];
  const registrar = (alvo, evento, handler, noChamada, origem) => {
    let handlerReal = handler;
    if (handler?.type === "Identifier" && funcoes.has(handler.name)) handlerReal = funcoes.get(handler.name);
    const elementos = alvo.consulta ? resolverConsulta(alvo.consulta, doc) : [];
    listeners.push({
      evento,
      origem,
      via: alvo.via || null,
      seletor: alvo.consulta ? `${alvo.consulta.metodo}(${JSON.stringify(alvo.consulta.argumento)})` : alvo.global,
      elementos: elementos.map((e) => e.sourceCodeLocation.startOffset),
      tipo: tipoHandler(handler),
      linhaChamada: linhaDe(html, offsetBase + noChamada.start),
      linhaHandler: handlerReal ? linhaDe(html, offsetBase + handlerReal.start) : null,
      codigo: handlerReal ? codigo.slice(handlerReal.start, handlerReal.end) : null,
      dependencias: handlerReal ? idsConsultados(handlerReal) : [],
    });
  };

  walk.full(ast, (n) => {
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && n.callee.property.name === "addEventListener") {
      const [ev, handler] = n.arguments;
      if (ev?.type === "Literal") registrar(alvoDe(n.callee.object), ev.value, handler, n, "addEventListener");
    }
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && /^on[a-z]+$/.test(n.left.property.name || "")) {
      registrar(alvoDe(n.left.object), n.left.property.name.slice(2), n.right, n, "propriedadeOn");
    }
  });
  return listeners;
}

/** Eventos inline (onclick="...") com o código decodificado e as dependências. */
function eventosInline(doc, html) {
  const lista = [];
  for (const el of cssSelect.selectAll("*", doc)) {
    for (const [nome, valor] of Object.entries(el.attribs || {})) {
      if (!/^on[a-z]+$/.test(nome)) continue;
      let dependencias = [];
      try {
        dependencias = idsConsultados(parseJs(valor));
      } catch {}
      lista.push({ elemento: el.sourceCodeLocation.startOffset, linha: el.sourceCodeLocation.startLine, evento: nome.slice(2), codigo: valor.trim(), dependencias });
    }
  }
  return lista;
}

function analisar(html) {
  const doc = parse5.parse(html, { treeAdapter: adapter, sourceCodeLocationInfo: true });
  const listeners = [];
  const falhas = [];
  for (const sc of cssSelect.selectAll("script:not([src])", doc)) {
    const tipo = sc.attribs.type;
    if (tipo && !/javascript|module/.test(tipo)) continue;
    // Texto cru do arquivo: o parse5 troca CRLF por LF nos nós de texto, o que
    // desalinharia os offsets do acorn com as linhas do arquivo.
    const offset = sc.sourceCodeLocation.startTag.endOffset;
    const texto = html.slice(offset, sc.sourceCodeLocation.endTag?.startOffset ?? sc.sourceCodeLocation.endOffset);
    try {
      listeners.push(...listenersDoScript(texto, offset, html, doc));
    } catch (e) {
      falhas.push(`<script> L${sc.sourceCodeLocation.startLine}: ${e.message}`);
    }
  }
  return { doc, listeners, inline: eventosInline(doc, html), falhas };
}

async function main() {
  console.log("=== Experimento 4: acorn (AST) x regex de analisarScripts do script.js ===\n");

  for (const arquivo of ARQUIVOS) {
    const html = ler(arquivo);
    const r = await analisarComScript(arquivo);
    const a = analisar(html);
    const porScript = new Set();
    for (const el of r.elementos) for (const ev of el.eventos) if (ev.origem !== "inline") porScript.add(`${el.inicio}|${ev.evento}`);
    const porAcorn = new Set(a.listeners.flatMap((l) => l.elementos.map((e) => `${e}|${l.evento}`)));
    if (!porScript.size && !porAcorn.size && !a.falhas.length) continue;

    console.log(`--- ${arquivo}`);
    console.log(`  vínculos elemento+evento (sem inline): script.js ${porScript.size} | acorn ${porAcorn.size} | em comum ${[...porScript].filter((x) => porAcorn.has(x)).length}`);
    const nome = (off) => {
      const el = r.elementos.find((e) => e.inicio === +off);
      return el ? `<${el.nome}${el.id ? `#${el.id}` : ""}> L${el.linha}` : `offset ${off}`;
    };
    for (const x of porScript) if (!porAcorn.has(x)) console.log(`    só no script.js: ${nome(x.split("|")[0])} [${x.split("|")[1]}]`);
    for (const x of porAcorn) if (!porScript.has(x)) console.log(`    só no acorn:     ${nome(x.split("|")[0])} [${x.split("|")[1]}]`);
    for (const l of a.listeners) {
      const alvo = l.elementos.length ? l.elementos.map(nome).join(", ") : `não ligado (${l.seletor})`;
      const deps = l.dependencias.length ? ` | usa #${l.dependencias.join(", #")}` : "";
      console.log(`  - ${alvo} -> [${l.evento}] handler L${l.linhaHandler} (chamada L${l.linhaChamada}) ${l.origem} ${l.tipo}, ${l.codigo?.split("\n").length ?? 0} linhas de código${deps}`);
    }
    for (const i of a.inline.filter((x) => x.dependencias.length))
      console.log(`  - inline ${nome(i.elemento)} [${i.evento}] usa #${i.dependencias.join(", #")}`);
    for (const f of a.falhas) console.log(`  acorn não leu: ${f}`);
  }

  console.log("\n--- Limitações conhecidas (todo) com acorn");
  const lim = ler("fixtures/limitacoes.html");
  const a = analisar(lim);
  const off = (id) => cssSelect.selectOne(`[id="${id}"]`, a.doc).sourceCodeLocation.startOffset;
  const de = (id) => a.listeners.filter((l) => l.elementos.includes(off(id)));
  const entidade = a.inline.find((i) => i.elemento === off("entidade"));
  console.log(`  F-25 onclick decodificado: ${ok(entidade?.codigo === 'alert("oi")')} (${entidade?.codigo})`);
  console.log(`  F-26 #multilinha traz o corpo inteiro: ${ok(/linha 2/.test(de("multilinha")[0]?.codigo || ""))}`);
  console.log(`  F-27 querySelector("form") liga ao <form>: ${ok(de("formulario").length === 1)}`);
  console.log(`  F-28 listener comentado não conta: ${ok(de("comentado").length === 0)}`);
  const cs = analisar(ler("fixtures/com-scripts.html"));
  const itens = cs.listeners.find((l) => l.evento === "mouseover");
  console.log(`  extra: querySelector(".item").onmouseover liga só ao 1º .item (como o navegador): ${ok(itens?.elementos.length === 1)} (script.js liga aos 2)`);
}

if (require.main === module) main();

module.exports = { analisar };
