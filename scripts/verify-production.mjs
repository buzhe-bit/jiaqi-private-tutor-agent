import { createHash } from "node:crypto";

const baseUrl = String(process.env.PILOT_BASE_URL || "").replace(/\/$/, "");
const participantCode = process.env.PILOT_PARTICIPANT_CODE || "P01";
const profileName = process.env.PILOT_SMOKE_PROFILE || "unknown";

if (!baseUrl) throw new Error("缺少 PILOT_BASE_URL");

let invites;
try {
  invites = JSON.parse(process.env.INVITE_CODES_JSON || "");
} catch {
  throw new Error("INVITE_CODES_JSON 不是有效 JSON");
}

const inviteEntry = Object.entries(invites).find(
  ([, metadata]) => metadata.participantCode === participantCode
);
if (!inviteEntry) throw new Error(`找不到 ${participantCode} 的邀请码`);

const [inviteCode] = inviteEntry;

const profiles = {
  unknown: {
    attempt: "我不知道",
    helpAction: "request_explanation",
    helpInput: "给我讲明白",
    restate:
      "理论理性限制知识的边界，因此不能证明自由却也不能否定自由，为自由留下可能；实践理性通过道德法则必须预设自由，使自由获得实践意义。",
    revisions: [
      "理论理性把知识限制在现象界，不能证明自由，却也不能用自然因果否定自由，为自由留下可能；实践理性从道德法则出发，必须预设自由。",
      "理论理性把知识限制在现象界，不能证明自由，也不能用自然因果否定物自身层面的自由，为自由留下可能；实践理性从道德法则出发，要求主体能够依理性自我立法，使自由成为道德实践的必要条件。",
      "理论理性把知识限制在现象界，不能把自由当作知识对象，也不能让自然因果越界否定物自身层面的自由，因此只为自由留下理论可能；实践理性从道德法则的无条件要求出发，必须预设主体能够依理性自我立法，使自由成为义务、责任和自律成立的必要条件。理论理性清除理论上的否定，实践理性赋予自由实践必然性，这一连接使自由成为批判哲学体系的拱顶石。"
    ]
  },
  expression: {
    attempt:
      "理论理性不能认识自由，只能给自由留位置。实践理性里有道德法则，所以又需要自由。我知道大概是这两个层次，但不知道怎样把它们连成一段论证。",
    revisions: [
      "理论理性把知识限制在现象界，不能证明自由，也不能用自然因果否定自由；实践理性从道德法则出发要求预设自由。",
      "理论理性把知识限制在现象界，因此不能证明自由，也不能用自然因果否定物自身层面的自由，为自由留下可能；实践理性从道德法则出发要求预设主体能够自由自我立法，使自由成为道德实践的必要条件。",
      "理论理性把知识限制在现象界，因此自然因果不能越界否定物自身层面的自由，这只是为自由留下理论上的可能；实践理性则从道德法则的无条件要求出发，必须预设主体能够依理性自我立法，使自由成为义务、责任和自律成立的必要条件。前者清除理论上的否定，后者赋予自由实践上的必然性。"
    ]
  },
  independent: {
    attempt:
      "康德并不是用理论理性证明自由。理论理性通过区分现象与物自身，把自然因果限制在经验对象上，从而既不能认识自由，也无权否定自由，为自由留下可能。实践理性则从无条件的道德法则出发：应当预设能够，因此主体必须被设想为能依理性自我立法的自由者。自由由此既是道德法则的存在根据，又通过道德法则获得实践上的认识。它连接了理论理性的限界与实践理性的自律，因而成为批判哲学体系的拱顶石。",
    revision:
      "理论理性通过现象与物自身的区分限制自然因果的适用范围，使自由虽不能成为知识，却不再能被理论否定；实践理性再从道德法则的无条件要求反推主体必须能够自由自我立法，使自由成为义务、责任和自律成立的必要条件。理论理性为自由留下位置，实践理性赋予自由实践必然性，这一连接使自由成为贯通康德批判哲学的拱顶石。"
  }
};

const profile = profiles[profileName];
if (!profile) {
  throw new Error(`未知 PILOT_SMOKE_PROFILE：${profileName}`);
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

const health = await get("/api/health");
if (health.coachMode !== "real") {
  throw new Error(`线上私教没有使用真实模型：${health.coachMode || "unknown"}`);
}

const recommendation = await post("/api/practice/next", { inviteCode });
if (!recommendation.questionId || !recommendation.question) {
  throw new Error("下一题推荐依赖没有准备好");
}

const learner = await post("/api/learner/sync", { inviteCode });
if (learner.participantCode !== participantCode || !learner.profile) {
  throw new Error("个人学习档案依赖没有准备好");
}

console.log(
  `发布前置检查通过：real coach / ${recommendation.questionKind} / ${learner.profile.masteryCount} 条掌握记录`
);

function transitionEntry(stage, action, result) {
  return {
    stage,
    action,
    nextStage: result.nextStage,
    focusCharacters: String(result.feedback?.focus || "").length,
    teachingCharacters: String(result.feedback?.teaching || "").length
  };
}

const started = await post("/api/session/start", { inviteCode, consent: true });
const sessionToken = started.sessionToken;
const claims = JSON.parse(
  Buffer.from(sessionToken.split(".")[0], "base64url").toString("utf8")
);

let stage = started.stage;
let snapshot = started.snapshot;
const transitions = [];

async function step(action, input = "") {
  const currentStage = stage;
  const inputText = String(input);
  const inputDigest = createHash("sha256")
    .update(inputText)
    .digest("hex")
    .slice(0, 12);
  const result = await post("/api/session/step", {
    sessionToken,
    stage: currentStage,
    action,
    input: inputText,
    snapshot
  });
  transitions.push(transitionEntry(currentStage, action, result));
  console.log(
    `${currentStage} --${action}--> ${result.nextStage} (input-length=${inputText.length}, input-sha256=${inputDigest})`
  );
  stage = result.nextStage;
  snapshot = result.snapshot;
  return result;
}

console.log(`开始线上主路径验证：${profileName} / ${participantCode}`);
await step("submit_attempt", profile.attempt);

if (stage === "teaching") {
  await step(profile.helpAction || "request_explanation", profile.helpInput || "");
  stage = "restate";
}

let revisionRound = 0;

for (let round = 0; stage === "restate" && round < 3; round += 1) {
  await step(
    "submit_restate",
      profile.restate ??
      profile.revisions?.[revisionRound++] ??
      profile.revisions?.at(-1) ??
      profile.revision
  );
  if (stage === "teaching") {
    await step("request_example");
    stage = "restate";
  }
}

for (let round = 0; stage === "revision" && round < 3; round += 1) {
  await step(
    "submit_revision",
    profile.revisions?.[revisionRound++] ??
      profile.revisions?.at(-1) ??
      profile.revision
  );
}

if (stage !== "complete") {
  throw new Error(`学习闭环未完成，当前阶段：${stage}`);
}

const completed = await post("/api/session/complete", {
  sessionToken,
  snapshot,
  reflection: {}
});

console.log(
  `E2E_RESULT=${JSON.stringify({
    profile: profileName,
    participantCode: started.participantCode,
    sessionId: claims.sessionId,
    recordId: claims.recordId,
    stage: completed.stage,
    saved: completed.saved,
    transitions
  })}`
);
