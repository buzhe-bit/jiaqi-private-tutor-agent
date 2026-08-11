import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMasteryEvent,
  buildMasteryEvent,
  masteryIdFor,
  nextReviewAt
} from "../src/learning/mastery.mjs";


const NOW = new Date("2026-08-11T10:00:00.000Z");


function diagnosis(overrides = {}) {
  return {
    subject: "philosophy",
    topic: "康德的自由问题",
    thinker: "康德",
    concepts: ["理论理性", "实践理性", "自由"],
    knowledgeRelations: ["理论理性为自由留下可能，实践理性赋予自由实践意义"],
    issueType: "relation_broken",
    misconception: "",
    expressionIssue: "两种理性仍然并列",
    evidence: "学生分别提到了两种理性，但没有说明自由怎样连接两者。",
    diagnosis: "当前缺少可能性与实践必要性之间的连接",
    masteryStatus: "unstable",
    sourceStatus: "ai_synthesized",
    sourceLabel: "AI 综合当前题目知识边界作出的解释",
    confidence: "medium",
    ...overrides
  };
}


test("mastery id is stable for one learner and one knowledge relation", () => {
  const input = {
    participantCode: "P01",
    subject: "philosophy",
    topic: "康德的自由问题",
    knowledgeRelation: "理论理性与实践理性通过自由连接"
  };

  assert.equal(masteryIdFor(input), masteryIdFor(input));
  assert.notEqual(masteryIdFor(input), masteryIdFor({ ...input, participantCode: "P02" }));
  assert.match(masteryIdFor(input), /^P01:philosophy:/);
});


test("one question keeps one mastery node when model wording drifts", () => {
  const input = {
    participantCode: "P01",
    subject: "philosophy",
    questionId: "kant-freedom-keystone",
    topic: "康德的自由问题",
    knowledgeRelation: "理论理性为自由留下可能，实践理性赋予实践意义"
  };

  assert.equal(
    masteryIdFor(input),
    masteryIdFor({ ...input, knowledgeRelation: "自由把理论理性与实践理性连接起来" })
  );
  assert.notEqual(masteryIdFor(input), masteryIdFor({ ...input, questionId: "another-question" }));
});


test("review schedule follows 1, 3, 7 and 14 day rules", () => {
  assert.equal(nextReviewAt({ now: NOW, masteryStatus: "unstable" }), "2026-08-12T10:00:00.000Z");
  assert.equal(nextReviewAt({ now: NOW, masteryStatus: "developing" }), "2026-08-14T10:00:00.000Z");
  assert.equal(nextReviewAt({ now: NOW, masteryStatus: "stable", previousReviewDays: 3 }), "2026-08-18T10:00:00.000Z");
  assert.equal(nextReviewAt({ now: NOW, masteryStatus: "stable", previousReviewDays: 7 }), "2026-08-25T10:00:00.000Z");
  assert.equal(nextReviewAt({ now: NOW, masteryStatus: "stable", delayedRecallResult: "failed" }), "2026-08-12T10:00:00.000Z");
});


test("mastery events keep the useful learning chain instead of the full chat", () => {
  const event = buildMasteryEvent({
    session: {
      sessionId: "s1",
      questionId: "kant-freedom-keystone",
      participantCode: "P01",
      snapshot: {
        initialAnswer: "我知道两种理性，但不知道怎样连接。",
        intervention: "【讲解】先说明理论上留下可能，再说明实践上必须预设。",
        rewrittenAnswer: "理论理性留下自由的可能，实践理性让自由成为道德行动的必要条件。"
      }
    },
    diagnosis: diagnosis({ masteryStatus: "developing", issueType: "basically_mastered" }),
    now: NOW
  });

  assert.equal(event.sessionId, "s1");
  assert.equal(event.issueType, "basically_mastered");
  assert.match(event.initialAnswer, /不知道怎样连接/);
  assert.match(event.improvedExpression, /道德行动/);
  assert.equal("messages" in event, false);
});


test("student follow-up questions survive completion as review evidence", () => {
  const event = buildMasteryEvent({
    session: {
      sessionId: "s-followup",
      questionId: "hegel-dialectic",
      participantCode: "P01",
      snapshot: {
        initialAnswer: "我知道辩证法和矛盾有关。",
        rewrittenAnswer: "黑格尔从概念自身矛盾说明运动。",
        followupQuestions: [{
          question: "马克思跟黑格尔的辩证法有什么区别？",
          knowledgeConnection: "黑格尔的概念运动 → 马克思转向现实社会关系与实践",
          coachAnswer: "黑格尔从概念运动出发，马克思转向现实社会关系和实践。"
        }]
      }
    },
    diagnosis: diagnosis({ topic: "黑格尔辩证法", thinker: "黑格尔" }),
    now: NOW
  });
  const mastery = applyMasteryEvent(null, event, { now: NOW });

  assert.equal(event.followupQuestions.length, 1);
  assert.match(mastery.followupQuestions[0].question, /马克思.*黑格尔/);
  assert.equal("messages" in mastery.followupQuestions[0], false);
});


test("applying the same session twice is idempotent and keeps ten recent events", () => {
  let mastery = null;
  for (let index = 1; index <= 11; index += 1) {
    mastery = applyMasteryEvent(mastery, {
      ...buildMasteryEvent({
        session: {
          sessionId: `s${index}`,
          questionId: "kant-freedom-keystone",
          participantCode: "P01",
          snapshot: { initialAnswer: `初答 ${index}`, rewrittenAnswer: `改写 ${index}` }
        },
        diagnosis: diagnosis({ masteryStatus: "developing" }),
        now: new Date(NOW.getTime() + index * 1000)
      })
    }, { now: new Date(NOW.getTime() + index * 1000) });
  }

  const duplicate = applyMasteryEvent(mastery, mastery.recentEvents.at(-1), { now: NOW });
  assert.equal(mastery.attemptCount, 11);
  assert.equal(mastery.recentEvents.length, 10);
  assert.equal(duplicate.attemptCount, 11);
  assert.deepEqual(duplicate.sourceSessionIds, mastery.sourceSessionIds);
});


test("low-confidence evidence never upgrades a mastery node to stable", () => {
  const event = buildMasteryEvent({
    session: {
      sessionId: "s-low",
      questionId: "kant-freedom-keystone",
      participantCode: "P01",
      snapshot: { initialAnswer: "大概会。", rewrittenAnswer: "我还是不确定。" }
    },
    diagnosis: diagnosis({
      issueType: "basically_mastered",
      masteryStatus: "stable",
      confidence: "low"
    }),
    now: NOW
  });
  const mastery = applyMasteryEvent(null, event, { now: NOW });

  assert.equal(mastery.masteryStatus, "developing");
  assert.equal(mastery.reviewAt, "2026-08-14T10:00:00.000Z");
});
