import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createMemoryLearningStore } from "../src/records/learning-store.mjs";


const require = createRequire(import.meta.url);


function post(path, body) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}


function fixture() {
  const learningStore = createMemoryLearningStore();
  const sessions = new Map([
    ["done", {
      sessionId: "done",
      participantCode: "P01",
      questionId: "kant-freedom-keystone",
      question: "康德自由题",
      stage: "complete",
      startedAt: "2026-08-30T08:00:00.000Z",
      updatedAt: "2026-08-30T08:20:00.000Z"
    }]
  ]);
  const recorder = {
    async create(session) { sessions.set(session.sessionId, structuredClone(session)); return session.sessionId; },
    async update(id, session) { sessions.set(id, structuredClone(session)); },
    async get(id) { return structuredClone(sessions.get(id) || null); },
    async listByParticipant(participantCode) {
      return [...sessions.values()].filter((item) => item.participantCode === participantCode);
    }
  };
  const app = createApp({
    config: {
      invites: new Map([
        ["code-a", { participantCode: "P01", cohort: "new" }],
        ["code-b", { participantCode: "P02", cohort: "new" }]
      ]),
      sessionSigningSecret: "observability-test",
      adminAccessToken: "teacher-secret"
    },
    coach: { async evaluate() { throw new Error("not used"); } },
    recorder,
    learningStore,
    now: () => new Date("2026-08-30T10:00:00.000Z")
  });
  return { app, learningStore };
}


test("1. a valid event is bound to the invite owner and strips raw student text", async () => {
  const { app, learningStore } = fixture();
  const response = await app.handle(post("/api/events", {
    inviteCode: "code-a",
    event: "answer_submitted",
    page: "training",
    stage: "attempt",
    action: "submit_attempt",
    participantCode: "forged",
    answer: "不应复制到行为表的原始答案",
    draftLength: 138
  }));
  assert.equal(response.status, 201);
  const [stored] = await learningStore.listUsageEvents();
  assert.equal(stored.participantCode, "P01");
  assert.equal(stored.draftLength, 138);
  assert.equal("answer" in stored, false);
  assert.equal("inviteCode" in stored, false);
});


test("2. invalid trial codes cannot write events", async () => {
  const { app, learningStore } = fixture();
  const response = await app.handle(post("/api/events", { inviteCode: "wrong", event: "page_view" }));
  assert.equal(response.status, 403);
  assert.equal((await learningStore.listUsageEvents()).length, 0);
});


test("3. unknown event names fail closed", async () => {
  const { app } = fixture();
  const response = await app.handle(post("/api/events", { inviteCode: "code-a", event: "record_every_keystroke" }));
  assert.equal(response.status, 400);
});


test("4. the pilot dashboard requires teacher credentials", async () => {
  const { app } = fixture();
  const response = await app.handle(new Request("http://local.test/pilot"));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate"), /Basic/);
});


test("5. the dashboard summarizes activation, completion and feedback", async () => {
  const { app } = fixture();
  await app.handle(post("/api/events", { inviteCode: "code-a", event: "page_view", page: "today" }));
  await app.handle(post("/api/events", { inviteCode: "code-a", event: "answer_submitted", stage: "attempt" }));
  await app.handle(post("/api/events", { inviteCode: "code-a", event: "feedback_submitted", value: "helpful" }));
  const authorization = `Basic ${Buffer.from("admin:teacher-secret").toString("base64")}`;
  const response = await app.handle(new Request("http://local.test/pilot", { headers: { authorization } }));
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /试用观察台/);
  assert.match(html, /P01/);
  assert.match(html, /已完成/);
  assert.match(html, /有帮助/);
});


test("6. dashboard output escapes learner-controlled feedback", async () => {
  const { app } = fixture();
  await app.handle(post("/api/events", { inviteCode: "code-a", event: "feedback_submitted", value: "<script>alert(1)</script>" }));
  const authorization = `Basic ${Buffer.from("admin:teacher-secret").toString("base64")}`;
  const html = await (await app.handle(new Request("http://local.test/pilot", { headers: { authorization } }))).text();
  assert.doesNotMatch(html, /<script>alert/);
});


test("7. mini program telemetry ignores failures and never sends raw drafts", async () => {
  const { track } = require("../miniprogram/utils/telemetry.js");
  const calls = [];
  const app = { globalData: {
    config: { inviteCode: "code-a" },
    api: { async post(path, body) { calls.push([path, body]); throw new Error("offline"); } }
  } };
  assert.equal(await track(app, "answer_submitted", { stage: "attempt", draftLength: 88 }), false);
  assert.equal(calls[0][0], "/api/events");
  assert.equal(calls[0][1].draftLength, 88);
  assert.equal("draft" in calls[0][1], false);
});


test("8. the three tab pages emit page views", async () => {
  for (const file of ["today/today.js", "history/history.js", "profile/profile.js"]) {
    assert.match(await readFile(new URL(`../miniprogram/pages/${file}`, import.meta.url), "utf8"), /page_view/);
  }
});


test("9. training emits stage, help, failure, completion and continuation events", async () => {
  const source = await readFile(new URL("../miniprogram/pages/training/training.js", import.meta.url), "utf8");
  for (const name of ["stage_changed", "help_used", "ai_response_failed", "training_completed", "next_question_started"]) {
    assert.match(source, new RegExp(name));
  }
});


test("10. learner feedback stays optional and compact", async () => {
  const source = await readFile(new URL("../miniprogram/pages/training/training.wxml", import.meta.url), "utf8");
  for (const value of ["helpful", "not_relevant", "fact_concern", "more_writeable", "no_change"]) {
    assert.match(source, new RegExp(value));
  }
  assert.doesNotMatch(source, /必填反馈|提交问卷后继续/);
});
