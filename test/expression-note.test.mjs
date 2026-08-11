import assert from "node:assert/strict";
import test from "node:test";


async function noteBuilder() {
  let buildExpressionNote;
  await assert.doesNotReject(async () => {
    ({ buildExpressionNote } = await import("../src/coach/expression-note.mjs"));
  });
  return buildExpressionNote;
}


test("expression note preserves the student's two expressions and knowledge connections", async () => {
  const buildExpressionNote = await noteBuilder();
  const note = buildExpressionNote({
    question: "康德自由题",
    snapshot: {
      initialAnswer: "我一开始只想到自然因果。",
      repairResponse: "理论理性留下可能，实践理性赋予意义。",
      rewrittenAnswer: "我的最终表达：理论理性清出位置，实践理性使自由成为道德的必要条件。",
      knowledgeConnections: ["理论理性的边界 → 实践理性的积极规定"]
    },
    feedback: {
      studentEvidence: "已经说清理论理性与实践理性的分工。",
      missingPoint: "还要点明自由连接两个理性领域。",
      focus: "理论理性留下可能，实践理性赋予实践意义。"
    }
  });

  assert.deepEqual(Object.keys(note), [
    "question",
    "answerHook",
    "initialExpression",
    "studentEvidence",
    "aiSupplement",
    "answerStructure",
    "finalExpression",
    "knowledgeConnections",
    "possibleAnswer",
    "nextRecallQuestion"
  ]);
  assert.equal(note.initialExpression, "我一开始只想到自然因果。");
  assert.match(note.finalExpression, /我的最终表达/);
  assert.equal(note.answerStructure.length, 3);
  assert.match(note.answerHook, /自然因果|道德责任|要解决/);
  assert.match(note.aiSupplement, /自由.*连接/);
  assert.match(note.possibleAnswer, /一种可行作答|康德/);
  assert.deepEqual(note.knowledgeConnections, ["理论理性的边界 → 实践理性的积极规定"]);
});


test("expression note uses safe Kant fallbacks instead of undefined", async () => {
  const buildExpressionNote = await noteBuilder();
  const note = buildExpressionNote({ question: "", snapshot: {}, feedback: {} });

  assert.match(note.question, /康德/);
  assert.match(note.answerHook, /理论理性/);
  assert.equal(note.initialExpression, "本次没有形成完整初答");
  assert.equal(note.finalExpression, "本次已完成关键关系复述，但没有留下完整长答案");
  assert.equal(JSON.stringify(note).includes("undefined"), false);
});
