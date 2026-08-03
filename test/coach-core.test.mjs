import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig, parseInviteCodes } from "../src/config.mjs";
import { buildCoachMessages } from "../src/coach/prompt.mjs";
import { normalizeCoachResponse } from "../src/coach/response-contract.mjs";
import { nextStageFor } from "../src/coach/state-machine.mjs";


test("evidence gates advance only after the required student action", () => {
  assert.equal(nextStageFor("interpretation", "CLARIFY_QUESTION"), "interpretation");
  assert.equal(nextStageFor("interpretation", "SUBMIT_ATTEMPT"), "attempt");
  assert.equal(nextStageFor("attempt", "REPAIR_ONE_ISSUE"), "repair");
  assert.equal(nextStageFor("attempt", "REWRITE"), "rewrite");
  assert.equal(nextStageFor("repair", "REPAIR_ONE_ISSUE"), "repair");
  assert.equal(nextStageFor("repair", "REWRITE"), "rewrite");
  assert.equal(nextStageFor("rewrite", "CLOSE_LOOP"), "reflection");
});

test("invalid stage and gate combinations fail closed", () => {
  assert.throws(() => nextStageFor("attempt", "CLOSE_LOOP"), /不允许/);
  assert.throws(() => nextStageFor("complete", "REWRITE"), /不允许/);
});

test("coach responses keep only the student-facing review contract", () => {
  const response = normalizeCoachResponse({
    gate: "REPAIR_ONE_ISSUE",
    descriptiveState: "基本理解",
    overall: "已经提到了理论理性与实践理性，但两者仍然并列。",
    evidence: [
      { quote: "现象服从自然因果", meaning: "知道理论理性的限制。" },
      { quote: "道德以自由为前提", meaning: "知道实践理性的要求。" },
      { quote: "多余证据", meaning: "不应保留。" }
    ],
    primaryIssue: "没有说明理论上的可思怎样连接到实践上的必要。",
    sourceStatus: "有材料支持",
    nextAction: "请用两句话补出这一个连接。",
    fullAnswer: "这段内容绝不能进入客户端"
  }, "attempt");

  assert.equal(response.evidence.length, 2);
  assert.equal(response.primaryIssue, "没有说明理论上的可思怎样连接到实践上的必要。");
  assert.equal("fullAnswer" in response, false);
  assert.deepEqual(Object.keys(response), [
    "gate",
    "descriptiveState",
    "overall",
    "evidence",
    "primaryIssue",
    "sourceStatus",
    "nextAction"
  ]);
});

test("prompt embeds non-negotiable coaching boundaries", () => {
  const messages = buildCoachMessages({
    action: "attempt",
    snapshot: {
      questionInterpretation: "题目要求解释自由如何连接两种理性。",
      sourceExcerpt: "讲义片段",
      initialAnswer: "学生初答"
    },
    input: "学生初答"
  });
  const combined = messages.map((message) => message.content).join("\n");

  for (const phrase of [
    "学生独立作答前不得提供完整答案",
    "一次只选择一个首要问题",
    "资料不足时标记为 `待核实`",
    "时间不得作为放行条件",
    "讲义片段",
    "学生初答"
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
