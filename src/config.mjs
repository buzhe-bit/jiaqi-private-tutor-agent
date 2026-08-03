const VALID_COHORTS = new Set(["consulted", "new", "demo"]);


export function parseInviteCodes(rawValue) {
  if (!rawValue) {
    return new Map([["demo", { participantCode: "DEMO", cohort: "demo" }]]);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error("INVITE_CODES_JSON 必须是合法 JSON");
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("INVITE_CODES_JSON 必须是对象");
  }

  const entries = Object.entries(parsed).map(([code, metadata]) => {
    if (!code || !metadata || typeof metadata !== "object") {
      throw new Error("每个邀请码都必须包含匿名学员信息");
    }
    const participantCode = String(metadata.participantCode || "").trim();
    const cohort = String(metadata.cohort || "").trim();
    if (!participantCode || !VALID_COHORTS.has(cohort)) {
      throw new Error(`邀请码 ${code} 的 participantCode 或 cohort 无效`);
    }
    return [code, { participantCode, cohort }];
  });

  return new Map(entries);
}


export function loadConfig(env = process.env) {
  const sessionSigningSecret = env.SESSION_SIGNING_SECRET || "";
  if (env.NODE_ENV === "production" && !sessionSigningSecret) {
    throw new Error("生产环境缺少会话签名密钥 SESSION_SIGNING_SECRET");
  }
  return {
    port: Number(env.PORT || 8787),
    invites: parseInviteCodes(env.INVITE_CODES_JSON),
    coachProvider: env.COACH_PROVIDER || "mock",
    recordProvider: env.RECORD_PROVIDER || "memory",
    sessionSigningSecret: sessionSigningSecret || "local-development-only",
    cloudbaseEnvId: env.CLOUDBASE_ENV_ID || "",
    cloudbaseApiKey: env.CLOUDBASE_API_KEY || "",
    cloudbaseProvider: env.CLOUDBASE_PROVIDER || "cloudbase",
    cloudbaseModel: env.CLOUDBASE_MODEL || "deepseek-v4-flash",
    feishu: {
      appId: env.FEISHU_APP_ID || "",
      appSecret: env.FEISHU_APP_SECRET || "",
      baseToken: env.FEISHU_BASE_TOKEN || "",
      tableId: env.FEISHU_TABLE_ID || ""
    }
  };
}
