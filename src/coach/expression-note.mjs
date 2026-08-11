const DEFAULT_QUESTION = "在康德哲学中，自由‘构成了纯粹的，甚至思辨理性体系的整个建筑的拱顶石’。试从理论理性和实践理性两个层次说明之。";

const ANSWER_HOOK = "康德要解决自然因果与道德责任怎样同时成立的问题：理论理性为自由留下可思的可能，实践理性通过道德法则赋予自由积极的实践意义。";

const AI_CORE_SUPPLEMENT = "理论理性不能把自由当作经验对象来证明，但现象与物自身的区分使自然因果不能越界否定自由。实践理性则从道德法则出发，使自由成为道德主体必须预设的条件，并给予自由积极的实践实在性。";

const ANSWER_STRUCTURE = [
  "理论理性：自然因果支配现象界；理论知识不能证明自由，但也不能越界排除自由，因而为自由留下可思空间。",
  "实践理性：道德法则要求主体能够依理性自我规定，因此自由成为道德实践必须预设的条件，并获得积极的实践意义。",
  "体系连接：理论理性清出位置，实践理性给予规定；自由把认识的限界与道德责任连接起来，因此具有‘拱顶石’的体系功能。"
];

const POSSIBLE_ANSWER = `康德并不是说理论理性已经证明了自由。理论理性把知识限制在可能经验和现象界之内，自然因果因此不能越界否定物自身层面的自由。这只为自由留下了可思的可能，还没有证明自由现实存在。

实践理性从道德法则出发。无条件的“应当”要求主体能够不只受感性欲求支配，而依理性法则自我规定。因此，自由虽不是理论知识的对象，却成为道德实践必须预设的条件，并获得积极的实践实在性。

由此，理论理性为自由清出位置，实践理性使自由承担道德主体成立的条件。自由把认识的限界与道德实践连接起来，使自然必然性与道德责任能够在不同层次上同时成立，因此成为康德纯粹理性体系的“拱顶石”。`;

const NEXT_RECALL_QUESTION = "合上这份笔记，用三句话回答：理论理性为自由做了什么？实践理性补上了什么？为什么这使自由成为体系的‘拱顶石’？";


function text(value, fallback) {
  const result = String(value || "").trim();
  return result || fallback;
}


function supplement(feedback = {}, core = AI_CORE_SUPPLEMENT) {
  const missingPoint = text(feedback.missingPoint, "");
  if (!missingPoint || /已经补上|已经形成|无需再补/.test(missingPoint)) {
    return core;
  }
  return `${missingPoint}\n\n更完整地说：${core}`;
}


function knowledgeConnections(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(-8);
}


export function buildExpressionNote({ question, snapshot = {}, feedback = {} } = {}) {
  const guide = question && typeof question === "object" ? question.guide : null;
  const questionText = question && typeof question === "object" ? question.text : question;
  const coreSupplement = guide?.explanation || AI_CORE_SUPPLEMENT;
  return {
    question: text(questionText, DEFAULT_QUESTION),
    answerHook: text(guide?.answerHook, ANSWER_HOOK),
    initialExpression: text(snapshot.initialAnswer, "本次没有形成完整初答"),
    studentEvidence: text(
      feedback.studentEvidence,
      text(snapshot.repairResponse, "本次已完成关键关系复述")
    ),
    aiSupplement: supplement(feedback, coreSupplement),
    answerStructure: [...(guide?.answerStructure || ANSWER_STRUCTURE)],
    finalExpression: text(
      snapshot.rewrittenAnswer,
      text(snapshot.repairResponse, "本次已完成关键关系复述，但没有留下完整长答案")
    ),
    knowledgeConnections: knowledgeConnections(snapshot.knowledgeConnections),
    possibleAnswer: text(guide?.possibleAnswer, POSSIBLE_ANSWER),
    nextRecallQuestion: text(guide?.nextRecallQuestion, NEXT_RECALL_QUESTION)
  };
}
