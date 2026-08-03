import { buildCoachMessages } from "./prompt.mjs";
import { normalizeCoachResponse, parseModelJson } from "./response-contract.mjs";


function evidence(quote, meaning) {
  return quote ? [{ quote, meaning }] : [];
}


function coachServiceError(code, internalMessage, userMessage) {
  return Object.assign(new Error(internalMessage), {
    status: 503,
    code,
    retryable: true,
    userMessage
  });
}


export function createMockCoach() {
  return {
    async evaluate({ action, snapshot = {}, input = "" }) {
      const value = String(input).trim();
      if (action === "interpretation") {
        const understood = value.length >= 18 && /理论理性|实践理性/.test(value);
        return {
          gate: understood ? "SUBMIT_ATTEMPT" : "CLARIFY_QUESTION",
          descriptiveState: "基本理解",
          overall: understood
            ? "你已经注意到题目要求处理自由与两种理性的关系，可以进入独立作答。"
            : "你提到了题目中的概念，但还没有说清它要求解释的关系。",
          evidence: evidence(value.slice(0, 80), understood ? "已经触及题目的关系。" : "目前仍主要是在复述题面。"),
          primaryIssue: understood ? "" : "还没有说明题目要求解释什么关系。",
          sourceStatus: "待核实",
          nextAction: understood
            ? "请提交你当前能写出的最好版本，不完整也可以。"
            : "请只用一句话回答：自由在题目中要连接哪两个层次？"
        };
      }

      if (action === "attempt") {
        const hasConnection = value.length >= 100 && /(因此|所以|从而|留下.*可能|连接)/.test(value);
        return {
          gate: hasConnection ? "REWRITE" : "REPAIR_ONE_ISSUE",
          descriptiveState: hasConnection ? "形成论证" : "基本理解",
          overall: hasConnection
            ? "答案已经不只是罗列概念，而是在解释理论限制与实践要求之间的连接。"
            : "答案提到了两种理性的相关概念，但它们目前仍然只是并列出现。",
          evidence: evidence(value.slice(0, 100), "这是你当前答案中最清楚的一处理解证据。"),
          primaryIssue: hasConnection ? "" : "没有说明理论理性留下的可思空间怎样连接到实践理性的道德必要。",
          sourceStatus: snapshot.sourceExcerpt ? "有材料支持" : "待核实",
          nextAction: hasConnection
            ? "请保持这条推理链，用自己的措辞整理成正式作答段落。"
            : "请用两句话补出：理论理性做到了什么，但还缺什么；实践理性又补上了什么。"
        };
      }

      if (action === "repair") {
        const repaired = value.length >= 28 && /(理论理性|实践理性)/.test(value);
        return {
          gate: repaired ? "REWRITE" : "REPAIR_ONE_ISSUE",
          descriptiveState: repaired ? "形成论证" : "基本理解",
          overall: repaired ? "你已经补出了本轮要求的连接，可以自己重写答案。" : "你在回应问题，但关键连接仍然没有完整说出。",
          evidence: evidence(value.slice(0, 100), repaired ? "这句话已经把两个层次接了起来。" : "这句话仍只覆盖了连接的一端。"),
          primaryIssue: repaired ? "" : (snapshot.primaryIssue || "关键连接仍未说明。"),
          sourceStatus: snapshot.sourceExcerpt ? "有材料支持" : "待核实",
          nextAction: repaired
            ? "请回到原答案，亲自重写涉及这一连接的段落。"
            : "先不要写整段，只补全‘理论上只能……，实践上因此必须……’这一组关系。"
        };
      }

      return {
        gate: "CLOSE_LOOP",
        descriptiveState: "形成论证",
        overall: "重写版本已经回应了本轮首要问题，理论理性与实践理性不再只是并列。",
        evidence: evidence(value.slice(0, 120), "重写中出现了可核对的推理连接。"),
        primaryIssue: "",
        sourceStatus: snapshot.sourceExcerpt ? "有材料支持" : "待核实",
        nextAction: "请用一句话说明你改了什么，以及为什么这样改。"
      };
    }
  };
}


export function createCloudbaseCoach({
  envId,
  apiKey,
  provider = "cloudbase",
  modelName = "deepseek-v4-flash",
  fetchImpl = fetch
}) {
  if (!envId || !apiKey) throw new Error("CloudBase 环境 ID 和 API Key 未配置");
  const endpoint = `https://${envId}.api.tcloudbasegateway.com/v1/ai/${provider}/chat/completions`;
  return {
    async evaluate({ action, snapshot, input }) {
      try {
        const requestBody = JSON.stringify({
          model: modelName,
          temperature: 0.2,
          max_tokens: 3000,
          stream: false,
          messages: buildCoachMessages({ action, snapshot, input })
        });

        for (let responseAttempt = 0; responseAttempt < 2; responseAttempt += 1) {
          const response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json"
            },
            body: requestBody,
            signal: AbortSignal.timeout(90_000)
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw coachServiceError(
              "COACH_UPSTREAM_ERROR",
              `CloudBase 模型调用失败：HTTP ${response.status}`,
              "AI 服务这次没有响应，你写的内容已保留。请重新提交。"
            );
          }

          const modelText = result.choices?.[0]?.message?.content;
          let responseError;
          if (!modelText) {
            responseError = coachServiceError(
              "COACH_EMPTY_RESPONSE",
              "CloudBase 模型未返回可用内容",
              "AI 这次没有返回有效反馈，你写的内容已保留。请重新提交。"
            );
          } else {
            try {
              return normalizeCoachResponse(parseModelJson(modelText), action);
            } catch (error) {
              responseError = coachServiceError(
                "COACH_INVALID_RESPONSE",
                `CloudBase 模型反馈格式无效：${error.message}`,
                "这次阅卷没有完成，你写的内容已保留。请重新提交。"
              );
            }
          }

          if (responseAttempt === 1) throw responseError;
        }
      } catch (error) {
        if (error?.code?.startsWith?.("COACH_")) throw error;
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        throw coachServiceError(
          timedOut ? "COACH_TIMEOUT" : "COACH_NETWORK_ERROR",
          timedOut ? "CloudBase 模型调用超时" : `CloudBase 模型网络错误：${error?.message || "未知错误"}`,
          timedOut
            ? "这次阅卷等待超时，你写的内容已保留。请重新提交。"
            : "网络没有连接到 AI 服务，你写的内容已保留。请重新提交。"
        );
      }
    }
  };
}


export function createCoach(config) {
  if (config.coachProvider === "cloudbase") {
    return createCloudbaseCoach({
      envId: config.cloudbaseEnvId,
      apiKey: config.cloudbaseApiKey,
      provider: config.cloudbaseProvider,
      modelName: config.cloudbaseModel
    });
  }
  return createMockCoach();
}
