const { mergeHistory, readHistory } = require("../../utils/storage.js");
const { bindLearnerIdentity } = require("../../core/dashboard.js");
const { dateLabel } = require("../../utils/format.js");
const { normalizeInviteCode } = require("../../utils/storage.js");

Page({
  data: { entries: [], selected: null, loading: true, error: "" },
  onShow() {
    return this.refresh();
  },
  async refresh() {
    const app = getApp();
    const inviteVersion = app.globalData.inviteVersion || 0;
    this.setData({ entries: [], selected: null, loading: true, error: "" });
    if (app.globalData.config.mode === "cloudbase") {
      // Keep the previous account's unfinished session hidden while identity
      // sync is in flight, even if the user switches tabs immediately.
      app.globalData.activeSession = null;
    }
    const inviteCode = normalizeInviteCode(app.globalData.config.inviteCode);
    if (!inviteCode) {
      app.globalData.cloudProfile = null;
      app.globalData.participantCode = null;
      app.globalData.storage?.unbindParticipant?.();
      this.setData({ loading: false, entries: [], selected: null, error: "请输入试用码后查看答题历史" });
      return;
    }
    try {
      // A history render is identity-gated. Reading local storage first would
      // briefly expose the previous WeChat account on a shared device.
      const sync = await app.globalData.api.post("/api/learner/sync", {
        inviteCode
      });
      if ((app.globalData.inviteVersion || 0) !== inviteVersion) return;
      const identity = bindLearnerIdentity(app, sync);
      if (!identity.ready) {
        throw Object.assign(new Error("身份还没有验证，暂时无法打开答题历史"), {
          code: "IDENTITY_NOT_READY",
          retryable: true
        });
      }
      app.globalData.cloudProfile = sync;
      const local = readHistory(app.globalData.storage);
      const cloud = sync.sessions || [];
      const entries = mergeHistory(local, cloud)
        .map((item) => ({ ...item, date: dateLabel(item.completedAt) }));
      this.setData({ entries, selected: null, loading: false, error: "" });
    } catch (error) {
      if ((app.globalData.inviteVersion || 0) !== inviteVersion) return;
      const statusCode = Number(error?.statusCode || error?.status || 0);
      if (statusCode === 401 || statusCode === 403) {
        const clear = app.clearInviteCode || app.globalData.clearInviteCode;
        if (typeof clear === "function") clear();
        else app.globalData.config.inviteCode = "";
      }
      if (app.globalData.config.mode === "cloudbase") {
        app.globalData.activeSession = null;
        app.globalData.cloudProfile = null;
        app.globalData.participantCode = null;
        app.globalData.storage?.unbindParticipant?.();
      }
      this.setData({
        entries: [],
        selected: null,
        loading: false,
        error: error.message || "答题历史暂时无法同步"
      });
    }
  },
  open(event) {
    const selected = this.data.entries.find((item) => item.sessionId === event.currentTarget.dataset.id);
    this.setData({ selected });
  },
  close() { this.setData({ selected: null }); },
  copyFinal() {
    wx.setClipboardData({ data: this.data.selected?.expressionNote?.finalExpression || this.data.selected?.finalExpression || "" });
  },
  copyReference() {
    wx.setClipboardData({ data: this.data.selected?.expressionNote?.possibleAnswer || "" });
  }
});
