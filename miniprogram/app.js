const config = require("./config.js");
const { createApi } = require("./services/api.js");
const { createDemoAdapter } = require("./services/demo-adapter.js");
const { createStorage } = require("./utils/storage.js");

App({
  onLaunch() {
    if (config.mode === "cloudbase" && wx.cloud) {
      wx.cloud.init({ env: config.cloudbaseEnv });
    }
    this.globalData.demoAdapter = createDemoAdapter();
    this.globalData.api = createApi({
      wxApi: wx,
      config,
      demoAdapter: this.globalData.demoAdapter
    });
    this.globalData.storage = createStorage(wx, config.inviteCode);
  },
  globalData: {
    config,
    api: null,
    storage: null,
    demoAdapter: null,
    recommendation: null,
    activeSession: null,
    cloudProfile: null
  }
});
