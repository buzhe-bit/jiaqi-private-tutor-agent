import assert from "node:assert/strict";
import test from "node:test";

import { createCloudbaseCoach, createMockCoach } from "../src/coach/providers.mjs";
import { createFeishuBaseRecorder, sessionToFields } from "../src/records/feishu-base-recorder.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";


test("mock coach supports the full evidence-gated path", async () => {
  const coach = createMockCoach();
  const interpretation = await coach.evaluate({
    action: "interpretation",
    snapshot: {},
    input: "题目要求解释自由为什么能够连接理论理性和实践理性。"
  });
  assert.equal(interpretation.gate, "SUBMIT_ATTEMPT");

  const attempt = await coach.evaluate({
    action: "attempt",
    snapshot: {},
    input: "理论理性讨论自然因果，实践理性讨论道德自由。"
  });
  assert.equal(attempt.gate, "REPAIR_ONE_ISSUE");

  const repair = await coach.evaluate({
    action: "repair",
    snapshot: { primaryIssue: attempt.primaryIssue },
    input: "理论理性只留下自由的可能，实践理性通过道德法则让自由成为行动的必要条件。"
  });
  assert.equal(repair.gate, "REWRITE");

  const rewrite = await coach.evaluate({
    action: "rewrite",
    snapshot: {},
    input: "这里是一段完成连接后的重写答案，能够对照前后的论证变化。"
  });
  assert.equal(rewrite.gate, "CLOSE_LOOP");
});

test("CloudBase coach parses model JSON and enforces the response contract", async () => {
  const calls = [];
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    modelName: "deepseek-v4-flash",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "```json\n{\"gate\":\"SUBMIT_ATTEMPT\",\"descriptiveState\":\"基本理解\",\"overall\":\"已经抓住题目关系。\",\"evidence\":[{\"quote\":\"连接两种理性\",\"meaning\":\"抓住题眼。\"}],\"primaryIssue\":\"\",\"sourceStatus\":\"待核实\",\"nextAction\":\"请提交当前最好版本。\"}\n```" } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await coach.evaluate({
    action: "interpretation",
    snapshot: {},
    input: "自由连接两种理性。"
  });
  assert.equal(result.gate, "SUBMIT_ATTEMPT");
  const requestBody = JSON.parse(calls[0].options.body);
  assert.match(calls[0].url, /env-test\.api\.tcloudbasegateway\.com/);
  assert.equal(calls[0].options.headers.authorization, "Bearer key-test");
  assert.equal(requestBody.model, "deepseek-v4-flash");
  assert.equal(requestBody.messages[0].role, "system");
});

test("CloudBase coach fails closed when credentials or model output are missing", async () => {
  assert.throws(() => createCloudbaseCoach({ envId: "", apiKey: "" }), /未配置/);
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    fetchImpl: async () => new Response("{}", { status: 200 })
  });
  await assert.rejects(
    () => coach.evaluate({ action: "attempt", snapshot: {}, input: "学生初答" }),
    /未返回可用内容/
  );
});

test("memory recorder creates and updates one session", async () => {
  const recorder = createMemoryRecorder();
  const recordId = await recorder.create({ sessionId: "s1", stage: "interpretation" });
  await recorder.update(recordId, { sessionId: "s1", stage: "attempt" });
  assert.equal(recorder.records.get(recordId).stage, "attempt");
});

test("session field mapping contains review evidence but never an invite secret", () => {
  const fields = sessionToFields({
    sessionId: "s1",
    participantCode: "P01",
    cohort: "consulted",
    stage: "repair",
    startedAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:02:00.000Z",
    elapsedSeconds: 120,
    snapshot: {
      sourceExcerpt: "资料",
      questionInterpretation: "题目理解",
      initialAnswer: "初答",
      primaryIssue: "首要问题",
      intervention: "干预动作",
      repairResponse: "学生回应",
      rewrittenAnswer: "重写",
      closureFeedback: "闭环"
    },
    feedback: {
      evidence: [{ quote: "原句", meaning: "证据" }],
      sourceStatus: "有材料支持"
    },
    reflection: {
      studentExplanation: "自述",
      diagnosisHit: "是",
      willingReuse: "是",
      uxConfusion: "无"
    }
  });

  assert.equal(fields["会话编号"], "s1");
  assert.equal(fields["首要问题"], "首要问题");
  assert.equal(fields["理解证据"].includes("原句"), true);
  assert.equal(JSON.stringify(fields).includes("invite"), false);
});

test("Feishu recorder reuses app token and writes create then update", async () => {
  const requests = [];
  const responses = [
    { code: 0, app_access_token: "app-token", expire: 7200 },
    { code: 0, data: { record: { record_id: "rec-1" } } },
    { code: 0, data: { record: { record_id: "rec-1" } } }
  ];
  const recorder = createFeishuBaseRecorder({
    appId: "app-id",
    appSecret: "app-secret",
    baseToken: "base-token",
    tableId: "table-id",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const session = {
    sessionId: "s1",
    participantCode: "P01",
    cohort: "consulted",
    stage: "interpretation",
    snapshot: {}
  };
  const recordId = await recorder.create(session);
  await recorder.update(recordId, { ...session, stage: "attempt" });

  assert.equal(recordId, "rec-1");
  assert.equal(requests.length, 3);
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[2].options.method, "PUT");
  assert.equal(requests[2].url.endsWith("/records/rec-1"), true);
});
