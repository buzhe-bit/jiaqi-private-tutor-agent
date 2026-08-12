const STAGES = {
  attempt: { step: 1, title: "初次作答", completion: "留下第一次真实回答，写“不知道”也可以" },
  teaching: { step: 2, title: "弄懂关系", completion: "先弄懂本题最关键的一条关系" },
  restate: { step: 3, title: "用自己的话说", completion: "用自己的话说清关键关系" },
  revision: { step: 4, title: "改进答案", completion: "把刚才的理解写回答案" },
  complete: { step: 4, title: "本轮完成", completion: "最终表达和复习笔记已经保存" }
};

function splitParagraphs(value) {
  const result = [];
  for (const block of String(value || "").split(/\n+/).map((item) => item.trim()).filter(Boolean)) {
    const sentences = block.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [block];
    let paragraph = "";
    for (const sentence of sentences) {
      if (paragraph && paragraph.length + sentence.length > 52) {
        result.push(paragraph);
        paragraph = "";
      }
      if (sentence.length > 52) {
        if (paragraph) result.push(paragraph);
        for (let index = 0; index < sentence.length; index += 52) result.push(sentence.slice(index, index + 52));
      } else {
        paragraph += sentence;
      }
    }
    if (paragraph) result.push(paragraph);
  }
  return result;
}

function stageMeta(stage) {
  return STAGES[stage] || STAGES.attempt;
}

function kindLabel(kind) {
  return { new: "新题", relation: "关系题", review: "复习题" }[kind] || "训练题";
}

function dateLabel(value) {
  const text = String(value || "").slice(0, 10);
  return text || "日期未知";
}

module.exports = { dateLabel, kindLabel, splitParagraphs, stageMeta };
