import assert from "node:assert/strict";
import test from "node:test";

import { createMockCoach } from "../src/coach/providers.mjs";
import { buildCoachMessages } from "../src/coach/prompt.mjs";
import { getQuestion } from "../src/questions.mjs";


function compactLength(value) {
  return String(value || "").replace(/\s+/g, "").length;
}


test("a partial first answer is recognized with concrete evidence and one priority reason", async () => {
  const feedback = await createMockCoach().evaluate({
    action: "submit_attempt",
    snapshot: {},
    question: getQuestion("hegel-dialectic"),
    input: "我知道黑格尔会讲内在矛盾、否定和扬弃，最后走向具体统一，但我只是把这些词堆在一起。"
  });

  assert.equal(feedback.gate, "TEACH");
  assert.equal(feedback.learnerNeed, "reasoning_gap");
  assert.match(feedback.studentEvidence, /内在矛盾.*扬弃/);
  assert.match(feedback.studentEvidence, /说明|抓到|知道/);
  assert.match(feedback.missingPoint, /关系|连接|为什么/);
  assert.match(feedback.teaching, /为什么先|优先/);
  assert.equal(compactLength(feedback.teaching) >= 220, true);
  assert.equal(feedback.teaching.split(/\n\s*\n/).filter(Boolean).length >= 3, true);
  assert.match(feedback.teaching, /出发点|运动机制|方法与存在|论证/);
  assert.equal(feedback.missingPoint.split("；").length <= 2, true);
});


test("a basically correct but scattered first answer receives expression diagnosis instead of basic reteaching", async () => {
  const feedback = await createMockCoach().evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "理论理性限制知识边界，所以不能证明自由但为自由留下可能；实践理性从道德法则出发，必须预设自由。不过我现在的层次很乱，论证也绕。"
  });

  assert.equal(feedback.gate, "REVISE");
  assert.match(feedback.studentEvidence, /理论理性.*可能.*实践理性|道德法则/);
  assert.match(feedback.missingPoint, /表达|论证链|压成|层次/);
  assert.match(feedback.teaching, /为什么先|优先/);
  assert.equal(compactLength(feedback.teaching) >= 220, true);
  assert.equal(feedback.teaching.split(/\n\s*\n/).filter(Boolean).length >= 3, true);
  assert.match(feedback.teaching, /知识边界.*自由.*道德法则|理论理性.*实践理性.*拱顶石/);
  assert.doesNotMatch(feedback.teaching, /重新学习|完全不会/);
});


test("not knowing how to connect known concepts is not treated as knowing nothing", async () => {
  const feedback = await createMockCoach().evaluate({
    action: "submit_attempt",
    snapshot: {},
    question: getQuestion("socrates-virtue"),
    input: "我记得德性即知识、无知和反诘法，但不知道这些概念为什么连起来，也不知道怎么扩成完整答案。"
  });

  assert.equal(feedback.learnerNeed, "reasoning_gap");
  assert.match(feedback.studentEvidence, /德性即知识.*无知.*反诘法/);
  assert.doesNotMatch(feedback.message, /确实想不起来|完全不会/);
  assert.match(feedback.teaching, /问题转向[\s\S]*核心命题[\s\S]*实践方法/);
});


test("an explicit unknown answer is quoted without invented understanding evidence", async () => {
  const feedback = await createMockCoach().evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "不知道，我完全想不起来。"
  });

  assert.equal(feedback.gate, "TEACH");
  assert.match(feedback.studentEvidence, /不知道|想不起来/);
  assert.doesNotMatch(feedback.studentEvidence, /已经说清|已经理解|已经抓住/);
  assert.match(feedback.teaching, /为什么先|先补/);
  assert.equal(compactLength(feedback.teaching) >= 220, true);
  assert.match(feedback.teaching, /自然因果.*自由.*道德法则.*拱顶石/);
});


test("the real-model prompt requires answer-grounded diagnosis and explains priority", () => {
  const prompt = buildCoachMessages({
    action: "submit_attempt",
    snapshot: {},
    question: getQuestion("hegel-dialectic"),
    input: "我写到了内在矛盾和扬弃，但不知道两者为什么连起来。"
  }).map((message) => message.content).join("\n");

  assert.match(prompt, /引用或准确复述/);
  assert.match(prompt, /为什么先处理|为什么优先/);
  assert.match(prompt, /不得编造.*理解证据/);
  assert.match(prompt, /300.{0,4}600/);
  assert.match(prompt, /约?500字|五百字/);
  assert.match(prompt, /三到四|3.{0,3}4/);
  assert.match(prompt, /不得.*完整参考作答|不能.*完整参考作答/);
});
