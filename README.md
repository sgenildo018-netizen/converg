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

Na prática, o que mais ajuda é a **saída do console**, que resume em poucas linhas o que levaria minutos para achar no arquivo.

## Exemplo de saída

```
--- Análise e Mapeamento Completo de Eventos ---
Tags: 1016 | Elementos: 513
Estrutura válida: Sim (0 erros)
Elementos com eventos mapeados: 5
  - <button id="copy-link-btn"> (L742) -> [click] handler L1788 via addEventListenerVariavel (arrow_function): "() => { navigator.clipboard.writeText(window.locatio..."
  - <button id="star-btn"> (L764) -> [click] handler L1768 via addEventListenerVariavel (arrow_function): "() => { isStarred = !isStarred; if (isStarred) { sta..."
  - <button> (L902) -> [click] handler L902 via inline (inline): "navigator.clipboard.writeText( document.getElementBy..."
  - <button> (L1053) -> [click] handler L1053 via inline (inline): "navigator.clipboard.writeText( document.getElementBy..."
  - <button id="btn-run-test"> (L1153) -> [click] handler L1731 via addEventListenerVariavel (arrow_function): "() => { const val = inputEl.value.trim() || "/api/v1..."
```

Cada linha mostra: elemento → linha do elemento → evento → **linha do handler** → como foi registrado → tipo do handler → início do código.

## Como rodar

```bash
node script.js         # analisa code.html (e index.html)
node --test test.js    # 23 testes
```

Saídas na pasta `output/`:

| Arquivo | Conteúdo |
|---|---|
| `code.txt` | cópia exata do que o console imprime (o mais útil para leitura) |
| `code.json` / `index.json` | análise completa: tags, elementos, validação, eventos com código integral |
| `resultado.json` | espelho de `code.json` |

## Arquivos

- `script.js`: o mapeador (tokenizer, validação estrutural, elementos, análise de scripts, vínculo de eventos).
- `test.js`: testes com `node:test`.
- `code.html`: página real (~112 KB, Tailwind), caso de uso principal.
- `index.html`: página pequena com erros estruturais propositais, para testar a validação.
- `MAPEAMENTO_HTML.md`: **como** o script funciona por dentro (arquitetura e formato do JSON). Este README cobre o **porquê**.

## Limitações conhecidas

- **CSS do Tailwind só vem do `tailwind.config`.** Classes com token do config (`bg-surface-container-lowest` → `background-color: #0a0e14`) e valores arbitrários (`w-[42%]`) são resolvidas com a linha do token. Classes da escala padrão do Tailwind (`flex`, `p-4`, `font-semibold`) aparecem como "sem token no config": o experimento não reproduz o Tailwind inteiro.
- **O `tailwind.config` é avaliado com `node:vm`** num contexto vazio. Não é um sandbox de segurança; use só com arquivos confiáveis.
- **Regras de `<style>`:** combinadores (` `, `>`, `+`, `~`), atributos e pseudo-classes estruturais (`:first-child`, `:nth-child`, `:not`, `:is`) são avaliados. Estados dinâmicos (`:hover`, `:focus`) casam e ficam anotados como estado. CSS de `<link rel="stylesheet">` externo não é lido.
- **Seletores simples apenas.** `#id`, `.classe` e `tag` são resolvidos. Seletores compostos e IDs montados em runtime (`"btn-" + id`) não.
- **Casos de HTML que o tokenizer ainda erra:** aspas soltas em valor sem aspas (`title=it's`), `<textarea>`/`<title>` com tags dentro, tags de fechamento opcionais (`<li>`, `<p>`) acusadas como erro, listeners dentro de comentários JS contados como ativos.
- **Código de handler:** `elemento.onclick = function () {…}` com várias linhas é cortado na primeira, e entidades em `onclick` (`&quot;`) não são decodificadas.
- **JSON grande:** cada elemento guarda o texto de todos os descendentes (`code.json` fica ~11× maior que o HTML).
