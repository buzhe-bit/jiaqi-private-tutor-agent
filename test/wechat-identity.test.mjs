import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createMemoryLearningStore } from "../src/records/learning-store.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";


const SECRET = "wechat-identity-test-signing-secret";


function request(path, body, { openid, appid } = {}) {
  const headers = { "content-type": "application/json" };
  if (openid !== undefined) headers["x-wx-openid"] = openid;
  if (appid !== undefined) headers["x-wx-appid"] = appid;
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}


function appFixture({ recorder = createMemoryRecorder(), learningStore = null } = {}) {
  const app = createApp({
    config: {
      invites: new Map([["demo", { participantCode: "DEMO", cohort: "demo" }]]),
      sessionSigningSecret: SECRET,
      coachProvider: "mock",
      recordProvider: "memory"
    },
    coach: { async evaluate() { throw new Error("not used"); } },
    recorder,
    learningStore
  });
  return { app, recorder, learningStore };
}


async function bodyOf(response) {
  return response.json();
}


test("public endpoints reject caller-supplied WeChat identity headers", async () => {
  const { app, recorder } = appFixture();
  for (const path of ["/api/session/start", "/api/learner/sync", "/api/practice/next"]) {
    const response = await app.handle(request(path, {
      inviteCode: "demo",
      consent: true
    }, {
      openid: "caller-supplied-openid",
      appid: "wx-caller-supplied"
    }));
    assert.equal(response.status, 403, path);
  }
  assert.equal(recorder.records.size, 0);
});


test("requests without WeChat identity headers keep the webpage invite path", async () => {
  const learningStore = createMemoryLearningStore();
  const { app } = appFixture({ learningStore });
  const started = await app.handle(request("/api/session/start", {
    inviteCode: "demo",
    consent: true
  }));
  const sync = await app.handle(request("/api/learner/sync", { inviteCode: "demo" }));
  const practice = await app.handle(request("/api/practice/next", { inviteCode: "demo" }));

  assert.equal(started.status, 201);
  assert.equal((await bodyOf(started)).participantCode, "DEMO");
  assert.equal(sync.status, 200);
  assert.equal((await bodyOf(sync)).participantCode, "DEMO");
  assert.equal(practice.status, 200);
});
