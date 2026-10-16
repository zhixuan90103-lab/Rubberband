import assert from 'node:assert/strict';
import { checkSeam, defaultDoc, issuesFor } from '../src/editor/levelModel';

const doc = defaultDoc();
const opening = doc.cards[0];
const rise = doc.cards[1];
if (!opening || !rise) throw new Error('default deck missing cards');

assert(!issuesFor(opening).some((issue) => issue.level === 'block'), 'default opening is playable');
const riseIssues = issuesFor(rise);
assert(
  !riseIssues.some((issue) => issue.code === 'tooFar' || issue.code === 'tooClose' || issue.code === 'noEntry' || issue.code === 'noExit'),
  'default rise card connects inside itself',
);
assert(checkSeam(opening, rise).ok, 'opening stitches onto the sample card');

const low = rise.pegs[0];
const high = rise.pegs[1];
if (!low || !high) throw new Error('sample pegs missing');
const tight = structuredClone(rise);
tight.pegs[1] = { ...high, y: low.y - 120, x: low.x };
assert(issuesFor(tight).some((issue) => issue.code === 'tooClose'), 'a short jump is marked too close');
const row = structuredClone(rise);
row.pegs[1] = { ...high, y: low.y, x: low.x + 100 };
assert(!issuesFor(row).some((issue) => issue.code === 'tooClose'), 'pegs on one row may sit closer than 200px');

console.log('level model checks passed');
