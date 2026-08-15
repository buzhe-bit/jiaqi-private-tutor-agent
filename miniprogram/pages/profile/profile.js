const { bindLearnerIdentity } = require("../../core/dashboard.js");
const { normalizeInviteCode } = require("../../utils/storage.js");

Page({
  data: { completed: 0, due: 0, unstable: 0, weaknesses: [], modeLabel: "本地演示档案", error: "" },
  onShow() { this.refresh(); },
  async refresh() {
    const app = getApp();
    app.globalData.activeSession = null;
    const inviteVersion = app.globalData.inviteVersion || 0;
    this.setData({ completed: 0, due: 0, unstable: 0, weaknesses: [], error: "" });
    const inviteCode = normalizeInviteCode(app.globalData.config.inviteCode);
    if (!inviteCode) {
      app.globalData.cloudProfile = null;
      app.globalData.participantCode = null;
      app.globalData.storage?.unbindParticipant?.();
      this.setData({ modeLabel: "请输入试用码后查看学习档案", error: "请输入试用码后查看学习档案" });
      return;
    }
    try {
      const sync = await app.globalData.api.post("/api/learner/sync", { inviteCode });
      if ((app.globalData.inviteVersion || 0) !== inviteVersion) return;
      const identity = bindLearnerIdentity(app, sync);
      if (!identity.ready) {
        throw Object.assign(new Error("身份还没有验证，暂时无法打开学习档案"), {
          code: "IDENTITY_NOT_READY",
          retryable: true
        });
      }
      app.globalData.cloudProfile = sync;
      const profile = sync.profile || {};
      this.setData({
        completed: profile.completedCount ?? (sync.sessions || []).filter((item) => item.stage === "complete").length,
        due: profile.dueCount || 0,
        unstable: profile.unstableCount || 0,
        weaknesses: profile.recentWeaknesses || [],
        modeLabel: app.globalData.config.mode === "cloudbase" ? "云端学习档案" : "本地演示档案",
        error: ""
      });
    } catch (error) {
      if ((app.globalData.inviteVersion || 0) !== inviteVersion) return;
      const statusCode = Number(error?.statusCode || error?.status || 0);
      if (statusCode === 401 || statusCode === 403) {
        const clear = app.clearInviteCode || app.globalData.clearInviteCode;
        if (typeof clear === "function") clear();
        else app.globalData.config.inviteCode = "";
        app.globalData.storage?.unbindParticipant?.();
        app.globalData.activeSession = null;
        app.globalData.cloudProfile = null;
        app.globalData.participantCode = null;
      }
      app.globalData.cloudProfile = null;
      app.globalData.activeSession = null;
      app.globalData.participantCode = null;
      app.globalData.storage?.unbindParticipant?.();
      this.setData({ modeLabel: error.message || "档案暂未同步", error: error.message || "档案暂未同步" });
    }
  }
});
