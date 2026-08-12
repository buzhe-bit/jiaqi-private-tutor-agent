const {
  applyStepResult,
  beginRequest,
  createTrainingState,
  failRequest,
  requestPayload
} = require("../../core/session.js");
const { archiveSession, saveDraft } = require("../../utils/storage.js");
const { kindLabel, splitParagraphs, stageMeta } = require("../../utils/format.js");
const { clampCoachPosition, defaultCoachPosition } = require("../../core/floating-coach.js");

const STAGE_ORDER = ["attempt", "teaching", "restate", "revision"];

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
    coachX: 306,
    coachY: 626
  },

  onLoad() {
    const app = getApp();
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
    if (this.data.busy) return;
    if (["submit_attempt", "submit_restate", "submit_revision", "ask_followup"].includes(request.action)
      && !String(request.input || "").trim()) {
      wx.showToast({ title: "先写下你现在真实能说出的内容", icon: "none" });
      return;
    }
    const app = getApp();
    this.state = beginRequest(this.state, request);
    this.persist();
    this.refreshView();
    try {
      const result = await app.globalData.api.post("/api/session/step", requestPayload(this.state, request));
      this.state = applyStepResult(this.state, result, request);
      if (this.state.stage === "complete") {
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
      this.state = failRequest(this.state, error);
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
    this.state.stage = "restate";
    this.state.draft = this.state.snapshot.repairResponse || "";
    this.persist();
    this.refreshView();
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

  async nextQuestion() {
    const app = getApp();
    this.setData({ busy: true });
    try {
      const recommendation = await app.globalData.api.post("/api/practice/next", {
        inviteCode: app.globalData.config.inviteCode
      });
      const session = await app.globalData.api.post("/api/session/start", {
        inviteCode: app.globalData.config.inviteCode,
        consent: true,
        questionId: recommendation.questionId,
        sourceExcerpt: ""
      });
      this.state = createTrainingState(session);
      this.state.messages = [{ role: "coach", message: "新的一题已经准备好。先写你现在会的，不必追求完整。" }];
      app.globalData.recommendation = recommendation;
      this.persist();
      this.refreshView({ coachOpen: false, followupDraft: "" });
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    } catch (error) {
      this.state = failRequest(this.state, error);
      this.refreshView();
    }
  },

  backToToday() {
    wx.switchTab({ url: "/pages/today/today" });
  }
});

module.exports = { viewModel, visibleMessages };
