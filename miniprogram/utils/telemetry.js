const SAFE_FIELDS = [
  "sessionId", "questionId", "page", "stage", "action", "value",
  "draftLength", "durationMs", "errorCode"
];

async function track(app, event, details = {}) {
  const api = app?.globalData?.api;
  const inviteCode = app?.globalData?.config?.inviteCode || app?.globalData?.inviteCode;
  if (!api || !inviteCode || app?.globalData?.privacyAccepted === false) return false;
  const body = { inviteCode, event, appVersion: "pilot-observe-v1" };
  for (const field of SAFE_FIELDS) {
    if (details[field] !== undefined) body[field] = details[field];
  }
  try {
    await api.post("/api/events", body);
    return true;
  } catch {
    return false;
  }
}

module.exports = { track };
