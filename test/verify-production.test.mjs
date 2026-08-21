import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const script = await readFile(
  new URL("../scripts/verify-production.mjs", import.meta.url),
  "utf8"
);
const profilesSource = script.match(
  /const profiles = (\{[\s\S]*?\n\});\n\nconst profile/
)[1];
const profiles = vm.runInNewContext(`(${profilesSource})`);

test("expression verifier candidates differ and become more complete", () => {
  const candidates = profiles.expression.revisions;

  assert.ok(Array.isArray(candidates));
  assert.ok(candidates.length >= 2 && candidates.length <= 3);
  assert.equal(new Set(candidates).size, candidates.length);

  for (let index = 1; index < candidates.length; index += 1) {
    assert.ok(candidates[index].length > candidates[index - 1].length);
  }
});

test("unknown profile revision candidates are distinct and progressively complete", () => {
  const candidates = profiles.unknown.revisions;

  assert.ok(Array.isArray(candidates));
  assert.equal(candidates.length, 3);
  const hashes = candidates.map((candidate) => createHash("sha256")
    .update(candidate)
    .digest("hex")
    .slice(0, 12));
  assert.equal(new Set(hashes).size, candidates.length);

  for (let index = 1; index < candidates.length; index += 1) {
    assert.ok(candidates[index].length > candidates[index - 1].length);
  }
  assert.match(candidates[0], /理论理性.*实践理性|实践理性.*理论理性/);
  assert.match(candidates[1], /物自身|自我立法|道德法则/);
  assert.match(candidates[2], /必要条件|拱顶石|实践必然性/);
});

test("unknown profile uses a different candidate for each repeated revision gate", () => {
  const candidates = profiles.unknown.revisions;
  let revisionRound = 0;
  const inputs = Array.from({ length: 3 }, () => candidates[revisionRound++]);

  assert.equal(new Set(inputs).size, 3);
  assert.deepEqual(inputs, Array.from(candidates));
  assert.match(script, /profile\.restate \?\?/);
  assert.equal(
    (script.match(/profile\.revisions\?\.\[revisionRound\+\+\]/g) || []).length,
    2
  );
});

test("verifier advances the shared candidate cursor and logs only input metadata", () => {
  assert.match(script, /let revisionRound = 0;/);
  assert.equal(
    (script.match(/profile\.revisions\?\.\[revisionRound\+\+\]/g) || [])
      .length,
    2
  );
  assert.match(script, /createHash\("sha256"\)/);
  assert.match(script, /input-length=\$\{inputText\.length\}/);
  assert.match(script, /input-sha256=\$\{inputDigest\}/);
  assert.doesNotMatch(script, /console\.log\([^)]*inviteCode/);
});
