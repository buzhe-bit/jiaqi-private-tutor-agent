import assert from "node:assert/strict";
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

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.deepEqual(await health.json(), { ok: true, product: "philosophy-answer-coach" });

  const missing = await fetch(`http://127.0.0.1:${port}/not-a-real-file.js`);
  assert.equal(missing.status, 404);
});
