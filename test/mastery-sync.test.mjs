import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createMemoryLearningStore } from "../src/records/learning-store.mjs";
import { createSessionCodec } from "../src/session-token.mjs";


const SECRET = "mastery-sync-test-secret";
const NOW = new Date("2026-08-11T10:00:00.000Z");


function completeFeedback() {
  return {
    gate: "CLOSE_LOOP",
    learnerNeed: "ready",
    message: "你已经把两个层次通过自由连接起来了。",
    studentEvidence: "改写中同时写出了理论上的可能与实践上的必要。",
    missingPoint: "本轮关键关系已经补上。",
    focus: "理论理性留下可能，实践理性赋予自由实践意义。",
    teaching: "",
    knowledgeConnection: "理论理性留下可能 → 实践理性使自由成为道德条件",
    nextActions: [],
    sourceStatus: "待核实",
    diagnosis: {
      subject: "philosophy",
      topic: "康德的自由问题",
      thinker: "康德",
      concepts: ["理论理性", "实践理性", "自由"],
      knowledgeRelations: ["理论理性为自由留下可能，实践理性赋予自由实践意义"],
      issueType: "basically_mastered",
      misconception: "",
      expressionIssue: "",
      evidence: "改写中同时写出了理论上的可能与实践上的必要。",
      diagnosis: "本轮已经建立关键关系，等待延迟复习验证。",
      masteryStatus: "developing",
      sourceStatus: "ai_synthesized",
      sourceLabel: "AI 综合当前题目知识边界作出的解释",
      confidence: "high"
    }
  };
}


function token() {
  return createSessionCodec(SECRET).sign({
    sessionId: "session-1",
    recordId: "record-1",
    questionId: "kant-freedom-keystone",
    participantCode: "P01",
    cohort: "consulted",
    startedAt: "2026-08-11T09:55:00.000Z",
    stage: "revision"
  });
}


function stepRequest() {
  return new Request("http://local.test/api/session/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionToken: token(),
      stage: "revision",
      action: "submit_revision",
      snapshot: {
        initialAnswer: "我知道两种理性，但不知道怎样连接。",
        repairResponse: "理论理性留下可能，实践理性预设自由。",
        intervention: "【讲解】前者清出位置，后者赋予作用。"
      },
      input: "理论理性不能证明自由但留下可能，实践理性因道德法则必须预设自由。",
      messages: []
    })
  });
}


function recorderFixture(initial = []) {
  const records = new Map(initial.map((record) => [record.sessionId, structuredClone(record)]));
  const updates = [];
  return {
    records,
    updates,
    async create(session) {
      records.set(session.sessionId, structuredClone(session));
      return session.sessionId;
    },
    async update(recordId, session) {
      updates.push(structuredClone(session));
      records.set(session.sessionId || recordId, structuredClone(session));
    },
    async get(recordId) {
      return structuredClone(records.get(recordId) || records.get("session-1") || null);
    },
    async listByParticipant(participantCode) {
      return [...records.values()].filter((record) => record.participantCode === participantCode);
    }
  };
}


function appFixture({ learningStore = createMemoryLearningStore(), recorder = recorderFixture() } = {}) {
  return {
    learningStore,
    recorder,
    app: createApp({
      config: {
        invites: new Map([["demo", { participantCode: "P01", cohort: "consulted" }]]),
        sessionSigningSecret: SECRET
      },
      coach: { async evaluate() { return completeFeedback(); } },
      recorder,
      learningStore,
      now: () => new Date(NOW),
      logger: { warn() {} }
    })
  };
}


test("a completed session persists pending then complete mastery sync", async () => {
  const { app, recorder, learningStore } = appFixture();
  const response = await app.handle(stepRequest());
  const body = await response.json();
  const mastery = (await learningStore.listMasteryByParticipant("P01"))[0];

  assert.equal(response.status, 200);
  assert.equal(body.nextStage, "complete");
  assert.deepEqual(recorder.updates.map((record) => record.masterySyncStatus), ["", "pending", "complete"]);
  assert.equal(recorder.updates[0].messages.at(-1).action, "submit_revision");
  assert.equal(mastery.issueType, "basically_mastered");
  assert.match(mastery.recentEvents[0].initialAnswer, /不知道怎样连接/);
  assert.match(mastery.recentEvents[0].improvedExpression, /道德法则/);
  assert.equal(mastery.reviewAt, "2026-08-14T10:00:00.000Z");
});


test("mastery storage failure never blocks the completed learning note", async () => {
  const recorder = recorderFixture();
  const learningStore = {
    async getMastery() { return null; },
    async upsertMastery() { throw new Error("database unavailable"); }
  };
  const { app } = appFixture({ learningStore, recorder });
  const response = await app.handle(stepRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.nextStage, "complete");
  assert.ok(body.expressionNote);
  assert.equal(recorder.updates.at(-1).masterySyncStatus, "pending");
});


test("repeating the same completed session does not increase mastery attempts", async () => {
  const { app, learningStore } = appFixture();
  await app.handle(stepRequest());
  await app.handle(stepRequest());

  const mastery = (await learningStore.listMasteryByParticipant("P01"))[0];
  assert.equal(mastery.attemptCount, 1);
  assert.equal(mastery.sourceSessionIds.length, 1);
});


test("optional reflection keeps the internal diagnosis and mastery status", async () => {
  const { app, recorder } = appFixture();
  await app.handle(stepRequest());
  const response = await app.handle(new Request("http://local.test/api/session/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionToken: token(),
      snapshot: recorder.updates.at(-1).snapshot,
      reflection: { willingReuse: "愿意" }
    })
  }));

  assert.equal(response.status, 200);
  assert.equal(recorder.updates.at(-1).diagnosis.issueType, "basically_mastered");
  assert.equal(recorder.updates.at(-1).masterySyncStatus, "complete");
});


test("learner sync repairs a pending mastery update", async () => {
  const pending = {
    sessionId: "session-pending",
    questionId: "kant-freedom-keystone",
    question: "康德自由题",
    participantCode: "P01",
    cohort: "consulted",
    stage: "complete",
    startedAt: "2026-08-11T09:00:00.000Z",
    updatedAt: "2026-08-11T09:10:00.000Z",
    masterySyncStatus: "pending",
    diagnosis: completeFeedback().diagnosis,
    snapshot: {
      initialAnswer: "不知道",
      intervention: "讲解",
      rewrittenAnswer: "理论理性留下可能，实践理性预设自由。"
    },
    messages: []
  };
  const recorder = recorderFixture([pending]);
  const { app, learningStore } = appFixture({ recorder });
  const response = await app.handle(new Request("http://local.test/api/learner/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: "demo" })
  }));

  assert.equal(response.status, 200);
  assert.equal(recorder.updates.at(-1).masterySyncStatus, "complete");
  assert.equal((await learningStore.listMasteryByParticipant("P01")).length, 1);
});


test("learner sync returns a readable mastery summary instead of raw chat", async () => {
  const learningStore = createMemoryLearningStore();
  await learningStore.upsertMastery({
    masteryId: "P01:philosophy:weak",
    participantCode: "P01",
    topic: "康德的自由问题",
    thinker: "康德",
    knowledgeRelation: "理论理性为自由留下可能，实践理性赋予自由实践意义",
    misconception: "",
    expressionIssue: "两种理性仍然并列",
    issueType: "relation_broken",
    masteryStatus: "unstable",
    reviewAt: "2026-08-11T09:00:00.000Z",
    lastSeenAt: "2026-08-11T08:00:00.000Z",
    recentEvents: []
  });
  const { app } = appFixture({ learningStore });
  const response = await app.handle(new Request("http://local.test/api/learner/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: "demo" })
  }));
  const body = await response.json();

  assert.equal(body.profile.masteryCount, 1);
  assert.equal(body.profile.dueCount, 1);
  assert.equal(body.profile.unstableCount, 1);
  assert.equal(body.profile.recentWeaknesses[0].topic, "康德的自由问题");
  assert.match(body.profile.recentWeaknesses[0].summary, /两种理性/);
  assert.equal(JSON.stringify(body.profile).includes("initialAnswer"), false);
});


test("learner profile exposes the latest follow-up gap without exposing full chat", async () => {
  const learningStore = createMemoryLearningStore();
  await learningStore.upsertMastery({
    masteryId: "P01:philosophy:followup",
    participantCode: "P01",
    topic: "黑格尔辩证法",
    thinker: "黑格尔",
    knowledgeRelation: "概念运动与实践转向",
    issueType: "relation_broken",
    masteryStatus: "developing",
    reviewAt: "2026-08-14T10:00:00.000Z",
    lastSeenAt: "2026-08-11T10:00:00.000Z",
    followupQuestions: [{
      question: "马克思跟黑格尔的辩证法有什么区别？",
      knowledgeConnection: "概念运动 → 现实社会关系与实践",
      coachAnswer: "完整私教回答不应出现在个人档案摘要里。"
    }],
    recentEvents: []
  });
  const { app } = appFixture({ learningStore });
  const response = await app.handle(new Request("http://local.test/api/learner/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: "demo" })
  }));
  const body = await response.json();

  assert.match(body.profile.recentWeaknesses[0].summary, /马克思.*黑格尔/);
  assert.equal(JSON.stringify(body.profile).includes("完整私教回答"), false);
});
