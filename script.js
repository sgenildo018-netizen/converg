const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

// --- Constantes

/**
 * Conjunto de elementos HTML vazios (void elements) segundo a especificação HTML.
 * Estes elementos não possuem conteúdo interno nem tag de fechamento correspondente.
 */
const ELEMENTOS_VAZIOS = new Set([
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

// --- Tipos JSDoc

/**
 * @typedef {Object} EventoInline
 * @property {string} atributo - Nome do atributo HTML (ex.: "onclick").
 * @property {string} evento - Nome do evento correspondente (ex.: "click").
 * @property {string} codigo - Código JavaScript inline contido no atributo.
 * @property {"inline"} tipoManipulador - Classificação do manipulador.
 * @property {string[]} parametros - Parâmetros disponíveis (padrão: ["event"]).
 */

/**
 * @typedef {Object} AtributosTag
 * @property {Record<string, string | true>} todos - Mapa com todos os atributos encontrados.
 * @property {string | null} id - Identificador `id` do elemento ou null.
 * @property {string[]} classes - Lista de classes CSS declaradas no elemento.
 * @property {EventoInline[]} eventosInline - Eventos inline (atributos on...).
 */

/**
 * @typedef {Object} Tag
 * @property {string} nome - Nome da tag em minúsculas (ex.: "p", "script", "header").
 * @property {"abre" | "fecha" | "auto"} tipo - Tipo da tag.
 * @property {number} posicao - Offset inicial da tag no HTML original.
 * @property {number} fim - Offset final (exclusivo) da tag no HTML original.
 * @property {string} texto - Texto exato da tag (ex.: '<p id="x">').
 * @property {number} linha - Linha no documento (1-indexed).
 * @property {number} coluna - Coluna no documento (1-indexed).
 * @property {AtributosTag} atributos - Atributos interpretados da tag.
 */

/**
 * @typedef {Object} ManipuladorDetalhado
 * @property {"arrow_function" | "funcao_anonima" | "funcao_nomeada" | "referencia" | "inline" | "desconhecido"} tipoManipulador - Tipo de manipulador.
 * @property {string | null} nomeFuncao - Nome da função quando identificável.
 * @property {string[]} parametros - Lista de parâmetros formais da função.
 * @property {string} codigo - Código fonte literal do manipulador.
 */

/**
 * @typedef {Object} EventoMapeado
 * @property {string} evento - Tipo de evento ouvido (ex.: "click", "submit", "keydown").
 * @property {"addEventListenerVariavel" | "addEventListenerDireto" | "propriedadeOn" | "inline"} origem - Origem da vinculação.
 * @property {"arrow_function" | "funcao_anonima" | "funcao_nomeada" | "referencia" | "inline" | "desconhecido"} tipoManipulador - Tipo do manipulador.
 * @property {string | null} nomeFuncao - Nome da função declarada ou referenciada.
 * @property {string[]} parametros - Parâmetros formais recebidos pelo manipulador.
 * @property {string} codigo - Código fonte completo do corpo da função ou manipulador inline.
 * @property {string | null} opcoes - Terceiro argumento de opções passado ao listener (ex.: "{ once: true }").
 * @property {string | null} seletor - Seletor CSS ou ID consultado (ex.: "#botao-contador").
 * @property {string | null} variavel - Nome da variável no script que recebeu o elemento.
 * @property {string | null} metodo - Método DOM utilizado (ex.: "querySelector", "getElementById").
 * @property {Object | null} posicao - Posição do ouvinte no código.
 */

/**
 * @typedef {Object} Elemento
 * @property {string} nome - Nome do elemento (ex.: "header", "button").
 * @property {number} inicio - Offset inicial da tag de abertura.
 * @property {number} fim - Offset final (exclusivo) da tag de fechamento.
 * @property {number} inicioConteudo - Offset inicial do conteúdo interno.
 * @property {number} fimConteudo - Offset final (exclusivo) do conteúdo interno.
 * @property {number} linha - Linha no documento em que o elemento se inicia.
 * @property {number} coluna - Coluna no documento em que o elemento se inicia.
 * @property {string} texto - Recorte completo do elemento (ex.: "<p>...</p>").
 * @property {string} conteudo - Recorte apenas do conteúdo interno.
 * @property {Record<string, string | true>} atributos - Todos os atributos do elemento.
 * @property {string | null} id - Identificador `id` do elemento.
 * @property {string[]} classes - Lista de classes CSS do elemento.
 * @property {EventoInline[]} eventosInline - Eventos inline (ex.: onclick).
 * @property {EventoMapeado[]} eventosJS - Ouvintes de eventos JavaScript vinculados via scripts.
 * @property {EventoMapeado[]} eventos - Lista consolidada de todos os eventos mapeados do elemento.
 * @property {Tag} tagAbertura - Tag de abertura ou auto-fechável.
 * @property {Tag | null} tagFechamento - Tag de fechamento correspondente (ou null para vazios).
 * @property {boolean} vazio - Se é um elemento vazio ou auto-fechável.
 */

/**
 * @typedef {Object} DiagnosticoEstrutural
 * @property {"fechamento_orfa" | "fechamento_cruzado" | "tag_nao_fechada" | "fechamento_elemento_vazio"} tipo - Tipo do erro estrutural.
 * @property {string} mensagem - Descrição legível da falha estrutural.
 * @property {Tag} tag - Tag associada à ocorrência.
 * @property {Tag} [tagPendente] - Tag pendente em fechamentos cruzados.
 * @property {number} linha - Linha do erro.
 * @property {number} coluna - Coluna do erro.
 */

/**
 * @typedef {Object} RelatorioValidacao
 * @property {boolean} valido - Se a estrutura está bem balanceada e válida.
 * @property {number} totalErros - Total de erros estruturais encontrados.
 * @property {number} totalAvisos - Total de avisos não impeditivos.
 * @property {DiagnosticoEstrutural[]} erros - Lista de erros estruturais.
 * @property {DiagnosticoEstrutural[]} avisos - Lista de avisos.
 */

// --- Funções Auxiliares de Posição e Atributos

/**
 * Calcula linha e coluna (base 1) a partir do offset no HTML.
 * @param {string} html - Conteúdo completo do HTML.
 * @param {number} offset - Posição do caractere.
 * @returns {{ linha: number, coluna: number }} Linha e coluna base 1.
 */
function calcularLinhaColuna(html, offset) {
  const antes = html.slice(0, offset);
  const linhas = antes.split("\n");
  const linha = linhas.length;
  const coluna = linhas[linhas.length - 1].length + 1;
  return { linha, coluna };
}

/**
 * Remove aspas simples ou duplas envolventes de uma string.
 * @param {string} str - Texto a limpar.
 * @returns {string} Texto sem aspas.
 */
function limparAspas(str) {
  if (!str) return "";
  const s = str.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Analisa e extrai atributos de uma tag HTML, incluindo id, class, eventos inline (on...)
 * e atributos booleanos ou com aspas simples/duplas/sem aspas.
 * @param {string} textoTag - Trecho literal da tag (ex.: `<button id="btn" class="a b" disabled>`).
 * @returns {AtributosTag} Estrutura de atributos interpretada.
 */
function extrairAtributos(textoTag) {
  const atributos = {
    todos: {},
    id: null,
    classes: [],
    eventosInline: [],
  };

  const matchNome = textoTag.match(/^<\/?([a-zA-Z][\w-]*)/);
  if (!matchNome) return atributos;

  const inicioAtributos = matchNome[0].length;
  const fimAtributos = textoTag.endsWith("/>")
    ? textoTag.length - 2
    : textoTag.endsWith(">")
      ? textoTag.length - 1
      : textoTag.length;

  const corpo = textoTag.slice(inicioAtributos, fimAtributos);
  const regexAtributo =
    /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  let match;
  while ((match = regexAtributo.exec(corpo)) !== null) {
    const nome = match[1].toLowerCase();
    const valor =
      match[2] !== undefined
        ? match[2]
        : match[3] !== undefined
          ? match[3]
          : match[4] !== undefined
            ? match[4]
            : true;

    atributos.todos[nome] = valor;

    if (nome === "id" && typeof valor === "string") {
      atributos.id = valor.trim();
    } else if (nome === "class" && typeof valor === "string") {
      atributos.classes = valor.split(/\s+/).filter(Boolean);
    } else if (nome.startsWith("on") && typeof valor === "string") {
      atributos.eventosInline.push({
        atributo: nome,
        evento: nome.slice(2).toLowerCase(),
        codigo: valor.trim(),
        tipoManipulador: "inline",
        parametros: ["event"],
      });
    }
  }

  return atributos;
}

// --- Localização de Tags (Tokenizer Robusto)

/**
 * Localiza todas as tags em uma string HTML com precisão posicional.
 * Trata comentários HTML, doctypes, tags autofecháveis e blocos de texto
 * puro (script e style) para evitar falsos positivos dentro do código.
 * Também suporta atributos que contenham `>` dentro de aspas.
 * @param {string} html - String com o HTML completo.
 * @returns {Tag[]} Lista de tags encontradas com suas coordenadas e atributos.
 */
function localizarTags(html) {
  const tags = [];
  let i = 0;
  const len = html.length;

  while (i < len) {
    if (html[i] !== "<") {
      i++;
      continue;
    }

    // 1. Ignora comentários HTML: <!-- ... -->
    if (html.startsWith("<!--", i)) {
      const fimComentario = html.indexOf("-->", i + 4);
      if (fimComentario === -1) break;
      i = fimComentario + 3;
      continue;
    }

    // 2. Ignora declarações DOCTYPE / CDATA: <! ... >
    if (html.startsWith("<!", i)) {
      let j = i + 2;
      let quote = null;
      while (j < len) {
        const c = html[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === ">") {
          break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }

    // 3. Tag de fechamento: </tag ...>
    if (html[i + 1] === "/") {
      const matchNome = html.slice(i + 2).match(/^[a-zA-Z][\w-]*/);
      if (matchNome) {
        const nome = matchNome[0].toLowerCase();
        let j = i + 2 + matchNome[0].length;
        let quote = null;
        while (j < len) {
          const c = html[j];
          if (quote) {
            if (c === quote) quote = null;
          } else if (c === '"' || c === "'") {
            quote = c;
          } else if (c === ">") {
            break;
          }
          j++;
        }
        const texto = html.slice(i, j + 1);
        const { linha, coluna } = calcularLinhaColuna(html, i);
        tags.push({
          nome,
          tipo: "fecha",
          posicao: i,
          fim: i + texto.length,
          texto,
          linha,
          coluna,
          atributos: { todos: {}, id: null, classes: [], eventosInline: [] },
        });
        i = j + 1;
        continue;
      }
    }

    // 4. Tag de abertura ou auto-fechável: <tag ...>
    const matchAbertura = html.slice(i + 1).match(/^[a-zA-Z][\w-]*/);
    if (matchAbertura) {
      const nome = matchAbertura[0].toLowerCase();
      let j = i + 1 + matchAbertura[0].length;
      let quote = null;
      while (j < len) {
        const c = html[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === ">") {
          break;
        }
        j++;
      }

      const texto = html.slice(i, j + 1);
      const tipo = texto.endsWith("/>") ? "auto" : "abre";
      const { linha, coluna } = calcularLinhaColuna(html, i);
      const atributos = extrairAtributos(texto);

      tags.push({
        nome,
        tipo,
        posicao: i,
        fim: i + texto.length,
        texto,
        linha,
        coluna,
        atributos,
      });

      // Tags com conteúdo raw-text (script e style): pula conteúdo interno até fechar </script> ou </style>
      if ((nome === "script" || nome === "style") && tipo === "abre") {
        const regexFechamento = new RegExp(`</${nome}\\b[^>]*>`, "gi");
        regexFechamento.lastIndex = j + 1;
        const matchFim = regexFechamento.exec(html);
        if (matchFim) {
          i = matchFim.index;
          continue;
        }
      }

      i = j + 1;
      continue;
    }

    i++;
  }

  return tags;
}

// --- Validação Estrutural

/**
 * Valida a hierarquia de tags detectando tags abertas não fechadas,
 * tags de fechamento órfãs e fechamentos cruzados/aninhamento incorreto.
 * @param {Tag[]} tags - Lista de tags na ordem do documento.
 * @returns {RelatorioValidacao} Relatório com diagnósticos de erros e avisos.
 */
function validarEstrutura(tags) {
  const pilha = [];
  const erros = [];
  const avisos = [];

  for (const tag of tags) {
    if (ELEMENTOS_VAZIOS.has(tag.nome)) {
      if (tag.tipo === "fecha") {
        avisos.push({
          tipo: "fechamento_elemento_vazio",
          mensagem: `Tag vazia </${tag.nome}> não deve possuir tag de fechamento explícita.`,
          tag,
          linha: tag.linha,
          coluna: tag.coluna,
        });
      }
      continue;
    }

    if (tag.tipo === "auto") {
      continue;
    }

    if (tag.tipo === "abre") {
      pilha.push(tag);
      continue;
    }

    if (tag.tipo === "fecha") {
      if (pilha.length === 0) {
        erros.push({
          tipo: "fechamento_orfa",
          mensagem: `Tag de fechamento </${tag.nome}> encontrada sem nenhuma tag de abertura correspondente.`,
          tag,
          linha: tag.linha,
          coluna: tag.coluna,
        });
        continue;
      }

      const topo = pilha[pilha.length - 1];
      if (topo.nome === tag.nome) {
        pilha.pop();
        continue;
      }

      let idx = pilha.length - 1;
      while (idx >= 0 && pilha[idx].nome !== tag.nome) {
        idx--;
      }

      if (idx === -1) {
        erros.push({
          tipo: "fechamento_orfa",
          mensagem: `Tag de fechamento </${tag.nome}> não possui tag de abertura correspondente na pilha atual (esperava-se </${topo.nome}>).`,
          tag,
          linha: tag.linha,
          coluna: tag.coluna,
        });
      } else {
        const naoFechadas = pilha.slice(idx + 1);
        for (const pendente of naoFechadas) {
          erros.push({
            tipo: "fechamento_cruzado",
            mensagem: `Tag </${tag.nome}> encontrada fechando antes da tag <${pendente.nome}> (aberta na linha ${pendente.linha}) ser fechada.`,
            tag,
            tagPendente: pendente,
            linha: tag.linha,
            coluna: tag.coluna,
          });
        }
        pilha.splice(idx);
      }
    }
  }

  while (pilha.length > 0) {
    const pendente = pilha.pop();
    erros.push({
      tipo: "tag_nao_fechada",
      mensagem: `Tag <${pendente.nome}> aberta na linha ${pendente.linha}, coluna ${pendente.coluna} nunca foi fechada.`,
      tag: pendente,
      linha: pendente.linha,
      coluna: pendente.coluna,
    });
  }

  return {
    valido: erros.length === 0,
    totalErros: erros.length,
    totalAvisos: avisos.length,
    erros,
    avisos,
  };
}

// --- Mapeamento de Elementos

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

/**
 * Monta os elementos completos a partir das tags usando uma pilha LIFO.
 * Preserva o texto e o miolo originais com cortes exatos (`html.slice`),
 * garantindo a conservação integral da formatação, classes, atributos e quebras de linha.
 * @param {Tag[]} tags - Tags na ordem em que aparecem no HTML.
 * @param {string} html - HTML original completo.
 * @param {{ incluirVazios?: boolean }} [opcoes] - Opções de mapeamento (inclui void elements por padrão).
 * @returns {Elemento[]} Lista de elementos ordenados por posição inicial.
 */
function mapearElementos(tags, html, { incluirVazios = true } = {}) {
  const pilha = [];
  const elementos = [];

  for (const tag of tags) {
    if (tag.tipo === "auto" || ELEMENTOS_VAZIOS.has(tag.nome)) {
      if (incluirVazios && tag.tipo !== "fecha") {
        elementos.push({
          nome: tag.nome,
          inicio: tag.posicao,
          fim: tag.fim,
          inicioConteudo: tag.fim,
          fimConteudo: tag.fim,
          linha: tag.linha,
          coluna: tag.coluna,
          texto: tag.texto,
          conteudo: "",
          atributos: tag.atributos.todos,
          id: tag.atributos.id,
          classes: tag.atributos.classes,
          eventosInline: tag.atributos.eventosInline,
          eventosJS: [],
          eventos: [],
          tagAbertura: tag,
          tagFechamento: null,
          vazio: true,
        });
      }
      continue;
    }

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
      linha: abertura.linha,
      coluna: abertura.coluna,
      texto: html.slice(abertura.posicao, fim),
      conteudo: html.slice(inicioConteudo, fimConteudo),
      atributos: abertura.atributos.todos,
      id: abertura.atributos.id,
      classes: abertura.atributos.classes,
      eventosInline: abertura.atributos.eventosInline,
      eventosJS: [],
      eventos: [],
      tagAbertura: abertura,
      tagFechamento: tag,
      vazio: false,
    });
  }

  return elementos.sort((a, b) => a.inicio - b.inicio);
}

// --- Funções de Consulta e Busca

/**
 * Retorna o primeiro {@link Elemento} com o nome informado.
 * @param {Elemento[]} elementos - Lista de elementos onde procurar.
 * @param {string} nome - Nome do elemento (case-insensitive).
 * @returns {Elemento | undefined} O elemento encontrado, ou `undefined` se não existir.
 */
function buscarElementoPorNome(elementos, nome) {
  return elementos.find((elemento) => elemento.nome === nome.toLowerCase());
}

/**
 * Retorna todos os {@link Elemento} com o nome informado.
 * @param {Elemento[]} elementos - Lista de elementos.
 * @param {string} nome - Nome da tag (ex.: "button", "header").
 * @returns {Elemento[]} Elementos encontrados.
 */
function buscarTodosPorNome(elementos, nome) {
  return elementos.filter((elemento) => elemento.nome === nome.toLowerCase());
}

/**
 * Retorna o elemento com o identificador `id` correspondente.
 * @param {Elemento[]} elementos - Lista de elementos mapeados.
 * @param {string} id - Identificador procurado.
 * @returns {Elemento | undefined} O elemento ou undefined.
 */
function buscarPorId(elementos, id) {
  const idProcurado = id.startsWith("#") ? id.slice(1) : id;
  return elementos.find((elemento) => elemento.id === idProcurado);
}

/**
 * Retorna todos os elementos que possuem uma classe CSS específica.
 * @param {Elemento[]} elementos - Lista de elementos mapeados.
 * @param {string} classe - Nome da classe (com ou sem ponto inicial).
 * @returns {Elemento[]} Elementos que contêm a classe.
 */
function buscarPorClasse(elementos, classe) {
  const classeProcurada = classe.startsWith(".") ? classe.slice(1) : classe;
  return elementos.filter((elemento) =>
    elemento.classes.includes(classeProcurada),
  );
}

/**
 * Retorna elementos que contenham um atributo específico (e opcionalmente valor esperado).
 * @param {Elemento[]} elementos - Lista de elementos mapeados.
 * @param {string} nomeAtributo - Nome do atributo (ex.: "onclick", "disabled", "data-test").
 * @param {string | boolean} [valorEsperado] - Valor opcional esperado.
 * @returns {Elemento[]} Elementos compatíveis.
 */
function buscarPorAtributo(elementos, nomeAtributo, valorEsperado) {
  const chave = nomeAtributo.toLowerCase();
  return elementos.filter((el) => {
    if (!(chave in el.atributos)) return false;
    if (valorEsperado !== undefined) {
      return el.atributos[chave] === valorEsperado;
    }
    return true;
  });
}

/**
 * Extrai atributos `id` entre aspas de um trecho HTML (compatibilidade retroativa).
 * @param {string} html - Trecho HTML onde procurar os IDs.
 * @returns {string[]} Os valores dos atributos `id` encontrados.
 */
function extrairIds(html) {
  return [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(
    ([, id]) => id,
  );
}

/**
 * Extrai IDs usados em chamadas simples de `querySelector("#id")` (compatibilidade retroativa).
 * @param {string} script - Código JavaScript a analisar.
 * @returns {string[]} Os IDs consultados.
 */
function extrairIdsConsultados(script) {
  return [
    ...script.matchAll(/\bquerySelector\(\s*["']#([^"']+)["']\s*\)/g),
  ].map(([, id]) => id);
}

// --- Análise Estática de JavaScript e Detalhamento de Eventos

/**
 * Extrai os argumentos de uma chamada de função delimitada por parênteses,
 * rastreando strings (com aspas e template literals), comentários e blocos aninhados.
 * @param {string} codigo - Código fonte JavaScript.
 * @param {number} posAberturaParen - Offset do parêntese '(' que abre a lista de argumentos.
 * @returns {{ args: string[], fimChamada: number }} Lista de argumentos e offset final da chamada.
 */
function extrairArgumentosChamada(codigo, posAberturaParen) {
  let i = posAberturaParen + 1;
  const args = [];
  let argInicio = i;
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let quote = null;
  const inTemplateBrace = [];
  const len = codigo.length;

  while (i < len) {
    const c = codigo[i];
    const prev = i > 0 ? codigo[i - 1] : "";

    // 1. Strings e interpolações em template literals
    if (quote) {
      if (quote === "`" && c === "$" && codigo[i + 1] === "{" && prev !== "\\") {
        inTemplateBrace.push(depthBrace);
        i += 2;
        depthBrace++;
        quote = null;
        continue;
      }
      if (c === quote && prev !== "\\") {
        quote = null;
      }
      i++;
      continue;
    }

    if (
      inTemplateBrace.length > 0 &&
      c === "}" &&
      depthBrace === inTemplateBrace[inTemplateBrace.length - 1] + 1
    ) {
      depthBrace--;
      inTemplateBrace.pop();
      quote = "`";
      i++;
      continue;
    }

    // 2. Comentários JS
    if (c === "/" && codigo[i + 1] === "/") {
      const fimLinha = codigo.indexOf("\n", i + 2);
      i = fimLinha === -1 ? len : fimLinha + 1;
      continue;
    }
    if (c === "/" && codigo[i + 1] === "*") {
      const fimBloco = codigo.indexOf("*/", i + 2);
      i = fimBloco === -1 ? len : fimBloco + 2;
      continue;
    }

    // 3. Abertura de strings
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i++;
      continue;
    }

    // 4. Parênteses, chaves e separadores
    if (c === "(") depthParen++;
    else if (c === ")") {
      if (depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
        const argFinal = codigo.slice(argInicio, i).trim();
        if (argFinal) args.push(argFinal);
        return { args, fimChamada: i + 1 };
      }
      depthParen--;
    } else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (c === "[") depthBracket++;
    else if (c === "]") depthBracket--;
    else if (
      c === "," &&
      depthParen === 0 &&
      depthBrace === 0 &&
      depthBracket === 0
    ) {
      args.push(codigo.slice(argInicio, i).trim());
      argInicio = i + 1;
    }

    i++;
  }

  return { args, fimChamada: i };
}

/**
 * Detalha a estrutura de um manipulador de evento extraído: identifica se é arrow function,
 * função anônima, função nomeada ou referência, extraindo parâmetros e o código completo.
 * @param {string} codigoArg - Texto literal do argumento do manipulador.
 * @returns {ManipuladorDetalhado} Detalhes interpretados do manipulador.
 */
function detalharManipulador(codigoArg) {
  if (!codigoArg) {
    return {
      tipoManipulador: "desconhecido",
      parametros: [],
      nomeFuncao: null,
      codigo: "",
    };
  }

  const codigo = codigoArg.trim();

  // Arrow function com parênteses: () => ... ou (e, target) => ...
  const matchArrowParen = codigo.match(/^\(([^)]*)\)\s*=>/);
  if (matchArrowParen) {
    const params = matchArrowParen[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return {
      tipoManipulador: "arrow_function",
      parametros: params,
      nomeFuncao: null,
      codigo,
    };
  }

  // Arrow function sem parênteses: e => ...
  const matchArrowSimples = codigo.match(/^([a-zA-Z_$][\w$]*)\s*=>/);
  if (matchArrowSimples) {
    return {
      tipoManipulador: "arrow_function",
      parametros: [matchArrowSimples[1]],
      nomeFuncao: null,
      codigo,
    };
  }

  // Função tradicional: function(...) ou async function(...)
  const matchFuncao = codigo.match(
    /^(?:async\s+)?function\s*([a-zA-Z_$][\w$]*)?\s*\(([^)]*)\)/,
  );
  if (matchFuncao) {
    const nome = matchFuncao[1] || null;
    const params = matchFuncao[2]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return {
      tipoManipulador: nome ? "funcao_nomeada" : "funcao_anonima",
      nomeFuncao: nome,
      parametros: params,
      codigo,
    };
  }

  // Identificador ou referência de função (ex.: handleClick, objeto.acao)
  return {
    tipoManipulador: "referencia",
    nomeFuncao: codigo,
    parametros: [],
    codigo,
  };
}

/**
 * Analisa blocos `<script>` para descobrir variáveis associadas a elementos DOM
 * e mapear detalhadamente ouvintes de eventos (`addEventListener` e propriedades `on...`).
 * @param {Elemento[]} elementos - Elementos mapeados do HTML.
 * @returns {{ scriptsAnalisados: number, variaveisDeclaradas: Array<Object>, listeners: EventoMapeado[] }}
 */
function analisarScripts(elementos) {
  const scripts = elementos.filter((el) => el.nome === "script");
  const variaveisDeclaradas = [];
  const listeners = [];

  for (const scriptEl of scripts) {
    const codigoJs = scriptEl.conteudo;
    const variaveisLocais = new Map();

    // 1. Variáveis que capturam elementos DOM:
    // const/let/var x = document.querySelector/getElementById/etc.
    const regexAtribuicao =
      /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*document\.(querySelector(?:All)?|getElementById|getElementsByClassName|getElementsByTagName)\s*\(\s*(["'`])([^"'`]+)\3\s*\)/g;

    let match;
    while ((match = regexAtribuicao.exec(codigoJs)) !== null) {
      const [, nomeVar, metodo, , argumento] = match;
      let tipoSeletor = "complexo";
      let seletorFormatado = argumento;

      if (metodo === "getElementById") {
        tipoSeletor = "id";
        seletorFormatado = `#${argumento}`;
      } else if (metodo === "getElementsByClassName") {
        tipoSeletor = "class";
        seletorFormatado = `.${argumento}`;
      } else if (metodo === "getElementsByTagName") {
        tipoSeletor = "tag";
        seletorFormatado = argumento.toLowerCase();
      } else if (metodo.startsWith("querySelector")) {
        if (argumento.startsWith("#")) tipoSeletor = "id";
        else if (argumento.startsWith(".")) tipoSeletor = "class";
        else if (/^[a-zA-Z][\w-]*$/.test(argumento)) tipoSeletor = "tag";
      }

      const info = {
        variavel: nomeVar,
        metodo,
        argumento,
        seletor: seletorFormatado,
        tipoSeletor,
        scriptInicio: scriptEl.inicioConteudo + match.index,
      };
      variaveisLocais.set(nomeVar, info);
      variaveisDeclaradas.push(info);
    }

    // 2. addEventListener direto em expressão document.*:
    // document.getElementById(...).addEventListener(...)
    const regexListenerDireto =
      /document\.(querySelector(?:All)?|getElementById|getElementsByClassName|getElementsByTagName)\s*\(\s*(["'`])([^"'`]+)\2\s*\)\.addEventListener\s*\(/g;
    while ((match = regexListenerDireto.exec(codigoJs)) !== null) {
      const [, metodo, , argumento] = match;
      let tipoSeletor = "complexo";
      let seletorFormatado = argumento;
      if (metodo === "getElementById") {
        tipoSeletor = "id";
        seletorFormatado = `#${argumento}`;
      } else if (metodo === "getElementsByClassName") {
        tipoSeletor = "class";
        seletorFormatado = `.${argumento}`;
      } else if (metodo.startsWith("querySelector")) {
        if (argumento.startsWith("#")) tipoSeletor = "id";
        else if (argumento.startsWith(".")) tipoSeletor = "class";
      }

      const posParen = match.index + match[0].length - 1;
      const { args } = extrairArgumentosChamada(codigoJs, posParen);
      const tipoEvento = limparAspas(args[0]);
      const manipulador = detalharManipulador(args[1]);
      const opcoes = args[2] || null;

      listeners.push({
        evento: tipoEvento,
        seletor: seletorFormatado,
        tipoSeletor,
        argumentoOriginal: argumento,
        variavel: null,
        metodo,
        origem: "addEventListenerDireto",
        tipoManipulador: manipulador.tipoManipulador,
        nomeFuncao: manipulador.nomeFuncao,
        parametros: manipulador.parametros,
        codigo: manipulador.codigo,
        opcoes,
        scriptInicio: scriptEl.inicioConteudo + match.index,
      });
    }

    // 3. addEventListener através de variável:
    // botao.addEventListener(...)
    const regexListenerVar =
      /([a-zA-Z_$][\w$]*)\.addEventListener\s*\(/g;
    while ((match = regexListenerVar.exec(codigoJs)) !== null) {
      const [, nomeVar] = match;
      const posParen = match.index + match[0].length - 1;
      const { args } = extrairArgumentosChamada(codigoJs, posParen);
      const tipoEvento = limparAspas(args[0]);
      const manipulador = detalharManipulador(args[1]);
      const opcoes = args[2] || null;

      if (variaveisLocais.has(nomeVar)) {
        const varInfo = variaveisLocais.get(nomeVar);
        listeners.push({
          evento: tipoEvento,
          seletor: varInfo.seletor,
          tipoSeletor: varInfo.tipoSeletor,
          argumentoOriginal: varInfo.argumento,
          variavel: nomeVar,
          metodo: varInfo.metodo,
          origem: "addEventListenerVariavel",
          tipoManipulador: manipulador.tipoManipulador,
          nomeFuncao: manipulador.nomeFuncao,
          parametros: manipulador.parametros,
          codigo: manipulador.codigo,
          opcoes,
          scriptInicio: scriptEl.inicioConteudo + match.index,
        });
      } else {
        listeners.push({
          evento: tipoEvento,
          seletor: null,
          tipoSeletor: "desconhecido",
          argumentoOriginal: null,
          variavel: nomeVar,
          metodo: null,
          origem: "addEventListenerVariavelDesconhecida",
          tipoManipulador: manipulador.tipoManipulador,
          nomeFuncao: manipulador.nomeFuncao,
          parametros: manipulador.parametros,
          codigo: manipulador.codigo,
          opcoes,
          scriptInicio: scriptEl.inicioConteudo + match.index,
        });
      }
    }

    // 4. Atribuição de propriedades on...:
    // botao.onclick = ...
    const regexPropriedadeOn = /([a-zA-Z_$][\w$]*)\.(on[a-zA-Z]+)\s*=\s*([^;\n]+)/g;
    while ((match = regexPropriedadeOn.exec(codigoJs)) !== null) {
      const [, nomeVar, prop, expressaoDireita] = match;
      const evento = prop.slice(2).toLowerCase();
      const manipulador = detalharManipulador(expressaoDireita);

      if (variaveisLocais.has(nomeVar)) {
        const varInfo = variaveisLocais.get(nomeVar);
        listeners.push({
          evento,
          seletor: varInfo.seletor,
          tipoSeletor: varInfo.tipoSeletor,
          argumentoOriginal: varInfo.argumento,
          variavel: nomeVar,
          metodo: varInfo.metodo,
          origem: "propriedadeOn",
          tipoManipulador: manipulador.tipoManipulador,
          nomeFuncao: manipulador.nomeFuncao,
          parametros: manipulador.parametros,
          codigo: manipulador.codigo,
          opcoes: null,
          scriptInicio: scriptEl.inicioConteudo + match.index,
        });
      }
    }
  }

  return {
    scriptsAnalisados: scripts.length,
    variaveisDeclaradas,
    listeners,
  };
}

/**
 * Associa os ouvintes de eventos extraídos dos scripts e eventos inline aos elementos correspondentes
 * na lista de elementos mapeados do HTML.
 * @param {Elemento[]} elementos - Lista de elementos mapeados.
 * @param {{ listeners: EventoMapeado[] }} analiseScripts - Resultado de `analisarScripts`.
 * @returns {{ vinculos: Array<Object>, seletoresNaoEncontrados: EventoMapeado[] }}
 */
function associarEventos(elementos, analiseScripts) {
  const vinculos = [];
  const seletoresNaoEncontrados = [];

  // Limpa listas de eventos nos elementos para evitar duplicações em múltiplas chamadas
  for (const el of elementos) {
    el.eventos = [];
    el.eventosJS = [];
  }

  // 1. Vincula eventos inline declarados no próprio HTML (ex.: onclick="...")
  for (const el of elementos) {
    for (const inline of el.eventosInline) {
      const eventoMapeado = {
        evento: inline.evento,
        origem: "inline",
        tipoManipulador: "inline",
        nomeFuncao: null,
        parametros: inline.parametros,
        codigo: inline.codigo,
        opcoes: null,
        seletor: el.id ? `#${el.id}` : null,
        variavel: null,
        metodo: null,
        posicao: { linha: el.linha, coluna: el.coluna },
      };

      el.eventos.push(eventoMapeado);

      vinculos.push({
        elemento: `<${el.nome}${el.id ? ` id="${el.id}"` : ""}>`,
        tag: el.nome,
        id: el.id,
        linha: el.linha,
        coluna: el.coluna,
        evento: inline.evento,
        origem: "inline",
        tipoManipulador: "inline",
        nomeFuncao: null,
        parametros: inline.parametros,
        codigo: inline.codigo,
        opcoes: null,
        seletor: el.id ? `#${el.id}` : null,
        variavel: null,
        metodo: null,
      });
    }
  }

  // 2. Vincula ouvintes de eventos extraídos dos scripts JavaScript
  for (const listener of analiseScripts.listeners) {
    if (!listener.seletor) continue;

    let correspondentes = [];
    if (listener.tipoSeletor === "id") {
      const idLimpo = listener.argumentoOriginal.startsWith("#")
        ? listener.argumentoOriginal.slice(1)
        : listener.argumentoOriginal;
      const el = buscarPorId(elementos, idLimpo);
      if (el) correspondentes.push(el);
    } else if (listener.tipoSeletor === "class") {
      const classeLimpa = listener.argumentoOriginal.startsWith(".")
        ? listener.argumentoOriginal.slice(1)
        : listener.argumentoOriginal;
      correspondentes = buscarPorClasse(elementos, classeLimpa);
    } else if (listener.tipoSeletor === "tag") {
      correspondentes = buscarTodosPorNome(elementos, listener.argumentoOriginal);
    }

    if (correspondentes.length === 0) {
      seletoresNaoEncontrados.push(listener);
    } else {
      for (const el of correspondentes) {
        const eventoMapeado = {
          evento: listener.evento,
          origem: listener.origem,
          tipoManipulador: listener.tipoManipulador,
          nomeFuncao: listener.nomeFuncao || null,
          parametros: listener.parametros || [],
          codigo: listener.codigo,
          opcoes: listener.opcoes || null,
          seletor: listener.seletor,
          variavel: listener.variavel,
          metodo: listener.metodo,
          posicao: { scriptInicio: listener.scriptInicio },
        };

        el.eventosJS.push(eventoMapeado);
        el.eventos.push(eventoMapeado);

        vinculos.push({
          elemento: `<${el.nome}${el.id ? ` id="${el.id}"` : ""}>`,
          tag: el.nome,
          id: el.id,
          linha: el.linha,
          coluna: el.coluna,
          evento: listener.evento,
          origem: listener.origem,
          tipoManipulador: listener.tipoManipulador,
          nomeFuncao: listener.nomeFuncao || null,
          parametros: listener.parametros || [],
          codigo: listener.codigo,
          opcoes: listener.opcoes || null,
          seletor: listener.seletor,
          variavel: listener.variavel,
          metodo: listener.metodo,
        });
      }
    }
  }

  return {
    vinculos,
    seletoresNaoEncontrados,
  };
}

/**
 * Gera um relatório consolidado da interatividade da página com o mapeamento completo dos eventos,
 * cruzando elementos interativos (botões, links, formulários), eventos inline e listeners JS.
 * @param {Elemento[]} elementos - Elementos mapeados.
 * @param {ReturnType<typeof analisarScripts>} analiseScripts - Análise dos scripts.
 * @returns {Object} Relatório estruturado com eventos completos mapeados.
 */
function gerarRelatorioInteratividade(
  elementos,
  analiseScripts,
  associacaoPrevia,
) {
  const associacao =
    associacaoPrevia || associarEventos(elementos, analiseScripts);

  const elementosInterativos = elementos.filter(
    (el) =>
      ["button", "a", "input", "select", "textarea", "form"].includes(
        el.nome,
      ) ||
      el.eventos.length > 0,
  );

  const comEventos = elementos.filter((el) => el.eventos.length > 0);

  const interativosSemEventos = elementosInterativos.filter(
    (el) => el.eventos.length === 0,
  );

  return {
    totalElementos: elementos.length,
    totalInterativos: elementosInterativos.length,
    totalComEventos: comEventos.length,
    comEventos: comEventos.map((el) => ({
      tag: el.nome,
      id: el.id,
      classes: el.classes,
      linha: el.linha,
      coluna: el.coluna,
      totalEventos: el.eventos.length,
      eventos: el.eventos,
      css: el.css,
    })),
    interativosSemEventos: interativosSemEventos.map((el) => ({
      tag: el.nome,
      id: el.id,
      linha: el.linha,
      coluna: el.coluna,
    })),
    vinculosRealizados: associacao.vinculos,
    seletoresNaoEncontrados: associacao.seletoresNaoEncontrados,
  };
}

// --- Mapeamento de CSS (tailwind.config, blocos <style> e style inline)

/**
 * Encontra o fechamento correspondente a `{`, `[` ou `(` na posição informada,
 * respeitando strings e (no modo JS) comentários.
 * @param {string} codigo - Texto onde procurar.
 * @param {number} posAbertura - Posição do caractere de abertura.
 * @param {{ js?: boolean }} [opcoes] - `js: true` também pula comentários `//` e `/* *\/`.
 * @returns {number} Posição do fechamento, ou -1 se não houver.
 */
function encontrarFechamento(codigo, posAbertura, { js = true } = {}) {
  const abre = codigo[posAbertura];
  const fecha = { "{": "}", "[": "]", "(": ")" }[abre];
  let profundidade = 0;
  let aspas = null;

  for (let i = posAbertura; i < codigo.length; i++) {
    const c = codigo[i];
    if (aspas) {
      if (c === "\\") i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || (js && c === "`")) {
      aspas = c;
      continue;
    }
    if (js && c === "/" && codigo[i + 1] === "/") {
      const nl = codigo.indexOf("\n", i);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }
    if (js && c === "/" && codigo[i + 1] === "*") {
      const f = codigo.indexOf("*/", i + 2);
      if (f < 0) return -1;
      i = f + 1;
      continue;
    }
    if (c === abre) profundidade += 1;
    else if (c === fecha) {
      profundidade -= 1;
      if (profundidade === 0) return i;
    }
  }
  return -1;
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\// --- Exportação e Persistência em JSON");
}

/**
 * Achata objetos aninhados de tokens (ex.: `primary: { DEFAULT, 500 }`)
 * em nomes de classe (`primary`, `primary-500`).
 */
function achatarTokens(objeto, prefixo = "") {
  const saida = [];
  for (const [chave, valor] of Object.entries(objeto)) {
    const nome =
      chave === "DEFAULT" ? prefixo || "DEFAULT" : prefixo ? `${prefixo}-${chave}` : chave;
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      saida.push(...achatarTokens(valor, nome));
    } else {
      saida.push({ nome, chaveFonte: chave, valor });
    }
  }
  return saida;
}

/**
 * Localiza `tailwind.config = {...}` dentro dos `<script>` e extrai os tokens
 * do tema (`theme` e `theme.extend`), cada um com a linha onde foi escrito.
 *
 * O objeto é avaliado com `node:vm` num contexto vazio (sem `require`, `process`
 * etc.). Isso não é um sandbox de segurança: use apenas com arquivos confiáveis.
 * @param {Elemento[]} elementos - Elementos mapeados do HTML.
 * @param {string} html - HTML completo (para calcular linhas).
 * @returns {Object} `{ encontrado, linha, secoes: { colors: { nome: { valor, linha, origem } } }, totais }`.
 */
function extrairTailwindConfig(elementos, html) {
  for (const el of elementos) {
    if (el.nome !== "script" || el.vazio) continue;

    const match = /tailwind\.config\s*=\s*\{/.exec(el.conteudo);
    if (!match) continue;

    const posAbre = match.index + match[0].length - 1;
    const posFecha = encontrarFechamento(el.conteudo, posAbre);
    if (posFecha < 0) continue;

    const textoObjeto = el.conteudo.slice(posAbre, posFecha + 1);
    const offsetBase = el.inicioConteudo + posAbre;
    const linha = calcularLinhaColuna(html, el.inicioConteudo + match.index).linha;

    let config;
    try {
      config = vm.runInNewContext(`(${textoObjeto})`, Object.create(null), {
        timeout: 100,
      });
    } catch (erro) {
      return { encontrado: true, linha, erro: erro.message, secoes: {}, totais: {} };
    }

    const tema = (config && config.theme) || {};
    const extensao = tema.extend || {};
    const secoes = {};

    const registrarSecao = (nomeSecao, objeto, origem) => {
      if (!objeto || typeof objeto !== "object" || Array.isArray(objeto)) return;

      // Delimita a busca de linhas ao bloco da seção no texto do config
      const regexSecao = new RegExp(
        `(?<![\\w-])(["']?)${escaparRegex(nomeSecao)}\\1\\s*:\\s*\\{`,
        "g",
      );
      let inicioBusca = 0;
      let fimBusca = textoObjeto.length;
      const posExtend = textoObjeto.search(/(?<![\w-])["']?extend["']?\s*:/);
      if (origem === "extend" && posExtend >= 0) regexSecao.lastIndex = posExtend;
      const matchSecao = regexSecao.exec(textoObjeto);
      if (matchSecao) {
        inicioBusca = matchSecao.index;
        const posChave = matchSecao.index + matchSecao[0].length - 1;
        const fimSecao = encontrarFechamento(textoObjeto, posChave);
        if (fimSecao > 0) fimBusca = fimSecao;
      }
      const trechoSecao = textoObjeto.slice(inicioBusca, fimBusca);

      secoes[nomeSecao] = secoes[nomeSecao] || {};
      for (const token of achatarTokens(objeto)) {
        const regexChave = new RegExp(
          `(?<![\\w-])(["']?)${escaparRegex(token.chaveFonte)}\\1\\s*:`,
        );
        const pos = trechoSecao.search(regexChave);
        secoes[nomeSecao][token.nome] = {
          valor: token.valor,
          linha:
            pos >= 0
              ? calcularLinhaColuna(html, offsetBase + inicioBusca + pos).linha
              : null,
          origem,
        };
      }
    };

    for (const [nomeSecao, objeto] of Object.entries(tema)) {
      if (nomeSecao !== "extend") registrarSecao(nomeSecao, objeto, "theme");
    }
    for (const [nomeSecao, objeto] of Object.entries(extensao)) {
      registrarSecao(nomeSecao, objeto, "extend");
    }

    const totais = {};
    for (const [nomeSecao, tokens] of Object.entries(secoes)) {
      totais[nomeSecao] = Object.keys(tokens).length;
    }

    return { encontrado: true, linha, secoes, totais };
  }

  return { encontrado: false, linha: null, secoes: {}, totais: {} };
}

/**
 * Famílias de utilitários do Tailwind que leem tokens do tema.
 * Cada entrada: [prefixo, seção do tema, propriedades CSS geradas, observação].
 */
const UTILIDADES_TAILWIND = [
  // Cores
  ["bg", "colors", ["background-color"]],
  ["text", "colors", ["color"]],
  ["border", "colors", ["border-color"]],
  ["border-x", "colors", ["border-left-color", "border-right-color"]],
  ["border-y", "colors", ["border-top-color", "border-bottom-color"]],
  ["border-t", "colors", ["border-top-color"]],
  ["border-r", "colors", ["border-right-color"]],
  ["border-b", "colors", ["border-bottom-color"]],
  ["border-l", "colors", ["border-left-color"]],
  ["divide", "colors", ["border-color"], "entre filhos"],
  ["outline", "colors", ["outline-color"]],
  ["ring", "colors", ["--tw-ring-color"]],
  ["ring-offset", "colors", ["--tw-ring-offset-color"]],
  ["fill", "colors", ["fill"]],
  ["stroke", "colors", ["stroke"]],
  ["from", "colors", ["--tw-gradient-from"]],
  ["via", "colors", ["--tw-gradient-via"]],
  ["to", "colors", ["--tw-gradient-to"]],
  ["placeholder", "colors", ["color"], "::placeholder"],
  ["caret", "colors", ["caret-color"]],
  ["accent", "colors", ["accent-color"]],
  ["decoration", "colors", ["text-decoration-color"]],
  ["shadow", "colors", ["--tw-shadow-color"]],
  // Tipografia
  ["text", "fontSize", ["font-size"]],
  ["font", "fontFamily", ["font-family"]],
  ["font", "fontWeight", ["font-weight"]],
  ["leading", "lineHeight", ["line-height"]],
  ["tracking", "letterSpacing", ["letter-spacing"]],
  // Bordas e sombras
  ["border", "borderWidth", ["border-width"]],
  ["rounded", "borderRadius", ["border-radius"]],
  ["rounded-t", "borderRadius", ["border-top-left-radius", "border-top-right-radius"]],
  ["rounded-r", "borderRadius", ["border-top-right-radius", "border-bottom-right-radius"]],
  ["rounded-b", "borderRadius", ["border-bottom-right-radius", "border-bottom-left-radius"]],
  ["rounded-l", "borderRadius", ["border-top-left-radius", "border-bottom-left-radius"]],
  ["rounded-tl", "borderRadius", ["border-top-left-radius"]],
  ["rounded-tr", "borderRadius", ["border-top-right-radius"]],
  ["rounded-br", "borderRadius", ["border-bottom-right-radius"]],
  ["rounded-bl", "borderRadius", ["border-bottom-left-radius"]],
  ["shadow", "boxShadow", ["box-shadow"]],
  ["outline", "outlineWidth", ["outline-width"]],
  ["ring", "ringWidth", ["--tw-ring-width"]],
  ["opacity", "opacity", ["opacity"]],
  ["z", "zIndex", ["z-index"]],
  // Espaçamento e dimensões
  ["p", "spacing", ["padding"]],
  ["px", "spacing", ["padding-left", "padding-right"]],
  ["py", "spacing", ["padding-top", "padding-bottom"]],
  ["pt", "spacing", ["padding-top"]],
  ["pr", "spacing", ["padding-right"]],
  ["pb", "spacing", ["padding-bottom"]],
  ["pl", "spacing", ["padding-left"]],
  ["m", "spacing", ["margin"]],
  ["mx", "spacing", ["margin-left", "margin-right"]],
  ["my", "spacing", ["margin-top", "margin-bottom"]],
  ["mt", "spacing", ["margin-top"]],
  ["mr", "spacing", ["margin-right"]],
  ["mb", "spacing", ["margin-bottom"]],
  ["ml", "spacing", ["margin-left"]],
  ["gap", "spacing", ["gap"]],
  ["gap-x", "spacing", ["column-gap"]],
  ["gap-y", "spacing", ["row-gap"]],
  ["space-x", "spacing", ["margin-left"], "entre filhos"],
  ["space-y", "spacing", ["margin-top"], "entre filhos"],
  ["w", "spacing", ["width"]],
  ["h", "spacing", ["height"]],
  ["size", "spacing", ["width", "height"]],
  ["min-w", "spacing", ["min-width"]],
  ["min-h", "spacing", ["min-height"]],
  ["max-w", "spacing", ["max-width"]],
  ["max-h", "spacing", ["max-height"]],
  ["inset", "spacing", ["inset"]],
  ["inset-x", "spacing", ["left", "right"]],
  ["inset-y", "spacing", ["top", "bottom"]],
  ["top", "spacing", ["top"]],
  ["right", "spacing", ["right"]],
  ["bottom", "spacing", ["bottom"]],
  ["left", "spacing", ["left"]],
  ["translate-x", "spacing", ["--tw-translate-x"]],
  ["translate-y", "spacing", ["--tw-translate-y"]],
  ["scroll-m", "spacing", ["scroll-margin"]],
  ["scroll-mt", "spacing", ["scroll-margin-top"]],
  ["scroll-mb", "spacing", ["scroll-margin-bottom"]],
  ["scroll-p", "spacing", ["scroll-padding"]],
  ["scroll-pt", "spacing", ["scroll-padding-top"]],
  ["scroll-pb", "spacing", ["scroll-padding-bottom"]],
]
  .map(([prefixo, secao, propriedades, observacao = null]) => ({
    prefixo,
    secao,
    propriedades,
    observacao,
  }))
  // Prefixos mais longos primeiro: `border-t-x` deve testar `border-t` antes de `border`
  .sort((a, b) => b.prefixo.length - a.prefixo.length);

const PREFIXOS_COM_COR = new Set(
  UTILIDADES_TAILWIND.filter((u) => u.secao === "colors").map((u) => u.prefixo),
);

/**
 * Separa variantes (`hover:`, `md:`, `group-hover:`) do utilitário,
 * ignorando `:` dentro de valores arbitrários (`[...]`).
 * @param {string} classe - Classe completa (ex.: `md:hover:bg-primary/20`).
 * @returns {{ variantes: string[], utilitario: string }}
 */
function separarVariantes(classe) {
  const partes = [];
  let atual = "";
  let colchetes = 0;
  for (const c of classe) {
    if (c === "[") colchetes += 1;
    else if (c === "]") colchetes -= 1;
    if (c === ":" && colchetes === 0) {
      partes.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  partes.push(atual);
  return { variantes: partes.slice(0, -1), utilitario: partes[partes.length - 1] };
}

function aplicarOpacidade(cor, opacidade) {
  const alfa = opacidade.startsWith("[")
    ? Number.parseFloat(opacidade.slice(1, -1))
    : Number.parseInt(opacidade, 10) / 100;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(cor));
  if (!hex || Number.isNaN(alfa)) return `${cor} / ${opacidade}`;
  const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Number(alfa.toFixed(3))})`;
}

function paraKebab(nome) {
  return nome.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);
}

function formatarFamiliaFonte(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor).split(",");
  return lista
    .map((f) => String(f).trim())
    .map((f) => (/\s/.test(f) && !/^["']/.test(f) ? `"${f}"` : f))
    .join(", ");
}

/**
 * Resolve uma classe Tailwind para as declarações CSS que ela gera,
 * quando o valor vem do `tailwind.config` ou é um valor arbitrário (`w-[42%]`).
 * Classes sem token no config ficam com `origem: "padrao"` (escala padrão do Tailwind,
 * que este experimento não reproduz).
 * @param {string} classe - Classe como escrita no HTML.
 * @param {Object} config - Resultado de {@link extrairTailwindConfig}.
 * @returns {Object} Classe resolvida com `origem`, `declaracoes`, `secao`, `token` e `linhaToken`.
 */
function resolverClasseTailwind(classe, config) {
  const { variantes, utilitario: bruto } = separarVariantes(classe);
  let utilitario = bruto;
  let importante = false;
  let negativo = false;

  if (utilitario.startsWith("!")) {
    importante = true;
    utilitario = utilitario.slice(1);
  }
  if (utilitario.startsWith("-")) {
    negativo = true;
    utilitario = utilitario.slice(1);
  }

  const base = { classe, variantes, utilitario, importante, negativo };
  const secoes = (config && config.secoes) || {};

  for (const util of UTILIDADES_TAILWIND) {
    let resto;
    if (utilitario === util.prefixo) resto = "DEFAULT";
    else if (utilitario.startsWith(`${util.prefixo}-`)) {
      resto = utilitario.slice(util.prefixo.length + 1);
    } else continue;

    let valor;
    let opacidade = null;
    let origem;
    let token = null;
    let linhaToken = null;
    let extras = [];

    // Separa opacidade de cor: bg-primary/20, bg-primary/[.35]
    let chave = resto;
    if (util.secao === "colors") {
      const m = /^(.+)\/(\d{1,3}|\[[^\]]+\])$/.exec(resto);
      if (m) {
        chave = m[1];
        opacidade = m[2];
      }
    }

    if (chave.startsWith("[") && chave.endsWith("]")) {
      valor = chave.slice(1, -1).replace(/_/g, " ");
      const ehCor = /^(#|rgba?\(|hsla?\(|color:)/i.test(valor);
      if (PREFIXOS_COM_COR.has(util.prefixo) && (util.secao === "colors") !== ehCor) {
        continue;
      }
      valor = valor.replace(/^color:/i, "");
      origem = "arbitrario";
    } else {
      const encontrado = secoes[util.secao] && secoes[util.secao][chave];
      if (!encontrado) continue;
      valor = encontrado.valor;
      origem = "tailwind.config";
      token = chave;
      linhaToken = encontrado.linha;
    }

    if (util.secao === "fontSize" && Array.isArray(valor)) {
      const [tamanho, complemento] = valor;
      if (typeof complemento === "string") {
        extras.push({ propriedade: "line-height", valor: complemento });
      } else if (complemento && typeof complemento === "object") {
        extras = Object.entries(complemento).map(([p, v]) => ({
          propriedade: paraKebab(p),
          valor: String(v),
        }));
      }
      valor = tamanho;
    } else if (util.secao === "fontFamily") {
      valor = formatarFamiliaFonte(valor);
    } else if (Array.isArray(valor)) {
      valor = valor.join(", ");
    }

    valor = String(valor);
    if (opacidade) valor = aplicarOpacidade(valor, opacidade);
    if (negativo) valor = valor.startsWith("-") ? valor.slice(1) : `-${valor}`;
    const sufixo = importante ? " !important" : "";

    return {
      ...base,
      origem,
      secao: util.secao,
      token,
      linhaToken,
      opacidade,
      observacao: util.observacao,
      declaracoes: [
        ...util.propriedades.map((propriedade) => ({ propriedade, valor: valor + sufixo })),
        ...extras.map((e) => ({ ...e, valor: e.valor + sufixo })),
      ],
    };
  }

  return {
    ...base,
    origem: "padrao",
    secao: null,
    token: null,
    linhaToken: null,
    opacidade: null,
    observacao: null,
    declaracoes: [],
  };
}

/**
 * Divide um texto por um separador, ignorando ocorrências dentro de
 * parênteses, colchetes e strings.
 */
function dividirNoNivelSuperior(texto, separador) {
  const partes = [];
  let atual = "";
  let profundidade = 0;
  let aspas = null;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      atual += c;
      if (c === "\\") {
        atual += texto[i + 1] || "";
        i++;
      } else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'") aspas = c;
    else if (c === "(" || c === "[") profundidade += 1;
    else if (c === ")" || c === "]") profundidade -= 1;
    if (c === separador && profundidade === 0) {
      partes.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  partes.push(atual);
  return partes;
}

/**
 * Converte o corpo de uma regra (ou um atributo `style`) em declarações.
 * @param {string} corpo - Ex.: `margin: 0; color: red !important`.
 * @returns {{ propriedade: string, valor: string, importante: boolean }[]}
 */
function extrairDeclaracoes(corpo) {
  const declaracoes = [];
  for (const parte of dividirNoNivelSuperior(corpo, ";")) {
    const idx = parte.indexOf(":");
    if (idx < 0) continue;
    const propriedade = parte.slice(0, idx).trim().toLowerCase();
    let valor = parte.slice(idx + 1).trim().replace(/\s+/g, " ");
    if (!propriedade || !valor) continue;
    const importante = /!\s*important$/i.test(valor);
    if (importante) valor = valor.replace(/\s*!\s*important$/i, "");
    declaracoes.push({ propriedade, valor, importante });
  }
  return declaracoes;
}

const AT_RULES_AGRUPADORAS = new Set(["media", "layer", "supports", "container", "document"]);

/**
 * Extrai as regras de um texto CSS com a linha de cada uma.
 * Regras dentro de `@media`, `@layer`, `@supports` e `@container` entram com o
 * contexto (ex.: `["@layer base"]`). Outras at-rules (`@keyframes`, `@font-face`)
 * são listadas com `tipo: "at-rule"` e não são casadas com elementos.
 * @param {string} css - Conteúdo CSS.
 * @param {{ offsetBase?: number, html?: string }} [opcoes] - Offset do CSS dentro do HTML, para calcular linhas no arquivo original.
 * @returns {Object[]} Regras `{ tipo, seletor, seletores, linha, inicio, contexto, declaracoes }`.
 */
function extrairRegrasCss(css, { offsetBase = 0, html = null } = {}) {
  // Troca comentários por espaços para manter os offsets
  const texto = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const regras = [];

  const linhaDe = (pos) =>
    html
      ? calcularLinhaColuna(html, offsetBase + pos).linha
      : calcularLinhaColuna(texto, pos).linha;

  const percorrer = (inicio, fim, contexto) => {
    let i = inicio;
    while (i < fim) {
      while (i < fim && /\s/.test(texto[i])) i++;
      if (i >= fim) break;

      let j = i;
      let aspas = null;
      let parenteses = 0;
      while (j < fim) {
        const c = texto[j];
        if (aspas) {
          if (c === "\\") j++;
          else if (c === aspas) aspas = null;
        } else if (c === '"' || c === "'") aspas = c;
        else if (c === "(") parenteses += 1;
        else if (c === ")") parenteses -= 1;
        else if (parenteses === 0 && (c === "{" || c === ";" || c === "}")) break;
        j++;
      }
      if (j >= fim) break;

      const preludio = texto.slice(i, j).trim().replace(/\s+/g, " ");
      if (texto[j] !== "{") {
        i = j + 1; // @import/@charset ou sobra solta
        continue;
      }

      const fechamento = encontrarFechamento(texto, j, { js: false });
      const fimBloco = fechamento < 0 ? fim : fechamento;

      if (preludio.startsWith("@")) {
        const nomeAt = (/^@([\w-]+)/.exec(preludio) || [, ""])[1].toLowerCase();
        if (AT_RULES_AGRUPADORAS.has(nomeAt)) {
          percorrer(j + 1, fimBloco, [...contexto, preludio]);
        } else {
          regras.push({
            tipo: "at-rule",
            seletor: preludio,
            seletores: [],
            linha: linhaDe(i),
            inicio: offsetBase + i,
            contexto,
            declaracoes: nomeAt === "font-face" ? extrairDeclaracoes(texto.slice(j + 1, fimBloco)) : [],
          });
        }
      } else {
        regras.push({
          tipo: "regra",
          seletor: preludio,
          seletores: dividirNoNivelSuperior(preludio, ",").map((s) => s.trim()).filter(Boolean),
          linha: linhaDe(i),
          inicio: offsetBase + i,
          contexto,
          declaracoes: extrairDeclaracoes(texto.slice(j + 1, fimBloco)),
        });
      }

      i = fimBloco + 1;
    }
  };

  percorrer(0, texto.length, []);
  return regras;
}

const PSEUDO_ELEMENTOS_LEGADOS = new Set(["before", "after", "first-line", "first-letter"]);
const PSEUDO_ESTADOS = new Set([
  "hover", "focus", "focus-within", "focus-visible", "active", "visited", "target",
  "checked", "invalid", "valid", "placeholder-shown", "autofill", "indeterminate",
]);

/**
 * Analisa um seletor composto simples (sem combinadores), ex.: `a.btn#x[href]:hover::before`.
 */
function analisarComposto(texto) {
  const composto = {
    tag: null,
    ids: [],
    classes: [],
    atributos: [],
    pseudoClasses: [],
    pseudoElemento: null,
  };
  const desescapar = (s) => s.replace(/\\(.)/g, "$1");
  let i = 0;

  while (i < texto.length) {
    const resto = texto.slice(i);
    let m;
    if ((m = /^(\*|[a-zA-Z][\w-]*)/.exec(resto)) && i === 0) {
      composto.tag = m[1].toLowerCase();
    } else if ((m = /^#((?:[\w-]|\\.)+)/.exec(resto))) {
      composto.ids.push(desescapar(m[1]));
    } else if ((m = /^\.((?:[\w-]|\\.)+)/.exec(resto))) {
      composto.classes.push(desescapar(m[1]));
    } else if (
      (m = /^\[\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*([iIsS])?)?\s*\]/.exec(resto))
    ) {
      composto.atributos.push({
        nome: m[1].toLowerCase(),
        operador: m[2] || null,
        valor: m[3] ?? m[4] ?? m[5] ?? null,
        semCaixa: (m[6] || "").toLowerCase() === "i",
      });
    } else if ((m = /^::?([\w-]+)/.exec(resto))) {
      const duploDoisPontos = resto.startsWith("::");
      const nome = m[1].toLowerCase();
      let comprimento = m[0].length;
      let argumento = null;
      if (texto[i + comprimento] === "(") {
        const fecha = encontrarFechamento(texto, i + comprimento, { js: false });
        const fim = fecha < 0 ? texto.length - 1 : fecha;
        argumento = texto.slice(i + comprimento + 1, fim);
        comprimento = fim - i + 1;
      }
      if (duploDoisPontos || PSEUDO_ELEMENTOS_LEGADOS.has(nome)) {
        composto.pseudoElemento = nome;
      } else {
        composto.pseudoClasses.push({ nome, argumento });
      }
      i += comprimento;
      continue;
    } else {
      i += 1; // caractere não reconhecido
      continue;
    }
    i += m[0].length;
  }

  return composto;
}

/**
 * Analisa um seletor completo em partes compostas ligadas por combinadores
 * (` `, `>`, `+`, `~`). O combinador de cada parte é o que a liga à anterior.
 * @param {string} seletor - Ex.: `main > :first-child`.
 * @returns {{ combinador: string | null, composto: Object }[]}
 */
function analisarSeletor(seletor) {
  const s = seletor.trim();
  const partes = [];
  let combinadorPendente = null;
  let i = 0;

  while (i < s.length) {
    if (/[\s>+~]/.test(s[i])) {
      let combinador = " ";
      while (i < s.length && /[\s>+~]/.test(s[i])) {
        if (!/\s/.test(s[i])) combinador = s[i];
        i++;
      }
      if (partes.length) combinadorPendente = combinador;
      continue;
    }

    let j = i;
    let profundidade = 0;
    while (j < s.length) {
      const c = s[j];
      if (c === "[" || c === "(") profundidade += 1;
      else if (c === "]" || c === ")") profundidade -= 1;
      else if (c === "\\") j++;
      else if (profundidade === 0 && /[\s>+~]/.test(c)) break;
      j++;
    }

    partes.push({ combinador: combinadorPendente, composto: analisarComposto(s.slice(i, j)) });
    combinadorPendente = null;
    i = j;
  }

  return partes;
}

/**
 * Calcula a especificidade `[ids, classes/atributos/pseudo-classes, tags/pseudo-elementos]`.
 */
function calcularEspecificidade(partes) {
  const total = [0, 0, 0];
  for (const { composto } of partes) {
    total[0] += composto.ids.length;
    total[1] += composto.classes.length + composto.atributos.length;
    if (composto.tag && composto.tag !== "*") total[2] += 1;
    if (composto.pseudoElemento) total[2] += 1;
    for (const pc of composto.pseudoClasses) {
      if (pc.nome === "where") continue;
      if (["not", "is", "matches", "has"].includes(pc.nome) && pc.argumento) {
        const maior = dividirNoNivelSuperior(pc.argumento, ",")
          .map((s) => calcularEspecificidade(analisarSeletor(s)))
          .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0];
        if (maior) maior.forEach((v, k) => (total[k] += v));
        continue;
      }
      total[1] += 1;
    }
  }
  return total;
}

/**
 * Monta a árvore (pai e filhos) a partir dos intervalos dos elementos.
 * @param {Elemento[]} elementos - Elementos ordenados por posição.
 * @returns {{ pai: (el) => Elemento | null, filhos: (el) => Elemento[], irmaos: (el) => Elemento[] }}
 */
function construirArvore(elementos) {
  const pais = new Map();
  const filhos = new Map();
  const raizes = [];
  const pilha = [];

  for (const el of elementos) {
    while (pilha.length && pilha[pilha.length - 1].fim <= el.inicio) pilha.pop();
    const pai = pilha.length ? pilha[pilha.length - 1] : null;
    pais.set(el, pai);
    if (pai) {
      if (!filhos.has(pai)) filhos.set(pai, []);
      filhos.get(pai).push(el);
    } else {
      raizes.push(el);
    }
    if (!el.vazio) pilha.push(el);
  }

  return {
    pai: (el) => pais.get(el) || null,
    filhos: (el) => filhos.get(el) || [],
    irmaos: (el) => {
      const pai = pais.get(el);
      return pai ? filhos.get(pai) || [] : raizes;
    },
  };
}

function casarAnB(expressao, posicao) {
  const e = expressao.trim().toLowerCase().replace(/\s+/g, "");
  if (e === "odd") return posicao % 2 === 1;
  if (e === "even") return posicao % 2 === 0;
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(e);
  if (!m) return Number.parseInt(e, 10) === posicao;
  const a = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number.parseInt(m[1], 10);
  const b = m[2] ? Number.parseInt(m[2], 10) : 0;
  if (a === 0) return posicao === b;
  const n = (posicao - b) / a;
  return Number.isInteger(n) && n >= 0;
}

function casarAtributo(filtro, el) {
  const atributos = el.atributos || {};
  if (!(filtro.nome in atributos)) return false;
  if (!filtro.operador) return true;
  let atual = atributos[filtro.nome] === true ? "" : String(atributos[filtro.nome]);
  let esperado = filtro.valor ?? "";
  if (filtro.semCaixa) {
    atual = atual.toLowerCase();
    esperado = esperado.toLowerCase();
  }
  switch (filtro.operador) {
    case "=": return atual === esperado;
    case "~=": return atual.split(/\s+/).includes(esperado);
    case "|=": return atual === esperado || atual.startsWith(`${esperado}-`);
    case "^=": return esperado !== "" && atual.startsWith(esperado);
    case "$=": return esperado !== "" && atual.endsWith(esperado);
    case "*=": return esperado !== "" && atual.includes(esperado);
    default: return false;
  }
}

/**
 * Testa um seletor composto contra um elemento.
 * Estados dinâmicos (`:hover`, `:focus`...) não podem ser avaliados num arquivo
 * estático: o elemento casa e o estado é anotado.
 * @returns {{ estados: string[], naoAvaliados: string[], pseudoElemento: string | null } | null}
 */
function casarComposto(composto, el, arvore) {
  if (composto.tag && composto.tag !== "*" && composto.tag !== el.nome) return null;
  for (const id of composto.ids) if (el.id !== id) return null;
  for (const classe of composto.classes) if (!(el.classes || []).includes(classe)) return null;
  for (const filtro of composto.atributos) if (!casarAtributo(filtro, el)) return null;

  const estados = [];
  const naoAvaliados = [];

  for (const { nome, argumento } of composto.pseudoClasses) {
    const irmaos = () => arvore.irmaos(el);
    const doMesmoTipo = () => irmaos().filter((x) => x.nome === el.nome);
    let ok = true;

    switch (nome) {
      case "first-child": ok = irmaos()[0] === el; break;
      case "last-child": ok = irmaos()[irmaos().length - 1] === el; break;
      case "only-child": ok = irmaos().length === 1; break;
      case "first-of-type": ok = doMesmoTipo()[0] === el; break;
      case "last-of-type": ok = doMesmoTipo()[doMesmoTipo().length - 1] === el; break;
      case "only-of-type": ok = doMesmoTipo().length === 1; break;
      case "nth-child": ok = casarAnB(argumento || "", irmaos().indexOf(el) + 1); break;
      case "nth-last-child": ok = casarAnB(argumento || "", irmaos().length - irmaos().indexOf(el)); break;
      case "nth-of-type": ok = casarAnB(argumento || "", doMesmoTipo().indexOf(el) + 1); break;
      case "nth-last-of-type": ok = casarAnB(argumento || "", doMesmoTipo().length - doMesmoTipo().indexOf(el)); break;
      case "root": ok = el.nome === "html"; break;
      case "empty": ok = el.vazio || (el.conteudo || "").length === 0; break;
      case "disabled": ok = "disabled" in (el.atributos || {}); break;
      case "not":
        ok = !dividirNoNivelSuperior(argumento || "", ",").some((s) =>
          casarSeletor(analisarSeletor(s), el, arvore),
        );
        break;
      case "is":
      case "where":
      case "matches":
        ok = dividirNoNivelSuperior(argumento || "", ",").some((s) =>
          casarSeletor(analisarSeletor(s), el, arvore),
        );
        break;
      default:
        if (PSEUDO_ESTADOS.has(nome)) estados.push(nome);
        else naoAvaliados.push(`:${nome}${argumento !== null ? `(${argumento})` : ""}`);
    }
    if (!ok) return null;
  }

  return { estados, naoAvaliados, pseudoElemento: composto.pseudoElemento };
}

/**
 * Testa um seletor (já analisado por {@link analisarSeletor}) contra um elemento,
 * da direita para a esquerda, como o navegador faz.
 * @returns {{ estados: string[], naoAvaliados: string[], pseudoElemento: string | null } | null}
 */
function casarSeletor(partes, el, arvore, indice = partes.length - 1) {
  if (!partes.length) return null;
  const { composto, combinador } = partes[indice];
  const atual = casarComposto(composto, el, arvore);
  if (!atual) return null;
  if (indice === 0) return atual;

  const juntar = (anterior) =>
    anterior && {
      estados: [...anterior.estados, ...atual.estados],
      naoAvaliados: [...anterior.naoAvaliados, ...atual.naoAvaliados],
      pseudoElemento: atual.pseudoElemento,
    };

  if (combinador === ">") {
    const pai = arvore.pai(el);
    return pai ? juntar(casarSeletor(partes, pai, arvore, indice - 1)) : null;
  }
  if (combinador === " ") {
    for (let anc = arvore.pai(el); anc; anc = arvore.pai(anc)) {
      const r = casarSeletor(partes, anc, arvore, indice - 1);
      if (r) return juntar(r);
    }
    return null;
  }

  const irmaos = arvore.irmaos(el);
  const pos = irmaos.indexOf(el);
  if (combinador === "+") {
    return pos > 0 ? juntar(casarSeletor(partes, irmaos[pos - 1], arvore, indice - 1)) : null;
  }
  if (combinador === "~") {
    for (let k = pos - 1; k >= 0; k--) {
      const r = casarSeletor(partes, irmaos[k], arvore, indice - 1);
      if (r) return juntar(r);
    }
  }
  return null;
}

/** Seletor que vale para qualquer elemento (ex.: `*`, `::-webkit-scrollbar`). */
function ehSeletorGlobal(partes) {
  if (partes.length !== 1) return false;
  const c = partes[0].composto;
  return (
    (!c.tag || c.tag === "*") &&
    !c.ids.length &&
    !c.classes.length &&
    !c.atributos.length &&
    !c.pseudoClasses.length
  );
}

function compararEspecificidade(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Mapeia o CSS de cada elemento: classes Tailwind resolvidas pelo `tailwind.config`,
 * regras dos blocos `<style>` cujo seletor casa com o elemento e o atributo `style`.
 * Grava o resultado em `el.css` de cada elemento.
 * @param {Elemento[]} elementos - Elementos mapeados.
 * @param {string} html - HTML completo.
 * @returns {Object} Resumo: config do Tailwind, regras com contagem de elementos e estatísticas de classes.
 */
function mapearCss(elementos, html) {
  const tailwind = extrairTailwindConfig(elementos, html);
  const arvore = construirArvore(elementos);

  const blocosStyle = elementos.filter((el) => el.nome === "style" && !el.vazio);
  const regras = [];
  for (const bloco of blocosStyle) {
    regras.push(
      ...extrairRegrasCss(bloco.conteudo, { offsetBase: bloco.inicioConteudo, html }).map(
        (r) => ({ ...r, linhaBloco: bloco.linha }),
      ),
    );
  }

  const analisadas = regras
    .map((regra, indice) => ({ regra, indice }))
    .filter(({ regra }) => regra.tipo === "regra")
    .map(({ regra, indice }) => ({
      regra,
      indice,
      seletores: regra.seletores.map((texto) => {
        const partes = analisarSeletor(texto);
        return {
          texto,
          partes,
          especificidade: calcularEspecificidade(partes),
          global: ehSeletorGlobal(partes),
        };
      }),
    }));

  const contagemPorRegra = new Array(regras.length).fill(0);
  const cacheClasses = new Map();

  for (const el of elementos) {
    const classes = (el.classes || []).map((classe) => {
      if (!cacheClasses.has(classe)) {
        cacheClasses.set(classe, resolverClasseTailwind(classe, tailwind));
      }
      return cacheClasses.get(classe);
    });

    const regrasDoElemento = [];
    for (const { regra, indice, seletores } of analisadas) {
      let melhor = null;
      for (const sel of seletores) {
        const r = casarSeletor(sel.partes, el, arvore);
        if (!r) continue;
        if (!melhor || compararEspecificidade(sel.especificidade, melhor.sel.especificidade) > 0) {
          melhor = { sel, r };
        }
      }
      if (!melhor) continue;
      contagemPorRegra[indice] += 1;
      regrasDoElemento.push({
        indiceRegra: indice,
        seletor: melhor.sel.texto,
        regra: regra.seletor,
        linha: regra.linha,
        contexto: regra.contexto,
        especificidade: melhor.sel.especificidade,
        global: melhor.sel.global,
        estados: melhor.r.estados,
        pseudoElemento: melhor.r.pseudoElemento,
        naoAvaliados: melhor.r.naoAvaliados,
        declaracoes: regra.declaracoes,
      });
    }

    const estiloInline =
      el.atributos && typeof el.atributos.style === "string"
        ? extrairDeclaracoes(el.atributos.style)
        : [];

    el.css = { classes, regras: regrasDoElemento, inline: estiloInline };
  }

  const distintas = [...cacheClasses.values()];
  const contarOrigem = (origem) => distintas.filter((c) => c.origem === origem).length;

  return {
    tailwindConfig: {
      encontrado: tailwind.encontrado,
      linha: tailwind.linha,
      erro: tailwind.erro || null,
      totais: tailwind.totais,
      secoes: tailwind.secoes,
    },
    blocosStyle: blocosStyle.map((b) => ({
      linha: b.linha,
      totalRegras: regras.filter((r) => r.linhaBloco === b.linha).length,
    })),
    regras: regras.map((r, i) => ({ ...r, totalElementos: contagemPorRegra[i] })),
    classes: {
      distintas: distintas.length,
      tailwindConfig: contarOrigem("tailwind.config"),
      arbitrarias: contarOrigem("arbitrario"),
      padrao: contarOrigem("padrao"),
    },
    classesResolvidas: Object.fromEntries(
      distintas
        .filter((c) => c.origem !== "padrao")
        .map(({ classe, ...resto }) => [classe, resto]),
    ),
    elementosComStyleInline: elementos.filter((el) => el.css.inline.length).length,
  };
}

/**
 * Formata as declarações para leitura no console: `margin: 0; padding: 0`.
 */
function formatarDeclaracoes(declaracoes) {
  return declaracoes
    .map((d) => `${d.propriedade}: ${d.valor}${d.importante ? " !important" : ""}`)
    .join("; ");
}

/**
 * Gera as linhas de console que descrevem o CSS de um elemento.
 * @param {Object} css - `el.css` produzido por {@link mapearCss}.
 * @param {string} [recuo] - Recuo de cada linha.
 * @returns {string[]} Linhas prontas para imprimir.
 */
function descreverCssElemento(css, recuo = "      ") {
  if (!css) return [];
  const linhas = [];
  const doConfig = css.classes.filter((c) => c.origem === "tailwind.config");
  const arbitrarias = css.classes.filter((c) => c.origem === "arbitrario");
  const padrao = css.classes.filter((c) => c.origem === "padrao");
  const regras = css.regras.filter((r) => !r.global);

  if (!css.classes.length && !regras.length && !css.inline.length) {
    return [`${recuo}CSS: nenhuma classe, regra de <style> ou style inline`];
  }

  linhas.push(
    `${recuo}CSS: ${css.classes.length} classes (${doConfig.length} do tailwind.config, ${arbitrarias.length} arbitrárias, ${padrao.length} sem token no config)`,
  );

  for (const c of [...doConfig, ...arbitrarias]) {
    const estado = c.variantes.length ? ` [${c.variantes.join(":")}]` : "";
    const nota = c.observacao ? ` (${c.observacao})` : "";
    const fonte =
      c.origem === "tailwind.config"
        ? `${c.secao} "${c.token}", L${c.linhaToken ?? "?"}`
        : "valor arbitrário";
    linhas.push(`${recuo}  ${c.classe} -> ${formatarDeclaracoes(c.declaracoes)}${nota}${estado} (${fonte})`);
  }

  if (padrao.length) {
    linhas.push(`${recuo}  sem token no config: ${padrao.map((c) => c.classe).join(" ")}`);
  }

  for (const r of regras) {
    const extras = [
      `L${r.linha}`,
      ...r.contexto,
      ...(r.estados.length ? [`estado :${r.estados.join(", :")}`] : []),
      ...(r.pseudoElemento ? [`::${r.pseudoElemento}`] : []),
    ].join(", ");
    linhas.push(`${recuo}  <style> ${r.seletor} (${extras}) -> ${formatarDeclaracoes(r.declaracoes)}`);
  }

  if (css.inline.length) {
    linhas.push(`${recuo}  style="" -> ${formatarDeclaracoes(css.inline)}`);
  }

  return linhas;
}

// --- Exportação e Persistência em JSON

/**
 * Salva um objeto serializado em formato JSON com indentação de 2 espaços
 * em uma pasta especificada (padrão: "output").
 * @param {string} nomeArquivo - Nome do arquivo JSON de destino (ex.: "code.json").
 * @param {Object} dados - Objeto a ser serializado.
 * @param {string} [pasta="output"] - Subpasta onde o arquivo será salvo.
 * @returns {Promise<string>} O caminho absoluto do arquivo salvo.
 */
async function salvarResultadoJson(nomeArquivo, dados, pasta = "output") {
  const pastaOutput = path.isAbsolute(pasta)
    ? pasta
    : path.join(__dirname, pasta);

  await mkdir(pastaOutput, { recursive: true });
  const caminhoFinal = path.join(pastaOutput, nomeArquivo);
  const conteudoJson = JSON.stringify(dados, null, 2);
  await writeFile(caminhoFinal, conteudoJson, "utf8");
  return caminhoFinal;
}

/**
 * Processa um arquivo HTML de ponta a ponta: localiza tags, valida a estrutura,
 * mapeia elementos, analisa scripts, vincula eventos com código completo e opcionalmente
 * salva o resultado em JSON na pasta de saída informada.
 * @param {string} caminhoArquivo - Caminho para o arquivo HTML a ser processado.
 * @param {{ salvarJson?: boolean, pastaOutput?: string }} [opcoes] - Opções de processamento.
 * @returns {Promise<Object>} Resultado consolidado do processamento.
 */
async function processarHtml(
  caminhoArquivo,
  { salvarJson = true, pastaOutput = "output" } = {},
) {
  const caminhoResolvido = path.isAbsolute(caminhoArquivo)
    ? caminhoArquivo
    : path.join(__dirname, caminhoArquivo);

  const html = await readFile(caminhoResolvido, "utf8");
  const nomeArquivo = path.basename(caminhoResolvido);

  const tags = localizarTags(html);
  const validacao = validarEstrutura(tags);
  const elementos = mapearElementos(tags, html);
  const analiseScripts = analisarScripts(elementos);
  const associacao = associarEventos(elementos, analiseScripts);
  const css = mapearCss(elementos, html);
  const relatorio = gerarRelatorioInteratividade(
    elementos,
    analiseScripts,
    associacao,
  );

  const resultado = {
    arquivo: nomeArquivo,
    caminhoOrigem: caminhoResolvido,
    geradoEm: new Date().toISOString(),
    estatisticas: {
      tamanhoBytes: Buffer.byteLength(html, "utf8"),
      totalTags: tags.length,
      totalElementos: elementos.length,
      totalElementosInterativos: relatorio.totalInterativos,
      elementosComEventos: relatorio.totalComEventos,
      totalEventosMapeados: relatorio.vinculosRealizados.length,
    },
    validacao: {
      valido: validacao.valido,
      totalErros: validacao.totalErros,
      totalAvisos: validacao.totalAvisos,
      erros: validacao.erros,
      avisos: validacao.avisos,
    },
    interatividade: {
      totalVinculos: relatorio.vinculosRealizados.length,
      vinculos: relatorio.vinculosRealizados,
      seletoresNaoEncontrados: relatorio.seletoresNaoEncontrados,
      interativosSemEventos: relatorio.interativosSemEventos,
    },
    css: {
      tailwindConfig: css.tailwindConfig,
      blocosStyle: css.blocosStyle,
      regras: css.regras,
      classes: css.classes,
      classesResolvidas: css.classesResolvidas,
      elementosComStyleInline: css.elementosComStyleInline,
    },
    elementosComEventos: relatorio.comEventos,
    elementos: elementos.map((el) => ({
      nome: el.nome,
      id: el.id,
      classes: el.classes,
      linha: el.linha,
      coluna: el.coluna,
      inicio: el.inicio,
      fim: el.fim,
      vazio: el.vazio,
      atributos: el.atributos,
      eventos: el.eventos,
      // Versão enxuta: as classes resolvidas ficam uma vez só em css.classesResolvidas
      css: {
        regras: el.css.regras.map((r) => ({
          indiceRegra: r.indiceRegra,
          seletor: r.seletor,
          linha: r.linha,
          global: r.global,
          estados: r.estados,
          pseudoElemento: r.pseudoElemento,
        })),
        inline: el.css.inline,
      },
      texto: el.texto,
    })),
  };

  if (salvarJson) {
    const nomeBase = path.basename(caminhoResolvido, path.extname(caminhoResolvido));
    await salvarResultadoJson(`${nomeBase}.json`, resultado, pastaOutput);
  }

  return {
    html,
    tags,
    elementos,
    validacao,
    analiseScripts,
    associacao,
    css,
    relatorio,
    resultado,
  };
}

// --- Funções Didáticas e de Demonstração (Compatibilidade)

/**
 * Lê o `index.html` e registra no console o tamanho e o conteúdo completo.
 * @async
 * @returns {Promise<void>}
 */
async function lerHtml() {
  const caminhoHtml = path.join(__dirname, "index.html");
  const html = await readFile(caminhoHtml, "utf8");
  console.log(html.length);
  console.log("Conteúdo de index.html:", html);
}

/**
 * Demonstra iteração sobre a string do HTML: array de caracteres (spread),
 * quebra por ", " (split) e uma busca com `find`.
 * @async
 * @returns {Promise<void>}
 */
async function percorrerHtml() {
  const caminhoHtml = path.join(__dirname, "index.html");
  const html = await readFile(caminhoHtml, "utf8");

  const caracteres = [...html];
  const partes = html.split(", ");
  console.log(partes[1]);

  const pedacoComTbody = partes.find((pedaco) => pedaco.includes("tbody"));
  console.log("Achou 'tbody'?", pedacoComTbody !== undefined);

  caracteres.forEach(() => {});
}

/**
 * Lê o `code.html`, mapeia tags, elementos e imprime o primeiro bloco `<header>`.
 * Executa também a validação estrutural, a correlação de eventos com mapeamento completo
 * e salva o resultado JSON na pasta `output/`.
 * @param {string} [arquivo="code.html"] - Nome do arquivo HTML a ser processado.
 * @async
 * @returns {Promise<Tag[]>} A lista de tags extraídas do HTML.
 */
async function mapearTags(arquivo = "code.html") {
  const caminhoHtml = path.isAbsolute(arquivo)
    ? arquivo
    : path.join(__dirname, arquivo);

  const linhas = [];
  const log = (texto = "") => {
    console.log(texto);
    linhas.push(texto);
  };

  const { html, tags, elementos, validacao, css, relatorio, resultado } =
    await processarHtml(caminhoHtml, { salvarJson: true });

  const header = buscarElementoPorNome(elementos, "header");

  if (!header) {
    log("Nenhum elemento <header> completo foi encontrado.");
  } else {
    log(`Primeiro <header> (intervalo ${header.inicio}-${header.fim}):`);
    log(header.texto);
  }

  log("\n--- Análise e Mapeamento Completo de Eventos ---");
  log(`Tags: ${tags.length} | Elementos: ${elementos.length}`);
  log(
    `Estrutura válida: ${validacao.valido ? "Sim (0 erros)" : `Não (${validacao.totalErros} erros)`}`,
  );

  const tw = css.tailwindConfig;
  if (tw.encontrado && !tw.erro) {
    const secoes = Object.entries(tw.totais)
      .map(([nome, total]) => `${nome} ${total}`)
      .join(" · ");
    log(`tailwind.config: L${tw.linha} | ${secoes}`);
  } else if (tw.erro) {
    log(`tailwind.config: L${tw.linha} (não foi possível ler: ${tw.erro})`);
  } else {
    log("tailwind.config: não encontrado");
  }
  const regrasStyle = css.regras.filter((r) => r.tipo === "regra");
  log(
    `Blocos <style>: ${css.blocosStyle.length}${css.blocosStyle.length ? ` (${css.blocosStyle.map((b) => `L${b.linha}`).join(", ")})` : ""} | regras: ${regrasStyle.length}`,
  );
  for (const r of regrasStyle) {
    const ctx = r.contexto.length ? `, ${r.contexto.join(", ")}` : "";
    const alcance = r.seletores.every((sel) => ehSeletorGlobal(analisarSeletor(sel)))
      ? "todos os elementos"
      : `${r.totalElementos} elemento${r.totalElementos === 1 ? "" : "s"}`;
    log(`  - ${r.seletor} (L${r.linha}${ctx}) -> ${alcance}: ${formatarDeclaracoes(r.declaracoes)}`);
  }
  log(
    `Classes distintas: ${css.classes.distintas} | do tailwind.config: ${css.classes.tailwindConfig} | arbitrárias: ${css.classes.arbitrarias} | sem token no config: ${css.classes.padrao}`,
  );
  if (css.elementosComStyleInline) {
    log(`Elementos com style inline: ${css.elementosComStyleInline}`);
  }

  log(`Elementos com eventos mapeados: ${relatorio.comEventos.length}`);

  for (const item of relatorio.comEventos) {
    for (const ev of item.eventos) {
      const codigoLimpo = ev.codigo.replace(/\s+/g, " ");
      const resumoCodigo =
        codigoLimpo.length > 55 ? `${codigoLimpo.slice(0, 52)}...` : codigoLimpo;
      const linhaHandler =
        ev.posicao && ev.posicao.scriptInicio !== undefined
          ? calcularLinhaColuna(html, ev.posicao.scriptInicio).linha
          : item.linha;
      log(
        `  - <${item.tag}${item.id ? ` id="${item.id}"` : ""}> (L${item.linha}) -> [${ev.evento}] handler L${linhaHandler} via ${ev.origem} (${ev.tipoManipulador}): "${resumoCodigo}"`,
      );
    }
    for (const linha of descreverCssElemento(item.css)) log(linha);
  }

  // Salva também output/resultado.json como espelho padrão
  await salvarResultadoJson("resultado.json", resultado);

  // Também processa e salva index.html na pasta output se existir
  const caminhoIndex = path.join(__dirname, "index.html");
  try {
    await processarHtml(caminhoIndex, { salvarJson: true });
  } catch {
    // Silencioso se index.html não existir
  }

  log(
    `\n[JSON Exportado] Arquivos salvos com sucesso na pasta output/ (code.json, index.json, resultado.json).`,
  );

  const nomeBase = path.basename(caminhoHtml, path.extname(caminhoHtml));
  const caminhoTxt = path.join(__dirname, "output", `${nomeBase}.txt`);
  await writeFile(caminhoTxt, linhas.join("\n") + "\n", "utf8");
  console.log(`[TXT Exportado] ${caminhoTxt}`);

  return tags;
}

// --- Ponto de Entrada / Execução Principal

if (require.main === module) {
  mapearTags().catch((erro) => {
    console.error("Não foi possível processar code.html:", erro.message);
  });
}

// --- Exportações do Módulo

module.exports = {
  ELEMENTOS_VAZIOS,
  calcularLinhaColuna,
  limparAspas,
  extrairAtributos,
  localizarTags,
  validarEstrutura,
  criarIntervalos,
  filtrarPorNome,
  mapearElementos,
  buscarElementoPorNome,
  buscarTodosPorNome,
  buscarPorId,
  buscarPorClasse,
  buscarPorAtributo,
  extrairIds,
  extrairIdsConsultados,
  extrairArgumentosChamada,
  detalharManipulador,
  analisarScripts,
  associarEventos,
  gerarRelatorioInteratividade,
  extrairTailwindConfig,
  separarVariantes,
  resolverClasseTailwind,
  extrairDeclaracoes,
  extrairRegrasCss,
  analisarSeletor,
  calcularEspecificidade,
  construirArvore,
  casarSeletor,
  mapearCss,
  descreverCssElemento,
  salvarResultadoJson,
  processarHtml,
  lerHtml,
  percorrerHtml,
  mapearTags,
};
