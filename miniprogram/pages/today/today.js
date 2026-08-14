const { kindLabel } = require("../../utils/format.js");
const { bindLearnerIdentity, selectActiveSession, todayCard } = require("../../core/dashboard.js");

Page({
  data: {
    loading: true,
    error: "",
    mode: "local-demo",
    modeLabel: "本地演示：回答为固定样例，不会写入线上档案",
    recommendation: null,
    kindLabel: "推荐题",
    completed: 0,
    baseReached: false,
    active: false
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    const app = getApp();
    this.setData({
      loading: true,
      error: "",
      mode: app.globalData.config.mode,
      recommendation: null,
      active: false
    });
    if (app.globalData.config.mode === "cloudbase") {
      // Do not leave the previous account's in-memory card visible while a
      // fresh identity sync is pending.
      app.globalData.activeSession = null;
    }
    try {
      // Identity must be established before any participant-owned local data
      // (including an unfinished active session) can be read.
      const sync = await app.globalData.api.post("/api/learner/sync", {
        inviteCode: app.globalData.config.inviteCode
      });
      const identity = bindLearnerIdentity(app, sync);
      if (!identity.ready) {
        throw Object.assign(new Error("身份还没有验证，暂时无法打开训练"), {
          code: "IDENTITY_NOT_READY",
          retryable: true
        });
      }
      const [health, recommendation] = await Promise.all([
        app.globalData.api.get("/api/health"),
        app.globalData.api.post("/api/practice/next", { inviteCode: app.globalData.config.inviteCode })
      ]);
      app.globalData.cloudProfile = sync;
      app.globalData.recommendation = recommendation;
      // The fallback is limited to the identity-bound namespace selected by
      // bindLearnerIdentity; never use a stale global active from another user.
      const active = selectActiveSession(sync.sessions || []) || identity.activeSession || null;
      app.globalData.activeSession = active;
      const card = todayCard(recommendation, active);
      this.setData({
        loading: false,
        modeLabel: health.coachMode === "real" ? "真实私教：当前回答由云端 DeepSeek 生成" : "本地演示：回答为固定样例，不会写入线上档案",
        recommendation: card,
        kindLabel: kindLabel(card.questionKind),
        completed: recommendation.todayCompleted || 0,
        baseReached: recommendation.baseTargetReached === true,
        active: card.active
      });
    } catch (error) {
      if (app.globalData.config.mode === "cloudbase") {
        app.globalData.activeSession = null;
        app.globalData.cloudProfile = null;
        app.globalData.participantCode = null;
        app.globalData.storage?.unbindParticipant?.();
      }
      this.setData({
        loading: false,
        recommendation: null,
        active: false,
        error: error.message || "下一题还没有准备好"
      });
    }
  },

  async start() {
    const app = getApp();
    if (app.globalData.activeSession?.stage && app.globalData.activeSession.stage !== "complete") {
      wx.navigateTo({ url: "/pages/training/training" });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const session = await app.globalData.api.post("/api/session/start", {
        inviteCode: app.globalData.config.inviteCode,
        consent: true,
        questionId: this.data.recommendation.questionId,
        sourceExcerpt: ""
      });
      app.globalData.activeSession = session;
      app.globalData.storage.set("active-session", session);
      wx.navigateTo({ url: "/pages/training/training" });
    } catch (error) {
      this.setData({ loading: false, error: error.message });
    }
  }
});
