# Experimento: mapear HTML sem dependências

Este documento descreve a arquitetura e os experimentos implementados em `script.js`: ler um arquivo HTML como texto, localizar tags com precisão posicional, calcular seus intervalos `[inicio, fim)`, validar a integridade estrutural, interpretar atributos e associar dinâmicas de JavaScript (como `addEventListener` e seletores DOM) aos elementos correspondentes, sem utilizar qualquer biblioteca externa ou parser pesado.

## Objetivo

Extrair trechos do HTML original — como blocos `<header>`, `<main>`, botões e `<script>` — preservando estritamente os caracteres, espaçamentos, indentação e quebras de linha do arquivo de origem. Ao operar diretamente com offsets (`String.prototype.slice`), o código dispensa ferramentas de serialização que reformatam a árvore sintática, mantendo a fidelidade total do texto.

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
    - Identifica listeners (addEventListener, propriedades on...)
                            │
                            ▼
 5. Vínculo de Interatividade (associarEventos)
    - Conecta ouvintes JS e eventos inline aos elementos HTML mapeados
    - Audita seletores não encontrados no documento
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
* `eventosInline`: lista de handlers inline iniciados com `on` (como `onclick`, `onchange`), separando o nome do evento e o código JS literal;
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
  vazio: false
}
```

* **Elementos vazios**: podem ser opcionalmente incluídos (`incluirVazios: true`), viabilizando a busca e vinculação de elementos interativos como `<input id="endpoint-input">`.
* **Sem re-serialização**: `texto` e `conteudo` provêm de `html.slice()`, garantindo que toda a indentação original seja conservada.

---

### 6. Análise Estática de JavaScript e Associação de Eventos

A análise estática vincula o comportamento declarado nos scripts aos elementos HTML do template:

1. **Detecção de Seletores DOM (`analisarScripts`)**:
   Localiza variáveis e chamadas diretas como:
   * `document.querySelector("#botao-contador")` / `document.querySelectorAll(".card")`
   * `document.getElementById("btn-run-test")`
   * `document.getElementsByClassName(...)` / `document.getElementsByTagName(...)`
2. **Detecção de Ouvintes de Evento**:
   * Padrão com variável: `botao.addEventListener("click", ...)` ou `botao.onclick = ...`
   * Padrão direto: `document.getElementById("x").addEventListener("click", ...)`
3. **Associação Bidirecional (`associarEventos`)**:
   Encontra os elementos correspondentes por `id`, `class` ou `tag` e anexa os ouvintes ao array `elemento.eventosJS`.
4. **Auditoria de Interatividade (`gerarRelatorioInteratividade`)**:
   * Identifica elementos com eventos (inline ou via script);
   * Identifica elementos interativos (`<button>`, `<a>`, `<input>`) que não possuem nenhum manipulador configurado;
   * Identifica seletores no script que não encontram nenhum elemento correspondente no HTML (seletores órfãos ou código morto).

---

### 7. Funções de Consulta Disponíveis

* `buscarElementoPorNome(elementos, nome)`: retorna a primeira ocorrência completa do elemento;
* `buscarTodosPorNome(elementos, nome)`: retorna todos os elementos daquela tag;
* `buscarPorId(elementos, id)`: busca por identificador único (`id="meu-id"` ou `#meu-id`);
* `buscarPorClasse(elementos, classe)`: localiza elementos que possuam a classe especificada;
* `buscarPorAtributo(elementos, nomeAtributo, valorEsperado?)`: localiza elementos por chave e valor de atributo.

---

## Resultados nos Arquivos de Teste

### `code.html` (Dashboard Real Tailwind ~112 KB)
* **Tags**: 1.016 tags localizadas com sucesso.
* **Elementos**: 513 elementos mapeados.
* **Validação Estrutural**: **100% válido (0 erros)**.
* **Listeners JS Vinculados**:
  * `<button id="btn-run-test">` -> evento `click` via variável `btnRun` (`getElementById`);
  * `<button id="star-btn">` -> evento `click` via variável `starBtn` (`getElementById`);
  * `<button id="copy-link-btn">` -> evento `click` via variável `copyLinkBtn` (`getElementById`).
* **Eventos Inline**:
  * 2 botões com manipuladores `onclick` multilinhas complexos (linhas 902 e 1053) extraídos sem perda de formatação.
* **Seletores Órfãos**: 0 seletores não encontrados.

### `index.html` (Página de Testes com Falhas Sintáticas Deliberadas)
* **Tags**: 131 tags.
* **Elementos**: 56 elementos.
* **Validação Estrutural**: **21 erros estruturais detectados**, identificando com precisão de linha e coluna:
  * Fechamentos órfãos de `</strong>`, `</em>`, `</p>` e `</h3>` (linhas 18 e 27);
  * Tags `</li>` fechando fora de lista e tag `</ul>` órfã (linhas 29–32);
  * Fechamento truncado `<</details>summary ...>` (linha 69).
* **Listeners JS Vinculados**:
  * `<button id="botao-contador">` (linha 66) -> evento `click` via `botao` (`document.querySelector("#botao-contador")`).

---

## Como Executar

### 1. Executar a análise padrão
```bash
node script.js
```
Imprime o primeiro bloco `<header>` de `code.html` e um resumo da validação estrutural e eventos correlacionados.

### 2. Executar a suíte de testes unitários e de integração
```bash
node --test test.js
```
Executa os 14 testes cobrindo tokenização com aspas e comentários, validação estrutural, preservação de formatação, extração de atributos e correlação JS.

---

## Limitações Atuais e Próximas Evoluções

Embora o parser resolva tags complexas, atributos e eventos sem dependências externas, permanecem algumas restrições intencionais da abordagem baseada em texto:

* **Seletores CSS compostos**: expressões encadeadas complexas (ex.: `div.card > ul li:first-child`) são categorizadas como `complexo` e não possuem resolução completa de árvore descendente;
* **JavaScript dinâmico**: referências construídas em tempo de execução via concatenação de strings (ex.: `document.getElementById("btn-" + id)`) exigem interpretação dinâmica de runtime, fora do escopo de análise estática simples;
* **SVG embutido com namespaces**: tags e atributos com namespaces específicos de XML/SVG (como `xlink:href`) são preservados textualmente, mas tratados com normalização em minúsculas nos atributos.
