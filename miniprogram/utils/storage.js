const MAX_HISTORY = 100;

function storageMode(options) {
  if (typeof options === "string") return options;
  return options?.mode || "local-demo";
}

function safeSegment(value) {
  return encodeURIComponent(String(value || "").trim()).slice(0, 160);
}

function createStorage(wxApi, inviteCode = "demo", options = {}) {
  const mode = storageMode(options);
  const basePrefix = `philosophy-coach-mini:${safeSegment(inviteCode)}`;
  let participantCode = mode === "cloudbase" ? "" : String(inviteCode || "demo");

  function isBound() {
    return mode !== "cloudbase" || Boolean(participantCode);
  }

  function namespace() {
    if (!isBound()) return null;
    if (mode !== "cloudbase") return basePrefix;
    return `${basePrefix}:participant:${safeSegment(participantCode)}`;
  }

  function key(name) {
    const current = namespace();
    return current ? `${current}:${name}` : null;
  }

  return {
    get mode() { return mode; },
    get inviteCode() { return inviteCode; },
    get participantCode() { return participantCode || null; },
    get namespace() { return namespace(); },
    isBound,
    bindParticipant(code) {
      if (mode !== "cloudbase") return false;
      const next = String(code || "").trim();
      if (!next) return false;
      const changed = participantCode !== next;
      participantCode = next;
      return changed;
    },
    unbindParticipant() {
      if (mode !== "cloudbase") return false;
      const changed = Boolean(participantCode);
      participantCode = "";
      return changed;
    },
    get(name, fallback = null) {
      const currentKey = key(name);
      if (!currentKey) return fallback;
      const value = wxApi.getStorageSync(currentKey);
      return value === undefined || value === "" ? fallback : value;
    },
    set(name, value) {
      const currentKey = key(name);
      if (!currentKey) return value;
      wxApi.setStorageSync(currentKey, value);
      return value;
    },
    remove(name) {
      const currentKey = key(name);
      if (currentKey) wxApi.removeStorageSync?.(currentKey);
    }
  };
}

function readHistory(storage) {
  const value = storage.get("history", []);
  return Array.isArray(value) ? value : [];
}

function archiveSession(storage, entry) {
  const history = readHistory(storage).filter((item) => item.sessionId !== entry.sessionId);
  history.push({ ...entry });
  history.sort((a, b) => String(b.completedAt || "").localeCompare(String(a.completedAt || "")));
  const result = history.slice(0, MAX_HISTORY);
  storage.set("history", result);
  return result;
}

function saveDraft(storage, draft) {
  return storage.set("draft", { ...draft, savedAt: new Date().toISOString() });
}

function mergeHistory(localEntries = [], cloudSessions = []) {
  const entries = new Map(localEntries.map((entry) => [entry.sessionId, { ...entry }]));
  for (const session of cloudSessions.filter((item) => item.stage === "complete")) {
    const local = entries.get(session.sessionId) || {};
    entries.set(session.sessionId, {
      ...local,
      sessionId: session.sessionId,
      questionId: session.questionId,
      question: session.question,
      questionKind: session.questionKind,
      completedAt: session.updatedAt || local.completedAt,
      initialExpression: session.snapshot?.initialAnswer || local.initialExpression || "",
      finalExpression: session.snapshot?.rewrittenAnswer || session.snapshot?.repairResponse || local.finalExpression || "",
      expressionNote: session.expressionNote || local.expressionNote || null
    });
  }
  return [...entries.values()].sort((a, b) => String(b.completedAt || "").localeCompare(String(a.completedAt || "")));
}

module.exports = { archiveSession, createStorage, mergeHistory, readHistory, saveDraft };
