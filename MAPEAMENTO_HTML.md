# Experimento: mapear HTML sem dependências

Este documento descreve o experimento em `script.js`: ler um arquivo HTML como texto, localizar tags, calcular seus intervalos e associar tags de abertura e fechamento para extrair elementos completos. A ideia é dividir o trabalho em etapas pequenas, sem instalar um parser externo.

## Objetivo

Extrair trechos do HTML original — por exemplo, um `<header>` ou um `<script>` — preservando o texto e a formatação que estão no arquivo. A leitura pelo Node.js não executa o JavaScript que esteja dentro do HTML; ela apenas carrega o arquivo como uma string.

## Fluxo do mapeamento

### 1. Ler o arquivo

`readFile(caminhoHtml, "utf8")`, de `node:fs/promises`, lê o arquivo e retorna seu conteúdo como uma string. Na função principal `mapearTags()`, o caminho é montado com `__dirname`, então `code.html` é procurado na mesma pasta de `script.js`. As funções exploratórias `lerHtml()` e `percorrerHtml()` ainda apontam para `index.html`.

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

Isso permite manter o trecho original sem serializar ou reformatar o HTML: como `texto` vem diretamente de `html.slice()`, espaços, quebras de linha, indentação e a formatação das tags são preservados. O script não executa o Prettier nem reconstrói o HTML.

### 5. Selecionar um elemento

`buscarElementoPorNome(elementos, nome)` seleciona o primeiro elemento completo mapeado com aquele nome. O teste atual lê `code.html` e usa essa função para imprimir o primeiro bloco `<header>` encontrado. O arquivo possui mais de um `<header>`; por isso, a busca retorna o primeiro na ordem do documento.

## Como executar

Na pasta do projeto, rode:

```bash
node script.js
```

O resultado depende da estrutura literal de `code.html`. Na execução atual, o primeiro `<header>` ocupa o intervalo `[27332, 31324)` e corresponde à barra fixa da interface. O arquivo contém também um segundo `<header>`, referente ao cabeçalho do artigo. A busca atual retorna apenas o primeiro. Os offsets mudam quando o arquivo é formatado porque passam a contar os espaços e as quebras de linha inseridos.

## Formatação preservada e próximos passos

O `code.html` está formatado com quebras de linha e indentação. A saída do mapeador manteve essa apresentação porque extraiu o trecho original por intervalo, sem convertê-lo para uma árvore DOM e serializá-lo novamente. Isso revela uma vantagem para o objetivo do experimento: além da estrutura e do conteúdo, é possível preservar a forma textual exata do bloco.

O teste anterior de IDs demonstrou uma primeira associação estática entre elementos HTML e seletores JavaScript. Ainda há espaço para evoluir o mapeador, em etapas independentes:

- validar tags abertas, fechamentos e erros estruturais antes de mapear elementos;
- interpretar atributos como `id`, `class` e atributos inline `on...`;
- associar seletores JavaScript, como `querySelector`, aos elementos correspondentes;
- identificar chamadas a `addEventListener` e relacioná-las ao elemento selecionado;
- manter os recortes da fonte original para não perder formatação durante essas análises.

A identificação de eventos seria uma análise estática do código e não executaria o JavaScript. Referências dinâmicas ou construídas em tempo de execução podem não ser resolvidas apenas pela inspeção do texto.

## Experimento anterior: `<script>` e IDs

Em um teste anterior com `index.html`, a tag `<script>` estava fechando imediatamente. Depois da correção, o mapeador associou os IDs `botao-contador` e `resultado` encontrados na última seção aos seletores `querySelector` dentro do script. Isso demonstrou por que é importante mapear o conteúdo entre as tags de abertura e fechamento, não apenas procurar nomes de tags.

## Limitações deste experimento

Este código é um mapeador didático, não um parser completo de HTML. A expressão regular localiza formas comuns de tags, mas não implementa todas as regras da linguagem. Em especial:

- `>` dentro de um atributo entre aspas pode confundir a expressão regular;
- texto que parece uma tag dentro de comentários ou de JavaScript pode ser interpretado como tag;
- HTML malformado pode produzir associações diferentes da estrutura que um navegador construiria;
- a lista de elementos vazios é explícita e precisa ser mantida;
- a extração de atributos é limitada a valores `id` entre aspas; ainda não há um parser geral de atributos nem suporte para filtrar por `class`.

A pilha é uma forma simples de acompanhar a hierarquia, mas a qualidade do resultado depende das tags encontradas e de quão bem formado está o HTML. Para um mapeamento sem perdas de formatação original, manter os intervalos na string de origem é útil; para interpretar o DOM como um navegador, seria necessário usar um parser DOM.
