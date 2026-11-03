'use strict';
// Fixed interpreter only: the supplied source is VM assembly, never JavaScript.
// This program has no access to the Agency API, serial ports or the network.
const { VirtualCPU } = require('../web/vm/core.js');
const MAX_INPUT_BYTES = 70000;
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
    process.stderr.write('Input too large\n');
    process.exit(2);
  }
});
process.stdin.on('end', () => {
  const output = [];
  let truncated = false;
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed.source !== 'string' || Buffer.byteLength(parsed.source, 'utf8') > 16384) {
      throw Error('Assembly source must be at most 16384 UTF-8 bytes');
    }
    if (!Number.isInteger(parsed.max_steps) || parsed.max_steps < 1 || parsed.max_steps > 100000) {
      throw Error('Invalid step budget');
    }
    let outputBytes = 0;
    const cpu = new VirtualCPU(text => {
      const rendered = String(text);
      const bytes = Buffer.byteLength(rendered, 'utf8');
      if (output.length < 256 && outputBytes + bytes <= 16000) {
        output.push(rendered);
        outputBytes += bytes;
      } else {
        truncated = true;
      }
    });
    const instructions = cpu.load(parsed.source);
    let execution;
    let error = null;
    try { execution = cpu.run(parsed.max_steps); }
    catch (e) { error = String(e.message).slice(0, 300); }
    const state = cpu.state();
    const result = {
      ok: error === null && state.halted && !state.fault,
      outcome: error ? 'fault' : state.halted ? 'halted' : 'step-budget-exhausted',
      stdout: output,
      output_truncated: truncated,
      instructions,
      cycles: state.cycles,
      registers: state.regs,
      pc: state.pc,
      sp: state.sp,
      flags: { z: state.z, g: state.g, l: state.l },
      fault: error || state.fault,
      ram_bytes: 65536,
      hardware_access: false,
    };
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ok: false, outcome: 'compile-error',
      stdout: [], output_truncated: false, instructions: 0,
      cycles: 0, registers: Array(8).fill(0), pc: 0, sp: 65534,
      flags: {z:false,g:false,l:false}, fault: String(e.message).slice(0, 300),
      ram_bytes: 65536, hardware_access: false}) + '\n');
  }
});
