import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createMockCoach } from "../src/coach/providers.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";


const SECRET = "session-integrity-release-secret";


function request(path, body) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}


function fixture({ coach = createMockCoach(), recorder = createMemoryRecorder() } = {}) {
  const app = createApp({
    config: {
      invites: new Map([["demo", { participantCode: "P01", cohort: "demo" }]]),
      sessionSigningSecret: SECRET
    },
    coach,
    recorder
  });
  return { app, recorder };
}


async function json(response) {
  return response.json();
}


async function start(app) {
  const response = await app.handle(request("/api/session/start", {
    inviteCode: "demo",
    consent: true
  }));
  assert.equal(response.status, 201);
  return json(response);
}


async function step(app, session, body) {
  const response = await app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    ...body
  }));
  return { response, body: await json(response) };
}


function recordId(session) {
  return JSON.parse(Buffer.from(session.sessionToken.split(".")[0], "base64url").toString("utf8")).recordId;
}


async function reachRevision(app, session) {
  const attempt = await step(app, session, {
    stage: "attempt",
    action: "submit_attempt",
    input: "不知道",
    snapshot: {}
  });
  assert.equal(attempt.response.status, 200);
  assert.equal(attempt.body.nextStage, "teaching");

  const restate = await step(app, session, {
    stage: "restate",
    action: "submit_restate",
    input: "理论理性留下可能，实践理性通过道德法则必须预设自由，赋予实践意义。",
    snapshot: attempt.body.snapshot
  });
  assert.equal(restate.response.status, 200);
  assert.equal(restate.body.nextStage, "revision");
  return restate.body;
}


async function complete(app, session) {
  const restate = await reachRevision(app, session);
  const revision = await step(app, session, {
    stage: "revision",
    action: "submit_revision",
    input: "理论理性为自由留下可能，实践理性通过道德法则必须预设自由，赋予实践意义。",
    snapshot: restate.body?.snapshot || restate.snapshot
  });
  assert.equal(revision.response.status, 200);
  assert.equal(revision.body.nextStage, "complete");
  return revision.body;
}


test("a follow-up must match the persisted stage and cannot erase the server snapshot", async () => {
  const { app, recorder } = fixture();
  const session = await start(app);
  const restate = await reachRevision(app, session);
  const id = recordId(session);
  const before = await recorder.get(id);

  const mismatched = await step(app, session, {
    stage: "teaching",
    action: "ask_followup",
    input: "再讲一遍",
    snapshot: {}
  });
  assert.equal(mismatched.response.status, 409);

  const matching = await step(app, session, {
    stage: "revision",
    action: "ask_followup",
    input: "再讲一遍",
    snapshot: {}
  });
  assert.equal(matching.response.status, 200);
  assert.equal(matching.body.nextStage, "revision");

  const after = await recorder.get(id);
  assert.equal(before.stage, "revision");
  assert.equal(after.stage, "revision");
  assert.equal(after.snapshot.initialAnswer, "不知道");
  assert.equal(after.snapshot.repairResponse, restate.snapshot.repairResponse);
  assert.match(after.snapshot.followupQuestions.at(-1).question, /再讲一遍/);
});


test("same-session concurrent steps are serialized without dropping either follow-up", async () => {
  const baseCoach = createMockCoach();
  const coach = {
    async evaluate(context) {
      if (context.input === "followup-A") await new Promise((resolve) => setTimeout(resolve, 25));
      return baseCoach.evaluate(context);
    }
  };
  const { app, recorder } = fixture({ coach });
  const session = await start(app);
  const attempt = await step(app, session, {
    stage: "attempt",
    action: "submit_attempt",
    input: "不知道",
    snapshot: {}
  });
  assert.equal(attempt.body.nextStage, "teaching");

  const [first, second] = await Promise.all([
    step(app, session, {
      stage: "teaching",
      action: "ask_followup",
      input: "followup-A",
      snapshot: attempt.body.snapshot
    }),
    step(app, session, {
      stage: "teaching",
      action: "ask_followup",
      input: "followup-B",
      snapshot: attempt.body.snapshot
    })
  ]);
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);

  const stored = await recorder.get(recordId(session));
  assert.deepEqual(
    stored.snapshot.followupQuestions.map((item) => item.question).sort(),
    ["followup-A", "followup-B"]
  );
});


test("a retry after a committed update with a lost response returns the stored step result", async () => {
  const recorder = createMemoryRecorder();
  const originalUpdate = recorder.update.bind(recorder);
  let loseResponse = true;
  recorder.update = async (...args) => {
    await originalUpdate(...args);
    if (loseResponse) {
      loseResponse = false;
      throw new Error("response lost after commit");
    }
  };
  const { app } = fixture({ recorder });
  const session = await start(app);
  const payload = {
    stage: "attempt",
    action: "submit_attempt",
    input: "不知道",
    snapshot: {}
  };

  const first = await step(app, session, payload);
  assert.equal(first.response.status, 500);

  const retry = await step(app, session, payload);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.nextStage, "teaching");
  assert.equal(retry.body.snapshot.initialAnswer, "不知道");
  assert.ok(retry.body.feedback?.message);
});


test("completion feedback cannot clear the persisted learning snapshot", async () => {
  const { app, recorder } = fixture();
  const session = await start(app);
  await complete(app, session);
  const id = recordId(session);
  const before = await recorder.get(id);

  const response = await app.handle(request("/api/session/complete", {
    sessionToken: session.sessionToken,
    snapshot: {},
    reflection: { uxConfusion: "没有" }
  }));
  assert.equal(response.status, 200);

  const after = await recorder.get(id);
  assert.equal(after.stage, "complete");
  assert.equal(after.snapshot.initialAnswer, before.snapshot.initialAnswer);
  assert.equal(after.snapshot.repairResponse, before.snapshot.repairResponse);
  assert.equal(after.snapshot.rewrittenAnswer, before.snapshot.rewrittenAnswer);
  assert.equal(after.reflection.uxConfusion, "没有");
});
