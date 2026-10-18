const { readFile } = require("node:fs/promises");
const path = require("node:path");

// ---

/**
 * @typedef {Object} Tag
 * @property {string} nome - Nome da tag em minúsculas (ex.: "p", "script").
 * @property {"abre" | "fecha" | "auto"} tipo - Tipo da tag.
 * @property {number} posicao - Offset inicial da tag no HTML original.
 * @property {string} texto - Texto exato da tag (ex.: '<p id="x">').
 */

/**
 * @typedef {Object} Elemento
 * @property {string} nome - Nome do elemento (ex.: "header").
 * @property {number} inicio - Offset inicial da tag de abertura.
 * @property {number} fim - Offset final (exclusivo) da tag de fechamento.
 * @property {number} inicioConteudo - Offset inicial do conteúdo interno.
 * @property {number} fimConteudo - Offset final (exclusivo) do conteúdo interno.
 * @property {string} texto - Recorte completo do elemento (ex.: "<p>...</p>").
 * @property {string} conteudo - Recorte apenas do conteúdo interno.
 */

// ---

/**
 * Lê o `index.html` e registra no console o tamanho e o conteúdo completo.
 * @async
 * @returns {Promise<void>} Nada é retornado; o efeito é o log.
 */
async function lerHtml() {
  const caminhoHtml = path.join(__dirname, "index.html");
  const html = await readFile(caminhoHtml, "utf8");
  console.log(html.length);
  console.log("Conteúdo de index.html:", html);
}

// ---

/**
 * Demonstra iteração sobre a string do HTML: array de caracteres (spread),
 * quebra por ", " (split) e uma busca com `find`.
 * @async
 * @returns {Promise<void>} Nada é retornado; o efeito é o log.
 */
async function percorrerHtml() {
  const caminhoHtml = path.join(__dirname, "index.html");
  const html = await readFile(caminhoHtml, "utf8");

  const caracteres = [...html]; // string -> array (pra poder usar forEach/map)

  const partes = html.split(", "); // nova constante: HTML quebrado por ", "
  console.log(partes[1]);

  // find: devolve o PRIMEIRO pedaço que contém "tbody" (ou undefined)
  const pedacoComTbody = partes.find((pedaco) => pedaco.includes("tbody"));
  console.log("Achou 'tbody'?", pedacoComTbody !== undefined);

  caracteres.forEach((char, i) => {});
}

// ---

/**
 * Converte uma lista de {@link Tag} em intervalos, calculando `inicio` e `fim`
 * a partir da posição e do tamanho do texto de cada tag.
 * @param {Tag[]} tags - Tags extraídas do HTML.
 * @returns {Array<{nome: string, tipo: string, inicio: number, fim: number}>} Intervalos das tags.
 */
function criarIntervalos(tags) {
  return tags.map(({ nome, tipo, posicao, texto }) => ({
    nome,
    tipo,
    inicio: posicao,
    fim: posicao + texto.length,
  }));
}

// ---

/**
 * Filtra intervalos pelo nome da tag e anexa o texto original recortado do HTML.
 * @param {Array<{nome: string, tipo: string, inicio: number, fim: number}>} intervalos - Intervalos a filtrar.
 * @param {string} nome - Nome da tag procurada (case-insensitive).
 * @param {string} html - HTML original, usado para o recorte.
 * @returns {Array<Object>} Intervalos filtrados, com a propriedade `texto` incluída.
 */
function filtrarPorNome(intervalos, nome, html) {
  return intervalos
    .filter((intervalo) => intervalo.nome === nome.toLowerCase())
    .map((intervalo) => ({
      ...intervalo,
      texto: html.slice(intervalo.inicio, intervalo.fim),
    }));
}

// ---

/**
 * Retorna o primeiro {@link Elemento} com o nome informado.
 * @param {Elemento[]} elementos - Lista de elementos onde procurar.
 * @param {string} nome - Nome do elemento (case-insensitive).
 * @returns {Elemento | undefined} O elemento encontrado, ou `undefined` se não existir.
 */
function buscarElementoPorNome(elementos, nome) {
  return elementos.find((elemento) => elemento.nome === nome.toLowerCase());
}

// ---

/**
 * Monta os elementos a partir das tags usando uma pilha: ao encontrar uma tag
 * de abertura, empilha; ao encontrar o fechamento correspondente, desempilha e
 * registra o elemento com as posições do conteúdo e os recortes do HTML.
 * Tags vazias (ex.: `br`, `img`) e autofecháveis são ignoradas.
 * @param {Tag[]} tags - Tags na ordem em que aparecem no HTML.
 * @param {string} html - HTML original, usado para os recortes.
 * @returns {Elemento[]} Elementos ordenados pela posição de início.
 */
function mapearElementos(tags, html) {
  const elementosVazios = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const pilha = [];
  const elementos = [];

  for (const tag of tags) {
    if (tag.tipo === "auto" || elementosVazios.has(tag.nome)) continue;

    if (tag.tipo === "abre") {
      pilha.push(tag);
      continue;
    }

    if (tag.tipo !== "fecha") continue;

    let indiceAbertura = pilha.length - 1;
    while (indiceAbertura >= 0 && pilha[indiceAbertura].nome !== tag.nome) {
      indiceAbertura -= 1;
    }

    if (indiceAbertura < 0) continue;

    const abertura = pilha.splice(indiceAbertura, 1)[0];
    const inicioConteudo = abertura.posicao + abertura.texto.length;
    const fimConteudo = tag.posicao;
    const fim = tag.posicao + tag.texto.length;

    elementos.push({
      nome: tag.nome,
      inicio: abertura.posicao,
      fim,
      inicioConteudo,
      fimConteudo,
      texto: html.slice(abertura.posicao, fim),
      conteudo: html.slice(inicioConteudo, fimConteudo),
    });
  }

  return elementos.sort((a, b) => a.inicio - b.inicio);
}

// ---

/**
 * Lê o `index.html`, extrai as tags via regex, monta os elementos e exibe o
 * bloco `<script>` encontrado (texto e conteúdo interno).
 * @async
 * @returns {Promise<Tag[]>} A lista de tags extraídas do HTML.
 */
async function mapearTags() {
  const caminhoHtml = path.join(__dirname, "index.html");
  const html = await readFile(caminhoHtml, "utf8");

  const tags = [...html.matchAll(/<\/?([a-zA-Z][\w-]*)\b[^>]*>/g)].map((m) => {
    const texto = m[0];
    return {
      nome: m[1].toLowerCase(),
      tipo: texto.startsWith("</")
        ? "fecha"
        : texto.endsWith("/>")
          ? "auto"
          : "abre",
      posicao: m.index,
      texto,
    };
  });

  const elementos = mapearElementos(tags, html);
  const script = buscarElementoPorNome(elementos, "script");

  if (!script) {
    console.log("Bloco <script> não encontrado.");
    return tags;
  }

  console.log("Bloco <script>:");
  console.log(script.texto);
  console.log("Conteúdo interno do <script>:");
  console.log(script.conteudo);

  return tags;
}

// ---

mapearTags().catch((erro) => {
  console.error("Não foi possível ler index.html:", erro.message);
});
