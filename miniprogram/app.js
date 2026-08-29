const config = require("./config.js");
const { createApi } = require("./services/api.js");
const { createDemoAdapter } = require("./services/demo-adapter.js");
const { track } = require("./utils/telemetry.js");
const {
  clearInviteCode,
  createStorage,
  normalizeInviteCode,
  readInviteCode,
  saveInviteCode
} = require("./utils/storage.js");

function clearIdentityState(globalData) {
  globalData.recommendation = null;
  globalData.activeSession = null;
  globalData.cloudProfile = null;
  globalData.participantCode = null;
}

App({
  onLaunch() {
    const wxApi = wx;
    const runtimeConfig = { ...config };
    const publicTransport = runtimeConfig.transport === "public" || runtimeConfig.transport === "wx-request";
    if (runtimeConfig.mode === "cloudbase" && !publicTransport && wxApi.cloud) {
      wxApi.cloud.init({ env: runtimeConfig.cloudbaseEnv });
    }
    runtimeConfig.inviteCode = publicTransport
      ? readInviteCode(wxApi, runtimeConfig.inviteCode)
      : normalizeInviteCode(runtimeConfig.inviteCode);
    this.globalData.config = runtimeConfig;
    this.globalData.inviteCode = runtimeConfig.inviteCode;
    this.globalData.inviteVersion = (this.globalData.inviteVersion || 0) + 1;
    this.globalData.storage = createStorage(wxApi, runtimeConfig.inviteCode, { mode: runtimeConfig.mode });
    // CloudBase storage remains sealed until /api/learner/sync returns the
    // anonymous participantCode. Local demo mode is intentionally invite-code
    // scoped and may restore its own unfinished session immediately.
    const storedSession = runtimeConfig.mode === "cloudbase"
      ? null
      : this.globalData.storage.get("active-session", null);
    this.globalData.demoAdapter = createDemoAdapter({
      sessions: storedSession?.sessionToken ? [storedSession] : []
    });
    this.globalData.api = createApi({
      wxApi,
      config: runtimeConfig,
      demoAdapter: this.globalData.demoAdapter
    });

    const setInvite = (value) => {
      const next = normalizeInviteCode(value);
      if (!next) return "";
      saveInviteCode(wxApi, next);
      this.globalData.storage?.unbindParticipant?.();
      runtimeConfig.inviteCode = next;
      this.globalData.inviteCode = next;
      this.globalData.storage = createStorage(wxApi, next, { mode: runtimeConfig.mode });
      this.globalData.inviteVersion = (this.globalData.inviteVersion || 0) + 1;
      clearIdentityState(this.globalData);
      return next;
    };
    const clearInvite = () => {
      clearInviteCode(wxApi);
      this.globalData.storage?.unbindParticipant?.();
      runtimeConfig.inviteCode = "";
      this.globalData.inviteCode = "";
      this.globalData.storage = createStorage(wxApi, "", { mode: runtimeConfig.mode });
      this.globalData.inviteVersion = (this.globalData.inviteVersion || 0) + 1;
      clearIdentityState(this.globalData);
      return true;
    };
    this.setInviteCode = setInvite;
    this.clearInviteCode = clearInvite;
    // Keep the tiny API available from both getApp() and globalData so pages
    // can remain easy to test without introducing a settings subsystem.
    this.globalData.setInviteCode = setInvite;
    this.globalData.clearInviteCode = clearInvite;
  },
  onShow() { track(this, "app_open", { page: "app" }); },
  onHide() { track(this, "app_hidden", { page: "app" }); },
  globalData: {
    config,
    inviteCode: "",
    api: null,
    storage: null,
    demoAdapter: null,
    recommendation: null,
    activeSession: null,
    cloudProfile: null,
    participantCode: null,
    inviteVersion: 0,
    setInviteCode: null,
    clearInviteCode: null
  }
});
