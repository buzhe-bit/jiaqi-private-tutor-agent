import { createHash } from "node:crypto";


function text(value, maxLength = 1600) {
  return String(value || "").trim().slice(0, maxLength);
}


export function masteryIdFor({ participantCode, subject, questionId, topic, knowledgeRelation }) {
  const participant = text(participantCode, 80) || "unknown";
  const domain = text(subject, 80) || "philosophy";
  const stableQuestionId = text(questionId, 120);
  const stableKey = stableQuestionId
    ? `question:${stableQuestionId}`
    : `${text(topic, 300)}\n${text(knowledgeRelation, 1000)}`;
  const fingerprint = createHash("sha256")
    .update(stableKey)
    .digest("hex")
    .slice(0, 16);
  return `${participant}:${domain}:${fingerprint}`;
}


export function nextReviewAt({
  now = new Date(),
  masteryStatus,
  delayedRecallResult = "not_tested",
  previousReviewDays = 0
}) {
  const date = new Date(now);
  const days = delayedRecallResult === "failed" || masteryStatus === "unstable"
    ? 1
    : masteryStatus === "developing"
      ? 3
      : previousReviewDays >= 7 ? 14 : 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}


export function buildMasteryEvent({ session, diagnosis, now = new Date() }) {
  const snapshot = session?.snapshot || {};
  const stableAllowed = diagnosis?.confidence !== "low";
  const masteryStatus = diagnosis?.masteryStatus === "stable" && !stableAllowed
    ? "developing"
    : diagnosis?.masteryStatus;
  return {
    sessionId: text(session?.sessionId, 120),
    questionId: text(session?.questionId, 120),
    participantCode: text(session?.participantCode, 100),
    subject: text(diagnosis?.subject, 80) || "philosophy",
    topic: text(diagnosis?.topic, 300),
    thinker: text(diagnosis?.thinker, 100),
    concepts: Array.isArray(diagnosis?.concepts) ? diagnosis.concepts.slice(0, 12) : [],
    knowledgeRelation: text(diagnosis?.knowledgeRelations?.[0], 1000),
    misconception: text(diagnosis?.misconception),
    expressionIssue: text(diagnosis?.expressionIssue),
    issueType: text(diagnosis?.issueType, 50),
    masteryStatus,
    confidence: text(diagnosis?.confidence, 20),
    evidence: text(diagnosis?.evidence),
    initialAnswer: text(snapshot.initialAnswer, 4000),
    intervention: text(snapshot.intervention, 2400),
    improvedExpression: text(snapshot.rewrittenAnswer || snapshot.repairResponse, 5000),
    delayedRecallResult: text(session?.reviewContext?.delayedRecallResult, 30) || "not_tested",
    previousReviewDays: Number(session?.reviewContext?.intervalDays || 0),
    observedAt: new Date(now).toISOString()
  };
}


export function applyMasteryEvent(previous, event, { now = new Date() } = {}) {
  if (previous?.sourceSessionIds?.includes(event.sessionId)) return structuredClone(previous);

  const delayedFailed = event.delayedRecallResult === "failed";
  const lowConfidenceStable = event.confidence === "low" && event.masteryStatus === "stable";
  const masteryStatus = delayedFailed
    ? "unstable"
    : lowConfidenceStable ? "developing" : event.masteryStatus;
  const previousReviewDays = Number(event.previousReviewDays || previous?.reviewIntervalDays || 0);
  const reviewAt = nextReviewAt({
    now,
    masteryStatus,
    delayedRecallResult: event.delayedRecallResult,
    previousReviewDays
  });
  const reviewIntervalDays = Math.round((Date.parse(reviewAt) - new Date(now).getTime()) / 86_400_000);
  const recentEvent = {
    sessionId: event.sessionId,
    questionId: event.questionId,
    observedAt: event.observedAt,
    initialAnswer: event.initialAnswer,
    issueType: delayedFailed ? "delayed_recall_unstable" : event.issueType,
    evidence: event.evidence,
    intervention: event.intervention,
    improvedExpression: event.improvedExpression,
    result: masteryStatus === "unstable" ? "needs_support" : "improved",
    delayedRecallResult: event.delayedRecallResult
  };
  const sourceSessionIds = [...(previous?.sourceSessionIds || []), event.sessionId];

  return {
    masteryId: previous?.masteryId || masteryIdFor(event),
    participantCode: event.participantCode,
    subject: event.subject,
    topic: event.topic,
    thinker: event.thinker,
    concepts: event.concepts,
    knowledgeRelation: event.knowledgeRelation,
    misconception: event.misconception,
    expressionIssue: event.expressionIssue,
    issueType: delayedFailed ? "delayed_recall_unstable" : event.issueType,
    masteryStatus,
    delayedRecallResult: event.delayedRecallResult,
    reviewAt,
    reviewIntervalDays,
    attemptCount: Number(previous?.attemptCount || 0) + 1,
    firstSeenAt: previous?.firstSeenAt || event.observedAt,
    lastSeenAt: event.observedAt,
    sourceSessionIds,
    recentEvents: [...(previous?.recentEvents || []), recentEvent].slice(-10)
  };
}
