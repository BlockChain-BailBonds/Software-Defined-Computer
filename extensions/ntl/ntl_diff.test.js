'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const NTL = require('./ntl_diff');
const pair = (a,b) => NTL.analyzePair({ prompt: 'Explain deterministic tests', labelA: 'X', labelB: 'Y', responseA: a, responseB: b });

test('identical responses report exact and normalized match without identity claims', () => {
  const r = pair('alpha\nbeta', 'alpha\nbeta');
  assert.equal(r.exactMatch, true);
  assert.equal(r.normalizedMatch, true);
  assert.equal(r.metrics.wordJaccard, 1);
  assert.equal(r.metrics.bigramJaccard, 1);
  assert.equal(r.metrics.charTrigramJSD, 0);
  assert.deepEqual(r.lineDiff.summary, { equal: 2, added: 0, removed: 0 });
  assert.equal(r.attribution.status, 'not-identified');
  assert.equal(r.firstChange.firstDifferenceIndex, -1);
  assert.equal(r.firstChange.removed, '');
});
test('normalization separates case and whitespace changes from lexical changes', () => {
  const r = pair('  Hello  WORLD\n', 'hello world');
  assert.equal(r.exactMatch, false);
  assert.equal(r.normalizedMatch, true);
  assert.deepEqual(r.classification, ['surface-only-difference']);
});
test('different responses reveal structured, lexical and punctuation changes', () => {
  const r = pair('A summary.\n- One item', 'Different summary!\n## Heading\n- One item\n- Second item');
  assert.ok(r.metrics.wordJaccard < 1);
  assert.ok(r.metrics.charTrigramJSD > 0);
  assert.ok(r.structuralChanges.includes('headingCount'));
  assert.ok(r.features.delta.bulletCount > 0);
  assert.ok(r.lineDiff.summary.added > 0);
  assert.ok(r.changedTerms.length > 0);
  assert.equal(r.firstChange.firstDifferenceIndex, 0);
});
test('punctuation-only edits are not claimed as lexical differences', () => {
  const r = pair('Sure, yes.', 'Sure? yes!');
  assert.equal(r.metrics.wordJaccard, 1);
  assert.equal(r.exactMatch, false);
  assert.ok(r.metrics.charTrigramJSD > 0);
});
test('one empty response remains comparable, both empty are numerically well defined', () => {
  const one = pair('', 'hello');
  assert.equal(one.metrics.wordCountRatio, 0);
  assert.equal(one.metrics.charTrigramJSD, 1);
  const both = pair('', '');
  assert.equal(both.metrics.wordJaccard, 1);
  assert.equal(both.metrics.bigramJaccard, 1);
  assert.equal(both.metrics.charTrigramJSD, 0);
});
test('unicode and emoji can be counted without markup execution', () => {
  const r = pair('Café 🐱\n```js\nconst x = 1;\n```', 'Cafe ☕');
  assert.equal(r.features.A.emojiCount, 1);
  assert.equal(r.features.A.codeFenceCount, 2);
  assert.equal(r.features.A.hasFencedCode, true);
});
test('line diff computes minimal additions and removals for small input', () => {
  const d = NTL.lineDiff('x\ny\nz', 'x\nz\na');
  assert.deepEqual(d.summary, { equal: 2, added: 1, removed: 1 });
  assert.deepEqual(d.changes.map(c => c.type), ['remove','add']);
});
test('long outputs trigger bounded explicit diff truncation', () => {
  const r = pair(Array(200).fill('a').join('\n'), Array(200).fill('b').join('\n'));
  assert.equal(r.lineDiff.truncated, true);
  assert.equal(r.lineDiff.limits.maxLinesPerResponse, 180);
});
test('differences are symmetric in distance and reverse signs in features', () => {
  const a = 'Short text.', b = 'A longer text with extra words and a question?';
  const ab = pair(a, b), ba = pair(b, a);
  for (const metric of Object.keys(ab.metrics)) assert.equal(ab.metrics[metric], ba.metrics[metric]);
  assert.equal(ab.features.delta.words, -ba.features.delta.words);
});
test('batch report tracks prompt variation without attribution', () => {
  const r = NTL.analyzeBatch(NTL.demo);
  assert.equal(r.count, 2);
  assert.equal(r.summary.differentPrompts, 2);
  assert.ok(r.summary.meanWordJaccard >= 0 && r.summary.meanWordJaccard <= 1);
  assert.equal(r.attribution.status, 'not-identified');
  assert.equal(r.cases.length, 2);
});
test('malformed batch, mixed candidate pairs and excessive text are rejected', () => {
  assert.throws(() => NTL.parseBatch('{}'), /Expected NTL_DIFF_BATCH/);
  assert.throws(() => NTL.analyzeBatch({format:'NTL_DIFF_BATCH',version:1,cases:[]}), /1..32/);
  assert.throws(() => NTL.parseBatch({format:'NTL_DIFF_BATCH',version:1,cases:[
    {labelA:'one',labelB:'two',responseA:'a',responseB:'b'},
    {labelA:'three',labelB:'four',responseA:'a',responseB:'b'}
  ]}), /same A\/B/);
  assert.throws(() => pair('a'.repeat(32769), 'ok'), /character limit/);
  assert.throws(() => pair(null, 'ok'), /must be a string/);
});
test('repeat analysis gives precisely equal output, no timestamps or random values', () => {
  const r1 = pair('An example of reproducibility', 'A distinct example of reproducibility');
  const r2 = pair('An example of reproducibility', 'A distinct example of reproducibility');
  assert.deepEqual(r1, r2);
});
