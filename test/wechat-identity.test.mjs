import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createMemoryLearningStore } from "../src/records/learning-store.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";


const APP_ID = "wxfa3953c780a246d8";
const SECRET = "wechat-identity-test-signing-secret";


function request(path, body, { openid, appid } = {}) {
  const headers = { "content-type": "application/json" };
  if (openid !== undefined) headers["x-wx-openid"] = openid;
  if (appid !== undefined) headers["x-wx-appid"] = appid;
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}


function appFixture({ recorder = createMemoryRecorder(), learningStore = null } = {}) {
  const app = createApp({
    config: {
      invites: new Map([["demo", { participantCode: "DEMO", cohort: "demo" }]]),
      miniprogramAppId: APP_ID,
      sessionSigningSecret: SECRET,
      coachProvider: "mock",
      recordProvider: "memory"
    },
    coach: { async evaluate() { throw new Error("not used"); } },
    recorder,
    learningStore
  });
  return { app, recorder, learningStore };
}


async function bodyOf(response) {
  return response.json();
}


async function start(app, openid, body = { inviteCode: "demo", consent: true }) {
  const response = await app.handle(request("/api/session/start", body, {
    openid,
    appid: APP_ID
  }));
  return { response, body: await bodyOf(response) };
}


test("same demo code with different WeChat identities stays isolated", async () => {
  const { app, recorder } = appFixture();
  const [one, two] = await Promise.all([
    start(app, "openid-learner-one"),
    start(app, "openid-learner-two")
  ]);

  assert.equal(one.response.status, 201);
  assert.equal(two.response.status, 201);
  assert.notEqual(one.body.participantCode, two.body.participantCode);
  assert.notEqual(one.body.participantCode, "DEMO");
  assert.notEqual(two.body.participantCode, "DEMO");

  const [oneSync, twoSync] = await Promise.all([
    app.handle(request("/api/learner/sync", { inviteCode: "demo" }, {
      openid: "openid-learner-one",
      appid: APP_ID
    })),
    app.handle(request("/api/learner/sync", { inviteCode: "demo" }, {
      openid: "openid-learner-two",
      appid: APP_ID
    }))
  ]);
  const [oneBody, twoBody] = await Promise.all([bodyOf(oneSync), bodyOf(twoSync)]);

  assert.equal(oneBody.participantCode, one.body.participantCode);
  assert.equal(twoBody.participantCode, two.body.participantCode);
  assert.equal(oneBody.sessions.length, 1);
  assert.equal(twoBody.sessions.length, 1);
  assert.equal([...recorder.records.values()].length, 2);
  assert.deepEqual([...recorder.records.values()].map((record) => record.cohort), ["new", "new"]);
});


test("the same openid derives one stable participant across start, sync, and practice", async () => {
  const recorder = createMemoryRecorder();
  const learningStore = createMemoryLearningStore();
  const recorderParticipants = [];
  const masteryParticipants = [];
  const originalList = recorder.listByParticipant.bind(recorder);
  const originalMasteryList = learningStore.listMasteryByParticipant.bind(learningStore);
  recorder.listByParticipant = async (participantCode, limit) => {
    recorderParticipants.push(participantCode);
    return originalList(participantCode, limit);
  };
  learningStore.listMasteryByParticipant = async (participantCode, options) => {
    masteryParticipants.push(participantCode);
    return originalMasteryList(participantCode, options);
  };
  const { app } = appFixture({ recorder, learningStore });

  const first = await start(app, "openid-stable");
  const second = await start(app, "openid-stable");
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  assert.equal(first.body.participantCode, second.body.participantCode);

  const sync = await app.handle(request("/api/learner/sync", { inviteCode: "demo" }, {
    openid: "openid-stable",
    appid: APP_ID
  }));
  const syncBody = await bodyOf(sync);
  assert.equal(sync.status, 200);
  assert.equal(syncBody.participantCode, first.body.participantCode);
  assert.equal(syncBody.sessions.length, 2);

  const practice = await app.handle(request("/api/practice/next", { inviteCode: "demo" }, {
    openid: "openid-stable",
    appid: APP_ID
  }));
  assert.equal(practice.status, 200);
  assert.deepEqual([...new Set(recorderParticipants)], [first.body.participantCode]);
  assert.deepEqual([...new Set(masteryParticipants)], [first.body.participantCode]);
});


test("raw openid is never returned or persisted", async () => {
  const openid = "openid-never-leak-9f30";
  const { app, recorder } = appFixture();
  const started = await start(app, openid);
  const synced = await app.handle(request("/api/learner/sync", { inviteCode: "demo" }, {
    openid,
    appid: APP_ID
  }));
  const text = JSON.stringify({ started: started.body, synced: await bodyOf(synced), records: [...recorder.records.values()] });

  assert.equal(started.response.status, 201);
  assert.equal(synced.status, 200);
  assert.doesNotMatch(text, new RegExp(openid));
  assert.match(started.body.participantCode, /^wx-[a-f0-9]{64}$/);
});


test("openid with a missing or mismatched appid is rejected", async () => {
  const { app, recorder } = appFixture();
  const missingAppid = await app.handle(request("/api/session/start", {
    inviteCode: "demo",
    consent: true
  }, { openid: "openid-missing-appid" }));
  const wrongAppid = await app.handle(request("/api/session/start", {
    inviteCode: "demo",
    consent: true
  }, { openid: "openid-wrong-appid", appid: "wx-not-this-app" }));

  assert.equal(missingAppid.status, 403);
  assert.equal(wrongAppid.status, 403);
  assert.equal(recorder.records.size, 0);
  assert.doesNotMatch(JSON.stringify(await bodyOf(missingAppid)), /openid-missing-appid/);
  assert.doesNotMatch(JSON.stringify(await bodyOf(wrongAppid)), /openid-wrong-appid/);
});


test("requests without WeChat identity headers keep the webpage invite path", async () => {
  const learningStore = createMemoryLearningStore();
  const { app } = appFixture({ learningStore });
  const started = await app.handle(request("/api/session/start", {
    inviteCode: "demo",
    consent: true
  }));
  const sync = await app.handle(request("/api/learner/sync", { inviteCode: "demo" }));
  const practice = await app.handle(request("/api/practice/next", { inviteCode: "demo" }));

  assert.equal(started.status, 201);
  assert.equal((await bodyOf(started)).participantCode, "DEMO");
  assert.equal(sync.status, 200);
  assert.equal((await bodyOf(sync)).participantCode, "DEMO");
  assert.equal(practice.status, 200);
});


test("config exposes the public miniprogram app id with an environment override", () => {
  assert.equal(loadConfig({}).miniprogramAppId, APP_ID);
  assert.equal(loadConfig({ MINIPROGRAM_APP_ID: "wx-override" }).miniprogramAppId, "wx-override");
});
