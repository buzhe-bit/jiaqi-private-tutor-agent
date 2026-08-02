import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";


function jsonRequest(path, body) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}


function createFixture() {
  const events = [];
  const coachCalls = [];
  const recorder = {
    async create(session) {
      events.push({ type: "create", session });
      return "record-1";
    },
    async update(recordId, session) {
      events.push({ type: "update", recordId, session });
    }
  };
  const coach = {
    async evaluate(args) {
      coachCalls.push(args);
      if (args.action === "interpretation") {
        return {
          gate: "SUBMIT_ATTEMPT",
          descriptiveState: "基本理解",
          overall: "已经抓住两种理性的连接问题。",
          evidence: [{ quote: "连接两种理性", meaning: "抓住了题眼。" }],
          primaryIssue: "",
          sourceStatus: "待核实",
          nextAction: "请提交当前最好版本，不完整也可以。"
        };
      }
      return {
        gate: "REPAIR_ONE_ISSUE",
        descriptiveState: "基本理解",
        overall: "概念基本准确，但仍然只是并列。",
        evidence: [{ quote: "现象服从因果", meaning: "知道理论边界。" }],
        primaryIssue: "没有说明理论上的可思如何连接实践上的必要。",
        sourceStatus: "有材料支持",
        nextAction: "请用两句话补出这一连接。"
      };
    }
  };
  const config = {
    invites: new Map([["demo", { participantCode: "P01", cohort: "consulted" }]])
  };
  return { app: createApp({ config, coach, recorder }), events, coachCalls };
}


test("health endpoint reports the student MVP contract", async () => {
  const { app } = createFixture();
  const response = await app.handle(new Request("http://local.test/api/health"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, product: "philosophy-answer-coach" });
});

test("session start validates invite and records anonymous metadata", async () => {
  const { app, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/start", {
    inviteCode: "demo",
    consent: true
  }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.stage, "interpretation");
  assert.equal(body.participantCode, "P01");
  assert.equal(body.recordId, "record-1");
  assert.equal(events[0].session.cohort, "consulted");
  assert.equal(events[0].session.inviteCode, undefined);
});

test("unknown invite codes are rejected without creating a record", async () => {
  const { app, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/start", {
    inviteCode: "unknown",
    consent: true
  }));
  assert.equal(response.status, 403);
  assert.equal(events.length, 0);
});

test("a valid interpretation advances to the independent attempt", async () => {
  const { app, events, coachCalls } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/step", {
    inviteCode: "demo",
    sessionId: "session-1",
    recordId: "record-1",
    stage: "interpretation",
    snapshot: {},
    input: "题目要求解释自由怎样把理论理性与实践理性连接起来。",
    startedAt: "2026-08-03T00:00:00.000Z"
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.nextStage, "attempt");
  assert.equal(body.snapshot.questionInterpretation.includes("连接"), true);
  assert.equal(coachCalls[0].action, "interpretation");
  assert.equal(events.at(-1).session.stage, "attempt");
});

test("initial answer feedback keeps one issue and moves to repair", async () => {
  const { app } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/step", {
    inviteCode: "demo",
    sessionId: "session-1",
    recordId: "record-1",
    stage: "attempt",
    snapshot: {
      questionInterpretation: "解释自由如何连接两种理性。",
      sourceExcerpt: "学生粘贴的讲义片段"
    },
    input: "在理论理性中现象服从因果，在实践理性中自由意味着自律。",
    startedAt: "2026-08-03T00:00:00.000Z"
  }));
  const body = await response.json();

  assert.equal(body.nextStage, "repair");
  assert.equal(body.snapshot.initialAnswer.includes("自律"), true);
  assert.equal(body.snapshot.primaryIssue, body.feedback.primaryIssue);
  assert.equal(body.snapshot.intervention, body.feedback.nextAction);
});

test("reflection completion records product feedback without another model call", async () => {
  const { app, coachCalls, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/complete", {
    inviteCode: "demo",
    sessionId: "session-1",
    recordId: "record-1",
    startedAt: "2026-08-03T00:00:00.000Z",
    snapshot: { rewrittenAnswer: "重写后的答案" },
    reflection: {
      studentExplanation: "我补出了两种理性的连接。",
      diagnosisHit: "是",
      willingReuse: "是",
      uxConfusion: ""
    }
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.stage, "complete");
  assert.equal(coachCalls.length, 0);
  assert.equal(events.at(-1).session.reflection.willingReuse, "是");
});

test("reflection completion requires the reuse choice", async () => {
  const { app, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/complete", {
    inviteCode: "demo",
    sessionId: "session-1",
    recordId: "record-1",
    startedAt: "2026-08-03T00:00:00.000Z",
    snapshot: { rewrittenAnswer: "重写后的答案" },
    reflection: {
      studentExplanation: "我补出了两种理性的连接。",
      diagnosisHit: "是",
      willingReuse: "",
      uxConfusion: ""
    }
  }));

  assert.equal(response.status, 400);
  assert.equal(events.length, 0);
});
