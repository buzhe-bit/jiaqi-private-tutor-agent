import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createMockCoach } from "../src/coach/providers.mjs";
import { questionSeeds } from "../src/questions.mjs";
import { createMemoryLearningStore } from "../src/records/learning-store.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";


function request(path, body) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}


function diagnosis(overrides = {}) {
  return {
    subject: "philosophy",
    topic: "黑格尔辩证法",
    thinker: "黑格尔",
    concepts: ["辩证法", "实践", "现实社会关系"],
    knowledgeRelations: ["黑格尔的概念运动与马克思的实践转向"],
    issueType: "relation_broken",
    misconception: "",
    expressionIssue: "",
    evidence: "学生主动追问马克思与黑格尔的区别。",
    diagnosis: "需要巩固概念运动与实践转向的区别。",
    masteryStatus: "developing",
    sourceStatus: "ai_synthesized",
    sourceLabel: "AI 综合解释",
    confidence: "medium",
    ...overrides
  };
}


test("a real follow-up is stored, survives completion, and later becomes an outside-bank review", async () => {
  let currentNow = new Date("2026-08-11T10:00:00.000Z");
  const recorder = createMemoryRecorder();
  const learningStore = createMemoryLearningStore();
  const baseCoach = createMockCoach();
  const coach = {
    async evaluate(context) {
      const { action } = context;
      if (action === "ask_followup") {
        return {
          gate: "TEACH",
          learnerNeed: "reasoning_gap",
          message: "两者都重视矛盾运动，但出发点不同。",
          studentEvidence: "你主动提出了一个哲学家比较问题。",
          missingPoint: "区分概念运动与现实社会实践。",
          focus: "把这一区别接回当前黑格尔题。",
          teaching: "黑格尔从概念或精神的内在运动出发，马克思转向现实社会关系、物质条件和实践。",
          knowledgeConnection: "黑格尔的概念运动 → 马克思转向现实社会关系与实践",
          nextActions: ["restate"],
          sourceStatus: "待核实",
          diagnosis: diagnosis()
        };
      }
      return baseCoach.evaluate(context);
    }
  };
  const app = createApp({
    config: {
      coachProvider: "mock",
      recordProvider: "memory",
      invites: new Map([["demo", { participantCode: "P01", cohort: "consulted" }]]),
      sessionSigningSecret: "followup-loop-test"
    },
    coach,
    recorder,
    learningStore,
    now: () => new Date(currentNow),
    random: () => 0.999
  });
  const started = await (await app.handle(request("/api/session/start", {
    inviteCode: "demo",
    consent: true,
    questionId: "hegel-dialectic"
  }))).json();
  const findSession = () =>
    [...recorder.records.values()].find((record) => record.sessionId === started.sessionId);
  const attempt = await (await app.handle(request("/api/session/step", {
    sessionToken: started.sessionToken,
    stage: "attempt",
    action: "submit_attempt",
    input: "辩证法和矛盾有关。",
    snapshot: started.snapshot,
    messages: []
  }))).json();
  assert.equal(attempt.nextStage, "teaching");
  const restated = await (await app.handle(request("/api/session/step", {
    sessionToken: started.sessionToken,
    stage: "restate",
    action: "submit_restate",
    input: "有限规定因内在矛盾运动，经过扬弃走向具体统一。",
    snapshot: attempt.snapshot,
    messages: []
  }))).json();
  assert.equal(restated.nextStage, "revision");
  const followup = await (await app.handle(request("/api/session/step", {
    sessionToken: started.sessionToken,
    stage: "revision",
    action: "ask_followup",
    input: "马克思跟黑格尔的辩证法有什么区别？",
    snapshot: restated.snapshot,
    messages: findSession().messages
  }))).json();
  const afterFollowup = findSession();
  const completed = await (await app.handle(request("/api/session/step", {
    sessionToken: started.sessionToken,
    stage: "revision",
    action: "submit_revision",
    input: "黑格尔的辩证法说明有限规定因内在矛盾而运动，并通过扬弃走向具体统一。",
    snapshot: followup.snapshot,
    messages: afterFollowup.messages
  }))).json();
  const mastery = (await learningStore.listMasteryByParticipant("P01"))[0];

  assert.equal(completed.nextStage, "complete");
  assert.equal(followup.nextStage, "revision");
  assert.equal(afterFollowup.stage, "revision");
  assert.match(mastery.followupQuestions[0].question, /马克思.*黑格尔/);
  assert.ok(findSession().messages.some((message) => /马克思.*黑格尔/.test(message.message)));

  currentNow = new Date("2026-08-15T10:00:00.000Z");
  const next = await (await app.handle(request("/api/practice/next", { inviteCode: "demo" }))).json();
  const seedIds = new Set(questionSeeds().map((seed) => seed.questionId));

  assert.equal(next.questionKind, "review");
  assert.equal(seedIds.has(next.questionId), false);
  assert.match(next.question, /马克思.*黑格尔/);
  assert.match(next.sourceLabel, /追问卡点/);
});
