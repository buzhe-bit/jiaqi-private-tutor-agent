const { mergeHistory, readHistory } = require("../../utils/storage.js");
const { dateLabel } = require("../../utils/format.js");

Page({
  data: { entries: [], selected: null },
  onShow() {
    const app = getApp();
    const local = readHistory(app.globalData.storage);
    const cloud = app.globalData.cloudProfile?.sessions || [];
    const entries = mergeHistory(local, cloud).map((item) => ({ ...item, date: dateLabel(item.completedAt) }));
    this.setData({ entries, selected: null });
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
