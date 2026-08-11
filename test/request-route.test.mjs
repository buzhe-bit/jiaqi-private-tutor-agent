import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createMockCoach } from "../src/coach/providers.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";
import { createHttpServer } from "../src/server.mjs";


test("gray preview parameter follows every API request", async () => {
  const { withPreviewRoute } = await import("../public/request-route.js");

  assert.equal(
    withPreviewRoute("/api/session/step", "?invite=student&preview=knowledge-chat-v2"),
    "/api/session/step?preview=knowledge-chat-v2"
  );
  assert.equal(withPreviewRoute("/api/health", "?invite=student"), "/api/health");

  const client = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(client, /fetch\(withPreviewRoute\(path\)/);
  assert.match(client, /import\(`\.\/history-store\.js\$\{moduleQuery\}`\)/);
});


test("gray preview parameter follows the browser entry assets", async (t) => {
  const app = createApp({
    config: { invites: new Map() },
    coach: createMockCoach(),
    recorder: createMemoryRecorder()
  });
  const server = createHttpServer({ app });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const page = await fetch(`http://127.0.0.1:${port}/?preview=knowledge-chat-v2`);
  const html = await page.text();
  assert.match(html, /styles\.css\?v=[^" ]+&preview=knowledge-chat-v2/);
  assert.match(html, /app\.js\?v=[^" ]+&preview=knowledge-chat-v2/);
  assert.match(html, /plum-progress-final\.png\?preview=knowledge-chat-v2/);

  const helper = await fetch(`http://127.0.0.1:${port}/request-route.js?preview=knowledge-chat-v2`);
  assert.equal(helper.status, 200);
});
