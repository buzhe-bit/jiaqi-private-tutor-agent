import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createApi } = require("../miniprogram/services/api.js");
const { createDemoAdapter } = require("../miniprogram/services/demo-adapter.js");


test("local demo exposes health, recommendation and session start", async () => {
  const api = createApi({
    config: { mode: "local-demo" },
    demoAdapter: createDemoAdapter()
  });

  assert.equal((await api.get("/api/health")).coachMode, "demo");
  const next = await api.post("/api/practice/next", { inviteCode: "demo" });
  const session = await api.post("/api/session/start", {
    inviteCode: "demo",
    questionId: next.questionId
  });

  assert.ok(next.questionId);
  assert.equal(session.stage, "attempt");
  assert.equal(session.questionId, next.questionId);
});


test("cloudbase mode sends the existing API through callContainer", async () => {
  const calls = [];
  const wxApi = {
    cloud: {
      async callContainer(options) {
        calls.push(options);
        return { statusCode: 200, data: { ok: true } };
      }
    }
  };
  const api = createApi({
    wxApi,
    config: {
      mode: "cloudbase",
      cloudbaseEnv: "env-test",
      cloudbaseService: "philosophy-coach"
    }
  });

  assert.deepEqual(await api.post("/api/practice/next", { inviteCode: "P01" }), { ok: true });
  assert.equal(calls[0].path, "/api/practice/next");
  assert.equal(calls[0].header["X-WX-SERVICE"], "philosophy-coach");
  assert.deepEqual(calls[0].data, { inviteCode: "P01" });
});


test("service errors become a student-safe retryable error", async () => {
  const wxApi = {
    cloud: {
      async callContainer() {
        return {
          statusCode: 503,
          data: { error: "上游超时", code: "COACH_UPSTREAM_ERROR", retryable: true }
        };
      }
    }
  };
  const api = createApi({
    wxApi,
    config: { mode: "cloudbase", cloudbaseEnv: "env-test", cloudbaseService: "coach" }
  });

  await assert.rejects(
    () => api.post("/api/session/step", { input: "我的回答" }),
    (error) => error.code === "COACH_UPSTREAM_ERROR"
      && error.retryable === true
      && error.preserved === true
  );
});


test("local demo can restore an unfinished session after the app restarts", async () => {
  const stored = {
    sessionId: "stored-session",
    sessionToken: "stored-token",
    questionId: "kant-freedom-keystone",
    question: "康德自由题",
    questionKind: "relation",
    stage: "restate",
    snapshot: { initialAnswer: "我的初答" },
    messages: []
  };
  const adapter = createDemoAdapter({ sessions: [stored] });
  const sync = await adapter.request("POST", "/api/learner/sync", { inviteCode: "demo" });
  const result = await adapter.request("POST", "/api/session/step", {
    sessionToken: "stored-token",
    stage: "restate",
    action: "submit_restate",
    input: "理论理性留下可能，实践理性赋予意义",
    snapshot: stored.snapshot,
    messages: []
  });

  assert.equal(sync.sessions[0].stage, "restate");
  assert.equal(result.nextStage, "revision");
});
