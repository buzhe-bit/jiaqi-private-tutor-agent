const QUESTIONS = [
  {
    questionId: "kant-freedom-keystone",
    question: "在康德哲学中，自由为何构成纯粹理性体系的拱顶石？试从理论理性和实践理性两个层次说明。",
    questionKind: "relation",
    reason: "用一道关系题检查你能否把两个概念层次连起来",
    sourceStatus: "material_supported",
    sourceLabel: "本地演示题"
  },
  {
    questionId: "hegel-dialectic",
    question: "简述黑格尔的辩证法思想。",
    questionKind: "new",
    reason: "继续练习从问题意识组织概念关系",
    sourceStatus: "material_supported",
    sourceLabel: "本地演示题"
  },
  {
    questionId: "confucianism-mohism-difference",
    question: "论述儒家和墨家的主要区别。",
    questionKind: "relation",
    reason: "通过比较题练习建立哲学史知识连接",
    sourceStatus: "material_supported",
    sourceLabel: "本地演示题"
  }
];

const FOCUS = "理论理性为自由留下可能，实践理性通过道德法则赋予自由积极的实践意义。";

function feedback(overrides = {}) {
  return {
    message: "你已经留下真实的思考起点，现在先补最关键的一条关系。",
    studentEvidence: "我看到了你刚才提交的回答，并保留了你的原话。",
    missingPoint: "还需要说明自由怎样把理论理性与实践理性连接起来。",
    focus: FOCUS,
    teaching: "理论理性把知识限制在现象界，不能证明自由，却也不能越界否定自由；实践理性从道德法则出发，必须预设主体能够自由地自我规定。前者清出位置，后者赋予作用。",
    knowledgeConnection: "认识的边界 → 自由的可思可能 → 道德实践对自由的必要预设",
    nextActions: ["hint", "explain", "reference", "restate"],
    ...overrides
  };
}

function expressionNote(session, finalExpression) {
  return {
    question: session.question,
    answerHook: "先交代康德要解决的张力，再分别说明理论理性清出位置、实践理性赋予意义。",
    initialExpression: session.snapshot.initialAnswer || "本次没有形成完整初答",
    studentEvidence: session.snapshot.repairResponse || "本次已完成关键关系复述",
    aiSupplement: "理论理性不能证明自由，但会限制自然因果的适用范围；实践理性则使自由成为道德主体成立的必要条件。",
    answerStructure: [
      "问题起点：自然因果与道德责任怎样同时成立。",
      "理论理性：限制知识边界，为自由留下可思空间。",
      "实践理性：从道德法则出发，使自由成为实践必需的预设。"
    ],
    finalExpression,
    knowledgeConnections: session.snapshot.knowledgeConnections || [],
    possibleAnswer: "康德并不是说理论理性已经证明了自由。理论理性把知识限制在现象界，使自然因果不能越界否定自由；实践理性则从道德法则出发，要求主体能够依理性自我规定。由此，理论理性为自由清出位置，实践理性使自由获得积极的实践意义，自由也就成为连接认识限界与道德责任的拱顶石。",
    nextRecallQuestion: "理论理性为自由做了什么？实践理性又补上了什么？"
  };
}

function createDemoAdapter({ sessions: initialSessions = [] } = {}) {
  const sessions = new Map(initialSessions.map((session) => [session.sessionToken, { ...session }]));
  let recommendationIndex = 0;
  let serial = 0;

  function completedSessions() {
    return [...sessions.values()].filter((item) => item.stage === "complete");
  }

  function sessionFor(body) {
    const session = sessions.get(body.sessionToken);
    if (!session) throw Object.assign(new Error("本地演示会话已失效，请重新开始"), { code: "DEMO_SESSION_EXPIRED" });
    return session;
  }

  async function request(method, path, body = {}) {
    if (method === "GET" && path === "/api/health") {
      return { ok: true, product: "philosophy-answer-coach", coachMode: "demo", storageMode: "local-demo" };
    }

    if (method === "POST" && path === "/api/practice/next") {
      const selected = QUESTIONS[recommendationIndex % QUESTIONS.length];
      return {
        ...selected,
        todayCompleted: completedSessions().length,
        baseTargetReached: completedSessions().length >= 3
      };
    }

    if (method === "POST" && path === "/api/learner/sync") {
      const complete = completedSessions();
      return {
        sessions: [...sessions.values()].map((item) => ({ ...item })),
        mastery: [],
        profile: {
          completedCount: complete.length,
          dueCount: 0,
          unstableCount: complete.length ? 1 : 0,
          recentWeaknesses: complete.length ? [{
            thinker: "康德",
            topic: "理论理性与实践理性的连接",
            summary: "本地演示：等待延迟复习验证",
            status: "形成中"
          }] : []
        }
      };
    }

    if (method === "POST" && path === "/api/session/start") {
      const question = QUESTIONS.find((item) => item.questionId === body.questionId) || QUESTIONS[0];
      const sessionId = `demo-session-${++serial}`;
      const sessionToken = `demo-token-${serial}`;
      const session = {
        sessionId,
        sessionToken,
        questionId: question.questionId,
        question: question.question,
        questionKind: question.questionKind,
        stage: "attempt",
        startedAt: new Date().toISOString(),
        snapshot: {},
        messages: [],
        expressionNote: null
      };
      sessions.set(sessionToken, session);
      return { ...session };
    }

    if (method === "POST" && path === "/api/session/step") {
      const session = sessionFor(body);
      const input = String(body.input || "").trim();
      const action = body.action;
      session.snapshot = { ...session.snapshot, ...(body.snapshot || {}) };
      session.messages = [...(body.messages || session.messages || [])];

      let nextStage = body.stage || session.stage;
      let visible = feedback();
      if (action === "submit_attempt") {
        session.snapshot.initialAnswer = input;
        nextStage = "teaching";
        visible = feedback({
          message: /不知道|不会|想不起来/.test(input)
            ? "我知道你现在确实想不起来，我们先不催答，只补一条最小关系。"
            : "你已经抓到了一部分概念，现在把它们连成一条论证。",
          studentEvidence: `你刚才写的是：“${input}”`
        });
      } else if (action === "request_hint") {
        nextStage = "teaching";
        visible = feedback({ teaching: "提示：前一层回答自由为什么没有被理论排除，后一层回答自由为什么在道德实践中必须被预设。" });
      } else if (action === "request_explanation") {
        nextStage = "teaching";
        visible = feedback({ message: "我换成解释加例子的方式讲。" });
      } else if (action === "request_reference") {
        if (!session.snapshot.initialAnswer) {
          throw Object.assign(new Error("先完成一次自己的尝试，再查看参考作答"), {
            code: "REQUEST_ERROR",
            retryable: false,
            preserved: true
          });
        }
        nextStage = "teaching";
        visible = feedback({
          message: "这是一种可行作答，不是唯一标准答案。",
          teaching: expressionNote(session, "").possibleAnswer,
          nextActions: ["restate"]
        });
      } else if (action === "ask_followup") {
        nextStage = body.stage;
        const connection = "你的具体追问 → 当前题目的关键概念关系";
        session.snapshot.knowledgeConnections = [...(session.snapshot.knowledgeConnections || []), connection].slice(-8);
        visible = feedback({
          message: "先直接回答你的具体问题，再说明它对当前题目有什么用。",
          teaching: "这个知识问题可以从思想背景、概念差异和解决路径三个层次理解。回到当前训练时，只选最能帮助你组织本题的一层使用。",
          knowledgeConnection: connection
        });
      } else if (action === "submit_restate") {
        session.snapshot.repairResponse = input;
        nextStage = "revision";
        visible = feedback({
          message: "你已经用自己的话说清了关键关系，现在把它写回完整答案。",
          studentEvidence: `你的复述是：“${input}”`,
          missingPoint: "只差把这条关系放回原答案，形成有层次的论证。",
          teaching: "",
          nextActions: ["revise"]
        });
      } else if (action === "submit_revision") {
        session.snapshot.rewrittenAnswer = input;
        nextStage = "complete";
        visible = feedback({
          message: "本轮已经完成：你的最终表达已经保存。",
          studentEvidence: "你的改写已经同时写到理论上的可能和实践上的必要。",
          missingPoint: "本轮关键关系已经补上。",
          teaching: "",
          nextActions: []
        });
        session.expressionNote = expressionNote(session, input);
        recommendationIndex += 1;
      }

      if (input) session.messages.push({ role: "student", message: input });
      session.messages.push({ role: "coach", ...visible, complete: nextStage === "complete" });
      session.stage = nextStage;
      return {
        feedback: visible,
        nextStage,
        snapshot: { ...session.snapshot },
        expressionNote: session.expressionNote
      };
    }

    if (method === "POST" && path === "/api/session/complete") return { saved: true };
    throw Object.assign(new Error(`本地演示接口不存在：${method} ${path}`), { code: "DEMO_ROUTE_NOT_FOUND" });
  }

  return {
    request,
    reset() {
      sessions.clear();
      recommendationIndex = 0;
      serial = 0;
    }
  };
}

module.exports = { createDemoAdapter };
