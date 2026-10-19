// Experimento 3: CSS com postcss (leitura das regras de <style>) e css-select
// (casar seletores com elementos) contra extrairRegrasCss/casarSeletor do script.js.
//
// Pergunta: as regras saem iguais, com as mesmas linhas? Os seletores casam com
// os mesmos elementos?

const postcss = require("postcss");
const seletorParser = require("postcss-selector-parser");
const parse5 = require("parse5");
const { adapter } = require("parse5-htmlparser2-tree-adapter");
const cssSelect = require("css-select");
const { ARQUIVOS, ler, linhaDe, analisarComScript, medir } = require("./comum");

const ESTADOS = new Set([":hover", ":focus", ":active", ":visited", ":focus-within", ":focus-visible", ":target", ":checked", ":disabled", ":enabled"]);
const PSEUDO_ELEMENTOS_LEGADOS = new Set([":before", ":after", ":first-line", ":first-letter"]);

/** Regras de um bloco <style> lidas pelo postcss, com a linha no arquivo HTML. */
function regrasPostcss(css, linhaBase) {
  const regras = [];
  postcss.parse(css).walkRules((regra) => {
    const pai = regra.parent;
    if (pai?.type === "atrule" && /keyframes$/i.test(pai.name)) return;
    regras.push({
      seletor: regra.selector.replace(/\s+/g, " ").trim(),
      linha: linhaBase + regra.source.start.line - 1,
      declaracoes: regra.nodes.filter((n) => n.type === "decl").map((d) => `${d.prop}: ${d.value}${d.important ? " !important" : ""}`),
    });
  });
  return regras;
}

/** Tira estados e pseudo-elementos, que não existem num documento estático. */
function seletorEstatico(seletor) {
  return seletorParser((raiz) => {
    raiz.walkPseudos((p) => {
      if (ESTADOS.has(p.value) || p.value.startsWith("::") || PSEUDO_ELEMENTOS_LEGADOS.has(p.value)) p.remove();
    });
    raiz.each((sel) => {
      // compostos que ficaram vazios viram "*"
      if (!sel.nodes.length || sel.last.type === "combinator") sel.append(seletorParser.universal());
    });
  }).processSync(seletor);
}

async function main() {
  console.log("=== Experimento 3: postcss + css-select x extrairRegrasCss/casarSeletor do script.js ===\n");

  for (const arquivo of ARQUIVOS) {
    const html = ler(arquivo);
    const r = await analisarComScript(arquivo);
    const doScript = r.css.regras.filter((x) => x.tipo === "regra");
    const styles = r.elementos.filter((el) => el.nome === "style");
    if (!styles.length) continue;

    const daLib = styles.flatMap((st) => regrasPostcss(st.conteudo, linhaDe(html, st.inicioConteudo)));
    const mesmas = doScript.filter((x, i) => daLib[i] && daLib[i].seletor === x.seletor.replace(/\s+/g, " ") && daLib[i].linha === x.linha);
    console.log(`--- ${arquivo}`);
    console.log(`  regras: script.js ${doScript.length} | postcss ${daLib.length} | mesmo seletor e linha ${mesmas.length}`);

    // Casamento: elementos que cada regra atinge, comparados por offset de início
    const doc = parse5.parse(html, { treeAdapter: adapter, sourceCodeLocationInfo: true });
    let iguais = 0;
    for (const regra of doScript) {
      const indice = r.css.regras.indexOf(regra);
      const peloScript = new Set(r.elementos.filter((el) => el.css.regras.some((x) => x.indiceRegra === indice)).map((el) => el.inicio));
      let pelaLib;
      try {
        const nos = cssSelect.selectAll(seletorEstatico(regra.seletor), doc);
        pelaLib = new Set(nos.map((n) => n.sourceCodeLocation?.startOffset).filter((x) => x !== undefined));
      } catch (e) {
        console.log(`  ${regra.seletor} (L${regra.linha}): css-select não entende (${e.message})`);
        continue;
      }
      const igual = peloScript.size === pelaLib.size && [...peloScript].every((x) => pelaLib.has(x));
      if (igual) iguais++;
      else
        console.log(
          `  DIFERENTE ${regra.seletor} (L${regra.linha}): script.js ${peloScript.size} elementos, css-select ${pelaLib.size}`,
        );
    }
    console.log(`  casamento seletor -> elementos: igual em ${iguais} de ${doScript.length} regras`);
  }

  // Seletores que o casarSeletor do script.js marca como não avaliados
  console.log("\n--- Seletores mais difíceis (css-select x script.js) num HTML de teste");
  const teste = `<main><ul><li class="a">1</li><li>2</li><li class="a">3</li></ul><p lang="pt-BR">x</p><p>y</p></main>`;
  const { script } = require("./comum");
  const tags = script.localizarTags(teste);
  const elementos = script.mapearElementos(tags, teste);
  const arvore = script.construirArvore ? script.construirArvore(elementos) : null;
  const doc = parse5.parse(teste, { treeAdapter: adapter, sourceCodeLocationInfo: true });
  for (const sel of ["li:nth-child(odd)", "li:last-child", "li:nth-of-type(2)", "ul:has(> .a)", "p:lang(pt)", "li:only-child", ":is(ul, p) > li.a", "li.a ~ li"]) {
    const lib = cssSelect.selectAll(sel, doc).length;
    let doScript = "não exportado";
    if (arvore && script.analisarSeletor && script.casarSeletor) {
      try {
        const partes = script.analisarSeletor(sel);
        doScript = elementos.filter((el) => script.casarSeletor(partes, el, arvore)).length;
      } catch (e) {
        doScript = `erro: ${e.message}`;
      }
    }
    console.log(`  ${sel.padEnd(20)} css-select ${lib} | script.js ${doScript}`);
  }

  console.log("\n--- CSS difícil: regras lidas (seletor @ linha)");
  const dificil = [
    '.a::after { content: "}"; color: red }',
    "/* .falsa { } */ .b { color: blue }",
    '.c { background: url("x;y.png") }',
    "@font-face { font-family: X; src: url(x.woff) }",
    ".d { color: red; & .e { color: blue } }",
    "@supports (display: grid) { @media (min-width: 1px) { .f { display: grid } } }",
  ].join("\n");
  const peloScript = script.extrairRegrasCss(dificil).filter((x) => x.tipo === "regra").map((x) => `${x.seletor}@${x.linha}`);
  const peloPostcss = regrasPostcss(dificil, 1).map((x) => `${x.seletor}@${x.linha}`);
  console.log(`  script.js: ${peloScript.join(" | ")}`);
  console.log(`  postcss:   ${peloPostcss.join(" | ")}`);

  const code = ler("code.html");
  const st = code.slice(code.indexOf("<style>") + 7, code.indexOf("</style>"));
  const s = require("./comum").script;
  console.log("\n--- Tempo no <style> de code.html (média de 5)");
  console.log(`  script.js extrairRegrasCss: ${medir(() => s.extrairRegrasCss(st)).toFixed(2)} ms`);
  console.log(`  postcss:                    ${medir(() => regrasPostcss(st, 1)).toFixed(2)} ms`);
}

main();
