import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  applyStepResult,
  beginRequest,
  createTrainingState,
  failRequest
} = require("../miniprogram/core/session.js");
const {
  archiveSession,
  createStorage,
  readHistory
} = require("../miniprogram/utils/storage.js");
const { splitParagraphs, stageMeta } = require("../miniprogram/utils/format.js");


test("a failed request preserves draft and stage", () => {
  const initial = createTrainingState({ stage: "restate", draft: "我的复述" });
  const before = beginRequest(initial, { action: "submit_restate", input: "我的复述" });
  const after = failRequest(before, { message: "超时", retryable: true });

  assert.equal(after.stage, "restate");
  assert.equal(after.draft, "我的复述");
  assert.equal(after.error.retryable, true);
  assert.equal(after.request.phase, "error");
});


test("follow-up feedback stays in the current stage and keeps the main draft", () => {
  const initial = createTrainingState({ stage: "revision", draft: "主答案草稿" });
  const request = { action: "ask_followup", input: "马克思和黑格尔有什么区别？" };
  const loading = beginRequest(initial, request);
  const after = applyStepResult(loading, {
    nextStage: "revision",
    feedback: { message: "先回答区别。", knowledgeConnection: "黑格尔 → 马克思" },
    snapshot: { rewrittenAnswer: "" }
  }, request);

  assert.equal(after.stage, "revision");
  assert.equal(after.draft, "主答案草稿");
  assert.equal(after.messages.at(-2).role, "student");
  assert.equal(after.messages.at(-1).role, "coach");
});


test("successful main submission clears only its draft and archives completion", () => {
  const initial = createTrainingState({ stage: "revision", draft: "最终答案" });
  const request = { action: "submit_revision", input: "最终答案" };
  const after = applyStepResult(beginRequest(initial, request), {
    nextStage: "complete",
    feedback: { message: "已经完成" },
    snapshot: { rewrittenAnswer: "最终答案" },
    expressionNote: { question: "题目", finalExpression: "最终答案" }
  }, request);

  assert.equal(after.stage, "complete");
  assert.equal(after.draft, "");
  assert.equal(after.expressionNote.finalExpression, "最终答案");
});


test("history replaces the same session and keeps at most one hundred entries", () => {
  const memory = new Map();
  const storage = createStorage({
    getStorageSync(key) { return memory.get(key); },
    setStorageSync(key, value) { memory.set(key, value); }
  }, "demo");

  for (let index = 0; index < 102; index += 1) {
    archiveSession(storage, {
      sessionId: `session-${index}`,
      completedAt: new Date(2026, 7, 13, 0, index).toISOString()
    });
  }
  archiveSession(storage, {
    sessionId: "session-101",
    completedAt: "2026-08-13T12:00:00.000Z",
    finalExpression: "更新后的答案"
  });

  const history = readHistory(storage);
  assert.equal(history.length, 100);
  assert.equal(history[0].sessionId, "session-101");
  assert.equal(history[0].finalExpression, "更新后的答案");
});


test("format helpers expose readable stages and semantic paragraphs", () => {
  assert.deepEqual(splitParagraphs("结论。\n\n解释一。\n解释二。"), ["结论。", "解释一。 解释二。"]);
  assert.equal(stageMeta("restate").step, 3);
  assert.match(stageMeta("restate").completion, /关键关系/);
});
