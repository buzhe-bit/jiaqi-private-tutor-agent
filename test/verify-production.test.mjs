import assert from "node:assert/strict";
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
