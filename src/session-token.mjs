import { createHmac, timingSafeEqual } from "node:crypto";


function encode(value) {
  return Buffer.from(value).toString("base64url");
}


export function createSessionCodec(secret) {
  if (!secret) throw new Error("缺少会话签名密钥");
  function signature(body) {
    return createHmac("sha256", secret).update(body).digest("base64url");
  }
  return {
    sign(payload) {
      const body = encode(JSON.stringify(payload));
      return `${body}.${signature(body)}`;
    },
    verify(token) {
      const [body, suppliedSignature, extra] = String(token || "").split(".");
      if (!body || !suppliedSignature || extra) throw new Error("会话凭证无效");
      const expected = Buffer.from(signature(body));
      const supplied = Buffer.from(suppliedSignature);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        throw new Error("会话凭证无效");
      }
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!payload?.sessionId || !payload?.recordId || !payload?.startedAt) {
        throw new Error("会话凭证无效");
      }
      return payload;
    }
  };
}
