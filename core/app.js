/* Browser user interface for the offline internal computer. */
(function () {
  'use strict';
  const Core = globalThis.VComputerCore;
  const STORAGE = 'internal-computer-v1-filesystem';
  const $ = id => document.getElementById(id);
  const fs = new Core.VirtualFS();
  const cpu = new Core.VirtualCPU(text => terminalLine(String(text), 'program'));
  let cwd = '/home/guest';
  let activePath = '/programs/fibonacci.asm';
  let loadedPath = '';
  let loadedSource = '';
  let editorDirty = false;
  let running = false;
  let frame = null;
  let commandHistory = [];
  let historyIndex = -1;
  let terminalCount = 0;
  let terminalMax = 1200;
  let clockStart = Date.now();
  let memoryStart = 0;

  function terminalLine(message, kind = 'normal') {
    const content = $('terminal-output');
    for (const raw of String(message).split('\n')) {
      if (terminalCount >= terminalMax) { content.removeChild(content.firstChild); terminalCount--; }
      const el = document.createElement('div');
      el.className = 'term-line ' + kind;
      el.textContent = raw || '\u00a0';
      content.appendChild(el); terminalCount++;
    }
    content.scrollTop = content.scrollHeight;
  }
  function status(message, problem = false) {
    $('status-note').textContent = message;
    $('status-note').classList.toggle('warning', problem);
  }
  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify(fs.snapshot())); $('save-state').textContent = 'LOCAL DISK SAVED'; }
    catch (err) { $('save-state').textContent = 'DISK NOT SAVED'; terminalLine('Warning: browser storage unavailable or full. Export your disk to preserve changes.', 'error'); }
    renderDisk();
  }
  function restoreLocal() {
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved) { fs.restore(JSON.parse(saved)); return true; }
    } catch (err) { terminalLine('Could not read saved disk; loaded factory filesystem: ' + err.message, 'error'); }
    return false;
  }
  function pathName(p) { return p === '/' ? '/' : p.split('/').pop(); }
  function openFile(path, force = false) {
    if (!force && editorDirty && !window.confirm('Discard unsaved changes in the editor?')) return;
    const p = fs.path(path, cwd);
    const value = fs.read(p);
    activePath = p;
    $('editor-path').value = p;
    $('editor').value = value;
    editorDirty = false;
    $('editor-indicator').textContent = 'SAVED';
    renderExplorer();
    status('Editing ' + p);
  }
  function saveEditor() {
    try {
      const p = fs.path($('editor-path').value.trim(), cwd);
      fs.write(p, $('editor').value);
      activePath = p; editorDirty = false;
      $('editor-indicator').textContent = 'SAVED';
      persist(); renderExplorer();
      status('Saved ' + p);
      terminalLine('Saved ' + p, 'success');
    } catch (err) { status(err.message, true); terminalLine('Save failed: ' + err.message, 'error'); }
  }
  function renderExplorer() {
    const root = $('file-list'); root.replaceChildren();
    const entries = fs.tree('/').filter(p => p !== '/');
    for (const p of entries) {
      const entry = fs.get(p);
      const row = document.createElement('button');
      const depth = p.split('/').length - 2;
      row.className = 'file-entry' + (p === activePath ? ' active' : '');
      row.style.paddingLeft = (12 + Math.min(depth, 10) * 13) + 'px';
      row.title = p;
      const ico = document.createElement('span');
      ico.className = 'file-icon'; ico.textContent = entry.type === 'dir' ? '▸' : '⌁';
      const name = document.createElement('span');
      name.className = 'file-name'; name.textContent = pathName(p);
      row.append(ico, name);
      row.addEventListener('click', () => {
        if (entry.type === 'file') { try { openFile(p); } catch (e) { terminalLine(e.message, 'error'); } }
        else { cwd = p; terminalLine('Current directory: ' + cwd, 'muted'); updatePrompt(); }
      });
      root.append(row);
    }
  }
  function renderDisk() {
    const used = fs.usage();
    $('disk-used').textContent = (used / 1024).toFixed(1) + ' / 1024 KiB';
    $('disk-bar').style.width = Math.min(100, (used / Core.constants.FS_LIMIT) * 100) + '%';
    $('disk-count').textContent = Object.keys(fs.entries).length + ' filesystem entries';
  }
  function renderCPU() {
    const s = cpu.state();
    for (let i = 0; i < 8; i++) {
      $("r" + i).textContent = s.regs[i].toString(16).padStart(4, '0').toUpperCase();
      $("rv" + i).textContent = s.regs[i].toString(10);
    }
    $('pc').textContent = String(s.pc).padStart(4, '0');
    $('sp').textContent = s.sp.toString(16).padStart(4, '0').toUpperCase();
    $('cycles').textContent = s.cycles.toLocaleString();
    $('flags').textContent = 'Z ' + Number(s.z) + '   G ' + Number(s.g) + '   L ' + Number(s.l);
    $('run-state').textContent = running ? 'RUNNING' : s.fault ? 'FAULT' : !cpu.program ? 'OFFLINE' : s.halted ? 'HALTED' : 'READY';
    $('run-state').dataset.state = running ? 'running' : s.fault ? 'fault' : s.halted ? 'halted' : 'ready';
    $('loaded-label').textContent = loadedPath ? pathName(loadedPath) : 'NONE';
    $('machine-instructions').textContent = s.instructions + ' INSTRUCTIONS';
    renderMemory();
  }
  function renderMemory() {
    const lines = [], end = Math.min(65536, memoryStart + 128);
    for (let at = memoryStart; at < end; at += 16) {
      const arr = cpu.ramView(at, Math.min(16, end - at));
      const hex = arr.map(v => v.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const ascii = arr.map(v => (v >= 32 && v <= 126) ? String.fromCharCode(v) : '.').join('');
      lines.push(at.toString(16).padStart(4, '0').toUpperCase() + '  ' + hex.padEnd(47) + '  ' + ascii);
    }
    $('memory-view').textContent = lines.join('\n');
    $('memory-offset').value = '0x' + memoryStart.toString(16).padStart(4, '0').toUpperCase();
  }
  function setMemoryOffset(raw) {
    const n = /^0x/i.test(raw) ? parseInt(raw, 16) : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error('Memory offset must be 0..65535');
    memoryStart = Math.min(65535, Math.floor(n / 16) * 16);
    renderMemory();
  }
  function pause() {
    running = false;
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    renderCPU();
  }
  function bootSource(source, name) {
    pause();
    const count = cpu.load(source);
    loadedSource = source; loadedPath = name;
    terminalLine('CPU loaded ' + count + ' instructions from ' + name, 'success');
    status('Program ready: ' + name);
    renderCPU();
  }
  function sourceFromEditor() {
    const src = $('editor').value;
    const name = fs.path($('editor-path').value || activePath, cwd) + (editorDirty ? ' [unsaved buffer]' : '');
    return { src, name };
  }
  function runProgram(fromEditor = false, path = '') {
    try {
      if (path) { const p = fs.path(path, cwd); bootSource(fs.read(p), p); }
      else if (fromEditor || !cpu.program || cpu.halted) {
        const { src, name } = sourceFromEditor(); bootSource(src, name);
      }
      if (running) return;
      running = true; renderCPU(); status('Executing on the local virtual CPU');
      let lastRender = 0;
      const tick = ts => {
        if (!running) return;
        try {
          for (let i = 0; i < 300 && !cpu.halted; i++) cpu.step();
          if (ts - lastRender > 80 || cpu.halted) { renderCPU(); lastRender = ts; }
          if (cpu.halted) {
            running = false; frame = null; renderCPU();
            terminalLine('Process exited normally (' + cpu.cycles.toLocaleString() + ' cycles).', 'success');
            status('Execution complete');
          } else frame = requestAnimationFrame(tick);
        } catch (err) {
          pause(); terminalLine('Runtime error: ' + err.message, 'error'); status(err.message, true);
        }
      };
      frame = requestAnimationFrame(tick);
    } catch (err) { pause(); terminalLine('Error: ' + err.message, 'error'); status(err.message, true); }
  }
  function stepProgram() {
    pause();
    try {
      if (!cpu.program || cpu.halted) { const { src, name } = sourceFromEditor(); bootSource(src, name); }
      const result = cpu.step(); renderCPU();
      status('Executed line ' + result.line + ', program counter ' + result.pc);
      if (cpu.halted) terminalLine('Process halted after ' + cpu.cycles + ' cycles.', 'success');
    } catch (err) { pause(); terminalLine('Step error: ' + err.message, 'error'); status(err.message, true); }
  }
  function makeDownload(name, content, type) {
    const data = new Blob([content], { type });
    const url = URL.createObjectURL(data);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function exportDisk() {
    const pack = { format: 'INTERNAL_COMPUTER_BACKUP', version: 1, timestamp: new Date().toISOString(), filesystem: fs.snapshot() };
    makeDownload('internal-computer-backup.json', JSON.stringify(pack, null, 2), 'application/json');
    terminalLine('Downloaded filesystem backup JSON.', 'success');
  }
  async function importDisk(file) {
    if (!file) return;
    try {
      if (file.size > 1.6 * 1024 * 1024) throw new Error('Import is too large');
      const raw = await file.text();
      const pack = JSON.parse(raw);
      if (pack.format !== 'INTERNAL_COMPUTER_BACKUP' || pack.version !== 1) throw new Error('Unsupported backup format');
      const candidate = new Core.VirtualFS(false);
      candidate.restore(pack.filesystem);
      if (!window.confirm('Replace the current virtual disk with the imported backup?')) return;
      pause(); fs.restore(candidate.snapshot()); persist();
      cwd = fs.get('/home/guest')?.type === 'dir' ? '/home/guest' : '/';
      const first = fs.tree('/').find(p => fs.get(p)?.type === 'file');
      activePath = first || '/home/guest/new.asm';
      $('editor-path').value = activePath;
      $('editor').value = first ? fs.read(first) : '';
      editorDirty = false; $('editor-indicator').textContent = 'SAVED';
      cpu.reset(); loadedPath = ''; loadedSource = '';
      renderExplorer(); renderCPU(); updatePrompt();
      terminalLine('Virtual disk successfully restored from backup.', 'success'); status('Backup imported');
    } catch (err) { terminalLine('Import rejected: ' + err.message, 'error'); status(err.message, true); }
    finally { $('import-file').value = ''; }
  }
  function updatePrompt() { $('prompt-prefix').textContent = 'guest@internal:' + cwd + '$'; }
  function shell(raw) {
    terminalLine('guest@internal:' + cwd + '$ ' + raw, 'command');
    let words;
    try { words = Core.shellWords(raw); } catch (err) { terminalLine(err.message, 'error'); return; }
    if (!words.length) return;
    const [cmdRaw, ...args] = words;
    const cmd = cmdRaw.toLowerCase();
    const out = text => terminalLine(text, 'normal');
    const requireArgs = n => { if (args.length < n) throw new Error(cmd + ' requires ' + n + ' argument(s)'); };
    try {
      if (cmd === 'help') out('COMMANDS\n  help                  Command reference\n  ls [path]             List virtual directory\n  tree [path]           Recursive virtual filesystem paths\n  cd [path]             Change virtual directory\n  pwd                   Current virtual directory\n  cat <file>            Print a virtual text file\n  write <file> <text>   Write virtual text file\n  touch <file>          Create empty virtual text file\n  mkdir <dir>           Create directory\n  rm <path>             Remove file or empty directory\n  cp <source> <dest>    Copy a virtual file or directory\n  mv <source> <dest>    Move a virtual file or directory\n  edit <file>           Open virtual text file in editor\n  save                  Save current editor buffer\n  load <file>           Assemble source into virtual CPU\n  run [file]            Run loaded program or a .asm file\n  step                  Execute one instruction\n  pause                 Pause running program\n  reset                 Reset CPU (keep virtual files)\n  regs                  Show register values\n  mem [offset] [n]      Read 1..256 virtual RAM bytes\n  disk                  Show virtual storage usage\n  ps                    Show virtual program state\n  echo <text>           Print text\n  date                  Display current device date\n  examples              Show bundled assembly examples\n  export                Download virtual disk JSON\n  import                Choose JSON backup to restore\n  history               Show command history\n  clear                 Clear terminal\n\nCPU OPS: MOV ADD SUB MUL DIV MOD AND OR XOR SHL SHR INC DEC CMP\n         JMP JZ JNZ JG JL LOAD STORE PUSH POP PRINT PRINTC HALT NOP\nCPU: 8 x 16-bit registers, 64 KiB RAM, 100,000-cycle safety limit.');
      else if (cmd === 'pwd') out(cwd);
      else if (cmd === 'cd') { const p = fs.path(args[0] || '/home/guest', cwd); if (fs.mustGet(p).type !== 'dir') throw new Error('Not a directory'); cwd = p; updatePrompt(); }
      else if (cmd === 'ls') { const listing = fs.list(args[0] || '.', cwd); out(listing.length ? listing.map(e => (e.type === 'dir' ? '[DIR] ' : '      ') + e.name).join('\n') : '(empty)'); }
      else if (cmd === 'tree') out(fs.tree(args[0] || '/', cwd).join('\n'));
      else if (cmd === 'cat') { requireArgs(1); out(fs.read(args[0], cwd)); }
      else if (cmd === 'mkdir') { requireArgs(1); const p = fs.mkdir(args[0], cwd); persist(); renderExplorer(); out('Created ' + p); }
      else if (cmd === 'touch') { requireArgs(1); const p = fs.path(args[0], cwd); fs.write(p, fs.get(p)?.type === 'file' ? fs.read(p) : ''); persist(); renderExplorer(); out('Touched ' + p); }
      else if (cmd === 'write') { requireArgs(2); const p = fs.write(args[0], args.slice(1).join(' '), cwd); persist(); renderExplorer(); out('Wrote ' + p); }
      else if (cmd === 'rm') { requireArgs(1); fs.remove(args[0], cwd); persist(); renderExplorer(); out('Removed ' + args[0]); }
      else if (cmd === 'mv' || cmd === 'cp') { requireArgs(2); const result = fs.move(args[0], args[1], cwd, cmd === 'cp'); persist(); renderExplorer(); out((cmd === 'cp' ? 'Copied ' : 'Moved ') + result.from + ' to ' + result.to); }
      else if (cmd === 'edit') { requireArgs(1); openFile(args[0]); out('Opened ' + fs.path(args[0], cwd)); }
      else if (cmd === 'save') saveEditor();
      else if (cmd === 'load') { requireArgs(1); const p = fs.path(args[0], cwd); bootSource(fs.read(p), p); }
      else if (cmd === 'run') { if (args.length) runProgram(false, args[0]); else if (cpu.program && !cpu.halted) runProgram(); else runProgram(true); }
      else if (cmd === 'step') stepProgram();
      else if (cmd === 'pause') { pause(); out('Virtual CPU paused.'); }
      else if (cmd === 'reset') { pause(); cpu.reset(); loadedPath = ''; loadedSource = ''; renderCPU(); out('CPU reset. Virtual disk preserved.'); }
      else if (cmd === 'regs') { const s = cpu.state(); out(s.regs.map((v, i) => 'R' + i + '=0x' + v.toString(16).padStart(4, '0') + ' (' + v + ')').join('\n') + '\nPC=' + s.pc + ' SP=0x' + s.sp.toString(16) + ' cycles=' + s.cycles + ' Z=' + Number(s.z) + ' G=' + Number(s.g) + ' L=' + Number(s.l)); }
      else if (cmd === 'mem') {
        const start = args[0] ? /^0x/i.test(args[0]) ? parseInt(args[0], 16) : Number(args[0]) : 0;
        const n = args[1] ? Number(args[1]) : 64;
        out(cpu.ramView(start, n).map(v => v.toString(16).padStart(2, '0')).join(' '));
        setMemoryOffset(String(start));
      }
      else if (cmd === 'disk') out('Virtual disk: ' + fs.usage() + '/' + Core.constants.FS_LIMIT + ' bytes; ' + Object.keys(fs.entries).length + ' entries');
      else if (cmd === 'ps') out(JSON.stringify({ program: loadedPath || '(none)', running, ...cpu.state() }, null, 2));
      else if (cmd === 'echo') out(args.join(' '));
      else if (cmd === 'date') out(new Date().toString());
      else if (cmd === 'examples') out(fs.tree('/programs').filter(p => p.endsWith('.asm')).join('\n'));
      else if (cmd === 'history') out(commandHistory.map((v, i) => String(i + 1).padStart(3, ' ') + ' ' + v).join('\n'));
      else if (cmd === 'export') exportDisk();
      else if (cmd === 'import') $('import-file').click();
      else if (cmd === 'clear') { $('terminal-output').replaceChildren(); terminalCount = 0; }
      else throw new Error('Unknown command: ' + cmd + '. Type help.');
    } catch (err) { terminalLine('Error: ' + err.message, 'error'); status(err.message, true); }
    finally { renderDisk(); }
  }
  function init() {
    const recovered = restoreLocal();
    renderExplorer(); renderDisk(); renderCPU(); updatePrompt();
    $('editor').addEventListener('input', () => { editorDirty = true; $('editor-indicator').textContent = 'UNSAVED'; });
    $('editor').addEventListener('keydown', ev => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveEditor(); }
      if (ev.key === 'Tab') {
        ev.preventDefault(); const t = ev.target, s = t.selectionStart, e = t.selectionEnd;
        t.setRangeText('  ', s, e, 'end'); editorDirty = true; $('editor-indicator').textContent = 'UNSAVED';
      }
    });
    $('terminal-input').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault(); const value = ev.target.value.trim(); ev.target.value = '';
        if (value) { commandHistory.push(value); if (commandHistory.length > 200) commandHistory.shift(); historyIndex = commandHistory.length; shell(value); }
      } else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (historyIndex > 0) $('terminal-input').value = commandHistory[--historyIndex]; }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); if (historyIndex < commandHistory.length - 1) $('terminal-input').value = commandHistory[++historyIndex]; else { historyIndex = commandHistory.length; $('terminal-input').value = ''; } }
    });
    $('btn-run').addEventListener('click', () => runProgram(true));
    $('btn-step').addEventListener('click', stepProgram);
    $('btn-pause').addEventListener('click', () => { pause(); status('Paused'); });
    $('btn-reset').addEventListener('click', () => { pause(); cpu.reset(); loadedPath = ''; loadedSource = ''; renderCPU(); status('CPU reset; virtual disk unchanged'); });
    $('btn-save').addEventListener('click', saveEditor);
    $('btn-export').addEventListener('click', exportDisk);
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', ev => importDisk(ev.target.files?.[0]));
    $('btn-memory').addEventListener('click', () => { try { setMemoryOffset($('memory-offset').value.trim()); } catch (err) { status(err.message, true); } });
    $('btn-terminal-clear').addEventListener('click', () => shell('clear'));
    $('btn-new').addEventListener('click', () => {
      if (editorDirty && !window.confirm('Discard unsaved editor changes?')) return;
      let candidate = '/home/guest/untitled.asm'; let index = 1;
      while (fs.get(candidate)) candidate = '/home/guest/untitled-' + (index++) + '.asm';
      activePath = candidate; $('editor-path').value = candidate;
      $('editor').value = '; New program\nPRINT "Hello, world"\nHALT\n';
      editorDirty = true; $('editor-indicator').textContent = 'UNSAVED'; renderExplorer(); status('New unsaved program');
    });
    $('btn-open-fib').addEventListener('click', () => { try { openFile('/programs/fibonacci.asm'); } catch (err) { status(err.message, true); } });
    $('btn-open-mem').addEventListener('click', () => { try { openFile('/programs/memory.asm'); } catch (err) { status(err.message, true); } });
    $('btn-open-hello').addEventListener('click', () => { try { openFile('/programs/hello.asm'); } catch (err) { status(err.message, true); } });
    $('btn-focus-terminal').addEventListener('click', () => { $('terminal-input').focus(); });
    try { openFile(fs.get(activePath)?.type === 'file' ? activePath : fs.tree('/').find(p => fs.get(p)?.type === 'file') || '/docs/README.txt', true); }
    catch (err) { status('No default program exists; use New File.', true); }
    terminalLine('INTERNAL COMPUTER v1.0  |  OFFLINE / SANDBOXED / 16-BIT', 'success');
    terminalLine(recovered ? 'Restored local virtual filesystem.' : 'Created factory virtual filesystem.', 'muted');
    terminalLine('Type help for commands. Open a program and select RUN to execute.', 'normal');
    status('Virtual computer initialized • no external network or host shell');
    $('terminal-input').focus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
