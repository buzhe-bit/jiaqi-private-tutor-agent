const previewRoute = new URLSearchParams(location.search).get("preview") || "";
const moduleQuery = previewRoute ? `?preview=${encodeURIComponent(previewRoute)}` : "";
const [historyStore, requestRoute] = await Promise.all([
  import(`./history-store.js${moduleQuery}`),
  import(`./request-route.js${moduleQuery}`)
]);
const { archiveSession, groupHistoryByDate, readHistory } = historyStore;
const { withPreviewRoute } = requestRoute;

const QUESTION = "在康德哲学中，自由‘构成了纯粹的，甚至思辨理性体系的整个建筑的拱顶石’。试从理论理性和实践理性两个层次说明之。";
const inviteCode = new URLSearchParams(location.search).get("invite") || "";
const storageKey = `philosophy-coach:${inviteCode || "missing"}`;
const historyStorageKey = `philosophy-coach-history:${inviteCode || "missing"}`;
const appRoot = document.querySelector("#app");
const appNav = document.querySelector("#app-nav");
const navButtons = [...document.querySelectorAll("[data-app-view]")];
const progressRegion = document.querySelector("#progress-region");
const progressLabel = document.querySelector("#progress-label");
const progressCount = document.querySelector("#progress-count");
const progressGoal = document.querySelector("#progress-goal");
const progressSteps = [...document.querySelectorAll("[data-progress-step]")];
const participantBadge = document.querySelector("#participant-badge");

const STAGE_PROGRESS = {
  attempt: {
    step: 1,
    label: "先试着回答",
    goal: "完成条件：留下第一次真实作答，写“不知道”也可以"
  },
  teaching: {
    step: 2,
    label: "把关键关系弄懂",
    goal: "完成条件：能用自己的话说清这道题的一个关键关系"
  },
  restate: {
    step: 3,
    label: "用自己的话说",
    goal: "完成条件：不用术语堆砌，说清本轮关键关系"
  },
  revision: {
    step: 4,
    label: "改进完整表达",
    goal: "完成条件：把关键关系写回自己的答案"
  },
  complete: {
    step: 4,
    label: "本轮完成",
    goal: "你已经完成一次理解和表达改进"
  }
};

const HELP_CHOICES = {
  hint: { label: "给我一个提示", action: "request_hint", icon: "message-circle-more" },
  explain: { label: "讲明白（解释＋例子）", action: "request_explanation", icon: "book-open" },
  reference: { label: "看一种可行作答", action: "request_reference", icon: "pen-tool" }
};

let state = migrateState(loadState()) || initialState();
let questions = [];
let busy = false;
let errorState = null;
let renderedStage = null;
let renderedView = null;


function initialState() {
  return {
    view: "today",
    stage: "intro",
    snapshot: {},
    drafts: {},
    messages: [],
    requestProgress: null,
    pendingStudent: null,
    coachOpen: false,
    coachMode: "unknown",
    storageMode: "unknown",
    recommendation: null,
    learningProfile: null
  };
}


function loadState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}


function migrateState(loaded) {
  if (!loaded) return null;
  const oldStages = {
    interpretation: "attempt",
    repair: "teaching",
    rewrite: "revision",
    reflection: loaded.snapshot?.rewrittenAnswer ? "complete" : "teaching"
  };
  const wasOldFlow = Boolean(oldStages[loaded.stage]);
  loaded.stage = oldStages[loaded.stage] || loaded.stage;
  loaded.view ||= loaded.stage === "intro" ? "today" : "training";
  loaded.questionId ||= "kant-freedom-keystone";
  loaded.snapshot ||= {};
  loaded.drafts ||= {};
  loaded.messages = Array.isArray(loaded.messages) ? loaded.messages : [];
  loaded.pendingStudent ||= null;
  loaded.coachOpen = Boolean(loaded.coachOpen);
  loaded.coachMode ||= "unknown";
  loaded.storageMode ||= "unknown";
  loaded.recommendation ||= null;
  loaded.learningProfile ||= null;
  if (loaded.requestProgress?.phase === "loading") {
    loaded.requestProgress = { phase: "error", saved: loaded.requestProgress.saved };
  }
  if (wasOldFlow) {
    if (loaded.snapshot.initialAnswer) {
      loaded.messages.push({ role: "student", message: loaded.snapshot.initialAnswer });
    }
    loaded.messages.push({
      role: "coach",
      message: "陪练流程已经更新。接下来如果你不会，我会先讲清楚，不会再反复催你继续写。"
    });
    loaded.feedback = {
      message: "我们从你现在真正卡住的地方继续。",
      studentEvidence: "你已经留下了自己的真实起点。",
      missingPoint: "现在只补自由怎样连接理论理性与实践理性。",
      focus: "先把自由怎样连接理论理性与实践理性弄懂。",
      teaching: "",
      nextActions: ["hint", "explain", "example", "reference", "restate"]
    };
  }
  return loaded;
}


function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}


function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === "className") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) element.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) element.append(child);
  }
  return element;
}


function paragraph(text, className = "") {
  return node("p", { text, className });
}


function splitTeaching(text) {
  const value = String(text || "").trim();
  if (!value) return [];
  const explicitBlocks = value.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  if (explicitBlocks.length > 1) return explicitBlocks;

  const sentences = value.match(/[^。！？\n]+[。！？]?/g)?.map((part) => part.trim()).filter(Boolean) || [];
  if (sentences.length < 2) return explicitBlocks;
  if (sentences.length <= 2) return sentences;
  return sentences.reduce((blocks, sentence, index) => {
    if (index === 0 || index === sentences.length - 1 || index % 2 === 1) {
      blocks.push(sentence);
    } else {
      blocks[blocks.length - 1] += sentence;
    }
    return blocks;
  }, []);
}


function requestStatusCopy(progress, stage) {
  const nextSteps = {
    attempt: "留下第一次真实作答，不知道也可以。",
    teaching: "选择一种帮助，弄懂后进入自己的复述。",
    restate: "用自己的话说清这道题的关键关系。",
    revision: "把刚弄懂的关系写回自己的答案。",
    complete: "复制表达笔记，留作下一次复习。"
  };
  if (progress?.phase === "loading") {
    return {
      title: progress.saved ? "你的回答已经保存" : "你的选择已经提交",
      detail: "私教正在判断你卡在哪里……",
      loading: true
    };
  }
  if (progress?.phase === "done") {
    return {
      title: "本轮反馈已经生成",
      detail: `下一步：${nextSteps[stage] || "继续完成当前动作。"}`,
      loading: false
    };
  }
  if (progress?.phase === "error") {
    return {
      title: "这次没有处理完成",
      detail: "你的回答还在，可以原地重试。",
      loading: false
    };
  }
  return {
    title: "当前要做",
    detail: nextSteps[stage] || "完成当前动作后，我会告诉你下一步。",
    loading: false
  };
}


function requestStatusNode() {
  const copy = requestStatusCopy(state.requestProgress, state.stage);
  const phase = state.requestProgress?.phase || "idle";
  return node("div", {
    className: `request-status request-status-${phase}`,
    role: "status",
    "aria-live": "polite"
  }, [
    node("strong", { text: copy.title }),
    paragraph(copy.detail),
    copy.loading ? node("span", { className: "request-loading-line", "aria-hidden": "true" }) : null
  ]);
}


function formatExpressionNote(note) {
  if (!note) return "";
  const structure = Array.isArray(note.answerStructure)
    ? note.answerStructure.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "";
  return [
    "哲学论述陪练｜本题复习稿",
    `题目\n${note.question || ""}`,
    `答题抓手\n${note.answerHook || ""}`,
    `答题思路\n${structure}`,
    `我的最终表达\n${note.finalExpression || ""}`,
    `一种可行作答\n${note.possibleAnswer || ""}`
  ].filter(Boolean).join("\n\n").trim();
}


async function copyText(text, label = "内容") {
  const value = String(text || "").trim();
  if (!value) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(value);
    state.copyStatus = `${label}已复制，可以粘贴到 Obsidian、飞书或 Word。`;
    state.copyFallback = "";
  } catch {
    state.copyStatus = "自动复制没有成功，请长按或全选下面的文字复制。";
    state.copyFallback = value;
  }
  saveState();
  render();
  if (state.copyFallback) {
    requestAnimationFrame(() => document.querySelector(".copy-fallback")?.select());
  }
}


function panel(title, eyebrow, children = [], className = "") {
  return node("section", { className: `panel ${className}`.trim() }, [
    node("span", { className: "eyebrow", text: eyebrow }),
    node("h1", { text: title }),
    ...children
  ]);
}


function coachModeNotice() {
  if (state.coachMode !== "demo") return null;
  return node("div", { className: "mode-notice", role: "status" }, [
    node("strong", { text: "演示模式：回答为固定样例" }),
    paragraph("这里用于检查流程，不能用来判断真实 AI 的回答质量。")
  ]);
}


function questionCard(compact = false, sticky = false) {
  return node("div", {
    className: `question-card${compact ? " question-card-compact" : ""}${sticky ? " question-card-sticky" : ""}`
  }, [
    node("span", { className: "question-label", text: "这次要回答的题" }),
    paragraph(state.question || QUESTION)
  ]);
}


function textareaField({ id, label, hint, placeholder, value = "", compact = false }) {
  const textarea = node("textarea", {
    id,
    name: id,
    placeholder,
    className: compact ? "compact-textarea" : "",
    maxlength: "12000"
  });
  textarea.value = value;
  textarea.addEventListener("input", () => {
    state.drafts ||= {};
    state.drafts[id] = textarea.value;
    saveState();
  });
  return {
    container: node("div", { className: "field" }, [
      node("label", { for: id, text: label }),
      hint ? paragraph(hint, "field-hint") : null,
      textarea
    ]),
    textarea
  };
}



function button(text, onClick, kind = "primary", icon = "") {
  return node("button", {
    type: "button",
    className: `button button-${kind}`,
    disabled: busy ? "disabled" : null,
    onClick
  }, [
    icon ? node("img", {
      className: "button-glyph",
      src: withPreviewRoute(`/assets/icons/${icon}.svg`),
      alt: "",
      "aria-hidden": "true"
    }) : null,
    node("span", { className: "button-label", text })
  ]);
}


function setProgress() {
  const info = STAGE_PROGRESS[state.stage];
  const trainingVisible = state.view === "training";
  if (!info || !trainingVisible) {
    progressRegion.hidden = true;
    participantBadge.hidden = !state.participantCode;
    document.documentElement.dataset.plumStep = "0";
    document.documentElement.dataset.plumComplete = "false";
    return;
  }
  progressRegion.hidden = false;
  progressLabel.textContent = info.label;
  progressCount.textContent = `第 ${info.step} 步 / 4`;
  progressGoal.textContent = info.goal;
  for (const stepNode of progressSteps) {
    const step = Number(stepNode.dataset.progressStep);
    stepNode.classList.remove("is-complete", "is-current", "is-pending");
    if (state.stage === "complete" || step < info.step) stepNode.classList.add("is-complete");
    else if (step === info.step) stepNode.classList.add("is-current");
    else stepNode.classList.add("is-pending");
  }
  document.documentElement.dataset.plumStep = String(info.step);
  document.documentElement.dataset.plumComplete = state.stage === "complete" ? "true" : "false";
  participantBadge.hidden = false;
  participantBadge.textContent = state.participantCode || "匿名试用";
}


function updateNavigation() {
  const current = state.view === "training" || state.view === "history-detail"
    ? (state.view === "history-detail" ? "history" : "today")
    : state.view;
  for (const item of navButtons) {
    const active = item.dataset.appView === current;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  }
  appNav.hidden = !inviteCode;
}


async function apiGet(path) {
  let response;
  try {
    response = await fetch(withPreviewRoute(path), { headers: { accept: "application/json" } });
  } catch (error) {
    throw Object.assign(new Error("题单暂时没有加载出来，请检查网络后重试。"), { cause: error });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "题单暂时没有加载出来。");
  return data;
}


async function api(path, body) {
  let response;
  try {
    response = await fetch(withPreviewRoute(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw Object.assign(new Error("网络没有连接上，不是你答错了。请检查网络后原地重试。"), {
      code: "NETWORK_ERROR",
      retryable: true,
      preserved: true,
      cause: error
    });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || "AI 这次没有接上，不是你答错了。"), {
      code: data.code || "REQUEST_ERROR",
      retryable: data.retryable === true,
      preserved: state.stage !== "intro"
    });
  }
  return data;
}


async function withBusy(action) {
  if (busy) return;
  busy = true;
  errorState = null;
  render();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    await action();
  } catch (error) {
    if (state.requestProgress?.phase === "loading") {
      state.requestProgress = { ...state.requestProgress, phase: "error" };
    }
    errorState = {
      message: error.message || "AI 这次没有接上，不是你答错了。",
      code: error.code || "",
      retryable: error.retryable === true,
      preserved: error.preserved !== false
    };
  } finally {
    busy = false;
    saveState();
    render();
  }
}


function sessionPayload(extra = {}) {
  return {
    sessionToken: state.sessionToken,
    snapshot: state.snapshot || {},
    messages: state.messages || [],
    expressionNote: state.expressionNote || null,
    ...extra
  };
}


function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}


function historyEntries() {
  return readHistory(localStorage, historyStorageKey);
}


function archiveCloudSession(session) {
  if (session.stage !== "complete" || !session.expressionNote) return;
  archiveSession(localStorage, historyStorageKey, {
    sessionId: session.sessionId,
    questionId: session.questionId,
    question: session.question,
    questionKind: session.questionKind || "new",
    completedAt: session.updatedAt,
    completedDate: String(session.updatedAt || "").slice(0, 10),
    initialExpression: session.snapshot?.initialAnswer || "",
    finalExpression: session.snapshot?.rewrittenAnswer || session.snapshot?.repairResponse || "",
    primaryIssue: session.snapshot?.primaryIssue || "",
    expressionNote: session.expressionNote
  });
}


async function syncLearnerData() {
  if (!inviteCode) return;
  try {
    const result = await api("/api/learner/sync", { inviteCode });
    const sessions = Array.isArray(result.sessions) ? result.sessions : [];
    sessions.forEach(archiveCloudSession);
    const localActive = state.sessionId && !["intro", "complete"].includes(state.stage);
    const remoteActive = sessions.find((session) => session.stage !== "complete" && session.sessionToken);
    state.cloudResume = !localActive ? remoteActive || null : null;
    state.participantCode ||= result.participantCode || "";
    state.learningProfile = result.profile || state.learningProfile;
    state.syncStatus = "synced";
    saveState();
    render();
  } catch {
    state.syncStatus = "local";
    saveState();
  }
}


function resumeCloudSession() {
  const remote = state.cloudResume;
  if (!remote) return;
  const coachMode = state.coachMode;
  const learningProfile = state.learningProfile;
  state = {
    ...initialState(),
    ...remote,
    coachMode,
    learningProfile,
    view: "training",
    consentAccepted: true,
    drafts: {},
    requestProgress: null,
    cloudResume: null
  };
  saveState();
  render();
}


function archiveCurrentSession() {
  if (!state.sessionId || !state.expressionNote) return;
  const completedAt = new Date().toISOString();
  archiveSession(localStorage, historyStorageKey, {
    sessionId: state.sessionId,
    questionId: state.questionId,
    question: state.question,
    questionKind: state.questionKind || "new",
    completedAt,
    completedDate: localDateKey(new Date(completedAt)),
    initialExpression: state.snapshot?.initialAnswer || "",
    finalExpression: state.snapshot?.rewrittenAnswer || state.snapshot?.repairResponse || "",
    primaryIssue: state.snapshot?.primaryIssue || "",
    expressionNote: state.expressionNote
  });
}


async function startQuestionRequest(questionId, recommendation = state.recommendation) {
  const coachMode = state.coachMode;
  const storageMode = state.storageMode;
  const learningProfile = state.learningProfile;
  const result = await api("/api/session/start", {
    inviteCode,
    consent: true,
    questionId,
    sourceExcerpt: ""
  });
  state = {
    ...initialState(),
    ...result,
    coachMode,
    storageMode,
    learningProfile,
    view: "training",
    consentAccepted: true,
    todayCompleted: recommendation?.todayCompleted || todayHistory().length,
    baseTargetReached: recommendation?.baseTargetReached === true,
    feedback: null,
    drafts: {},
    messages: []
  };
}


function startQuestion(questionId) {
  return withBusy(() => startQuestionRequest(questionId));
}


function loadRecommendation({ autoStart = false } = {}) {
  if (!state.consentAccepted) return;
  return withBusy(async () => {
    const recommendation = await api("/api/practice/next", { inviteCode });
    state.recommendation = recommendation;
    if (autoStart) await startQuestionRequest(recommendation.questionId, recommendation);
  });
}


function pushMessage(message) {
  state.messages ||= [];
  state.messages.push(message);
  state.messages = state.messages.slice(-40);
}


function applyStepResult(result, request) {
  if (state.pendingStudent) pushMessage({ role: "student", message: state.pendingStudent.message });
  else if (request.studentText) pushMessage({ role: "student", message: request.studentText });
  pushMessage({
    role: "coach",
    message: result.feedback.message,
    studentEvidence: result.feedback.studentEvidence,
    missingPoint: result.feedback.missingPoint,
    focus: result.feedback.focus,
    teaching: result.feedback.teaching,
    knowledgeConnection: result.feedback.knowledgeConnection,
    complete: result.nextStage === "complete",
    kind: request.action === "submit_attempt"
      ? "diagnosis"
      : (request.action === "request_reference" ? "reference" : "")
  });
  state.feedback = result.feedback;
  state.snapshot = result.snapshot;
  state.stage = result.nextStage;
  state.expressionNote = result.expressionNote || null;
  if (result.nextStage === "complete") archiveCurrentSession();
  state.requestProgress = { phase: "done", saved: Boolean(request.studentText?.trim()) };
  state.scrollTarget = "latest-feedback";
  state.coachOpen = false;
  state.paused = false;
  state.pendingStudent = null;
  if (request.draftKey && state.drafts) delete state.drafts[request.draftKey];
  state.lastRequest = null;
}


function runStep(request) {
  document.activeElement?.blur?.();
  if (request.studentText?.trim()) {
    state.pendingStudent = {
      role: "student",
      message: request.studentText.trim(),
      pending: true
    };
    state.scrollTarget = "pending-student";
  }
  state.requestProgress = {
    phase: "loading",
    saved: Boolean(request.studentText?.trim())
  };
  state.lastRequest = request;
  saveState();
  return withBusy(async () => {
    const result = await api("/api/session/step", sessionPayload({
      stage: request.stage,
      action: request.action,
      input: request.input || ""
    }));
    applyStepResult(result, request);
  });
}


function retryLastStep() {
  if (!state.lastRequest) return;
  runStep({ ...state.lastRequest });
}


function errorNode() {
  if (!errorState) return null;
  const preserved = errorState.preserved !== false && state.stage !== "intro";
  return node("div", { className: "error-message", role: "alert" }, [
    node("strong", { text: errorState.retryable ? "AI 这次没有接上" : "这里还差一步" }),
    paragraph(errorState.message),
    preserved ? paragraph("不是你答错了。答案已保留在这台设备上，不用重写。", "error-help") : null,
    errorState.code && errorState.code !== "REQUEST_ERROR"
      ? paragraph(`错误编号：${errorState.code}`, "error-code")
      : null,
    errorState.retryable && state.lastRequest
      ? button("原地重试", retryLastStep, "secondary")
      : null
  ]);
}


function coachBubble(item) {
  const messageBlocks = splitTeaching(item.message);
  const teachingBlocks = splitTeaching(item.teaching);
  const completedPoint = item.complete || /已经补上|已经形成|无需再补/.test(String(item.missingPoint || ""));
  const diagnosis = item.studentEvidence || item.missingPoint ? node("details", {
    className: "feedback-details",
    open: item.kind === "diagnosis" ? "" : null
  }, [
    node("summary", { text: item.kind === "diagnosis" ? "我确实看了你的回答" : "我为什么这样判断" }),
    item.studentEvidence ? node("div", { className: "feedback-block feedback-known" }, [
      node("strong", { text: "你已经说对的" }),
      paragraph(item.studentEvidence)
    ]) : null,
    item.missingPoint ? node("div", { className: "feedback-block feedback-missing" }, [
      node("strong", { text: completedPoint ? "这次补上的关键点" : "现在只补这一点" }),
      paragraph(item.missingPoint)
    ]) : null
  ]) : null;
  return node("article", { className: `message message-coach${item.kind ? ` message-${item.kind}` : ""}` }, [
    node("span", { className: "message-name", text: item.kind === "reference" ? "一种可行作答" : "私教" }),
    messageBlocks[0] ? paragraph(messageBlocks[0], "feedback-conclusion") : null,
    ...messageBlocks.slice(1).map((block) => paragraph(block, "feedback-paragraph")),
    diagnosis,
    item.focus ? node("div", { className: "focus-line" }, [
      node("strong", { text: "这题先抓住这句话" }),
      paragraph(item.focus)
    ]) : null,
    teachingBlocks.length ? node("div", { className: "teaching-block" }, [
      node("strong", { text: item.kind === "diagnosis" ? "把这一点补成完整论证" : "给你讲清楚" }),
      ...teachingBlocks.map((block) => paragraph(block, "teaching-text"))
    ]) : null,
    item.knowledgeConnection ? node("div", { className: "knowledge-connection" }, [
      node("strong", { text: "这次建立的知识联系" }),
      paragraph(item.knowledgeConnection)
    ]) : null
  ]);
}


function studentBubble(item) {
  const pendingStatus = item.pending ? requestStatusCopy(state.requestProgress, state.stage) : null;
  return node("article", { className: `message message-student${item.pending ? " message-pending" : ""}` }, [
    node("span", { className: "message-name", text: "你" }),
    paragraph(item.message),
    pendingStatus ? node("span", {
      className: "message-send-status",
      text: state.requestProgress?.phase === "error"
        ? "没有发出去，内容已保留，可原地重试"
        : "已保存 · 私教正在回复……"
    }) : null
  ]);
}


function conversationLog() {
  const savedItems = state.messages?.length
    ? state.messages
    : [{
        role: "coach",
        message: "先别查答案，直接写你现在会的。写‘不知道’也可以——它只是在记录你的真实起点。"
      }];
  const items = state.pendingStudent ? [...savedItems, state.pendingStudent] : savedItems;
  const olderItems = items.length > 3 ? items.slice(0, -3) : [];
  const recentItems = items.length > 3 ? items.slice(-3) : items;
  const history = olderItems.length ? node("details", { className: "conversation-history" }, [
    node("summary", { text: `此前对话 · ${olderItems.length} 条` }),
    node("div", { className: "history-list" }, [
      ...olderItems.map((item) => item.role === "student" ? studentBubble(item) : coachBubble(item))
    ])
  ]) : null;
  return node("div", { className: "conversation-log", "aria-live": "polite" }, [
    history,
    ...recentItems.map((item, index) => {
      const bubble = item.role === "student" ? studentBubble(item) : coachBubble(item);
      if (item.role === "coach" && index === recentItems.length - 1 && !state.pendingStudent) {
        bubble.classList.add("message-latest");
      }
      return bubble;
    })
  ]);
}


function renderIntro() {
  if (!inviteCode) {
    return panel("这个链接不完整", "无法开始", [
      paragraph("请使用老师单独发给你的完整试用链接。", "lead"),
      errorNode()
    ]);
  }
  const consent = node("input", { type: "checkbox", id: "consent" });
  return panel("先从一题开始，做得动就继续", "匿名试用 · 今日训练", [
    paragraph("系统会在新题、关系题和旧卡点复习之间选择。三题是建议基础量，不是上限。", "lead"),
    paragraph(`当前题库从 ${questions.length} 道真题种子开始，下面只是三个例子。`, "field-hint"),
    node("ol", { className: "question-preview-list" }, questions.slice(0, 3).map((question) => node("li", {}, [
      node("span", { text: `${question.thinker} · ${question.type}` }),
      paragraph(question.text)
    ]))),
    node("ul", { className: "principles" }, [
      node("li", { text: "必须先完成一次自己的尝试，写‘不会’也可以" }),
      node("li", { text: "真不会时，可以自己选择提示、带例子的讲解或一种可行作答" }),
      node("li", { text: "最后留下自己的表达、AI 补充和下一次复习抓手" })
    ]),
    node("label", { className: "consent", for: "consent" }, [
      consent,
      node("span", { text: "我知道回答和反馈会以匿名编号保存，用于改进学习方法；请不要填写姓名或其他敏感信息。" })
    ]),
    errorNode(),
    node("div", { className: "button-row" }, [
      button("进入今日题单", () => {
        if (!consent.checked) {
          errorState = { message: "请先确认匿名试用说明", retryable: false, preserved: false };
          render();
          return;
        }
        state.consentAccepted = true;
        errorState = null;
        saveState();
        loadRecommendation();
      })
    ])
  ], "hero-panel");
}


function helpControls() {
  const runChoice = (choice) => runStep({
      stage: "teaching",
      action: choice.action,
      input: ""
    });
  const iconChoices = ["hint", "explain", "reference"]
    .map((key) => {
      const choice = HELP_CHOICES[key];
      return button(choice.label, () => runChoice(choice), "icon", choice.icon);
    });
  const primary = button("我来用自己的话说说", () => {
      state.stage = "restate";
      state.requestProgress = null;
      errorState = null;
      saveState();
      render();
    }, "primary");
  return node("div", { className: "help-area" }, [
    paragraph("下一步", "composer-kicker"),
    paragraph("如果这段关系已经能说清，就进入复述；还没懂就继续向我索取帮助。", "composer-title"),
    primary,
    iconChoices.length ? node("div", { className: "help-grid" }, iconChoices) : null
  ]);
}


function pauseButton() {
  return button("先暂停，稍后继续", () => {
    state.paused = true;
    errorState = null;
    saveState();
    render();
  }, "secondary");
}


function pausedComposer() {
  return node("div", { className: "composer pause-card" }, [
    node("span", { className: "eyebrow", text: "进度已保留" }),
    node("h2", { text: "先停在这里，不算失败" }),
    paragraph("你的回答、对话和当前步骤都保存在这台设备上。回来后可以从这里接着学。", "lead"),
    node("div", { className: "button-row" }, [
      button("继续这次陪练", () => {
        state.paused = false;
        saveState();
        render();
      })
    ])
  ]);
}


function attemptComposer() {
  const field = textareaField({
    id: "attempt",
    label: "先写下你现在会的",
    hint: "直接回答整道题。允许不完整、允许猜错，也可以只写‘不知道’或‘想不起来’。",
    placeholder: "从你真正记得的地方开始写……",
    value: state.drafts?.attempt || state.snapshot?.initialAnswer || ""
  });
  return node("div", { className: "composer" }, [
    field.container,
    requestStatusNode(),
    errorNode(),
    node("div", { className: "button-row" }, [
      button(busy ? "正在理解你的答案" : "交出我的真实答案", () => {
        return runStep({
          stage: "attempt",
          action: "submit_attempt",
          input: field.textarea.value,
          studentText: field.textarea.value
        });
      }),
      pauseButton()
    ])
  ]);
}


function viewLatestCoachMessage() {
  const messages = [...document.querySelectorAll(".message-coach:not(.message-reference)")];
  messages.at(-1)?.scrollIntoView({ block: "center", behavior: "smooth" });
}


function followupComposer(stage) {
  const draftKey = `followup-${stage}`;
  const toggleCoach = () => {
    state.coachOpen = !state.coachOpen;
    saveState();
    render();
    if (state.coachOpen) requestAnimationFrame(() => document.querySelector(`#${draftKey}`)?.focus());
  };
  const trigger = node("button", {
    type: "button",
    className: "coach-fab",
    "aria-label": state.coachOpen ? "收起私教提问" : "打开私教提问",
    "aria-expanded": String(state.coachOpen),
    "aria-controls": "coach-popover",
    onClick: toggleCoach
  }, [
    node("strong", { text: "问", "aria-hidden": "true" }),
    node("span", { text: state.coachOpen ? "收起" : "问私教" })
  ]);
  if (!state.coachOpen) return node("div", { className: "coach-assistant" }, [trigger]);

  const followup = textareaField({
    id: draftKey,
    label: "还有具体问题？继续问私教，不影响当前草稿",
    hint: "可以问概念、时代背景、回应对象、哲学家比较，或它和当前题目的关系。",
    placeholder: "例如：马克思跟黑格尔的辩证法有什么区别？",
    value: state.drafts?.[draftKey] || "",
    compact: true
  });
  const promptChoices = [
    "比较两位哲学家",
    "补时代背景",
    "这和当前题有什么关系"
  ].map((prompt) => button(prompt, () => {
    followup.textarea.value = prompt;
    state.drafts ||= {};
    state.drafts[draftKey] = prompt;
    saveState();
    followup.textarea.focus();
  }, "prompt"));
  const ask = (input, shownText = input) => runStep({
    stage,
    action: "ask_followup",
    input,
    studentText: shownText,
    draftKey: input === followup.textarea.value ? draftKey : ""
  });
  const popover = node("section", {
    id: "coach-popover",
    className: "coach-popover",
    role: "dialog",
    "aria-label": "继续追问私教"
  }, [
    node("div", { className: "coach-popover-heading" }, [
      node("div", {}, [
        node("h3", { text: "问当前题的具体问题" }),
        paragraph("先回答你的问题，再告诉你它对当前题有什么用；主答案草稿不会清空。")
      ]),
      node("button", { type: "button", className: "coach-close", text: "收起", onClick: toggleCoach })
    ]),
    node("div", { className: "followup-prompts", "aria-label": "常用追问" }, promptChoices),
    followup.container,
    requestStatusNode(),
    node("div", { className: "coach-popover-actions" }, [
      button("查看上一轮讲解", viewLatestCoachMessage, "text"),
      button("发送给私教", () => ask(followup.textarea.value), "secondary")
    ]),
    paragraph("不想打字时，可以直接使用手机键盘的语音输入。", "input-support-note")
  ]);
  return node("div", { className: "coach-assistant" }, [popover, trigger]);
}


function teachingComposer() {
  return node("div", { className: "composer" }, [
    helpControls(),
    requestStatusNode(),
    followupComposer("teaching"),
    errorNode(),
    node("div", { className: "button-row" }, [pauseButton()])
  ]);
}


function restateComposer() {
  const field = textareaField({
    id: "restate",
    label: "现在不用写整道题，只说清一个关键关系",
    hint: "不用照抄刚才的讲解。说清题目中的关键概念怎样连接、为什么这样连接。",
    placeholder: "我现在理解的是……；关键在于……；所以……",
    value: state.drafts?.restate || state.snapshot?.repairResponse || "",
    compact: true
  });
  return node("div", { className: "composer" }, [
    field.container,
    requestStatusNode(),
    followupComposer("restate"),
    errorNode(),
    node("div", { className: "button-row" }, [
      button("提交我的理解", () => runStep({
        stage: "restate",
        action: "submit_restate",
        input: field.textarea.value,
        studentText: field.textarea.value,
        draftKey: "restate"
      })),
      pauseButton()
    ])
  ]);
}


function revisionComposer() {
  const field = textareaField({
    id: "revision",
    label: "把刚才理解的关系写回你的答案",
    hint: "不必追求满分，也不必重写所有内容。至少把最关键的一段表达得比一开始更清楚。",
    placeholder: "在这里写下你改进后的表达……",
    value: state.drafts?.revision || state.snapshot?.rewrittenAnswer || ""
  });
  return node("div", { className: "composer" }, [
    node("div", { className: "before-card" }, [
      node("span", { text: "你一开始写的是" }),
      paragraph(state.snapshot?.initialAnswer || "本次没有形成完整初答")
    ]),
    field.container,
    requestStatusNode(),
    followupComposer("revision"),
    errorNode(),
    node("div", { className: "button-row" }, [
      button("提交改进后的表达", () => runStep({
        stage: "revision",
        action: "submit_revision",
        input: field.textarea.value,
        studentText: field.textarea.value,
        draftKey: "revision"
      })),
      pauseButton()
    ])
  ]);
}


function noteSection(title, content, className = "") {
  return node("section", { className: `note-section ${className}`.trim() }, [
    node("h3", { text: title }),
    paragraph(content || "")
  ]);
}


function expressionNoteView(note) {
  if (!note) return null;
  return node("div", { className: "expression-note" }, [
    node("div", { className: "expression-note-heading" }, [
      node("h2", { text: "本题复习稿" }),
      paragraph("只保留考场复习需要的四层内容；初答、卡点和知识联系仍由系统留存。", "field-hint")
    ]),
    noteSection("题目", note.question),
    noteSection("答题抓手", note.answerHook, "note-hook"),
    node("section", { className: "note-section note-structure" }, [
      node("h3", { text: "答题思路" }),
      node("ol", {}, (note.answerStructure || []).map((item) => node("li", { text: item })))
    ]),
    noteSection("我的最终表达", note.finalExpression, "note-student"),
    noteSection("一种可行作答", note.possibleAnswer, "note-ai"),
    node("div", { className: "button-row copy-actions" }, [
      button("复制整份复习稿", () => copyText(formatExpressionNote(note), "整份复习稿")),
      button("复制我的最终表达", () => copyText(note.finalExpression, "我的最终表达"), "secondary"),
      button("复制一种可行作答", () => copyText(note.possibleAnswer, "一种可行作答"), "secondary")
    ]),
    state.copyStatus ? paragraph(state.copyStatus, "copy-status") : null,
    state.copyFallback ? node("div", { className: "copy-fallback-wrap" }, [
      node("label", { for: "copy-fallback", text: "请复制下面的纯文字" }),
      (() => {
        const textarea = node("textarea", {
          id: "copy-fallback",
          className: "copy-fallback",
          readonly: "readonly"
        });
        textarea.value = state.copyFallback;
        return textarea;
      })()
    ]) : null
  ]);
}


function continueToNextQuestion() {
  return loadRecommendation({ autoStart: true });
}


function returnToRevision() {
  state.view = "training";
  state.stage = "revision";
  state.requestProgress = null;
  state.copyStatus = "";
  state.copyFallback = "";
  state.drafts = { revision: state.snapshot?.rewrittenAnswer || "" };
  saveState();
  render();
}


function completeComposer() {
  const feedback = textareaField({
    id: "optional-feedback",
    label: "体验反馈（可选）",
    hint: "不填写也已经完成。这里只记录哪里仍然让你困惑或不舒服。",
    placeholder: "可以留空……",
    value: state.drafts?.["optional-feedback"] || "",
    compact: true
  });
  const alreadySaved = state.productFeedbackSaved;
  return node("div", { className: "completion" }, [
    node("div", { className: "completion-heading" }, [
      node("span", { className: "eyebrow", text: "本次完成" }),
      node("h2", { text: "你已经完成了一次真实的理解和表达改进" })
    ]),
    requestStatusNode(),
    node("div", { className: "completion-actions" }, [
      button("继续下一题", continueToNextQuestion),
      button("返回修改本题", returnToRevision, "secondary")
    ]),
    expressionNoteView(state.expressionNote),
    alreadySaved ? paragraph("反馈已保存，谢谢。", "saved-note") : node("div", { className: "optional-feedback" }, [
      feedback.container,
      button("提交体验反馈", () => withBusy(async () => {
        await api("/api/session/complete", sessionPayload({
          reflection: {
            studentExplanation: state.snapshot?.repairResponse || "",
            diagnosisHit: "",
            willingReuse: "",
            uxConfusion: feedback.textarea.value
          }
        }));
        state.productFeedbackSaved = true;
      }), "secondary")
    ]),
    errorNode(),
    node("section", { className: "next-round-card" }, [
      node("h2", { text: "本题已经保存，接下来" }),
      paragraph("继续下一题，系统会在新题、关系题和旧卡点复习之间重新选择。"),
      button("保存完成，继续下一题", continueToNextQuestion)
    ])
  ]);
}


function currentComposer() {
  if (state.paused && state.stage !== "complete") return pausedComposer();
  if (state.stage === "attempt") return attemptComposer();
  if (state.stage === "teaching") return teachingComposer();
  if (state.stage === "restate") return restateComposer();
  if (state.stage === "revision") return revisionComposer();
  return completeComposer();
}


function switchView(view) {
  state.view = view;
  errorState = null;
  saveState();
  render();
  if (view === "profile") void syncLearnerData();
}


function todayHistory() {
  const today = localDateKey();
  return historyEntries().filter((entry) => entry.completedDate === today);
}


function sourceBasisCopy(item) {
  if (item?.sourceStatus === "material_supported") {
    return item.sourceLabel ? `有资料依据：${item.sourceLabel}` : "有资料依据";
  }
  if (item?.sourceStatus === "ai_synthesized") {
    return item.sourceLabel
      ? `AI 综合解释，不是唯一标准答案 · ${item.sourceLabel}`
      : "AI 综合解释，不是唯一标准答案";
  }
  return "依据暂未核实，可把讲解作为理解线索，不要当作精确引文";
}


function openHistoryEntry(sessionId) {
  state.selectedHistoryId = sessionId;
  switchView("history-detail");
}


function renderToday() {
  if (!inviteCode) return renderIntro();
  if (!questions.length) return panel("今日题单正在准备", "今日训练", [
    paragraph("题目加载完成后会直接显示在这里。", "lead"),
    errorNode()
  ]);
  if (!state.consentAccepted) return renderIntro();

  const completed = todayHistory();
  const active = state.sessionId && !["intro", "complete"].includes(state.stage);
  const cloudActive = !active ? state.cloudResume : null;
  const recommendation = state.recommendation;
  const kindLabel = { new: "新题", relation: "关系题", review: "复习题" }[recommendation?.questionKind] || "推荐题";
  const current = active
    ? { questionId: state.questionId, question: state.question, questionKind: state.questionKind, reason: "这道题还没有完成" }
    : cloudActive
      ? { questionId: cloudActive.questionId, question: cloudActive.question, questionKind: cloudActive.questionKind, reason: "云端保存了未完成进度" }
      : recommendation;
  const startCurrent = active
    ? () => switchView("training")
    : cloudActive ? resumeCloudSession : () => startQuestion(current.questionId);
  return panel(
    completed.length >= 3 ? "今日基础训练完成，还可以继续" : "今天继续练一题",
    `今日已完成 ${completed.length} 题`,
    [
    paragraph("题目会在新题、关系题和旧卡点复习之间动态选择；三题是基础量，不是上限。", "lead"),
    current ? node("div", { className: "today-list" }, [node("article", { className: "today-card status-active" }, [
      node("div", { className: "today-card-meta" }, [
        node("span", { text: active || cloudActive ? "继续未完成" : kindLabel }),
        node("b", { text: active || cloudActive ? "进行中" : "为你推荐" })
      ]),
      node("h2", { text: current.question }),
      paragraph(current.reason || "根据近期训练情况推荐", "field-hint"),
      !active && !cloudActive ? paragraph(sourceBasisCopy(current), "field-hint source-basis") : null,
      button(active || cloudActive ? "继续这道题" : "开始这道题", startCurrent, active || cloudActive ? "secondary" : "primary")
    ])]) : node("div", { className: "empty-state" }, [
      node("h2", { text: busy ? "正在选择下一题……" : "下一题还没有准备好" }),
      errorNode(),
      !busy ? button("重新获取推荐", () => loadRecommendation(), "secondary") : null
    ]),
    historyEntries().length ? button("查看全部答题历史", () => switchView("history"), "text") : null
  ], "dashboard-panel");
}


function renderHistory() {
  const groups = groupHistoryByDate(historyEntries());
  const dates = Object.keys(groups).sort().reverse();
  return panel("答题历史", "你的表达档案", [
    paragraph("这里保存每次训练的初答、卡点、最终表达和 AI 补充；云端记录会和本机副本合并。", "lead"),
    dates.length ? node("div", { className: "history-groups" }, dates.map((date) => node("section", { className: "history-group" }, [
      node("h2", { text: date === localDateKey() ? "今天" : date }),
      ...groups[date].map((entry) => node("button", {
        type: "button",
        className: "history-entry",
        onClick: () => openHistoryEntry(entry.sessionId)
      }, [
        node("span", { text: entry.question || "未命名题目" }),
        node("small", { text: entry.finalExpression ? "已有最终表达" : "已完成复述" })
      ]))
    ]))) : node("div", { className: "empty-state" }, [
      node("h2", { text: "还没有完成记录" }),
      paragraph("完成第一道题后，你的表达笔记会出现在这里。"),
      button("去今日训练", () => switchView("today"))
    ])
  ], "dashboard-panel");
}


function renderHistoryDetail() {
  const entry = historyEntries().find((item) => item.sessionId === state.selectedHistoryId);
  if (!entry) return panel("这条记录没有找到", "答题历史", [
    button("返回答题历史", () => switchView("history"), "secondary")
  ]);
  return panel("这一题的表达笔记", entry.completedDate || "已完成", [
    node("div", { className: "detail-toolbar" }, [
      button("返回答题历史", () => switchView("history"), "text"),
      button("返回今日题单", () => switchView("today"), "text")
    ]),
    expressionNoteView(entry.expressionNote)
  ], "dashboard-panel");
}


function renderProfile() {
  const history = historyEntries();
  const profile = state.learningProfile || {};
  const storageCopy = {
    "cloudbase+feishu": "CloudBase 主库 · 飞书镜像",
    cloudbase: "CloudBase 主库",
    feishu: "飞书直接记录 · 跨设备历史未开启",
    memory: "本地演示记录",
    unknown: "正在确认云端状态"
  }[state.storageMode] || "正在确认云端状态";
  return panel("我的学习档案", state.syncStatus === "synced" ? "云端已同步" : "本机副本", [
    node("div", { className: "profile-stats" }, [
      node("div", {}, [node("strong", { text: String(history.length) }), paragraph("已完成题目")]),
      node("div", {}, [node("strong", { text: String(profile.dueCount || 0) }), paragraph("待复习")]),
      node("div", {}, [node("strong", { text: String(profile.unstableCount || 0) }), paragraph("需要再练")])
    ]),
    node("section", { className: "profile-note" }, [
      node("h2", { text: "现在保存了什么" }),
      paragraph("每题的第一次表达、结构化卡点、教学干预、最终改写、掌握状态和下次复习时间。"),
      paragraph(`当前存储：${storageCopy}。完整对话保存在训练记录中，个人档案只提取后续出题真正需要的判断。`, "field-hint")
    ]),
    profile.recentWeaknesses?.length ? node("section", { className: "profile-note" }, [
      node("h2", { text: "最近卡点" }),
      ...profile.recentWeaknesses.map((item) => node("div", { className: "history-entry" }, [
        node("span", { text: `${item.thinker ? `${item.thinker} · ` : ""}${item.topic}` }),
        paragraph(item.summary || "等待下一次复习验证"),
        node("small", { text: `${item.status}${item.reviewAt ? ` · 下次复习 ${String(item.reviewAt).slice(0, 10)}` : ""}` })
      ]))
    ]) : null,
    button("回到今日训练", () => switchView("today"))
  ], "dashboard-panel");
}


function trainingToolbar() {
  return node("div", { className: "training-toolbar" }, [
    button("返回今日题单", () => switchView("today"), "text"),
    node("span", { text: `今日已完成 ${state.todayCompleted || todayHistory().length} 题 · ${{ new: "新题", relation: "关系题", review: "复习题" }[state.questionKind] || "训练题"}` })
  ]);
}


function renderConversation() {
  return node("section", { className: "panel conversation-panel" }, [
    trainingToolbar(),
    questionCard(true, true),
    conversationLog(),
    currentComposer()
  ]);
}


function render() {
  const previousStage = renderedStage;
  const previousView = renderedView;
  const previousScrollY = window.scrollY;
  const scrollTarget = state.scrollTarget;
  const isTraining = state.view === "training";
  setProgress();
  updateNavigation();
  const content = state.view === "training" ? renderConversation()
    : state.view === "history" ? renderHistory()
      : state.view === "history-detail" ? renderHistoryDetail()
        : state.view === "profile" ? renderProfile()
          : renderToday();
  appRoot.replaceChildren(...[coachModeNotice(), content].filter(Boolean));
  renderedStage = state.stage;
  renderedView = state.view;
  requestAnimationFrame(() => {
    const target = scrollTarget === "pending-student"
      ? appRoot.querySelector(".message-pending")
      : scrollTarget === "latest-feedback"
        ? appRoot.querySelector(".message-latest .feedback-conclusion")
        : null;
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "auto" });
      state.scrollTarget = null;
      saveState();
    } else if (previousView === "training" && isTraining && previousStage) {
      window.scrollTo({ top: previousScrollY, behavior: "auto" });
    } else if (previousView && previousView !== state.view) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  });
}


setInterval(() => {
  if (!state.startedAt || ["intro", "complete"].includes(state.stage)) return;
  const elapsedMinutes = (Date.now() - Date.parse(state.startedAt)) / 60000;
  if (elapsedMinutes > 40 && !document.querySelector("#time-notice")) {
    const notice = node("div", {
      id: "time-notice",
      className: "notice",
      text: "你已经思考了较长时间。可以随时暂停；是否继续只看你有没有完成当前动作。"
    });
    appRoot.querySelector(".conversation-log")?.before(notice);
  }
}, 30000);

for (const item of navButtons) {
  item.addEventListener("click", () => switchView(item.dataset.appView));
}

render();
apiGet("/api/health")
  .then((result) => {
    state.coachMode = result.coachMode === "real" ? "real" : "demo";
    state.storageMode = result.storageMode || "unknown";
    saveState();
    render();
  })
  .catch(() => {
    state.coachMode = "unknown";
  });
apiGet("/api/questions")
  .then((result) => {
    questions = Array.isArray(result.questions) ? result.questions : [];
    render();
    return syncLearnerData().then(() => loadRecommendation());
  })
  .catch((error) => {
    errorState = { message: error.message, retryable: true, preserved: false };
    render();
  });
