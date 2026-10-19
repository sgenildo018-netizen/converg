// Experimento 2: validação estrutural com html-validate contra validarEstrutura do script.js.
//
// Pergunta: o html-validate aponta os mesmos erros, nas mesmas linhas? E acerta
// os casos que o validador próprio erra (F-23: <li> e <p> com fechamento opcional)?

const { HtmlValidate } = require("html-validate");
const { ARQUIVOS, ler, analisarComScript, medir, ok } = require("./comum");

// Só as regras que equivalem ao que o script.js faz hoje, mais duas que ele não tem.
const ESTRUTURAL = {
  rules: {
    "close-order": "error", // órfão, cruzado, não fechado
    "void-content": "warn", // </br> (o script dá aviso)
    "no-dup-id": "error", // extra: id repetido
    "element-permitted-content": "error", // extra: <div> dentro de <b>, <li> fora de lista
  },
};

const validadorEstrutural = new HtmlValidate(ESTRUTURAL);
const validadorRecomendado = new HtmlValidate({ extends: ["html-validate:recommended"] });

function mensagens(validador, html) {
  const relatorio = validador.validateStringSync(html);
  return (relatorio.results[0]?.messages || []).map((m) => ({
    linha: m.line,
    regra: m.ruleId,
    nivel: m.severity === 2 ? "erro" : "aviso",
    texto: m.message,
  }));
}

async function main() {
  console.log("=== Experimento 2: html-validate x validarEstrutura do script.js ===\n");

  for (const arquivo of ARQUIVOS) {
    const html = ler(arquivo);
    const { validacao } = await analisarComScript(arquivo);
    const estrutural = mensagens(validadorEstrutural, html);
    const recomendado = mensagens(validadorRecomendado, html);
    const erros = estrutural.filter((m) => m.nivel === "erro");

    console.log(`--- ${arquivo}`);
    console.log(
      `  script.js:     ${validacao.valido ? "válido" : "inválido"} (${validacao.totalErros} erros, ${validacao.totalAvisos} avisos)`,
    );
    for (const e of validacao.erros) console.log(`    L${e.linha} ${e.tipo} <${e.tag.nome}>`);
    console.log(`  html-validate: ${erros.length ? "inválido" : "válido"} (${erros.length} erros, ${estrutural.length - erros.length} avisos) com regras estruturais`);
    for (const m of estrutural) console.log(`    L${m.linha} ${m.regra} (${m.nivel}): ${m.texto}`);
    const porRegra = {};
    for (const m of recomendado) porRegra[m.regra] = (porRegra[m.regra] || 0) + 1;
    console.log(
      `  html-validate recommended: ${recomendado.length} mensagens: ${Object.entries(porRegra)
        .sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `${r} ${n}`)
        .join(", ") || "nenhuma"}`,
    );
  }

  console.log("\n--- Limitação F-23 com html-validate (regras estruturais)");
  const lim = mensagens(validadorEstrutural, ler("fixtures/limitacoes.html")).filter((m) => m.nivel === "erro");
  console.log(`  limitacoes.html válido (li/p sem fechamento são permitidos): ${ok(lim.length === 0)}`);

  const code = ler("code.html");
  const s = require("./comum").script;
  console.log("\n--- Tempo em code.html (média de 5)");
  console.log(`  script.js validarEstrutura: ${medir(() => s.validarEstrutura(s.localizarTags(code))).toFixed(1)} ms (inclui localizarTags)`);
  console.log(`  html-validate estrutural:   ${medir(() => mensagens(validadorEstrutural, code)).toFixed(1)} ms`);
}

main();
