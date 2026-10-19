// Roda os 5 experimentos em sequência, mostra no console e grava cada saída em saida/.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pasta = path.join(__dirname, "saida");
fs.mkdirSync(pasta, { recursive: true });
const arquivos = fs.readdirSync(__dirname).filter((n) => /^\d-.*\.js$/.test(n)).sort();
for (const arquivo of arquivos) {
  const saida = execFileSync(process.execPath, [path.join(__dirname, arquivo)], { encoding: "utf8" });
  process.stdout.write(saida + "\n");
  fs.writeFileSync(path.join(pasta, arquivo.replace(/\.js$/, ".txt")), saida);
}
console.log(`Saídas gravadas em ${path.relative(process.cwd(), pasta) || "."}/`);
