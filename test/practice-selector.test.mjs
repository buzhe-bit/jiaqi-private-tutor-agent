import assert from "node:assert/strict";
import test from "node:test";

import { selectNextPractice } from "../src/learning/practice-selector.mjs";


const NOW = new Date("2026-08-11T10:00:00.000Z");


function question(questionId, questionKind, extra = {}) {
  return {
    questionId,
    stem: `${questionId} 题目`,
    subject: "philosophy",
    topic: questionId,
    thinker: "康德",
    concepts: [questionId],
    knowledgeRelations: [`${questionId}-relation`],
    questionKind,
    ...extra
  };
}


test("the third recommendation is a due review when the first two were not", () => {
  const result = selectNextPractice({
    questions: [
      question("new-1", "new"),
      question("relation-1", "relation"),
      question("review-1", "review", { reviewContext: { masteryId: "m1" } })
    ],
    masteryRecords: [{ masteryId: "m1", reviewAt: "2026-08-10T00:00:00.000Z", masteryStatus: "unstable" }],
    recentSessions: [],
    todaySessions: [
      { questionId: "new-old", questionKind: "new", stage: "complete" },
      { questionId: "relation-old", questionKind: "relation", stage: "complete" }
    ],
    now: NOW,
    random: () => 0.99
  });

  assert.equal(result.question.questionId, "review-1");
  assert.equal(result.questionKind, "review");
  assert.match(result.reason, /复习|旧卡点/);
});


test("the same question kind cannot appear three times in a row", () => {
  const result = selectNextPractice({
    questions: [
      question("new-1", "new"),
      question("new-2", "new"),
      question("relation-1", "relation")
    ],
    masteryRecords: [],
    recentSessions: [],
    todaySessions: [
      { questionId: "old-new-1", questionKind: "new", stage: "complete" },
      { questionId: "old-new-2", questionKind: "new", stage: "complete" }
    ],
    now: NOW,
    random: () => 0
  });

  assert.equal(result.questionKind, "relation");
});


test("a recently completed exact question is excluded unless it is a due review", () => {
  const result = selectNextPractice({
    questions: [question("recent", "new"), question("fresh", "relation")],
    masteryRecords: [],
    recentSessions: [{ questionId: "recent", stage: "complete", updatedAt: "2026-08-11T09:00:00.000Z" }],
    todaySessions: [],
    now: NOW,
    random: () => 0
  });

  assert.equal(result.question.questionId, "fresh");
});


test("an unstable due review outranks a stable mastered relation", () => {
  const result = selectNextPractice({
    questions: [
      question("stable-relation", "relation", { knowledgeRelations: ["stable-link"] }),
      question("review-weak", "review", { reviewContext: { masteryId: "weak" } })
    ],
    masteryRecords: [
      { masteryId: "stable", knowledgeRelation: "stable-link", masteryStatus: "stable", reviewAt: "2026-08-20T00:00:00.000Z" },
      { masteryId: "weak", knowledgeRelation: "weak-link", masteryStatus: "unstable", reviewAt: "2026-08-10T00:00:00.000Z" }
    ],
    recentSessions: [],
    todaySessions: [],
    now: NOW,
    random: () => 0.4
  });

  assert.equal(result.question.questionId, "review-weak");
});


test("three questions are a baseline rather than a daily cap", () => {
  const result = selectNextPractice({
    questions: [question("next", "new")],
    masteryRecords: [],
    recentSessions: [],
    todaySessions: Array.from({ length: 4 }, (_, index) => ({
      questionId: `done-${index}`,
      questionKind: index % 2 ? "relation" : "new",
      stage: "complete"
    })),
    now: NOW,
    random: () => 0
  });

  assert.equal(result.todayCompleted, 4);
  assert.equal(result.baseTargetReached, true);
  assert.equal(result.question.questionId, "next");
});
