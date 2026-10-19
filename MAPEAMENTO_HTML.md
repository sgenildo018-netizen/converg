# Experimento: mapear HTML sem dependências

Este documento descreve a arquitetura e os experimentos implementados em `script.js`: ler um arquivo HTML como texto, localizar tags com precisão posicional, calcular seus intervalos `[inicio, fim)`, validar a integridade estrutural, interpretar atributos, **mapear detalhadamente os eventos** (tipo de evento, manipulador, parâmetros, código-fonte e opções), **ligar a cada elemento o CSS que ele usa** (classes do `tailwind.config`, regras de `<style>` e style inline) e **exportar o resultado estruturado em arquivos JSON na pasta `output/`**, sem utilizar qualquer biblioteca externa ou parser pesado.

## Objetivo

Extrair trechos do HTML original — como blocos `<header>`, `<main>`, botões e `<script>` — preservando estritamente os caracteres, espaçamentos, indentação e quebras de linha do arquivo de origem. Ao operar diretamente com offsets (`String.prototype.slice`), o código dispensa ferramentas de serialização que reformatam a árvore sintática, mantendo a fidelidade total do texto.

Além da extração textual, o objetivo é correlacionar o DOM estático com as rotinas interativas em JavaScript, mapeando tanto manipuladores inline (`onclick`, etc.) quanto ouvintes registrados dinamicamente (`addEventListener`, propriedades `on...`), persistindo a análise completa em arquivos JSON estruturados.

---

## Fluxo do Mapeamento

```
[HTML como String] 
       │
       ▼
 1. Localização Posicional (localizarTags)
    - Ignora comentários <!-- ... -->
    - Preserva tags raw-text (script/style)
    - Suporta '>' dentro de aspas
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
 2. Validação Estrutural (validarEstrutura)    3. Mapeamento de Elementos (mapearElementos)
    - Detecta tags não fechadas                   - Casamento por pilha LIFO
    - Detecta fechamentos órfãos                  - Extração de atributos (id, class, inline on...)
    - Detecta fechamentos cruzados                - Recortes exatos de texto e conteúdo
       │                                         │
       └────────────────────┬────────────────────┘
                            ▼
 4. Análise Estática de JS (analisarScripts)
    - Captura variáveis e seletores (querySelector, getElementById, etc.)
    - Analisa chamadas addEventListener e extrai argumentos
    - Detalha manipuladores (código, parâmetros, tipo de função)
                            │
                            ▼
 5. Mapeamento e Vínculo de Eventos (associarEventos)
    - Conecta ouvintes JS e eventos inline aos elementos HTML mapeados
    - Mapeia o código-fonte integral de cada handler
    - Audita seletores não encontrados no documento
                            │
                            ▼
 6. Mapeamento de CSS (mapearCss)
    - Resolve classes Tailwind pelos tokens do tailwind.config (com a linha do token)
    - Casa regras dos blocos <style> com os elementos (combinadores e pseudo-classes)
    - Lê o atributo style de cada elemento
                            │
                            ▼
 7. Exportação em JSON (salvarResultadoJson / processarHtml)
    - Gera arquivos estruturados na pasta output/ (code.json, index.json, resultado.json)
```

---

### 1. Ler o Arquivo

`readFile(caminhoHtml, "utf8")` (`node:fs/promises`) lê o arquivo como string sem executar qualquer código embutido:

```js
const html = await readFile(caminhoHtml, "utf8");
```

---

### 2. Localizar as Tags (`localizarTags`)

Diferente de expressões regulares simplificadas que falham quando encontram atributos como `title="a > b"` ou blocos internos de script, `localizarTags()` implementa um tokenizer com regras específicas:

1. **Comentários HTML (`<!-- ... -->`)**: o conteúdo interno é ignorado, evitando falsos positivos com tags comentadas.
2. **Atributos entre aspas**: respeita delimitadores de aspas duplas (`"..."`) e simples (`'...'`), assegurando que caracteres `>` em expressões ou valores textuais não fechem a tag precocemente.
3. **Tags raw-text (`<script>` e `<style>`)**: seu miolo é tratado como texto bruto até a respectiva tag de fechamento (`</script>` ou `</style>`), evitando que trechos de código (como `<span ...>` em template strings ou comparações `i < len`) sejam interpretados como elementos DOM.
4. **Coordenadas**: calcula a posição de início e fim, além do número da linha e da coluna base 1 (`calcularLinhaColuna`).

---

### 3. Interpretação de Atributos (`extrairAtributos`)

Cada tag de abertura é analisada para estruturar:

* `id`: valor normalizado do identificador único (se houver);
* `classes`: array de classes CSS divididas por espaço em branco;
* `eventosInline`: lista de handlers inline iniciados com `on` (como `onclick`, `onchange`), separando o nome do evento, parâmetros implícitos (`["event"]`) e o código JS literal;
* `todos`: dicionário com todos os atributos encontrados (com suporte a atributos booleanos como `disabled` ou `required`).

---

### 4. Validação Estrutural (`validarEstrutura`)

Antes ou em conjunto com a montagem dos elementos, `validarEstrutura()` percorre as tags com uma pilha e avalia a conformidade hierárquica do documento:

* **Tags vazias (Void Elements)**: tags como `<br>`, `<img>`, `<input>`, `<meta>` e `<link>` não exigem fechamento. Se uma tag `</input>` for encontrada, um aviso (`fechamento_elemento_vazio`) é registrado.
* **Fechamentos órfãos (`fechamento_orfa`)**: tags de fechamento cujo par de abertura nunca existiu na pilha.
* **Fechamentos cruzados (`fechamento_cruzado`)**: fechamento fora de ordem, como `<b><i></b></i>`, indicando que tags filhas não foram fechadas antes da mãe.
* **Tags não fechadas (`tag_nao_fechada`)**: tags de abertura restantes na pilha ao final do arquivo.

O validador retorna um relatório com `valido: boolean`, `totalErros`, `totalAvisos`, `erros` e `avisos`, informando linha e coluna exatas de cada ocorrência.

---

### 5. Associação e Montagem de Elementos (`mapearElementos`)

`mapearElementos()` associa pares de abertura e fechamento mantendo a integridade textual:

```js
{
  nome: "header",
  inicio: 27332,
  fim: 31324,
  inicioConteudo: 27552,
  fimConteudo: 31315,
  linha: 382,
  coluna: 13,
  texto: "<header ...>...</header>",
  conteudo: "\n  ...",
  atributos: { class: "fixed ...", ... },
  id: "...",
  classes: ["fixed", "top-0", ...],
  eventosInline: [],
  eventosJS: [],
  eventos: [],
  vazio: false
}
```

* **Elementos vazios**: podem ser opcionalmente incluídos (`incluirVazios: true`), viabilizando a busca e vinculação de elementos interativos como `<input id="endpoint-input">`.
* **Sem re-serialização**: `texto` e `conteudo` provêm de `html.slice()`, garantindo que toda a indentação original seja conservada.

---

### 6. Mapeamento Detalhado de Eventos (`analisarScripts` e `associarEventos`)

Em vez de registrar apenas o nome do evento (como `"click"`), o analisador disseca a chamada e mapeia o manipulador completo:

1. **Parser de Argumentos de Chamada (`extrairArgumentosChamada`)**:
   Rastreia balanceamento de parênteses `()`, chaves `{}`, colchetes `[]`, comentários e template literals complexos para isolar cada argumento de `.addEventListener(tipo, handler, opcoes)`.
2. **Detalhamento do Manipulador (`detalharManipulador`)**:
   Classifica e decompõe a função receptora:
   * **Arrow Functions**: identifica parâmetros formais (ex.: `(evt, target) => ...` ou `e => ...`) e extrai o corpo integral da função.
   * **Funções Tradicionais**: identifica se é anônima ou nomeada (`function aoClicar(e)`), mapeia parâmetros e preserva o código.
   * **Referências**: identifica funções passadas por identificador (ex.: `handleClick`, `controller.onPress`).
   * **Opções**: preserva o terceiro argumento passado ao ouvinte (ex.: `{ once: true }` ou `false`).
3. **Manipuladores Inline**:
   Extrai o código fonte do atributo `onclick="..."`, registrando `tipoManipulador: "inline"` e parâmetros disponíveis (`["event"]`).
4. **Objeto do Evento Mapeado**:
   Cada evento associado a um elemento contém:

```json
{
  "evento": "click",
  "origem": "addEventListenerVariavel",
  "tipoManipulador": "arrow_function",
  "nomeFuncao": null,
  "parametros": [],
  "codigo": "() => {\n    const val = inputEl.value.trim() || \"/api/v1/fallback\";\n    ...\n}",
  "opcoes": null,
  "seletor": "#btn-run-test",
  "variavel": "btnRun",
  "metodo": "getElementById"
}
```

5. **Auditoria de Interatividade (`gerarRelatorioInteratividade`)**:
   Cruza elementos interativos (`button`, `a`, `input`, etc.) indicando quais possuem eventos mapeados, quais estão sem ouvintes configurados e se há seletores órfãos no script.

---

### 7. Mapeamento de CSS (`mapearCss`)

Depois dos eventos, o pipeline liga a cada elemento o CSS que ele usa, vindo de três fontes. O resultado fica em `el.css = { classes, regras, inline, avisos }`.

**a) Classes Tailwind resolvidas pelo `tailwind.config`** (`extrairTailwindConfig` e `resolverClasseTailwind`)

* Procura `tailwind.config = {...}` nos `<script>`, recorta o objeto com contagem de chaves e o avalia com `node:vm` num contexto vazio (não é sandbox de segurança).
* Lê `theme` e `theme.extend`. Cada token guarda `valor`, `linha` (onde a chave foi escrita no HTML) e `origem` (`"theme"` ou `"extend"`). Cores aninhadas viram nomes de classe: `brand: { DEFAULT, 500 }` → `brand`, `brand-500`.
* Cada classe é separada em variantes (`md:hover:`), `!` (important), `-` (negativo) e utilitário. O prefixo do utilitário (`bg`, `text`, `px`, `rounded-t`...) indica a seção do tema e as propriedades CSS geradas. Prefixos mais longos são testados primeiro.
* Opacidade de cor (`bg-primary/20`) vira `rgba(...)`. Valores arbitrários (`w-[42%]`, `text-[16px]`, `shadow-[...]`) são resolvidos pelo próprio texto; em prefixos ambíguos (`text-[...]`), valor com cara de cor vira `color`, o resto vira `font-size`.
* `origem` de cada classe: `"tailwind.config"`, `"arbitrario"` ou `"padrao"` (sem token no config; a escala padrão do Tailwind não é reproduzida).

**b) Regras dos blocos `<style>`** (`extrairRegrasCss`, `analisarSeletor`, `casarSeletor`)

* Parser de CSS próprio: troca comentários por espaços (mantém offsets), lê regras com a linha no HTML original e entra em `@media`, `@layer`, `@supports` e `@container` guardando o contexto. `@keyframes` e `@font-face` são listados como `tipo: "at-rule"`.
* Cada seletor é dividido em partes compostas e combinadores (` `, `>`, `+`, `~`) e testado da direita para a esquerda sobre a árvore montada por `construirArvore` (pai, filhos e irmãos a partir dos intervalos).
* Suporta tag, `*`, `#id`, `.classe`, `[atributo]` com `=`, `~=`, `|=`, `^=`, `$=`, `*=`, pseudo-classes estruturais (`:first-child`, `:last-child`, `:nth-child(an+b)`, `:*-of-type`, `:not`, `:is`, `:where`, `:root`, `:empty`).
* Estados dinâmicos (`:hover`, `:focus`, `:active`...) não dá para avaliar num arquivo estático: o elemento casa e o estado fica anotado em `estados`. Pseudo-elementos ficam em `pseudoElemento`. Seletores que valem para qualquer elemento (`*`, `::-webkit-scrollbar`) são marcados `global`.
* Cada regra casada traz `especificidade` `[ids, classes, tags]`.

**c) Atributo `style`** (`extrairDeclaracoes`)

* Divide as declarações por `;` no nível superior (respeita `url(a;b)`), normaliza o nome da propriedade em minúsculas e separa `!important`.

**d) Arquivos externos** (`extrairRecursosExternos`)

* Lista `<link rel="stylesheet">`, `@import` dentro de `<style>` e `<script src>`, cada um com `linha`, `local` (`head`, `body` ou `style`) e `remoto`. O conteúdo desses arquivos não é lido.
* Tipos de estilo: `estilo`; `fonte` (Google Fonts só com fontes); `icones` (Google Fonts de `Material Symbols`/`Material Icons`, com a classe que definem em `classes`). Tipos de script: `script` e `tailwind-cdn`.
* `el.css.avisos`: para cada classe sem CSS no arquivo (origem `padrao` e nenhum seletor de `<style>` a cita), aponta os arquivos de tipo `estilo` (`motivo: "sem-css-no-arquivo"`, com `tambemTailwind` se a página usa Tailwind). Classes de ícones apontam o link que as define (`motivo: "icones"`).
* `el.avisoScripts`: elemento interativo sem evento mapeado recebe os scripts locais que não são o Tailwind CDN, onde o evento pode estar.

**Saída no console:** um resumo do CSS (config, regras e contagem de classes) e, embaixo de cada elemento com evento, as classes resolvidas com a linha do token, as regras de `<style>` que casam e o style inline (`descreverCssElemento`).

---

### 7b. Modo Foco (`analisarFoco` e `node script.js --foco <seletor>`)

Restringe a análise a um elemento e seus descendentes, para quem quer extrair um bloco como componente.

* O seletor é resolvido pelo mesmo casamento de CSS (`analisarSeletor` / `casarSeletor`): tag, `#id`, `.classe`, compostos como `main .card`. Se vários casarem, o foco é o 1º e o total é informado. Sem resultado, erro claro.
* Entram no escopo os elementos e tags cujo intervalo `[inicio, fim)` está dentro do elemento foco. A validação estrutural roda só sobre essas tags.
* Scripts e `<style>` continuam vindo do arquivo inteiro: um `addEventListener` escrito fora do bloco ainda é ligado ao elemento de dentro, com a linha do handler.
* Regras de CSS são contadas por quantos elementos **do foco** atingem; classes distintas são só as do bloco; elementos interativos sem evento do bloco são listados com o CSS de cada um.
* Saída em `output/<arquivo>.foco-<seletor>.txt` (o `code.txt` padrão não é tocado). O JSON continua com o arquivo inteiro.
* No fim, o **contrato do componente** (abaixo), também em `output/<arquivo>.foco-<seletor>.contrato.json` e `.contrato.md`.

### 7c. Contrato do Componente (`montarContrato` e `descreverContrato`)

Responde, sem deixar decisão para quem lê adivinhar: qual bloco é o alvo, o que ele usa e quais comportamentos estão ligados a ele. Tudo com métodos de string sobre o texto original.

* **`alvo`**: rótulo, seletor, linhas, offsets, total de elementos e o texto exato.
* **`usa`**: classes do bloco (com variantes e linha do token), regras de `<style>` que atingem o bloco (sem as globais), style inline, **`classesDoJs`** (classes que os handlers do bloco adicionam, removem ou alternam, com o alvo, as regras de `<style>` que citam a classe e o token do `tailwind.config` quando há), **`herdado`** (propriedades que herdam, como `color`, `font-*`, `line-height` e `--variáveis`, vindas dos ancestrais: o mais próximo primeiro, ignorando o que o próprio alvo já declara) e os arquivos externos que o bloco usa.
* **`comportamentos`**: um por evento de cada elemento do bloco. Linha de início e fim do handler (para handler por referência, a função onde foi escrita, com `acharFuncaoNomeada`), código inteiro, **`altera`** (`classList`, `textContent`, `innerHTML`, `value`, `className`, `style.x`, `setAttribute`...), **`consultaDentro`** / **`consultaFora`** (seletores e variáveis DOM usados no código, classificados pela posição do elemento) e **`apis`** (`navigator.*`, `window.*`, `localStorage`, `fetch`, `setTimeout`...). Comentários JS são trocados por espaços antes da leitura (`removerComentariosJs`), então código comentado não conta.
* **`pendencias`**: `classe-sem-css` (escala padrão do Tailwind ou nenhum CSS), `classe-em-arquivo-externo`, `classe-do-js-sem-css`, `dependencia-fora-do-bloco`, `seletor-sem-elemento`, `alvo-nao-resolvido`, `handler-nao-encontrado` e `interativo-sem-evento`.
* No console, o código de cada handler sai com as **linhas originais do arquivo, numeradas** (`L1788 | ...`), sem reformatar.
* **`.contrato.md`** (`contratoParaMarkdown`): título com o alvo, o texto do bloco num ` ```html ` idêntico ao arquivo, tabelas de classes, regras, classes do JS e CSS herdado, um ` ```js ` por handler com as linhas originais, e as pendências como checklist `- [ ]`. O `.md` usa a mesma quebra de linha do HTML de origem; tags no texto corrido vão entre crases (`textoMd`) para não virarem HTML ao renderizar, e as cercas de código crescem se o conteúdo tiver crases (`cercaMd`).

---

### 8. Exportação Estruturada em JSON (`salvarResultadoJson` e `processarHtml`)

O pipeline exporta os resultados da análise diretamente em arquivos JSON formatados com indentação na pasta `output/`:

* `output/code.json`: análise completa de `code.html`.
* `output/index.json`: análise completa de `index.html`.
* `output/resultado.json`: espelho do resultado principal.

#### Estrutura do JSON gerado:

```json
{
  "arquivo": "code.html",
  "caminhoOrigem": "...",
  "geradoEm": "2026-10-18T...",
  "estatisticas": {
    "tamanhoBytes": 112733,
    "totalTags": 1016,
    "totalElementos": 513,
    "totalElementosInterativos": 41,
    "elementosComEventos": 5,
    "totalEventosMapeados": 5
  },
  "validacao": {
    "valido": true,
    "totalErros": 0,
    "totalAvisos": 0,
    "erros": [],
    "avisos": []
  },
  "interatividade": {
    "totalVinculos": 5,
    "vinculos": [ ... ],
    "seletoresNaoEncontrados": [],
    "interativosSemEventos": [ ... ]
  },
  "externos": {
    "estilos": [ { "href": "https://fonts.googleapis.com/...", "tipo": "icones", "origem": "link", "local": "head", "remoto": true, "linha": 8, "classes": ["material-symbols-outlined"] } ],
    "scripts": [ { "src": "https://cdn.tailwindcss.com", "tipo": "tailwind-cdn", "local": "head", "remoto": true, "linha": 41 } ]
  },
  "css": {
    "tailwindConfig": { "encontrado": true, "linha": 43, "totais": { "colors": 47, ... }, "secoes": { ... } },
    "blocosStyle": [ { "linha": 20, "totalRegras": 5 } ],
    "regras": [ { "tipo": "regra", "seletor": "body", "linha": 27, "contexto": ["@layer base"], "declaracoes": [ ... ], "totalElementos": 1 } ],
    "classes": { "distintas": 244, "tailwindConfig": 89, "arbitrarias": 20, "padrao": 135 },
    "classesResolvidas": { "bg-primary": { "origem": "tailwind.config", "secao": "colors", "token": "primary", "linhaToken": 81, "declaracoes": [ ... ] } },
    "elementosComStyleInline": 0
  },
  "elementosComEventos": [
    {
      "tag": "button",
      "id": "btn-run-test",
      "linha": 1153,
      "coluna": 37,
      "totalEventos": 1,
      "eventos": [ ... ],
      "css": { "classes": [ ... ], "regras": [ ... ], "inline": [ ... ] }
    }
  ],
  "elementos": [ ... ]
}
```

Em `elementos`, o `css` de cada um é a versão enxuta (`regras`, `inline` e `avisos` com os arquivos a ler), e `avisoScripts` traz os scripts externos onde um evento pode estar; as classes resolvidas ficam uma vez só em `css.classesResolvidas`. Em `elementosComEventos`, o `css` vem completo.

---

### 9. Funções de Consulta Disponíveis

* `buscarElementoPorNome(elementos, nome)`: primeira ocorrência completa do elemento;
* `buscarTodosPorNome(elementos, nome)`: todos os elementos daquela tag;
* `buscarPorId(elementos, id)`: busca por identificador único (`id="meu-id"` ou `#meu-id`);
* `buscarPorClasse(elementos, classe)`: localiza elementos que possuam a classe especificada;
* `buscarPorAtributo(elementos, nomeAtributo, valorEsperado?)`: localiza elementos por chave e valor de atributo;
* `processarHtml(caminho, opcoes)`: executa todo o pipeline e gera o JSON na pasta `output/`;
* `salvarResultadoJson(nomeArquivo, dados, pasta)`: utilitário de persistência em disco;
* `analisarFoco(resultado, seletor)`: escopo restrito a um elemento e descendentes (tags, validação, eventos, CSS, interativos sem evento);
* `mapearCss(elementos, html)`: preenche `el.css` e devolve o resumo de CSS;
* `resolverClasseTailwind(classe, config)`: resolve uma classe isolada;
* `extrairRegrasCss(css, opcoes)`, `analisarSeletor(seletor)`, `casarSeletor(partes, el, arvore)`, `construirArvore(elementos)`: parser e casamento de CSS, reutilizáveis.

---

## Resultados nos Arquivos de Teste

### `code.html` (Dashboard Real Tailwind ~112 KB)
* **Tags**: 1.016 tags localizadas com sucesso.
* **Elementos**: 513 elementos mapeados.
* **Validação Estrutural**: **100% válido (0 erros)**.
* **Eventos Mapeados**:
  * `<button id="btn-run-test">` -> `click` via variável `btnRun` (`arrow_function` com 30+ linhas de simulação de endpoint);
  * `<button id="star-btn">` -> `click` via variável `starBtn` (`arrow_function` alternando estado `isStarred`);
  * `<button id="copy-link-btn">` -> `click` via variável `copyLinkBtn` (`arrow_function` com `navigator.clipboard.writeText`);
  * `<button>` (linha 902) -> `click` inline (`navigator.clipboard.writeText(...)` com remoção de classe hidden e `setTimeout`);
  * `<button>` (linha 1053) -> `click` inline (`navigator.clipboard.writeText(...)`).
* **Seletores Órfãos**: 0.
* **CSS**: `tailwind.config` na linha 43 (47 cores, 9 espaçamentos, 4 raios, 10 famílias e 10 tamanhos de fonte); 1 bloco `<style>` com 5 regras; 244 classes distintas, 89 resolvidas pelo config e 20 arbitrárias.

### `index.html` (Página de Testes com Falhas Sintáticas Deliberadas)
* **Tags**: 131 tags.
* **Elementos**: 56 elementos.
* **Validação Estrutural**: **21 erros estruturais detectados** com precisão de linha e coluna.
* **Eventos Mapeados**:
  * `<button id="botao-contador">` (linha 66) -> `click` via `botao` (`arrow_function` incrementando o contador e atualizando `#resultado`).
* **CSS**: sem Tailwind e sem `<style>`; 27 elementos com style inline.

### Fixtures (`fixtures/`)
Nove HTMLs pequenos, cada um isolando um caso: erros estruturais, CSS puro, só Tailwind, com scripts, sem scripts, só style inline, modo foco e as limitações conhecidas. O resultado esperado de cada um está em [TESTES.md](TESTES.md).

---

## Como Executar

### 1. Executar a análise padrão e gerar os arquivos JSON
```bash
node script.js
```
Imprime uma amostra do primeiro `<header>` de `code.html` (marcada com linhas e offsets, para não ser confundida com o escopo da análise), a linha de escopo (arquivo inteiro), o resumo com código de cada manipulador mapeado e gera os arquivos na pasta `output/` (`code.json`, `index.json`, `resultado.json`).

### 1b. Analisar só um bloco (modo foco)
```bash
node script.js --foco header
node script.js code.html --foco "#copy-link-btn"
```
Imprime o bloco escolhido com linhas e offsets e a análise restrita a ele; grava `output/code.foco-<seletor>.txt`.

### 2. Executar a suíte de testes automatizados
```bash
node --test
```
Roda os 73 testes: os unitários de `test.js` (T-01 a T-26) e a bateria sobre os HTMLs de `fixtures/` (F-01 a F-47), que cobre erros estruturais, CSS puro, só Tailwind, com e sem scripts, com e sem style inline, modo foco, arquivos externos e o contrato do componente. Sete deles são `todo` e documentam limitações conhecidas. Cada teste está descrito em [TESTES.md](TESTES.md).

---

## Limitações Atuais e Próximas Evoluções

* **Seletores complexos nos scripts**: no CSS dos blocos `<style>` os seletores encadeados (ex.: `div.card > ul li:first-child`) já são resolvidos, mas nos `querySelector` dos scripts continuam categorizados como `complexo` e não são ligados a elementos;
* **Limitações cobertas por testes `todo`**: fechamento opcional de `<li>`/`<p>`, tags dentro de `<textarea>`, entidades em `onclick`, `el.onclick = function` em várias linhas, `querySelector("form").addEventListener`, listener dentro de comentário JS e aspa solta em atributo sem aspas (F-23 a F-29 em [TESTES.md](TESTES.md));
* **CSS e JS externos**: `<link rel="stylesheet">`, `@import` e `<script src>` não são lidos, só listados com aviso de onde procurar; da escala padrão do Tailwind só valores do `tailwind.config` e arbitrários são resolvidos;
* **JavaScript dinâmico em tempo de execução**: referências montadas via interpolação de strings dinâmicas (ex.: `document.getElementById("btn-" + id)`) exigem interpretação dinâmica de runtime, fora do escopo de análise estática de texto;
* **SVG com namespaces**: atributos XML/SVG com namespaces (como `xlink:href`) são preservados textualmente, mas normalizados em minúsculas nos atributos.
