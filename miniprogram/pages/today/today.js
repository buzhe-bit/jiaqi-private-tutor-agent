const { kindLabel } = require("../../utils/format.js");

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
    this.setData({ loading: true, error: "", mode: app.globalData.config.mode });
    try {
      const [health, sync, recommendation] = await Promise.all([
        app.globalData.api.get("/api/health"),
        app.globalData.api.post("/api/learner/sync", { inviteCode: app.globalData.config.inviteCode }),
        app.globalData.api.post("/api/practice/next", { inviteCode: app.globalData.config.inviteCode })
      ]);
      app.globalData.cloudProfile = sync;
      app.globalData.recommendation = recommendation;
      const active = sync.sessions?.find((item) => item.stage !== "complete") || app.globalData.activeSession;
      if (active) app.globalData.activeSession = active;
      this.setData({
        loading: false,
        modeLabel: health.coachMode === "real" ? "真实私教：当前回答由云端 DeepSeek 生成" : "本地演示：回答为固定样例，不会写入线上档案",
        recommendation,
        kindLabel: kindLabel(active?.questionKind || recommendation.questionKind),
        completed: recommendation.todayCompleted || 0,
        baseReached: recommendation.baseTargetReached === true,
        active: Boolean(active)
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "下一题还没有准备好" });
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
