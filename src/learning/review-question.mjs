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
    participantCode: mastery.participantCode || "",
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


export function buildFollowupReviewQuestion({ mastery, parentQuestion, now = new Date() }) {
  const followup = mastery.followupQuestions?.at(-1);
  if (!followup?.question) return null;
  const fingerprint = createHash("sha256")
    .update(`${mastery.masteryId}\nfollowup\n${followup.question}`)
    .digest("hex")
    .slice(0, 16);
  const createdAt = new Date(now).toISOString();
  const stem = `请重新回答你当时提出的问题：${followup.question} 再说明这一区别或关系对当前题有什么帮助。`;
  const focus = followup.knowledgeConnection || mastery.knowledgeRelation;
  const answer = followup.coachAnswer || focus;
  return {
    questionId: `followup-review-${fingerprint}`,
    stem,
    subject: mastery.subject || parentQuestion.subject || "philosophy",
    topic: mastery.topic || parentQuestion.topic,
    thinker: mastery.thinker || parentQuestion.thinker,
    concepts: mastery.concepts?.length ? [...mastery.concepts] : [...(parentQuestion.concepts || [])],
    knowledgeRelations: [focus].filter(Boolean),
    questionKind: "review",
    origin: "ai_variant",
    parentQuestionId: parentQuestion.id,
    guide: {
      focus,
      answerHook: "先直接回答当时的追问，再把这条知识联系接回原题。",
      explanation: answer,
      answerStructure: [
        "直接回答追问中的概念或哲学家差异。",
        "说清两者之间的继承、批判或转向。",
        "说明这条联系怎样帮助原题作答。"
      ],
      possibleAnswer: answer,
      nextRecallQuestion: stem,
      keyTerms: mastery.concepts?.slice(0, 8) || []
    },
    sourceStatus: "ai_synthesized",
    sourceLabel: "根据学生追问卡点生成的补缺题",
    participantCode: mastery.participantCode || "",
    sourceRefs: [],
    reviewStatus: "unreviewed",
    reviewContext: {
      kind: "followup_gap",
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
