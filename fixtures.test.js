// Bateria de testes sobre os HTMLs de exemplo da pasta fixtures/.
// Cada teste está descrito em TESTES.md (o código F-xx do nome liga os dois).
// Testes marcados com `todo` documentam limitações conhecidas: eles afirmam o
// comportamento correto, falham hoje e não quebram a suíte.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  processarHtml,
  buscarPorId,
  buscarTodosPorNome,
  calcularLinhaColuna,
  analisarFoco,
} = require("./script.js");

const PASTA = path.join(__dirname, "fixtures");

/** Linha (base 1) da primeira ocorrência de `trecho` no arquivo. */
function linhaDe(html, trecho, desde = 0) {
  const pos = html.indexOf(trecho, desde);
  assert.ok(pos >= 0, `trecho não encontrado na fixture: ${trecho}`);
  return html.slice(0, pos).split("\n").length;
}

async function carregar(nome) {
  return processarHtml(path.join(PASTA, nome), { salvarJson: false });
}

const regraDo = (el, seletor) => el.css.regras.find((r) => r.seletor === seletor);
const classeDo = (el, classe) => el.css.classes.find((c) => c.classe === classe);

// --- erros-estruturais.html

test("F-01 erros-estruturais: aponta cada erro com tipo e linha", async () => {
  const { html, validacao } = await carregar("erros-estruturais.html");
  const resumo = validacao.erros.map((e) => [e.tipo, e.tag.nome, e.linha]);

  assert.equal(validacao.valido, false);
  assert.deepEqual(resumo, [
    ["fechamento_orfa", "span", linhaDe(html, "texto</span>")],
    ["fechamento_cruzado", "b", linhaDe(html, "itálico</b>")],
    ["fechamento_orfa", "i", linhaDe(html, "</b></i>")],
    ["fechamento_cruzado", "body", linhaDe(html, "</body>")],
  ]);
  assert.equal(validacao.erros[1].tagPendente.nome, "i");
  // A <section> sem fechamento aparece como pendente quando </body> fecha
  assert.equal(validacao.erros[3].tagPendente.nome, "section");
  assert.equal(validacao.erros[3].tagPendente.linha, linhaDe(html, '<section id="sem-fechamento">'));
});

test("F-02 erros-estruturais: </br> é aviso, não erro", async () => {
  const { html, validacao } = await carregar("erros-estruturais.html");

  assert.equal(validacao.totalAvisos, 1);
  assert.equal(validacao.avisos[0].tipo, "fechamento_elemento_vazio");
  assert.equal(validacao.avisos[0].linha, linhaDe(html, "</br>"));
});

test("F-03 erros-estruturais: tags dentro de comentário são ignoradas e o resto continua mapeado", async () => {
  const { html, tags, elementos } = await carregar("erros-estruturais.html");

  const linhaComentario = linhaDe(html, "Tags dentro de comentário");
  assert.equal(tags.some((t) => t.linha === linhaComentario), false);

  const rodape = buscarPorId(elementos, "rodape");
  assert.equal(rodape.linha, linhaDe(html, '<footer id="rodape">'));
  assert.equal(rodape.texto, '<footer id="rodape">Rodapé correto</footer>');
});

// --- css-puro.html

test("F-04 css-puro: lê o bloco <style> com linha, @media e @keyframes", async () => {
  const { html, css } = await carregar("css-puro.html");
  const regras = css.regras.filter((r) => r.tipo === "regra");

  assert.equal(css.tailwindConfig.encontrado, false);
  assert.equal(css.blocosStyle.length, 1);
  assert.equal(regras.length, 9);
  assert.equal(regras.find((r) => r.seletor === "#titulo").linha, linhaDe(html, "#titulo {"));

  const media = regras.filter((r) => r.contexto.length);
  assert.equal(media.length, 1);
  assert.deepEqual(media[0].contexto, ["@media (max-width: 600px)"]);

  const keyframes = css.regras.find((r) => r.tipo === "at-rule");
  assert.equal(keyframes.seletor, "@keyframes pulsar");
  assert.equal(keyframes.totalElementos, 0);
});

test("F-05 css-puro: liga cada seletor aos elementos certos", async () => {
  const { elementos } = await carregar("css-puro.html");
  const [h1] = buscarTodosPorNome(elementos, "h1");
  const [intro] = buscarTodosPorNome(elementos, "p");
  const [link1, link2] = buscarTodosPorNome(elementos, "a");
  const [li1, li2] = buscarTodosPorNome(elementos, "li");
  const [card, destaque] = elementos.filter((el) => el.classes.includes("card"));
  const [texto, checkbox] = buscarTodosPorNome(elementos, "input");

  assert.ok(regraDo(h1, "#titulo"));
  assert.ok(regraDo(intro, "h1 + p"), "irmão adjacente");
  assert.ok(regraDo(link1, "nav a") && regraDo(link2, "nav a"), "descendente");
  assert.ok(regraDo(li1, "ul > li:first-child"));
  assert.equal(regraDo(li2, "ul > li:first-child"), undefined);
  assert.equal(regraDo(card, ".card.destaque"), undefined);
  assert.ok(regraDo(destaque, ".card.destaque"));
  assert.ok(regraDo(texto, 'input[type="text"]'));
  assert.equal(regraDo(checkbox, 'input[type="text"]'), undefined);

  // .card casa duas vezes: a regra normal e a de dentro do @media
  assert.equal(card.css.regras.filter((r) => r.seletor === ".card").length, 2);
});

test("F-06 css-puro: :hover casa e fica anotado como estado; !important é preservado", async () => {
  const { elementos } = await carregar("css-puro.html");
  const botao = elementos.find((el) => el.classes.includes("btn"));
  const destaque = elementos.find((el) => el.classes.includes("destaque"));

  assert.deepEqual(regraDo(botao, ".btn:hover").estados, ["hover"]);
  assert.deepEqual(regraDo(destaque, ".card.destaque").declaracoes, [
    { propriedade: "border-color", valor: "gold", importante: true },
  ]);
});

test("F-07 css-puro: sem Tailwind, sem scripts e sem style inline", async () => {
  const { css, analiseScripts, relatorio } = await carregar("css-puro.html");

  assert.equal(analiseScripts.scriptsAnalisados, 0);
  assert.equal(relatorio.totalComEventos, 0);
  assert.equal(css.elementosComStyleInline, 0);
  assert.equal(css.classes.tailwindConfig, 0);
  assert.equal(css.classes.arbitrarias, 0);
});

// --- tailwind-puro.html

test("F-08 tailwind-puro: lê theme e theme.extend com a linha de cada token", async () => {
  const { html, css } = await carregar("tailwind-puro.html");
  const { secoes, totais } = css.tailwindConfig;

  assert.equal(css.tailwindConfig.linha, linhaDe(html, "tailwind.config ="));
  assert.deepEqual(totais, { fontFamily: 1, colors: 3, spacing: 1, borderRadius: 1, fontSize: 2 });
  assert.equal(secoes.fontFamily.mono.origem, "theme");
  assert.equal(secoes.colors.brand.origem, "extend");
  // Cores aninhadas: brand.DEFAULT vira "brand" e brand.500 vira "brand-500"
  assert.equal(secoes.colors.brand.valor, "#1d4ed8");
  assert.equal(secoes.colors["brand-500"].linha, linhaDe(html, '500: "#3b82f6"'));
  assert.equal(secoes.spacing.gutter.linha, linhaDe(html, 'gutter: "1rem"'));
});

test("F-09 tailwind-puro: resolve classes do config, variantes, opacidade, negativo e arbitrário", async () => {
  const { elementos } = await carregar("tailwind-puro.html");
  const [h1] = buscarTodosPorNome(elementos, "h1");
  const [p] = buscarTodosPorNome(elementos, "p");
  const card = elementos.find((el) => el.classes.includes("w-[42%]"));

  assert.deepEqual(classeDo(h1, "text-titulo").declaracoes, [
    { propriedade: "font-size", valor: "28px" },
    { propriedade: "line-height", valor: "36px" },
    { propriedade: "font-weight", valor: "600" },
  ]);
  // fontSize na forma ["11px", "14px"]: o segundo item é line-height
  assert.deepEqual(classeDo(p, "text-nota").declaracoes, [
    { propriedade: "font-size", valor: "11px" },
    { propriedade: "line-height", valor: "14px" },
  ]);
  assert.equal(classeDo(p, "text-brand-500/50").declaracoes[0].valor, "rgba(59, 130, 246, 0.5)");
  assert.deepEqual(classeDo(card, "md:rounded-card").variantes, ["md"]);
  assert.deepEqual(classeDo(card, "hover:bg-brand").variantes, ["hover"]);
  assert.equal(classeDo(card, "-mt-gutter").declaracoes[0].valor, "-1rem");
  assert.equal(classeDo(card, "w-[42%]").origem, "arbitrario");
});

test("F-10 tailwind-puro: classes da escala padrão ficam como 'sem token no config'", async () => {
  const { elementos, css } = await carregar("tailwind-puro.html");
  const span = buscarTodosPorNome(elementos, "span")[0];

  assert.equal(classeDo(span, "font-mono").origem, "tailwind.config");
  assert.equal(classeDo(span, "flex").origem, "padrao");
  assert.equal(classeDo(span, "p-4").origem, "padrao");
  assert.deepEqual(css.classes, { distintas: 13, tailwindConfig: 10, arbitrarias: 1, padrao: 2 });
});

test("F-11 tailwind-puro: sem <style>, sem eventos e sem style inline", async () => {
  const { css, analiseScripts, relatorio } = await carregar("tailwind-puro.html");

  assert.equal(css.blocosStyle.length, 0);
  assert.equal(css.regras.length, 0);
  assert.equal(css.elementosComStyleInline, 0);
  // Os <script> do CDN e do config existem, mas não registram eventos
  assert.equal(analiseScripts.scriptsAnalisados, 2);
  assert.equal(analiseScripts.listeners.length, 0);
  assert.equal(relatorio.totalComEventos, 0);
});

// --- com-scripts.html

test("F-12 com-scripts: addEventListener via variável com arrow function", async () => {
  const { html, elementos } = await carregar("com-scripts.html");
  const [ev] = buscarPorId(elementos, "salvar").eventos;

  assert.equal(ev.evento, "click");
  assert.equal(ev.origem, "addEventListenerVariavel");
  assert.equal(ev.tipoManipulador, "arrow_function");
  assert.equal(ev.variavel, "btnSalvar");
  assert.equal(
    calcularLinhaColuna(html, ev.posicao.scriptInicio).linha,
    linhaDe(html, "btnSalvar.addEventListener"),
  );
  assert.match(ev.codigo, /console\.log\("salvou"\);\s*\}$/);
});

test("F-13 com-scripts: addEventListener direto com função nomeada, parâmetros e opções", async () => {
  const { elementos } = await carregar("com-scripts.html");
  const [ev] = buscarPorId(elementos, "cancelar").eventos;

  assert.equal(ev.origem, "addEventListenerDireto");
  assert.equal(ev.tipoManipulador, "funcao_nomeada");
  assert.equal(ev.nomeFuncao, "cancelar");
  assert.deepEqual(ev.parametros, ["e"]);
  assert.equal(ev.opcoes, "{ once: true }");
});

test("F-14 com-scripts: handler por referência (querySelector com #id)", async () => {
  const { elementos } = await carregar("com-scripts.html");
  const [ev] = buscarPorId(elementos, "busca").eventos;

  assert.equal(ev.evento, "input");
  assert.equal(ev.tipoManipulador, "referencia");
  assert.equal(ev.nomeFuncao, "filtrar");
  assert.equal(ev.metodo, "querySelector");
});

test("F-15 com-scripts: propriedade onmouseover por classe vale para todos os .item", async () => {
  const { elementos } = await carregar("com-scripts.html");
  const itens = elementos.filter((el) => el.classes.includes("item"));

  assert.equal(itens.length, 2);
  for (const item of itens) {
    assert.equal(item.eventos.length, 1);
    assert.equal(item.eventos[0].evento, "mouseover");
    assert.equal(item.eventos[0].origem, "propriedadeOn");
    assert.equal(item.eventos[0].tipoManipulador, "funcao_anonima");
  }
});

test("F-16 com-scripts: eventos inline (onclick, onmouseover) usam a linha do próprio elemento", async () => {
  const { html, elementos } = await carregar("com-scripts.html");
  const botao = elementos.find((el) => el.nome === "button" && !el.id);
  const link = buscarPorId(elementos, "link");

  assert.equal(botao.eventos[0].codigo, "alert('inline')");
  assert.equal(botao.eventos[0].posicao.linha, linhaDe(html, "onclick=\"alert('inline')\""));
  assert.equal(link.eventos[0].evento, "mouseover");
  assert.equal(link.eventos[0].codigo, "this.style.color = 'red'");
});

test("F-17 com-scripts: window.addEventListener não é ligado e seletor inexistente é reportado", async () => {
  const { analiseScripts, associacao, relatorio } = await carregar("com-scripts.html");

  const janela = analiseScripts.listeners.find((l) => l.variavel === "window");
  assert.equal(janela.origem, "addEventListenerVariavelDesconhecida");
  assert.deepEqual(associacao.seletoresNaoEncontrados.map((l) => l.seletor), ["#nao-existe"]);
  assert.equal(relatorio.totalComEventos, 7);
});

// --- sem-scripts.html

test("F-18 sem-scripts: página estática válida sem eventos, CSS ou scripts", async () => {
  const { validacao, elementos, analiseScripts, relatorio, css } = await carregar("sem-scripts.html");

  assert.equal(validacao.valido, true);
  assert.equal(validacao.totalAvisos, 0);
  assert.equal(elementos.length, 19);
  assert.equal(analiseScripts.scriptsAnalisados, 0);
  assert.equal(relatorio.totalComEventos, 0);
  assert.equal(css.tailwindConfig.encontrado, false);
  assert.equal(css.regras.length, 0);
  assert.equal(css.classes.distintas, 0);
  assert.equal(css.elementosComStyleInline, 0);
  // Elementos interativos sem evento: nenhum (não há button/a/input)
  assert.equal(relatorio.interativosSemEventos.length, 0);
});

test("F-19 sem-scripts: <img /> autofechável vira elemento vazio com texto exato", async () => {
  const { html, elementos } = await carregar("sem-scripts.html");
  const [img] = buscarTodosPorNome(elementos, "img");

  assert.equal(img.vazio, true);
  assert.equal(img.texto, '<img src="foto.png" alt="Foto" />');
  assert.equal(img.linha, linhaDe(html, "<img"));
});

// --- style-inline.html

test("F-20 style-inline: lê declarações do atributo style", async () => {
  const { elementos, css } = await carregar("style-inline.html");
  const [body] = buscarTodosPorNome(elementos, "body");

  assert.equal(css.elementosComStyleInline, 4);
  assert.deepEqual(body.css.inline, [
    { propriedade: "margin", valor: "0", importante: false },
    { propriedade: "font-family", valor: "Arial, sans-serif", importante: false },
  ]);
  assert.deepEqual(buscarPorId(elementos, "importante").css.inline[0], {
    propriedade: "color",
    valor: "red",
    importante: true,
  });
});

test("F-21 style-inline: ; dentro de url(), propriedade em maiúsculas e aspas simples", async () => {
  const { elementos } = await carregar("style-inline.html");

  assert.deepEqual(buscarPorId(elementos, "url").css.inline, [
    { propriedade: "background", valor: "url(fundo.png?a=1;b=2) no-repeat", importante: false },
    { propriedade: "color", valor: "Blue", importante: false },
  ]);
  assert.equal(buscarPorId(elementos, "aspas-simples").css.inline.length, 2);
});

test("F-22 style-inline: style vazio e elemento sem style não geram declarações", async () => {
  const { elementos, css } = await carregar("style-inline.html");

  assert.deepEqual(buscarPorId(elementos, "vazio").css.inline, []);
  assert.deepEqual(buscarPorId(elementos, "sem-style").css.inline, []);
  assert.equal(css.regras.length, 0);
  assert.equal(css.classes.distintas, 0);
});

// --- Limitações conhecidas (todo: falham hoje sem quebrar a suíte)

test(
  "F-23 limitação: <li> e <p> com fechamento opcional não deveriam ser erro",
  { todo: "o validador não conhece as regras de fechamento implícito do HTML" },
  async () => {
    const { validacao } = await carregar("limitacoes.html");
    assert.equal(validacao.valido, true);
  },
);

test(
  "F-24 limitação: tags dentro de <textarea> não deveriam virar elementos",
  { todo: "o tokenizer só trata <script> e <style> como texto puro" },
  async () => {
    const { elementos } = await carregar("limitacoes.html");
    assert.equal(buscarTodosPorNome(elementos, "b").length, 0);
  },
);

test(
  "F-25 limitação: entidades no onclick deveriam ser decodificadas",
  { todo: "o valor do atributo é usado como está escrito" },
  async () => {
    const { elementos } = await carregar("limitacoes.html");
    assert.equal(buscarPorId(elementos, "entidade").eventos[0].codigo, 'alert("oi")');
  },
);

test(
  "F-26 limitação: el.onclick = function () {...} em várias linhas deveria trazer o corpo inteiro",
  { todo: "a regex de propriedade on... para no fim da linha" },
  async () => {
    const { elementos } = await carregar("limitacoes.html");
    assert.match(buscarPorId(elementos, "multilinha").eventos[0].codigo, /linha 2/);
  },
);

test(
  "F-27 limitação: querySelector(\"form\").addEventListener deveria ligar ao <form>",
  { todo: "o listener direto não classifica seletor de tag" },
  async () => {
    const { elementos } = await carregar("limitacoes.html");
    assert.equal(buscarPorId(elementos, "formulario").eventos.length, 1);
  },
);

test(
  "F-28 limitação: listener dentro de comentário JS não deveria contar",
  { todo: "as regex de script não ignoram comentários" },
  async () => {
    const { elementos } = await carregar("limitacoes.html");
    assert.equal(buscarPorId(elementos, "comentado").eventos.length, 0);
  },
);

test(
  "F-29 limitação: aspa simples solta em atributo sem aspas não deveria engolir o arquivo",
  { todo: "o tokenizer abre uma string em qualquer aspa dentro da tag" },
  async () => {
    const { elementos } = await carregar("limitacao-aspa-solta.html");
    assert.ok(buscarPorId(elementos, "depois"));
    assert.ok(buscarPorId(elementos, "botao"));
  },
);

// --- foco.html (modo foco num elemento)

test("F-30 foco: por tag, só o elemento e seus descendentes entram no escopo", async () => {
  const resultado = await carregar("foco.html");
  const foco = analisarFoco(resultado, "header");

  assert.equal(foco.elemento.nome, "header");
  assert.equal(foco.linhaInicio, linhaDe(resultado.html, '<header id="topo">'));
  assert.equal(foco.linhaFim, linhaDe(resultado.html, "</header>"));
  assert.deepEqual(
    foco.elementos.map((el) => el.nome),
    ["header", "h1", "button", "button", "a"],
  );
  assert.ok(foco.tags.every((t) => t.posicao >= foco.elemento.inicio && t.fim <= foco.elemento.fim));
});

test("F-31 foco: eventos do bloco incluem handler escrito fora dele; eventos de fora ficam de fora", async () => {
  const resultado = await carregar("foco.html");
  const foco = analisarFoco(resultado, "header");
  const ids = foco.comEventos.map((el) => el.id);

  assert.deepEqual(ids, ["menu", null]);
  const [evMenu] = foco.comEventos[0].eventos;
  // O <script> está fora do <header>, mas a linha do handler é encontrada
  assert.equal(
    calcularLinhaColuna(resultado.html, evMenu.posicao.scriptInicio).linha,
    linhaDe(resultado.html, 'menu.addEventListener'),
  );
  assert.equal(ids.includes("comprar"), false);
});

test("F-32 foco: a validação considera só as tags do bloco", async () => {
  const resultado = await carregar("foco.html");

  // O arquivo tem um <p> sem fechamento dentro do <main>...
  assert.equal(resultado.validacao.valido, false);
  // ...mas o <header> está bem formado
  assert.equal(analisarFoco(resultado, "header").validacao.valido, true);
  assert.equal(analisarFoco(resultado, "main").validacao.valido, false);
});

test("F-33 foco: seletor por #id e composto; vários resultados usam o primeiro e informam o total", async () => {
  const resultado = await carregar("foco.html");

  assert.equal(analisarFoco(resultado, "#topo").elemento.nome, "header");

  const card = analisarFoco(resultado, "main .card");
  assert.equal(card.totalCasados, 2);
  assert.equal(card.elemento.linha, linhaDe(resultado.html, '<div class="card">'));
  assert.deepEqual(card.comEventos.map((el) => el.id), ["comprar"]);

  assert.throws(() => analisarFoco(resultado, "footer"), /Nenhum elemento casa com o seletor "footer"/);
});

test("F-34 foco: CSS e interativos sem evento contados só dentro do bloco", async () => {
  const resultado = await carregar("foco.html");
  const foco = analisarFoco(resultado, "header");

  const regra = foco.regrasCss.find((r) => r.seletor === "header button");
  assert.equal(regra.totalNoFoco, 2);
  assert.equal(foco.regrasCss.some((r) => r.seletor === ".card"), false);
  assert.deepEqual(foco.classes.map((c) => c.classe), ["botao"]);
  // O <a> do header é interativo e não tem evento
  assert.deepEqual(foco.interativosSemEventos.map((el) => el.nome), ["a"]);
});
