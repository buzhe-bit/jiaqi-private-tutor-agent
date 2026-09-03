const {
  applyStepResult,
  beginRequest,
  createTrainingState,
  failRequest,
  requestPayload
} = require("../../core/session.js");
const { archiveSession, normalizeInviteCode, saveDraft } = require("../../utils/storage.js");
const { kindLabel, splitParagraphs, stageMeta } = require("../../utils/format.js");
const { clampCoachPosition, defaultCoachPosition } = require("../../core/floating-coach.js");
const { track } = require("../../utils/telemetry.js");
const { isInviteError } = require("../../utils/invite-error.js");

const STAGE_ORDER = ["attempt", "teaching", "restate", "revision"];

function clearIdentity(app, clearCode = true) {
  if (clearCode) {
    const clear = app.clearInviteCode || app.globalData.clearInviteCode;
    if (typeof clear === "function") {
      clear();
    } else app.globalData.config.inviteCode = "";
  }
  app.globalData.storage?.unbindParticipant?.();
  app.globalData.activeSession = null;
  app.globalData.cloudProfile = null;
  app.globalData.participantCode = null;
  app.globalData.recommendation = null;
}

function returnToToday() {
  if (typeof wx !== "undefined" && typeof wx.switchTab === "function") {
    wx.switchTab({ url: "/pages/today/today" });
  }
}

function visibleMessages(messages = []) {
  let latestCoach = -1;
  messages.forEach((item, index) => {
    if (item.role === "coach") latestCoach = index;
  });
  return messages.map((item, index) => ({
    ...item,
    id: `${item.role}-${index}`,
    latest: item.role === "coach" && index === latestCoach,
    paragraphs: splitParagraphs(item.message),
    teachingParagraphs: splitParagraphs(item.teaching)
  }));
}

function viewModel(state, mode) {
  const meta = stageMeta(state.stage);
  return {
    state,
    stage: state.stage,
    draft: state.draft,
    step: meta.step,
    stageTitle: meta.title,
    completion: meta.completion,
    steps: STAGE_ORDER.map((stage, index) => ({
      label: stageMeta(stage).title,
      status: index + 1 < meta.step ? "done" : (index + 1 === meta.step ? "current" : "pending")
    })),
    kind: kindLabel(state.questionKind),
    messages: visibleMessages(state.messages),
    busy: state.request?.phase === "loading",
    saved: state.request?.phase === "loading" || state.request?.phase === "done",
    error: state.error,
    modeLabel: mode === "cloudbase" ? "真实私教" : "本地演示",
    plumClass: `plum-step-${meta.step}`,
    expressionNote: state.expressionNote,
    answerStructure: state.expressionNote?.answerStructure || []
  };
}

function resetVisibleState(page, app, error) {
  page.state = failRequest(createTrainingState({ stage: "attempt" }), error);
  page.setData({
    ...viewModel(page.state, app.globalData.config.mode),
    followupDraft: "",
    coachOpen: false,
    questionOpen: false
  });
}

Page({
  data: {
    stage: "attempt",
    draft: "",
    followupDraft: "",
    coachOpen: false,
    state: {},
    steps: [],
    messages: [],
    busy: false,
    error: null,
    expressionNote: null,
    answerStructure: [],
    questionOpen: false,
    feedbackThanks: "",
    coachX: 306,
    coachY: 626
  },

  onLoad() {
    const app = getApp();
    this.inviteVersion = app.globalData.inviteVersion || 0;
    if (!normalizeInviteCode(app.globalData.config.inviteCode)) {
      clearIdentity(app, false);
      if (typeof wx !== "undefined") wx.showToast?.({ title: "请先输入试用码", icon: "none" });
      returnToToday();
      return;
    }
    const stored = app.globalData.storage.get("active-session", null);
    const session = app.globalData.activeSession || stored;
    if (!session) {
      wx.showToast({ title: "请先选择一道题", icon: "none" });
      wx.navigateBack();
      return;
    }
    this.state = createTrainingState(session);
    if (!this.state.messages.length) {
      this.state.messages = [{
        role: "coach",
        message: "先别查答案，直接写你现在会的。写“不知道”也可以，它只是在记录你的真实起点。"
      }];
    }
    const viewport = this.viewport();
    const savedPosition = app.globalData.storage.get("coach-position", defaultCoachPosition(viewport));
    const position = clampCoachPosition(savedPosition, viewport);
    this.refreshView({
      questionOpen: this.state.stage === "attempt",
      coachX: position.x,
      coachY: position.y
    });
    track(app, "page_view", {
      page: "training",
      sessionId: this.state.sessionId,
      questionId: this.state.questionId,
      stage: this.state.stage
    });
    if (this.state.stage !== "attempt") {
      track(app, "session_resumed", {
        page: "training",
        sessionId: this.state.sessionId,
        questionId: this.state.questionId,
        stage: this.state.stage
      });
    }
  },

  viewport() {
    if (wx.getWindowInfo) {
      const info = wx.getWindowInfo();
      return { width: info.windowWidth, height: info.windowHeight };
    }
    const info = wx.getSystemInfoSync();
    return { width: info.windowWidth, height: info.windowHeight };
  },

  onUnload() {
    track(getApp(), "app_hidden", {
      page: "training",
      sessionId: this.state?.sessionId,
      questionId: this.state?.questionId,
      stage: this.state?.stage,
      draftLength: String(this.state?.draft || "").length
    });
    this.persist();
  },

  refreshView(extra = {}, callback) {
    const app = getApp();
    this.setData({ ...viewModel(this.state, app.globalData.config.mode), ...extra }, callback);
  },

  scrollToLatestFeedback() {
    wx.nextTick(() => {
      const query = wx.createSelectorQuery();
      query.select("#latest-feedback").boundingClientRect();
      query.selectViewport().scrollOffset();
      query.exec((result = []) => {
        const target = result[0];
        const viewport = result[1];
        if (!target || !viewport) return;
        wx.pageScrollTo({
          scrollTop: Math.max(0, viewport.scrollTop + target.top - 180),
          duration: 220
        });
      });
    });
  },

  persist() {
    const app = getApp();
    if ((app.globalData.inviteVersion || 0) !== this.inviteVersion) return;
    app.globalData.activeSession = { ...this.state };
    app.globalData.storage.set("active-session", { ...this.state });
    saveDraft(app.globalData.storage, { stage: this.state.stage, value: this.state.draft });
  },

  onDraft(event) {
    this.state.draft = event.detail.value;
    this.setData({ draft: event.detail.value });
    this.persist();
  },

  onFollowup(event) {
    this.setData({ followupDraft: event.detail.value });
  },

  async run(request) {
    const app = getApp();
    const inviteCode = normalizeInviteCode(app.globalData.config.inviteCode);
    const inviteVersion = this.inviteVersion ?? (app.globalData.inviteVersion || 0);
    this.inviteVersion = inviteVersion;
    if (!inviteCode || (app.globalData.inviteVersion || 0) !== inviteVersion) {
      clearIdentity(app, false);
      resetVisibleState(this, app, new Error("请先输入试用码"));
      returnToToday();
      return;
    }
    if (this.data.busy) return;
    if (["submit_attempt", "submit_restate", "submit_revision", "ask_followup"].includes(request.action)
      && !String(request.input || "").trim()) {
      wx.showToast({ title: "先写下你现在真实能说出的内容", icon: "none" });
      return;
    }
    this.state = beginRequest(this.state, request);
    const requestedStage = this.state.stage;
    const startedAt = Date.now();
    const eventName = request.action.startsWith("request_") || request.action === "ask_followup"
      ? "help_used"
      : "answer_submitted";
    track(app, eventName, {
      page: "training",
      sessionId: this.state.sessionId,
      questionId: this.state.questionId,
      stage: requestedStage,
      action: request.action,
      draftLength: String(request.input || "").length
    });
    this.persist();
    this.refreshView();
    try {
      const result = await app.globalData.api.post("/api/session/step", requestPayload(this.state, request));
      if ((app.globalData.inviteVersion || 0) !== inviteVersion) {
        resetVisibleState(this, app, new Error("试用码已切换"));
        returnToToday();
        return;
      }
      this.state = applyStepResult(this.state, result, request);
      track(app, "ai_response_completed", {
        page: "training",
        sessionId: this.state.sessionId,
        questionId: this.state.questionId,
        stage: this.state.stage,
        action: request.action,
        durationMs: Date.now() - startedAt
      });
      if (this.state.stage !== requestedStage) {
        track(app, "stage_changed", {
          page: "training",
          sessionId: this.state.sessionId,
          questionId: this.state.questionId,
          stage: this.state.stage,
          value: `${requestedStage}->${this.state.stage}`
        });
      }
      if (this.state.stage === "complete") {
        track(app, "training_completed", {
          page: "training",
          sessionId: this.state.sessionId,
          questionId: this.state.questionId,
          stage: "complete"
        });
        const completedAt = new Date().toISOString();
        archiveSession(app.globalData.storage, {
          sessionId: this.state.sessionId,
          questionId: this.state.questionId,
          question: this.state.question,
          questionKind: this.state.questionKind,
          completedAt,
          initialExpression: this.state.snapshot.initialAnswer || "",
          finalExpression: this.state.snapshot.rewrittenAnswer || this.state.snapshot.repairResponse || "",
          expressionNote: this.state.expressionNote
        });
        app.globalData.activeSession = null;
      }
      this.persist();
      this.refreshView({
        followupDraft: request.action === "ask_followup" ? "" : this.data.followupDraft,
        coachOpen: request.action === "ask_followup" ? false : this.data.coachOpen
      }, () => this.scrollToLatestFeedback());
    } catch (error) {
      if ((app.globalData.inviteVersion || 0) !== inviteVersion) {
        resetVisibleState(this, app, new Error("试用码已切换"));
        returnToToday();
        return;
      }
      if (isInviteError(error)) {
        clearIdentity(app);
        resetVisibleState(this, app, error);
        returnToToday();
        return;
      }
      this.state = failRequest(this.state, error);
      track(app, "ai_response_failed", {
        page: "training",
        sessionId: this.state.sessionId,
        questionId: this.state.questionId,
        stage: this.state.stage,
        action: request.action,
        durationMs: Date.now() - startedAt,
        errorCode: error.code || error.statusCode || "UNKNOWN"
      });
      this.persist();
      this.refreshView();
    }
  },

  submitMain() {
    const actions = {
      attempt: "submit_attempt",
      restate: "submit_restate",
      revision: "submit_revision"
    };
    return this.run({ action: actions[this.state.stage], input: this.state.draft });
  },

  requestHelp(event) {
    return this.run({ action: event.currentTarget.dataset.action, input: "" });
  },

  enterRestate() {
    const previousStage = this.state.stage;
    this.state.stage = "restate";
    this.state.draft = this.state.snapshot.repairResponse || "";
    this.persist();
    this.refreshView();
    track(getApp(), "stage_changed", {
      page: "training",
      sessionId: this.state.sessionId,
      questionId: this.state.questionId,
      stage: "restate",
      value: `${previousStage}->restate`
    });
  },

  toggleCoach() {
    this.setData({ coachOpen: !this.data.coachOpen });
  },

  toggleQuestion() {
    this.setData({ questionOpen: !this.data.questionOpen });
  },

  onCoachMove(event) {
    if (event.detail.source !== "touch") return;
    this.coachPosition = clampCoachPosition(event.detail, this.viewport());
  },

  onCoachTouchStart(event) {
    const touch = event.touches?.[0] || {};
    this.coachTouchStart = { x: touch.clientX || 0, y: touch.clientY || 0 };
    this.coachDragged = false;
  },

  onCoachTouchEnd(event) {
    const touch = event.changedTouches?.[0] || {};
    const start = this.coachTouchStart || { x: touch.clientX || 0, y: touch.clientY || 0 };
    this.coachDragged = Math.hypot((touch.clientX || 0) - start.x, (touch.clientY || 0) - start.y) > 8;
    if (this.coachPosition) {
      this.setData({ coachX: this.coachPosition.x, coachY: this.coachPosition.y });
      getApp().globalData.storage.set("coach-position", this.coachPosition);
    }
  },

  openCoachFromFab() {
    if (this.coachDragged) {
      this.coachDragged = false;
      return;
    }
    this.setData({ coachOpen: true });
  },

  noop() {},

  askCoach() {
    const input = this.data.followupDraft;
    this.run({ action: "ask_followup", input });
  },

  retry() {
    const request = this.state.request;
    if (!request?.action) return;
    this.run({ action: request.action, input: request.input || "" });
  },

  copyFinal() {
    wx.setClipboardData({ data: this.state.expressionNote?.finalExpression || "" });
  },

  copyReference() {
    wx.setClipboardData({ data: this.state.expressionNote?.possibleAnswer || "" });
  },

  rateFeedback(event) {
    const value = event.currentTarget.dataset.value;
    this.setData({ feedbackThanks: "谢谢，已经记下。" });
    track(getApp(), "feedback_submitted", {
      page: "training",
      sessionId: this.state.sessionId,
      questionId: this.state.questionId,
      stage: this.state.stage,
      value
    });
  },

  async nextQuestion() {
    const app = getApp();
    const inviteCode = normalizeInviteCode(app.globalData.config.inviteCode);
    const inviteVersion = this.inviteVersion ?? (app.globalData.inviteVersion || 0);
    this.inviteVersion = inviteVersion;
    if (!inviteCode || (app.globalData.inviteVersion || 0) !== inviteVersion) {
      clearIdentity(app, false);
      resetVisibleState(this, app, new Error("请先输入试用码"));
      returnToToday();
      return;
    }
    this.setData({ busy: true });
    try {
      const recommendation = await app.globalData.api.post("/api/practice/next", {
        inviteCode
      });
      if ((app.globalData.inviteVersion || 0) !== inviteVersion) {
        resetVisibleState(this, app, new Error("试用码已切换"));
        returnToToday();
        return;
      }
      const session = await app.globalData.api.post("/api/session/start", {
        inviteCode,
        consent: true,
        questionId: recommendation.questionId,
        sourceExcerpt: ""
      });
      if ((app.globalData.inviteVersion || 0) !== inviteVersion) {
        resetVisibleState(this, app, new Error("试用码已切换"));
        returnToToday();
        return;
      }
      this.state = createTrainingState(session);
      this.state.messages = [{ role: "coach", message: "新的一题已经准备好。先写你现在会的，不必追求完整。" }];
      app.globalData.recommendation = recommendation;
      this.persist();
      this.refreshView({ coachOpen: false, followupDraft: "" });
      track(app, "next_question_started", {
        page: "training",
        sessionId: session.sessionId,
        questionId: session.questionId,
        stage: session.stage
      });
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    } catch (error) {
      if ((app.globalData.inviteVersion || 0) !== inviteVersion) {
        resetVisibleState(this, app, new Error("试用码已切换"));
        returnToToday();
        return;
      }
      if (isInviteError(error)) {
        clearIdentity(app);
        resetVisibleState(this, app, error);
        returnToToday();
        return;
      }
      this.state = failRequest(this.state, error);
      this.refreshView();
    }
  },

  backToToday() {
    wx.switchTab({ url: "/pages/today/today" });
  }
});

module.exports = { viewModel, visibleMessages };
