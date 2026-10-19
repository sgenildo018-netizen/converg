// Experimento 5: DOMPurify (com jsdom) aplicado a trechos recortados pelo script.js.
//
// Pergunta: ajuda a exportar um componente? O que ele remove e o texto continua
// idêntico ao original?

const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");
const { ler, analisarComScript, script } = require("./comum");

const DOMPurify = createDOMPurify(new JSDOM("").window);

function resumir(trecho) {
  const limpo = DOMPurify.sanitize(trecho);
  const removidos = DOMPurify.removed.map((r) =>
    r.attribute ? `atributo ${r.attribute.name} de <${r.from.nodeName.toLowerCase()}>` : `elemento <${r.element.nodeName.toLowerCase()}>`,
  );
  return { limpo, removidos };
}

async function main() {
  console.log("=== Experimento 5: DOMPurify em trechos recortados ===\n");

  for (const [arquivo, seletor] of [
    ["code.html", "header"],
    ["code.html", "#copy-link-btn"],
    ["fixtures/com-scripts.html", "body"],
  ]) {
    const resultado = await analisarComScript(arquivo);
    const foco = script.analisarFoco(resultado, seletor);
    const original = foco.elemento.texto;
    const { limpo, removidos } = resumir(original);
    const contagem = {};
    for (const r of removidos) contagem[r] = (contagem[r] || 0) + 1;
    console.log(`--- ${arquivo} ${seletor} (L${foco.linhaInicio}-L${foco.linhaFim}, ${original.length} chars)`);
    console.log(`  texto idêntico ao original depois do sanitize: ${limpo === original ? "sim" : "NÃO"} (${limpo.length} chars)`);
    console.log(`  removido: ${Object.entries(contagem).map(([r, n]) => `${r} x${n}`).join(", ") || "nada"}`);
    const i = [...original].findIndex((c, k) => c !== limpo[k]);
    if (i >= 0) {
      console.log(`  primeira diferença no char ${i}:`);
      console.log(`    original: ${JSON.stringify(original.slice(Math.max(0, i - 30), i + 40))}`);
      console.log(`    sanitize: ${JSON.stringify(limpo.slice(Math.max(0, i - 30), i + 40))}`);
    }
  }
}

main();
