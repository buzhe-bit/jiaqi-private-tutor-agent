import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createMockCoach } from "../src/coach/providers.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";
import { createHttpServer } from "../src/server.mjs";


test("HTTP server serves the mobile app and API with security headers", async (t) => {
  const app = createApp({
    config: { invites: new Map([["demo", { participantCode: "DEMO", cohort: "demo" }]]) },
    coach: createMockCoach(),
    recorder: createMemoryRecorder()
  });
  const server = createHttpServer({ app });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const page = await fetch(`http://127.0.0.1:${port}/?invite=demo`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /哲学论述陪练/);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);

  const clientScript = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  assert.match(clientScript, /sessionToken:\s*state\.sessionToken/);

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.deepEqual(await health.json(), { ok: true, product: "philosophy-answer-coach" });

  const missing = await fetch(`http://127.0.0.1:${port}/not-a-real-file.js`);
  assert.equal(missing.status, 404);
});

test("client offers source material before the session starts", async () => {
  const script = await readClientScript();

  assert.match(script, /type:\s*"file"/);
  assert.match(script, /\.txt,\.md/);
  assert.match(script, /sourceExcerpt:\s*materialText/);
});

test("client keeps the question visible through every learning stage", async () => {
  const script = await readClientScript();

  for (const functionName of ["renderInterpretation", "renderAttempt", "renderRepair", "renderRewrite", "renderReflection"]) {
    const body = functionBody(script, functionName);
    assert.match(body, /questionCard\(/, `${functionName} should render the question`);
  }
});

test("client tells students their answer is preserved after retryable failures", async () => {
  const script = await readClientScript();

  assert.match(script, /答案已保留/);
  assert.match(script, /重新提交/);
});


async function readClientScript() {
  return readFile(new URL("../public/app.js", import.meta.url), "utf8");
}


function functionBody(script, functionName) {
  const start = script.indexOf(`function ${functionName}(`);
  const next = script.indexOf("\nfunction ", start + 1);
  return script.slice(start, next < 0 ? script.length : next);
}
