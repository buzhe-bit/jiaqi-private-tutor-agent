const INVITE_ERROR_CODES = new Set(["INVITE_INVALID", "INVITE_EXPIRED", "INVITE_REQUIRED"]);

function isInviteError(error = {}) {
  const code = String(error.code || "");
  if (INVITE_ERROR_CODES.has(code)) return true;
  const status = Number(error.statusCode || error.status || 0);
  if (status !== 401 && status !== 403) return false;
  const message = String(error.message || error.error || "");
  return /(?:试用码|试用链接).*(?:无效|失效|过期)|(?:无效|失效|过期).*(?:试用码|试用链接)/.test(message);
}

module.exports = { isInviteError };
