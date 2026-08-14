function unfinished(session) {
  return Boolean(session?.stage && session.stage !== "complete");
}

function selectActiveSession(cloudSessions = [], localSession = null) {
  // Active sessions from the cloud are already identity-scoped. Do not use a
  // caller-supplied global/local fallback here: that value may belong to the
  // previous WeChat participant. Identity-bound local fallback is handled
  // explicitly by bindLearnerIdentity below.
  return cloudSessions.find(unfinished) || null;
}

/**
 * Bind local storage to the identity returned by learner sync before reading
 * any participant-owned data. CloudBase has no safe fallback identity: an
 * absent participantCode leaves storage sealed and clears the in-memory active
 * session so a previous WeChat account cannot be shown.
 */
function bindLearnerIdentity(app, sync = {}) {
  const globalData = app?.globalData || {};
  const config = globalData.config || {};
  const storage = globalData.storage;
  const cloudbase = config.mode === "cloudbase";

  if (!storage) {
    globalData.activeSession = null;
    return { ready: false, participantCode: null, activeSession: null };
  }

  if (cloudbase) {
    const participantCode = String(sync.participantCode || "").trim();
    if (!participantCode || typeof storage.bindParticipant !== "function") {
      storage.unbindParticipant?.();
      globalData.activeSession = null;
      globalData.participantCode = null;
      return { ready: false, participantCode: null, activeSession: null };
    }

    const previousParticipant = globalData.participantCode || storage.participantCode || null;
    const changed = storage.bindParticipant(participantCode);
    // Never carry the old account's global active across a participant switch.
    if (changed || (previousParticipant && previousParticipant !== participantCode)) {
      globalData.activeSession = null;
    }
    globalData.participantCode = participantCode;

    const localActive = storage.get("active-session", null);
    const remoteActive = selectActiveSession(sync.sessions || []);
    const activeSession = remoteActive || (unfinished(localActive) ? localActive : null);
    globalData.activeSession = activeSession;
    if (activeSession) storage.set("active-session", activeSession);
    else storage.remove("active-session");
    return { ready: true, participantCode, activeSession };
  }

  // local-demo intentionally remains invite-code scoped and does not need a
  // cloud participant identity.
  const localActive = storage.get("active-session", null);
  const remoteActive = selectActiveSession(sync.sessions || []);
  const activeSession = remoteActive || (unfinished(localActive) ? localActive : null);
  globalData.activeSession = activeSession;
  globalData.participantCode = sync.participantCode || config.inviteCode || null;
  if (activeSession) storage.set("active-session", activeSession);
  else storage.remove("active-session");
  return {
    ready: true,
    participantCode: sync.participantCode || config.inviteCode || null,
    activeSession
  };
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

module.exports = { bindLearnerIdentity, selectActiveSession, todayCard };
