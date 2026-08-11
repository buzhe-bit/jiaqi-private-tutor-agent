import { buildCoachMessages } from "./prompt.mjs";
import { normalizeCoachResponse, parseModelJson } from "./response-contract.mjs";


const HELP_ACTIONS = ["hint", "explain", "reference", "restate"];
const RETRY_DELAY_MS = 250;


function coachServiceError(code, internalMessage, userMessage, details = {}) {
  return Object.assign(new Error(internalMessage), {
    status: 503,
    code,
    retryable: true,
    userMessage,
    ...details
  });
}


function publicCoachError(error) {
  if (error?.code?.startsWith?.("COACH_")) return error;
  const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
  return coachServiceError(
    timedOut ? "COACH_TIMEOUT" : "COACH_NETWORK_ERROR",
    timedOut ? "CloudBase 模型调用超时" : `CloudBase 模型网络错误：${error?.message || "未知错误"}`,
    timedOut
      ? "AI 服务等待超时，不是你答错了。你的内容已保留，可以原地重试。"
      : "网络没有连接到 AI 服务，不是你答错了。你的内容已保留，可以原地重试。"
  );
}


function upstreamRequestId(response, result) {
  return response.headers.get("x-request-id")
    || response.headers.get("x-tcb-request-id")
    || response.headers.get("x-tencent-requestid")
    || String(result?.requestId || result?.request_id || "").slice(0, 200);
}


function logSafeFailure(logger, { error, action, attempt }) {
  if (!["COACH_UPSTREAM_ERROR", "COACH_NETWORK_ERROR", "COACH_TIMEOUT"].includes(error.code)) return;
  logger?.warn?.({
    code: error.code,
    status: error.upstreamStatus || null,
    requestId: error.requestId || "",
    action,
    attempt
  });
}


function teachingFeedback({
  message,
  focus,
  teaching,
  knowledgeConnection = "",
  sourceStatus,
  studentEvidence = "你已经完成了第一次真实尝试。",
  missingPoint = "现在只补自由怎样连接理论理性与实践理性。"
}) {
  return {
    gate: "TEACH",
    learnerNeed: "knowledge_gap",
    message,
    studentEvidence,
    missingPoint,
    focus,
    teaching,
    knowledgeConnection,
    nextActions: HELP_ACTIONS,
    sourceStatus
  };
}


function isNotUnderstood(value) {
  return /没听懂|没懂|不明白|还是不懂|换(?:个|种)讲法/.test(value);
}


function shortQuote(value, maxLength = 90) {
  const text = String(value || "").trim();
  const clipped = text.length > maxLength ? `${text.slice(0, maxLength)}……` : text;
  return `“${clipped}”`;
}


function mockDiagnosis(feedback, { input = "", snapshot = {}, question } = {}) {
  const value = String(input).trim();
  const guide = question?.guide || {};
  const conceptMisunderstanding = /引入上帝|证明上帝|实践理性.{0,8}上帝/.test(value);
  const delayedUnstable = Boolean(snapshot.reviewContext) && feedback.gate !== "CLOSE_LOOP";
  const issueType = delayedUnstable
    ? "delayed_recall_unstable"
    : conceptMisunderstanding
      ? "concept_misunderstanding"
      : feedback.gate === "CLOSE_LOOP"
        ? "basically_mastered"
        : feedback.learnerNeed === "knowledge_gap"
          ? "knowledge_missing"
          : feedback.learnerNeed === "reasoning_gap"
            ? "relation_broken"
            : "expression_scattered";
  return {
    subject: "philosophy",
    topic: question?.topic || `${question?.thinker || "康德"}核心问题`,
    thinker: question?.thinker || "康德",
    concepts: guide.keyTerms?.length ? guide.keyTerms : ["理论理性", "实践理性", "自由"],
    knowledgeRelations: [guide.focus || feedback.focus],
    issueType,
    misconception: conceptMisunderstanding ? "把实践理性误解为用于证明或引入上帝" : "",
    expressionIssue: issueType === "expression_scattered" ? feedback.missingPoint : "",
    evidence: feedback.studentEvidence,
    diagnosis: feedback.missingPoint,
    masteryStatus: feedback.gate === "CLOSE_LOOP" ? "developing" : "unstable",
    sourceStatus: snapshot.sourceExcerpt ? "material_supported" : "ai_synthesized",
    sourceLabel: snapshot.sourceExcerpt ? "学生提供的当前题材料" : "AI 综合当前题目知识边界作出的解释",
    confidence: "medium"
  };
}


function withMockDiagnosis(feedback, context) {
  return { ...feedback, diagnosis: mockDiagnosis(feedback, context) };
}


function knowledgeFollowup({ value, sourceStatus, base, guide }) {
  if (isNotUnderstood(value)) return null;

  if (/马克思/.test(value) && /黑格尔/.test(value)) {
    return teachingFeedback({
      ...base,
      message: "先直接回答：两者都重视矛盾和运动，但说明运动的出发点不同。",
      focus: "黑格尔从概念或精神的内在矛盾说明运动，马克思把重心转向现实社会关系、实践与物质条件。",
      teaching: "黑格尔的辩证法不是外加的三段公式，而是概念或精神因自身矛盾而运动，并在扬弃中走向更具体的统一。马克思继承了这种矛盾运动的眼光，但批评只在观念中说明现实，转而从物质生活条件、现实社会关系和实践中的矛盾解释历史变化。\n\n这对当前题目有用：如果题目问黑格尔，你要先写清“概念因自身矛盾而运动”，再用马克思作边界比较；不要反过来把黑格尔写成主要讨论经济关系。",
      knowledgeConnection: "黑格尔的概念或精神自我运动 → 马克思转向现实社会关系、物质条件与实践中的矛盾运动",
      sourceStatus
    });
  }

  if (/时代背景|什么背景|回应谁|反对谁|修正谁|解决什么问题/.test(value)) {
    return teachingFeedback({
      ...base,
      message: "先直接回答你问的思想背景，再把它接回这道题。",
      focus: guide.focus,
      teaching: `当前最有用的抓手不是铺开全部思想史，而是看它试图解决什么问题：${guide.answerHook}\n\n这条背景能帮助你在答案开头交代理论为什么出现，随后仍要回到题目要求的关键关系。`,
      knowledgeConnection: `问题背景与回应对象 → ${guide.focus}`,
      sourceStatus
    });
  }

  if (/区别|关系|是什么意思|为什么|怎么理解|怎么联系/.test(value)) {
    return teachingFeedback({
      ...base,
      message: "先直接回答你问的关系。",
      focus: guide.focus,
      teaching: `${guide.explanation || guide.answerHook}\n\n这条连接对当前题目的作用是：它能让你把相关概念组织成因果或条件关系，而不只是并列术语。`,
      knowledgeConnection: `你的具体追问 → ${guide.focus}`,
      sourceStatus
    });
  }
  return null;
}


function genericEvaluation({ action, snapshot = {}, input = "", question }) {
  const value = String(input).trim();
  const guide = question.guide;
  const sourceStatus = snapshot.sourceExcerpt ? "有材料支持" : "待核实";
  const keyTerms = guide.keyTerms || [];
  const hits = keyTerms.filter((term) => value.includes(term)).length;
  const base = {
    studentEvidence: hits ? `你已经提到了${keyTerms.filter((term) => value.includes(term)).join("、")}。` : "你已经留下了真实的思考起点。",
    missingPoint: guide.focus,
    focus: guide.focus,
    sourceStatus
  };

  if (action === "submit_attempt") {
    const unsure = /不知道|不会|想不起来|不熟/.test(value);
    const admitsListing = /(?:只是|只会).{0,12}(?:堆|罗列)|(?:概念|术语|词).{0,8}(?:堆|罗列)/.test(value);
    const ready = !unsure && !admitsListing && value.length >= 40 && hits >= 2;
    const matchedTerms = keyTerms.filter((term) => value.includes(term));
    return {
      ...base,
      gate: ready ? "REVISE" : "TEACH",
      learnerNeed: unsure ? "knowledge_gap" : (ready ? "expression_gap" : "reasoning_gap"),
      message: unsure
        ? "我看到你现在确实想不起来，我们先补最小的一环。"
        : (ready
            ? "你的关键理解已经成立，现在主要问题是表达层次。"
            : `你已经写到${matchedTerms.join("、") || "相关概念"}，但它们还没有连成论证。`),
      studentEvidence: unsure
        ? `你的原话是${shortQuote(value)}，这部分目前还没有形成可判断的理解。`
        : (matchedTerms.length
            ? `你已经写到“${matchedTerms.join("”和“")}”，说明你知道这道题涉及哪些核心环节。`
            : `你的原话是${shortQuote(value)}，其中还没有出现足以判断关键关系的内容。`),
      missingPoint: ready
        ? "现在只需要把已经成立的关系压成一条层次清楚的论证链。"
        : `现在只补“这些概念为什么这样连接”：${guide.focus}`,
      teaching: ready
        ? "为什么先处理表达：关键关系已经成立，当前最影响考场作答的是层次和句间推进。"
        : "为什么先补这一点：它决定你写出的概念能不能组成论证，而不是停留在术语堆积。",
      nextActions: ready ? ["revise"] : HELP_ACTIONS
    };
  }

  if (action === "request_hint") {
    return teachingFeedback({
      ...base,
      message: "先只给你一个答题抓手。",
      teaching: guide.answerHook,
      sourceStatus
    });
  }

  if (["request_explanation", "request_example"].includes(action)) {
    return teachingFeedback({
      ...base,
      message: "先讲清核心关系，再给你一个可以落笔的结构。",
      teaching: `${guide.explanation}\n\n例如作答时，可以按“${guide.answerStructure.join("—")}”逐步展开。`,
      sourceStatus
    });
  }

  if (action === "request_reference") {
    return teachingFeedback({
      ...base,
      message: "下面是一种可行作答，重点看它怎样组织关系，不必照抄。",
      teaching: guide.possibleAnswer,
      sourceStatus
    });
  }

  if (action === "ask_followup") {
    const knowledgeAnswer = knowledgeFollowup({ value, sourceStatus, base, guide });
    if (knowledgeAnswer) return knowledgeAnswer;
    const repeated = (String(snapshot.intervention || "").match(/【ask_followup】/g) || []).length >= 1;
    return teachingFeedback({
      ...base,
      message: repeated ? "前一种讲法没有接住你，这次换成反向检查。" : "我换成更直接的问题来讲。",
      teaching: repeated
        ? `反过来问：如果答案完全没有“${keyTerms.slice(0, 2).join("”和“")}”，还能解释题目中的关系吗？先找出缺失的一环，再用自己的话补上。`
        : `${guide.answerHook}\n\n现在只回答：${guide.nextRecallQuestion}`,
      sourceStatus
    });
  }

  if (action === "submit_restate") {
    const understood = value.length >= 20 && hits >= 2;
    return {
      ...base,
      gate: understood ? "REVISE" : "RETEACH",
      learnerNeed: understood ? "expression_gap" : "reasoning_gap",
      message: understood ? "你已经用自己的话说出了关键关系。" : "你已经说出一部分，但关键连接还不够明确。",
      teaching: understood ? "" : `再抓一次这句话：${guide.focus}`,
      nextActions: understood ? ["revise"] : HELP_ACTIONS
    };
  }

  const improved = value.length >= 30 && value !== String(snapshot.initialAnswer || "").trim();
  return {
    ...base,
    gate: improved ? "CLOSE_LOOP" : "REVISE",
    learnerNeed: improved ? "ready" : "expression_gap",
    message: improved ? "你已经完成了一次可观察的表达改进。" : "方向已经对了，再把关键关系写得更明确一些。",
    missingPoint: improved ? "本轮关键关系已经补上。" : guide.focus,
    teaching: "",
    nextActions: ["revise"]
  };
}


async function evaluateMock({ action, snapshot = {}, input = "", question }) {
      if (question?.id && question.id !== "kant-freedom-keystone") {
        return genericEvaluation({ action, snapshot, input, question });
      }
      const value = String(input).trim();
      const sourceStatus = snapshot.sourceExcerpt ? "有材料支持" : "待核实";

      if (action === "submit_attempt") {
        const unsure = /不知道|不会|想不起来|不太熟|也许|可能(?:就是|是|引入)|引入上帝/.test(value);
        const theoryLeavesOpen = /(留下|保留).*(可能|位置)/.test(value)
          || /(不能|无法).{0,12}(断定|证明|认识).{0,12}自由.{0,8}(不可能|不存在)/.test(value);
        const theoryBoundary = /(理论理性|思辨理性|自然因果)/.test(value)
          && /(现象|物自身|物自体)/.test(value)
          && /(只适用|不可知|不能.{0,12}(扩展|越界)|无法.{0,12}认识)/.test(value);
        const theoryProgress = theoryLeavesOpen || theoryBoundary;
        const practiceRequiresFreedom = /(实践理性|道德法则|道德上的应当)/.test(value)
          && /(条件|前提|预设|不可缺|必须|实践意义|确证)/.test(value);
        const hasCoreRelation = theoryProgress && practiceRequiresFreedom;
        return {
          gate: unsure || !hasCoreRelation ? "TEACH" : "REVISE",
          learnerNeed: unsure ? "knowledge_gap" : (hasCoreRelation ? "expression_gap" : "reasoning_gap"),
          message: unsure
            ? "我先不让你继续硬写。你现在缺的不是措辞，而是自由怎样连接两种理性的关键关系。"
            : (hasCoreRelation
                ? "你已经抓住关键关系，接下来只需要把它表达得更紧。"
                : "你提到了相关概念，但两种理性目前还是并列的，还没有通过自由连接起来。"),
          studentEvidence: unsure
            ? `你的原话是${shortQuote(value)}，这部分目前还没有形成可判断的理解。`
            : (hasCoreRelation
                ? "你已经写出理论理性为自由留下可能、实践理性从道德法则出发必须预设自由，关键关系是成立的。"
                : (theoryProgress
                    ? "你已经说到理论理性不能证明自由，却为自由留下了可能位置。"
                    : `你的原话是${shortQuote(value)}，其中已经出现相关概念，但还看不出它们的作用关系。`)),
          missingPoint: hasCoreRelation
            ? "现在只需要把已经成立的关系压成层次清楚的论证链，不必重新补基础知识。"
            : "还需要说明道德法则怎样使自由获得积极的实践意义，并由此连接两种理性。",
          focus: "理论理性为自由留下可能，实践理性通过道德法则赋予自由实践意义。",
          teaching: hasCoreRelation
            ? "为什么先处理表达：你的知识关系已经成立，当前最影响考场作答的是层次和句间推进。"
            : "为什么先补这一点：它是自由连接理论理性与实践理性的中间环节；缺少它，两个层次只会并列。",
          nextActions: unsure || !hasCoreRelation ? HELP_ACTIONS : ["revise"],
          sourceStatus
        };
      }

      if (action === "request_hint") {
        return teachingFeedback({
          message: "我先只给你一个能唤起回忆的提示。",
          focus: "一边解决‘能不能有自由’，另一边解决‘为什么必须有自由’。",
          teaching: "想一想：理论理性限制了知识的边界以后，自由虽然不能被证明，但是否也不再能被自然因果彻底否定？",
          sourceStatus
        });
      }

      if (action === "request_explanation") {
        return teachingFeedback({
          message: "先把这道题放回康德要解决的问题里，再看两个层次怎样接起来。",
          focus: "康德要让自然因果与道德责任同时成立：理论理性留下可能，实践理性赋予实践意义。",
          teaching: "康德要解决的问题是：经验世界服从自然因果，人为什么还能承担道德责任？理论理性把知识限制在可能经验和现象界，因此它不能证明自由，却也不能越界否定自由，这为自由留下了可能。实践理性从道德法则出发：如果人完全不能自由行动，‘你应当如此’就失去意义，所以自由成为道德实践必须预设的条件。\n\n例如，可以把理论理性理解为先划清自然因果的管辖边界，让自由不被赶出整个体系；实践理性再让自由承担道德责任的承重作用。两步合起来，自由才具有‘拱顶石’的意义。",
          sourceStatus
        });
      }

      if (action === "request_example") {
        return teachingFeedback({
          message: "换成一个结构例子来看。",
          focus: "前者清出位置，后者让这个位置承担作用。",
          teaching: "可以把理论理性想成先划出建筑边界：它说明自然因果只能管到现象，不能把自由赶出整个体系。实践理性则把自由放到承重位置：没有自由，道德责任和‘应当’都站不住。两步合起来，自由才像拱顶石一样把建筑封住。",
          sourceStatus
        });
      }

      if (action === "request_reference") {
        return teachingFeedback({
          message: "下面是一种可行作答。先看它怎样把两个层次接起来，不必照抄措辞。",
          focus: "理论理性清出位置，实践理性提供实践确证。",
          teaching: "一种可行作答：康德并不是说理论理性已经证明了自由。理论理性把知识限制在可能经验与现象界，自然因果因而不能越界否定物自身层面的自由，这只是为自由留下可思的可能。实践理性则从道德法则出发：无条件的‘应当’预设主体能够依理性自我立法，因此自由虽不能成为理论知识，却获得了实践上的确证。理论理性为自由清出位置，实践理性使自由承担起道德主体成立的条件，自由由此连接认识的限界与道德实践，成为批判哲学体系的拱顶石。",
          sourceStatus
        });
      }

      if (action === "ask_followup") {
        const knowledgeAnswer = knowledgeFollowup({
          value,
          sourceStatus,
          guide: {
            focus: "理论理性为自由留下可能，实践理性通过道德法则赋予自由实践意义。",
            answerHook: "康德要说明自然因果与道德责任怎样同时成立。",
            explanation: "理论理性限制知识边界，实践理性从道德法则出发使自由成为必须预设的条件。"
          },
          base: {
            studentEvidence: "你已经提出了一个能帮助澄清当前题目的具体问题。",
            missingPoint: "现在把这条知识连接接回自由与两种理性的关系。",
            focus: "理论理性为自由留下可能，实践理性通过道德法则赋予自由实践意义。"
          }
        });
        if (knowledgeAnswer) return knowledgeAnswer;
        const previousFollowups = (String(snapshot.intervention || "").match(/【ask_followup】/g) || []).length;
        if (previousFollowups >= 1) {
          return teachingFeedback({
            message: "前两种讲法都没有接住你，这次我用反例把范围缩小。",
            focus: "理论理性只是不排除自由；实践理性才说明为什么必须预设自由。",
            teaching: "反过来假设：理论理性已经证明了自由，那么自由就会变成可以认识的对象，这反而越过了康德给知识划的边界。再假设人绝不可能自由，道德上的‘你应当’又会失去对象。前一个反例说明理论理性只能留下位置，后一个反例说明实践理性必须让自由承担作用。",
            sourceStatus
          });
        }
        return teachingFeedback({
          message: "明白，刚才那种讲法没有接住你。我换成两个问题来讲。",
          focus: "理论理性回答‘自由有没有位置’，实践理性回答‘自由为什么不可缺’。",
          teaching: "第一问：自然因果能不能证明一切层面都没有自由？康德说不能，因为它只适用于现象。第二问：如果人绝不可能自由，道德上的‘应当’还有意义吗？也没有。因此前一层不再排除自由，后一层必须预设自由。",
          sourceStatus
        });
      }

      if (action === "submit_restate") {
        const understood = /(理论理性|思辨理性)/.test(value)
          && /(实践理性|道德法则)/.test(value)
          && /(可能|位置|不能否定)/.test(value)
          && /(实践意义|预设|必须|确证)/.test(value);
        return {
          gate: understood ? "REVISE" : "RETEACH",
          learnerNeed: understood ? "expression_gap" : "reasoning_gap",
          message: understood
            ? "你已经用自己的话把两个层次接起来了。"
            : "你已经说出一部分，但现在还缺‘理论上只是留下可能，实践上才变成必须预设’这一步。",
          studentEvidence: understood
            ? "你已经说清理论理性留下可能、实践理性赋予实践意义。"
            : "你已经开始区分理论理性和实践理性的作用。",
          missingPoint: understood
            ? "现在只需要把这个关系写回自己的原答案。"
            : "还需要把‘理论上可思’与‘实践上必须预设’明确连接起来。",
          focus: "理论理性留下可能，实践理性赋予实践意义。",
          teaching: understood ? "" : "下一次我会用‘有没有位置 / 为什么不可缺’这两个问题重新解释。",
          nextActions: understood ? ["revise"] : HELP_ACTIONS,
          sourceStatus
        };
      }

      const improved = value.length >= 35
        && /(理论理性|思辨理性)/.test(value)
        && /(实践理性|道德法则)/.test(value)
        && /(可能|位置|不能否定)/.test(value);
      return {
        gate: improved ? "CLOSE_LOOP" : "REVISE",
        learnerNeed: improved ? "ready" : "expression_gap",
        message: improved
          ? "你已经从罗列或猜测概念，进步到说清两个层次怎样通过自由连接。"
          : "你的方向已经对了，但这次改写还没有把理论上的可能与实践上的必要同时写出来。",
        studentEvidence: improved
          ? "你的改写已经同时出现理论上的可能与实践上的必要。"
          : "你的改写方向已经回到自由连接两种理性。",
        missingPoint: improved
          ? "本轮关键关系已经补上。"
          : "再补一句实践理性为什么必须预设自由。",
        focus: "让一句话同时出现‘理论上留下可能’和‘实践上成为必要条件’。",
        teaching: "",
        nextActions: ["revise"],
        sourceStatus
      };
}


export function createMockCoach() {
  return {
    async evaluate(context) {
      return withMockDiagnosis(await evaluateMock(context), context);
    }
  };
}


export function createCloudbaseCoach({
  envId,
  apiKey,
  provider = "cloudbase",
  modelName = "deepseek-v4-flash",
  fetchImpl = fetch,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  logger = console
}) {
  if (!envId || !apiKey) throw new Error("CloudBase 环境 ID 和 API Key 未配置");
  const endpoint = `https://${envId}.api.tcloudbasegateway.com/v1/ai/${provider}/chat/completions`;
  return {
    async evaluate({ action, snapshot, input, question }) {
      const requestBody = JSON.stringify({
        model: modelName,
        temperature: 0.2,
        max_tokens: 3000,
        stream: false,
        messages: buildCoachMessages({ action, snapshot, input, question })
      });

      for (let responseAttempt = 0; responseAttempt < 2; responseAttempt += 1) {
        try {
          const response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json"
            },
            body: requestBody,
            signal: AbortSignal.timeout(25_000)
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw coachServiceError(
              "COACH_UPSTREAM_ERROR",
              `CloudBase 模型调用失败：HTTP ${response.status}`,
              "AI 服务这次没有响应，不是你答错了。你的内容已保留，可以原地重试。",
              {
                upstreamStatus: response.status,
                requestId: upstreamRequestId(response, result)
              }
            );
          }

          const modelText = result.choices?.[0]?.message?.content;
          if (!modelText) {
            throw coachServiceError(
              "COACH_EMPTY_RESPONSE",
              "CloudBase 模型未返回可用内容",
              "AI 这次没有返回有效反馈，不是你答错了。你的内容已保留，可以原地重试。"
            );
          } else {
            try {
              return normalizeCoachResponse(parseModelJson(modelText), action);
            } catch (error) {
              throw coachServiceError(
                "COACH_INVALID_RESPONSE",
                `CloudBase 模型反馈格式无效：${error.message}`,
                "AI 这次没有生成可读反馈，不是你答错了。你的内容已保留，可以原地重试。"
              );
            }
          }
        } catch (error) {
          const publicError = publicCoachError(error);
          logSafeFailure(logger, {
            error: publicError,
            action,
            attempt: responseAttempt + 1
          });
          if (responseAttempt === 1) throw publicError;
          await delay(RETRY_DELAY_MS);
        }
      }

      throw new Error("CloudBase 模型调用没有完成");
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
