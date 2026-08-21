import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCloudbaseCoach, createMockCoach } from "../src/coach/providers.mjs";
import { normalizeCoachResponse } from "../src/coach/response-contract.mjs";
import { expectedGatesForAction } from "../src/coach/state-machine.mjs";
import { createFeishuBaseRecorder, sessionToFields } from "../src/records/feishu-base-recorder.mjs";
import { createMemoryRecorder } from "../src/records/memory-recorder.mjs";


const COACH_ACTIONS = [
  "submit_attempt",
  "request_hint",
  "request_explanation",
  "request_example",
  "request_reference",
  "ask_followup",
  "submit_restate",
  "submit_revision"
];


function modelFeedback(overrides = {}) {
  return {
    gate: "TEACH",
    learnerNeed: "knowledge_gap",
    message: "你现在缺的是自由怎样连接两种理性。",
    studentEvidence: "你已经意识到理论理性和实践理性需要区分。",
    missingPoint: "还需要说明自由怎样把两个层次连接起来。",
    focus: "理论理性留下可能，实践理性赋予实践意义。",
    teaching: "",
    nextActions: ["hint", "explain", "example", "reference", "restate"],
    sourceStatus: "有材料支持",
    diagnosis: {
      subject: "philosophy",
      topic: "康德的自由问题",
      thinker: "康德",
      concepts: ["理论理性", "实践理性", "自由"],
      knowledgeRelations: ["理论理性为自由留下可能，实践理性赋予自由实践意义"],
      issueType: "relation_broken",
      misconception: "",
      expressionIssue: "两个层次仍然并列",
      evidence: "学生分别提到了两种理性，但没有说明自由怎样连接两者。",
      diagnosis: "当前缺少可能性与实践必要性之间的连接",
      masteryStatus: "unstable",
      sourceStatus: "ai_synthesized",
      sourceLabel: "AI 综合当前题目知识边界作出的解释",
      confidence: "medium"
    },
    ...overrides
  };
}


test("coach response requires a structured diagnosis", () => {
  const raw = modelFeedback();
  delete raw.diagnosis;
  assert.throws(
    () => normalizeCoachResponse(raw, "submit_attempt"),
    /结构化诊断/
  );
});


test("coach response rejects an unknown diagnosis issue type", () => {
  assert.throws(
    () => normalizeCoachResponse(modelFeedback({
      diagnosis: { ...modelFeedback().diagnosis, issueType: "vague_problem" }
    }), "submit_attempt"),
    /卡点类型/
  );
});


test("coach response accepts one knowledge relation returned as a string", () => {
  const feedback = modelFeedback();
  feedback.diagnosis.knowledgeRelations = "理论理性为自由留下可能，实践理性赋予自由实践意义";

  const normalized = normalizeCoachResponse(feedback, "submit_attempt");
  assert.deepEqual(normalized.diagnosis.knowledgeRelations, [
    "理论理性为自由留下可能，实践理性赋予自由实践意义"
  ]);
});


test("coach response accepts every action-specific gate without changing it", () => {
  for (const action of COACH_ACTIONS) {
    for (const gate of expectedGatesForAction(action)) {
      const normalized = normalizeCoachResponse(modelFeedback({
        gate,
        teaching: action === "request_reference" ? "一种可行作答" : ""
      }), action);
      assert.equal(normalized.gate, gate);
    }
  }
});


test("coach response rejects an unknown gate without exposing its value", () => {
  const secretGate = "MODEL-ONLY-GATE";
  for (const action of COACH_ACTIONS) {
    assert.throws(
      () => normalizeCoachResponse(modelFeedback({ gate: secretGate }), action),
      (error) => {
        assert.match(error.message, /当前动作不允许的 gate/);
        assert.doesNotMatch(error.message, new RegExp(secretGate));
        return true;
      }
    );
  }
});


test("a completed revision accepts an empty remaining gap", () => {
  const normalized = normalizeCoachResponse(modelFeedback({
    gate: "CLOSE_LOOP",
    learnerNeed: "ready",
    missingPoint: "",
    nextActions: [],
    diagnosis: {
      ...modelFeedback().diagnosis,
      issueType: "basically_mastered",
      expressionIssue: "",
      masteryStatus: "developing",
      confidence: "high"
    }
  }), "submit_revision");

  assert.equal(normalized.gate, "CLOSE_LOOP");
  assert.equal(normalized.missingPoint, "本轮关键关系已经补上。");
});


test("low-confidence diagnosis cannot mark a learner stable", () => {
  const result = normalizeCoachResponse(modelFeedback({
    diagnosis: {
      ...modelFeedback().diagnosis,
      issueType: "basically_mastered",
      masteryStatus: "stable",
      confidence: "low"
    }
  }), "submit_attempt");

  assert.equal(result.diagnosis.masteryStatus, "developing");
});


test("mock coach supports retrieval, teaching, restatement and revision", async () => {
  const coach = createMockCoach();
  const attempt = await coach.evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "不知道"
  });
  assert.equal(attempt.gate, "TEACH");

  const explanation = await coach.evaluate({
    action: "request_explanation",
    snapshot: { initialAnswer: "不知道" },
    input: ""
  });
  assert.equal(explanation.gate, "TEACH");
  assert.match(explanation.teaching, /理论理性/);
  assert.match(explanation.teaching, /要解决的问题/);
  assert.match(explanation.teaching, /例如|可以把/);

  const restatement = await coach.evaluate({
    action: "submit_restate",
    snapshot: { initialAnswer: "不知道" },
    input: "理论理性留下自由的可能，实践理性通过道德法则赋予自由实践意义。"
  });
  assert.equal(restatement.gate, "REVISE");

  const revision = await coach.evaluate({
    action: "submit_revision",
    snapshot: { initialAnswer: "不知道", repairResponse: "已复述" },
    input: "理论理性限制知识而为自由留下可能，实践理性通过道德法则赋予自由实践意义。"
  });
  assert.equal(revision.gate, "CLOSE_LOOP");
});


test("mock coach changes teaching shape after a second failed explanation", async () => {
  const coach = createMockCoach();
  const first = await coach.evaluate({
    action: "ask_followup",
    snapshot: { initialAnswer: "不知道", intervention: "【request_explanation】已经讲过基本关系" },
    input: "我还是没听懂"
  });
  const second = await coach.evaluate({
    action: "ask_followup",
    snapshot: {
      initialAnswer: "不知道",
      intervention: "【request_explanation】已经讲过基本关系\n\n【ask_followup】已经换成两个问题"
    },
    input: "还是没懂"
  });

  assert.match(first.teaching, /第一问|第二问/);
  assert.match(second.teaching, /反过来|反例|假设/);
  assert.notEqual(second.teaching, first.teaching);
});


test("mock coach labels a requested reference as one possible answer", async () => {
  const coach = createMockCoach();
  const reference = await coach.evaluate({
    action: "request_reference",
    snapshot: { initialAnswer: "不知道" },
    input: ""
  });

  assert.equal(reference.gate, "TEACH");
  assert.match(reference.teaching, /一种可行作答/);
  assert.doesNotMatch(reference.teaching, /标准答案/);
});


test("mock coach recognizes P04's theoretical-reason progress and teaches the missing practical link", async () => {
  const coach = createMockCoach();
  const result = await coach.evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "理论理性中，自然因果只适用于现象，物自身不可知，所以不能把自然因果扩展到物自身。实践理性我只知道可能会带上自由。"
  });

  assert.equal(result.gate, "TEACH");
  assert.match(result.studentEvidence, /理论理性.*不能.*自由|自然因果.*现象|物自身/);
  assert.match(result.missingPoint, /道德法则.*实践意义.*连接/);
});


test("CloudBase coach parses the teaching response contract", async () => {
  const calls = [];
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    modelName: "deepseek-v4-flash",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(modelFeedback())}\n\`\`\`` } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await coach.evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "不知道"
  });
  assert.equal(result.gate, "TEACH");
  const requestBody = JSON.parse(calls[0].options.body);
  assert.match(calls[0].url, /env-test\.api\.tcloudbasegateway\.com/);
  assert.equal(calls[0].options.headers.authorization, "Bearer key-test");
  assert.equal(requestBody.model, "deepseek-v4-flash");
  assert.equal(requestBody.messages[0].role, "system");
});


test("CloudBase coach allows a realistic model window for the full tutor prompt", async () => {
  let timeoutMs;
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    timeoutSignal: (milliseconds) => {
      timeoutMs = milliseconds;
      return new AbortController().signal;
    },
    fetchImpl: async (_url, options) => {
      assert.equal(options.signal.aborted, false);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelFeedback()) } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  await coach.evaluate({ action: "submit_attempt", snapshot: {}, input: "不知道" });
  assert.equal(timeoutMs >= 45_000, true);
});


test("CloudBase coach treats an unknown source status as unverified", async () => {
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelFeedback({ sourceStatus: "ok" })) } }]
    }), { status: 200, headers: { "content-type": "application/json" } })
  });

  const result = await coach.evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "不知道"
  });
  assert.equal(result.sourceStatus, "待核实");
});


test("CloudBase coach retries one invalid model response", async () => {
  let calls = 0;
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    logger: { warn: () => {} },
    fetchImpl: async () => {
      calls += 1;
      const response = calls === 1
        ? modelFeedback({ gate: "CLOSE_LOOP" })
        : modelFeedback();
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(response) } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await coach.evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "不知道"
  });
  assert.equal(calls, 2);
  assert.equal(result.gate, "TEACH");
});


test("CloudBase coach logs sanitized parse diagnostics for invalid model JSON", async () => {
  const logs = [];
  const modelText = '{"studentAnswer":"MODEL-SECRET", broken';
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    delay: async () => {},
    logger: { warn: (entry) => logs.push(entry) },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: modelText } }]
    }), { status: 200, headers: { "content-type": "application/json" } })
  });

  await assert.rejects(
    () => coach.evaluate({ action: "submit_attempt", snapshot: {}, input: "STUDENT-SECRET" }),
    (error) => error.code === "COACH_INVALID_RESPONSE" && error.status === 503
  );

  assert.deepEqual(logs, [1, 2].map((attempt) => ({
    code: "COACH_INVALID_RESPONSE",
    attempt,
    providerStatus: 200,
    finish_reason: "stop",
    contentLength: modelText.length,
    failureStage: "parse",
    errorCategory: "invalid_json"
  })));
  assert.doesNotMatch(JSON.stringify(logs), /MODEL-SECRET|STUDENT-SECRET|key-test/);
});


test("CloudBase coach logs sanitized normalize diagnostics without model values", async () => {
  const logs = [];
  const modelText = JSON.stringify(modelFeedback({ gate: "MODEL-SECRET-GATE" }));
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    delay: async () => {},
    logger: { warn: (entry) => logs.push(entry) },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: modelText } }]
    }), { status: 200, headers: { "content-type": "application/json" } })
  });

  await assert.rejects(
    () => coach.evaluate({ action: "submit_attempt", snapshot: {}, input: "STUDENT-SECRET" }),
    (error) => error.code === "COACH_INVALID_RESPONSE" && error.status === 503
  );

  assert.deepEqual(logs, [1, 2].map((attempt) => ({
    code: "COACH_INVALID_RESPONSE",
    attempt,
    providerStatus: 200,
    finish_reason: "length",
    contentLength: modelText.length,
    failureStage: "normalize",
    errorCategory: "invalid_gate",
    expectedGates: ["TEACH", "REVISE"]
  })));
  assert.doesNotMatch(JSON.stringify(logs), /MODEL-SECRET|STUDENT-SECRET|key-test/);
});


test("CloudBase coach rejects an unknown gate safely for every action", async () => {
  const secretGate = "MODEL-ONLY-GATE";
  const modelText = JSON.stringify(modelFeedback({ gate: secretGate }));

  for (const action of COACH_ACTIONS) {
    const logs = [];
    const coach = createCloudbaseCoach({
      envId: "env-test",
      apiKey: "key-test",
      delay: async () => {},
      logger: { warn: (entry) => logs.push(entry) },
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: modelText } }]
      }), { status: 200, headers: { "content-type": "application/json" } })
    });

    await assert.rejects(
      () => coach.evaluate({ action, snapshot: {}, input: "STUDENT-SECRET" }),
      (error) => {
        assert.equal(error.code, "COACH_INVALID_RESPONSE");
        assert.equal(error.status, 503);
        assert.doesNotMatch(error.message, new RegExp(secretGate));
        return true;
      }
    );
    assert.equal(logs.length, 2);
    for (const entry of logs) {
      assert.deepEqual(entry.expectedGates, expectedGatesForAction(action));
      assert.doesNotMatch(JSON.stringify(entry), new RegExp(secretGate));
    }
  }
});


test("CloudBase coach retries one non-2xx response and succeeds", async () => {
  let calls = 0;
  let delays = 0;
  const logs = [];
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    delay: async () => { delays += 1; },
    logger: { warn: (entry) => logs.push(entry) },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ requestId: "req-first" }), {
          status: 503,
          headers: { "content-type": "application/json", "x-request-id": "req-first" }
        });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelFeedback()) } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await coach.evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "这是学生的私密答案"
  });

  assert.equal(result.gate, "TEACH");
  assert.equal(calls, 2);
  assert.equal(delays, 1);
  assert.deepEqual(logs, [{
    code: "COACH_UPSTREAM_ERROR",
    status: 503,
    requestId: "req-first",
    action: "submit_attempt",
    attempt: 1
  }]);
  assert.equal(JSON.stringify(logs).includes("这是学生的私密答案"), false);
  assert.equal(JSON.stringify(logs).includes("key-test"), false);
});


test("CloudBase coach stops after two upstream HTTP failures", async () => {
  let calls = 0;
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    delay: async () => {},
    logger: { warn: () => {} },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ requestId: `req-${calls}` }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await assert.rejects(
    () => coach.evaluate({ action: "submit_attempt", snapshot: {}, input: "不知道" }),
    (error) => error.code === "COACH_UPSTREAM_ERROR" && error.status === 503
  );
  assert.equal(calls, 2);
});


test("CloudBase coach retries one network failure and succeeds", async () => {
  let calls = 0;
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    delay: async () => {},
    logger: { warn: () => {} },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("temporary network failure");
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelFeedback()) } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await coach.evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "不知道"
  });
  assert.equal(result.gate, "TEACH");
  assert.equal(calls, 2);
});


test("CloudBase coach fails closed when credentials or model output are missing", async () => {
  assert.throws(() => createCloudbaseCoach({ envId: "", apiKey: "" }), /未配置/);
  const coach = createCloudbaseCoach({
    envId: "env-test",
    apiKey: "key-test",
    fetchImpl: async () => new Response("{}", { status: 200 })
  });
  await assert.rejects(
    () => coach.evaluate({ action: "submit_attempt", snapshot: {}, input: "不知道" }),
    /未返回可用内容/
  );
});


test("memory recorder creates and updates one session", async () => {
  const recorder = createMemoryRecorder();
  const recordId = await recorder.create({ sessionId: "s1", participantCode: "P01", stage: "attempt" });
  await recorder.update(recordId, { sessionId: "s1", participantCode: "P01", stage: "teaching" });
  assert.equal(recorder.records.get(recordId).stage, "teaching");
  assert.deepEqual(
    (await recorder.listByParticipant("P01")).map((record) => record.sessionId),
    ["s1"]
  );
});


test("session field mapping records internal diagnosis without changing the Base schema", () => {
  const fields = sessionToFields({
    sessionId: "s1",
    participantCode: "P01",
    cohort: "consulted",
    stage: "teaching",
    startedAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:02:00.000Z",
    elapsedSeconds: 120,
    snapshot: {
      sourceExcerpt: "资料",
      initialAnswer: "不知道",
      primaryIssue: "两种理性的连接",
      intervention: "已讲解关键关系",
      repairResponse: "学生复述",
      rewrittenAnswer: "学生改写",
      closureFeedback: "闭环"
    },
    feedback: modelFeedback(),
    reflection: { uxConfusion: "无" }
  });

  assert.equal(fields["会话编号"], "s1");
  assert.equal(fields["首要问题"], "还需要说明自由怎样把两个层次连接起来。");
  assert.match(fields["理解证据"], /knowledge_gap/);
  assert.match(fields["理解证据"], /已经意识到理论理性和实践理性需要区分/);
  assert.equal(JSON.stringify(fields).includes("invite"), false);
});


test("Feishu Base schema covers every field written by the recorder", async () => {
  const schema = JSON.parse(await readFile(new URL("../ops/feishu-base-fields.json", import.meta.url), "utf8"));
  const writtenFields = sessionToFields({ sessionId: "s1", snapshot: {} });
  assert.deepEqual(
    schema.map((field) => field.name).sort(),
    Object.keys(writtenFields).sort()
  );
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
    stage: "attempt",
    snapshot: {}
  };
  const recordId = await recorder.create(session);
  await recorder.update(recordId, { ...session, stage: "teaching" });

  assert.equal(recordId, "rec-1");
  assert.equal(requests.length, 3);
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[2].options.method, "PUT");
  assert.equal(requests[2].url.endsWith("/records/rec-1"), true);
});
