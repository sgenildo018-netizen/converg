# Experimento: mapear HTML sem dependências

Este documento descreve o experimento em `script.js`: ler um arquivo HTML como texto, localizar tags, calcular seus intervalos e associar tags de abertura e fechamento para extrair elementos completos. A ideia é dividir o trabalho em etapas pequenas, sem instalar um parser externo.

## Objetivo

Extrair trechos do HTML original — por exemplo, um `<header>` ou um `<script>` — preservando o texto e a formatação que estão no arquivo. A leitura pelo Node.js não executa o JavaScript que esteja dentro do HTML; ela apenas carrega o arquivo como uma string.

## Fluxo do mapeamento

### 1. Ler o arquivo

`readFile(caminhoHtml, "utf8")`, de `node:fs/promises`, lê o arquivo e retorna seu conteúdo como uma string. A resolução do caminho usa `__dirname`, então `index.html` é procurado na mesma pasta de `script.js`.

```js
const html = await readFile(caminhoHtml, "utf8");
```

Essa etapa não interpreta o HTML nem percorre seus elementos.

### 2. Localizar as tags

`mapearTags()` usa uma expressão regular com `matchAll()` para encontrar sequências que parecem tags. Para cada ocorrência, cria um registro com:

- `nome`: nome da tag em letras minúsculas;
- `tipo`: `abre`, `fecha` ou `auto`;
- `posicao`: índice em que a tag começa na string;
- `texto`: texto original da tag, por exemplo, `<p id="resultado">`.

Assim, uma saída como `fecha script @5207` indica que `</script>` começa no índice `5207`.

### 3. Calcular intervalos

`criarIntervalos(tags)` transforma a posição e o comprimento de cada tag em um intervalo:

```js
{
  inicio: posicao,
  fim: posicao + texto.length
}
```

`fim` é exclusivo, como o segundo argumento de `String.prototype.slice()`. Portanto, o texto exato da tag pode ser recuperado com:

```js
html.slice(inicio, fim);
```

`filtrarPorNome()` mostra como filtrar esses registros pelo nome da tag, por exemplo, `p`. Esse filtro retorna cada tag individualmente: `<p>` e `</p>` são ocorrências distintas.

### 4. Associar abertura e fechamento

`mapearElementos(tags, html)` percorre as tags na ordem em que aparecem e usa uma pilha:

1. Ao encontrar uma tag de abertura, guarda-a na pilha.
2. Ao encontrar uma tag de fechamento, procura a abertura correspondente na pilha.
3. Quando encontra o par, calcula o intervalo do elemento e o intervalo do conteúdo interno.

O elemento resultante contém:

- `inicio` e `fim`: intervalo da abertura até depois da tag de fechamento;
- `inicioConteudo` e `fimConteudo`: intervalo entre as tags;
- `texto`: elemento completo, obtido de `html.slice(inicio, fim)`;
- `conteudo`: conteúdo interno, obtido de `html.slice(inicioConteudo, fimConteudo)`.

Isso permite manter o trecho original sem serializar ou reformatar o HTML.

### 5. Selecionar um elemento

`buscarElementoPorNome(elementos, nome)` seleciona o primeiro elemento mapeado com aquele nome. Por exemplo, buscar `header` permite imprimir apenas o bloco `<header>...</header>`. O código atual busca `script` e imprime o bloco e seu conteúdo interno.

## Como executar

Na pasta do projeto, rode:

```bash
node script.js
```

O resultado depende da estrutura literal que está atualmente em `index.html`.

## Observação sobre o `<script>` atual

No estado atual do arquivo, o HTML contém:

```html
<script></script>
```

O código JavaScript aparece depois desse fechamento, e há um `</script>` adicional mais abaixo. Por isso, o mapeador encontra um bloco `<script>` vazio: ele registra o que está dentro das tags, não tenta adivinhar onde o código deveria estar.

Para que o código seja parte do elemento, a estrutura deve ser semelhante a:

```html
<script>
  // JavaScript aqui
</script>
```

## Limitações deste experimento

Este código é um mapeador didático, não um parser completo de HTML. A expressão regular localiza formas comuns de tags, mas não implementa todas as regras da linguagem. Em especial:

- `>` dentro de um atributo entre aspas pode confundir a expressão regular;
- texto que parece uma tag dentro de comentários ou de JavaScript pode ser interpretado como tag;
- HTML malformado pode produzir associações diferentes da estrutura que um navegador construiria;
- a lista de elementos vazios é explícita e precisa ser mantida;
- o código ainda não lê atributos para filtrar por `class` ou `id`.

A pilha é uma forma simples de acompanhar a hierarquia, mas a qualidade do resultado depende das tags encontradas e de quão bem formado está o HTML. Para um mapeamento sem perdas de formatação original, manter os intervalos na string de origem é útil; para interpretar o DOM como um navegador, seria necessário usar um parser DOM.
