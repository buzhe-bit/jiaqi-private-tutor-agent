module.exports = {
  mode: "cloudbase",
  // The cloudbase mode still seals participant-owned storage until learner
  // sync confirms an identity. Public transport only changes how /api/* is
  // reached; it does not weaken that identity gate.
  transport: "public",
  publicBaseUrl: "https://philosophy-coach-4202431-1454163072.ap-shanghai.run.tcloudbase.com",
  inviteCode: "",
  cloudbaseEnv: "first-001sijiao-d1fad71w28f4562b",
  cloudbaseService: "philosophy-coach"
};
