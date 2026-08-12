import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createDemoAdapter } = require("../miniprogram/services/demo-adapter.js");
const {
  applyStepResult,
  beginRequest,
  createTrainingState,
  failRequest
} = require("../miniprogram/core/session.js");


async function start(adapter) {
  const next = await adapter.request("POST", "/api/practice/next", { inviteCode: "demo" });
  return adapter.request("POST", "/api/session/start", {
    inviteCode: "demo",
    consent: true,
    questionId: next.questionId
  });
}


async function step(adapter, session, stage, action, input = "") {
  const result = await adapter.request("POST", "/api/session/step", {
    sessionToken: session.sessionToken,
    stage,
    action,
    input,
    snapshot: session.snapshot || {},
    messages: session.messages || []
  });
  session.stage = result.nextStage;
  session.snapshot = result.snapshot;
  return result;
}


test("1. an explicit unknown enters teaching without another forced answer", async () => {
  const adapter = createDemoAdapter();
  const session = await start(adapter);
  const result = await step(adapter, session, "attempt", "submit_attempt", "我不知道");
  assert.equal(result.nextStage, "teaching");
  assert.match(result.feedback.message, /不催答|先补/);
});


test("2. submitting an answer advances the visible progress stage", async () => {
  const adapter = createDemoAdapter();
  const session = await start(adapter);
  const result = await step(adapter, session, "attempt", "submit_attempt", "理论理性不能证明自由");
  assert.equal(result.nextStage, "teaching");
  assert.match(result.feedback.studentEvidence, /理论理性/);
});


test("3. all three help actions stay in teaching and return useful content", async () => {
  for (const action of ["request_hint", "request_explanation", "request_reference"]) {
    const adapter = createDemoAdapter();
    const session = await start(adapter);
    await step(adapter, session, "attempt", "submit_attempt", "不知道");
    const result = await step(adapter, session, "teaching", action);
    assert.equal(result.nextStage, "teaching");
    assert.ok(result.feedback.teaching);
  }
});


test("4. a follow-up question does not change stage", async () => {
  const adapter = createDemoAdapter();
  const session = await start(adapter);
  await step(adapter, session, "attempt", "submit_attempt", "不知道");
  const result = await step(adapter, session, "teaching", "ask_followup", "马克思和黑格尔有什么区别？");
  assert.equal(result.nextStage, "teaching");
  assert.ok(result.feedback.knowledgeConnection);
});


test("5. a follow-up failure keeps the main answer draft", () => {
  const state = createTrainingState({ stage: "revision", draft: "我的主答案" });
  const loading = beginRequest(state, { action: "ask_followup", input: "我还有个问题" });
  const failed = failRequest(loading, { message: "超时", retryable: true });
  assert.equal(failed.draft, "我的主答案");
  assert.equal(failed.stage, "revision");
});


test("6. a restatement advances to revision", async () => {
  const adapter = createDemoAdapter();
  const session = await start(adapter);
  await step(adapter, session, "attempt", "submit_attempt", "不知道");
  const result = await step(adapter, session, "restate", "submit_restate", "理论理性留下可能，实践理性赋予意义");
  assert.equal(result.nextStage, "revision");
});


test("7. a revision completes with a copyable expression note", async () => {
  const adapter = createDemoAdapter();
  const session = await start(adapter);
  await step(adapter, session, "attempt", "submit_attempt", "不知道");
  await step(adapter, session, "restate", "submit_restate", "理论理性留下可能，实践理性赋予意义");
  const result = await step(adapter, session, "revision", "submit_revision", "理论理性清出位置，实践理性使自由成为道德主体的条件。");
  assert.equal(result.nextStage, "complete");
  assert.match(result.expressionNote.finalExpression, /理论理性/);
  assert.ok(result.expressionNote.possibleAnswer);
});


test("8. completion updates the local learner profile", async () => {
  const adapter = createDemoAdapter();
  const session = await start(adapter);
  await step(adapter, session, "attempt", "submit_attempt", "不知道");
  await step(adapter, session, "restate", "submit_restate", "我已经明白关系");
  await step(adapter, session, "revision", "submit_revision", "我的最终表达");
  const sync = await adapter.request("POST", "/api/learner/sync", { inviteCode: "demo" });
  assert.equal(sync.profile.completedCount, 1);
  assert.equal(sync.sessions[0].stage, "complete");
});


test("9. another recommendation remains available after completion", async () => {
  const adapter = createDemoAdapter();
  const first = await start(adapter);
  await step(adapter, first, "attempt", "submit_attempt", "不知道");
  await step(adapter, first, "restate", "submit_restate", "我已经明白关系");
  await step(adapter, first, "revision", "submit_revision", "我的最终表达");
  const next = await adapter.request("POST", "/api/practice/next", { inviteCode: "demo" });
  assert.notEqual(next.questionId, first.questionId);
  assert.equal(next.todayCompleted, 1);
});


test("10. training template keeps progress, help icons, floating tutor and retry", () => {
  const template = readFileSync("miniprogram/pages/training/training.wxml", "utf8");
  assert.match(template, /初次作答/);
  assert.match(template, /弄懂关系/);
  assert.match(template, /用自己的话说/);
  assert.match(template, /改进答案/);
  assert.match(template, /给我一个提示/);
  assert.match(template, /讲明白/);
  assert.match(template, /一种可行作答/);
  assert.match(template, /问私教/);
  assert.match(template, /原地重试/);
});
