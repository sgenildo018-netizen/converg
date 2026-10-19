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
node --test            # 65 testes (58 passam, 7 todo de limitações conhecidas)
```

Saídas na pasta `output/`:

| Arquivo | Conteúdo |
|---|---|
| `code.txt` | cópia exata do que o console imprime (o mais útil para leitura) |
| `code.foco-<seletor>.txt` | a mesma saída no modo foco (ex.: `code.foco-header.txt`); não sobrescreve o `code.txt` |
| `code.json` / `index.json` | análise completa: tags, elementos, validação, eventos com código integral |
| `resultado.json` | espelho de `code.json` |

## Arquivos

- `script.js`: o mapeador (tokenizer, validação estrutural, elementos, análise de scripts, vínculo de eventos).
- `test.js`: testes unitários com `node:test` (T-01 a T-25).
- `fixtures.test.js` e `fixtures/`: bateria sobre HTMLs pequenos de exemplo (F-01 a F-34): erros estruturais, CSS puro, só Tailwind, com e sem scripts, com e sem style inline, modo foco e as limitações conhecidas.
- `TESTES.md`: **cada teste** descrito, com o que verifica e o esperado. Antes de implementar algo novo, a bateria de testes vem primeiro (o fluxo está lá).
- `code.html`: página real (~112 KB, Tailwind), caso de uso principal.
- `index.html`: página pequena com erros estruturais propositais, para testar a validação.
- `experimentos/`: comparação do script com libs prontas (parse5, html-validate, postcss, css-select, acorn, DOMPurify), com `package.json` próprio. O `script.js` continua sem dependências. Resultado em [experimentos/LIBS.md](experimentos/LIBS.md).
- `MAPEAMENTO_HTML.md`: **como** o script funciona por dentro (arquitetura e formato do JSON). Este README cobre o **porquê**.

## Limitações conhecidas

- **CSS do Tailwind só vem do `tailwind.config`.** Classes com token do config (`bg-surface-container-lowest` → `background-color: #0a0e14`) e valores arbitrários (`w-[42%]`) são resolvidas com a linha do token. Classes da escala padrão do Tailwind (`flex`, `p-4`, `font-semibold`) aparecem como "sem token no config": o experimento não reproduz o Tailwind inteiro.
- **O `tailwind.config` é avaliado com `node:vm`** num contexto vazio. Não é um sandbox de segurança; use só com arquivos confiáveis.
- **Regras de `<style>`:** combinadores (` `, `>`, `+`, `~`), atributos e pseudo-classes estruturais (`:first-child`, `:nth-child`, `:not`, `:is`) são avaliados. Estados dinâmicos (`:hover`, `:focus`) casam e ficam anotados como estado. CSS de `<link rel="stylesheet">` e `@import` não é lido: o script só avisa em qual arquivo procurar.
- **Seletores simples apenas.** `#id`, `.classe` e `tag` são resolvidos. Seletores compostos e IDs montados em runtime (`"btn-" + id`) não.
- **Casos de HTML que o tokenizer ainda erra** (cada um tem um teste `todo` em [TESTES.md](TESTES.md), F-23 a F-29): aspas soltas em valor sem aspas (`title=it's`), `<textarea>`/`<title>` com tags dentro, tags de fechamento opcionais (`<li>`, `<p>`) acusadas como erro, listeners dentro de comentários JS contados como ativos.
- **Código de handler:** `elemento.onclick = function () {…}` com várias linhas é cortado na primeira, e entidades em `onclick` (`&quot;`) não são decodificadas.
- **JSON grande:** cada elemento guarda o texto de todos os descendentes (`code.json` fica ~14× maior que o HTML).
