# Testes do converg

Este documento lista **cada teste** da suíte, o que ele verifica e em qual arquivo ele mora. O código de cada linha (`T-xx`, `F-xx`) aparece no nome do teste, então dá para achar um no outro com busca.

## Regra do projeto

**Antes de implementar algo novo, primeiro a bateria de testes.** O fluxo é:

1. Criar (ou ajustar) um HTML em `fixtures/` que mostre o caso novo.
2. Escrever o teste afirmando o comportamento esperado. Se ainda não funciona, marcar com `{ todo: "motivo" }`.
3. Anotar o teste aqui.
4. Implementar até o teste passar e remover o `todo`.
5. Rodar a suíte inteira: nada que passava pode quebrar.

## Como rodar

```bash
node --test                    # roda tudo (test.js e fixtures.test.js)
node --test test.js            # só os testes unitários (T-xx)
node --test fixtures.test.js   # só a bateria de fixtures (F-xx)
```

Motor: `node:test` + `node:assert/strict`, nativos do Node (sem dependências).

Estado atual: **59 testes, 52 passam, 0 falham, 7 `todo`** (limitações conhecidas, ver F-23 a F-29).

Um teste `todo` afirma o comportamento **correto**, roda normalmente e aparece com ⚠ no relatório, mas não quebra a suíte. Quando a limitação for resolvida, ele passa a passar e o `todo` deve ser removido.

## Fixtures (`fixtures/`)

| Arquivo | Erros | Classes | Tailwind | `<style>` | Scripts | Style inline |
|---|---|---|---|---|---|---|
| `erros-estruturais.html` | sim | não | não | não | não | não |
| `css-puro.html` | não | CSS puro | não | sim | não | não |
| `tailwind-puro.html` | não | Tailwind | sim | não | só o config | não |
| `com-scripts.html` | não | uma classe | não | não | sim (todos os tipos de evento) | não |
| `sem-scripts.html` | não | não | não | não | não | não |
| `style-inline.html` | não | não | não | não | não | sim |
| `foco.html` | um `<p>` sem fechamento fora do `<header>` | uma classe | não | sim | sim (handler fora do bloco) | não |
| `limitacoes.html` | casos de limitação | não | não | não | sim | não |
| `limitacao-aspa-solta.html` | caso de limitação | não | não | não | não | não |

Os testes calculam as linhas esperadas procurando o trecho no próprio arquivo (`linhaDe(html, "trecho")`), então editar uma fixture não exige recontar linhas na mão.

## Bateria de fixtures (`fixtures.test.js`)

### erros-estruturais.html

| Código | O que verifica | Esperado |
|---|---|---|
| F-01 | Cada erro estrutural com tipo, tag e linha | `</span>` órfão; `</b>` fecha antes de `<i>` (cruzado) e o `</i>` seguinte fica órfão; a `<section>` nunca fechada aparece como pendente quando `</body>` fecha (cruzado) |
| F-02 | `</br>` em elemento vazio | é **aviso** (`fechamento_elemento_vazio`), não erro |
| F-03 | Comentário com tags dentro e mapeamento depois dos erros | nenhuma tag na linha do comentário; o `<footer>` final é mapeado com texto exato |

### css-puro.html

| Código | O que verifica | Esperado |
|---|---|---|
| F-04 | Leitura do bloco `<style>` | 9 regras com linha; `@media` vira contexto da regra; `@keyframes` é listado como at-rule e não casa com elementos; `tailwind.config` não encontrado |
| F-05 | Seletores ligados aos elementos certos | `#id`, `h1 + p`, `nav a`, `ul > li:first-child` (só o 1º `li`), `.card.destaque` (só o card com as duas classes), `input[type="text"]` (não o checkbox); `.card` casa duas vezes (normal e `@media`) |
| F-06 | Estado dinâmico e `!important` | `.btn:hover` casa com estado `hover`; `border-color: gold` mantém `importante: true` |
| F-07 | Ausências | sem scripts, sem eventos, sem style inline, nenhuma classe resolvida como Tailwind |

### tailwind-puro.html

| Código | O que verifica | Esperado |
|---|---|---|
| F-08 | Leitura do `tailwind.config` | linha do config; totais por seção; token de `theme` marcado `origem: "theme"` e de `theme.extend` como `"extend"`; cor aninhada `brand.500` vira `brand-500` com a linha certa |
| F-09 | Resolução de classes | `fontSize` em tupla com objeto e com string; opacidade `/50` vira `rgba`; variantes `md:` e `hover:`; negativo `-mt-gutter` = `-1rem`; arbitrário `w-[42%]` |
| F-10 | Escala padrão do Tailwind | `flex` e `p-4` ficam `origem: "padrao"` (sem token no config); contagem de classes por origem |
| F-11 | Ausências | sem `<style>`, sem style inline; os 2 `<script>` (CDN e config) não geram eventos |

### com-scripts.html

| Código | O que verifica | Esperado |
|---|---|---|
| F-12 | `btn.addEventListener` via variável | `click`, `arrow_function`, variável `btnSalvar`, linha do handler = linha do `addEventListener`, código completo em várias linhas |
| F-13 | `document.getElementById(...).addEventListener` direto | `funcao_nomeada` `cancelar`, parâmetros `["e"]`, opções `{ once: true }` |
| F-14 | Handler por referência | `input` → `filtrar` (`referencia`), via `querySelector("#busca")` |
| F-15 | `onmouseover` por classe | os dois `.item` recebem o evento (`propriedadeOn`, `funcao_anonima`) |
| F-16 | Eventos inline | `onclick` e `onmouseover` com o código do atributo e a linha do próprio elemento |
| F-17 | O que não deve ser ligado | `window.addEventListener` fica como variável desconhecida; `#nao-existe` vai para `seletoresNaoEncontrados`; total de 7 elementos com evento |

### sem-scripts.html

| Código | O que verifica | Esperado |
|---|---|---|
| F-18 | Página estática | válida, 19 elementos, sem scripts, eventos, CSS, classes ou style inline |
| F-19 | Elemento autofechável | `<img />` vira elemento vazio com o texto exato e a linha certa |

### style-inline.html

| Código | O que verifica | Esperado |
|---|---|---|
| F-20 | Declarações do atributo `style` | 4 elementos com style; `body` com 2 declarações; `!important` detectado |
| F-21 | Casos difíceis do `style` | `;` dentro de `url(...)` não quebra a declaração; `COLOR` vira `color`; atributo com aspas simples |
| F-22 | Sem declarações | `style=""` e elemento sem `style` dão lista vazia |

### foco.html (modo foco num elemento)

| Código | O que verifica | Esperado |
|---|---|---|
| F-30 | Escopo do foco por tag | só o `<header>` e descendentes entram (5 elementos); linhas de início e fim do bloco; todas as tags dentro do intervalo |
| F-31 | Eventos no foco | o `#menu` (handler escrito no `<script>` fora do bloco, com a linha certa) e o botão inline entram; o `#comprar` do `<main>` fica de fora |
| F-32 | Validação só do bloco | o arquivo é inválido (`<p>` sem fechamento no `<main>`), mas o foco `header` é válido e o foco `main` não |
| F-33 | Tipos de seletor | `#topo` funciona; `main .card` casa 2, usa o 1º e informa o total; seletor sem resultado dá erro claro |
| F-34 | CSS e interativos no foco | `header button` atinge 2 elementos do foco; `.card` não aparece; classes só do bloco; o `<a>` aparece como interativo sem evento |

### Limitações conhecidas (`todo`)

| Código | Fixture | Limitação | Comportamento hoje |
|---|---|---|---|
| F-23 | `limitacoes.html` | `<li>` e `<p>` com fechamento opcional são HTML válido | acusados como erro de fechamento cruzado |
| F-24 | `limitacoes.html` | tags dentro de `<textarea>` são texto | `<b>` vira elemento |
| F-25 | `limitacoes.html` | entidades no `onclick` (`&quot;`) | código fica com `&quot;` |
| F-26 | `limitacoes.html` | `el.onclick = function () {…}` em várias linhas | código cortado em `function () {` |
| F-27 | `limitacoes.html` | `document.querySelector("form").addEventListener` | seletor de tag não é classificado; vai para não encontrados |
| F-28 | `limitacoes.html` | listener dentro de comentário `//` | contado como ativo |
| F-29 | `limitacao-aspa-solta.html` | `title=it's` (aspa solta em valor sem aspas) | o tokenizer engole o resto do arquivo; elementos seguintes somem |

## Testes unitários (`test.js`)

| Código | Função | O que verifica |
|---|---|---|
| T-01 | `extrairAtributos` | id, classes, booleanos e evento inline com `>` dentro das aspas |
| T-02 | `extrairAtributos` | atributos sem aspas e com aspas simples |
| T-03 | `localizarTags` | ignora tags dentro de comentários HTML |
| T-04 | `localizarTags` | `>` dentro de aspas não fecha a tag |
| T-05 | `localizarTags` | conteúdo de `<script>` é texto puro |
| T-06 | `calcularLinhaColuna` | linha e coluna base 1 |
| T-07 | `validarEstrutura` | aprova HTML balanceado |
| T-08 | `validarEstrutura` | detecta tag não fechada |
| T-09 | `validarEstrutura` | detecta fechamento órfão |
| T-10 | `validarEstrutura` | detecta fechamento cruzado |
| T-11 | `mapearElementos` | fatia exata do texto, com indentação original |
| T-12 | buscas | por id, classe e atributo |
| T-13 | `extrairArgumentosChamada` / `detalharManipulador` | código, parâmetros e opções do listener |
| T-14 | `detalharManipulador` | função nomeada e referência |
| T-15 | `analisarScripts` / `associarEventos` | listeners e ids do `index.html` |
| T-16 | pipeline em `code.html` | estrutura 100% válida e eventos com código completo |
| T-17 | `processarHtml` / `salvarResultadoJson` | JSON válido gravado em `output/` |
| T-18 | `extrairTailwindConfig` | tokens do `code.html` com a linha de cada um |
| T-19 | `resolverClasseTailwind` | variantes, opacidade, arbitrário, negativo, `!important`, `fontSize` em tupla |
| T-20 | `extrairRegrasCss` | regras, `@layer`, comentários, `@keyframes`, `url(...;...)` e linhas |
| T-21 | `casarSeletor` / `calcularEspecificidade` | combinadores, `:first-child`, `:not`, `:nth-child`, atributos, estados, pseudo-elemento, especificidade com `:where` |
| T-22 | `mapearCss` | classes, regras de `<style>` e style inline ligados aos elementos de `code.html` e `index.html` |
| T-23 | `extrairDeclaracoes` | `;` dentro de parênteses |
| T-24 | `mapearTags` (saída do console / `code.txt`) | a amostra diz qual elemento foi recortado (`<header>`, linhas e offsets) e a análise diz que o escopo é o arquivo inteiro |
| T-25 | `mapearTags` com `foco` | rótulos do bloco e do escopo, `.txt` próprio (`code.foco-header.txt`) e a saída padrão `code.txt` intacta |

## Observações da bateria

Coisas que a bateria mostrou e que não são erro de teste, mas valem anotar:

- **Seção nunca fechada** (F-01): o validador acusa como `fechamento_cruzado` no `</body>`, não como `tag_nao_fechada`. A informação está lá (`tagPendente` com a linha da `<section>`), só o tipo é outro.
- **Classes de CSS puro** (`css-puro.html`): `card`, `btn` e `intro` aparecem na saída como "sem token no config", porque o rótulo foi pensado para Tailwind. O CSS delas vem das regras de `<style>`, que aparecem logo abaixo.
