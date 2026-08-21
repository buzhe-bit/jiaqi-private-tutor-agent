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

function createPostForTest(fetchImpl, logs) {
  const match = script.match(/const RETRYABLE_TRANSPORT_CODES[\s\S]*?function createPost[\s\S]*?\n}\n\nconst post = createPost/);
  assert.ok(match, "verify-production must expose a local post factory");
  const logger = { log: (entry) => logs.push(entry) };
  const factorySource = match[0].replace(/\n\nconst post = createPost$/, "");
  const createPost = vm.runInNewContext(`(() => { ${factorySource}; return createPost; })()`, { Set, console: logger });
  return createPost({ baseUrl: "https://pilot.example", fetchImpl, logger });
}

const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

function createPostCase(fetchImpl) {
  const calls = [], logs = [];
  const post = createPostForTest((url, options) => {
    calls.push({ url, body: options.body });
    return fetchImpl(calls.length, url, options);
  }, logs);
  return { calls, logs, post };
}

async function assertNoReplay({ path, fetchImpl, expectedError }) {
  const { calls, logs, post } = createPostCase(fetchImpl);
  await assert.rejects(() => post(path, { sessionToken: "TOKEN-SECRET", inviteCode: "INVITE-SECRET" }), expectedError);
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, []);
}

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

test("verifier replays one step transport failure with byte-identical request", async () => {
  const { calls, logs, post } = createPostCase((attempt) => {
    if (attempt === 1) throw transportError("UND_ERR_CONNECT_TIMEOUT");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const body = { sessionToken: "TOKEN-SECRET", input: "ANSWER-SECRET", snapshot: { primaryIssue: "PRIVATE" } };

  assert.deepEqual(await post("/api/session/step", body), { ok: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(logs, ["verify-retry event=transport error-code=UND_ERR_CONNECT_TIMEOUT"]);
  assert.doesNotMatch(JSON.stringify(logs), /TOKEN-SECRET|ANSWER-SECRET|PRIVATE|pilot\.example/);
});

test("verifier caps step transport replay at two calls", async () => {
  const { calls, logs, post } = createPostCase(() => {
    throw transportError("ECONNRESET");
  });

  await assert.rejects(() => post("/api/session/step", { input: "same" }), /fetch failed/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(logs.length, 1);
});

test("verifier does not replay HTTP 503, unknown, or non-step failures", async () => {
  for (const scenario of [
    { path: "/api/session/step", fetchImpl: async () => new Response(JSON.stringify({ code: "COACH_TIMEOUT" }), { status: 503 }), expectedError: /\/api\/session\/step 503/ },
    { path: "/api/session/step", fetchImpl: async () => { throw transportError("UND_ERR_SOCKET"); }, expectedError: /fetch failed/ },
    { path: "/api/session/start", fetchImpl: async () => { throw transportError("ETIMEDOUT"); }, expectedError: /fetch failed/ }
  ]) await assertNoReplay(scenario);
});
