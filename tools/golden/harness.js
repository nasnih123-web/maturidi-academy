/**
 * Golden-fixture harness — runs the ORIGINAL calculator page scripts
 * (fetched from dl.ghadimyol.ir, kept OUTSIDE the repo) inside a Node `vm`
 * context with minimal DOM stubs, and captures their structured outputs.
 *
 * This file is test tooling only. It never ships in the application and
 * the source HTML files themselves are never committed to the repo.
 *
 * Usage: node harness.js <zakat|miras|mosaref> < cases.json > fixtures.json
 * cases.json: array of case objects (shape depends on the calculator).
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC_DIR = process.env.CALC_SOURCES_DIR || path.join(process.env.HOME, 'workspace/.calc-sources');

function extractScript(htmlFile) {
  const html = fs.readFileSync(path.join(SRC_DIR, htmlFile), 'utf8');
  const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no script in ' + htmlFile);
  return m[1];
}

function makeElement() {
  const el = {
    innerHTML: '', textContent: '', value: '', dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    children: [], offsetTop: 0, offsetWidth: 0,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild() {}, insertAdjacentElement() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, setAttribute() {}, scrollIntoView() {},
    focus() {}, select() {}, remove() {}, closest() { return null; },
  };
  return el;
}

function makeContext() {
  const elements = new Map();
  const documentStub = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return makeElement(); },
    addEventListener() {},
    body: makeElement(),
  };
  const ctx = {
    console, document: documentStub,
    setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: {},
    alert() {},
    scrollTo() {},
    addEventListener() {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx, elements };
}

function loadScript(ctx, htmlFile) {
  vm.runInContext(extractScript(htmlFile), ctx, { filename: htmlFile });
}

/* ------------------------------- zakat ------------------------------- */
function runZakat(cases) {
  const { ctx, elements } = makeContext();
  loadScript(ctx, 'zakat.html');
  const captured = [];
  ctx.__capture = (t) => captured.push(String(t));
  vm.runInContext('showResult = function(t){ __capture(t); };', ctx);
  const out = [];
  for (const c of cases) {
    captured.length = 0;
    for (const [id, v] of Object.entries(c.inputs || {})) {
      elements.set(id, Object.assign(makeElement(), { value: String(v) }));
      ctx.document.getElementById(id).value = String(v);
    }
    if (c.arg !== undefined) {
      vm.runInContext(`${c.fn}(${JSON.stringify(c.arg)})`, ctx);
    } else {
      vm.runInContext(`${c.fn}()`, ctx);
    }
    out.push({ id: c.id, fn: c.fn, inputs: c.inputs || {}, arg: c.arg ?? null, text: captured[0] ?? null });
  }
  return out;
}

/* ------------------------------- miras ------------------------------- */
function runMiras(cases) {
  const { ctx, elements } = makeContext();
  loadScript(ctx, 'miras.html');
  const out = [];
  for (const c of cases) {
    vm.runInContext('window.__lastFaraidResult = null;', ctx);
    vm.runInContext(`document.getElementById('result').innerHTML = '';`, ctx);
    const patch = JSON.stringify(c.state);
    vm.runInContext(`(function(p){
      for (const k of Object.keys(state)) {
        if (Array.isArray(state[k])) state[k] = [];
        else if (typeof state[k] === 'boolean') state[k] = false;
        else if (typeof state[k] === 'number') state[k] = 0;
        else if (typeof state[k] === 'string') state[k] = '';
        else state[k] = null;
      }
      state.gender = null; state.sonDescType = null;
      Object.assign(state, p);
    })(${patch})`, ctx);
    vm.runInContext('calculate()', ctx);
    const res = vm.runInContext('window.__lastFaraidResult', ctx);
    const html = elements.get('result') ? elements.get('result').innerHTML : '';
    out.push({
      id: c.id, state: c.state,
      stopped: res == null,
      result: res == null ? null : JSON.parse(JSON.stringify(res)),
      warning: res == null ? String(html).slice(0, 400) : null,
    });
  }
  return out;
}

/* ------------------------------ mosaref ------------------------------ */
const HEADER_KEYS = {
  'معلوم': 'active', 'مجهول': 'passive', 'شکل': 'form',
  'اسم فاعل': 'ism_fail', 'اسم مفعول': 'ism_maful',
  'امر (معلوم)': 'amr_active', 'امر (مجهول)': 'amr_passive',
  'نهی (معلوم)': 'nahi_active', 'نهی (مجهول)': 'nahi_passive',
};
function captionKey(caption, headers, rowLabels) {
  if (caption === 'زمان ماضی') return 'past';
  if (caption === 'زمان مضارع (مرفوع)') return 'present';
  if (caption === 'نفی') return 'nafi';
  if (caption === 'جحد') return 'jahd';
  if (caption === 'لام امر') return 'lam_amr';
  if (caption === 'امر و نهی') return 'amr_nahi';
  if (caption.startsWith('اسم فاعل')) return 'ism_fail_maful';
  if (caption.startsWith('اسم مفعول با حرف جر')) return 'ism_maful_harf_jar';
  if (caption.startsWith('اسم زمان')) {
    return (rowLabels && rowLabels[0] && rowLabels[0].startsWith('(هم‌وزن')) ? 'zaman_same_as_maful' : 'zaman_makan';
  }
  if (caption.startsWith('اسم آلت')) return 'alat';
  if (caption.startsWith('اسم تفضیل')) return 'tafdil';
  return 'unknown:' + caption;
}

// Parse the FINAL rendered HTML (after the page's own post-processing,
// e.g. hamza-seat fixing) into structured tables — this captures exactly
// what a user of the source page sees.
function parseTables(html) {
  const tables = [];
  const tableRe = /<table>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = tableRe.exec(html)) !== null) {
    const body = m[1];
    const caption = (body.match(/<caption>([\s\S]*?)<\/caption>/) || [])[1] || '';
    const headers = [...body.matchAll(/<th>([\s\S]*?)<\/th>/g)].map((x) => x[1]);
    const rowMatches = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map((x) => x[1])
      .filter((r) => r.includes('<td>'));
    const rowLabels = [];
    const columns = headers.slice(1).map(() => []);
    for (const rowHtml of rowMatches) {
      const cells = [...rowHtml.matchAll(/<td>([\s\S]*?)<\/td>/g)]
        .map((x) => x[1]);
      rowLabels.push(cells[0]);
      cells.slice(1).forEach((cell, i) => {
        columns[i].push(cell.includes("class='empty'") ? '' : cell);
      });
    }
    tables.push({
      key: captionKey(caption, headers, rowLabels),
      columns: Object.fromEntries(
        headers.slice(1).map((h, i) => [HEADER_KEYS[h] || h, columns[i]]),
      ),
    });
  }
  return tables;
}

function runMosaref(cases) {
  const { ctx, elements } = makeContext();
  loadScript(ctx, 'mosaref.html');
  const out = [];
  for (const c of cases) {
    ctx.document.getElementById('root').value = c.root;
    ctx.document.getElementById('bab').value = c.bab;
    ctx.document.getElementById('transitivity').value = c.transitivity || 'mutaadi';
    ctx.document.getElementById('harfJar').value = c.harf_jar || 'bi';
    ctx.document.getElementById('output').innerHTML = '';
    vm.runInContext('conjugate()', ctx);
    const html = String(ctx.document.getElementById('output').innerHTML);
    const isError = html.includes("class='error'") || html.includes('class="error"');
    out.push({
      id: c.id, root: c.root, bab: c.bab,
      transitivity: c.transitivity || 'mutaadi', harf_jar: c.harf_jar || 'bi',
      status: isError ? 'error' : 'ok',
      error_html: isError ? html.slice(0, 300) : null,
      tables: isError ? [] : parseTables(html),
    });
  }
  return out;
}

/* -------------------------------- main ------------------------------- */
const which = process.argv[2];
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
const runners = { zakat: runZakat, miras: runMiras, mosaref: runMosaref };
process.stdout.write(JSON.stringify(runners[which](cases), null, 1) + '\n');
