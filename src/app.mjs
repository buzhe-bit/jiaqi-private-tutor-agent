import { randomUUID } from "node:crypto";

import { normalizeCoachResponse } from "./coach/response-contract.mjs";
import { nextStageFor } from "./coach/state-machine.mjs";
import { createSessionCodec } from "./session-token.mjs";


export const QUESTION_TEXT = "在康德哲学中，自由‘构成了纯粹的，甚至思辨理性体系的整个建筑的拱顶石’。试从理论理性和实践理性两个层次说明之。";

const SNAPSHOT_FIELDS = [
  "questionInterpretation",
  "sourceExcerpt",
  "initialAnswer",
  "primaryIssue",
  "intervention",
  "repairResponse",
  "rewrittenAnswer",
  "closureFeedback"
];


function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" }
  });
}


function cleanText(value, maxLength = 12000) {
  return String(value || "").trim().slice(0, maxLength);
}


function cleanSnapshot(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    SNAPSHOT_FIELDS.map((field) => [field, cleanText(source[field])])
  );
}


function elapsedSeconds(startedAt, now) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.round((now.getTime() - start) / 1000));
}


function inviteMetadata(config, inviteCode) {
  return config.invites.get(cleanText(inviteCode, 200));
}


function sessionRecord({ body, claims, stage, snapshot, feedback, now }) {
  return {
    sessionId: cleanText(claims.sessionId, 100),
    participantCode: cleanText(claims.participantCode, 100),
    cohort: cleanText(claims.cohort, 40),
    stage,
    startedAt: cleanText(claims.startedAt, 80),
    updatedAt: now.toISOString(),
    elapsedSeconds: elapsedSeconds(claims.startedAt, now),
    snapshot,
    feedback: feedback || null,
    reflection: body.reflection || null
  };
}


async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw Object.assign(new Error("请求必须使用 JSON"), { status: 415 });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("请求 JSON 无法解析"), { status: 400 });
  }
}


export function createApp({ config, coach, recorder, now = () => new Date() }) {
  const sessionCodec = createSessionCodec(config.sessionSigningSecret || "local-development-only");

  function sessionClaims(body) {
    try {
      return sessionCodec.verify(cleanText(body.sessionToken, 4000));
    } catch {
      throw Object.assign(new Error("本次陪练状态已失效，请重新打开老师发送的链接"), { status: 401 });
    }
  }

  async function startSession(request) {
    const body = await readJson(request);
    const metadata = inviteMetadata(config, body.inviteCode);
    if (!metadata) return json({ error: "这个试用链接无效或已过期" }, 403);
    if (body.consent !== true) return json({ error: "需要先确认匿名试用说明" }, 400);

    const startedAt = now().toISOString();
    const sessionId = randomUUID();
    const session = {
      sessionId,
      participantCode: metadata.participantCode,
      cohort: metadata.cohort,
      stage: "interpretation",
      startedAt,
      updatedAt: startedAt,
      elapsedSeconds: 0,
      snapshot: cleanSnapshot({}),
      feedback: null,
      reflection: null
    };
    const recordId = await recorder.create(session);
    const sessionToken = sessionCodec.sign({
      sessionId,
      recordId,
      participantCode: metadata.participantCode,
      cohort: metadata.cohort,
      startedAt,
      stage: "interpretation"
    });
    return json({
      sessionToken,
      participantCode: metadata.participantCode,
      stage: "interpretation",
      startedAt,
      question: QUESTION_TEXT,
      snapshot: session.snapshot
    }, 201);
  }

  async function processStep(request) {
    const body = await readJson(request);
    const claims = sessionClaims(body);

    const stage = cleanText(body.stage, 40);
    if (!new Set(["interpretation", "attempt", "repair", "rewrite"]).has(stage)) {
      return json({ error: "当前学习阶段无效，请刷新后重试" }, 400);
    }
    const input = cleanText(body.input);
    if (input.length < 5) {
      return json({ error: "请至少写下一个完整的想法，再提交这一步" }, 400);
    }

    const snapshot = cleanSnapshot(body.snapshot);
    if (stage === "interpretation") snapshot.questionInterpretation = input;
    if (stage === "attempt") snapshot.initialAnswer = input;
    if (stage === "repair") snapshot.repairResponse = input;
    if (stage === "rewrite") snapshot.rewrittenAnswer = input;

    const rawFeedback = await coach.evaluate({ action: stage, snapshot, input });
    const feedback = normalizeCoachResponse(rawFeedback, stage);
    const nextStage = nextStageFor(stage, feedback.gate);

    if (feedback.gate === "REPAIR_ONE_ISSUE") {
      snapshot.primaryIssue = feedback.primaryIssue;
      snapshot.intervention = feedback.nextAction;
    }
    if (stage === "rewrite") {
      snapshot.closureFeedback = feedback.overall;
    }

    await recorder.update(cleanText(claims.recordId, 120), sessionRecord({
      body,
      claims,
      stage: nextStage,
      snapshot,
      feedback,
      now: now()
    }));

    return json({ feedback, nextStage, snapshot });
  }

  async function completeSession(request) {
    const body = await readJson(request);
    const claims = sessionClaims(body);

    const reflection = {
      studentExplanation: cleanText(body.reflection?.studentExplanation, 1200),
      diagnosisHit: cleanText(body.reflection?.diagnosisHit, 20),
      willingReuse: cleanText(body.reflection?.willingReuse, 20),
      uxConfusion: cleanText(body.reflection?.uxConfusion, 1200)
    };
    if (
      !reflection.studentExplanation
      || !["是", "部分", "否"].includes(reflection.diagnosisHit)
      || !["是", "否"].includes(reflection.willingReuse)
    ) {
      return json({ error: "请先完成最后的自我说明和诊断评价" }, 400);
    }

    const snapshot = cleanSnapshot(body.snapshot);
    await recorder.update(cleanText(claims.recordId, 120), sessionRecord({
      body: { ...body, reflection },
      claims,
      stage: "complete",
      snapshot,
      now: now()
    }));
    return json({ stage: "complete", saved: true });
  }

  return {
    async handle(request) {
      try {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/api/health") {
          return json({ ok: true, product: "philosophy-answer-coach" });
        }
        if (request.method === "POST" && url.pathname === "/api/session/start") {
          return await startSession(request);
        }
        if (request.method === "POST" && url.pathname === "/api/session/step") {
          return await processStep(request);
        }
        if (request.method === "POST" && url.pathname === "/api/session/complete") {
          return await completeSession(request);
        }
        return json({ error: "接口不存在" }, 404);
      } catch (error) {
        const status = Number(error.status) || 500;
        return json({ error: status >= 500 ? "服务暂时不可用，请稍后重试" : error.message }, status);
      }
    }
  };
}
