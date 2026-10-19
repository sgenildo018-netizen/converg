const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");

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

  const { html, tags, elementos, validacao, relatorio, resultado } =
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
  salvarResultadoJson,
  processarHtml,
  lerHtml,
  percorrerHtml,
  mapearTags,
};
