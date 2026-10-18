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
} = require("./script.js");

test("extrairAtributos deve extrair id, classes, booleanos e eventos inline com parâmetros", () => {
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

test("extrairAtributos deve lidar com atributos sem aspas e aspas simples", () => {
  const tag = "<input type=text data-tipo='simples' required>";
  const attr = extrairAtributos(tag);

  assert.equal(attr.todos.type, "text");
  assert.equal(attr.todos["data-tipo"], "simples");
  assert.equal(attr.todos.required, true);
});

test("localizarTags deve ignorar tags dentro de comentários HTML", () => {
  const html =
    "<div><!-- <button id='oculto'>Ignorar</button> --><span>Visível</span></div>";
  const tags = localizarTags(html);

  const nomes = tags.map((t) => t.nome);
  assert.deepEqual(nomes, ["div", "span", "span", "div"]);
  assert.ok(!tags.some((t) => t.nome === "button"));
});

test("localizarTags não deve quebrar com > dentro de aspas em atributos", () => {
  const html = '<div title="a > b and c < d"><span>OK</span></div>';
  const tags = localizarTags(html);

  assert.equal(tags.length, 4);
  assert.equal(tags[0].texto, '<div title="a > b and c < d">');
  assert.equal(tags[0].atributos.todos.title, "a > b and c < d");
});

test("localizarTags deve tratar conteúdo de script como texto bruto e não tokenizar tags internas", () => {
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

test("calcularLinhaColuna deve computar linha e coluna 1-based corretamente", () => {
  const html = "linha1\nlinha2\nlinha3";
  const posL3 = html.indexOf("linha3");
  const pos = calcularLinhaColuna(html, posL3);

  assert.equal(pos.linha, 3);
  assert.equal(pos.coluna, 1);
});

test("validarEstrutura deve aprovar HTML bem balanceado", () => {
  const html = "<main><header><h1>Título</h1></header><p>Texto</p></main>";
  const tags = localizarTags(html);
  const relatorio = validarEstrutura(tags);

  assert.equal(relatorio.valido, true);
  assert.equal(relatorio.totalErros, 0);
});

test("validarEstrutura deve detectar tags não fechadas", () => {
  const html = "<div><section><p>Sem fechar div nem section";
  const tags = localizarTags(html);
  const relatorio = validarEstrutura(tags);

  assert.equal(relatorio.valido, false);
  const tipos = relatorio.erros.map((e) => e.tipo);
  assert.ok(tipos.includes("tag_nao_fechada"));
});

test("validarEstrutura deve detectar tags de fechamento órfãs", () => {
  const html = "<div><p>Texto</p></div></span>";
  const tags = localizarTags(html);
  const relatorio = validarEstrutura(tags);

  assert.equal(relatorio.valido, false);
  const orfa = relatorio.erros.find((e) => e.tipo === "fechamento_orfa");
  assert.ok(orfa);
  assert.equal(orfa.tag.nome, "span");
});

test("validarEstrutura deve detectar fechamentos cruzados (aninhamento incorreto)", () => {
  const html = "<p><b><i>texto</b></i></p>";
  const tags = localizarTags(html);
  const relatorio = validarEstrutura(tags);

  assert.equal(relatorio.valido, false);
  const cruzado = relatorio.erros.find((e) => e.tipo === "fechamento_cruzado");
  assert.ok(cruzado);
});

test("mapearElementos deve preservar fatias exatas e indentação original", () => {
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

test("buscas por id, classe e atributos devem funcionar", () => {
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

test("extrairArgumentosChamada e detalharManipulador devem extrair código, parâmetros e opções", () => {
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

test("detalharManipulador deve suportar funções nomeadas e referências", () => {
  const fNomeada = detalharManipulador("function aoClicar(e) { e.preventDefault(); }");
  assert.equal(fNomeada.tipoManipulador, "funcao_nomeada");
  assert.equal(fNomeada.nomeFuncao, "aoClicar");
  assert.deepEqual(fNomeada.parametros, ["e"]);

  const ref = detalharManipulador("meuControlador.aoEnviar");
  assert.equal(ref.tipoManipulador, "referencia");
  assert.equal(ref.nomeFuncao, "meuControlador.aoEnviar");
});

test("analisarScripts e associarEventos deve vincular listeners JS e IDs em index.html com mapeamento completo", () => {
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

test("validação estrutural de code.html deve ser 100% válida e associar eventos com código completo", () => {
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

test("processarHtml e salvarResultadoJson devem gerar arquivos JSON válidos na pasta output", async () => {
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
