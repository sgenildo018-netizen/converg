# converg

Experimento para mapear, a partir do texto bruto de um arquivo HTML, **cada elemento com a linha onde está, o CSS que ele usa e os eventos JS ligados a ele**: qual evento, o tipo de handler e a linha onde o handler foi escrito.

> Status: **experimento**. Não é biblioteca nem produto. Node.js puro, sem dependências.

## Motivação

O gargalo que motivou o projeto é **pegar um elemento de uma página grande e recriá-lo como componente**.

O `code.html` deste repositório tem cerca de 1.800 linhas num arquivo só: HTML, classes Tailwind, `tailwind.config`, `<style>` e vários `<script>`. Para extrair um botão como componente, é preciso juntar três coisas que estão espalhadas pelo arquivo:

1. **o markup** do elemento, exatamente como está escrito;
2. **o CSS** que ele usa (classes, tokens do config, regras em `<style>`);
3. **os eventos**: qual evento, qual handler e **onde** esse handler está.

As três saídas óbvias não resolvem:

- **Caçar no código à mão.** Com 1.800 linhas, o botão está na linha 742 e o `addEventListener` dele na 1788. Encontrar isso é lento e fácil de errar.
- **Pedir para um LLM analisar.** O modelo não reproduz o HTML com 100% de fidelidade: reformata indentação, resume atributos, inventa ou perde listeners. Para replicar um componente, "quase igual" não serve.
- **Abrir no navegador.** O DevTools mostra o DOM *depois* de executado e reformatado, não o texto original nem a linha da fonte onde cada coisa foi escrita.

O `converg` faz o caminho inverso: lê o arquivo como texto, localiza cada tag por offset e recorta com `html.slice()`. O trecho extraído é **idêntico ao original**, com espaços, quebras de linha e indentação. Em cima disso, cruza os `<script>` para ligar cada `addEventListener`, `on...` e `onclick=""` ao elemento certo.

### O objetivo: um contrato do componente

Extrair o HTML é só o começo. A função central do converg é produzir um **contrato claro do componente**:

1. **qual bloco é o alvo**: o elemento, as linhas e o texto exato;
2. **o que ele usa**: classes, tokens, regras de `<style>`, style inline e arquivos externos;
3. **quais comportamentos estão ligados a ele**: eventos, handlers e a linha onde cada um foi escrito.

Tudo isso vem no relatório, **sem deixar decisões importantes para o LLM ou para uma pessoa adivinhar**. O que o script não consegue determinar aparece como aviso explícito (por exemplo `[LER ARQUIVO DE ESTILO x]`), em vez de sumir em silêncio. É isso que torna o script útil e o que guia os próximos experimentos.

### Por que ler como texto, e não com um parser de HTML

Foi uma escolha de partida, não uma limitação. Dissecar o HTML como árvore é mais complexo do que trabalhar com um texto: no texto dá para usar todos os métodos de string do JS (`indexOf`, `slice`, regex) e o arquivo nunca é reescrito, então o que sai é sempre o original. A inspiração é o processo do Astro, que pega um Markdown como texto e o transforma em HTML.

Usar libs externas **não é regra do projeto**. Em [experimentos/LIBS.md](experimentos/LIBS.md) há uma comparação com libs prontas (parse5, acorn e outras) para ver o que elas resolvem; o caminho principal continua sendo o texto puro, sem dependências.

Na prática, o que mais ajuda é a **saída do console**, que resume em poucas linhas o que levaria minutos para achar no arquivo.

## Exemplo de saída

```
=== Amostra: primeiro <header> de code.html (L506-L572, offsets 27332-31324) ===
<header ...>   (trecho exato do arquivo)
=== Fim da amostra <header> ===

--- Análise e Mapeamento Completo de Eventos ---
Escopo: arquivo inteiro code.html (L1-L1804), não só a amostra acima
Tags: 1016 | Elementos: 513
Estrutura válida: Sim (0 erros)
tailwind.config: L43 | colors 47 · borderRadius 4 · spacing 9 · fontFamily 10 · fontSize 10
Blocos <style>: 1 (L20) | regras: 5
  - html, body (L22, @layer base) -> 2 elementos: margin: 0; padding: 0
  - main > :first-child (L30, @layer base) -> 1 elemento: margin-top: 0 !important
  - ::-webkit-scrollbar (L37) -> todos os elementos: display: none
Classes distintas: 244 | do tailwind.config: 89 | arbitrárias: 20 | sem token no config: 135
Elementos com eventos mapeados: 5
  - <button id="copy-link-btn"> (L742) -> [click] handler L1788 via addEventListenerVariavel (arrow_function): "() => { navigator.clipboard.writeText(window.locatio..."
      CSS: 6 classes (4 do tailwind.config, 0 arbitrárias, 2 sem token no config)
        rounded -> border-radius: 0.125rem (borderRadius "DEFAULT", L97)
        hover:bg-surface-container-high -> background-color: #262a31 [hover] (colors "surface-container-high", L88)
        text-on-surface-variant -> color: #c2c6d6 (colors "on-surface-variant", L57)
        hover:text-on-surface -> color: #dfe2eb [hover] (colors "on-surface", L76)
        sem token no config: p-1.5 transition-colors
  - <button id="btn-run-test"> (L1153) -> [click] handler L1731 via addEventListenerVariavel (arrow_function): "() => { const val = inputEl.value.trim() || "/api/v1..."
      ...
```

A amostra do `<header>` é só um recorte para conferir que o texto sai idêntico ao original; tudo a partir de "Análise" vale para o arquivo inteiro.

Para analisar **só um bloco**, use `--foco <seletor>`. A saída começa com `=== Foco: <header> ... ===` e a linha `Escopo: só <header> e descendentes (L506-L572): 22 de 513 elementos`. Tags, validação, eventos, CSS e a lista de **interativos sem evento** passam a contar só dentro do bloco. Os `<script>` e `<style>` continuam sendo lidos do arquivo inteiro, então um handler escrito fora do bloco ainda aparece com a linha certa.

No foco, a saída termina com o **contrato do componente** (também gravado em `output/<arquivo>.foco-<seletor>.contrato.json` e `.contrato.md`). Exemplo de `node script.js code.html --foco "#copy-link-btn"`, resumido:

```
=== Contrato do componente: <button id="copy-link-btn"> ===
Alvo: <button id="copy-link-btn"> L742-L752 (offsets 42207-42914), 2 elementos; o texto exato está no topo desta saída
Usa:
  Classes do bloco: 8 (5 com CSS do tailwind.config ou arbitrário)
    - hover:bg-surface-container-high -> background-color: #262a31 [hover] (token L88)
  Classes aplicadas pelo JS: 1
    - text-primary (add, remove em #copy-link-btn, handler <button id="copy-link-btn"> L1788) -> color: #adc6ff (colors "primary", L81)
  CSS herdado dos ancestrais: 1
    - font-family: Geist (de <body> L212, classe font-body-md (tailwind.config L120))
Comportamentos: 1
  - <button id="copy-link-btn"> (L742) [click] handler L1788-L1798 (addEventListenerVariavel, arrow_function)
      altera: classe text-primary (add) em #copy-link-btn; classe text-primary (remove) em #copy-link-btn
      consulta: #copy-link-btn (dentro do bloco)
      APIs: navigator.clipboard, window.location, setTimeout
      código:
        L1788 |                         copyLinkBtn.addEventListener("click", () => {
        ...
Pendências: 2
  - classes p-1.5, transition-colors: escala padrão do Tailwind; o script não resolve o CSS (tailwind.config L43)
  - classe material-symbols-outlined: [LER ARQUIVO DE ESTILO fonts.googleapis.com (Material Symbols Outlined)] [FONTE: <link> no <head> L8; <link> no <head> L12]
=== Fim do contrato ===
```

O contrato junta o que já estava espalhado pela saída e acrescenta o que faltava para recriar o bloco: as **classes que o JS aplica** (com o CSS delas), o **CSS herdado** dos ancestrais, o **código inteiro** de cada handler com as linhas originais, o que cada handler **altera**, os elementos que ele **consulta dentro e fora do bloco** e as **APIs** do navegador que usa. O que o script não resolve vai para **Pendências**, em vez de ficar para alguém adivinhar.

**CSS e JS em arquivos externos.** Páginas como as do Claude Design ligam o CSS e o JS pelo `<head>` (`<link rel="stylesheet">`, `@import`, `<script src>`). O script não lê esses arquivos, mas lista cada um com a linha e avisa onde procurar:

```
Arquivos externos (não lidos pelo script): 4 de estilo, 3 scripts
  - estilo css/estilo.css (<link> no <head> L6)
  - estilo css/tema.css (@import no <style> L12)
  - script js/app.js (<script src> no <head> L15)
Classes com CSS em arquivo externo: 4
  - classe container (<div> L19) [LER ARQUIVO DE ESTILO css/estilo.css, css/tema.css] [FONTE: <link> no <head> L6; @import no <style> L12]
Interativos sem evento no arquivo: 2 [LER SCRIPT EXTERNO js/app.js, js/rodape.js] [FONTE: <script src> no <head> L15; <script src> no <body> L27]
```

Uma classe só recebe o aviso quando não tem CSS no próprio arquivo (nem token do `tailwind.config`, nem regra de `<style>`). Links do Google Fonts são tratados à parte: os de fonte não definem classes, e os de ícones (`Material Symbols`, `Material Icons`) apontam a classe que definem, como `material-symbols-outlined` em `code.html`. Scripts remotos e o Tailwind CDN não são apontados como fonte de eventos.

Cada linha de evento mostra: elemento → linha do elemento → evento → **linha do handler** → como foi registrado → tipo do handler → início do código. Embaixo vem o CSS do elemento: cada classe com as declarações que gera e a **linha do token** no `tailwind.config`, as regras de `<style>` que casam e o style inline.

## Como rodar

```bash
node script.js                         # analisa code.html inteiro (e index.html)
node script.js --foco header           # analisa só o primeiro <header> e seus descendentes
node script.js code.html --foco "#copy-link-btn"   # qualquer seletor: tag, #id, .classe, "main .card"
node --test            # 73 testes (66 passam, 7 todo de limitações conhecidas)
```

Saídas na pasta `output/`:

| Arquivo | Conteúdo |
|---|---|
| `code.txt` | cópia exata do que o console imprime (o mais útil para leitura) |
| `code.foco-<seletor>.txt` | a mesma saída no modo foco (ex.: `code.foco-header.txt`), terminando com o contrato do componente; não sobrescreve o `code.txt` |
| `code.foco-<seletor>.contrato.json` | o contrato do componente em JSON, para outra ferramenta ou um LLM ler |
| `code.foco-<seletor>.contrato.md` | o mesmo contrato em Markdown: o bloco num ` ```html ` exato, tabelas de CSS, cada handler num ` ```js ` com as linhas originais e as pendências como checklist `- [ ]` |
| `code.json` / `index.json` | análise completa: tags, elementos, validação, eventos com código integral |
| `resultado.json` | espelho de `code.json` |

## Arquivos

- `script.js`: o mapeador (tokenizer, validação estrutural, elementos, análise de scripts, vínculo de eventos).
- `test.js`: testes unitários com `node:test` (T-01 a T-26).
- `fixtures.test.js` e `fixtures/`: bateria sobre HTMLs pequenos de exemplo (F-01 a F-47): erros estruturais, CSS puro, só Tailwind, com e sem scripts, com e sem style inline, modo foco, arquivos externos, contrato do componente e as limitações conhecidas.
- `TESTES.md`: **cada teste** descrito, com o que verifica e o esperado. Antes de implementar algo novo, a bateria de testes vem primeiro (o fluxo está lá).
- `code.html`: página real (~112 KB, Tailwind), caso de uso principal.
- `index.html`: página pequena com erros estruturais propositais, para testar a validação.
- `experimentos/`: comparação do script com libs prontas (parse5, html-validate, postcss, css-select, acorn, DOMPurify), com `package.json` próprio. O `script.js` continua sem dependências. Resultado em [experimentos/LIBS.md](experimentos/LIBS.md).
- `MAPEAMENTO_HTML.md`: **como** o script funciona por dentro (arquitetura e formato do JSON). Este README cobre o **porquê**.

## Próximos experimentos

- **Primeira prova manual, já feita (2026-10-19):** o contrato do `--foco header` foi entregue a um agente LLM num projeto Astro, que reconstruiu o `<header>` com layout quase 100% fiel lendo só o contrato, não o arquivo inteiro. Faltaram os eventos, e o que faltou de fidelidade são os recursos externos que o contrato já listava como pendência. Detalhes em [TESTES.md](TESTES.md#histórico-da-bateria).
- **Astro como validador do contrato** (planejado, ainda não feito): gerar a partir do contrato de um `--foco` um `Componente.astro` (markup exato, CSS do contrato e handlers em `<script is:inline>`), montar com o Astro e comparar com o original num navegador sem tela (Playwright): estilos calculados de cada elemento e o efeito de cada evento contra o "altera" do contrato. Se a reconstrução se comporta igual, o contrato estava completo; cada diferença aponta o que faltou. Ficaria em `experimentos/`, sem afetar o `script.js`. Cuidados já vistos: compilar o `.md` só prova que o Markdown é válido; no MDX o HTML vira JSX, então `style="..."` em texto e `onclick="..."` quebram (por isso o bloco iria num `.astro`, que aceita HTML como está); o VitePress compila o Markdown como template Vue e interpretaria chaves duplas e diretivas no HTML.
- **Contrato em `.mdx`**: o `.md` já põe tags do texto corrido entre crases, o que o MDX também exige; chaves soltas no texto ainda precisariam de tratamento.

## Limitações conhecidas

- **CSS do Tailwind só vem do `tailwind.config`.** Classes com token do config (`bg-surface-container-lowest` → `background-color: #0a0e14`) e valores arbitrários (`w-[42%]`) são resolvidas com a linha do token. Classes da escala padrão do Tailwind (`flex`, `p-4`, `font-semibold`) aparecem como "sem token no config": o experimento não reproduz o Tailwind inteiro.
- **O `tailwind.config` é avaliado com `node:vm`** num contexto vazio. Não é um sandbox de segurança; use só com arquivos confiáveis.
- **Regras de `<style>`:** combinadores (` `, `>`, `+`, `~`), atributos e pseudo-classes estruturais (`:first-child`, `:nth-child`, `:not`, `:is`) são avaliados. Estados dinâmicos (`:hover`, `:focus`) casam e ficam anotados como estado. CSS de `<link rel="stylesheet">` e `@import` não é lido: o script só avisa em qual arquivo procurar.
- **Seletores simples apenas.** `#id`, `.classe` e `tag` são resolvidos. Seletores compostos e IDs montados em runtime (`"btn-" + id`) não.
- **Casos de HTML que o tokenizer ainda erra** (cada um tem um teste `todo` em [TESTES.md](TESTES.md), F-23 a F-29): aspas soltas em valor sem aspas (`title=it's`), `<textarea>`/`<title>` com tags dentro, tags de fechamento opcionais (`<li>`, `<p>`) acusadas como erro, listeners dentro de comentários JS contados como ativos.
- **Código de handler:** `elemento.onclick = function () {…}` com várias linhas é cortado na primeira (o contrato herda o corte), e entidades em `onclick` (`&quot;`) não são decodificadas.
- **Leitura dos handlers no contrato:** o que o handler altera, consulta e as APIs que usa vêm de padrões de texto (`classList.add`, `textContent =`, `getElementById("x")`, variáveis DOM declaradas com `const x = document...`). Alvos que o script não sabe resolver viram pendência (`alvo-nao-resolvido`), em vez de sumir.
- **JSON grande:** cada elemento guarda o texto de todos os descendentes (`code.json` fica ~14× maior que o HTML).
