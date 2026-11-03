# Name That LLM — Offline Difference Lab

This extension to Internal Computer analyzes **the observed differences between supplied LLM outputs**.
The results are *behavioral observations*, **not a validated claim of LLM attribution**.
The name references the user's Name That LLM effort; this is a new, transparent
comparison implementation, not a reimplementation of any unprovided legacy NTL/ADL weights.

## Quick start (Android or desktop)

1. Open `internal_computer.html` in a modern browser. It is a single HTML file.
2. Select **NTL DIFF** in the top toolbar.
3. Paste the *same exact prompt* used for two models. Paste each candidate's response.
4. Click **COMPARE RESPONSES**. Read the normalized similarity, token changes,
   formatting deltas, character-trigram divergence, and bounded line differences.
5. Click **EXPORT REPORT JSON** to save the full pair of input texts, their prompt,
   and the reproducible comparison report. **SAVE TO VIRTUAL DISK** stores a smaller
   analytical summary (no complete response text) in the computer's virtual filesystem.
6. Choose **EXAMPLE BATCH**, or paste/import `NTL_DIFF_BATCH` JSON under **BATCH
   EXPERIMENTS**, then choose **ANALYZE BATCH**.

If Android blocks `file://` localStorage, you can use the terminal command below
with the extracted source folder. You do not need the Internet:

```sh
pkg install python
cd /path/to/internal_computer
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000` on the same Android device. Files stay local.
The offline single-file version does not require this server unless local-storage
or file permissions require serving from localhost.

## Using the computer's virtual terminal

If you have two response files on the *virtual disk*, you can type:

```text
write /home/guest/a.txt "A short answer."
write /home/guest/b.txt "A longer answer with other words."
ntl /home/guest/a.txt /home/guest/b.txt
```

Or include the third path to a virtual text file containing the test prompt:

```text
ntl /home/guest/a.txt /home/guest/b.txt /home/guest/prompt.txt
```

The comparison panel opens automatically. The terminal command reads the virtual
filesystem only; it does not read your real Android files or call a network API.

## JSON batch format

`ntl_batch_example.json` demonstrates the complete schema:

```json
{
  "format": "NTL_DIFF_BATCH",
  "version": 1,
  "cases": [
    {
      "prompt": "Explain checksums in two sentences.",
      "labelA": "Model A",
      "labelB": "Model B",
      "responseA": "A checksum summarizes data. Compare values to detect changes.",
      "responseB": "Checksums can detect alterations. Recompute the digest and compare it."
    }
  ]
}
```

Use the **same pair of A/B candidate labels in every case**, and the **same exact
prompt for A and B within each case**. You can repeat prompts to inspect variation
across sampled outputs, provided sampling parameters are controlled or recorded.
The batch result contains per-case metrics and aggregate averages. Without a
proper study it does not establish statistical significance or authorship.

## Measured features

| Measure | What it actually represents |
| --- | --- |
| Exact / normalized match | Exact code-unit equality; or equality after NFKC, whitespace collapse, and lowercasing |
| Unigram Jaccard | Unique normalized word overlap, 0–1 (1 means identical word sets) |
| Bigram Jaccard | Unique adjacent word-pair overlap, 0–1 |
| Character trigram JSD | Jensen–Shannon divergence between normalized trigram distributions, 0–1 (0 means indistinguishable by this measure) |
| Word count ratio | Shorter / longer token count; 1 = equal length |
| Structural features | Paragraphs, bullets, headings, numbered items, code fences, questions, emojis |
| Token frequency delta | Largest B-minus-A token frequency changes |
| Line diff | Bounded LCS alignment of original lines, showing additions/removals and explicit truncation |

Natural-language meaning, factual correctness, adversarial paraphrase resilience,
shared model lineage, and calibrated model identity are **not** inferred from these
surface-level metrics. A rigorous NTL identity detector requires an independent,
labeled reference dataset, controlled prompt suite, held-out evaluation, and an
abstention threshold with empirical false-positive/false-attribution estimates.

## Engineering and privacy

- Works fully offline in a browser. No dependencies, network calls, telemetry,
  external scripts, AI service, runtime `eval`, or `Function` constructor.
- The existing 16-bit CPU and assembler remain unchanged. The difference analyzer
  runs as ordinary browser JavaScript, not as virtual CPU machine instructions.
- Source input size: maximum 32,768 UTF-16 code units per response, 8,192 per
  prompt; batch limit is 32 cases. Line diff considers the first 180 lines per
  response and displays 120 raw changed lines in exports; truncation is disclosed.
- Reports are rendered with `textContent`, not untrusted HTML interpolation.
- **EXPORT REPORT JSON includes complete response text**, so avoid sharing it
  if the model outputs include confidential material.
- **SAVE TO VIRTUAL DISK** stores a reduced summary without full raw answers.
  Virtual disk storage is browser-local and subject to the 1 MiB virtual quota
  and per-file quota of 128 KiB.
- The `ntl_diff.js` comparison API is deterministic (no randomization or timestamps);
  user-triggered file exports include a creation timestamp.

## Test

Node.js 18+ (no external packages):

```sh
node --test core.test.js ntl_diff.test.js ui.smoke.test.js
python3 build.py
```

The build produces the standalone `internal_computer.html`.
