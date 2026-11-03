/* Internal Computer: deterministic, offline, 16-bit virtual machine.
 * No eval(), Function(), remote requests, or access to host files/processes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VComputerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FS_LIMIT = 1024 * 1024;
  const FILE_LIMIT = 128 * 1024;
  const ENTRY_LIMIT = 500;
  const MAX_PATH = 256;
  const MAX_SOURCE_LINES = 5000;
  const MAX_INSTRUCTIONS = 3000;
  const RAM_SIZE = 65536;
  const CYCLE_LIMIT = 100000;
  const utf8Size = s => new TextEncoder().encode(s).length;
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const normal = (path, cwd = '/home/guest') => {
    assert(typeof path === 'string' && path.length > 0 && !path.includes('\0'), 'Invalid path');
    let p = path === '~' ? '/home/guest' : path.startsWith('~/') ? '/home/guest/' + path.slice(2) : path;
    if (!p.startsWith('/')) p = cwd + '/' + p;
    const parts = [];
    for (const bit of p.split('/')) {
      if (bit === '' || bit === '.') continue;
      if (bit === '..') { parts.pop(); continue; }
      assert(bit.length <= 100 && !/[\x00-\x1f]/.test(bit), 'Invalid path segment');
      parts.push(bit);
    }
    const result = '/' + parts.join('/');
    assert(result.length <= MAX_PATH, 'Path too long');
    return result;
  };
  const parentOf = path => path === '/' ? null : (path.slice(0, path.lastIndexOf('/')) || '/');
  class VirtualFS {
    constructor(seed = true) {
      this.entries = { '/': { type: 'dir' } };
      if (seed) this.seed();
    }
    seed() {
      for (const dir of ['/home', '/home/guest', '/programs', '/docs']) this.mkdir(dir);
      this.write('/programs/hello.asm', '; 16-bit VM: Hello World\nPRINT "Hello from the internal computer."\nPRINT "The CPU is virtual. Your files stay in this browser."\nHALT\n');
      this.write('/programs/fibonacci.asm', '; First ten Fibonacci numbers\nPRINT "Fibonacci:"\nMOV R0, 0\nMOV R1, 1\nMOV R2, 10\nloop:\n  PRINT R0\n  MOV R3, R1\n  ADD R3, R0\n  MOV R0, R1\n  MOV R1, R3\n  DEC R2\n  JNZ loop\nHALT\n');
      this.write('/programs/memory.asm', '; Store/load a 16-bit number in virtual RAM\nMOV R0, 918\nSTORE [0x0100], R0\nLOAD R1, [0x0100]\nPRINT "Value loaded from RAM:"\nPRINT R1\nHALT\n');
      this.write('/programs/countdown.asm', '; Countdown using a conditional jump\nMOV R0, 5\nagain:\n  PRINT R0\n  DEC R0\n  JNZ again\nPRINT "Liftoff"\nHALT\n');
      this.write('/docs/README.txt', 'INTERNAL COMPUTER v1\n\nOpen .asm programs from /programs.\nUse Run to execute or Step to inspect individual instructions.\nCPU: 8 x 16-bit registers, 64 KiB RAM, labels and instructions.\nVirtual filesystem persists in local browser storage.\nNo host shell, network, device, or external AI access.\nType help in the terminal for commands.\n');
    }
    path(path, cwd) { return normal(path, cwd); }
    get(path, cwd) { const p = normal(path, cwd); return this.entries[p] || null; }
    mustGet(path, cwd) { const p = normal(path, cwd); assert(this.entries[p], 'Not found: ' + p); return this.entries[p]; }
    mustParent(p) { const parent = parentOf(p); assert(parent !== null && this.entries[parent]?.type === 'dir', 'Parent directory missing: ' + parent); }
    mkdir(path, cwd) {
      const p = normal(path, cwd);
      assert(p !== '/' && !this.entries[p], 'Already exists: ' + p);
      this.mustParent(p);
      assert(Object.keys(this.entries).length < ENTRY_LIMIT, 'Filesystem entry limit reached');
      this.entries[p] = { type: 'dir' };
      return p;
    }
    write(path, content, cwd) {
      const p = normal(path, cwd);
      assert(typeof content === 'string', 'File content must be text');
      assert(utf8Size(content) <= FILE_LIMIT, 'File exceeds 128 KiB limit');
      this.mustParent(p);
      assert(!this.entries[p] || this.entries[p].type === 'file', 'Cannot overwrite directory');
      const old = this.entries[p]?.type === 'file' ? utf8Size(this.entries[p].content) : 0;
      const used = this.usage() - old + utf8Size(content);
      assert(used <= FS_LIMIT, 'Virtual disk full (1 MiB limit)');
      assert(this.entries[p] || Object.keys(this.entries).length < ENTRY_LIMIT, 'Filesystem entry limit reached');
      this.entries[p] = { type: 'file', content };
      return p;
    }
    read(path, cwd) { const p = normal(path, cwd); const e = this.mustGet(p); assert(e.type === 'file', 'Not a file: ' + p); return e.content; }
    list(path = '.', cwd = '/home/guest') {
      const p = normal(path, cwd), item = this.mustGet(p);
      if (item.type === 'file') return [{ path: p, name: p.split('/').pop(), type: 'file' }];
      const prefix = p === '/' ? '/' : p + '/';
      return Object.entries(this.entries).filter(([q]) => q !== p && q.startsWith(prefix) && !q.slice(prefix.length).includes('/'))
        .map(([q, e]) => ({ path: q, name: q.slice(prefix.length), type: e.type }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    }
    tree(path = '/', cwd = '/home/guest') {
      const p = normal(path, cwd); this.mustGet(p);
      return Object.keys(this.entries).filter(q => q === p || q.startsWith(p === '/' ? '/' : p + '/')).sort();
    }
    remove(path, cwd) {
      const p = normal(path, cwd); assert(p !== '/', 'Cannot remove filesystem root');
      this.mustGet(p);
      const targets = Object.keys(this.entries).filter(q => q === p || q.startsWith(p + '/'));
      assert(targets.length === 1, 'Directory is not empty: ' + p);
      delete this.entries[p];
    }
    move(src, dst, cwd, keep = false) {
      const a = normal(src, cwd), b = normal(dst, cwd);
      assert(a !== '/' && b !== '/' && a !== b, 'Invalid move/copy target');
      const entry = this.mustGet(a);
      assert(!this.entries[b], 'Destination exists: ' + b);
      this.mustParent(b);
      assert(!(b + '/').startsWith(a + '/'), 'Cannot move directory into itself');
      const descendants = this.tree(a);
      assert(Object.keys(this.entries).length + (keep ? descendants.length : 0) <= ENTRY_LIMIT, 'Filesystem entry limit reached');
      for (const p of descendants) {
        const dest = b + p.slice(a.length);
        assert(!this.entries[dest], 'Destination conflict: ' + dest);
      }
      if (keep) {
        const extra = descendants.reduce((s, p) => s + (this.entries[p].type === 'file' ? utf8Size(this.entries[p].content) : 0), 0);
        assert(this.usage() + extra <= FS_LIMIT, 'Virtual disk full');
      }
      const items = descendants.map(p => [b + p.slice(a.length), clone(this.entries[p])]);
      if (!keep) for (const p of descendants) delete this.entries[p];
      for (const [p, e] of items) this.entries[p] = e;
      return { from: a, to: b, type: entry.type };
    }
    usage() { return Object.values(this.entries).reduce((s, e) => s + (e.type === 'file' ? utf8Size(e.content) : 0), 0); }
    snapshot() { return { version: 1, entries: clone(this.entries) }; }
    restore(payload) {
      assert(payload && payload.version === 1 && payload.entries && typeof payload.entries === 'object' && !Array.isArray(payload.entries), 'Invalid filesystem backup');
      const raw = payload.entries, keys = Object.keys(raw), clean = Object.create(null);
      assert(keys.length > 0 && keys.length <= ENTRY_LIMIT && raw['/']?.type === 'dir', 'Invalid filesystem entries');
      let total = 0;
      for (const p of keys) {
        assert(normal(p, '/') === p, 'Invalid canonical path: ' + p);
        const value = raw[p];
        assert(value && (value.type === 'dir' || value.type === 'file'), 'Invalid entry type');
        assert(value.type === 'dir' ? value.content === undefined : typeof value.content === 'string', 'Invalid entry content');
        if (value.type === 'file') { const size = utf8Size(value.content); assert(size <= FILE_LIMIT, 'File too large'); total += size; }
        clean[p] = value.type === 'dir' ? { type: 'dir' } : { type: 'file', content: value.content };
      }
      assert(total <= FS_LIMIT, 'Backup exceeds virtual disk capacity');
      for (const p of keys) if (p !== '/') assert(clean[parentOf(p)]?.type === 'dir', 'Missing parent directory: ' + p);
      this.entries = Object.assign({}, clean);
    }
  }
  function splitOperands(source) {
    const pieces = [];
    let part = '', quote = '', escaped = false, brackets = 0;
    for (const c of source) {
      if (quote) {
        part += c;
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") { quote = c; part += c; }
      else if (c === '[') { brackets++; part += c; }
      else if (c === ']') { brackets--; assert(brackets >= 0, 'Invalid memory operand'); part += c; }
      else if (c === ',' && brackets === 0) { pieces.push(part.trim()); part = ''; }
      else part += c;
    }
    assert(!quote && brackets === 0, 'Unclosed quote or memory operand');
    if (part.trim() || pieces.length) pieces.push(part.trim());
    return pieces;
  }
  function uncomment(line) {
    let quote = '', escaped = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ';') return line.slice(0, i);
    }
    return line;
  }
  const INSTRUCTIONS = {
    NOP: 0, HALT: 0, MOV: 2, ADD: 2, SUB: 2, MUL: 2, DIV: 2, MOD: 2,
    AND: 2, OR: 2, XOR: 2, SHL: 2, SHR: 2, CMP: 2,
    INC: 1, DEC: 1, JMP: 1, JZ: 1, JNZ: 1, JG: 1, JL: 1,
    LOAD: 2, STORE: 2, PUSH: 1, POP: 1, PRINT: 1, PRINTC: 1
  };
  function parseText(t) {
    if (t.startsWith('"')) { assert(t.endsWith('"'), 'Unclosed string'); try { return JSON.parse(t); } catch { throw new Error('Invalid quoted string'); } }
    if (t.startsWith("'")) {
      assert(t.endsWith("'"), 'Unclosed string');
      return t.slice(1, -1).replace(/\\([\\'nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', "'": "'", '\\': '\\' })[c]);
    }
    return null;
  }
  function compile(source) {
    assert(typeof source === 'string' && utf8Size(source) <= FILE_LIMIT, 'Program source exceeds limit');
    const lines = source.split(/\r?\n/);
    assert(lines.length <= MAX_SOURCE_LINES, 'Program has too many lines');
    const labels = Object.create(null), code = [];
    for (let i = 0; i < lines.length; i++) {
      let line = uncomment(lines[i]).trim();
      if (!line) continue;
      while (true) {
        const match = line.match(/^([A-Za-z_][\w]*):\s*/);
        if (!match) break;
        const label = match[1].toLowerCase();
        assert(labels[label] === undefined, 'Duplicate label ' + label + ' at line ' + (i + 1));
        labels[label] = code.length;
        line = line.slice(match[0].length).trim();
        if (!line) break;
      }
      if (!line) continue;
      const match = line.match(/^([A-Za-z]+)(?:\s+(.+))?$/);
      assert(match, 'Invalid instruction on line ' + (i + 1));
      const op = match[1].toUpperCase();
      assert(Object.prototype.hasOwnProperty.call(INSTRUCTIONS, op), 'Unknown opcode ' + op + ' on line ' + (i + 1));
      const args = match[2] ? splitOperands(match[2]) : [];
      assert(args.length === INSTRUCTIONS[op] && args.every(Boolean), 'Wrong operand count for ' + op + ' on line ' + (i + 1));
      code.push({ op, args, line: i + 1 });
      assert(code.length <= MAX_INSTRUCTIONS, 'Program exceeds instruction limit');
    }
    assert(code.length > 0, 'Program is empty');
    const jump = new Set(['JMP', 'JZ', 'JNZ', 'JG', 'JL']);
    const reg = /^R[0-7]$/i;
    const mem = /^\[(.+)\]$/;
    const validVal = x => reg.test(x) || /^-?(?:0x[0-9a-f]+|\d+)$/i.test(x);
    const requireValue = (x, line) => assert(validVal(x), 'Invalid numeric operand ' + x + ' at line ' + line);
    for (const ins of code) {
      const { op, args: a, line } = ins;
      if (jump.has(op)) {
        const target = a[0].toLowerCase();
        assert(labels[target] !== undefined || /^\d+$/.test(target), 'Unknown jump target ' + a[0] + ' at line ' + line);
        const dest = labels[target] !== undefined ? labels[target] : Number(target);
        assert(dest >= 0 && dest < code.length, 'Jump target outside program at line ' + line);
        ins.target = dest;
      } else if (op === 'PRINT' || op === 'PRINTC') {
        if (op === 'PRINT' && parseText(a[0]) !== null) ins.literal = parseText(a[0]);
        else requireValue(a[0], line);
      } else if (op === 'LOAD') {
        assert(reg.test(a[0]) && mem.test(a[1]), 'LOAD requires register, [address] at line ' + line);
        requireValue(a[1].match(mem)[1].trim(), line);
      } else if (op === 'STORE') {
        assert(mem.test(a[0]), 'STORE requires [address], value at line ' + line);
        requireValue(a[0].match(mem)[1].trim(), line); requireValue(a[1], line);
      } else if (['MOV','ADD','SUB','MUL','DIV','MOD','AND','OR','XOR','SHL','SHR'].includes(op)) {
        assert(reg.test(a[0]), op + ' destination must be R0-R7 at line ' + line); requireValue(a[1], line);
      } else if (op === 'CMP') { requireValue(a[0], line); requireValue(a[1], line); }
      else if (['INC','DEC','POP'].includes(op)) assert(reg.test(a[0]), op + ' needs R0-R7 at line ' + line);
      else if (op === 'PUSH') requireValue(a[0], line);
    }
    return { code, labels };
  }
  class VirtualCPU {
    constructor(onOutput) {
      this.onOutput = typeof onOutput === 'function' ? onOutput : () => {};
      this.reset();
    }
    reset() {
      this.ram = new Uint8Array(RAM_SIZE);
      this.regs = new Uint16Array(8);
      this.pc = 0; this.sp = 0xFFFE; this.z = false; this.g = false; this.l = false;
      this.halted = true; this.cycles = 0; this.program = null; this.fault = null;
    }
    load(source) {
      const assembled = compile(source);
      this.reset(); this.program = assembled; this.halted = false;
      return assembled.code.length;
    }
    value(x) {
      const text = x.trim();
      if (/^R[0-7]$/i.test(text)) return this.regs[Number(text[1])];
      const n = /^-?0x/i.test(text) ? Number.parseInt(text, 16) : Number(text);
      assert(Number.isInteger(n) && Number.isSafeInteger(n), 'Invalid numeric value: ' + text);
      return n;
    }
    address(x) {
      const m = x.trim().match(/^\[(.+)\]$/);
      assert(m, 'Expected [address]: ' + x);
      const at = this.value(m[1]);
      assert(at >= 0 && at < RAM_SIZE - 1, '16-bit RAM access out of range: ' + at);
      return at;
    }
    read16(at) { return this.ram[at] | (this.ram[at + 1] << 8); }
    write16(at, v) { this.ram[at] = v & 255; this.ram[at + 1] = (v >>> 8) & 255; }
    setReg(r, v) { const n = Number(r[1]); this.regs[n] = v & 0xffff; this.z = this.regs[n] === 0; }
    step() {
      if (!this.program) throw new Error('No program loaded');
      if (this.halted) return { state: 'halted', cycles: this.cycles };
      if (this.cycles >= CYCLE_LIMIT) {
        this.halted = true; this.fault = 'Cycle limit reached (' + CYCLE_LIMIT + ')'; throw new Error(this.fault);
      }
      if (this.pc >= this.program.code.length) { this.halted = true; return { state: 'halted', cycles: this.cycles }; }
      const ins = this.program.code[this.pc];
      const { op, args: a } = ins;
      this.pc++; this.cycles++;
      try {
        if (op === 'NOP') {}
        else if (op === 'HALT') this.halted = true;
        else if (op === 'MOV') this.setReg(a[0], this.value(a[1]));
        else if (['ADD','SUB','MUL','DIV','MOD','AND','OR','XOR','SHL','SHR'].includes(op)) {
          const x = this.value(a[0]), y = this.value(a[1]); let v;
          if (op === 'ADD') v = x + y;
          else if (op === 'SUB') v = x - y;
          else if (op === 'MUL') v = x * y;
          else if (op === 'DIV') { assert(y !== 0, 'Division by zero'); v = Math.trunc(x / y); }
          else if (op === 'MOD') { assert(y !== 0, 'Modulo by zero'); v = x % y; }
          else if (op === 'AND') v = x & y;
          else if (op === 'OR') v = x | y;
          else if (op === 'XOR') v = x ^ y;
          else if (op === 'SHL') v = x << (y & 15);
          else v = x >>> (y & 15);
          this.setReg(a[0], v);
        } else if (op === 'INC') this.setReg(a[0], this.value(a[0]) + 1);
        else if (op === 'DEC') this.setReg(a[0], this.value(a[0]) - 1);
        else if (op === 'CMP') {
          const x = this.value(a[0]) & 0xffff, y = this.value(a[1]) & 0xffff;
          this.z = x === y; this.g = x > y; this.l = x < y;
        } else if (op === 'JMP' || (op === 'JZ' && this.z) || (op === 'JNZ' && !this.z) || (op === 'JG' && this.g) || (op === 'JL' && this.l)) this.pc = ins.target;
        else if (op === 'LOAD') this.setReg(a[0], this.read16(this.address(a[1])));
        else if (op === 'STORE') this.write16(this.address(a[0]), this.value(a[1]));
        else if (op === 'PUSH') {
          assert(this.sp >= 0xC002, 'Stack overflow');
          this.sp -= 2; this.write16(this.sp, this.value(a[0]));
        } else if (op === 'POP') {
          assert(this.sp < 0xFFFE, 'Stack underflow');
          this.setReg(a[0], this.read16(this.sp)); this.sp += 2;
        } else if (op === 'PRINT') this.onOutput(ins.literal !== undefined ? ins.literal : String(this.value(a[0])));
        else if (op === 'PRINTC') this.onOutput(String.fromCharCode(this.value(a[0]) & 255));
      } catch (err) {
        this.halted = true; this.fault = 'Line ' + ins.line + ': ' + err.message;
        throw new Error(this.fault);
      }
      if (this.pc >= this.program.code.length) this.halted = true;
      return { state: this.halted ? 'halted' : 'ready', cycles: this.cycles, line: ins.line, pc: this.pc };
    }
    run(maxSteps = CYCLE_LIMIT) {
      assert(Number.isInteger(maxSteps) && maxSteps > 0, 'maxSteps must be positive integer');
      let count = 0;
      while (!this.halted && count < maxSteps) { this.step(); count++; }
      return { steps: count, halted: this.halted, cycles: this.cycles };
    }
    ramView(start = 0, length = 64) {
      assert(Number.isInteger(start) && start >= 0 && start < RAM_SIZE, 'Invalid memory offset');
      assert(Number.isInteger(length) && length >= 1 && length <= 256, 'Memory view must be 1-256 bytes');
      return Array.from(this.ram.slice(start, Math.min(start + length, RAM_SIZE)));
    }
    state() {
      return { regs: Array.from(this.regs), pc: this.pc, sp: this.sp, z: this.z, g: this.g, l: this.l,
        cycles: this.cycles, halted: this.halted, fault: this.fault, instructions: this.program?.code.length ?? 0 };
    }
  }
  function shellWords(raw) {
    const result = []; let cur = '', quoted = '', escaped = false, started = false;
    for (const ch of raw) {
      if (escaped) { cur += ch === 'n' ? '\n' : ch === 't' ? '\t' : ch; escaped = false; started = true; }
      else if (ch === '\\') escaped = true;
      else if (quoted) { if (ch === quoted) quoted = ''; else cur += ch; }
      else if (ch === '"' || ch === "'") { quoted = ch; started = true; }
      else if (/\s/.test(ch)) { if (started) { result.push(cur); cur = ''; started = false; } }
      else { cur += ch; started = true; }
    }
    assert(!quoted && !escaped, 'Unclosed quote or escape');
    if (started) result.push(cur);
    return result;
  }
  return { VirtualFS, VirtualCPU, compile, normal, shellWords,
    constants: { FS_LIMIT, FILE_LIMIT, ENTRY_LIMIT, RAM_SIZE, CYCLE_LIMIT } };
});
