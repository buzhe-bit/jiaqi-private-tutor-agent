const baseUrl = String(process.env.PILOT_BASE_URL || "").replace(/\/$/, "");
const participantCode = process.env.PILOT_PARTICIPANT_CODE || "P06";

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

const inputs = {
  interpretation:
    "题目要求说明自由怎样连接康德对理论理性的限制与实践理性的道德要求：理论理性不能证明自由，但限制知识后为自由保留可能；实践理性则通过道德法则把自由确认为理性主体必须预设的条件。",
  attempt:
    "在理论理性层面，康德把知识限制在可能经验和现象界内。自由作为超感性的理念不能被思辨理性认识或证明，但第三二律背反表明，只要区分现象与物自身，自然因果与自由因果就不必互相排斥。因此，理论理性的自我批判不是取消自由，而是撤除以自然必然性否定自由的僭越，为自由保留逻辑可能。在实践理性层面，道德法则以无条件的应当向主体显现；如果主体绝无能力依理性自我立法，应当便失去意义，所以自由是道德法则成立的存在根据。反过来，我们也正是通过道德法则意识到自己的自由，道德法则因此是自由的认识根据。由此，自由把两种理性贯通起来：理论理性给它留下位置，实践理性赋予它现实的实践确证，并由自律展开义务、责任与目的王国。它不是体系外附加的假设，而是使批判哲学从认识的限界走向道德主体之成立的拱顶石。",
  repair:
    "理论理性的关键动作是划定知识边界：既然自然因果只对现象有效，它便无权断言物自身层面的自由不可能，这为自由留下位置。实践理性的关键动作是从道德法则反推主体必须能自我立法，因此自由虽不能成为知识，却获得实践上的确证；前者消除矛盾，后者承担证明功能。",
  rewrite:
    "康德所谓自由是体系的拱顶石，并非说思辨理性已经证明了它。恰恰相反，理论理性通过批判把知识限制在现象界：自然因果支配经验对象，却不能越界断言物自身不存在自由。第三二律背反因现象与物自身的区分而得到化解，自由由此获得一块不能被理论否定的位置。但可能还不足以支撑道德。实践理性中的道德法则以无条件的应当要求主体，而应当预设能够；主体只有作为自我立法者，义务和责任才有意义。因此自由是道德法则的存在根据，道德法则又是我们认识自由的根据。理论理性为自由清场，实践理性使自由获得实践确证，自由遂把认识的限界、自律的主体与道德世界联结起来，成为整个批判哲学得以封顶的拱顶石。"
};

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

const started = await post("/api/session/start", { inviteCode, consent: true });
const sessionToken = started.sessionToken;
const claims = JSON.parse(
  Buffer.from(sessionToken.split(".")[0], "base64url").toString("utf8")
);

let stage = started.stage;
let snapshot = started.snapshot;
const transitions = [];

console.log("会话已创建，开始真实模型闭环验证……");
for (let attempt = 0; attempt < 10 && stage !== "reflection"; attempt += 1) {
  const result = await post("/api/session/step", {
    sessionToken,
    stage,
    input: inputs[stage] || inputs.repair,
    snapshot
  });
  transitions.push({
    stage,
    nextStage: result.nextStage,
    gate: result.feedback?.gate || null,
    feedbackCharacters: JSON.stringify(result.feedback || {}).length
  });
  console.log(`${stage} -> ${result.nextStage}`);
  stage = result.nextStage;
  snapshot = result.snapshot;
}

if (stage !== "reflection") {
  throw new Error(`十轮内未进入反思阶段，当前阶段：${stage}`);
}

const completed = await post("/api/session/complete", {
  sessionToken,
  snapshot,
  reflection: {
    studentExplanation:
      "我现在能把理论理性留下可能、实践理性给予确证这两个动作连起来，而不是只罗列自由和道德法则。",
    diagnosisHit: "是",
    willingReuse: "是",
    uxConfusion: "第一次使用时希望看到阶段进度，但整体流程清楚。"
  }
});

console.log(
  `E2E_RESULT=${JSON.stringify({
    participantCode: started.participantCode,
    sessionId: claims.sessionId,
    recordId: claims.recordId,
    stage: completed.stage,
    saved: completed.saved,
    transitions
  })}`
);
