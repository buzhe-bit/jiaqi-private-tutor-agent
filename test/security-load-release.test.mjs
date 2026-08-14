import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createCloudbaseCoach } from "../src/coach/providers.mjs";
import { loadConfig } from "../src/config.mjs";
import { createMemoryLearningStore } from "../src/records/learning-store.mjs";
import { createCloudBaseRecorder } from "../src/records/cloudbase-recorder.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";
import { createHttpServer } from "../src/server.mjs";


const SECRET = "security-release-test-signing-secret";
const API_KEY = "security-release-cloudbase-api-key";


function request(path, body) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}


function invites(entries = [["demo", "P01"]]) {
  return new Map(entries.map(([code, participantCode]) => [code, {
    participantCode,
    cohort: "consulted"
  }]));
}


function diagnosis(action) {
  const complete = action === "submit_revision";
  return {
    subject: "philosophy",
    topic: "康德的自由问题",
    thinker: "康德",
    concepts: ["理论理性", "实践理性", "自由"],
    knowledgeRelations: ["理论理性为自由留下可能，实践理性赋予自由实践意义"],
    issueType: complete ? "basically_mastered" : "relation_broken",
    misconception: "",
    expressionIssue: complete ? "" : "关键关系尚未写回完整答案",
    evidence: "学生答案中出现了本题的核心关系。",
    diagnosis: complete ? "本轮关键关系已经建立。" : "当前还需要补上关键关系。",
    masteryStatus: complete ? "developing" : "unstable",
    sourceStatus: "ai_synthesized",
    sourceLabel: "测试用结构化诊断",
    confidence: "medium"
  };
}


function deterministicCoach() {
  return {
    async evaluate({ action }) {
      const gate = action === "submit_attempt"
        ? "TEACH"
        : action === "submit_restate" ? "REVISE" : action === "submit_revision" ? "CLOSE_LOOP" : "TEACH";
      const complete = gate === "CLOSE_LOOP";
      return {
        gate,
        learnerNeed: complete ? "ready" : gate === "REVISE" ? "expression_gap" : "knowledge_gap",
        message: complete ? "已完成。" : "继续补这一环。",
        studentEvidence: "这是一条用于发布前验证的学生证据。",
        missingPoint: complete ? "本轮关键关系已经补上。" : "还需要补关键关系。",
        focus: "理论理性留下可能，实践理性赋予实践意义。",
        teaching: complete ? "" : "理论理性与实践理性的关系说明。",
        knowledgeConnection: "理论理性与实践理性通过自由连接。",
        nextActions: complete ? [] : gate === "REVISE" ? ["revise"] : ["hint", "explain", "reference", "restate"],
        sourceStatus: "有材料支持",
        diagnosis: diagnosis(action)
      };
    }
  };
}


function appFixture({ entries = [["demo", "P01"]], recorder = createMemoryRecorder(), learningStore = null, coach = deterministicCoach() } = {}) {
  return {
    app: createApp({
      config: {
        invites: invites(entries),
        sessionSigningSecret: SECRET,
        coachProvider: "mock",
        recordProvider: "memory"
      },
      coach,
      recorder,
      learningStore
    }),
    recorder,
    learningStore
  };
}


async function json(response) {
  return response.json();
}


async function start(app, inviteCode = "demo") {
  const response = await app.handle(request("/api/session/start", {
    inviteCode,
    consent: true
  }));
  assert.equal(response.status, 201);
  return json(response);
}


function tokenClaims(token) {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}


test("two invite-bound learners never receive each other's records or answers", async () => {
  const recorder = createMemoryRecorder();
  const { app } = appFixture({
    entries: [["a", "P01"], ["b", "P02"]],
    recorder
  });
  const [a, b] = await Promise.all([start(app, "a"), start(app, "b")]);

  const [aStep, bStep] = await Promise.all([
    app.handle(request("/api/session/step", {
      sessionToken: a.sessionToken,
      stage: "attempt",
      action: "submit_attempt",
      input: "P01 PRIVATE ANSWER",
      snapshot: a.snapshot
    })),
    app.handle(request("/api/session/step", {
      sessionToken: b.sessionToken,
      stage: "attempt",
      action: "submit_attempt",
      input: "P02 PRIVATE ANSWER",
      snapshot: b.snapshot
    }))
  ]);
  assert.equal(aStep.status, 200);
  assert.equal(bStep.status, 200);

  const [aSync, bSync] = await Promise.all([
    app.handle(request("/api/learner/sync", { inviteCode: "a" })),
    app.handle(request("/api/learner/sync", { inviteCode: "b" }))
  ]);
  const [aBody, bBody] = await Promise.all([json(aSync), json(bSync)]);
  const aText = JSON.stringify(aBody);
  const bText = JSON.stringify(bBody);

  assert.equal(aBody.participantCode, "P01");
  assert.equal(bBody.participantCode, "P02");
  assert.equal(aBody.sessions.length, 1);
  assert.equal(bBody.sessions.length, 1);
  assert.match(aText, /P01 PRIVATE ANSWER/);
  assert.doesNotMatch(aText, /P02 PRIVATE ANSWER/);
  assert.match(bText, /P02 PRIVATE ANSWER/);
  assert.doesNotMatch(bText, /P01 PRIVATE ANSWER/);
});


test("CloudBase record listing is participant-scoped and caps the requested page", async () => {
  const documents = new Map([
    ["session-a", { sessionId: "session-a", participantCode: "P01" }],
    ["session-b", { sessionId: "session-b", participantCode: "P02" }]
  ]);
  const calls = [];
  const recorder = createCloudBaseRecorder({
    envId: "security-env",
    apiKey: API_KEY,
    collectionName: "coach_sessions",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(url);
      const query = JSON.parse(parsed.searchParams.get("query"));
      const limit = Number(parsed.searchParams.get("limit"));
      assert.deepEqual(query, { participantCode: "P01" });
      assert.equal(limit, 100);
      return Response.json({ list: [...documents.values()].filter((item) => item.participantCode === query.participantCode) });
    }
  });

  const result = await recorder.listByParticipant("P01", 1000);
  assert.deepEqual(result.map((item) => item.sessionId), ["session-a"]);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].url, new RegExp(API_KEY));
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${API_KEY}`);
});


test("tampered session tokens, guessed invites, and guessed record IDs fail closed", async () => {
  let updates = 0;
  const recorder = createMemoryRecorder();
  const originalUpdate = recorder.update;
  recorder.update = async (...args) => {
    updates += 1;
    return originalUpdate(...args);
  };
  const { app } = appFixture({
    entries: [["a", "P01"], ["b", "P02"]],
    recorder
  });
  const session = await start(app, "a");
  const claims = tokenClaims(session.sessionToken);
  const [encoded, signature] = session.sessionToken.split(".");
  const tamperedPayload = { ...claims, recordId: "P02-guess" };
  const tamperedToken = `${Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url")}.${signature}`;

  const tampered = await app.handle(request("/api/session/step", {
    sessionToken: tamperedToken,
    stage: "attempt",
    action: "submit_attempt",
    input: "P02 PRIVATE ANSWER",
    snapshot: {}
  }));
  assert.equal(tampered.status, 401);
  assert.equal(updates, 0);

  const unknownInvite = await app.handle(request("/api/learner/sync", { inviteCode: "P02-guess" }));
  assert.equal(unknownInvite.status, 403);

  const malformedComplete = await app.handle(request("/api/session/complete", {
    sessionToken: `${encoded}.not-a-valid-signature`,
    snapshot: {},
    reflection: {}
  }));
  assert.equal(malformedComplete.status, 401);
});


test("upstream failures and logs never expose API keys or student answers", async () => {
  const logs = [];
  const calls = [];
  const upstreamSecret = "UPSTREAM-SECRET-RESPONSE";
  const coach = createCloudbaseCoach({
    envId: "security-env",
    apiKey: API_KEY,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ message: upstreamSecret, requestId: "safe-request-id" }), {
        status: 502,
        headers: { "content-type": "application/json", "x-request-id": "safe-request-id" }
      });
    },
    timeoutSignal: () => undefined,
    delay: async () => {},
    logger: { warn(value) { logs.push(value); } }
  });
  const recorder = createMemoryRecorder();
  const { app } = appFixture({ recorder, coach });
  const session = await start(app);
  const response = await app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "attempt",
    action: "submit_attempt",
    input: "STUDENT-PRIVATE-ANSWER",
    snapshot: {}
  }));
  const body = await json(response);

  assert.equal(response.status, 503);
  assert.equal(body.code, "COACH_UPSTREAM_ERROR");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(`${API_KEY}|${upstreamSecret}|STUDENT-PRIVATE-ANSWER`));
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(`${API_KEY}|${upstreamSecret}|STUDENT-PRIVATE-ANSWER`));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.headers.authorization === `Bearer ${API_KEY}`));
});


test("browser bundles contain no server credentials or signing secret", async () => {
  const files = [
    new URL("../public/app.js", import.meta.url),
    new URL("../miniprogram/app.js", import.meta.url),
    new URL("../miniprogram/config.js", import.meta.url),
    new URL("../miniprogram/services/api.js", import.meta.url)
  ];
  const bundles = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const clientText = bundles.join("\n");

  assert.doesNotMatch(clientText, /CLOUDBASE_API_KEY|FEISHU_APP_SECRET|SESSION_SIGNING_SECRET/);
  assert.doesNotMatch(clientText, new RegExp(`${API_KEY}|${SECRET}`));
});


test("HTTP rejects bodies over the request limit before creating a session", async (t) => {
  let creates = 0;
  const recorder = createMemoryRecorder();
  const originalCreate = recorder.create;
  recorder.create = async (...args) => {
    creates += 1;
    return originalCreate(...args);
  };
  const { app } = appFixture({ recorder });
  const server = createHttpServer({ app });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/session/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: "demo", consent: true, sourceExcerpt: "x".repeat(520 * 1024) })
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.match(body.error, /过大/);
  assert.equal(creates, 0);
});


test("ordinary text fields are clipped at the documented student-input boundary", async () => {
  const recorder = createMemoryRecorder();
  const { app } = appFixture({ recorder });
  const session = await start(app);
  const response = await app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "attempt",
    action: "submit_attempt",
    input: "i".repeat(20_000),
    snapshot: {}
  }));
  assert.equal(response.status, 200);
  const record = await recorder.get(tokenClaims(session.sessionToken).recordId);
  assert.equal(record.snapshot.initialAnswer.length, 12_000);
});


test("a client cannot persist an oversized or privileged review context", async () => {
  const recorder = createMemoryRecorder();
  const { app } = appFixture({ recorder });
  const session = await start(app);
  const response = await app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "attempt",
    action: "submit_attempt",
    input: "不知道",
    snapshot: {},
    reviewContext: {
      delayedRecallResult: "failed",
      intervalDays: 14,
      attackerPayload: "x".repeat(300_000)
    }
  }));
  assert.equal(response.status, 200);
  const record = await recorder.get(tokenClaims(session.sessionToken).recordId);

  assert.equal(record.reviewContext, null);
});


test("resuming an active memory session does not fork a second record", async () => {
  const recorder = createMemoryRecorder();
  const { app } = appFixture({ recorder });
  await start(app);
  const synced = await json(await app.handle(request("/api/learner/sync", { inviteCode: "demo" })));
  const active = synced.sessions.find((session) => session.stage !== "complete");
  assert.ok(active?.sessionToken);
  assert.equal(recorder.records.size, 1);

  const response = await app.handle(request("/api/session/step", {
    sessionToken: active.sessionToken,
    stage: active.stage,
    action: "submit_attempt",
    input: "恢复后的唯一答案",
    snapshot: active.snapshot
  }));
  assert.equal(response.status, 200);
  assert.equal(recorder.records.size, 1);
});


test("the server rejects a step that skips the persisted learning stage", async () => {
  let evaluations = 0;
  const coach = {
    async evaluate() {
      evaluations += 1;
      return deterministicCoach().evaluate({ action: "submit_revision" });
    }
  };
  const { app } = appFixture({ coach });
  const session = await start(app);
  const response = await app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "revision",
    action: "submit_revision",
    input: "跳过教学直接完成",
    snapshot: {}
  }));

  assert.ok(response.status >= 400, `stage skip unexpectedly returned ${response.status}`);
  assert.equal(evaluations, 0);
});


test("the complete endpoint rejects an active session instead of resurrecting it", async () => {
  const recorder = createMemoryRecorder();
  const { app } = appFixture({ recorder });
  const session = await start(app);
  const response = await app.handle(request("/api/session/complete", {
    sessionToken: session.sessionToken,
    snapshot: session.snapshot,
    reflection: {}
  }));

  assert.ok(response.status >= 400, `active session was completed with ${response.status}`);
  const record = await recorder.get(tokenClaims(session.sessionToken).recordId);
  assert.equal(record.stage, "attempt");
});


test("twenty parallel sessions complete without cross-learner writes in memory mode", async () => {
  const entries = Array.from({ length: 20 }, (_, index) => [`invite-${index + 1}`, `P${String(index + 1).padStart(2, "0")}`]);
  const recorder = createMemoryRecorder();
  const learningStore = createMemoryLearningStore();
  const { app } = appFixture({ entries, recorder, learningStore });

  const sessions = await Promise.all(entries.map(([inviteCode]) => start(app, inviteCode)));
  assert.equal(new Set(sessions.map((session) => session.sessionId)).size, 20);
  assert.equal(recorder.records.size, 20);

  const attempts = await Promise.all(sessions.map((session, index) => app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "attempt",
    action: "submit_attempt",
    input: `P${String(index + 1).padStart(2, "0")} attempt`,
    snapshot: session.snapshot
  }))));
  assert.ok(attempts.every((response) => response.status === 200));
  const attemptBodies = await Promise.all(attempts.map(json));

  const restatements = await Promise.all(sessions.map((session, index) => app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "restate",
    action: "submit_restate",
    input: `P${String(index + 1).padStart(2, "0")} restatement`,
    snapshot: attemptBodies[index].snapshot
  }))));
  assert.ok(restatements.every((response) => response.status === 200));
  const restateBodies = await Promise.all(restatements.map(json));

  const revisions = await Promise.all(sessions.map((session, index) => app.handle(request("/api/session/step", {
    sessionToken: session.sessionToken,
    stage: "revision",
    action: "submit_revision",
    input: `P${String(index + 1).padStart(2, "0")} revision`,
    snapshot: restateBodies[index].snapshot
  }))));
  assert.ok(revisions.every((response) => response.status === 200));
  const revisionBodies = await Promise.all(revisions.map(json));
  assert.ok(revisionBodies.every((body) => body.nextStage === "complete"));
  assert.equal(recorder.records.size, 20);

  const syncBodies = await Promise.all(entries.map(async ([inviteCode, participantCode]) => {
    const body = await json(await app.handle(request("/api/learner/sync", { inviteCode })));
    assert.equal(body.participantCode, participantCode);
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].stage, "complete");
    assert.equal(body.profile.masteryCount, 1);
    const bodyText = JSON.stringify(body);
    assert.match(bodyText, new RegExp(`${participantCode} revision`));
    for (const [, otherParticipant] of entries.filter(([, code]) => code !== participantCode)) {
      assert.doesNotMatch(bodyText, new RegExp(`${otherParticipant} revision`));
    }
    return body;
  }));
  assert.equal(syncBodies.length, 20);
});


test("production config does not silently enable the public demo invite", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "production", SESSION_SIGNING_SECRET: SECRET }),
    /邀请码/
  );
});
