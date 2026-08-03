import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createSessionCodec } from "../src/session-token.mjs";


const TEST_SIGNING_SECRET = "test-session-signing-secret";


function signedSession(extra = {}) {
  return {
    sessionToken: createSessionCodec(TEST_SIGNING_SECRET).sign({
      sessionId: "session-1",
      recordId: "record-1",
      participantCode: "P01",
      cohort: "consulted",
      startedAt: "2026-08-03T00:00:00.000Z",
      stage: "interpretation"
    }),
    ...extra
  };
}


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
    invites: new Map([["demo", { participantCode: "P01", cohort: "consulted" }]]),
    sessionSigningSecret: TEST_SIGNING_SECRET
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
  assert.equal(typeof body.sessionToken, "string");
  assert.equal(body.sessionToken.split(".").length, 2);
  assert.equal(body.recordId, undefined);
  assert.equal(events[0].session.cohort, "consulted");
  assert.equal(events[0].session.inviteCode, undefined);
});

test("session start preserves optional source material added before coaching", async () => {
  const { app, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/start", {
    inviteCode: "demo",
    consent: true,
    sourceExcerpt: "资料：康德课程讲义\n片段：自由为道德法则提供根据。"
  }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.match(body.snapshot.sourceExcerpt, /康德课程讲义/);
  assert.equal(events[0].session.snapshot.sourceExcerpt, body.snapshot.sourceExcerpt);
});

test("retryable service errors return an actionable client contract", async () => {
  const recorder = {
    async create() { return "record-1"; },
    async update() {}
  };
  const coach = {
    async evaluate() {
      throw Object.assign(new Error("internal provider detail"), {
        status: 503,
        code: "COACH_INVALID_RESPONSE",
        retryable: true,
        userMessage: "这次阅卷没有完成，你写的内容已保留。请重新提交。"
      });
    }
  };
  const app = createApp({
    config: {
      invites: new Map([["demo", { participantCode: "P01", cohort: "consulted" }]]),
      sessionSigningSecret: TEST_SIGNING_SECRET
    },
    coach,
    recorder
  });

  const response = await app.handle(jsonRequest("/api/session/step", signedSession({
    stage: "attempt",
    snapshot: {},
    input: "这是学生提交的一段真实初答。"
  })));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, "COACH_INVALID_RESPONSE");
  assert.equal(body.retryable, true);
  assert.match(body.error, /内容已保留/);
  assert.doesNotMatch(body.error, /internal provider detail/);
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

test("a step rejects client-supplied record identity without a signed session", async () => {
  const { app, events, coachCalls } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/step", {
    stage: "interpretation",
    snapshot: {},
    input: "题目要求解释自由如何连接理论理性与实践理性。",
    startedAt: "2026-08-03T00:00:00.000Z"
  }));

  assert.equal(response.status, 401);
  assert.equal(events.length, 0);
  assert.equal(coachCalls.length, 0);
});

test("a step rejects a session whose signed record identity was changed", async () => {
  const { app, events, coachCalls } = createFixture();
  const validToken = signedSession().sessionToken;
  const [encodedPayload, signature] = validToken.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  payload.recordId = "someone-elses-record";
  const tamperedToken = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;

  const response = await app.handle(jsonRequest("/api/session/step", {
    sessionToken: tamperedToken,
    stage: "interpretation",
    snapshot: {},
    input: "题目要求解释自由如何连接理论理性与实践理性。"
  }));

  assert.equal(response.status, 401);
  assert.equal(events.length, 0);
  assert.equal(coachCalls.length, 0);
});

test("a valid interpretation advances to the independent attempt", async () => {
  const { app, events, coachCalls } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/step", signedSession({
    stage: "interpretation",
    snapshot: {},
    input: "题目要求解释自由怎样把理论理性与实践理性连接起来。"
  })));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.nextStage, "attempt");
  assert.equal(body.snapshot.questionInterpretation.includes("连接"), true);
  assert.equal(coachCalls[0].action, "interpretation");
  assert.equal(events.at(-1).session.stage, "attempt");
});

test("initial answer feedback keeps one issue and moves to repair", async () => {
  const { app } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/step", signedSession({
    stage: "attempt",
    snapshot: {
      questionInterpretation: "解释自由如何连接两种理性。",
      sourceExcerpt: "学生粘贴的讲义片段"
    },
    input: "在理论理性中现象服从因果，在实践理性中自由意味着自律。"
  })));
  const body = await response.json();

  assert.equal(body.nextStage, "repair");
  assert.equal(body.snapshot.initialAnswer.includes("自律"), true);
  assert.equal(body.snapshot.primaryIssue, body.feedback.primaryIssue);
  assert.equal(body.snapshot.intervention, body.feedback.nextAction);
});

test("reflection completion records product feedback without another model call", async () => {
  const { app, coachCalls, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/complete", signedSession({
    snapshot: { rewrittenAnswer: "重写后的答案" },
    reflection: {
      studentExplanation: "我补出了两种理性的连接。",
      diagnosisHit: "是",
      willingReuse: "是",
      uxConfusion: ""
    }
  })));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.stage, "complete");
  assert.equal(coachCalls.length, 0);
  assert.equal(events.at(-1).session.reflection.willingReuse, "是");
});

test("reflection completion requires the reuse choice", async () => {
  const { app, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/complete", signedSession({
    snapshot: { rewrittenAnswer: "重写后的答案" },
    reflection: {
      studentExplanation: "我补出了两种理性的连接。",
      diagnosisHit: "是",
      willingReuse: "",
      uxConfusion: ""
    }
  })));

  assert.equal(response.status, 400);
  assert.equal(events.length, 0);
});
