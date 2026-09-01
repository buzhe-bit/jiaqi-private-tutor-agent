import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { bindLearnerIdentity } = require("../miniprogram/core/dashboard.js");
const { createTrainingState } = require("../miniprogram/core/session.js");

function wxMemory(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getStorageSync(key) { return values.get(key); },
    setStorageSync(key, value) { values.set(key, value); },
    removeStorageSync(key) { values.delete(key); }
  };
}

function loadApp(wxApi) {
  const previousWx = globalThis.wx;
  const previousApp = globalThis.App;
  let definition;
  globalThis.wx = wxApi;
  globalThis.App = (value) => { definition = value; };
  delete require.cache[require.resolve("../miniprogram/app.js")];
  require("../miniprogram/app.js");
  definition.onLaunch.call(definition);
  globalThis.wx = previousWx;
  globalThis.App = previousApp;
  return definition;
}

function loadPage(path) {
  const previousPage = globalThis.Page;
  let definition;
  globalThis.Page = (value) => { definition = value; };
  delete require.cache[require.resolve(path)];
  require(path);
  globalThis.Page = previousPage;
  return definition;
}

function mount(definition, app) {
  const page = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch) { this.data = { ...this.data, ...patch }; },
    ...definition
  };
  globalThis.getApp = () => app;
  return page;
}

test("production config uses CloudBase private transport and has no default demo invite", () => {
  const config = require("../miniprogram/config.js");
  assert.equal(config.mode, "cloudbase");
  assert.equal(config.transport, "cloudbase");
  assert.equal(config.publicBaseUrl, "https://philosophy-coach-4202431-1454163072.ap-shanghai.run.tcloudbase.com");
  assert.equal(config.inviteCode, "");
  assert.notEqual(config.inviteCode, "demo");
});

test("public transport sends the same API path, method and JSON body without identity headers", async () => {
  const calls = [];
  const api = require("../miniprogram/services/api.js").createApi({
    wxApi: {
      request(options) {
        calls.push(options);
        options.success({ statusCode: 200, data: { ok: true } });
      }
    },
    config: {
      mode: "cloudbase",
      transport: "public",
      publicBaseUrl: "https://coach.example.test/"
    }
  });

  assert.deepEqual(await api.post("/api/learner/sync", { inviteCode: "trial-1" }), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://coach.example.test/api/learner/sync");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].data, { inviteCode: "trial-1" });
  assert.equal(calls[0].header["content-type"], "application/json");
  assert.equal(Object.keys(calls[0].header).some((key) => /^X-WX-/i.test(key)), false);
});

test("public transport preserves non-2xx status and student-safe error details", async () => {
  const api = require("../miniprogram/services/api.js").createApi({
    wxApi: {
      request(options) {
        options.success({
          statusCode: 401,
          data: { error: "试用码无效", code: "INVITE_INVALID", retryable: false }
        });
      }
    },
    config: { mode: "cloudbase", transport: "public", publicBaseUrl: "https://coach.example.test" }
  });

  await assert.rejects(
    () => api.post("/api/learner/sync", { inviteCode: "bad" }),
    (error) => error.statusCode === 401
      && error.code === "INVITE_INVALID"
      && error.retryable === false
      && error.preserved === true
  );
});

test("public request timeout keeps the retryable failure contract", async () => {
  let requestOptions;
  const api = require("../miniprogram/services/api.js").createApi({
    wxApi: {
      request(options) {
        requestOptions = options;
        options.fail({ errMsg: "request:fail timeout" });
      }
    },
    config: { mode: "cloudbase", transport: "public", publicBaseUrl: "https://coach.example.test", requestTimeout: 12000 }
  });

  await assert.rejects(
    () => api.get("/api/health"),
    (error) => error.code === "REQUEST_TIMEOUT" && error.retryable === true && error.preserved === true
  );
  assert.equal(requestOptions.timeout, 12000);
});

test("CloudBase app launch restores a saved invite and initializes the private link", () => {
  const wxApi = wxMemory({ "philosophy-coach-mini:invite-code": "trial-saved" });
  let cloudInitCalls = 0;
  wxApi.cloud = { init() { cloudInitCalls += 1; } };
  const app = loadApp(wxApi);

  assert.equal(cloudInitCalls, 1);
  assert.equal(app.globalData.config.inviteCode, "trial-saved");
  assert.equal(app.globalData.storage.isBound(), false);
  assert.equal(app.globalData.storage.get("active-session", null), null);
});

test("today stays on the invite card and does not call sync before an invite is present", async () => {
  const calls = [];
  const app = {
    globalData: {
      config: { mode: "cloudbase", transport: "public", inviteCode: "" },
      storage: { unbindParticipant() {}, get() { return null; } },
      activeSession: null,
      api: {
        async post(path) { calls.push(path); },
        async get(path) { calls.push(path); }
      }
    }
  };
  const page = mount(loadPage("../miniprogram/pages/today/today.js"), app);

  await page.refresh();

  assert.deepEqual(calls, []);
  assert.equal(page.data.needsInvite, true);
  assert.equal(page.data.recommendation, null);
  assert.equal(page.data.loading, false);
});

test("a non-empty invite is persisted only after today verifies it", async () => {
  const wxApi = wxMemory();
  wxApi.cloud = { init() {} };
  const app = loadApp(wxApi);
  const calls = [];
  app.globalData.api = {
    async post(path, body) {
      calls.push([path, body]);
      if (path === "/api/learner/sync") {
        assert.equal(wxApi.getStorageSync("philosophy-coach-mini:invite-code"), undefined);
        return { participantCode: "wx-trial", sessions: [] };
      }
      return { questionId: "q1", question: "题目", questionKind: "new", reason: "推荐", todayCompleted: 0 };
    },
    async get(path) { calls.push([path]); return { coachMode: "real" }; }
  };
  const page = mount(loadPage("../miniprogram/pages/today/today.js"), app);

  await page.beginTrial({ detail: { value: "trial-valid" } });

  assert.equal(app.globalData.config.inviteCode, "trial-valid");
  assert.equal(wxApi.getStorageSync("philosophy-coach-mini:invite-code"), "trial-valid");
  assert.deepEqual(calls.slice(0, 3).map(([path]) => path), ["/api/learner/sync", "/api/health", "/api/practice/next"]);
  assert.equal(calls.filter(([path]) => path === "/api/events").length, 2);
  assert.equal(app.globalData.participantCode, "wx-trial");
});

test("a failed unverified invite is not persisted and the student can re-enter it", async () => {
  const wxApi = wxMemory();
  wxApi.cloud = { init() {} };
  const app = loadApp(wxApi);
  app.globalData.api = {
    async post() {
      throw Object.assign(new Error("小程序网络没有接好，不是你输错了"), {
        code: "REQUEST_DOMAIN_BLOCKED",
        retryable: true
      });
    }
  };
  const page = mount(loadPage("../miniprogram/pages/today/today.js"), app);

  await page.beginTrial({ detail: { value: "trial-unverified" } });

  assert.equal(wxApi.getStorageSync("philosophy-coach-mini:invite-code"), undefined);
  assert.equal(page.data.needsInvite, false);
  assert.equal(page.data.canChangeInvite, true);
  assert.match(page.data.error, /不是你输错/);

  const restarted = loadApp(wxApi);
  assert.equal(restarted.globalData.config.inviteCode, "");

  page.changeInvite();
  assert.equal(app.globalData.config.inviteCode, "");
  assert.equal(page.data.needsInvite, true);
  assert.equal(page.data.error, "");
});

test("401 clears the invite and all visible identity-bound state", async () => {
  const wxApi = wxMemory({ "philosophy-coach-mini:invite-code": "trial-old" });
  const app = loadApp(wxApi);
  app.globalData.activeSession = { sessionId: "old", stage: "teaching" };
  app.globalData.participantCode = "wx-old";
  app.globalData.api = {
    async post() {
      throw Object.assign(new Error("这个试用码无效"), { statusCode: 401, code: "INVITE_INVALID" });
    },
    async get() { throw new Error("should not request health"); }
  };
  const page = mount(loadPage("../miniprogram/pages/today/today.js"), app);

  await page.refresh();

  assert.equal(app.globalData.config.inviteCode, "");
  assert.equal(wxApi.getStorageSync("philosophy-coach-mini:invite-code"), undefined);
  assert.equal(app.globalData.activeSession, null);
  assert.equal(app.globalData.participantCode, null);
  assert.equal(page.data.needsInvite, true);
  assert.equal(page.data.recommendation, null);
  assert.match(page.data.error, /无效/);
});

test("a restarted app reloads the saved invite without reopening old participant storage", () => {
  const wxApi = wxMemory({ "philosophy-coach-mini:invite-code": "trial-restart" });
  const app = loadApp(wxApi);

  assert.equal(app.globalData.config.inviteCode, "trial-restart");
  assert.equal(app.globalData.storage.participantCode, null);
  assert.equal(app.globalData.storage.isBound(), false);
});

test("switching invite codes clears active and participant identity before a new sync binds it", () => {
  const wxApi = wxMemory({ "philosophy-coach-mini:invite-code": "trial-old" });
  const app = loadApp(wxApi);
  app.globalData.storage.bindParticipant("wx-old");
  app.globalData.storage.set("active-session", { sessionId: "old", stage: "teaching" });
  app.globalData.storage.set("history", [{ sessionId: "old", question: "旧用户内容" }]);
  app.globalData.activeSession = { sessionId: "old", stage: "teaching" };
  app.globalData.participantCode = "wx-old";

  assert.equal(app.setInviteCode("trial-new"), "trial-new");
  assert.equal(app.globalData.config.inviteCode, "trial-new");
  assert.equal(app.globalData.activeSession, null);
  assert.equal(app.globalData.participantCode, null);
  assert.equal(app.globalData.storage.isBound(), false);
  assert.equal(app.globalData.storage.get("active-session", null), null);
  assert.deepEqual(app.globalData.storage.get("history", []), []);
  assert.equal(wxApi.getStorageSync("philosophy-coach-mini:invite-code"), "trial-new");
});

test("today start ignores an old response after the invite switches and the new identity binds", async () => {
  const wxApi = wxMemory({ "philosophy-coach-mini:invite-code": "trial-old" });
  const app = loadApp(wxApi);
  let resolveStart;
  app.globalData.api = {
    post(path) {
      assert.equal(path, "/api/session/start");
      return new Promise((resolve) => { resolveStart = resolve; });
    }
  };
  const page = mount(loadPage("../miniprogram/pages/today/today.js"), app);
  page.data.needsInvite = false;
  page.data.recommendation = { questionId: "q-old" };
  const navigations = [];
  const previousWx = globalThis.wx;
  globalThis.wx = { navigateTo(options) { navigations.push(options); } };
  const pending = page.start();

  app.setInviteCode("trial-new");
  bindLearnerIdentity(app, { participantCode: "wx-new", sessions: [] });
  resolveStart({ sessionId: "old-session", stage: "attempt", questionId: "q-old" });
  await pending;
  globalThis.wx = previousWx;

  assert.equal(app.globalData.activeSession, null);
  assert.equal(app.globalData.storage.get("active-session", null), null);
  assert.deepEqual(navigations, []);
});

test("training nextQuestion never starts a new-code session from an old recommendation request", async () => {
  const wxApi = wxMemory({ "philosophy-coach-mini:invite-code": "trial-old" });
  const app = loadApp(wxApi);
  let resolveRecommendation;
  const calls = [];
  app.globalData.api = {
    post(path, body) {
      calls.push([path, body]);
      if (path === "/api/practice/next") {
        return new Promise((resolve) => { resolveRecommendation = resolve; });
      }
      return Promise.resolve({ sessionId: "old-session", stage: "attempt", questionId: "q-old" });
    }
  };
  const page = mount(loadPage("../miniprogram/pages/training/training.js"), app);
  page.inviteVersion = app.globalData.inviteVersion;
  page.state = createTrainingState({ sessionId: "old-session", stage: "complete" });
  const pending = page.nextQuestion();

  app.setInviteCode("trial-new");
  bindLearnerIdentity(app, { participantCode: "wx-new", sessions: [] });
  resolveRecommendation({ questionId: "q-old", question: "旧题" });
  await pending;

  assert.deepEqual(calls.map(([path]) => path), ["/api/practice/next"]);
  assert.equal(app.globalData.recommendation, null);
  assert.equal(app.globalData.activeSession, null);
});

test("profile and current pages clear an invite on auth errors instead of retaining old identity state", async () => {
  const profileWx = wxMemory({ "philosophy-coach-mini:invite-code": "trial-profile" });
  const profileApp = loadApp(profileWx);
  profileApp.globalData.storage.bindParticipant("wx-profile");
  profileApp.globalData.participantCode = "wx-profile";
  profileApp.globalData.api = { async post() { throw Object.assign(new Error("试用码失效"), { statusCode: 403 }); } };
  const profile = mount(loadPage("../miniprogram/pages/profile/profile.js"), profileApp);
  await profile.refresh();
  assert.equal(profileApp.globalData.config.inviteCode, "");
  assert.equal(profileApp.globalData.participantCode, null);
  assert.equal(profileApp.globalData.storage.isBound(), false);

  const todayWx = wxMemory({ "philosophy-coach-mini:invite-code": "trial-today" });
  const todayApp = loadApp(todayWx);
  todayApp.globalData.activeSession = { sessionId: "old", stage: "complete" };
  todayApp.globalData.participantCode = "wx-old";
  todayApp.globalData.api = { async post() { throw Object.assign(new Error("试用码失效"), { statusCode: 401 }); } };
  const today = mount(loadPage("../miniprogram/pages/today/today.js"), todayApp);
  today.data.needsInvite = false;
  today.data.recommendation = { questionId: "q-old" };
  const previousWx = globalThis.wx;
  globalThis.wx = { navigateTo() {} };
  await today.start();
  globalThis.wx = previousWx;
  assert.equal(todayApp.globalData.config.inviteCode, "");
  assert.equal(todayApp.globalData.activeSession, null);
  assert.equal(today.data.recommendation, null);
  assert.equal(today.data.needsInvite, true);
});

test("training auth errors clear identity, and an invite-less deep link never sends step or practice requests", async () => {
  const authWx = wxMemory({ "philosophy-coach-mini:invite-code": "trial-training" });
  const authApp = loadApp(authWx);
  authApp.globalData.activeSession = { sessionId: "old", stage: "attempt", questionId: "q-old" };
  authApp.globalData.participantCode = "wx-old";
  authApp.globalData.api = { async post() { throw Object.assign(new Error("试用码失效"), { statusCode: 403 }); } };
  const authPage = mount(loadPage("../miniprogram/pages/training/training.js"), authApp);
  authPage.inviteVersion = authApp.globalData.inviteVersion;
  authPage.state = createTrainingState(authApp.globalData.activeSession);
  const previousWx = globalThis.wx;
  globalThis.wx = { switchTab() {} };
  await authPage.run({ action: "submit_attempt", input: "我的回答" });
  globalThis.wx = previousWx;
  assert.equal(authApp.globalData.config.inviteCode, "");
  assert.equal(authApp.globalData.activeSession, null);
  assert.equal(authApp.globalData.participantCode, null);

  const deepWx = wxMemory();
  const deepApp = loadApp(deepWx);
  const calls = [];
  deepApp.globalData.activeSession = { sessionId: "deep-old", stage: "attempt", questionId: "q-old" };
  deepApp.globalData.api = {
    async post(path) { calls.push(path); return {}; }
  };
  const deepPage = mount(loadPage("../miniprogram/pages/training/training.js"), deepApp);
  deepPage.inviteVersion = deepApp.globalData.inviteVersion;
  deepPage.state = createTrainingState(deepApp.globalData.activeSession);
  deepPage.data.busy = false;
  const previousDeepWx = globalThis.wx;
  globalThis.wx = { switchTab() {}, navigateBack() {}, showToast() {} };
  await deepPage.run({ action: "submit_attempt", input: "不应提交" });
  await deepPage.nextQuestion();
  globalThis.wx = previousDeepWx;
  assert.deepEqual(calls, []);
});

test("profile clears a previous active identity when learner sync fails generically", async () => {
  const wxApi = wxMemory({ "philosophy-coach-mini:invite-code": "trial-profile-network" });
  const app = loadApp(wxApi);
  app.globalData.storage.bindParticipant("wx-old");
  app.globalData.storage.set("active-session", { sessionId: "old", stage: "teaching" });
  app.globalData.activeSession = { sessionId: "old", stage: "teaching" };
  app.globalData.participantCode = "wx-old";
  app.globalData.cloudProfile = { profile: { completedCount: 9 } };
  app.globalData.api = { async post() { throw new Error("网络暂时不可用"); } };
  const page = mount(loadPage("../miniprogram/pages/profile/profile.js"), app);
  page.data.completed = 9;
  page.data.due = 2;
  page.data.unstable = 1;
  page.data.weaknesses = [{ topic: "旧卡点" }];

  await page.refresh();

  assert.equal(app.globalData.activeSession, null);
  assert.equal(app.globalData.participantCode, null);
  assert.equal(app.globalData.cloudProfile, null);
  assert.equal(app.globalData.storage.isBound(), false);
  assert.equal(app.globalData.storage.get("active-session", null), null);
  assert.equal(page.data.completed, 0);
  assert.equal(page.data.due, 0);
  assert.equal(page.data.unstable, 0);
  assert.deepEqual(page.data.weaknesses, []);
});
