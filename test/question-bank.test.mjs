import assert from "node:assert/strict";
import test from "node:test";

import { buildFollowupReviewQuestion, buildReviewQuestion } from "../src/learning/review-question.mjs";
import { getQuestion, questionSeeds, storedQuestionToRuntime } from "../src/questions.mjs";


const NOW = new Date("2026-08-11T10:00:00.000Z");


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


test("a recorded follow-up becomes a cached question outside the seed bank", () => {
  const parent = getQuestion("hegel-dialectic");
  const generated = buildFollowupReviewQuestion({
    mastery: {
      masteryId: "P01:philosophy:hegel",
      topic: "黑格尔辩证法",
      thinker: "黑格尔",
      concepts: ["辩证法", "实践"],
      issueType: "relation_broken",
      followupQuestions: [{
        question: "马克思跟黑格尔的辩证法有什么区别？",
        knowledgeConnection: "黑格尔的概念运动 → 马克思转向现实社会关系与实践",
        coachAnswer: "黑格尔从概念运动出发，马克思转向现实社会关系和实践。"
      }]
    },
    parentQuestion: parent,
    now: NOW
  });

  assert.equal(questionSeeds().some((seed) => seed.questionId === generated.questionId), false);
  assert.match(generated.stem, /马克思.*黑格尔/);
  assert.equal(generated.questionKind, "review");
  assert.equal(generated.origin, "ai_variant");
  assert.equal(generated.reviewContext.kind, "followup_gap");
  assert.match(generated.guide.possibleAnswer, /现实社会关系|实践/);
});
