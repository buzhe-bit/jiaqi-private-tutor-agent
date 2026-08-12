const MAX_HISTORY = 100;

function createStorage(wxApi, inviteCode = "demo") {
  const prefix = `philosophy-coach-mini:${inviteCode}`;
  return {
    get(name, fallback = null) {
      const value = wxApi.getStorageSync(`${prefix}:${name}`);
      return value === undefined || value === "" ? fallback : value;
    },
    set(name, value) {
      wxApi.setStorageSync(`${prefix}:${name}`, value);
      return value;
    },
    remove(name) {
      wxApi.removeStorageSync?.(`${prefix}:${name}`);
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
