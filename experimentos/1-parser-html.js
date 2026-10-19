// Experimento 1: parser HTML pronto (parse5 e htmlparser2) contra o tokenizer do script.js.
//
// Pergunta: um parser pronto acha os mesmos elementos, nas mesmas posições, e
// recorta o mesmo texto exato? E resolve as limitações F-24, F-25 e F-29?

const parse5 = require("parse5");
const htmlparser2 = require("htmlparser2");
const { ARQUIVOS, ler, linhaDe, analisarComScript, medir, ok } = require("./comum");

/** Elementos escritos no arquivo, segundo o parse5 (ignora os implícitos, sem posição). */
function elementosParse5(html) {
  const erros = [];
  const doc = parse5.parse(html, { sourceCodeLocationInfo: true, onParseError: (e) => erros.push(e) });
  const lista = [];
  (function andar(no) {
    for (const filho of no.childNodes || []) {
      if (filho.tagName && filho.sourceCodeLocation?.startTag) {
        const loc = filho.sourceCodeLocation;
        lista.push({
          nome: filho.tagName,
          inicio: loc.startOffset,
          fim: loc.endOffset,
          linha: loc.startLine,
          temFechamento: Boolean(loc.endTag),
          atributos: Object.fromEntries(filho.attrs.map((a) => [a.name, a.value])),
        });
      }
      andar(filho);
      if (filho.content) andar(filho.content); // <template>
    }
  })(doc);
  return { lista, erros };
}

/** Elementos segundo o htmlparser2 (endIndex é inclusivo). */
function elementosHtmlparser2(html) {
  const doc = htmlparser2.parseDocument(html, { withStartIndices: true, withEndIndices: true });
  const lista = [];
  (function andar(no) {
    for (const filho of no.children || []) {
      if (filho.type === "tag" || filho.type === "script" || filho.type === "style") {
        lista.push({
          nome: filho.name,
          inicio: filho.startIndex,
          fim: filho.endIndex + 1,
          atributos: { ...filho.attribs },
        });
      }
      andar(filho);
    }
  })(doc);
  return { lista };
}

/** Compara as posições de um parser com as do script.js. */
function comparar(html, doScript, daLib) {
  const porInicio = new Map(daLib.map((e) => [e.inicio, e]));
  let mesmoInicio = 0;
  let mesmoTexto = 0;
  const divergentes = [];
  for (const el of doScript) {
    const outro = porInicio.get(el.inicio);
    if (!outro) continue;
    mesmoInicio++;
    if (outro.fim === el.fim) mesmoTexto++;
    else if (divergentes.length < 3)
      divergentes.push(`<${el.nome}> L${el.linha}: script termina em ${el.fim}, lib em ${outro.fim}`);
  }
  const iniciosScript = new Set(doScript.map((e) => e.inicio));
  const soNaLib = daLib.filter((e) => !iniciosScript.has(e.inicio));
  return { mesmoInicio, mesmoTexto, divergentes, soNaLib };
}

async function main() {
  console.log("=== Experimento 1: parser HTML (parse5, htmlparser2) x tokenizer do script.js ===\n");

  for (const arquivo of ARQUIVOS) {
    const html = ler(arquivo);
    const { elementos } = await analisarComScript(arquivo);
    const p5 = elementosParse5(html);
    const h2 = elementosHtmlparser2(html);
    const c5 = comparar(html, elementos, p5.lista);
    const c2 = comparar(html, elementos, h2.lista);

    console.log(`--- ${arquivo} (${html.length} chars, L1-L${linhaDe(html, html.length)})`);
    console.log(`  script.js:   ${elementos.length} elementos`);
    console.log(
      `  parse5:      ${p5.lista.length} elementos | mesmo início ${c5.mesmoInicio} | mesmo recorte ${c5.mesmoTexto} | só no parse5 ${c5.soNaLib.length} | erros de parse ${p5.erros.length}`,
    );
    console.log(
      `  htmlparser2: ${h2.lista.length} elementos | mesmo início ${c2.mesmoInicio} | mesmo recorte ${c2.mesmoTexto} | só no htmlparser2 ${c2.soNaLib.length}`,
    );
    for (const d of c5.divergentes) console.log(`    parse5 diverge: ${d}`);
    for (const e of c5.soNaLib.slice(0, 3)) console.log(`    só no parse5: <${e.nome}> L${linhaDe(html, e.inicio)}`);
    for (const e of c2.soNaLib.slice(0, 3)) console.log(`    só no htmlparser2: <${e.nome}> L${linhaDe(html, e.inicio)}`);
    const semFechamento = p5.lista.filter((e) => !e.temFechamento && !["meta", "img", "input", "br", "hr", "link"].includes(e.nome));
    if (semFechamento.length)
      console.log(`    parse5, fechados implicitamente: ${semFechamento.map((e) => `<${e.nome}> L${e.linha}`).join(", ")}`);
  }

  console.log("\n--- Limitações conhecidas (todo) com cada parser");
  const lim = ler("fixtures/limitacoes.html");
  const aspa = ler("fixtures/limitacao-aspa-solta.html");
  const casos = [
    ["F-24 <b> dentro de <textarea> não vira elemento", (f) => !f(lim).lista.some((e) => e.nome === "b")],
    [
      'F-25 onclick com &quot; decodificado para alert("oi")',
      (f) => f(lim).lista.find((e) => e.atributos.id === "entidade")?.atributos.onclick === 'alert("oi")',
    ],
    [
      "F-29 title=it's não engole o resto (acha #depois e #botao)",
      (f) => ["depois", "botao"].every((id) => f(aspa).lista.some((e) => e.atributos.id === id)),
    ],
    [
      "F-29 title=it's vale \"it's\"",
      (f) => f(aspa).lista.find((e) => e.atributos.id === "aspa-solta")?.atributos.title === "it's",
    ],
  ];
  for (const [nome, teste] of casos) {
    console.log(`  ${nome}: parse5 ${ok(teste(elementosParse5))} | htmlparser2 ${ok(teste(elementosHtmlparser2))}`);
  }

  console.log("\n--- Tempo em code.html (média de 5)");
  const code = ler("code.html");
  const s = require("./comum").script;
  console.log(`  script.js localizarTags+mapearElementos: ${medir(() => s.mapearElementos(s.localizarTags(code), code)).toFixed(1)} ms`);
  console.log(`  parse5:      ${medir(() => elementosParse5(code)).toFixed(1)} ms`);
  console.log(`  htmlparser2: ${medir(() => elementosHtmlparser2(code)).toFixed(1)} ms`);
}

if (require.main === module) main();

module.exports = { elementosParse5, elementosHtmlparser2 };
