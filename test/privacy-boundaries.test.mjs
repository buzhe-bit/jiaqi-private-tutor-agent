import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { buildFollowupReviewQuestion } from "../src/learning/review-question.mjs";
import { createMemoryLearningStore } from "../src/records/learning-store.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";
import { getQuestion, questionSeeds } from "../src/questions.mjs";


const NOW = new Date("2026-08-11T10:00:00.000Z");


function request(path, body, headers = {}) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}


function appFixture({ learningStore, recorder } = {}) {
  return createApp({
    config: {
      coachProvider: "mock",
      recordProvider: "memory",
      invites: new Map([
        ["p01-code", { participantCode: "P01", cohort: "consulted" }],
        ["p02-code", { participantCode: "P02", cohort: "new" }]
      ]),
      sessionSigningSecret: "privacy-boundary-test-secret"
    },
    coach: { async evaluate() { throw new Error("not used"); } },
    recorder: recorder || createMemoryRecorder(),
    learningStore: learningStore || createMemoryLearningStore(),
    now: () => new Date(NOW),
    random: () => 0.999
  });
}


function privateMastery() {
  return {
    masteryId: "P01:philosophy:private-followup",
    participantCode: "P01",
    subject: "philosophy",
    topic: "黑格尔辩证法",
    thinker: "黑格尔",
    concepts: ["辩证法", "实践"],
    knowledgeRelation: "黑格尔的概念运动 → 马克思转向现实社会关系与实践",
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
  };
}


test("a private review and its follow-up are visible to P01 but never to P02", async () => {
  const learningStore = createMemoryLearningStore();
  const recorder = createMemoryRecorder();
  const mastery = privateMastery();
  await learningStore.upsertMastery(mastery);
  const privateReview = buildFollowupReviewQuestion({
    mastery,
    parentQuestion: getQuestion("hegel-dialectic"),
    now: NOW
  });
  await learningStore.upsertQuestion(privateReview);
  await recorder.create({
    sessionId: "p01-done-1",
    participantCode: "P01",
    questionId: "kant-phenomena-noumena",
    questionKind: "new",
    stage: "complete",
    updatedAt: "2026-08-11T08:00:00.000Z"
  });
  await recorder.create({
    sessionId: "p01-done-2",
    participantCode: "P01",
    questionId: "hegel-dialectic",
    questionKind: "relation",
    stage: "complete",
    updatedAt: "2026-08-11T09:00:00.000Z"
  });
  const app = appFixture({ learningStore, recorder });

  const p01Next = await app.handle(request("/api/practice/next", { inviteCode: "p01-code" }));
  const p01Body = await p01Next.json();
  assert.equal(p01Next.status, 200);
  assert.equal(p01Body.questionKind, "review");

  const p01Start = await app.handle(request("/api/session/start", {
    inviteCode: "p01-code",
    consent: true,
    questionId: privateReview.questionId
  }));
  const p01StartBody = await p01Start.json();
  assert.equal(p01Start.status, 201);
  assert.equal(p01StartBody.questionId, privateReview.questionId);
  assert.match(p01StartBody.question, /马克思.*黑格尔/);

  const p02Next = await app.handle(request("/api/practice/next", { inviteCode: "p02-code" }));
  const p02Body = await p02Next.json();
  assert.equal(p02Next.status, 200);
  assert.notEqual(p02Body.questionId, privateReview.questionId);
  assert.doesNotMatch(p02Body.question, /马克思跟黑格尔/);

  const p02Start = await app.handle(request("/api/session/start", {
    inviteCode: "p02-code",
    consent: true,
    questionId: privateReview.questionId
  }));
  assert.equal(p02Start.status, 400);
});


test("an unowned review question cannot be started by any participant", async () => {
  const learningStore = createMemoryLearningStore();
  await learningStore.upsertQuestion({
    questionId: "review-without-owner",
    stem: "不应公开的复习题",
    questionKind: "review",
    reviewContext: { masteryId: "missing-mastery" },
    guide: { nextRecallQuestion: "不应公开的复习题" }
  });
  const app = appFixture({ learningStore });
  const response = await app.handle(request("/api/session/start", {
    inviteCode: "p01-code",
    consent: true,
    questionId: "review-without-owner"
  }));
  assert.equal(response.status, 400);
});


test("review context makes a question private even when kind or owner fields are missing", async () => {
  const learningStore = createMemoryLearningStore();
  const mastery = privateMastery();
  await learningStore.upsertMastery(mastery);
  for (const question of [
    {
      questionId: "review-missing-kind",
      stem: "缺少题型的私有复习题",
      participantCode: "P01",
      reviewContext: { masteryId: mastery.masteryId },
      guide: { nextRecallQuestion: "缺少题型的私有复习题" }
    },
    {
      questionId: "review-missing-owner",
      stem: "缺少归属的私有复习题",
      questionKind: "review",
      reviewContext: { masteryId: mastery.masteryId },
      guide: { nextRecallQuestion: "缺少归属的私有复习题" }
    },
    {
      questionId: "review-wrong-kind",
      stem: "题型伪装的私有复习题",
      questionKind: "new",
      participantCode: "P01",
      reviewContext: { masteryId: mastery.masteryId },
      guide: { nextRecallQuestion: "题型伪装的私有复习题" }
    },
    {
      questionId: "review-context-without-mastery",
      stem: "只有复习上下文的私有题",
      questionKind: "new",
      participantCode: "P01",
      reviewContext: { kind: "followup_gap" },
      guide: { nextRecallQuestion: "只有复习上下文的私有题" }
    },
    {
      questionId: "review-mismatched-mastery-fields",
      stem: "掌握记录不一致的私有复习题",
      questionKind: "review",
      participantCode: "P01",
      masteryId: "P02:philosophy:private-followup",
      reviewContext: { masteryId: mastery.masteryId },
      guide: { nextRecallQuestion: "掌握记录不一致的私有复习题" }
    }
  ]) {
    await learningStore.upsertQuestion(question);
    const app = appFixture({ learningStore });
    const response = await app.handle(request("/api/session/start", {
      inviteCode: "p01-code",
      consent: true,
      questionId: question.questionId
    }));
    assert.equal(response.status, 400, question.questionId);
  }
});


test("non-null review context of any type is private and malformed records stay blocked", async () => {
  const learningStore = createMemoryLearningStore();
  const mastery = privateMastery();
  await learningStore.upsertMastery(mastery);
  for (const [index, reviewContext] of ["string", ["array"], true, false].entries()) {
    const question = {
      questionId: `review-invalid-context-${index}`,
      stem: "上下文类型非法的私有题",
      questionKind: "review",
      participantCode: "P01",
      masteryId: mastery.masteryId,
      reviewContext,
      guide: { nextRecallQuestion: "上下文类型非法的私有题" }
    };
    await learningStore.upsertQuestion(question);
    const app = appFixture({ learningStore });
    const response = await app.handle(request("/api/session/start", {
      inviteCode: "p01-code",
      consent: true,
      questionId: question.questionId
    }));
    assert.equal(response.status, 400, question.questionId);
  }
});


test("a question with only participant ownership metadata stays private and fail-closed", async () => {
  const learningStore = createMemoryLearningStore();
  const malformed = {
    questionId: "review-owner-only",
    stem: "只有学员归属字段的异常题",
    participantCode: "P01",
    guide: { nextRecallQuestion: "只有学员归属字段的异常题" }
  };
  await learningStore.upsertQuestion(malformed);
  const recorder = createMemoryRecorder();
  const app = appFixture({ learningStore, recorder });

  for (const inviteCode of ["p01-code", "p02-code"]) {
    const start = await app.handle(request("/api/session/start", {
      inviteCode,
      consent: true,
      questionId: malformed.questionId
    }));
    assert.equal(start.status, 400, `${inviteCode} start`);

    const next = await app.handle(request("/api/practice/next", { inviteCode }));
    const nextBody = await next.json();
    assert.equal(next.status, 200, `${inviteCode} recommendation`);
    assert.notEqual(nextBody.questionId, malformed.questionId, `${inviteCode} recommendation`);
  }
  assert.equal(recorder.records.size, 0);
});


test("malformed private review records are excluded from recommendations", async () => {
  const learningStore = createMemoryLearningStore();
  for (const seed of questionSeeds()) await learningStore.upsertQuestion(seed);
  await learningStore.upsertQuestion({
    questionId: "review-missing-kind-recommendation",
    stem: "不应推荐给其他人的私有题",
    participantCode: "P01",
    reviewContext: { masteryId: "P01:philosophy:private-followup" },
    guide: { nextRecallQuestion: "不应推荐给其他人的私有题" }
  });
  const recorder = createMemoryRecorder();
  for (const [index, seed] of questionSeeds().entries()) {
    await recorder.create({
      sessionId: `p02-done-${index}`,
      participantCode: "P02",
      questionId: seed.questionId,
      questionKind: seed.questionKind,
      stage: "complete",
      updatedAt: `2026-08-11T0${index + 1}:00:00.000Z`
    });
  }
  const app = appFixture({ learningStore, recorder });
  const response = await app.handle(request("/api/practice/next", { inviteCode: "p02-code" }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.notEqual(body.questionId, "review-missing-kind-recommendation");
});


test("non-identity WeChat routing headers still require the invite path", async () => {
  const app = appFixture();
  const allowed = await app.handle(request("/api/session/start", {
    inviteCode: "p01-code",
    consent: true
  }, {
    "x-wx-service": "call-container-route"
  }));
  const rejected = await app.handle(request("/api/session/start", {
    consent: true
  }, {
    "x-wx-service": "call-container-route"
  }));
  assert.equal(allowed.status, 201);
  assert.equal(rejected.status, 403);
});


test("shared HTTP entry rejects identity headers on step and complete without writing", async () => {
  const recorder = createMemoryRecorder();
  const app = appFixture({ recorder });
  const started = await app.handle(request("/api/session/start", {
    inviteCode: "p01-code",
    consent: true
  }));
  const session = await started.json();
  assert.equal(started.status, 201);
  const before = recorder.records.size;

  const step = await app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "attempt",
    action: "submit_attempt",
    input: "我的真实回答"
  }, {
    "x-wx-openid": "forged-openid",
    "x-wx-appid": "wx-forged"
  }));
  const complete = await app.handle(request("/api/session/complete", {
    sessionToken: session.sessionToken
  }, {
    "x-wx-openid": "forged-openid",
    "x-wx-appid": "wx-forged"
  }));

  assert.equal(step.status, 403);
  assert.equal(complete.status, 403);
  assert.equal(recorder.records.size, before);
});


test("public HTTP rejects all identity-header combinations", async () => {
  const app = appFixture();
  for (const [name, headers, body] of [
    ["forged identity", {
      "x-wx-openid": "forged-p02-openid",
      "x-wx-appid": "wx-forged"
    }, { inviteCode: "p01-code", consent: true }],
    ["extra caller marker", {
      "x-wx-openid": "forged-openid",
      "x-wx-appid": "wx-forged",
      "x-test-gateway-marker": "container-only"
    }, { consent: true }],
    ["empty identity", {
      "x-wx-openid": "",
      "x-wx-appid": ""
    }, { inviteCode: "p01-code", consent: true }]
  ]) {
    const response = await app.handle(request("/api/session/start", body, headers));
    assert.equal(response.status, 403, name);
  }
});
