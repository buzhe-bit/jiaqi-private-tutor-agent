function studentMessage(text, pending = false) {
  return { role: "student", message: text, pending };
}

function coachMessage(feedback, complete = false) {
  return { role: "coach", ...feedback, complete };
}

function createTrainingState(session = {}) {
  return {
    sessionId: session.sessionId || "",
    sessionToken: session.sessionToken || "",
    questionId: session.questionId || "",
    question: session.question || "",
    questionKind: session.questionKind || "new",
    startedAt: session.startedAt || "",
    stage: session.stage || "attempt",
    draft: session.draft || "",
    messages: [...(session.messages || [])],
    feedback: session.feedback || null,
    snapshot: { ...(session.snapshot || {}) },
    expressionNote: session.expressionNote || null,
    request: null,
    error: null
  };
}

function beginRequest(state, request) {
  const input = String(request.input || "").trim();
  return {
    ...state,
    draft: request.action === "ask_followup" ? state.draft : (input || state.draft),
    request: { ...request, input, phase: "loading" },
    error: null
  };
}

function failRequest(state, error) {
  return {
    ...state,
    request: { ...(state.request || {}), phase: "error" },
    error: {
      code: error?.code || "SERVICE_UNAVAILABLE",
      message: error?.message || "这次服务没有接上。不是你答错了，内容已经保留。",
      retryable: error?.retryable !== false,
      preserved: true
    }
  };
}

function applyStepResult(state, result, request) {
  const input = String(request.input || "").trim();
  const messages = [...state.messages];
  if (input) messages.push(studentMessage(input));
  messages.push(coachMessage(result.feedback || {}, result.nextStage === "complete"));
  return {
    ...state,
    stage: result.nextStage || state.stage,
    draft: request.action === "ask_followup" ? state.draft : "",
    messages: messages.slice(-40),
    feedback: result.feedback || null,
    snapshot: { ...(result.snapshot || state.snapshot) },
    expressionNote: result.expressionNote || state.expressionNote,
    request: { ...request, input, phase: "done" },
    error: null
  };
}

function requestPayload(state, request) {
  return {
    sessionToken: state.sessionToken,
    stage: state.stage,
    action: request.action,
    input: request.input || "",
    snapshot: state.snapshot,
    messages: state.messages,
    expressionNote: state.expressionNote
  };
}

module.exports = {
  applyStepResult,
  beginRequest,
  createTrainingState,
  failRequest,
  requestPayload
};
