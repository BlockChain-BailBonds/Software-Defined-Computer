# EVIL INSPECTOR GADGET — REDLAB OS v0.1.0
**918 Technologies | ESP32-S3 N16R8 | Samsung / Termux mobile field lab**

A mobile authorized-testing platform with two genuinely different execution environments:

- **On the ESP32-S3:** an additive, read-only-by-default command interface (`evil`) for the experimental native Xtensa NOMMU Linux environment in [paulneja/Linux-on-esp32-S3](https://github.com/paulneja/Linux-on-esp32-S3), pinned to source commit `979acc45629e985b757735e8222dbedf3aa5f1e1`. The native platform includes BusyBox, Bash, Wi-Fi station mode, SSH and MicroPython; it is **not Canonical Ubuntu** and cannot run Ubuntu packages or regular CPython wheels.
- **On the Android phone:** Python 3 stdlib control plane with a local-only, mobile-responsive dashboard, explicit scope approval, bounded TCP connect diagnostics, audit/reporting, SSH read-only board inspection, deterministic report analysis and **optional** local LLM summarization through a llama.cpp-compatible inference server. Optional PRoot Ubuntu runs here, on the phone.
- **Included:** the original offline 16-bit Internal Computer VM, accessible from the dashboard. That VM is distinct from the native ESP32 Linux kernel.

## Status at delivery

| Gate | Result |
| --- | --- |
| Source files and tests | Included in this package |
| Local static checks / Python unit tests | Run `python3 -m unittest discover -s tests -v` |
| Upstream ESP32 source pinned | Yes, to commit above |
| Derived firmware image compiled | **Not yet** — requires a full Linux x86-64 + Docker build |
| Firmware flashed | **No** |
| Native Linux booted on your specific Goodluck/Goouuu board | **Not verified** |
| Camera/LCD/UART/CH340 wiring accepted | **No** |
| Large local language model on ESP32 | **No** — models run on the phone or another host |

### ⚠ Hardware warning

**Do not flash the current board to try the source package.** The upstream build creates a 16 MiB full-flash image that overwrites existing firmware, partitioning, `/etc`, and `/home`. It is not an in-place upgrade of your Evil Inspector firmware. The upstream port shares cores with ESP-IDF, runs without an MMU, has no general firewall, and is designed for trusted networks. Its pin layout, camera support, display mapping, CH340/UART0 contention, and USB behavior must be evaluated against the actual board. No cross-port of the existing M3rMa1d/Flipper firmware is implied.

## Quick start on Samsung S26 Ultra, Termux

In the unzipped source directory:

```sh
pkg install python openssh
python3 -m unittest discover -s tests -v
python3 phone/redlab.py serve
```

Open the printed `http://127.0.0.1:9180` in the phone browser, paste the randomly generated session token from Termux, and add **only devices you own or are authorized to test**. The web server listens **only on loopback**, has no remote-access mode, rejects invalid Origins and requires the session token for all APIs.

For a phone-side Ubuntu userspace, **only if desired**, run:

```sh
bash phone/termux-ubuntu.sh --install
proot-distro login ubuntu
```

This installs Ubuntu inside **Android PRoot**, not on the ESP32. RedLab itself does not need PRoot to run.

### Phone CLI operations

```sh
python3 phone/redlab.py status
python3 phone/redlab.py scope add 192.168.1.50 --i-own-or-am-authorized
python3 phone/redlab.py scope list
python3 phone/redlab.py probe 192.168.1.50 22 80 443
python3 phone/redlab.py watch 192.168.1.50 22 80 --interval 60 --count 3
python3 phone/redlab.py analyze
python3 phone/redlab.py report
python3 phone/redlab.py scope remove 192.168.1.50
```

`watch` is the bounded autonomous scheduled-check agent: explicit scope, at most 12 named ports, 30-second minimum interval, at most 100 cycles, Ctrl+C stops. It cannot automatically discover other targets or run its own shell commands.

Targets require explicit authorization, are exact hostnames/IPs (not CIDR/ranges), and are restricted to local/private address space. Addresses are resolved then used directly; public DNS rebinding is rejected. A TCP connect success reports connectivity **only**, not a vulnerability. Scope additions, tests and SSH diagnostics are audited in `~/.evil-inspector-redlab/events.jsonl` (mode 0600). Scope can contain up to 32 targets. The last 250 events feed reports.

### Read-only ESP32 integration over SSH

**After** a separately built and verified ESP Linux image is installed on a board, configure an SSH public key with verified host keys per the upstream `SECURITY.md`, authorize that board's IP within RedLab, and configure the phone's private key:

```sh
export EIG_SSH_KEY="$HOME/.ssh/id_ed25519"
python3 phone/redlab.py board 192.168.1.50 status
python3 phone/redlab.py board 192.168.1.50 network
python3 phone/redlab.py board 192.168.1.50 selftest
```

The SSH bridge permits only six hardcoded `evil` diagnostics: `about`, `status`, `network`, `storage`, `processes`, `selftest`. Host key verification is mandatory. No remote arbitrary-command, flashing, exploitation or payload-upload endpoint exists.

### Optional on-device commands

Once booted on native Linux and logged into an authorized board:

```sh
evil about
evil status
evil network
evil storage
evil processes
evil selftest
evil note "Board lab acceptance started"
evil python demo.py
```

`evil python` runs **existing local MicroPython** programs placed in `/home/root`. The web dashboard does not expose this command remotely. Passwords, Wi-Fi secrets and private keys are not read by the `evil` diagnostics.

### Local AI intelligence (optional)

Start a **separately installed** OpenAI-compatible `llama-server` on the phone or another local host bound to `127.0.0.1:8080`, with a suitable GGUF model, then set:

```sh
export EIG_MODEL_NAME='your-model-id'
python3 phone/redlab.py analyze --local-model
```

The local LLM receives only a bounded RedLab report and can generate a **read-only narrative**. It cannot call tools, launch subprocesses or automatically expand targets. Without a running model, the deterministic report analyst still works. No model files are bundled; phone RAM, storage and thermal limits determine feasible GGUF sizes.

## Native ESP32 build integration — source only, no flashing

The upstream project has an exact pinned clean-build workflow. Our integration script makes a **new clone**, checks out the pinned revision, places the small `evil` shell applet additively under upstream `rootfs_overlay/usr/bin/`, checks for file collisions and whitespace errors, and commits the derived changes. It never modifies an existing source checkout.

On a Linux x86-64 machine with Git, Docker, internet access and at least **25 GiB free storage**:

```sh
bash tools/build.sh "$HOME/evil-redlab-linux-derived"
cd "$HOME/evil-redlab-linux-derived"
JOBS=8 bash build/reproduce.sh
```

The second command is a substantial container/toolchain/ESP-IDF build. The output goes into `build-output/reproduce.XXXXXX/artifacts/` with manifests and SHA-256 checksums. The upstream clean builder checks for a clean committed checkout; this kit makes that commit. The resulting `.bin` is still **unverified on your specific board** and **must not be called release ready**.

If you have a verified local clone of upstream containing the pinned commit, the offline integration path is:

```sh
python3 tools/integrate.py --local-source /path/to/upstream-clone --dest /path/to/new-derived-checkout
```

The derived source is independent from both the original clone and your firmware. This kit does not silently alter SPI, flash offsets, camera/display pins or the CH340/UART0 architecture.

## Release gates

1. Verify source hashes and the  Python/shell automated suite.
2. Run the upstream exact-head host-only checks in the derived checkout; verify they include the added file.
3. Perform an exact-head Docker clean build, record upstream/derived commits, config hashes, image size, partition map, toolchain and `SHA256SUMS`.
4. Human review: pin/resource conflict (especially CH340/UART0), camera/LCD and reserved pins, SSH configuration, secure first login, BOM/cabling, and upstream NOMMU security limits.
5. Back up the board privately with a verified, complete backup; retain its firmware and credentials securely.
6. Only after explicit approval, test the checksum-identified image on dedicated hardware and collect boot, storage, Wi-Fi, UART, USB, `evil selftest`, SSH and power-loss acceptance logs.
7. Publish as an **experimental prerelease** only after both CI and physical gates pass. Do not include personal device backups in the release kit.

## Package tree

- `esp_overlay/` — additive native Linux applet
- `phone/` — Android Termux/CPython runtime, secure localhost dashboard, optional Ubuntu installation helper
- `tools/` — pinned, isolated, non-flashing upstream integration and build preparation
- `tests/` — logic, scope, security, HTTP and shell tests
- `vm/` — original offline Internal Computer browser app
- `manifest.json` — traceability and current acceptance status

## Licensing and third-party boundaries

The RedLab integration code is independently written here; upstream Linux/Buildroot and their dependencies retain their respective licenses. No upstream code is distributed in this archive. When distributing a derived firmware image, honor upstream GPLv3/other notices and corresponding-source requirements. “Ubuntu” in the project concept denotes Ubuntu-like UX on the microcontroller; actual Canonical Ubuntu userspace, if installed, is on Android PRoot only.
