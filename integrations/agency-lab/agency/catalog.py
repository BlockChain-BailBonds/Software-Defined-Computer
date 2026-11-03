"""Portable inspiration catalog; names are references, not bundled OS distributions."""

LINUX_INSPIRED_DESIGNS = (
    ("Alpine Linux / BusyBox", "Small modular userland concepts, explicit applets, compact configuration and composable commands; ESP32 equivalent: built-in FreeRTOS commands, not ELF Linux binaries."),
    ("OpenWrt", "Structured network profiles, supervised services, reproducible firmware images and a recoverable configuration store; ESP32 equivalent: ESP-IDF services and NVS."),
    ("Debian", "Package metadata, dependency declarations, changelogs, cryptographic provenance and reproducible release manifests; ESP32 equivalent: signed OTA components with rollback."),
    ("Kali / Parrot Security", "An authorized-testing workflow with asset ownership checks, capture/analysis plugins, risk reporting and defensive validation; no indiscriminate scanning or exploit deployment."),
    ("Tiny Core Linux", "Small immutable base, optional capability modules and easy reset to known-good state; ESP32 equivalent: read-only firmware plus separate NVS configuration and versioned data."),
)

SAFE_LAB_TOOLS = (
    ("Internal Computer 16-bit VM", "Server-replayed bounded assembly simulations of synthetic protocol state machines, counters, checksum examples and cooperative schedulers; no physical device or host command access."),
    ("Virtual-to-Hardware Evidence Link", "Attach a completed, operator-authorized UART/CYD/ESP32 device report to a simulated experiment while preserving independent evidence provenance."),
    ("UART RX Inspector", "Passive capture, framing/baud assumptions, timestamps and decoded raw hex; no secret inference from unrelated devices."),
    ("Protocol Contract Checker", "Approved reference frames, bounded responses, CRC checks, negative tests and human-reviewed command allowlists."),
    ("Release Integrity Auditor", "Firmware SHA-256, version inventory, manifest reproducibility, rollback readiness, partition and boot-mode assertions."),
    ("Resource Budget Profiler", "Heap/PSRAM, CPU time, watchdog timing, task stack margins and network retry load."),
    ("Swarm Evidence Comparator", "Compare multiple independent device-reported observations, flag divergent readings and demand human review before release acceptance."),
    ("Defensive Threat Model", "Physical access, token replay, Wi-Fi isolation, UART electrical and denial-of-service risk, with bounded safe verification procedures."),
)


def catalog_context():
    lines = ["PORTABLE DESIGN REFERENCES (concepts only; no complete Linux distribution runs on ESP32-S3 N16R8):"]
    lines.extend(f"- {name}: {detail}" for name, detail in LINUX_INSPIRED_DESIGNS)
    lines.append("AUTHORIZED LAB TOOL PATTERNS:")
    lines.extend(f"- {name}: {detail}" for name, detail in SAFE_LAB_TOOLS)
    return "\n".join(lines)
