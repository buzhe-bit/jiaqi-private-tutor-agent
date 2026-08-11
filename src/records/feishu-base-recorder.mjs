const FEISHU_ROOT = "https://open.feishu.cn/open-apis";


function string(value) {
  return String(value || "");
}


export function sessionToFields(session) {
  const snapshot = session.snapshot || {};
  const feedback = session.feedback || {};
  const reflection = session.reflection || {};
  const evidence = [
    feedback.learnerNeed ? `[${string(feedback.learnerNeed)}]` : "",
    string(feedback.studentEvidence),
    string(feedback.message)
  ].filter(Boolean).join(" ");

  return {
    "会话编号": string(session.sessionId),
    "学员编号": string(session.participantCode),
    "组别": string(session.cohort),
    "当前阶段": string(session.stage),
    "开始时间": string(session.startedAt),
    "更新时间": string(session.updatedAt),
    "总耗时秒": Number(session.elapsedSeconds || 0),
    "资料片段": string(snapshot.sourceExcerpt),
    "题目理解": [
      session.questionId ? `[${string(session.questionId)}] ${string(session.question)}` : "",
      string(snapshot.questionInterpretation)
    ].filter(Boolean).join("\n"),
    "初始答案": string(snapshot.initialAnswer),
    "理解证据": evidence,
    "首要问题": string(feedback.missingPoint || snapshot.primaryIssue),
    "事实依据状态": string(feedback.sourceStatus),
    "干预动作": [
      string(snapshot.intervention),
      Array.isArray(snapshot.knowledgeConnections) && snapshot.knowledgeConnections.length
        ? `【本轮知识联系】\n${snapshot.knowledgeConnections.map((item) => `- ${string(item)}`).join("\n")}`
        : ""
    ].filter(Boolean).join("\n\n"),
    "干预回应": string(snapshot.repairResponse),
    "重写答案": string(snapshot.rewrittenAnswer),
    "闭环判断": string(snapshot.closureFeedback),
    "学生自述改变": string(reflection.studentExplanation),
    "诊断命中": string(reflection.diagnosisHit),
    "愿意复用": string(reflection.willingReuse),
    "体验卡点": string(reflection.uxConfusion)
  };
}


async function feishuJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(`飞书 Base 写入失败：${data.msg || response.status}`);
  }
  return data;
}


export function createFeishuBaseRecorder({
  appId,
  appSecret,
  baseToken,
  tableId,
  fetchImpl = fetch,
  now = () => Date.now()
}) {
  for (const [name, value] of Object.entries({ appId, appSecret, baseToken, tableId })) {
    if (!value) throw new Error(`飞书记录器缺少 ${name}`);
  }

  let cachedToken = "";
  let tokenExpiresAt = 0;
  async function appToken() {
    if (cachedToken && tokenExpiresAt > now() + 60_000) return cachedToken;
    const data = await feishuJson(fetchImpl, `${FEISHU_ROOT}/auth/v3/app_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    cachedToken = data.app_access_token;
    tokenExpiresAt = now() + Number(data.expire || 7200) * 1000;
    return cachedToken;
  }

  async function write(url, method, session) {
    const token = await appToken();
    return feishuJson(fetchImpl, url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ fields: sessionToFields(session) })
    });
  }

  const recordsUrl = `${FEISHU_ROOT}/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/records`;
  return {
    async create(session) {
      const data = await write(recordsUrl, "POST", session);
      const recordId = data.data?.record?.record_id;
      if (!recordId) throw new Error("飞书没有返回记录编号");
      return recordId;
    },
    async update(recordId, session) {
      if (!recordId) throw new Error("缺少飞书记录编号");
      await write(`${recordsUrl}/${encodeURIComponent(recordId)}`, "PUT", session);
    }
  };
}
