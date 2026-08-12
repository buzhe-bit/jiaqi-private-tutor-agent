function unfinished(session) {
  return Boolean(session?.stage && session.stage !== "complete");
}

function selectActiveSession(cloudSessions = [], localSession = null) {
  return cloudSessions.find(unfinished) || (unfinished(localSession) ? localSession : null);
}

function todayCard(recommendation, activeSession = null) {
  if (!activeSession) return { ...recommendation, active: false };
  return {
    questionId: activeSession.questionId,
    question: activeSession.question,
    questionKind: activeSession.questionKind || "new",
    reason: "这道题还没有完成",
    active: true
  };
}

module.exports = { selectActiveSession, todayCard };
