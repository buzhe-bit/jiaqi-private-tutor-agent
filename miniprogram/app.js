const config = require("./config.js");
const { createApi } = require("./services/api.js");
const { createDemoAdapter } = require("./services/demo-adapter.js");
const { createStorage } = require("./utils/storage.js");

App({
  onLaunch() {
    if (config.mode === "cloudbase" && wx.cloud) {
      wx.cloud.init({ env: config.cloudbaseEnv });
    }
    this.globalData.storage = createStorage(wx, config.inviteCode, { mode: config.mode });
    // CloudBase storage remains sealed until /api/learner/sync returns the
    // anonymous participantCode. Local demo mode is intentionally invite-code
    // scoped and may restore its own unfinished session immediately.
    const storedSession = config.mode === "cloudbase"
      ? null
      : this.globalData.storage.get("active-session", null);
    this.globalData.demoAdapter = createDemoAdapter({
      sessions: storedSession?.sessionToken ? [storedSession] : []
    });
    this.globalData.api = createApi({
      wxApi: wx,
      config,
      demoAdapter: this.globalData.demoAdapter
    });
  },
  globalData: {
    config,
    api: null,
    storage: null,
    demoAdapter: null,
    recommendation: null,
    activeSession: null,
    cloudProfile: null,
    participantCode: null
  }
});
