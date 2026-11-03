'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Core = require('./core');
const NTLDiff = require('./ntl_diff');
const root = __dirname;

class Element {
  constructor(id = '') {
    this.id = id; this.children = []; this.handlers = {};
    this.value = ''; this.textContent = ''; this.className = '';
    this.dataset = {}; this.style = {};
    this.classList = { toggle: () => {} };
    this.attributes = {};
    this.hidden = false;
    this.scrollTop = 0; this.scrollHeight = 100;
  }
  appendChild(child) { this.children.push(child); this.firstChild = this.children[0]; return child; }
  append(...children) { for (const c of children) this.appendChild(c); }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); this.firstChild = this.children[0]; }
  replaceChildren(...children) { this.children = [...children]; this.firstChild = this.children[0]; }
  remove() {}
  click() { this.fire('click'); }
  focus() {}
  setRangeText(text) { this.value += text; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  fire(type, event = {}) { for (const h of this.handlers[type] || []) h(event); }
}

function createApp() {
  const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const frames = [];
  const local = new Map();
  const document = {
    readyState: 'complete',
    body: new Element('body'),
    getElementById: id => { if (!elements[id]) throw Error('Unknown HTML ID: ' + id); return elements[id]; },
    createElement: () => new Element(),
    addEventListener: () => {}
  };
  const storage = { getItem: k => local.get(k) || null, setItem: (k, v) => local.set(k, String(v)) };
  const window = { confirm: () => true };
  const ctx = vm.createContext({ VComputerCore: Core, NTLDiff, document, window, localStorage: storage,
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; }, cancelAnimationFrame: () => {},
    setTimeout: () => {}, console, Date, Blob, URL });
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
  const output = () => elements['terminal-output'].children.map(el => el.textContent).join('\n');
  const runFrames = () => {
    let n = 0;
    while (frames.length) { assert.ok(n++ < 400, 'Runaway frame loop'); frames.shift()(n * 100); }
  };
  const command = str => {
    elements['terminal-input'].value = str;
    elements['terminal-input'].fire('keydown', { key: 'Enter', target: elements['terminal-input'], preventDefault: () => {} });
  };
  return { elements, output, runFrames, command, local };
}

test('UI initializes file explorer, memory display, editor and terminal', () => {
  const app = createApp();
  assert.match(app.elements.editor.value, /Fibonacci/);
  assert.ok(app.elements['file-list'].children.length >= 9);
  assert.match(app.elements['memory-view'].textContent, /0000/);
  assert.match(app.output(), /INTERNAL COMPUTER v1/);
});
test('RUN executes a source program and exposes registers and terminal output', () => {
  const app = createApp();
  app.elements['btn-run'].click(); app.runFrames();
  assert.match(app.output(), /Fibonacci:/);
  assert.match(app.output(), /Process exited normally/);
  assert.equal(app.elements['run-state'].textContent, 'HALTED');
  assert.equal(app.elements.r0.textContent, '0037');
});
test('shell creates files, saves edited assembly, and executes it', () => {
  const app = createApp();
  app.command('mkdir /home/guest/work');
  app.command('write /home/guest/work/message.txt "offline computer"');
  app.command('cat /home/guest/work/message.txt');
  assert.match(app.output(), /offline computer/);
  app.elements['btn-new'].click();
  app.elements.editor.value = 'PRINT "smoke test"\nHALT';
  app.elements.editor.fire('input');
  app.elements['btn-save'].click();
  assert.match(app.elements['editor-indicator'].textContent, /SAVED/);
  app.elements['btn-run'].click(); app.runFrames();
  assert.match(app.output(), /smoke test/);
  assert.ok(app.local.has('internal-computer-v1-filesystem'));
});

test('NTL toolbar opens offline comparison, shows differences, saves report to virtual disk', () => {
  const app = createApp();
  app.elements['btn-ntl-mode'].click();
  assert.equal(app.elements['ntl-panel'].hidden, false);
  assert.equal(app.elements['vm-terminal'].hidden, true);
  app.elements['ntl-prompt'].value = 'Explain hashes.';
  app.elements['ntl-a'].value = 'A hash is a digest.';
  app.elements['ntl-b'].value = 'Hashes summarize data.\nThey can detect changes.';
  app.elements['btn-ntl-compare'].click();
  assert.match(app.elements['ntl-result'].textContent, /content-difference/);
  assert.match(app.elements['ntl-result'].textContent, /NOT IDENTIFIED/);
  app.elements['btn-ntl-save'].click();
  assert.match(app.elements['ntl-status'].textContent, /Analysis summary saved/);
  assert.ok(app.elements['file-list'].children.some(e => e.title.includes('ntl_reports/report-')));
  assert.equal(app.elements['run-state'].textContent, 'OFFLINE');
  app.elements['btn-ntl-mode'].click();
  assert.equal(app.elements['vm-terminal'].hidden, false);
});
test('NTL JSON batch compares matched prompts and does not claim identity', () => {
  const app = createApp();
  app.elements['btn-ntl-demo-batch'].click();
  assert.match(app.elements['ntl-result'].textContent, /Matched cases:\s+2/);
  assert.match(app.elements['ntl-result'].textContent, /does not establish model identity/);
  app.elements['btn-ntl-save'].click();
  assert.match(app.elements['ntl-status'].textContent, /Analysis summary saved/);
});
test('terminal ntl command compares two virtual text files and opens the view', () => {
  const app = createApp();
  app.command('write /home/guest/first.txt "Same words."');
  app.command('write /home/guest/second.txt "Same words!"');
  app.command('ntl /home/guest/first.txt /home/guest/second.txt');
  assert.match(app.output(), /word overlap=100.00%/);
  assert.equal(app.elements['ntl-panel'].hidden, false);
  assert.match(app.elements['ntl-result'].textContent, /char.*JSD/i);
});
test('invalid NTL JSON produces error without modifying the existing virtual filesystem', () => {
  const app = createApp();
  const before = app.elements['file-list'].children.length;
  app.elements['ntl-batch-json'].value = '{"format":"NTL_DIFF_BATCH","version":1,"cases":[]}';
  app.elements['btn-ntl-batch'].click();
  assert.match(app.elements['ntl-status'].textContent, /Batch failed/);
  assert.equal(app.elements['file-list'].children.length, before);
});
