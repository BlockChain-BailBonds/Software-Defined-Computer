# Security policy and responsible testing

Do not publish API keys, Wi-Fi passwords, firmware private signing keys, device enrollment tokens, private SSH keys, personal information, credentials or private circuit diagrams in issues or commits. Rotate and remove any accidentally committed secret; removing it from HEAD does not remove it from Git history.

The VM has no host shell, network or GPIO. Never add those capabilities to the virtual interpreter without an independent trust-boundary design review. Agency Lab requires authenticated administrative operations; hardware TX is separately policy-scoped. RedLab defaults to loopback-only access and explicit test scope. Local tests on software do not validate security on a physical board.

Report security flaws privately to the repository owner via GitHub's private vulnerability reporting feature if available, or request a private contact route before sending sensitive details. No public exploitation demonstrations against unauthorized targets. Keep ESP32 tests within hardware and networks you own or are authorized to assess.

The published repository is not an assurance of production deployment readiness. Source availability is not a warranty or a grant of usage rights.
