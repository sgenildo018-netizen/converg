const { readFile } = require("node:fs/promises");
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
 * @property {string} codigo - Código JavaScript inline no atributo.
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
 * @typedef {Object} ListenerJS
 * @property {string} evento - Tipo de evento ouvido (ex.: "click", "submit").
 * @property {string | null} seletor - Seletor CSS ou ID consultado (ex.: "#botao-contador").
 * @property {"id" | "class" | "tag" | "complexo" | "desconhecido"} tipoSeletor - Categoria do seletor.
 * @property {string | null} argumentoOriginal - Argumento original passado à chamada DOM.
 * @property {string | null} variavel - Nome da variável associada ao elemento (se houver).
 * @property {string | null} metodo - Método DOM utilizado (ex.: "querySelector", "getElementById").
 * @property {string} origem - Identificador do padrão ("addEventListenerVariavel", "addEventListenerDireto", "propriedadeOn").
 * @property {number} scriptInicio - Offset de início do ouvinte no código.
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
 * @property {ListenerJS[]} eventosJS - Ouvintes de eventos JavaScript vinculados via scripts.
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

      // Procura tag de abertura correspondente descendo a pilha
      let idx = pilha.length - 1;
      while (idx >= 0 && pilha[idx].nome !== tag.nome) {
        idx--;
      }

      if (idx === -1) {
        // Tag não existe na pilha: fechamento órfão
        erros.push({
          tipo: "fechamento_orfa",
          mensagem: `Tag de fechamento </${tag.nome}> não possui tag de abertura correspondente na pilha atual (esperava-se </${topo.nome}>).`,
          tag,
          linha: tag.linha,
          coluna: tag.coluna,
        });
      } else {
        // Fechamento cruzado: tags intermediárias não foram fechadas antes desta
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

  // Tags remanescentes na pilha nunca foram fechadas
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

// --- Análise Estática de JavaScript e Associação com Elementos

/**
 * Analisa blocos `<script>` para descobrir variáveis associadas a elementos DOM
 * e chamadas a `addEventListener` ou propriedades de evento (`onclick`).
 * @param {Elemento[]} elementos - Elementos mapeados do HTML.
 * @returns {{ scriptsAnalisados: number, variaveisDeclaradas: Array<Object>, listeners: ListenerJS[] }}
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
    // document.querySelector(...).addEventListener("click", ...)
    const regexListenerDireto =
      /document\.(querySelector(?:All)?|getElementById|getElementsByClassName|getElementsByTagName)\s*\(\s*(["'`])([^"'`]+)\2\s*\)\.addEventListener\s*\(\s*(["'`])([^"'`]+)\4/g;
    while ((match = regexListenerDireto.exec(codigoJs)) !== null) {
      const [, metodo, , argumento, , evento] = match;
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

      listeners.push({
        evento,
        seletor: seletorFormatado,
        tipoSeletor,
        argumentoOriginal: argumento,
        variavel: null,
        metodo,
        origem: "addEventListenerDireto",
        scriptInicio: scriptEl.inicioConteudo + match.index,
      });
    }

    // 3. addEventListener através de variável:
    // botao.addEventListener("click", ...)
    const regexListenerVar =
      /([a-zA-Z_$][\w$]*)\.addEventListener\s*\(\s*(["'`])([^"'`]+)\2/g;
    while ((match = regexListenerVar.exec(codigoJs)) !== null) {
      const [, nomeVar, , evento] = match;
      if (variaveisLocais.has(nomeVar)) {
        const varInfo = variaveisLocais.get(nomeVar);
        listeners.push({
          evento,
          seletor: varInfo.seletor,
          tipoSeletor: varInfo.tipoSeletor,
          argumentoOriginal: varInfo.argumento,
          variavel: nomeVar,
          metodo: varInfo.metodo,
          origem: "addEventListenerVariavel",
          scriptInicio: scriptEl.inicioConteudo + match.index,
        });
      } else {
        listeners.push({
          evento,
          seletor: null,
          tipoSeletor: "desconhecido",
          argumentoOriginal: null,
          variavel: nomeVar,
          metodo: null,
          origem: "addEventListenerVariavelDesconhecida",
          scriptInicio: scriptEl.inicioConteudo + match.index,
        });
      }
    }

    // 4. Atribuição de propriedades on...:
    // botao.onclick = ...
    const regexPropriedadeOn = /([a-zA-Z_$][\w$]*)\.(on[a-zA-Z]+)\s*=/g;
    while ((match = regexPropriedadeOn.exec(codigoJs)) !== null) {
      const [, nomeVar, prop] = match;
      const evento = prop.slice(2).toLowerCase();
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
 * Associa os ouvintes de eventos extraídos dos scripts aos elementos correspondentes
 * na lista de elementos mapeados do HTML.
 * @param {Elemento[]} elementos - Lista de elementos mapeados.
 * @param {{ listeners: ListenerJS[] }} analiseScripts - Resultado de `analisarScripts`.
 * @returns {{ vinculos: Array<Object>, seletoresNaoEncontrados: ListenerJS[] }}
 */
function associarEventos(elementos, analiseScripts) {
  const vinculos = [];
  const seletoresNaoEncontrados = [];

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
        el.eventosJS.push(listener);
        vinculos.push({
          elemento: `<${el.nome}${el.id ? ` id="${el.id}"` : ""}>`,
          linha: el.linha,
          evento: listener.evento,
          seletor: listener.seletor,
          variavel: listener.variavel,
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
 * Gera um relatório consolidado da interatividade da página, cruzando
 * elementos interativos (botões, links, formulários), eventos inline e listeners JS.
 * @param {Elemento[]} elementos - Elementos mapeados.
 * @param {ReturnType<typeof analisarScripts>} analiseScripts - Análise dos scripts.
 * @returns {Object} Relatório estruturado de interatividade.
 */
function gerarRelatorioInteratividade(elementos, analiseScripts) {
  const associacao = associarEventos(elementos, analiseScripts);
  const elementosInterativos = elementos.filter((el) =>
    ["button", "a", "input", "select", "textarea", "form"].includes(el.nome) ||
    el.eventosInline.length > 0 ||
    el.eventosJS.length > 0
  );

  const comEventos = elementos.filter(
    (el) => el.eventosInline.length > 0 || el.eventosJS.length > 0,
  );

  const interativosSemEventos = elementosInterativos.filter(
    (el) => el.eventosInline.length === 0 && el.eventosJS.length === 0,
  );

  return {
    totalElementos: elementos.length,
    totalInterativos: elementosInterativos.length,
    comEventos: comEventos.map((el) => ({
      tag: el.nome,
      id: el.id,
      linha: el.linha,
      eventosInline: el.eventosInline.map((ev) => ev.evento),
      eventosJS: el.eventosJS.map((ev) => `${ev.evento} (${ev.seletor})`),
    })),
    interativosSemEventos: interativosSemEventos.map((el) => ({
      tag: el.nome,
      id: el.id,
      linha: el.linha,
    })),
    vinculosRealizados: associacao.vinculos,
    seletoresNaoEncontrados: associacao.seletoresNaoEncontrados,
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
 * Executa também a validação estrutural e a correlação de eventos JavaScript.
 * @async
 * @returns {Promise<Tag[]>} A lista de tags extraídas do HTML.
 */
async function mapearTags() {
  const caminhoHtml = path.join(__dirname, "code.html");
  const html = await readFile(caminhoHtml, "utf8");

  const tags = localizarTags(html);
  const elementos = mapearElementos(tags, html);
  const header = buscarElementoPorNome(elementos, "header");

  if (!header) {
    console.log("Nenhum elemento <header> completo foi encontrado.");
    return tags;
  }

  console.log(`Primeiro <header> (intervalo ${header.inicio}-${header.fim}):`);
  console.log(header.texto);

  const validacao = validarEstrutura(tags);
  const analiseScripts = analisarScripts(elementos);
  const associacao = associarEventos(elementos, analiseScripts);

  console.log("\n--- Análise e Validação do Documento ---");
  console.log(`Tags: ${tags.length} | Elementos: ${elementos.length}`);
  console.log(`Estrutura válida: ${validacao.valido ? "Sim (0 erros)" : `Não (${validacao.totalErros} erros)`}`);
  console.log(`Listeners JS vinculados: ${associacao.vinculos.length}`);
  for (const v of associacao.vinculos) {
    console.log(`  - ${v.elemento} -> evento '${v.evento}' via ${v.variavel ? `var '${v.variavel}'` : v.seletor}`);
  }

  const comOnclick = buscarPorAtributo(elementos, "onclick");
  if (comOnclick.length > 0) {
    console.log(`Elementos com onclick inline: ${comOnclick.length}`);
    for (const el of comOnclick) {
      console.log(`  - <${el.nome}${el.id ? ` id="${el.id}"` : ""}> (linha ${el.linha})`);
    }
  }

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
  analisarScripts,
  associarEventos,
  gerarRelatorioInteratividade,
  lerHtml,
  percorrerHtml,
  mapearTags,
};
