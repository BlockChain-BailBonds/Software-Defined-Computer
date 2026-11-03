/* NTL Difference Lab v1: deterministic, offline text and model-output comparisons.
 * This analyzes supplied responses. It does not infer a model's identity.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NTLDiff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_TEXT = 32768;
  const MAX_PROMPT = 8192;
  const MAX_CASES = 32;
  const MAX_DIFF_LINES = 180;
  const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  const round = n => Math.round(n * 10000) / 10000;
  function check(cond, error) { if (!cond) throw new Error(error); }
  function checkText(value, label, max = MAX_TEXT) {
    check(typeof value === 'string', label + ' must be a string');
    check(value.length <= max, label + ' exceeds the ' + max + '-character limit');
    return value;
  }
  function tokens(text) { return (text.normalize('NFKC').toLocaleLowerCase('en-US').match(WORD) || []); }
  function normalized(text) { return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US'); }
  function frequency(list) { const counts = new Map(); for (const x of list) counts.set(x, (counts.get(x) || 0) + 1); return counts; }
  function jaccard(a, b) {
    const left = new Set(a), right = new Set(b);
    if (left.size === 0 && right.size === 0) return 1;
    let shared = 0;
    for (const key of left) if (right.has(key)) shared++;
    return round(shared / (left.size + right.size - shared));
  }
  function bigrams(list) { const out = []; for (let i = 1; i < list.length; i++) out.push(list[i - 1] + '\u0000' + list[i]); return out; }
  function charTrigrams(input) {
    const text = normalized(input);
    const chars = Array.from(text);
    if (chars.length < 3) return chars.length ? [chars.join('')] : [];
    const out = [];
    for (let i = 0; i + 2 < chars.length; i++) out.push(chars.slice(i, i + 3).join(''));
    return out;
  }
  // Jensen-Shannon divergence, base 2, bounded to [0,1].
  function divergence(a, b) {
    const fa = frequency(a), fb = frequency(b);
    const sa = a.length, sb = b.length;
    if (!sa && !sb) return 0;
    if (!sa || !sb) return 1;
    const keys = new Set([...fa.keys(), ...fb.keys()]);
    let js = 0;
    for (const key of keys) {
      const p = (fa.get(key) || 0) / sa, q = (fb.get(key) || 0) / sb;
      const m = (p + q) / 2;
      if (p) js += 0.5 * p * Math.log2(p / m);
      if (q) js += 0.5 * q * Math.log2(q / m);
    }
    return round(Math.min(1, Math.max(0, js)));
  }
  function measures(text) {
    checkText(text, 'Response');
    const t = tokens(text);
    const lines = text.split(/\r?\n/);
    const nonblank = lines.filter(x => x.trim());
    const sentences = text.match(/[.!?]+(?=\s|$)/g) || [];
    const words = t.length;
    const count = re => (text.match(re) || []).length;
    const codeFences = count(/^\s*```/gm);
    const bullets = count(/^\s*[-*+]\s+\S/gm);
    const ordered = count(/^\s*\d+[.)]\s+\S/gm);
    const headings = count(/^\s*#{1,6}\s+\S/gm);
    const questions = count(/\?/g);
    const commas = count(/,/g);
    const semicolons = count(/;/g);
    const emojis = count(/\p{Extended_Pictographic}/gu);
    const code = codeFences >= 2 ? true : false;
    const paragraphs = text.trim() ? text.trim().split(/\n\s*\n/).length : 0;
    const avg = words ? t.reduce((n, w) => n + Array.from(w).length, 0) / words : 0;
    return {
      characters: text.length,
      words,
      uniqueWords: new Set(t).size,
      uniqueWordRatio: round(words ? new Set(t).size / words : 0),
      meanWordLength: round(avg),
      sentenceCount: sentences.length,
      wordsPerSentence: round(sentences.length ? words / sentences.length : 0),
      lineCount: lines.length,
      nonblankLines: nonblank.length,
      paragraphs,
      bulletCount: bullets,
      numberedCount: ordered,
      headingCount: headings,
      codeFenceCount: codeFences,
      hasFencedCode: code,
      questionCount: questions,
      commaCount: commas,
      semicolonCount: semicolons,
      emojiCount: emojis,
      estimatedReadingWords: words
    };
  }
  function deltas(a, b) {
    const keys = Object.keys(a).filter(key => typeof a[key] === 'number');
    return Object.fromEntries(keys.map(key => [key, round(b[key] - a[key])]));
  }
  function changedTerms(a, b, limit = 12) {
    const x = frequency(tokens(a)), y = frequency(tokens(b));
    return [...new Set([...x.keys(), ...y.keys()])]
      .map(term => ({ term, inA: x.get(term) || 0, inB: y.get(term) || 0, delta: (y.get(term) || 0) - (x.get(term) || 0) }))
      .filter(x => x.delta !== 0)
      .sort((u, v) => Math.abs(v.delta) - Math.abs(u.delta) || u.term.localeCompare(v.term))
      .slice(0, limit);
  }
  function excerpt(text, start, end, radius = 42) {
    const before = Math.max(0, start - radius), after = Math.min(text.length, end + radius);
    return (before ? '…' : '') + text.slice(before, after) + (after < text.length ? '…' : '');
  }
  function changeRegion(a, b) {
    if (a === b) return { firstDifferenceIndex: -1, removed: '', added: '', changedCharactersA: 0, changedCharactersB: 0 };
    let start = 0;
    const length = Math.min(a.length, b.length);
    while (start < length && a[start] === b[start]) start++;
    let endA = a.length, endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    return { firstDifferenceIndex: start,
      removed: excerpt(a, start, endA), added: excerpt(b, start, endB),
      changedCharactersA: endA - start, changedCharactersB: endB - start };
  }
  // Exact line-by-line LCS diff for bounded input. Does not execute pasted text.
  function lineDiff(a, b) {
    const la = a.split(/\r?\n/), lb = b.split(/\r?\n/);
    const truncated = la.length > MAX_DIFF_LINES || lb.length > MAX_DIFF_LINES;
    const aa = la.slice(0, MAX_DIFF_LINES), bb = lb.slice(0, MAX_DIFF_LINES);
    const n = aa.length, m = bb.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) dp[i][j] = aa[i] === bb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    let i = 0, j = 0;
    const changes = [];
    const summary = { equal: 0, added: 0, removed: 0 };
    while (i < n || j < m) {
      if (i < n && j < m && aa[i] === bb[j]) { summary.equal++; i++; j++; }
      else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
        summary.added++; changes.push({ type: 'add', lineB: j + 1, text: bb[j] }); j++;
      } else { summary.removed++; changes.push({ type: 'remove', lineA: i + 1, text: aa[i] }); i++; }
    }
    return { summary, changes: changes.slice(0, 120), omittedChanges: Math.max(0, changes.length - 120),
      truncated, limits: { maxLinesPerResponse: MAX_DIFF_LINES, maxDisplayedChanges: 120 } };
  }
  function analyzePair(input) {
    check(input && typeof input === 'object' && !Array.isArray(input), 'Pair input must be an object');
    const prompt = checkText(input.prompt ?? '', 'Prompt', MAX_PROMPT);
    const responseA = checkText(input.responseA, 'Response A');
    const responseB = checkText(input.responseB, 'Response B');
    const labelA = checkText(input.labelA ?? 'A', 'Label A', 100);
    const labelB = checkText(input.labelB ?? 'B', 'Label B', 100);
    const a = measures(responseA), b = measures(responseB);
    const ta = tokens(responseA), tb = tokens(responseB);
    const same = responseA === responseB;
    const normSame = normalized(responseA) === normalized(responseB);
    const uni = jaccard(ta, tb), bi = jaccard(bigrams(ta), bigrams(tb));
    const js = divergence(charTrigrams(responseA), charTrigrams(responseB));
    const structuralKeys = ['paragraphs', 'bulletCount', 'numberedCount', 'headingCount', 'codeFenceCount', 'questionCount'];
    const structuralChanges = structuralKeys.filter(key => a[key] !== b[key]);
    const ratio = a.words && b.words ? round(Math.min(a.words, b.words) / Math.max(a.words, b.words)) : (a.words === b.words ? 1 : 0);
    const labels = same ? ['exact-match'] : normSame ? ['surface-only-difference'] : ['content-difference'];
    if (!normSame && structuralChanges.length) labels.push('structure-difference');
    if (!normSame && ratio < 0.7) labels.push('length-difference');
    return {
      format: 'NTL_DIFFERENCE_REPORT', version: 1,
      context: { prompt, labelA, labelB },
      exactMatch: same, normalizedMatch: normSame,
      classification: labels,
      metrics: { wordJaccard: uni, bigramJaccard: bi, charTrigramJSD: js,
        wordCountRatio: ratio },
      features: { A: a, B: b, delta: deltas(a, b) },
      structuralChanges,
      changedTerms: changedTerms(responseA, responseB),
      firstChange: changeRegion(responseA, responseB),
      lineDiff: lineDiff(responseA, responseB),
      interpretation: same ? 'Outputs are byte-for-byte equal.' : normSame ?
        'Outputs differ in case, Unicode normalization, or whitespace only.' :
        'Outputs differ. Similarity scores quantify surface and distribution changes, not factual correctness or model identity.',
      attribution: { status: 'not-identified', note: 'A/B response differences alone cannot identify the generating LLM. Evaluate against independent, labeled reference data.' }
    };
  }
  function parseBatch(data) {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    check(obj && typeof obj === 'object' && !Array.isArray(obj) && obj.format === 'NTL_DIFF_BATCH' && obj.version === 1 && Array.isArray(obj.cases), 'Expected NTL_DIFF_BATCH v1 JSON');
    check(obj.cases.length >= 1 && obj.cases.length <= MAX_CASES, 'Batch must contain 1..' + MAX_CASES + ' cases');
    const labelPairs = new Set(obj.cases.map(c => JSON.stringify([c?.labelA ?? 'A', c?.labelB ?? 'B'])));
    check(labelPairs.size === 1, 'All batch cases must compare the same A/B candidate labels');
    return obj.cases.map((c, i) => {
      check(c && typeof c === 'object' && !Array.isArray(c), 'Case ' + (i + 1) + ' must be an object');
      const parsed = { prompt: checkText(c.prompt ?? '', 'Case prompt', MAX_PROMPT),
        labelA: checkText(c.labelA ?? 'A', 'Case labelA', 100),
        labelB: checkText(c.labelB ?? 'B', 'Case labelB', 100),
        responseA: checkText(c.responseA, 'Case responseA'), responseB: checkText(c.responseB, 'Case responseB') };
      return parsed;
    });
  }
  function analyzeBatch(obj) {
    const cases = parseBatch(obj);
    const reports = cases.map(analyzePair);
    const mean = key => round(reports.reduce((n, r) => n + r.metrics[key], 0) / reports.length);
    const exactMatches = reports.filter(r => r.exactMatch).length;
    const normalizedMatches = reports.filter(r => r.normalizedMatch).length;
    return {
      format: 'NTL_BATCH_REPORT', version: 1, count: reports.length, exactMatches, normalizedMatches,
      summary: { meanWordJaccard: mean('wordJaccard'), meanBigramJaccard: mean('bigramJaccard'),
        meanCharTrigramJSD: mean('charTrigramJSD'), meanWordCountRatio: mean('wordCountRatio'),
        differentPrompts: new Set(cases.map(c => normalized(c.prompt))).size },
      cases: reports,
      attribution: { status: 'not-identified', note: 'Multi-prompt comparisons characterize reproducible differences; they do not establish provenance or identity.' }
    };
  }
  const demo = {
    format: 'NTL_DIFF_BATCH', version: 1, cases: [
      { prompt: 'Explain checksum validation in two sentences.', labelA: 'Candidate A', labelB: 'Candidate B',
        responseA: 'A checksum summarizes file content. Compare the saved checksum with a fresh one to detect accidental changes.',
        responseB: 'Checksums help detect file changes. Compute the digest again and compare the values; a match does not guarantee authenticity.' },
      { prompt: 'List three ways to organize a Python project.', labelA: 'Candidate A', labelB: 'Candidate B',
        responseA: '- Separate source and tests.\n- Keep dependencies pinned.\n- Document setup steps.',
        responseB: '1. Use a src/ folder.\n2. Pin dependencies.\n3. Write a README and tests.' }
    ]
  };
  return { analyzePair, analyzeBatch, parseBatch, measures, lineDiff, demo,
    constants: { MAX_TEXT, MAX_PROMPT, MAX_CASES, MAX_DIFF_LINES } };
});
