'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VirtualFS, VirtualCPU, compile, normal, shellWords, constants } = require('./core');

function run(source) {
  const output = [];
  const cpu = new VirtualCPU(v => output.push(v));
  cpu.load(source);
  const result = cpu.run();
  return { cpu, output, result };
}
test('factory filesystem loads and bundled programs execute', () => {
  const fs = new VirtualFS();
  assert.equal(fs.read('/programs/hello.asm').includes('Hello'), true);
  const fib = run(fs.read('/programs/fibonacci.asm'));
  assert.deepEqual(fib.output, ['Fibonacci:', '0', '1', '1', '2', '3', '5', '8', '13', '21', '34']);
  assert.equal(fib.cpu.halted, true);
  assert.deepEqual(run(fs.read('/programs/memory.asm')).output, ['Value loaded from RAM:', '918']);
  assert.deepEqual(run(fs.read('/programs/countdown.asm')).output, ['5', '4', '3', '2', '1', 'Liftoff']);
});
test('assembly instructions, CMP, branches, little endian memory, stack', () => {
  const p = `MOV R0, 65535\nADD R0, 2\nPRINT R0\nSUB R0, 3\nPRINT R0\nMOV R1, 7\nMUL R1, 3\nDIV R1, 7\nMOD R1, 2\nPRINT R1\nMOV R2, 0xF0\nAND R2, 0x0f\nOR R2, 0x1\nXOR R2, 0x3\nSHL R2, 2\nSHR R2, 1\nPRINT R2\nCMP R1, 1\nJZ equal\nPRINT "FAIL"\nequal: CMP R2, 3\nJG bigger\nPRINT "FAIL"\nbigger:\nMOV R7, 918\nSTORE [0x7ffe], R7\nLOAD R6, [0x7ffe]\nPRINT R6\nPUSH R6\nMOV R6, 0\nPOP R6\nPRINT R6\nHALT`;
  const { cpu, output } = run(p);
  assert.deepEqual(output, ['1', '65534', '1', '4', '918', '918']);
  assert.equal(cpu.ram[0x7ffe], 150);
  assert.equal(cpu.ram[0x7fff], 3);
  assert.equal(cpu.sp, 0xfffe);
});
test('JNZ, JL, JG, numeric jump, PRINTC, labels share line with opcode', () => {
  const source = `MOV R0, 3\nrepeat: PRINT R0\nDEC R0\nJNZ repeat\nCMP R0, 5\nJL below\nPRINT "ERROR"\nbelow: PRINTC 65\nCMP 8, 2\nJG finish\nPRINT "ERROR"\nfinish: HALT`;
  assert.deepEqual(run(source).output, ['3','2','1','A']);
});
test('compiler rejects bad operands and control-flow destinations', () => {
  for (const source of [
    '', 'LET R0, 2', 'HALT 0', 'MOV R8, 1', 'MOV R0, bad',
    'MOV R0, "string"', 'JMP nowhere', 'JMP 500', 'INC 0',
    'LOAD R1, 9', 'STORE R0, 9', 'PRINT [12]', 'PRINT "unterminated',
    'x: NOP\nx: HALT', 'PUSH', 'PRINTC "hello"'
  ]) assert.throws(() => compile(source), undefined, source);
});
test('division by zero and RAM bounds halt and report fault', () => {
  for (const src of ['MOV R0, 10\nDIV R0, 0\nHALT', 'LOAD R0, [65535]\nHALT', 'POP R0\nHALT']) {
    const cpu = new VirtualCPU(); cpu.load(src);
    assert.throws(() => cpu.run());
    assert.equal(cpu.halted, true);
    assert.match(cpu.fault, /Line/);
  }
});
test('cycle limiter stops infinitely looping program', () => {
  const cpu = new VirtualCPU(); cpu.load('loop: JMP loop');
  assert.throws(() => cpu.run(200000), /Cycle limit reached/);
  assert.equal(cpu.cycles, constants.CYCLE_LIMIT);
});
test('virtual filesystem traversal, creation, copy, moves, and removal', () => {
  const fs = new VirtualFS(false);
  fs.mkdir('/home'); fs.mkdir('/home/guest');
  fs.mkdir('/home/guest/x');
  fs.write('/home/guest/x/a.txt', 'first');
  assert.equal(fs.read('x/a.txt', '/home/guest'), 'first');
  assert.equal(normal('../../../../etc', '/home/guest'), '/etc');
  assert.equal(normal('~/x/a.txt'), '/home/guest/x/a.txt');
  assert.equal(fs.list('/home/guest')[0].name, 'x');
  fs.move('/home/guest/x', '/home/guest/y', '/home/guest', true);
  assert.equal(fs.read('/home/guest/y/a.txt'), 'first');
  fs.move('/home/guest/y/a.txt', '/home/guest/y/b.txt');
  assert.equal(fs.read('/home/guest/y/b.txt'), 'first');
  assert.throws(() => fs.remove('/home/guest/y'), /not empty/);
  fs.remove('/home/guest/y/b.txt'); fs.remove('/home/guest/y');
  assert.equal(fs.get('/home/guest/y'), null);
  assert.throws(() => fs.move('/home/guest/x', '/home/guest/x/inner'), /Cannot move directory into itself/);
});
test('import rejects corrupted backups without changing disk', () => {
  const fs = new VirtualFS(); const backup = fs.snapshot();
  const wrongRoot = structuredClone(backup); delete wrongRoot.entries['/'];
  assert.throws(() => fs.restore(wrongRoot), /Invalid filesystem entries/);
  const missingParent = structuredClone(backup); missingParent.entries['/random/file.txt'] = { type: 'file', content: 'bad' };
  assert.throws(() => fs.restore(missingParent), /Missing parent directory/);
  const directoryContent = structuredClone(backup); directoryContent.entries['/docs'].content = 'bad';
  assert.throws(() => fs.restore(directoryContent), /Invalid entry content/);
  assert.equal(fs.read('/docs/README.txt'), backup.entries['/docs/README.txt'].content);
  fs.restore(backup);
  assert.deepEqual(fs.snapshot(), backup);
});
test('disk quota and file limit are checked before modification', () => {
  const fs = new VirtualFS(false);
  fs.mkdir('/data');
  assert.throws(() => fs.write('/data/giant', 'x'.repeat(constants.FILE_LIMIT + 1)), /File exceeds/);
  for (let i = 0; i < 8; i++) fs.write(`/data/f${i}`, 'x'.repeat(constants.FILE_LIMIT));
  assert.equal(fs.usage(), constants.FS_LIMIT);
  assert.throws(() => fs.write('/data/over', 'a'), /disk full/);
  assert.equal(fs.get('/data/over'), null);
});
test('quoted shell argument parsing supports escaped characters and empty strings', () => {
  assert.deepEqual(shellWords('write "a b" "two words"'), ['write','a b','two words']);
  assert.deepEqual(shellWords('echo ""'), ['echo','']);
  assert.deepEqual(shellWords('echo hi\\ there'), ['echo','hi there']);
  assert.throws(() => shellWords('echo "oops'), /Unclosed quote/);
});
test('no JS eval, Function constructor, or host process access exposed by VM', () => {
  assert.throws(() => compile('EVAL alert(1)'), /Unknown opcode/);
  assert.throws(() => compile('SYSTEM whoami'), /Unknown opcode/);
  assert.throws(() => compile('FETCH http://example.com'), /Unknown opcode/);
});
