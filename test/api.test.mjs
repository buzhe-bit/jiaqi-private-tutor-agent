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
      stage: "attempt"
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


function diagnosisFor(action) {
  const complete = action === "submit_revision";
  return {
    subject: "philosophy",
    topic: "康德的自由问题",
    thinker: "康德",
    concepts: ["理论理性", "实践理性", "自由"],
    knowledgeRelations: ["理论理性为自由留下可能，实践理性赋予自由实践意义"],
    issueType: complete ? "basically_mastered" : (action === "submit_attempt" ? "relation_broken" : "expression_scattered"),
    misconception: "",
    expressionIssue: complete ? "" : "关键关系尚未写回完整答案",
    evidence: complete ? "改写同时写出理论上的可能与实践上的必要。" : "学生已经区分两种理性。",
    diagnosis: complete ? "本轮已经建立关键关系。" : "当前只需补齐或写清关键连接。",
    masteryStatus: complete ? "developing" : "unstable",
    sourceStatus: "ai_synthesized",
    sourceLabel: "AI 综合当前题目知识边界作出的解释",
    confidence: "medium"
  };
}


function modelFeedback(action) {
  if (action === "submit_attempt") {
    return {
      gate: "TEACH",
      learnerNeed: "knowledge_gap",
      message: "你现在缺的不是措辞，而是自由怎样连接两种理性的关键关系。",
      studentEvidence: "你已经知道理论理性与实践理性不是同一层次。",
      missingPoint: "还需要说明自由怎样连接两个层次。",
      focus: "理论理性留下可能，实践理性赋予实践意义。",
      teaching: "",
      nextActions: ["hint", "explain", "example", "reference", "restate"],
      sourceStatus: "待核实",
      diagnosis: diagnosisFor(action)
    };
  }
  if (action === "submit_restate") {
    return {
      gate: "REVISE",
      learnerNeed: "expression_gap",
      message: "你已经把两个层次接起来了。",
      studentEvidence: "你已经说清理论理性留下可能、实践理性赋予意义。",
      missingPoint: "现在只需要把这个关系放回完整答案。",
      focus: "把这个关系放回自己的原答案。",
      teaching: "",
      nextActions: ["revise"],
      sourceStatus: "有材料支持",
      diagnosis: diagnosisFor(action)
    };
  }
  if (action === "submit_revision") {
    return {
      gate: "CLOSE_LOOP",
      learnerNeed: "ready",
      message: "你已经从猜测概念，进步到说清两个层次的连接。",
      studentEvidence: "你的改写已经同时写出理论上的可能与实践上的必要。",
      missingPoint: "本轮关键关系已经补上。",
      focus: "理论理性留下可能，实践理性赋予实践意义。",
      teaching: "",
      nextActions: ["revise"],
      sourceStatus: "有材料支持",
      diagnosis: diagnosisFor(action)
    };
  }
  return {
    gate: "TEACH",
    learnerNeed: "knowledge_gap",
    message: "我先换一种方式讲。",
    studentEvidence: "你已经完成第一次真实尝试。",
    missingPoint: "现在只补自由连接两种理性的关系。",
    focus: "理论理性留下可能，实践理性赋予实践意义。",
    teaching: "理论理性不能证明自由，却也不能否定自由；实践理性通过道德法则使自由成为必须预设的条件。",
    nextActions: ["hint", "explain", "example", "reference", "restate"],
    sourceStatus: "有材料支持",
    diagnosis: diagnosisFor(action)
  };
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
      return modelFeedback(args.action);
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
  assert.deepEqual(await response.json(), {
    ok: true,
    product: "philosophy-answer-coach",
    coachMode: "demo",
    storageMode: "memory"
  });
});


test("learner sync returns completed history and a resumable active session", async () => {
  const recorder = {
    async create() { return "session-new"; },
    async update() {},
    async listByParticipant(participantCode) {
      assert.equal(participantCode, "P01");
      return [
        {
          sessionId: "session-complete",
          questionId: "kant-freedom-keystone",
          question: "康德自由题",
          questionKind: "relation",
          participantCode: "P01",
          cohort: "consulted",
          stage: "complete",
          startedAt: "2026-08-07T01:00:00.000Z",
          updatedAt: "2026-08-07T02:00:00.000Z",
          snapshot: { initialAnswer: "初答", rewrittenAnswer: "终答", primaryIssue: "连接关系" },
          expressionNote: { question: "康德自由题", finalExpression: "终答" },
          messages: []
        },
        {
          sessionId: "session-active",
          questionId: "kant-phenomena-noumena",
          question: "现象与物自体题",
          questionKind: "new",
          participantCode: "P01",
          cohort: "consulted",
          stage: "teaching",
          startedAt: "2026-08-08T01:00:00.000Z",
          updatedAt: "2026-08-08T01:10:00.000Z",
          snapshot: { initialAnswer: "我不清楚" },
          feedback: { ...modelFeedback("submit_attempt"), sourceStatus: "内部字段" },
          messages: [{ role: "student", message: "我不清楚" }]
        }
      ];
    }
  };
  const app = createApp({
    config: {
      invites: new Map([["demo", { participantCode: "P01", cohort: "consulted" }]]),
      sessionSigningSecret: TEST_SIGNING_SECRET
    },
    coach: { async evaluate() { return modelFeedback("submit_attempt"); } },
    recorder
  });

  const response = await app.handle(jsonRequest("/api/learner/sync", { inviteCode: "demo" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.sessions.length, 2);
  assert.equal(body.sessions[0].stage, "complete");
  assert.equal(body.sessions[0].questionKind, "relation");
  assert.equal(body.sessions[1].questionKind, "new");
  assert.equal(typeof body.sessions[1].sessionToken, "string");
  assert.equal("sourceStatus" in body.sessions[1].feedback, false);
});


test("session starts directly with a full-answer retrieval", async () => {
  const { app, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/start", {
    inviteCode: "demo",
    consent: true
  }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.stage, "attempt");
  assert.equal(body.participantCode, "P01");
  assert.equal(typeof body.sessionToken, "string");
  assert.equal(events[0].session.stage, "attempt");
});


test("session start preserves optional source material", async () => {
  const { app, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/start", {
    inviteCode: "demo",
    consent: true,
    sourceExcerpt: "资料：康德课程讲义\n片段：自由为道德法则提供根据。"
  }));
  const body = await response.json();

  assert.match(body.snapshot.sourceExcerpt, /康德课程讲义/);
  assert.equal(events[0].session.snapshot.sourceExcerpt, body.snapshot.sourceExcerpt);
});


test("retryable service errors say the failure is not the student's fault", async () => {
  const app = createApp({
    config: {
      invites: new Map([["demo", { participantCode: "P01", cohort: "consulted" }]]),
      sessionSigningSecret: TEST_SIGNING_SECRET
    },
    coach: {
      async evaluate() {
        throw Object.assign(new Error("provider detail"), {
          status: 503,
          code: "COACH_TIMEOUT",
          retryable: true,
          userMessage: "AI 服务等待超时，不是你答错了。你的回答已保留，可以原地重试。"
        });
      }
    },
    recorder: { async create() { return "record-1"; }, async update() {} }
  });

  const response = await app.handle(jsonRequest("/api/session/step", signedSession({
    stage: "attempt",
    action: "submit_attempt",
    snapshot: {},
    input: "不知道"
  })));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /不是你答错了/);
  assert.equal(body.retryable, true);
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


test("a step rejects client-supplied identity without a signed session", async () => {
  const { app, events, coachCalls } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/step", {
    stage: "attempt",
    action: "submit_attempt",
    snapshot: {},
    input: "不知道"
  }));

  assert.equal(response.status, 401);
  assert.equal(events.length, 0);
  assert.equal(coachCalls.length, 0);
});


test("a signed session cannot be changed to another record", async () => {
  const { app, events, coachCalls } = createFixture();
  const validToken = signedSession().sessionToken;
  const [encodedPayload, signature] = validToken.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  payload.recordId = "someone-elses-record";
  const tamperedToken = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;

  const response = await app.handle(jsonRequest("/api/session/step", {
    sessionToken: tamperedToken,
    stage: "attempt",
    action: "submit_attempt",
    snapshot: {},
    input: "不知道"
  }));

  assert.equal(response.status, 401);
  assert.equal(events.length, 0);
  assert.equal(coachCalls.length, 0);
});


test("teaching actions accept button requests without fake student text", async () => {
  const { app, events, coachCalls } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/step", signedSession({
    stage: "teaching",
    action: "request_explanation",
    snapshot: { initialAnswer: "不知道" },
    input: ""
  })));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.nextStage, "teaching");
  assert.equal(coachCalls[0].action, "request_explanation");
  assert.match(events.at(-1).session.snapshot.intervention, /理论理性不能证明自由/);
});


test("a correct restatement moves to expression revision", async () => {
  const { app } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/step", signedSession({
    stage: "restate",
    action: "submit_restate",
    snapshot: { initialAnswer: "不知道" },
    input: "理论理性为自由留下可能，实践理性通过道德法则赋予它实践意义。"
  })));
  const body = await response.json();

  assert.equal(body.nextStage, "revision");
  assert.match(body.snapshot.repairResponse, /留下可能/);
  assert.equal(body.expressionNote, null);
});


test("a completed revision returns a copyable expression note", async () => {
  const { app } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/step", signedSession({
    stage: "revision",
    action: "submit_revision",
    snapshot: {
      initialAnswer: "我只想到自然因果。",
      repairResponse: "理论理性留下可能，实践理性赋予意义。"
    },
    input: "理论理性限制知识范围，为自由留下可思的可能；实践理性通过道德法则使自由成为道德行动必须预设的条件。"
  })));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.nextStage, "complete");
  assert.equal(body.expressionNote.initialExpression, "我只想到自然因果。");
  assert.match(body.expressionNote.finalExpression, /道德行动必须预设/);
  assert.equal(body.expressionNote.answerStructure.length, 3);
  assert.match(body.expressionNote.possibleAnswer, /拱顶石/);
});


test("completion feedback is optional", async () => {
  const { app, events } = createFixture();
  const response = await app.handle(jsonRequest("/api/session/complete", signedSession({
    snapshot: { rewrittenAnswer: "重写后的答案" },
    reflection: {}
  })));

  assert.equal(response.status, 200);
  assert.equal(events.at(-1).session.stage, "complete");
});
