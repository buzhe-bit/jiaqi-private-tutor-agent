import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createMockCoach } from "../src/coach/providers.mjs";
import { parseInviteCodes } from "../src/config.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";


const config = {
  invites: parseInviteCodes(""),
  sessionSigningSecret: "continuous-learning-test-secret"
};


function appWithCoach() {
  const recorder = createMemoryRecorder();
  const coachCalls = [];
  const coach = {
    async evaluate(input) {
      coachCalls.push(input);
      return {
        gate: "TEACH",
        learnerNeed: "knowledge_gap",
        message: "先补一个关系。",
        studentEvidence: "你已经完成尝试。",
        missingPoint: "还缺关键连接。",
        focus: "先抓住题目中的问题链。",
        teaching: "这里是讲解。",
        nextActions: ["hint", "explain", "reference", "restate"],
        sourceStatus: "待核实"
      };
    }
  };
  return { app: createApp({ config, coach, recorder }), recorder, coachCalls };
}


test("question catalogue exposes three real-question seeds without old AI answers", async () => {
  const { app } = appWithCoach();
  const response = await app.handle(new Request("http://local.test/api/questions"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.questions.length, 3);
  assert.deepEqual(
    body.questions.map((question) => question.id),
    ["kant-freedom-keystone", "kant-phenomena-noumena", "hegel-dialectic"]
  );
  assert.equal(body.questions.some((question) => "possibleAnswer" in question), false);
});


test("a new session is bound to the selected question", async () => {
  const { app, recorder } = appWithCoach();
  const response = await app.handle(new Request("http://local.test/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inviteCode: "demo",
      consent: true,
      questionId: "hegel-dialectic"
    })
  }));
  const body = await response.json();
  const record = [...recorder.records.values()][0];

  assert.equal(response.status, 201);
  assert.equal(body.questionId, "hegel-dialectic");
  assert.match(body.question, /黑格尔.*辩证法/);
  assert.equal(typeof body.sessionId, "string");
  assert.equal(record.questionId, "hegel-dialectic");
  assert.equal(record.question, body.question);
});


test("unknown questions fail closed instead of silently using the Kant fixture", async () => {
  const { app } = appWithCoach();
  const response = await app.handle(new Request("http://local.test/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: "demo", consent: true, questionId: "missing-question" })
  }));

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /题目/);
});


test("the selected question follows the session into coaching", async () => {
  const { app, coachCalls } = appWithCoach();
  const startResponse = await app.handle(new Request("http://local.test/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: "demo", consent: true, questionId: "kant-phenomena-noumena" })
  }));
  const started = await startResponse.json();

  await app.handle(new Request("http://local.test/api/session/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionToken: started.sessionToken,
      stage: "attempt",
      action: "submit_attempt",
      input: "我不知道",
      snapshot: started.snapshot
    })
  }));

  assert.equal(coachCalls[0].question.id, "kant-phenomena-noumena");
  assert.match(coachCalls[0].question.text, /现象与物自体/);
});


test("a non-pilot question teaches and closes with its own expression note", async () => {
  const recorder = createMemoryRecorder();
  const app = createApp({ config, coach: createMockCoach(), recorder });
  const started = await (await app.handle(new Request("http://local.test/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: "demo", consent: true, questionId: "hegel-dialectic" })
  }))).json();

  const attempt = await (await app.handle(new Request("http://local.test/api/session/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionToken: started.sessionToken,
      stage: "attempt",
      action: "submit_attempt",
      input: "我不知道",
      snapshot: started.snapshot
    })
  }))).json();
  assert.equal(attempt.nextStage, "teaching");
  assert.match(attempt.feedback.focus, /矛盾|扬弃/);

  const restated = await (await app.handle(new Request("http://local.test/api/session/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionToken: started.sessionToken,
      stage: "restate",
      action: "submit_restate",
      input: "概念因为内在矛盾发生否定，再经过扬弃形成更具体的统一。",
      snapshot: attempt.snapshot
    })
  }))).json();
  assert.equal(restated.nextStage, "revision");

  const completed = await (await app.handle(new Request("http://local.test/api/session/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionToken: started.sessionToken,
      stage: "revision",
      action: "submit_revision",
      input: "黑格尔的辩证法说明有限规定因内在矛盾而否定自身，又经扬弃保存合理内容，走向更具体的统一。",
      snapshot: restated.snapshot
    })
  }))).json();
  assert.equal(completed.nextStage, "complete");
  assert.match(completed.expressionNote.question, /黑格尔/);
  assert.match(completed.expressionNote.possibleAnswer, /扬弃/);
});


test("client exposes today, history and profile plus the two completion exits", async () => {
  const [script, html] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8")
  ]);

  assert.match(html, /data-app-view="today"/);
  assert.match(html, /data-app-view="history"/);
  assert.match(html, /data-app-view="profile"/);
  assert.match(script, /继续下一题/);
  assert.match(script, /返回修改本题/);
  assert.match(script, /今日第.*\/.*题/);
  assert.match(script, /philosophy-coach-history/);
  assert.match(script, /\/api\/learner\/sync/);
  assert.match(script, /function syncLearnerData\(/);
  assert.match(script, /cloudResume/);
});


test("history is grouped by day and completed sessions are replaceable by session id", async () => {
  const { archiveSession, groupHistoryByDate } = await import("../public/history-store.js");
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); }
  };

  archiveSession(storage, "history", {
    sessionId: "same-session",
    completedAt: "2026-08-07T01:00:00.000Z",
    completedDate: "2026-08-07",
    finalExpression: "第一版"
  });
  const history = archiveSession(storage, "history", {
    sessionId: "same-session",
    completedAt: "2026-08-07T02:00:00.000Z",
    completedDate: "2026-08-07",
    finalExpression: "修改版"
  });

  assert.equal(history.length, 1);
  assert.equal(history[0].finalExpression, "修改版");
  assert.deepEqual(Object.keys(groupHistoryByDate(history)), ["2026-08-07"]);
});
