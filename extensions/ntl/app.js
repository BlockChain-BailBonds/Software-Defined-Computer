/* Browser user interface for the offline internal computer. */
(function () {
  'use strict';
  const Core = globalThis.VComputerCore;
  const NTL = globalThis.NTLDiff;
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
  let ntlReport = null;
  let ntlInput = null;
  let ntlModeActive = false;

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
  function toggleNTL(force) {
    ntlModeActive = typeof force === 'boolean' ? force : !ntlModeActive;
    $('vm-editor').hidden = ntlModeActive;
    $('vm-terminal').hidden = ntlModeActive;
    $('ntl-panel').hidden = !ntlModeActive;
    $('btn-ntl-mode').textContent = ntlModeActive ? '◁ VIRTUAL COMPUTER' : '◈ NTL DIFF';
    $('btn-ntl-mode').setAttribute('aria-pressed', String(ntlModeActive));
    status(ntlModeActive ? 'NTL offline comparison mode — no LLM is executed' : 'Virtual CPU and terminal ready');
  }
  function ntlMessage(message, error = false) {
    $('ntl-status').textContent = message;
    $('ntl-status').classList.toggle('problem', error);
    if (error) status(message, true);
  }
  function ntlFields() {
    return {
      prompt: $('ntl-prompt').value,
      labelA: $('ntl-a-name').value,
      labelB: $('ntl-b-name').value,
      responseA: $('ntl-a').value,
      responseB: $('ntl-b').value
    };
  }
  function formatPair(r) {
    const f = r.features, m = r.metrics;
    const display = (v) => (100 * v).toFixed(2) + '%';
    const lines = [
      'NTL / DIFFERENCE REPORT',
      'A: ' + r.context.labelA + '   |   B: ' + r.context.labelB,
      'PROMPT: ' + (r.context.prompt || '[not recorded]').replace(/\s+/g, ' ').slice(0, 140),
      'CLASSIFICATION: ' + r.classification.join(', '),
      '',
      'Exact text match:      ' + (r.exactMatch ? 'YES' : 'NO'),
      'Normalized match:      ' + (r.normalizedMatch ? 'YES' : 'NO'),
      'Unigram Jaccard:       ' + display(m.wordJaccard),
      'Bigram Jaccard:        ' + display(m.bigramJaccard),
      'Character 3-gram JSD:  ' + m.charTrigramJSD.toFixed(4) + ' (0=equal distribution, 1=max difference)',
      'Word count ratio:      ' + display(m.wordCountRatio),
      '',
      'STRUCTURAL FEATURES            A         B        Δ (B − A)'
    ];
    for (const [name, key] of [
      ['Words','words'], ['Distinct words','uniqueWords'], ['Sentences','sentenceCount'],
      ['Paragraphs','paragraphs'], ['Bullets','bulletCount'], ['Numbered items','numberedCount'],
      ['Headings','headingCount'], ['Code fences','codeFenceCount'],
      ['Questions','questionCount'], ['Emoji','emojiCount']
    ]) {
      lines.push(name.padEnd(24) + String(f.A[key]).padStart(7) + String(f.B[key]).padStart(10) + String(f.delta[key]).padStart(11));
    }
    lines.push('', 'LEXICAL CHANGES (frequency B − A):');
    if (!r.changedTerms.length) lines.push('No changed token frequencies.');
    for (const term of r.changedTerms) lines.push('  ' + (term.delta > 0 ? '+' : '') + term.delta + ' ' + term.term.slice(0, 60));
    lines.push('', 'FIRST CHANGED REGION (short excerpts):',
      'A: ' + r.firstChange.removed.slice(0, 220), 'B: ' + r.firstChange.added.slice(0, 220),
      '', 'LINE DIFF (first 30 change lines):');
    for (const change of r.lineDiff.changes.slice(0, 30)) {
      lines.push((change.type === 'add' ? '+ ' : '- ') + (change.lineB || change.lineA) + ': ' + change.text.slice(0, 180));
    }
    if (r.lineDiff.changes.length > 30 || r.lineDiff.omittedChanges) lines.push('[Additional line changes omitted from this view; see JSON report.]');
    if (r.lineDiff.truncated) lines.push('[Line comparison truncated at 180 lines per response.]');
    lines.push('', 'INTERPRETATION: ' + r.interpretation, 'ATTRIBUTION: NOT IDENTIFIED — the generating model cannot be proved from these metrics.');
    return lines.join('\n');
  }
  function formatBatch(r) {
    const s = r.summary;
    const lines = [
      'NTL / MULTI-PROMPT DIFFERENCE REPORT',
      'Matched cases:        ' + r.count,
      'Distinct prompts:     ' + s.differentPrompts,
      'Exact matches:        ' + r.exactMatches,
      'Normalized matches:   ' + r.normalizedMatches,
      'Mean unigram overlap: ' + (100 * s.meanWordJaccard).toFixed(2) + '%',
      'Mean bigram overlap:  ' + (100 * s.meanBigramJaccard).toFixed(2) + '%',
      'Mean char JSD:        ' + s.meanCharTrigramJSD.toFixed(4),
      'Mean word ratio:      ' + (100 * s.meanWordCountRatio).toFixed(2) + '%',
      '', 'CASES'
    ];
    for (let i = 0; i < r.cases.length; i++) {
      const item = r.cases[i];
      lines.push(String(i + 1).padStart(2) + '. overlap ' + (100 * item.metrics.wordJaccard).toFixed(1) + '%   JSD ' + item.metrics.charTrigramJSD.toFixed(4) + '   ' + (item.context.prompt || '[no prompt]').replace(/\s+/g, ' ').slice(0, 80));
    }
    lines.push('', 'Only responses to identical prompts are directly comparable. This does not establish model identity or statistical significance.');
    return lines.join('\n');
  }
  function ntlCompare() {
    try {
      const candidate = ntlFields();
      if (!candidate.responseA.length && !candidate.responseB.length) throw new Error('Paste one or both model responses to compare');
      ntlReport = NTL.analyzePair(candidate); ntlInput = candidate;
      $('ntl-result').textContent = formatPair(ntlReport);
      ntlMessage(ntlReport.exactMatch ? 'Compared: outputs are identical.' : 'Compared: differences detected and quantified.');
      status('NTL comparison complete');
    } catch (err) { ntlMessage('Comparison failed: ' + err.message, true); }
  }
  function ntlBatch() {
    try {
      const cases = NTL.parseBatch($('ntl-batch-json').value);
      ntlInput = { format: 'NTL_DIFF_BATCH', version: 1, cases };
      ntlReport = NTL.analyzeBatch(ntlInput);
      $('ntl-result').textContent = formatBatch(ntlReport);
      ntlMessage('Analyzed ' + ntlReport.count + ' matched prompt pairs.');
      status('NTL batch complete');
    } catch (err) { ntlMessage('Batch failed: ' + err.message, true); }
  }
  function ntlPayload() {
    if (!ntlReport) throw new Error('Run a comparison first');
    return { format: 'NTL_SAVED_ANALYSIS', version: 1, createdAt: new Date().toISOString(),
      input: ntlInput, report: ntlReport,
      caveat: 'The input and report describe observed output differences only, not the generating model identity.' };
  }
  function ntlExport() {
    try {
      makeDownload('ntl-difference-report.json', JSON.stringify(ntlPayload(), null, 2), 'application/json');
      ntlMessage('Exported self-contained NTL JSON report to your device.');
    } catch (err) { ntlMessage('Export failed: ' + err.message, true); }
  }
  function ntlSave() {
    try {
      const source = ntlPayload();
      // Save the analytical report (not the potentially large raw inputs) to the 1 MiB virtual disk.
      const limitedReport = ntlReport.format === 'NTL_BATCH_REPORT' ? {
        format: ntlReport.format, version: ntlReport.version, count: ntlReport.count,
        exactMatches: ntlReport.exactMatches, normalizedMatches: ntlReport.normalizedMatches,
        summary: ntlReport.summary, attribution: ntlReport.attribution,
        cases: ntlReport.cases.map(r => ({
          context: { labelA: r.context.labelA, labelB: r.context.labelB, prompt: r.context.prompt.slice(0, 240) },
          exactMatch: r.exactMatch, normalizedMatch: r.normalizedMatch, classification: r.classification,
          metrics: r.metrics, wordDelta: r.features.delta.words, structuralChanges: r.structuralChanges
        }))
      } : {
        ...ntlReport,
        lineDiff: { ...ntlReport.lineDiff, changes: ntlReport.lineDiff.changes.slice(0, 12)
          .map(c => ({ ...c, text: c.text.slice(0, 240) })) },
        firstChange: { ...ntlReport.firstChange,
          removed: ntlReport.firstChange.removed.slice(0, 240),
          added: ntlReport.firstChange.added.slice(0, 240) }
      };
      const saved = { format: source.format, version: 1, createdAt: source.createdAt,
        report: limitedReport, caveat: source.caveat,
        inputMetadata: ntlReport.format === 'NTL_BATCH_REPORT' ? { cases: ntlReport.count } : {
          prompt: ntlInput.prompt, labelA: ntlInput.labelA, labelB: ntlInput.labelB,
          inputCharactersA: ntlInput.responseA.length, inputCharactersB: ntlInput.responseB.length } };
      const dir = '/home/guest/ntl_reports';
      if (!fs.get('/home/guest')) throw new Error('Virtual disk has no /home/guest directory');
      if (!fs.get(dir)) fs.mkdir(dir);
      let name = '/home/guest/ntl_reports/report-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      let seq = 1;
      while (fs.get(name)) name = '/home/guest/ntl_reports/report-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + seq++ + '.json';
      fs.write(name, JSON.stringify(saved, null, 2));
      persist(); renderExplorer();
      ntlMessage('Analysis summary saved at ' + name + ' (raw inputs excluded; use Export for full evidence).');
      terminalLine('NTL: saved analytical report to ' + name, 'success');
    } catch (err) { ntlMessage('Save failed: ' + err.message, true); }
  }
  async function ntlImport(file) {
    if (!file) return;
    try {
      if (file.size > 2.5 * 1024 * 1024) throw new Error('Batch input must be less than 2.5 MiB');
      const raw = await file.text();
      const cases = NTL.parseBatch(raw);
      $('ntl-batch-json').value = JSON.stringify({ format: 'NTL_DIFF_BATCH', version: 1, cases }, null, 2);
      ntlBatch(); toggleNTL(true);
    } catch (err) { ntlMessage('Import rejected: ' + err.message, true); }
    finally { $('ntl-import-file').value = ''; }
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
      if (cmd === 'help') out('COMMANDS\n  help                  Command reference\n  ntl <A> <B> [prompt]  Compare two virtual text files\n  ntl-open              Open NTL Difference Lab\n  ls [path]             List virtual directory\n  tree [path]           Recursive virtual filesystem paths\n  cd [path]             Change virtual directory\n  pwd                   Current virtual directory\n  cat <file>            Print a virtual text file\n  write <file> <text>   Write virtual text file\n  touch <file>          Create empty virtual text file\n  mkdir <dir>           Create directory\n  rm <path>             Remove file or empty directory\n  cp <source> <dest>    Copy a virtual file or directory\n  mv <source> <dest>    Move a virtual file or directory\n  edit <file>           Open virtual text file in editor\n  save                  Save current editor buffer\n  load <file>           Assemble source into virtual CPU\n  run [file]            Run loaded program or a .asm file\n  step                  Execute one instruction\n  pause                 Pause running program\n  reset                 Reset CPU (keep virtual files)\n  regs                  Show register values\n  mem [offset] [n]      Read 1..256 virtual RAM bytes\n  disk                  Show virtual storage usage\n  ps                    Show virtual program state\n  echo <text>           Print text\n  date                  Display current device date\n  examples              Show bundled assembly examples\n  export                Download virtual disk JSON\n  import                Choose JSON backup to restore\n  history               Show command history\n  clear                 Clear terminal\n\nCPU OPS: MOV ADD SUB MUL DIV MOD AND OR XOR SHL SHR INC DEC CMP\n         JMP JZ JNZ JG JL LOAD STORE PUSH POP PRINT PRINTC HALT NOP\nCPU: 8 x 16-bit registers, 64 KiB RAM, 100,000-cycle safety limit.');
      else if (cmd === 'ntl-open') { toggleNTL(true); out('NTL Difference Lab opened.'); }
      else if (cmd === 'ntl') {
        requireArgs(2);
        const a = fs.read(args[0], cwd), b = fs.read(args[1], cwd);
        const prompt = args.length >= 3 ? fs.read(args[2], cwd) : '';
        ntlInput = { responseA: a, responseB: b, prompt,
          labelA: fs.path(args[0], cwd).slice(0, 100), labelB: fs.path(args[1], cwd).slice(0, 100) };
        ntlReport = NTL.analyzePair(ntlInput);
        $('ntl-a').value = a; $('ntl-b').value = b; $('ntl-prompt').value = prompt;
        $('ntl-a-name').value = ntlInput.labelA.slice(0, 100);
        $('ntl-b-name').value = ntlInput.labelB.slice(0, 100);
        $('ntl-result').textContent = formatPair(ntlReport);
        toggleNTL(true);
        ntlMessage('Compared virtual files ' + args[0] + ' and ' + args[1] + '.');
        out('NTL: word overlap=' + (ntlReport.metrics.wordJaccard * 100).toFixed(2) + '%; char JSD=' + ntlReport.metrics.charTrigramJSD + '.');
      }
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
    $('btn-ntl-mode').addEventListener('click', () => toggleNTL());
    for (const id of ['ntl-prompt', 'ntl-a', 'ntl-b', 'ntl-a-name', 'ntl-b-name', 'ntl-batch-json']) {
      $(id).addEventListener('input', () => { ntlReport = null; ntlInput = null; ntlMessage('Inputs changed. Run a new comparison before saving or exporting.'); });
    }
    $('btn-ntl-compare').addEventListener('click', ntlCompare);
    $('btn-ntl-batch').addEventListener('click', ntlBatch);
    $('btn-ntl-save').addEventListener('click', ntlSave);
    $('btn-ntl-export').addEventListener('click', ntlExport);
    $('btn-ntl-import').addEventListener('click', () => $('ntl-import-file').click());
    $('ntl-import-file').addEventListener('change', ev => ntlImport(ev.target.files?.[0]));
    $('btn-ntl-demo').addEventListener('click', () => {
      const ex = NTL.demo.cases[0];
      $('ntl-a').value = ex.responseA; $('ntl-b').value = ex.responseB;
      $('ntl-prompt').value = ex.prompt;
      $('ntl-a-name').value = ex.labelA; $('ntl-b-name').value = ex.labelB;
      ntlCompare();
    });
    $('btn-ntl-demo-batch').addEventListener('click', () => {
      $('ntl-batch-json').value = JSON.stringify(NTL.demo, null, 2);
      ntlBatch();
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
    terminalLine('NTL Difference Lab available via top toolbar or ntl <fileA> <fileB>.', 'muted');
    status('Virtual computer initialized • no external network or host shell');
    $('terminal-input').focus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
