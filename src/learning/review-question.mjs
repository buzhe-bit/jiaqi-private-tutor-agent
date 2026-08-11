import { createHash } from "node:crypto";


export function buildReviewQuestion({ mastery, parentQuestion, now = new Date() }) {
  const fingerprint = createHash("sha256")
    .update(`${mastery.masteryId}\n${parentQuestion.id}`)
    .digest("hex")
    .slice(0, 16);
  const createdAt = new Date(now).toISOString();
  return {
    questionId: `review-${fingerprint}`,
    stem: parentQuestion.guide.nextRecallQuestion
      || `请用自己的话说明：${mastery.knowledgeRelation}`,
    subject: mastery.subject || parentQuestion.subject || "philosophy",
    topic: mastery.topic || parentQuestion.topic,
    thinker: mastery.thinker || parentQuestion.thinker,
    concepts: mastery.concepts?.length ? [...mastery.concepts] : [...(parentQuestion.concepts || [])],
    knowledgeRelations: [mastery.knowledgeRelation].filter(Boolean),
    questionKind: "review",
    origin: "ai_variant",
    parentQuestionId: parentQuestion.id,
    guide: structuredClone(parentQuestion.guide),
    sourceStatus: "ai_synthesized",
    sourceLabel: "根据学生旧卡点生成的复习变式",
    sourceRefs: [],
    reviewStatus: "unreviewed",
    reviewContext: {
      masteryId: mastery.masteryId,
      parentQuestionId: parentQuestion.id,
      originalIssueType: mastery.issueType,
      intervalDays: mastery.reviewIntervalDays || 0,
      delayedRecallResult: "not_tested"
    },
    createdAt,
    updatedAt: createdAt
  };
}
