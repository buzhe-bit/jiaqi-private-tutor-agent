import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createMockCoach } from "../src/coach/providers.mjs";
import { createMemoryLearningStore } from "../src/records/learning-store.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";


const require = createRequire(import.meta.url);
const { createApi } = require("../miniprogram/services/api.js");
const { createDemoAdapter } = require("../miniprogram/services/demo-adapter.js");
const {
  applyStepResult,
  beginRequest,
  createTrainingState,
  failRequest,
  requestPayload
} = require("../miniprogram/core/session.js");


const TEST_SECRET = "release-readiness-secret";


function request(path, body) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}


function backendFixture({ learningStore = null, now = () => new Date("2026-08-11T10:00:00.000Z"), random = () => 0.99 } = {}) {
  const recorder = createMemoryRecorder();
  const app = createApp({
    config: {
      invites: new Map([["demo", { participantCode: "P01", cohort: "release-readiness" }]]),
      sessionSigningSecret: TEST_SECRET
    },
    coach: createMockCoach(),
    recorder,
    learningStore,
    now,
    random
  });
  return { app, recorder };
}


async function startSession(app, questionId = "kant-freedom-keystone") {
  const response = await app.handle(request("/api/session/start", {
    inviteCode: "demo",
    consent: true,
    questionId
  }));
  assert.equal(response.status, 201);
  return response.json();
}


async function step(app, session, { stage, action, input = "", snapshot = session.snapshot, messages = [] }) {
  const response = await app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    stage,
    action,
    input,
    snapshot,
    messages
  }));
  return { response, body: await response.json() };
}


test("完全不会也算一次有效提取，并进入教学而不是继续催答", async () => {
  const { app, recorder } = backendFixture();
  const session = await startSession(app);
  const { response, body } = await step(app, session, {
    stage: "attempt",
    action: "submit_attempt",
    input: "我完全不会"
  });

  assert.equal(response.status, 200);
  assert.equal(body.nextStage, "teaching");
  assert.deepEqual(body.feedback.nextActions, ["hint", "explain", "reference", "restate"]);
  assert.doesNotMatch(body.feedback.message, /请再写几句|重新回答题目/);
  assert.equal("diagnosis" in body.feedback, false);

  const saved = [...recorder.records.values()].at(-1);
  assert.equal(saved.snapshot.initialAnswer, "我完全不会");
  assert.equal(saved.diagnosis.issueType, "knowledge_missing");
});


test("概念误解会被单独指出，并把教学拉回道德法则与自由的关系", async () => {
  const { app, recorder } = backendFixture();
  const session = await startSession(app);
  const { body } = await step(app, session, {
    stage: "attempt",
    action: "submit_attempt",
    input: "理论理性就是看待事物的理性，实践理性可能就是引入上帝。"
  });

  assert.equal(body.nextStage, "teaching");
  assert.match(body.feedback.teaching, /道德法则|实践意义/);
  assert.doesNotMatch(body.feedback.message, /标准答案|满分答案/);
  assert.equal([...recorder.records.values()].at(-1).diagnosis.issueType, "concept_misunderstanding");
  assert.match([...recorder.records.values()].at(-1).diagnosis.misconception, /上帝/);
});


test("两个层次都写到了但关系断裂时，只补可能性到实践必要性的中轴", async () => {
  const { app, recorder } = backendFixture();
  const session = await startSession(app);
  const { body } = await step(app, session, {
    stage: "attempt",
    action: "submit_attempt",
    input: "在理论理性中，现象服从自然因果，物自身可以设想自由。在实践理性中，道德以自由为前提，自由表现为自律。自由因此很重要。"
  });

  assert.equal(body.nextStage, "teaching");
  assert.match(body.feedback.studentEvidence, /理论理性|实践理性/);
  assert.match(body.feedback.missingPoint, /道德法则|实践意义|连接/);
  assert.equal([...recorder.records.values()].at(-1).diagnosis.issueType, "relation_broken");
});


test("表达散乱但关键关系已成立时进入改进，而不是降级成不会", async () => {
  const { app, recorder } = backendFixture();
  const session = await startSession(app);
  const { body } = await step(app, session, {
    stage: "attempt",
    action: "submit_attempt",
    input: "理论理性只讨论现象，自然因果不能越界证明物自身没有自由。实践理性又从道德法则出发，必须预设自由。我知道是这两层，但写起来有点散。"
  });

  assert.equal(body.nextStage, "revision");
  assert.equal(body.feedback.nextActions[0], "revise");
  assert.match(body.feedback.missingPoint, /论证链|表达/);
  assert.equal([...recorder.records.values()].at(-1).diagnosis.issueType, "expression_scattered");
});


test("本地演示也必须在首次提取前拦住参考作答请求", async () => {
  const adapter = createDemoAdapter();
  const api = createApi({ config: { mode: "local-demo" }, demoAdapter: adapter });
  const session = await api.post("/api/session/start", {
    inviteCode: "demo",
    consent: true,
    questionId: "kant-freedom-keystone"
  });

  await assert.rejects(
    () => api.post("/api/session/step", {
      sessionToken: session.sessionToken,
      stage: "teaching",
      action: "request_reference",
      snapshot: {},
      messages: []
    }),
    (error) => {
      assert.equal(error.code, "REQUEST_ERROR");
      assert.equal(error.retryable, false);
      assert.equal(error.preserved, true);
      return /先完成一次自己的尝试/.test(error.message);
    }
  );
});


test("完成首次提取后可以请求一种可行作答，但仍停留在教学阶段", async () => {
  const { app } = backendFixture();
  const session = await startSession(app);
  const attempt = await step(app, session, {
    stage: "attempt",
    action: "submit_attempt",
    input: "不知道"
  });
  const reference = await step(app, session, {
    stage: "teaching",
    action: "request_reference",
    snapshot: attempt.body.snapshot
  });

  assert.equal(reference.response.status, 200);
  assert.equal(reference.body.nextStage, "teaching");
  assert.match(reference.body.feedback.message, /一种可行作答/);
  assert.match(reference.body.feedback.teaching, /理论理性|实践理性/);
});


test("连续表示没听懂时更换讲法，并保留当前教学阶段", async () => {
  const { app, recorder } = backendFixture();
  const session = await startSession(app);
  const attempt = await step(app, session, {
    stage: "attempt",
    action: "submit_attempt",
    input: "不知道"
  });
  const first = await step(app, session, {
    stage: "teaching",
    action: "request_explanation",
    snapshot: attempt.body.snapshot
  });
  const second = await step(app, session, {
    stage: "teaching",
    action: "ask_followup",
    input: "我还是没听懂，刚才那种解释对我没用。",
    snapshot: first.body.snapshot
  });

  assert.equal(second.body.nextStage, "teaching");
  assert.match(second.body.feedback.message, /换成两个问题|没有接住/);
  assert.notEqual(second.body.feedback.teaching, first.body.feedback.teaching);
  assert.match([...recorder.records.values()].at(-1).snapshot.intervention, /ask_followup/);
});


test("自由追问会留下知识卡点，并在到期后进入下一题队列", async () => {
  let currentNow = new Date("2026-08-11T10:00:00.000Z");
  const learningStore = createMemoryLearningStore();
  const { app } = backendFixture({ learningStore, now: () => new Date(currentNow) });
  const session = await startSession(app, "hegel-dialectic");
  const attempt = await step(app, session, {
    stage: "attempt",
    action: "submit_attempt",
    input: "辩证法和矛盾有关。"
  });
  const followup = await step(app, session, {
    stage: attempt.body.nextStage,
    action: "ask_followup",
    input: "马克思跟黑格尔的辩证法有什么区别？",
    snapshot: attempt.body.snapshot
  });
  const restated = await step(app, session, {
    stage: "restate",
    action: "submit_restate",
    input: "概念因内在矛盾而运动，并经过扬弃走向具体统一。",
    snapshot: followup.body.snapshot
  });
  const completed = await step(app, session, {
    stage: restated.body.nextStage,
    action: "submit_revision",
    input: "黑格尔的辩证法说明有限规定因内在矛盾而运动，并通过扬弃走向具体统一。",
    snapshot: restated.body.snapshot
  });

  assert.equal(followup.body.nextStage, "teaching");
  assert.match(followup.body.snapshot.followupQuestions[0].question, /马克思.*黑格尔/);
  assert.equal(completed.body.nextStage, "complete");

  currentNow = new Date("2026-08-15T10:00:00.000Z");
  const recommendation = await (await app.handle(request("/api/practice/next", { inviteCode: "demo" }))).json();
  assert.equal(recommendation.questionKind, "review");
  assert.match(recommendation.question, /马克思.*黑格尔/);
  assert.match(recommendation.sourceLabel, /追问卡点/);
});


test("完成一题后下一题推荐可以直接创建新的初始会话", async () => {
  const adapter = createDemoAdapter();
  const first = await adapter.request("POST", "/api/practice/next", { inviteCode: "demo" });
  const session = await adapter.request("POST", "/api/session/start", {
    inviteCode: "demo",
    consent: true,
    questionId: first.questionId
  });
  await adapter.request("POST", "/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "attempt",
    action: "submit_attempt",
    input: "不知道",
    snapshot: session.snapshot
  });
  await adapter.request("POST", "/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "restate",
    action: "submit_restate",
    input: "理论理性留下可能，实践理性赋予意义",
    snapshot: session.snapshot
  });
  await adapter.request("POST", "/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "revision",
    action: "submit_revision",
    input: "理论理性清出位置，实践理性使自由成为道德主体的条件。",
    snapshot: session.snapshot
  });

  const next = await adapter.request("POST", "/api/practice/next", { inviteCode: "demo" });
  const nextSession = await adapter.request("POST", "/api/session/start", {
    inviteCode: "demo",
    consent: true,
    questionId: next.questionId
  });
  assert.notEqual(next.questionId, first.questionId);
  assert.equal(nextSession.questionId, next.questionId);
  assert.equal(nextSession.stage, "attempt");
});


test("超时重试沿用同一草稿、阶段和快照，成功后才清空草稿", () => {
  const initial = createTrainingState({
    sessionId: "session-1",
    sessionToken: "token-1",
    stage: "revision",
    draft: "原来的主答案",
    snapshot: { initialAnswer: "初答", repairResponse: "复述" }
  });
  const requestState = beginRequest(initial, {
    action: "submit_revision",
    input: "改写草稿：理论理性留下可能，实践理性赋予意义。"
  });
  const failed = failRequest(requestState, {
    code: "COACH_TIMEOUT",
    message: "AI 服务等待超时",
    retryable: true
  });
  const retryPayload = requestPayload(failed, failed.request);

  assert.equal(failed.stage, "revision");
  assert.equal(failed.draft, "改写草稿：理论理性留下可能，实践理性赋予意义。");
  assert.equal(failed.error.retryable, true);
  assert.equal(retryPayload.input, failed.draft);
  assert.equal(retryPayload.stage, "revision");
  assert.deepEqual(retryPayload.snapshot, failed.snapshot);

  const completed = applyStepResult(failed, {
    nextStage: "complete",
    feedback: { message: "已经保存" },
    snapshot: { ...failed.snapshot, rewrittenAnswer: failed.draft },
    expressionNote: { finalExpression: failed.draft }
  }, failed.request);
  assert.equal(completed.stage, "complete");
  assert.equal(completed.draft, "");
  assert.equal(completed.expressionNote.finalExpression, failed.draft);
});
