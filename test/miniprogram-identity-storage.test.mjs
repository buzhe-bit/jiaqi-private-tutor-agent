import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createStorage, readHistory } = require("../miniprogram/utils/storage.js");
const { bindLearnerIdentity, selectActiveSession } = require("../miniprogram/core/dashboard.js");


function wxMemory(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getStorageSync(key) { return values.get(key); },
    setStorageSync(key, value) { values.set(key, value); },
    removeStorageSync(key) { values.delete(key); }
  };
}


function pageFor(path) {
  const previous = globalThis.Page;
  let definition;
  globalThis.Page = (value) => { definition = value; };
  delete require.cache[require.resolve(path)];
  require(path);
  globalThis.Page = previous;
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


test("cloudbase storage stays sealed until an anonymous participant is verified", () => {
  const wx = wxMemory({
    "philosophy-coach-mini:demo:active-session": { sessionId: "old", stage: "teaching" },
    "philosophy-coach-mini:demo:history": [{ sessionId: "old", finalExpression: "前一个人的表达" }]
  });
  const storage = createStorage(wx, "demo", { mode: "cloudbase" });

  assert.equal(storage.get("active-session", null), null);
  assert.deepEqual(readHistory(storage), []);
  assert.equal(storage.isBound(), false);
});


test("cloudbase app launch does not restore invite-scoped active data", () => {
  const wx = wxMemory({
    "philosophy-coach-mini:demo:active-session": { sessionId: "old", stage: "teaching" }
  });
  wx.cloud = { init() {} };
  const previousWx = globalThis.wx;
  const previousApp = globalThis.App;
  let definition;
  globalThis.wx = wx;
  globalThis.App = (value) => { definition = value; };
  delete require.cache[require.resolve("../miniprogram/app.js")];
  require("../miniprogram/app.js");
  definition.onLaunch.call(definition);
  globalThis.wx = previousWx;
  globalThis.App = previousApp;

  assert.equal(definition.globalData.activeSession, null);
  assert.equal(definition.globalData.storage.isBound(), false);
  assert.equal(definition.globalData.storage.get("active-session", null), null);
});


test("local-demo keeps invite-code storage while cloudbase binds each participant namespace", () => {
  const wx = wxMemory();
  const local = createStorage(wx, "invite-a", { mode: "local-demo" });
  local.set("active-session", { sessionId: "local", stage: "attempt" });
  assert.equal(createStorage(wx, "invite-a", { mode: "local-demo" }).get("active-session").sessionId, "local");
  assert.equal(createStorage(wx, "invite-b", { mode: "local-demo" }).get("active-session", null), null);

  const cloud = createStorage(wx, "demo", { mode: "cloudbase" });
  assert.equal(cloud.bindParticipant("wx-a"), true);
  cloud.set("active-session", { sessionId: "a", stage: "teaching" });
  cloud.bindParticipant("wx-b");
  assert.equal(cloud.get("active-session", null), null);
  cloud.bindParticipant("wx-a");
  assert.equal(cloud.get("active-session").sessionId, "a");
});


test("binding a new cloud participant clears the old global active and never falls back", () => {
  const wx = wxMemory();
  const storage = createStorage(wx, "demo", { mode: "cloudbase" });
  storage.bindParticipant("wx-old");
  storage.set("active-session", { sessionId: "old", stage: "teaching" });
  const app = {
    globalData: {
      config: { mode: "cloudbase", inviteCode: "demo" },
      storage,
      activeSession: { sessionId: "old", stage: "teaching" }
    }
  };

  const identity = bindLearnerIdentity(app, { participantCode: "wx-new", sessions: [] });

  assert.equal(identity.ready, true);
  assert.equal(app.globalData.activeSession, null);
  assert.equal(storage.get("active-session", null), null);
  assert.equal(selectActiveSession([], { sessionId: "old", stage: "teaching" }), null);
});


test("today does not render stale local active content before or after a sync failure", async () => {
  const wx = wxMemory();
  const storage = createStorage(wx, "demo", { mode: "cloudbase" });
  const app = {
    globalData: {
      config: { mode: "cloudbase", inviteCode: "demo" },
      storage,
      privacyAccepted: true,
      activeSession: { sessionId: "old", stage: "teaching", question: "前一个人的题" },
      recommendation: null,
      cloudProfile: null,
      api: {
        async post(path) {
          if (path === "/api/learner/sync") throw new Error("身份同步失败");
          return path === "/api/practice/next"
            ? { questionId: "next", question: "新题", questionKind: "new", reason: "推荐" }
            : {};
        },
        async get() { return { coachMode: "real" }; }
      }
    }
  };
  const page = mount(pageFor("../miniprogram/pages/today/today.js"), app);
  page.setData = function setData(patch) { this.data = { ...this.data, ...patch }; };

  await page.refresh();

  assert.equal(page.data.recommendation, null);
  assert.equal(page.data.active, false);
  assert.equal(app.globalData.activeSession, null);
});


test("history waits for identity sync and hides local content when sync fails", async () => {
  const wx = wxMemory();
  const storage = createStorage(wx, "demo", { mode: "cloudbase" });
  storage.bindParticipant("wx-old");
  storage.set("history", [{ sessionId: "old", question: "前一个人的题", completedAt: "2026-08-13T00:00:00.000Z" }]);
  const calls = [];
  const app = {
    globalData: {
      config: { mode: "cloudbase", inviteCode: "demo" },
      storage,
      activeSession: { sessionId: "old", stage: "teaching" },
      cloudProfile: null,
      api: {
        async post(path) {
          calls.push(path);
          throw new Error("身份同步失败");
        }
      }
    }
  };
  const page = mount(pageFor("../miniprogram/pages/history/history.js"), app);
  await page.onShow();

  assert.deepEqual(calls, ["/api/learner/sync"]);
  assert.deepEqual(page.data.entries, []);
  assert.equal(app.globalData.activeSession, null);
  assert.equal(storage.isBound(), false);
});


test("history reads only the namespace selected by a successful sync", async () => {
  const wx = wxMemory();
  const storage = createStorage(wx, "demo", { mode: "cloudbase" });
  storage.bindParticipant("wx-new");
  storage.set("history", [{
    sessionId: "new",
    question: "当前用户的题",
    completedAt: "2026-08-14T00:00:00.000Z"
  }]);
  const app = {
    globalData: {
      config: { mode: "cloudbase", inviteCode: "demo" },
      storage,
      activeSession: { sessionId: "old", stage: "teaching" },
      cloudProfile: null,
      api: {
        async post() {
          return { participantCode: "wx-new", sessions: [] };
        }
      }
    }
  };
  const page = mount(pageFor("../miniprogram/pages/history/history.js"), app);
  await page.onShow();

  assert.equal(page.data.entries.length, 1);
  assert.equal(page.data.entries[0].sessionId, "new");
  assert.equal(app.globalData.activeSession, null);
  assert.equal(storage.participantCode, "wx-new");
});
