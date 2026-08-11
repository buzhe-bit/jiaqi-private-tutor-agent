import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { questionSeeds } from "../src/questions.mjs";
import { createMemoryLearningStore } from "../src/records/learning-store.mjs";


const NOW = new Date("2026-08-11T10:00:00.000Z");


function request(path, body) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}


function recorderWith(records = []) {
  const stored = new Map(records.map((record) => [record.sessionId, structuredClone(record)]));
  return {
    stored,
    async create(session) {
      stored.set(session.sessionId, structuredClone(session));
      return session.sessionId;
    },
    async update(recordId, session) {
      stored.set(session.sessionId || recordId, structuredClone(session));
    },
    async get(recordId) {
      return structuredClone(stored.get(recordId) || null);
    },
    async listByParticipant(participantCode) {
      return [...stored.values()].filter((record) => record.participantCode === participantCode);
    }
  };
}


function appFixture({ records = [], learningStore = createMemoryLearningStore(), random = () => 0 } = {}) {
  const recorder = recorderWith(records);
  const app = createApp({
    config: {
      coachProvider: "mock",
      recordProvider: "memory",
      invites: new Map([["demo", { participantCode: "P01", cohort: "consulted" }]]),
      sessionSigningSecret: "practice-api-test-secret"
    },
    coach: { async evaluate() { throw new Error("not used"); } },
    recorder,
    learningStore,
    now: () => new Date(NOW),
    random
  });
  return { app, recorder, learningStore };
}


test("practice next seeds the bank and returns a usable recommendation", async () => {
  const { app, learningStore } = appFixture();
  const response = await app.handle(request("/api/practice/next", { inviteCode: "demo" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(body.questionId);
  assert.ok(body.question);
  assert.equal(["new", "relation", "review"].includes(body.questionKind), true);
  assert.ok(body.reason);
  assert.equal(body.todayCompleted, 0);
  assert.equal(body.baseTargetReached, false);
  assert.equal((await learningStore.listQuestions()).length >= 3, true);
});


test("the third recommendation is generated from a due learner weakness", async () => {
  const learningStore = createMemoryLearningStore();
  await learningStore.upsertMastery({
    masteryId: "P01:philosophy:weak",
    participantCode: "P01",
    subject: "philosophy",
    topic: "康德的自由问题",
    thinker: "康德",
    concepts: ["理论理性", "实践理性", "自由"],
    knowledgeRelation: "理论理性为自由留下可能，实践理性赋予自由实践意义",
    issueType: "relation_broken",
    masteryStatus: "unstable",
    reviewAt: "2026-08-10T10:00:00.000Z",
    reviewIntervalDays: 1,
    recentEvents: [{ questionId: "kant-freedom-keystone" }]
  });
  const records = [
    {
      sessionId: "done-1",
      participantCode: "P01",
      questionId: "kant-phenomena-noumena",
      questionKind: "new",
      stage: "complete",
      updatedAt: "2026-08-11T08:00:00.000Z"
    },
    {
      sessionId: "done-2",
      participantCode: "P01",
      questionId: "hegel-dialectic",
      questionKind: "relation",
      stage: "complete",
      updatedAt: "2026-08-11T09:00:00.000Z"
    }
  ];
  const { app } = appFixture({ records, learningStore, random: () => 0.99 });
  const response = await app.handle(request("/api/practice/next", { inviteCode: "demo" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.questionKind, "review");
  assert.match(body.question, /理论理性|实践理性|自由/);
  assert.equal(body.todayCompleted, 2);
  assert.match(body.reason, /复习|旧卡点/);
});


test("a generated review recommendation can start the existing session flow", async () => {
  const learningStore = createMemoryLearningStore();
  await learningStore.upsertMastery({
    masteryId: "P01:philosophy:weak",
    participantCode: "P01",
    subject: "philosophy",
    topic: "康德的自由问题",
    thinker: "康德",
    concepts: ["理论理性", "实践理性", "自由"],
    knowledgeRelation: "理论理性为自由留下可能，实践理性赋予自由实践意义",
    issueType: "relation_broken",
    masteryStatus: "unstable",
    reviewAt: "2026-08-10T10:00:00.000Z",
    recentEvents: [{ questionId: "kant-freedom-keystone" }]
  });
  const records = [
    { sessionId: "d1", participantCode: "P01", questionKind: "new", stage: "complete", updatedAt: "2026-08-11T08:00:00.000Z" },
    { sessionId: "d2", participantCode: "P01", questionKind: "relation", stage: "complete", updatedAt: "2026-08-11T09:00:00.000Z" }
  ];
  const { app, recorder } = appFixture({ records, learningStore });
  const recommendation = await (await app.handle(request("/api/practice/next", { inviteCode: "demo" }))).json();
  const response = await app.handle(request("/api/session/start", {
    inviteCode: "demo",
    consent: true,
    questionId: recommendation.questionId
  }));
  const body = await response.json();
  const created = [...recorder.stored.values()].find((record) => record.sessionId === body.sessionId);

  assert.equal(response.status, 201);
  assert.equal(body.questionKind, "review");
  assert.equal(created.questionKind, "review");
  assert.equal(created.reviewContext.masteryId, "P01:philosophy:weak");
});


test("practice next keeps recommending after the daily baseline", async () => {
  const records = Array.from({ length: 4 }, (_, index) => ({
    sessionId: `done-${index}`,
    participantCode: "P01",
    questionId: `old-${index}`,
    questionKind: index % 2 ? "relation" : "new",
    stage: "complete",
    updatedAt: `2026-08-11T0${index + 1}:00:00.000Z`
  }));
  const { app } = appFixture({ records });
  const response = await app.handle(request("/api/practice/next", { inviteCode: "demo" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.todayCompleted, 4);
  assert.equal(body.baseTargetReached, true);
  assert.ok(body.questionId);
});


test("a due follow-up gap produces and recommends a question outside the seed bank", async () => {
  const learningStore = createMemoryLearningStore();
  await learningStore.upsertMastery({
    masteryId: "P01:philosophy:followup",
    participantCode: "P01",
    subject: "philosophy",
    topic: "黑格尔辩证法",
    thinker: "黑格尔",
    concepts: ["辩证法", "实践"],
    knowledgeRelation: "黑格尔的概念运动与马克思的实践转向",
    issueType: "relation_broken",
    masteryStatus: "unstable",
    reviewAt: "2026-08-10T10:00:00.000Z",
    reviewIntervalDays: 1,
    followupQuestions: [{
      question: "马克思跟黑格尔的辩证法有什么区别？",
      knowledgeConnection: "黑格尔的概念运动 → 马克思转向现实社会关系与实践",
      coachAnswer: "黑格尔从概念运动出发，马克思转向现实社会关系和实践。"
    }],
    recentEvents: [{ questionId: "hegel-dialectic" }]
  });
  const records = [
    { sessionId: "d1", participantCode: "P01", questionId: "kant-phenomena-noumena", questionKind: "new", stage: "complete", updatedAt: "2026-08-11T08:00:00.000Z" },
    { sessionId: "d2", participantCode: "P01", questionId: "kant-freedom-keystone", questionKind: "relation", stage: "complete", updatedAt: "2026-08-11T09:00:00.000Z" }
  ];
  const seedIds = new Set(questionSeeds().map((seed) => seed.questionId));
  const { app } = appFixture({ records, learningStore, random: () => 0.99 });
  const response = await app.handle(request("/api/practice/next", { inviteCode: "demo" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.questionKind, "review");
  assert.equal(seedIds.has(body.questionId), false);
  assert.match(body.question, /马克思.*黑格尔/);
  assert.match(body.sourceLabel, /追问卡点/);
});
