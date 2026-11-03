#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
if ! command -v pkg >/dev/null 2>&1; then
  echo 'Run this from Android Termux, not from the ESP32.' >&2
  exit 2
fi
if [[ ${1:-} != --install ]]; then
  cat <<'HELP'
Termux installer (explicit opt-in):
  bash phone/termux-ubuntu.sh --install
This installs Python, OpenSSH and proot-distro and installs a Ubuntu userspace
on your Android phone. It does not flash or modify the ESP32.
Afterward run: python3 phone/redlab.py serve
Ubuntu userspace login: proot-distro login ubuntu
HELP
  exit 0
fi
pkg update -y
pkg install -y python openssh proot-distro
if ! proot-distro list --installed | grep -q 'ubuntu'; then
  proot-distro install ubuntu
fi
echo 'Phone-side Ubuntu userspace installed. This is NOT on the ESP32.'
