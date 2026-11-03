# Validation report

**Local verification date:** 2026-11-03. Checks were run on the restored archived sources as packaged, with Node.js 22 and a Python interpreter containing project test dependencies.

| Module | Executed command | Outcome |
| --- | --- | --- |
| Core VM | `cd core && node --test *.test.js` | 14/14 passed |
| NTL VM | `cd extensions/ntl && node --test *.test.js` | 30/30 passed |
| Agency embedded VM | `cd integrations/agency-lab/web/vm && node --test *.test.js` | 14/14 passed |
| Agency API/backend | `cd integrations/agency-lab && python3 -m pytest -q tests` | 23/23 passed |
| RedLab | `cd integrations/redlab-os && python3 -m unittest discover -s tests -q` | 32/32 passed |
| Python syntax check | `python3 -m compileall -q integrations/agency-lab integrations/redlab-os` | Passed |

**Aggregate 113 test assertions/cases reported as individual passing tests** across the above suites (14+30+14+23+32). Repeated VM tests test independent archival copies, not 113 unique subsystems.

**Not verified:** exact-head ESP32 PlatformIO binary, full 16 MiB Linux flash image, current firmware compatibility, ESP32-S3 GPIO or camera mapping, CH340/UART0 interactions, CYD touchscreen/display, Flipper FAP, live GGUF output, hardware acceptability, performance benchmarks, formal security audit, or ownership/title of third-party code.

Passing CI establishes only successful execution of the listed software tests on the CI runner. It must not be described as physical device acceptance or operational Linux on a particular board.
