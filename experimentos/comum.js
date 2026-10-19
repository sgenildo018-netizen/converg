// Utilidades compartilhadas pelos experimentos com libs prontas.
// O script.js da raiz continua sem dependências; tudo aqui usa o node_modules
// desta pasta (experimentos/package.json).

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const RAIZ = path.join(__dirname, "..");
const script = require(path.join(RAIZ, "script.js"));

const ARQUIVOS = [
  ...fs
    .readdirSync(path.join(RAIZ, "fixtures"))
    .filter((n) => n.endsWith(".html"))
    .map((n) => path.join("fixtures", n)),
  "index.html",
  "code.html",
];

function ler(relativo) {
  return fs.readFileSync(path.join(RAIZ, relativo), "utf8");
}

/** Linha (base 1) de um offset no texto. */
function linhaDe(html, offset) {
  let linha = 1;
  for (let i = 0; i < offset && i < html.length; i++) if (html.charCodeAt(i) === 10) linha++;
  return linha;
}

/** Resultado do script.js (sem gravar JSON). */
function analisarComScript(relativo) {
  return script.processarHtml(path.join(RAIZ, relativo), { salvarJson: false });
}

/** Mede o tempo de `fn` em ms (média de `vezes` execuções). */
function medir(fn, vezes = 5) {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < vezes; i++) fn();
  return (performance.now() - t0) / vezes;
}

const ok = (b) => (b ? "sim" : "NÃO");

module.exports = { RAIZ, ARQUIVOS, script, ler, linhaDe, analisarComScript, medir, ok };
