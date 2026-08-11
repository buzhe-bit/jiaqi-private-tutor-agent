import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { buildCoachMessages } from "../src/coach/prompt.mjs";
import {
  normalizeCoachResponse,
  studentFacingFeedback
} from "../src/coach/response-contract.mjs";
import { nextStageFor } from "../src/coach/state-machine.mjs";
import { createSessionCodec } from "../src/session-token.mjs";


const TEST_SIGNING_SECRET = "test-session-signing-secret";


function token() {
  return createSessionCodec(TEST_SIGNING_SECRET).sign({
    sessionId: "session-1",
    recordId: "record-1",
    participantCode: "P01",
    cohort: "consulted",
    startedAt: "2026-08-03T00:00:00.000Z",
    stage: "attempt"
  });
}


function request(body) {
  return new Request("http://local.test/api/session/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionToken: token(), ...body })
  });
}


function feedback(overrides = {}) {
  return {
    gate: "TEACH",
    learnerNeed: "knowledge_gap",
    message: "你现在缺的不是措辞，而是自由怎样连接两种理性的关键关系。",
    studentEvidence: "你已经说到理论理性不能认识物自身，自然因果只适用于现象。",
    missingPoint: "还需要说明道德法则使自由获得积极的实践意义，并由此连接两种理性。",
    focus: "理论理性只为自由留下可能，实践理性才赋予它实践意义。",
    teaching: "",
    nextActions: ["hint", "explain", "example", "reference", "restate"],
    sourceStatus: "有材料支持",
    ...overrides
  };
}


function fixture(modelFeedback = feedback()) {
  const updates = [];
  const calls = [];
  const app = createApp({
    config: {
      invites: new Map([["demo", { participantCode: "P01", cohort: "consulted" }]]),
      sessionSigningSecret: TEST_SIGNING_SECRET
    },
    coach: {
      async evaluate(args) {
        calls.push(args);
        return modelFeedback;
      }
    },
    recorder: {
      async create() { return "record-1"; },
      async update(recordId, session) { updates.push({ recordId, session }); }
    }
  });
  return { app, calls, updates };
}


test("new learning states teach before restatement and revision", () => {
  assert.equal(nextStageFor("attempt", "TEACH"), "teaching");
  assert.equal(nextStageFor("attempt", "REVISE"), "revision");
  assert.equal(nextStageFor("teaching", "TEACH"), "teaching");
  assert.equal(nextStageFor("restate", "RETEACH"), "teaching");
  assert.equal(nextStageFor("restate", "REVISE"), "revision");
  assert.equal(nextStageFor("revision", "CLOSE_LOOP"), "complete");
  assert.throws(() => nextStageFor("attempt", "CLOSE_LOOP"), /不允许/);
});


test("student feedback hides evaluator vocabulary and internal source status", () => {
  const normalized = normalizeCoachResponse(feedback(), "submit_attempt");
  const visible = studentFacingFeedback(normalized);

  assert.deepEqual(Object.keys(visible), [
    "message",
    "studentEvidence",
    "missingPoint",
    "focus",
    "teaching",
    "knowledgeConnection",
    "nextActions"
  ]);
  assert.equal(visible.nextActions.includes("reference"), true);
  assert.equal("learnerNeed" in visible, false);
  assert.equal("sourceStatus" in visible, false);
  assert.doesNotMatch(JSON.stringify(visible), /材料堆积|理解证据|事实依据/);
});


test("partial understanding separates the correct part from the missing connection", async () => {
  const { app } = fixture(feedback());
  const response = await app.handle(request({
    stage: "attempt",
    action: "submit_attempt",
    snapshot: {},
    input: "理论理性只能讨论现象，自然因果不能认识物自身；实践理性可能会带上自由。"
  }));
  const body = await response.json();

  assert.match(body.feedback.studentEvidence, /理论理性.*物自身|自然因果.*现象/);
  assert.match(body.feedback.missingPoint, /道德法则.*实践意义.*连接/);
});


test("a completed loop does not need another suggested action", () => {
  const normalized = normalizeCoachResponse(feedback({
    gate: "CLOSE_LOOP",
    learnerNeed: "ready",
    nextActions: []
  }), "submit_revision");

  assert.equal(normalized.gate, "CLOSE_LOOP");
  assert.deepEqual(normalized.nextActions, []);
});


test("an empty revise action list is normalized instead of failing the student", () => {
  const normalized = normalizeCoachResponse(feedback({
    gate: "REVISE",
    learnerNeed: "expression_gap",
    nextActions: []
  }), "submit_attempt");

  assert.deepEqual(normalized.nextActions, ["revise"]);
});


test("prompt allows teaching after retrieval but never before it", () => {
  const messages = buildCoachMessages({
    action: "request_reference",
    snapshot: {
      initialAnswer: "理论理性是看事物，实践理性可能引入上帝。",
      intervention: "学生已经请求过一次讲解。"
    },
    input: "我想看看一份参考作答"
  });
  const combined = messages.map((message) => message.content).join("\n");

  assert.match(combined, /首次作答前不得提供参考作答/);
  assert.match(combined, /首次作答后/);
  assert.match(combined, /一种可行作答/);
  assert.match(combined, /讲—问—调/);
});


test("prompt carries Jiaqi's problem-chain method without turning it into a checklist", () => {
  const messages = buildCoachMessages({
    action: "request_explanation",
    snapshot: { initialAnswer: "不知道" },
    input: "请讲明白"
  });
  const combined = messages.map((message) => message.content).join("\n");

  assert.match(combined, /先输出，再输入/);
  assert.match(combined, /时代背景/);
  assert.match(combined, /回应、反对或修正/);
  assert.match(combined, /试图解决什么问题/);
  assert.match(combined, /不能.*一次性.*清单|不要.*一次性.*清单/);
});


test("an explicit '不知道' is a valid first retrieval and enters teaching", async () => {
  const { app, calls, updates } = fixture();
  const response = await app.handle(request({
    stage: "attempt",
    action: "submit_attempt",
    snapshot: {},
    input: "不知道"
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.nextStage, "teaching");
  assert.equal(body.snapshot.initialAnswer, "不知道");
  assert.equal(calls[0].action, "submit_attempt");
  assert.equal(updates.at(-1).session.stage, "teaching");
});


test("a reference answer cannot be requested before the first retrieval", async () => {
  const { app, calls } = fixture();
  const response = await app.handle(request({
    stage: "teaching",
    action: "request_reference",
    snapshot: {},
    input: ""
  }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /先完成一次自己的尝试/);
  assert.equal(calls.length, 0);
});


test("an observable rewrite closes the loop even when the model is overly strict", async () => {
  const { app, updates } = fixture(feedback({
    gate: "REVISE",
    learnerNeed: "expression_gap",
    message: "还可以继续修改。",
    nextActions: ["revise"]
  }));
  const response = await app.handle(request({
    stage: "revision",
    action: "submit_revision",
    snapshot: { initialAnswer: "我不知道" },
    input: "理论理性为自由留下可能，实践理性则通过道德法则使自由成为不可缺少的实践条件。"
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.nextStage, "complete");
  assert.match(body.feedback.message, /完成了一次表达改进/);
  assert.equal(updates.at(-1).session.stage, "complete");
});


test("optional product feedback never blocks a completed learning loop", async () => {
  const { app, updates } = fixture();
  const response = await app.handle(new Request("http://local.test/api/session/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionToken: token(),
      snapshot: {
        initialAnswer: "不知道",
        repairResponse: "理论理性留下自由的可能，实践理性赋予自由实践意义。",
        rewrittenAnswer: "自由连接了理论理性的边界与实践理性的道德要求。"
      },
      reflection: {}
    })
  }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).stage, "complete");
  assert.equal(updates.at(-1).session.stage, "complete");
});
