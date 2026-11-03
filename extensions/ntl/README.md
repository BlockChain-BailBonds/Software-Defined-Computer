# Internal Computer v1.1 + NTL Difference Lab

A functioning, fully offline, browser-hosted virtual machine with an integrated Name That LLM difference laboratory, a virtual terminal,
assembler, 16-bit CPU, 64 KiB RAM, 1 MiB browser-local virtual disk, source editor,
register inspector, sample programs, stepping, and JSON disk backup/restore.

This is **not an x86 computer, an OS emulator, a shell on the host, a device driver,
or an AI model**. Programs operate only in the internal instruction interpreter.

## Quick launch

Open `internal_computer.html` in a modern browser. No installation or network is
necessary. The split-source version is `index.html`, `core.js`, `app.js`, and
`style.css` in this folder.

On Android with Termux, localhost serving is often more reliable for browser-local
storage than opening a `file://` URL. Copy this folder to Termux, then run:

```sh
pkg install python
cd /path/to/internal_computer
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000` in your mobile browser. The terminal command above
starts a **file server on your own phone**, not on the Internet. It is bound only
to the loopback interface. This server is optional; the single HTML file can also
be opened directly from your browser if local file support permits it.

See [NTL_README.md](NTL_README.md) for the new output-difference detector, multi-prompt batch analyses, JSON import/export, and the `ntl` terminal command.

## How to use

1. Choose `fibonacci.asm` from the sidebar.
2. Press **RUN**. Program output appears in the built-in terminal.
3. Press **STEP** to restart a halted program and execute one instruction.
4. Inspect R0-R7, PC, SP, flags, and RAM in the right panel.
5. Create a new `.asm` file using **NEW FILE**, modify the source, and press
   **SAVE FILE** or Ctrl+S.
6. Press **BACKUP** to download all virtual files as JSON. Use **RESTORE** to
   import a previously exported backup.

The built-in terminal is a *virtual command interpreter*. For example:

```text
help
ls /programs
cat /docs/README.txt
load /programs/countdown.asm
run
regs
mem 0x0100 16
mkdir /home/guest/work
write /home/guest/work/notes.txt "Hello virtual disk"
cat /home/guest/work/notes.txt
```

### Sample assembly

```asm
PRINT "Countdown:"
MOV R0, 5
again:
  PRINT R0
  DEC R0
  JNZ again
HALT
```

### Instruction set

- Data: `MOV Rn, value`, `LOAD Rn, [address]`, `STORE [address], value`
- Arithmetic/bitwise: `ADD`, `SUB`, `MUL`, `DIV`, `MOD`, `AND`, `OR`, `XOR`,
  `SHL`, `SHR` (destination must be a register, second operand is register or integer)
- Unary: `INC Rn`, `DEC Rn`
- Comparison: `CMP value, value` sets Z, G and L from **unsigned 16-bit** operands
- Flow: `JMP label`, `JZ label`, `JNZ label`, `JG label`, `JL label`, `NOP`, `HALT`
- Stack: `PUSH value`, `POP Rn` (stack grows down from 0xFFFE toward 0xC000)
- Output: `PRINT value`, `PRINT "string"`, `PRINTC value` (one output line per instruction)

`Rn` is R0 through R7. Integers may be decimal, negative decimal, or hex (`0x`)
notation. Arithmetic registers wrap at 16 bits. Memory is byte-addressable, with
`LOAD` and `STORE` reading and writing two bytes in little-endian order. The PC
counts **compiled instructions**, not binary address offsets. Programs are parsed
into a safe internal instruction representation, not translated to machine code.

Zero and comparison flags: arithmetic and MOV/LOAD/POP update Z based on the result;
CMP updates Z, G and L. JG and JL use the latest CMP result. Jump labels are
case insensitive.

### Limits and data handling

- 64 KiB RAM per virtual program; RAM resets when loading a program.
- 100,000 executed instructions per program, preventing infinite loops.
- Max 3,000 compiled instructions and max 5,000 source lines.
- Virtual disk max 1 MiB text, each virtual file max 128 KiB, 500 entries.
- Files normally persist through browser `localStorage` on the same origin/profile.
  Private browsing, browser cleanup, or `file://` policies can erase or block this
  storage. Export JSON regularly when preserving work matters.
- Backup restore verifies format, file hierarchy, size limits, and entry types.
- No dynamic code execution, no direct file access, no web requests, no shell
  execution, no host hardware access.
- This tool contains no external AI model, system-level container, kernel, or
  persistent background execution.

## Development / tests

Requires Node.js 18 or newer for automated tests:

```sh
node --test core.test.js ntl_diff.test.js ui.smoke.test.js
```

No package install and no browser automation framework are needed.

## Files

- `internal_computer.html` — standalone production-ready distributable (provided separately)
- `index.html` — split-source browser entry point
- `core.js` — filesystem and virtual CPU
- `app.js` — terminal, editor, memory monitor, NTL interface, UI controls, backup/restore
- `ntl_diff.js` — deterministic offline response difference engine
- `NTL_README.md` — comparison and attribution limitations
- `ntl_batch_example.json` — matched-prompt batch example
- `ntl_diff.test.js` — detector algorithm tests
- `ui.smoke.test.js` — UI integration tests
- `style.css` — responsive UI styles
- `core.test.js` — deterministic CPU/filesystem tests

Version 1.1, offline learning, program-execution, and model-output comparison sandbox.
