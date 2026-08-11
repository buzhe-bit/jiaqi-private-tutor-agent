import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig, parseInviteCodes } from "../src/config.mjs";
import { buildCoachMessages } from "../src/coach/prompt.mjs";
import { normalizeCoachResponse, studentFacingFeedback } from "../src/coach/response-contract.mjs";
import { actionAllowedFor, nextStageFor } from "../src/coach/state-machine.mjs";


test("learning gates advance only after the required student action", () => {
  assert.equal(nextStageFor("attempt", "TEACH"), "teaching");
  assert.equal(nextStageFor("attempt", "REVISE"), "revision");
  assert.equal(nextStageFor("teaching", "TEACH"), "teaching");
  assert.equal(nextStageFor("restate", "RETEACH"), "teaching");
  assert.equal(nextStageFor("restate", "REVISE"), "revision");
  assert.equal(nextStageFor("revision", "CLOSE_LOOP"), "complete");
});


test("stage and action combinations fail closed", () => {
  assert.equal(actionAllowedFor("attempt", "submit_attempt"), true);
  assert.equal(actionAllowedFor("teaching", "request_explanation"), true);
  assert.equal(actionAllowedFor("attempt", "request_reference"), false);
  assert.throws(() => nextStageFor("attempt", "CLOSE_LOOP"), /不允许/);
});


test("the API can keep internal diagnosis without exposing it to students", () => {
  const response = normalizeCoachResponse({
    gate: "TEACH",
    learnerNeed: "knowledge_gap",
    message: "你现在缺的是两种理性如何通过自由连接起来。",
    studentEvidence: "你已经说到理论理性无法认识物自身。",
    missingPoint: "还需要说明实践理性怎样使自由获得积极的实践意义。",
    focus: "理论理性留下可能，实践理性赋予实践意义。",
    teaching: "",
    nextActions: ["hint", "explain", "example", "reference", "restate"],
    sourceStatus: "有材料支持"
  }, "submit_attempt");
  const visible = studentFacingFeedback(response);

  assert.equal(response.learnerNeed, "knowledge_gap");
  assert.equal(response.sourceStatus, "有材料支持");
  assert.equal(visible.studentEvidence, "你已经说到理论理性无法认识物自身。");
  assert.match(visible.missingPoint, /实践理性/);
  assert.equal("learnerNeed" in visible, false);
  assert.equal("sourceStatus" in visible, false);
});


test("prompt embeds retrieval, teaching and anti-repeat boundaries", () => {
  const messages = buildCoachMessages({
    action: "ask_followup",
    snapshot: {
      sourceExcerpt: "讲义片段",
      initialAnswer: "不知道",
      intervention: "已经用概念定义讲过一次。"
    },
    input: "我还是没听懂"
  });
  const combined = messages.map((message) => message.content).join("\n");

  for (const phrase of [
    "首次作答前不得提供参考作答",
    "首次作答后",
    "停止催答",
    "必须换一种解释结构或例子",
    "一种可行作答",
    "studentEvidence",
    "missingPoint",
    "空行",
    "讲义片段",
    "我还是没听懂"
  ]) {
    assert.match(combined, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});


test("invite codes parse into anonymous participant metadata", () => {
  const invites = parseInviteCodes(JSON.stringify({
    "secret-a": { participantCode: "P01", cohort: "consulted" },
    "secret-b": { participantCode: "P04", cohort: "new" }
  }));

  assert.deepEqual(invites.get("secret-a"), {
    participantCode: "P01",
    cohort: "consulted"
  });
  assert.equal(invites.has("unknown"), false);
});


test("production recording requires a session signing secret", () => {
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    RECORD_PROVIDER: "feishu"
  }), /会话签名密钥/);
});
