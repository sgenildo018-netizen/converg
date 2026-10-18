# Experimento: mapear HTML sem dependências

Este documento descreve a arquitetura e os experimentos implementados em `script.js`: ler um arquivo HTML como texto, localizar tags com precisão posicional, calcular seus intervalos `[inicio, fim)`, validar a integridade estrutural, interpretar atributos, **mapear detalhadamente os eventos** (tipo de evento, manipulador, parâmetros, código-fonte e opções) e **exportar o resultado estruturado em arquivos JSON na pasta `output/`**, sem utilizar qualquer biblioteca externa ou parser pesado.

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
 6. Exportação em JSON (salvarResultadoJson / processarHtml)
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

### 7. Exportação Estruturada em JSON (`salvarResultadoJson` e `processarHtml`)

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
  "elementosComEventos": [
    {
      "tag": "button",
      "id": "btn-run-test",
      "linha": 1153,
      "coluna": 37,
      "totalEventos": 1,
      "eventos": [ ... ]
    }
  ],
  "elementos": [ ... ]
}
```

---

### 8. Funções de Consulta Disponíveis

* `buscarElementoPorNome(elementos, nome)`: primeira ocorrência completa do elemento;
* `buscarTodosPorNome(elementos, nome)`: todos os elementos daquela tag;
* `buscarPorId(elementos, id)`: busca por identificador único (`id="meu-id"` ou `#meu-id`);
* `buscarPorClasse(elementos, classe)`: localiza elementos que possuam a classe especificada;
* `buscarPorAtributo(elementos, nomeAtributo, valorEsperado?)`: localiza elementos por chave e valor de atributo;
* `processarHtml(caminho, opcoes)`: executa todo o pipeline e gera o JSON na pasta `output/`;
* `salvarResultadoJson(nomeArquivo, dados, pasta)`: utilitário de persistência em disco.

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

### `index.html` (Página de Testes com Falhas Sintáticas Deliberadas)
* **Tags**: 131 tags.
* **Elementos**: 56 elementos.
* **Validação Estrutural**: **21 erros estruturais detectados** com precisão de linha e coluna.
* **Eventos Mapeados**:
  * `<button id="botao-contador">` (linha 66) -> `click` via `botao` (`arrow_function` incrementando o contador e atualizando `#resultado`).

---

## Como Executar

### 1. Executar a análise padrão e gerar os arquivos JSON
```bash
node script.js
```
Imprime o primeiro bloco `<header>` de `code.html`, o resumo com código de cada manipulador mapeado e gera os arquivos na pasta `output/` (`code.json`, `index.json`, `resultado.json`).

### 2. Executar a suíte de testes automatizados
```bash
node --test test.js
```
Executa os 17 testes cobrindo tokenização, validação estrutural, preservação de formatação, detalhamento de manipuladores, parâmetros formais, opções de listeners e geração do JSON na pasta `output/`.

---

## Limitações Atuais e Próximas Evoluções

* **Seletores CSS descendentes complexos**: expressões encadeadas (ex.: `div.card > ul li:first-child`) são categorizadas como `complexo` e não possuem resolução completa de árvore descendente;
* **JavaScript dinâmico em tempo de execução**: referências montadas via interpolação de strings dinâmicas (ex.: `document.getElementById("btn-" + id)`) exigem interpretação dinâmica de runtime, fora do escopo de análise estática de texto;
* **SVG com namespaces**: atributos XML/SVG com namespaces (como `xlink:href`) são preservados textualmente, mas normalizados em minúsculas nos atributos.
