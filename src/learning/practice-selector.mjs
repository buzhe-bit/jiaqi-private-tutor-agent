function isDue(record, now) {
  return Number.isFinite(Date.parse(record?.reviewAt)) && Date.parse(record.reviewAt) <= now.getTime();
}


function weightedPick(candidates, random) {
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  let cursor = Math.max(0, Math.min(0.999999, Number(random()) || 0)) * total;
  for (const candidate of candidates) {
    cursor -= candidate.weight;
    if (cursor < 0) return candidate;
  }
  return candidates.at(-1);
}


export function selectNextPractice({
  questions,
  masteryRecords = [],
  recentSessions = [],
  todaySessions = [],
  now = new Date(),
  random = Math.random
}) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("当前题库还没有可用题目");
  }
  const date = new Date(now);
  const completedToday = todaySessions.filter((session) => session.stage === "complete");
  const dueById = new Map(
    masteryRecords.filter((record) => isDue(record, date)).map((record) => [record.masteryId, record])
  );
  const stableRelations = new Set(
    masteryRecords.filter((record) => record.masteryStatus === "stable")
      .map((record) => record.knowledgeRelation)
      .filter(Boolean)
  );
  const recentIds = new Set(recentSessions.map((session) => session.questionId).filter(Boolean));
  const lastKinds = completedToday.slice(-2).map((session) => session.questionKind);
  const blockedKind = lastKinds.length === 2 && lastKinds[0] && lastKinds[0] === lastKinds[1]
    ? lastKinds[0]
    : "";
  const reviewAlreadyServed = completedToday.some((session) => session.questionKind === "review");
  const forceReview = completedToday.length === 2 && !reviewAlreadyServed && dueById.size > 0;

  let candidates = questions.filter((question) => {
    const dueReview = question.questionKind === "review"
      && dueById.has(question.reviewContext?.masteryId);
    if (forceReview && !dueReview) return false;
    if (blockedKind && question.questionKind === blockedKind) return false;
    if (recentIds.has(question.questionId) && !dueReview) return false;
    return true;
  });
  if (candidates.length === 0) {
    candidates = questions.filter((question) => !recentIds.has(question.questionId));
  }
  if (candidates.length === 0) candidates = [...questions];

  const weighted = candidates.map((question) => {
    const due = dueById.get(question.reviewContext?.masteryId);
    let weight = question.questionKind === "review"
      ? due ? (due.masteryStatus === "unstable" ? 120 : 90) : 20
      : question.questionKind === "relation" ? 45 : 35;
    if (question.knowledgeRelations?.some((relation) => stableRelations.has(relation))) weight *= 0.15;
    return { question, weight: Math.max(weight, 1), due };
  });
  const selected = weightedPick(weighted, random);
  const reason = selected.question.questionKind === "review"
    ? "复习一个已经到期的旧卡点"
    : selected.question.questionKind === "relation"
      ? "补一条哲学家或概念之间的关系"
      : "继续拓展一个新的哲学问题";

  return {
    question: selected.question,
    questionKind: selected.question.questionKind,
    reason,
    todayCompleted: completedToday.length,
    baseTargetReached: completedToday.length >= 3
  };
}
