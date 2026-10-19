# Experimento: libs prontas x script.js

O `script.js` faz tudo à mão (tokenizer, validador, leitura de CSS, regex sobre os `<script>`). Este experimento pega libs prontas para cada parte e compara o resultado delas com o do script, usando os mesmos arquivos da bateria (`fixtures/`, `index.html`, `code.html`).

O `script.js` **continua sem dependências**. As libs ficam só nesta pasta, com `package.json` próprio.

## Como rodar

```bash
cd experimentos
npm install
node rodar.js            # roda os 5 e grava cada saída em saida/
node 4-js-acorn.js       # ou um de cada vez
```

| Arquivo | Libs | Parte do script.js comparada |
|---|---|---|
| `1-parser-html.js` | parse5, htmlparser2 | `localizarTags` + `mapearElementos` |
| `2-validacao.js` | html-validate | `validarEstrutura` |
| `3-css.js` | postcss, postcss-selector-parser, css-select | `extrairRegrasCss` + `casarSeletor` |
| `4-js-acorn.js` | acorn, acorn-walk (+ parse5 e css-select para achar os elementos) | `analisarScripts` + `associarEventos` |
| `5-dompurify.js` | DOMPurify, jsdom | nada equivalente; testa se ajuda a exportar um componente |

As saídas completas estão em [`saida/`](saida/).

## Resultado em uma tabela

| Lib | Veredito | Por quê |
|---|---|---|
| **parse5** | adotar | Mesmos 513 elementos de `code.html`, com o mesmo início e o mesmo recorte exato. Resolve F-24, F-25 e F-29. 15× mais rápido. |
| **acorn** | adotar | Resolve F-26, F-27 e F-28, acha a linha onde o handler foi **escrito** e lista os elementos que o handler usa. |
| **html-validate** | adotar como opcional | Resolve F-23 e acha um erro real em `code.html` que o script não vê. Mas trava num erro de sintaxe do `index.html` e pesa 7,8 MB. |
| **css-select** | adotar junto com parse5 | No CSS empata com o script; ganha valor para resolver `querySelector("qualquer seletor")` nos eventos. |
| **postcss** | não precisa agora | Empata com `extrairRegrasCss` em todas as regras; só ganha em CSS aninhado (`& .e`). |
| **htmlparser2** | descartar | Erra os offsets quando o fechamento é `</span\n>` (o estilo do Prettier): 30 elementos fora do lugar em `code.html`. |
| **DOMPurify** | descartar para este objetivo | Reescreve o HTML (o `<header>` cai de 3.992 para 2.843 chars) e tira `onclick` e `<script>`, que é exatamente o que o converg quer mostrar. |

Juntos, **parse5 + acorn + css-select resolvem 6 dos 7 `todo`** (F-24 a F-29) e o **html-validate resolve o 7º** (F-23).

## 1. Parser HTML: parse5 e htmlparser2

Para cada arquivo, cada elemento do script.js foi procurado pelo offset de início na lista da lib; "mesmo recorte" quer dizer que o fim também bate, ou seja, `html.slice(inicio, fim)` dá o mesmo texto.

| Arquivo | script.js | parse5 (mesmo recorte) | htmlparser2 (mesmo recorte) |
|---|---|---|---|
| `code.html` | 513 | 513 (513) | 513 (**364**) |
| `index.html` | 56 | 56 (56) | 59 (56) |
| fixtures sem limitação | iguais | iguais | iguais |
| `limitacoes.html` | 15 | 17 (14) | 17 (14) |
| `limitacao-aspa-solta.html` | 3 | 8 (3) | 8 (3) |

Onde o parse5 difere do script, quem está certo é o parse5:

- `limitacoes.html`: o parse5 acha os `<li>` e o `<p>` sem fechamento (fechados implicitamente, como o navegador faz) e **não** cria o `<b>` de dentro do `<textarea>`.
- `limitacao-aspa-solta.html`: o parse5 lê `title=it's` como `"it's"` e acha o resto do arquivo (`<html>`, `<body>`, `<span>`, `#depois`, `#botao`); o script só acha 3 elementos.
- `erros-estruturais.html`: o parse5 tem a `<section>` nunca fechada como elemento; o `<i>` do fechamento cruzado termina no `</b>`, como no navegador.

| Limitação | parse5 | htmlparser2 |
|---|---|---|
| F-24 `<b>` dentro de `<textarea>` | resolve | resolve |
| F-25 `&quot;` no `onclick` | resolve | resolve |
| F-29 `title=it's` | resolve | resolve |

Tempo em `code.html`: script.js 66 ms, parse5 4 ms, htmlparser2 2 ms.

**Cuidado com o parse5:** o texto dos nós vem normalizado (CRLF vira LF, entidades decodificadas). Os arquivos deste repositório são CRLF, então quem pega o conteúdo de um `<script>` pelo nó de texto fica com offsets desalinhados (no experimento 4 isso deu linhas erradas até eu trocar). A regra é: **usar o parse5 só para as posições e recortar sempre do texto cru** (`html.slice(loc.startOffset, loc.endOffset)`), que é a ideia do converg desde o começo.

**Por que descartar o htmlparser2:** ele é mais rápido, mas o `startIndex` sai errado depois de um fechamento como `</span\n                        >`, que o Prettier gera o tempo todo em `code.html`. Ele também não segue as regras de fechamento implícito do HTML (cria `<p>` a mais em `index.html`).

## 2. Validação: html-validate

Configurei só as regras equivalentes ao `validarEstrutura` (`close-order`, `void-content`) e duas que o script não tem (`no-dup-id`, `element-permitted-content`).

- **`erros-estruturais.html`:** acha os mesmos erros e chama a `<section>` nunca fechada de `Unclosed element '<section>'` (o script dá `fechamento_cruzado` no `</body>`, ver "Observações" em TESTES.md). Também acusa `<div>` e `<footer>` dentro de `<b>`, que é consequência do `<b>` aberto.
- **`limitacoes.html`:** válido, porque `<li>` e `<p>` sem fechamento são HTML válido. **Resolve F-23.**
- **`code.html`:** acha um erro real que o script não vê: **`<div>` dentro de `<button>` na L514** (botão só aceita conteúdo inline).
- **`index.html`:** os 17 fechamentos órfãos até a L59 batem com o script, mas na L69 (`<</details>summary ...`) o html-validate dá `parser-error` e **para de analisar**; o script continua e acha mais 4 erros.
- **`foco.html`:** o script diz que o arquivo é inválido (o `<p>` sem fechamento do `<main>`); o html-validate diz que é válido, e pela especificação ele tem razão (um `</div>` fecha o `<p>` implicitamente). A premissa do F-32 depende desse comportamento do script.
- O preset `html-validate:recommended` é barulhento para este uso: em todo arquivo reclama de `<meta />` (`void-style`).

Tempo em `code.html`: script.js 65 ms, html-validate 14 ms. Tamanho: 7,8 MB instalado.

## 3. CSS: postcss e css-select

Aqui o script já está bom.

- **Leitura das regras:** em `css-puro.html`, `foco.html` e `code.html`, postcss e script acham as mesmas 16 regras, com o mesmo seletor e a mesma linha.
- **Casamento seletor → elementos:** css-select (sobre a árvore do parse5) e `casarSeletor` atingem exatamente os mesmos elementos nas 16 regras. Estados (`:hover`) e pseudo-elementos foram tirados antes, porque não existem num documento estático.
- **CSS difícil** (`content: "}"`, comentário com `{ }`, `url("x;y")`, `@font-face`, `@supports` com `@media` dentro): os dois leem igual. A única diferença é **CSS aninhado** (`.d { & .e { } }`): o postcss lê a regra `& .e`, o script a perde.
- **Seletores raros:** `:nth-child(odd)`, `:last-child`, `:nth-of-type`, `:has(> .a)`, `:is(...)`, `~` dão o mesmo resultado; só `:lang(pt)` difere (o script casa os dois `<p>`, o css-select só o que tem `lang="pt-BR"`).

## 4. JS: acorn

O acorn lê cada `<script>` como árvore (AST). Comentários somem sozinhos, uma chamada em várias linhas é um nó só, e cada nó tem offset de início e fim. Os seletores são resolvidos com css-select, então `querySelector` aceita qualquer seletor e devolve só o primeiro, como no navegador.

| Limitação | acorn |
|---|---|
| F-25 `&quot;` no `onclick` (via parse5) | resolve |
| F-26 `el.onclick = function () {…}` em várias linhas | resolve (4 linhas de código) |
| F-27 `querySelector("form").addEventListener` | resolve |
| F-28 listener dentro de `//` | resolve (não conta) |

Em `code.html` e `index.html` os vínculos são os mesmos do script (3 de 3 e 1 de 1). Três ganhos novos:

1. **Linha onde o handler foi escrito.** Em `com-scripts.html`, `campo.addEventListener("input", filtrar)` está na L35, mas a função `filtrar` foi escrita na **L17**. O script mostra L35; o acorn mostra a chamada (L35) e o handler (L17).
2. **Dependências do handler.** O acorn lista os ids que o código consulta. Em `code.html`, o `onclick` do botão da L902 usa `#code-snippet-1` e `#copy-status-1`. Para recriar o botão como componente, esses dois elementos precisam vir junto.
3. **`querySelector` devolve só o primeiro.** Em `com-scripts.html`, `document.querySelector(".item").onmouseover` liga só ao primeiro `.item` no navegador. O script liga aos dois (e o F-15 afirma isso). O acorn liga só ao primeiro.

## 5. DOMPurify

Ele limpa HTML para ser inserido com segurança, então **reescreve** o trecho: junta atributos numa linha só, tira quebras e indentação, remove `on*` e `<script>`. No `<header>` de `code.html`, os 3.992 chars viram 2.843; no `#copy-link-btn`, 707 viram 348. Isso vai contra a ideia de recortar o texto idêntico ao original. Só faz sentido como um passo opcional de "exportar sem JS", depois do mapeamento.

## Custo

Tamanho da pasta de cada lib em `node_modules`, sem as dependências dela (o `node_modules` inteiro desta pasta dá 41 MB, quase tudo do jsdom e do html-validate).

| Lib | Instalada |
|---|---|
| parse5 (+ entities) | 650 KB |
| acorn + acorn-walk | 610 KB |
| css-select | 210 KB |
| postcss | 220 KB |
| html-validate | 7,8 MB |
| DOMPurify + jsdom | 7 MB, mais as dependências do jsdom |

parse5 + acorn + css-select somam cerca de 1,5 MB e resolvem quase tudo; o grosso do peso está no html-validate e no jsdom.

## Próximo passo possível

Trocar no `script.js` o tokenizer por **parse5** e as regex de script por **acorn** (com **css-select** para os seletores), mantendo o recorte pelo texto cru. Isso tira os `todo` F-24 a F-29, mas o projeto deixa de ser "sem dependências". Pela regra do projeto, antes viria a bateria: testes novos para a linha do handler escrita fora da chamada, as dependências do handler e o `querySelector` que liga só ao primeiro, além de ajustar F-15 e F-32.
