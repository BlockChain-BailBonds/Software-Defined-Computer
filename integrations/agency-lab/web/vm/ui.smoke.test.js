'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Core = require('./core');
const root = __dirname;

class Element {
  constructor(id = '') {
    this.id = id; this.children = []; this.handlers = {};
    this.value = ''; this.textContent = ''; this.className = '';
    this.dataset = {}; this.style = {};
    this.classList = { toggle: () => {} };
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
  const ctx = vm.createContext({ VComputerCore: Core, document, window, localStorage: storage,
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
