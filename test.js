const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  calcularLinhaColuna,
  extrairAtributos,
  localizarTags,
  validarEstrutura,
  mapearElementos,
  buscarElementoPorNome,
  buscarTodosPorNome,
  buscarPorId,
  buscarPorClasse,
  buscarPorAtributo,
  extrairArgumentosChamada,
  detalharManipulador,
  analisarScripts,
  associarEventos,
  gerarRelatorioInteratividade,
  processarHtml,
  salvarResultadoJson,
  extrairTailwindConfig,
  resolverClasseTailwind,
  extrairDeclaracoes,
  extrairRegrasCss,
  analisarSeletor,
  calcularEspecificidade,
  construirArvore,
  casarSeletor,
} = require("./script.js");

test("T-01 extrairAtributos deve extrair id, classes, booleanos e eventos inline com parâmetros", () => {
  const tag =
    '<button id="meu-btn" class="btn btn-primary lg" disabled onclick="alert(\'ok > 1\')">';
  const attr = extrairAtributos(tag);

  assert.equal(attr.id, "meu-btn");
  assert.deepEqual(attr.classes, ["btn", "btn-primary", "lg"]);
  assert.equal(attr.todos.disabled, true);
  assert.equal(attr.eventosInline.length, 1);
  assert.equal(attr.eventosInline[0].evento, "click");
  assert.equal(attr.eventosInline[0].codigo, "alert('ok > 1')");
  assert.equal(attr.eventosInline[0].tipoManipulador, "inline");
  assert.deepEqual(attr.eventosInline[0].parametros, ["event"]);
});

test("T-02 extrairAtributos deve lidar com atributos sem aspas e aspas simples", () => {
  const tag = "<input type=text data-tipo='simples' required>";
  const attr = extrairAtributos(tag);

  assert.equal(attr.todos.type, "text");
  assert.equal(attr.todos["data-tipo"], "simples");
  assert.equal(attr.todos.required, true);
});

test("T-03 localizarTags deve ignorar tags dentro de comentários HTML", () => {
  const html =
    "<div><!-- <button id='oculto'>Ignorar</button> --><span>Visível</span></div>";
  const tags = localizarTags(html);

  const nomes = tags.map((t) => t.nome);
  assert.deepEqual(nomes, ["div", "span", "span", "div"]);
  assert.ok(!tags.some((t) => t.nome === "button"));
});

test("T-04 localizarTags não deve quebrar com > dentro de aspas em atributos", () => {
  const html = '<div title="a > b and c < d"><span>OK</span></div>';
  const tags = localizarTags(html);

  assert.equal(tags.length, 4);
  assert.equal(tags[0].texto, '<div title="a > b and c < d">');
  assert.equal(tags[0].atributos.todos.title, "a > b and c < d");
});

test("T-05 localizarTags deve tratar conteúdo de script como texto bruto e não tokenizar tags internas", () => {
  const html = `
    <script>
      const template = "<span>não é elemento DOM real</span>";
      if (1 < 2) console.log("menor");
    </script>
    <p>Parágrafo real</p>
  `;
  const tags = localizarTags(html);

  const nomes = tags.map((t) => t.nome);
  assert.deepEqual(nomes, ["script", "script", "p", "p"]);
});

test("T-06 calcularLinhaColuna deve computar linha e coluna 1-based corretamente", () => {
  const html = "linha1\nlinha2\nlinha3";
  const posL3 = html.indexOf("linha3");
  const pos = calcularLinhaColuna(html, posL3);

  assert.equal(pos.linha, 3);
  assert.equal(pos.coluna, 1);
});

test("T-07 validarEstrutura deve aprovar HTML bem balanceado", () => {
  const html = "<main><header><h1>Título</h1></header><p>Texto</p></main>";
  const tags = localizarTags(html);
  const relatorio = validarEstrutura(tags);

  assert.equal(relatorio.valido, true);
  assert.equal(relatorio.totalErros, 0);
});

test("T-08 validarEstrutura deve detectar tags não fechadas", () => {
  const html = "<div><section><p>Sem fechar div nem section";
  const tags = localizarTags(html);
  const relatorio = validarEstrutura(tags);

  assert.equal(relatorio.valido, false);
  const tipos = relatorio.erros.map((e) => e.tipo);
  assert.ok(tipos.includes("tag_nao_fechada"));
});

test("T-09 validarEstrutura deve detectar tags de fechamento órfãs", () => {
  const html = "<div><p>Texto</p></div></span>";
  const tags = localizarTags(html);
  const relatorio = validarEstrutura(tags);

  assert.equal(relatorio.valido, false);
  const orfa = relatorio.erros.find((e) => e.tipo === "fechamento_orfa");
  assert.ok(orfa);
  assert.equal(orfa.tag.nome, "span");
});

test("T-10 validarEstrutura deve detectar fechamentos cruzados (aninhamento incorreto)", () => {
  const html = "<p><b><i>texto</b></i></p>";
  const tags = localizarTags(html);
  const relatorio = validarEstrutura(tags);

  assert.equal(relatorio.valido, false);
  const cruzado = relatorio.erros.find((e) => e.tipo === "fechamento_cruzado");
  assert.ok(cruzado);
});

test("T-11 mapearElementos deve preservar fatias exatas e indentação original", () => {
  const trecho = `\n  <header class="meu-topo">\n    <h1>Título com espaços</h1>\n  </header>\n`;
  const tags = localizarTags(trecho);
  const elementos = mapearElementos(tags, trecho);

  const header = buscarElementoPorNome(elementos, "header");
  assert.ok(header);
  assert.equal(
    header.texto,
    '<header class="meu-topo">\n    <h1>Título com espaços</h1>\n  </header>',
  );
  assert.equal(header.conteudo, "\n    <h1>Título com espaços</h1>\n  ");
  assert.equal(header.classes[0], "meu-topo");
});

test("T-12 buscas por id, classe e atributos devem funcionar", () => {
  const html = `
    <button id="salvar" class="btn btn-primary" data-action="save">Salvar</button>
    <button id="cancelar" class="btn btn-secondary" data-action="cancel">Cancelar</button>
  `;
  const tags = localizarTags(html);
  const elementos = mapearElementos(tags, html);

  const salvar = buscarPorId(elementos, "salvar");
  assert.ok(salvar);
  assert.equal(salvar.id, "salvar");

  const botoes = buscarPorClasse(elementos, "btn");
  assert.equal(botoes.length, 2);

  const cancelBtn = buscarPorAtributo(elementos, "data-action", "cancel");
  assert.equal(cancelBtn.length, 1);
  assert.equal(cancelBtn[0].id, "cancelar");
});

test("T-13 extrairArgumentosChamada e detalharManipulador devem extrair código, parâmetros e opções", () => {
  const js = `
    btn.addEventListener("click", (evt, elem) => {
      console.log("disparado", evt);
    }, { once: true, passive: false });
  `;
  const posParen = js.indexOf("addEventListener(") + "addEventListener(".length - 1;
  const { args } = extrairArgumentosChamada(js, posParen);

  assert.equal(args.length, 3);
  assert.equal(args[0], '"click"');

  const det = detalharManipulador(args[1]);
  assert.equal(det.tipoManipulador, "arrow_function");
  assert.deepEqual(det.parametros, ["evt", "elem"]);
  assert.ok(det.codigo.includes('console.log("disparado", evt)'));

  assert.equal(args[2], "{ once: true, passive: false }");
});

test("T-14 detalharManipulador deve suportar funções nomeadas e referências", () => {
  const fNomeada = detalharManipulador("function aoClicar(e) { e.preventDefault(); }");
  assert.equal(fNomeada.tipoManipulador, "funcao_nomeada");
  assert.equal(fNomeada.nomeFuncao, "aoClicar");
  assert.deepEqual(fNomeada.parametros, ["e"]);

  const ref = detalharManipulador("meuControlador.aoEnviar");
  assert.equal(ref.tipoManipulador, "referencia");
  assert.equal(ref.nomeFuncao, "meuControlador.aoEnviar");
});

test("T-15 analisarScripts e associarEventos deve vincular listeners JS e IDs em index.html com mapeamento completo", () => {
  const caminhoIndex = path.join(__dirname, "index.html");
  const html = fs.readFileSync(caminhoIndex, "utf8");

  const tags = localizarTags(html);
  const elementos = mapearElementos(tags, html);
  const analise = analisarScripts(elementos);
  const associacao = associarEventos(elementos, analise);

  assert.ok(
    analise.variaveisDeclaradas.some(
      (v) => v.variavel === "botao" && v.seletor === "#botao-contador",
    ),
  );
  assert.ok(
    analise.variaveisDeclaradas.some(
      (v) => v.variavel === "resultado" && v.seletor === "#resultado",
    ),
  );

  const btnContador = buscarPorId(elementos, "botao-contador");
  assert.ok(btnContador);
  assert.equal(btnContador.eventos.length, 1);

  const ev = btnContador.eventos[0];
  assert.equal(ev.evento, "click");
  assert.equal(ev.origem, "addEventListenerVariavel");
  assert.equal(ev.tipoManipulador, "arrow_function");
  assert.ok(ev.codigo.includes("cliques += 1"));
  assert.ok(ev.codigo.includes("resultado.textContent"));

  assert.ok(
    associacao.vinculos.some(
      (v) => v.seletor === "#botao-contador" && v.evento === "click" && v.codigo.includes("cliques += 1"),
    ),
  );
});

test("T-16 validação estrutural de code.html deve ser 100% válida e associar eventos com código completo", () => {
  const caminhoCode = path.join(__dirname, "code.html");
  const html = fs.readFileSync(caminhoCode, "utf8");

  const tags = localizarTags(html);
  const relatorio = validarEstrutura(tags);
  assert.equal(relatorio.valido, true, "code.html deve ser estruturalmente válido");
  assert.equal(relatorio.totalErros, 0);

  const elementos = mapearElementos(tags, html);
  const analise = analisarScripts(elementos);
  const associacao = associarEventos(elementos, analise);

  const btnRun = buscarPorId(elementos, "btn-run-test");
  assert.ok(btnRun, "Deve encontrar #btn-run-test");
  assert.equal(btnRun.eventos.length, 1);
  assert.equal(btnRun.eventos[0].evento, "click");
  assert.equal(btnRun.eventos[0].tipoManipulador, "arrow_function");
  assert.ok(btnRun.eventos[0].codigo.includes("inputEl.value.trim()"));
  assert.ok(btnRun.eventos[0].codigo.includes("Testar Endpoint"));

  const starBtn = buscarPorId(elementos, "star-btn");
  assert.ok(starBtn, "Deve encontrar #star-btn");
  assert.equal(starBtn.eventos.length, 1);
  assert.ok(starBtn.eventos[0].codigo.includes("isStarred = !isStarred"));

  const copyLinkBtn = buscarPorId(elementos, "copy-link-btn");
  assert.ok(copyLinkBtn, "Deve encontrar #copy-link-btn");
  assert.equal(copyLinkBtn.eventos.length, 1);
  assert.ok(copyLinkBtn.eventos[0].codigo.includes("navigator.clipboard.writeText"));

  // Elementos com onclick inline
  const botoesOnclick = buscarPorAtributo(elementos, "onclick");
  assert.equal(botoesOnclick.length, 2);
  for (const btn of botoesOnclick) {
    assert.equal(btn.eventos.length, 1);
    assert.equal(btn.eventos[0].origem, "inline");
    assert.ok(btn.eventos[0].codigo.includes("clipboard.writeText"));
  }

  const relatorioInteratividade = gerarRelatorioInteratividade(
    elementos,
    analise,
    associacao,
  );
  assert.ok(relatorioInteratividade.totalInterativos > 0);
  assert.equal(relatorioInteratividade.seletoresNaoEncontrados.length, 0);
  assert.equal(relatorioInteratividade.comEventos.length, 5);
});

test("T-17 processarHtml e salvarResultadoJson devem gerar arquivos JSON válidos na pasta output", async () => {
  const caminhoCode = path.join(__dirname, "code.html");
  const pastaOutput = path.join(__dirname, "output");

  const { resultado } = await processarHtml(caminhoCode, {
    salvarJson: true,
    pastaOutput,
  });

  assert.equal(resultado.arquivo, "code.html");
  assert.equal(resultado.validacao.valido, true);
  assert.equal(resultado.elementosComEventos.length, 5);

  const caminhoCodeJson = path.join(pastaOutput, "code.json");
  assert.ok(fs.existsSync(caminhoCodeJson), "output/code.json deve existir");

  const conteudoJson = fs.readFileSync(caminhoCodeJson, "utf8");
  const parseado = JSON.parse(conteudoJson);

  assert.equal(parseado.arquivo, "code.html");
  assert.equal(parseado.validacao.valido, true);
  assert.ok(parseado.elementos.length > 0);
  assert.ok(parseado.interatividade.vinculos.length > 0);

  // Verifica que o evento em code.json contém o código completo
  const vinculoBtnRun = parseado.interatividade.vinculos.find(
    (v) => v.id === "btn-run-test",
  );
  assert.ok(vinculoBtnRun, "Deve existir vínculo para btn-run-test");
  assert.ok(vinculoBtnRun.codigo.includes("inputEl.value.trim()"));
  assert.equal(vinculoBtnRun.tipoManipulador, "arrow_function");
});

test("T-18 extrairTailwindConfig deve ler os tokens do code.html com a linha de cada um", () => {
  const html = fs.readFileSync(path.join(__dirname, "code.html"), "utf8");
  const elementos = mapearElementos(localizarTags(html), html);
  const config = extrairTailwindConfig(elementos, html);

  assert.equal(config.encontrado, true);
  assert.equal(config.linha, 43);
  assert.deepEqual(config.secoes.colors.primary, { valor: "#adc6ff", linha: 81, origem: "extend" });
  assert.equal(config.secoes.borderRadius.DEFAULT.linha, 97);
  assert.equal(config.secoes.spacing["space-md"].valor, "0.75rem");
  assert.equal(config.totais.colors, 47);
});

test("T-19 resolverClasseTailwind deve resolver variantes, opacidade, valores arbitrários e negativos", () => {
  const config = {
    secoes: {
      colors: { primary: { valor: "#adc6ff", linha: 10 }, "brand-500": { valor: "#123", linha: 11 } },
      spacing: { "space-md": { valor: "0.75rem", linha: 20 } },
      borderRadius: { DEFAULT: { valor: "0.125rem", linha: 30 } },
      fontSize: { "body-sm": { valor: ["12px", { lineHeight: "18px", fontWeight: "400" }], linha: 40 } },
    },
  };

  const hover = resolverClasseTailwind("md:hover:bg-primary/20", config);
  assert.deepEqual(hover.variantes, ["md", "hover"]);
  assert.equal(hover.origem, "tailwind.config");
  assert.equal(hover.token, "primary");
  assert.equal(hover.linhaToken, 10);
  assert.deepEqual(hover.declaracoes, [
    { propriedade: "background-color", valor: "rgba(173, 198, 255, 0.2)" },
  ]);

  assert.equal(resolverClasseTailwind("border-t-brand-500", config).declaracoes[0].propriedade, "border-top-color");
  assert.equal(resolverClasseTailwind("rounded", config).declaracoes[0].valor, "0.125rem");
  assert.equal(resolverClasseTailwind("-mt-space-md", config).declaracoes[0].valor, "-0.75rem");
  assert.equal(resolverClasseTailwind("!px-space-md", config).declaracoes[1].valor, "0.75rem !important");

  const fonte = resolverClasseTailwind("text-body-sm", config);
  assert.deepEqual(fonte.declaracoes, [
    { propriedade: "font-size", valor: "12px" },
    { propriedade: "line-height", valor: "18px" },
    { propriedade: "font-weight", valor: "400" },
  ]);

  const arbitrariaTamanho = resolverClasseTailwind("text-[16px]", config);
  assert.equal(arbitrariaTamanho.origem, "arbitrario");
  assert.equal(arbitrariaTamanho.declaracoes[0].propriedade, "font-size");
  assert.equal(resolverClasseTailwind("text-[#fff]", config).declaracoes[0].propriedade, "color");
  assert.equal(
    resolverClasseTailwind("shadow-[0_0_8px_rgba(0,0,0,0.4)]", config).declaracoes[0].valor,
    "0 0 8px rgba(0,0,0,0.4)",
  );
  assert.equal(resolverClasseTailwind("h-[calc(100vh-140px)]", config).declaracoes[0].valor, "calc(100vh-140px)");

  assert.equal(resolverClasseTailwind("flex", config).origem, "padrao");
  assert.equal(resolverClasseTailwind("p-4", config).origem, "padrao");
});

test("T-20 extrairRegrasCss deve ler regras, @layer, comentários e linhas", () => {
  const css = [
    "/* comentário { com chave } */",
    "@layer base {",
    "  html, body { margin: 0; }",
    "  main > :first-child { margin-top: 0 !important; }",
    "}",
    "@keyframes giro { to { transform: rotate(1turn); } }",
    'a[href^="http"]:hover { background: url(data:image/png;base64,AA==); }',
  ].join("\n");
  const regras = extrairRegrasCss(css);

  assert.equal(regras.length, 4);
  assert.deepEqual(regras[0].seletores, ["html", "body"]);
  assert.equal(regras[0].linha, 3);
  assert.deepEqual(regras[0].contexto, ["@layer base"]);
  assert.deepEqual(regras[1].declaracoes, [{ propriedade: "margin-top", valor: "0", importante: true }]);
  assert.equal(regras[2].tipo, "at-rule");
  assert.equal(regras[3].linha, 7);
  assert.equal(regras[3].declaracoes[0].valor, "url(data:image/png;base64,AA==)");
});

test("T-21 casarSeletor deve avaliar combinadores, pseudo-classes, atributos e estados", () => {
  const html = [
    "<main>",
    '  <div class="card" id="a"><p>1</p><span data-x="ok">2</span></div>',
    '  <div class="card destaque"><p>3</p></div>',
    "</main>",
  ].join("\n");
  const elementos = mapearElementos(localizarTags(html), html);
  const arvore = construirArvore(elementos);
  const casa = (seletor, el) => casarSeletor(analisarSeletor(seletor), el, arvore);
  const [main, card1, p1, span, card2, p3] = elementos;

  assert.ok(casa("main > :first-child", card1));
  assert.equal(casa("main > :first-child", card2), null);
  assert.ok(casa("main p", p3));
  assert.equal(casa("main > p", p1), null);
  assert.ok(casa("p + span", span));
  assert.ok(casa(".card ~ .destaque", card2));
  assert.ok(casa('[data-x="ok"]', span));
  assert.ok(casa(".card:not(.destaque)", card1));
  assert.equal(casa(".card:not(.destaque)", card2), null);
  assert.ok(casa("div:nth-child(2n)", card2));
  assert.deepEqual(casa(".card:hover p", p1).estados, ["hover"]);
  assert.equal(casa("::-webkit-scrollbar", main).pseudoElemento, "-webkit-scrollbar");

  assert.deepEqual(calcularEspecificidade(analisarSeletor("#a .card > p:hover")), [1, 2, 1]);
  assert.deepEqual(calcularEspecificidade(analisarSeletor(":where(#a) p")), [0, 0, 1]);
});

test("T-22 mapearCss deve ligar classes, regras de <style> e style inline aos elementos", async () => {
  const { elementos, css } = await processarHtml("code.html", { salvarJson: false });

  const copiar = buscarPorId(elementos, "copy-link-btn");
  const fundo = copiar.css.classes.find((c) => c.classe === "hover:bg-surface-container-high");
  assert.equal(fundo.origem, "tailwind.config");
  assert.deepEqual(fundo.variantes, ["hover"]);
  assert.equal(fundo.linhaToken, 88);
  assert.deepEqual(fundo.declaracoes, [{ propriedade: "background-color", valor: "#262a31" }]);

  const primeiroDoMain = elementos.find((el) =>
    el.css.regras.some((r) => r.seletor === "main > :first-child"),
  );
  assert.equal(primeiroDoMain.linha, 576);

  const regraBody = css.regras.find((r) => r.seletor === "body");
  assert.equal(regraBody.linha, 27);
  assert.equal(regraBody.totalElementos, 1);
  assert.equal(css.tailwindConfig.linha, 43);

  const index = await processarHtml("index.html", { salvarJson: false });
  const header = buscarElementoPorNome(index.elementos, "header");
  assert.deepEqual(header.css.inline.find((d) => d.propriedade === "background"), {
    propriedade: "background",
    valor: "#1d4ed8",
    importante: false,
  });
  assert.equal(index.css.tailwindConfig.encontrado, false);
});

test("T-23 extrairDeclaracoes deve respeitar ponto e vírgula dentro de parênteses", () => {
  assert.deepEqual(extrairDeclaracoes("color: red; background: url(a;b) !important;"), [
    { propriedade: "color", valor: "red", importante: false },
    { propriedade: "background", valor: "url(a;b)", importante: true },
  ]);
});
