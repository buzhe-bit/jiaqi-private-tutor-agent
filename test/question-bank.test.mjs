import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewQuestion } from "../src/learning/review-question.mjs";
import { getQuestion, questionSeeds, storedQuestionToRuntime } from "../src/questions.mjs";


test("existing questions expose reusable question-bank metadata", () => {
  const seeds = questionSeeds();

  assert.equal(seeds.length, 9);
  for (const seed of seeds) {
    assert.ok(seed.questionId);
    assert.ok(seed.stem);
    assert.equal(seed.subject, "philosophy");
    assert.equal(["new", "relation"].includes(seed.questionKind), true);
    assert.equal(seed.origin, "past_exam");
    assert.equal(["material_supported", "ai_synthesized"].includes(seed.sourceStatus), true);
    assert.equal(["reviewed", "unreviewed"].includes(seed.reviewStatus), true);
    assert.ok(seed.guide.nextRecallQuestion);
  }
  assert.equal(seeds.filter((seed) => seed.sourceLabel.includes("佳琦真题语料")).length, 6);
  assert.equal(seeds.some((seed) => seed.stem.includes("法家基本思想")), true);
  assert.equal(seeds.some((seed) => seed.stem.includes("马克思主义哲学的革命性变革")), true);
  assert.equal(seeds.some((seed) => seed.stem.includes("苏格拉底的德性论")), true);
});


test("a due mastery node becomes one cached review variation", () => {
  const parent = getQuestion("kant-freedom-keystone");
  const mastery = {
    masteryId: "P01:philosophy:relation-a",
    participantCode: "P01",
    topic: "康德的自由问题",
    thinker: "康德",
    concepts: ["理论理性", "实践理性", "自由"],
    knowledgeRelation: "理论理性为自由留下可能，实践理性赋予自由实践意义",
    issueType: "relation_broken",
    reviewAt: "2026-08-11T00:00:00.000Z"
  };
  const first = buildReviewQuestion({ mastery, parentQuestion: parent, now: new Date("2026-08-11T10:00:00.000Z") });
  const second = buildReviewQuestion({ mastery, parentQuestion: parent, now: new Date("2026-08-12T10:00:00.000Z") });

  assert.equal(first.questionId, second.questionId);
  assert.equal(first.questionKind, "review");
  assert.equal(first.parentQuestionId, parent.id);
  assert.match(first.stem, /理论理性|实践理性|自由/);
  assert.equal(first.origin, "ai_variant");
  assert.equal(first.reviewStatus, "unreviewed");
  assert.equal(first.sourceStatus, "ai_synthesized");
  assert.equal(first.reviewContext.masteryId, mastery.masteryId);
});


test("a stored review question can enter the existing coaching runtime", () => {
  const runtime = storedQuestionToRuntime({
    questionId: "review-1",
    stem: "理论理性为自由做了什么？实践理性补上了什么？",
    subject: "philosophy",
    topic: "康德的自由问题",
    thinker: "康德",
    concepts: ["理论理性", "实践理性", "自由"],
    knowledgeRelations: ["两种理性通过自由连接"],
    questionKind: "review",
    sourceStatus: "ai_synthesized",
    sourceLabel: "旧卡点复习变式",
    guide: getQuestion("kant-freedom-keystone").guide,
    reviewContext: { masteryId: "P01:philosophy:a" }
  });

  assert.equal(runtime.id, "review-1");
  assert.match(runtime.text, /理论理性/);
  assert.equal(runtime.questionKind, "review");
  assert.equal(runtime.reviewContext.masteryId, "P01:philosophy:a");
});
