Page({
  data: { completed: 0, due: 0, unstable: 0, weaknesses: [], modeLabel: "本地演示档案" },
  onShow() { this.refresh(); },
  async refresh() {
    const app = getApp();
    try {
      const sync = await app.globalData.api.post("/api/learner/sync", { inviteCode: app.globalData.config.inviteCode });
      app.globalData.cloudProfile = sync;
      const profile = sync.profile || {};
      this.setData({
        completed: profile.completedCount ?? (sync.sessions || []).filter((item) => item.stage === "complete").length,
        due: profile.dueCount || 0,
        unstable: profile.unstableCount || 0,
        weaknesses: profile.recentWeaknesses || [],
        modeLabel: app.globalData.config.mode === "cloudbase" ? "云端学习档案" : "本地演示档案"
      });
    } catch (error) {
      this.setData({ modeLabel: error.message || "档案暂未同步" });
    }
  }
});
