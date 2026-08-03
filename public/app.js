const QUESTION = "在康德哲学中，自由‘构成了纯粹的，甚至思辨理性体系的整个建筑的拱顶石’。试从理论理性和实践理性两个层次说明之。";
const inviteCode = new URLSearchParams(location.search).get("invite") || "";
const storageKey = `philosophy-coach:${inviteCode || "missing"}`;
const appRoot = document.querySelector("#app");
const progressRegion = document.querySelector("#progress-region");
const progressLabel = document.querySelector("#progress-label");
const progressCount = document.querySelector("#progress-count");
const progressBar = document.querySelector("#progress-bar");
const participantBadge = document.querySelector("#participant-badge");

const STAGE_PROGRESS = {
  interpretation: [1, "审题"],
  attempt: [2, "独立作答"],
  repair: [3, "只修一个问题"],
  rewrite: [4, "亲自重写"],
  reflection: [5, "前后对照"],
  complete: [5, "本次完成"]
};

let state = loadState() || { stage: "intro", snapshot: {}, drafts: {}, material: {} };
let busy = false;
let errorState = null;


function loadState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}


function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}


function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === "className") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) element.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) element.append(child);
  }
  return element;
}


function paragraph(text, className = "") {
  return node("p", { text, className });
}


function panel(title, eyebrow, children = [], className = "") {
  return node("section", { className: `panel ${className}`.trim() }, [
    node("span", { className: "eyebrow", text: eyebrow }),
    node("h1", { text: title }),
    ...children
  ]);
}


function questionCard(compact = false) {
  return node("div", { className: `question-card${compact ? " question-card-compact" : ""}` }, [
    node("span", { className: "question-label", text: "本轮题目" }),
    paragraph(state.question || QUESTION)
  ]);
}


function textareaField({ id, label, hint, placeholder, value = "", compact = false }) {
  const textarea = node("textarea", {
    id,
    name: id,
    placeholder,
    className: compact ? "compact-textarea" : "",
    maxlength: "12000"
  });
  textarea.value = value;
  textarea.addEventListener("input", () => {
    state.drafts ||= {};
    state.drafts[id] = textarea.value;
    saveState();
  });
  return {
    container: node("div", { className: "field" }, [
      node("label", { for: id, text: label }),
      hint ? paragraph(hint, "field-hint") : null,
      textarea
    ]),
    textarea
  };
}


function materialState() {
  state.material ||= {};
  if (!Object.hasOwn(state.material, "excerpt")) {
    state.material.excerpt = state.drafts?.source || state.snapshot?.sourceExcerpt || "";
  }
  state.material.reference ||= "";
  state.material.fileName ||= "";
  return state.material;
}


function materialText() {
  const material = materialState();
  return [
    material.reference ? `资料名称或链接：${material.reference.trim()}` : "",
    material.excerpt ? `资料片段：\n${material.excerpt.trim()}` : ""
  ].filter(Boolean).join("\n\n").slice(0, 12000);
}


function materialEditor({ compact = false } = {}) {
  const material = materialState();
  const reference = node("input", {
    id: "material-reference",
    type: "text",
    inputmode: "url",
    placeholder: "例如：康德课程讲义第 3 讲，或资料链接",
    maxlength: "500"
  });
  reference.value = material.reference;
  reference.addEventListener("input", () => {
    material.reference = reference.value;
    saveState();
  });

  const excerpt = node("textarea", {
    id: "material-excerpt",
    placeholder: "粘贴与这道题直接相关的段落；真正参与诊断的是这里的文字。",
    className: "compact-textarea",
    maxlength: "12000"
  });
  excerpt.value = material.excerpt;
  excerpt.addEventListener("input", () => {
    material.excerpt = excerpt.value;
    saveState();
  });

  const fileInput = node("input", {
    type: "file",
    accept: ".txt,.md,text/plain,text/markdown",
    "aria-label": "选择 TXT 或 Markdown 资料"
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const supported = /\.(txt|md)$/i.test(file.name)
      || ["text/plain", "text/markdown"].includes(file.type);
    if (!supported || file.size > 512 * 1024) {
      errorState = {
        message: "当前只支持 512KB 以内的 TXT 或 Markdown。PDF、Word 请先粘贴与题目相关的段落。",
        retryable: false,
        preserved: false
      };
      render();
      return;
    }
    try {
      material.fileName = file.name;
      material.excerpt = (await file.text()).trim().slice(0, 12000);
      errorState = null;
      saveState();
      render();
    } catch {
      errorState = {
        message: "没有读到这个文件。你可以重新选择，或直接粘贴相关段落。",
        retryable: false,
        preserved: false
      };
      render();
    }
  });

  return node("div", { className: `material-editor${compact ? " material-editor-compact" : ""}` }, [
    node("div", { className: "material-heading" }, [
      node("div", {}, [
        node("h3", { text: "带上你正在用的资料（可选）" }),
        paragraph("不加资料也能开始；它只帮助 AI 判断你依据了什么。", "field-hint")
      ]),
      material.fileName ? node("span", { className: "file-pill", text: material.fileName }) : null
    ]),
    node("div", { className: "field material-field" }, [
      node("label", { for: "material-reference", text: "资料名称或链接" }),
      paragraph("链接只记录来源，AI 不会自动打开网页。", "field-hint"),
      reference
    ]),
    node("div", { className: "field material-field" }, [
      node("label", { for: "material-excerpt", text: "相关原文片段" }),
      paragraph("可直接粘贴，也可选择 TXT / Markdown 自动填入。", "field-hint"),
      excerpt,
      node("div", { className: "file-row" }, [
        fileInput,
        paragraph("PDF、Word 本轮先粘贴相关段落，不做整份知识库。", "file-help")
      ])
    ])
  ]);
}


function button(text, onClick, kind = "primary") {
  return node("button", {
    type: "button",
    className: `button button-${kind}`,
    text,
    disabled: busy ? "disabled" : null,
    onClick
  });
}


function errorNode() {
  if (!errorState) return null;
  const preserved = errorState.preserved !== false && state.stage !== "intro";
  return node("div", { className: "error-message", role: "alert" }, [
    node("strong", { text: errorState.retryable ? "这次处理没有完成" : "还差一步" }),
    paragraph(errorState.message),
    preserved ? paragraph("答案已保留在这台设备上。直接重新提交即可，不用重写。", "error-help") : null,
    errorState.code && errorState.code !== "REQUEST_ERROR"
      ? paragraph(`错误编号：${errorState.code}`, "error-code")
      : null
  ]);
}


function submitLabel(normal, loading) {
  if (busy) return loading;
  if (errorState?.retryable && state.stage !== "intro") return "重新提交（答案已保留）";
  return normal;
}


function setProgress() {
  const info = STAGE_PROGRESS[state.stage];
  if (!info) {
    progressRegion.hidden = true;
    participantBadge.hidden = true;
    return;
  }
  progressRegion.hidden = false;
  progressLabel.textContent = info[1];
  progressCount.textContent = `${info[0]} / 5`;
  progressBar.style.width = `${info[0] * 20}%`;
  participantBadge.hidden = false;
  participantBadge.textContent = state.participantCode || "匿名试用";
}


async function api(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw Object.assign(new Error("网络没有连接上。请检查网络后重新提交。"), {
      code: "NETWORK_ERROR",
      retryable: true,
      preserved: true,
      cause: error
    });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || "网络请求失败，请稍后重试"), {
      code: data.code || "REQUEST_ERROR",
      retryable: data.retryable === true,
      preserved: state.stage !== "intro"
    });
  }
  return data;
}


async function withBusy(action) {
  if (busy) return;
  busy = true;
  errorState = null;
  render();
  try {
    await action();
  } catch (error) {
    errorState = {
      message: error.message || "这次操作没有完成，请重试。",
      code: error.code || "",
      retryable: error.retryable === true,
      preserved: error.preserved !== false
    };
  } finally {
    busy = false;
    saveState();
    render();
  }
}


function sessionPayload(extra = {}) {
  return {
    sessionToken: state.sessionToken,
    snapshot: state.snapshot || {},
    ...extra
  };
}


function applyStepResult(result) {
  state.feedback = result.feedback;
  state.snapshot = result.snapshot;
  state.stage = result.nextStage;
  state.drafts = {};
}


function feedbackCard(feedback) {
  if (!feedback) return null;
  const evidenceItems = (feedback.evidence || []).map((item) => node("div", { className: "quote-card" }, [
    node("blockquote", { text: `“${item.quote}”` }),
    paragraph(item.meaning)
  ]));
  return node("div", { className: "feedback-card" }, [
    node("div", { className: "feedback-section" }, [
      node("span", { className: "state-pill", text: feedback.descriptiveState }),
      node("h3", { text: "我的整体阅读" }),
      paragraph(feedback.overall)
    ]),
    evidenceItems.length ? node("div", { className: "feedback-section" }, [
      node("h3", { text: "我看到的理解证据" }),
      node("div", { className: "evidence-list" }, evidenceItems)
    ]) : null,
    feedback.primaryIssue ? node("div", { className: "feedback-section issue" }, [
      node("h3", { text: "当前只修这一个问题" }),
      paragraph(feedback.primaryIssue)
    ]) : null,
    node("div", { className: "feedback-section action" }, [
      node("h3", { text: "你现在只需要做" }),
      paragraph(feedback.nextAction),
      paragraph(`事实依据：${feedback.sourceStatus}`, "source-status")
    ])
  ]);
}


function renderIntro() {
  if (!inviteCode) {
    return panel("这个链接不完整", "无法开始", [
      paragraph("请使用老师单独发给你的完整试用链接。", "lead"),
      errorNode()
    ]);
  }
  const consent = node("input", { type: "checkbox", id: "consent" });
  return panel("不是替你写，而是帮你看见自己卡在哪里", "匿名试用 · 约 20–40 分钟", [
    paragraph("你会先独立作答。AI 只从你的答案里找出一个最值得修改的问题，等你亲自改完，再对照前后变化。", "lead"),
    questionCard(),
    node("ul", { className: "principles" }, [
      node("li", { text: "不会在你作答前提供完整答案" }),
      node("li", { text: "一次只处理一个关键问题" }),
      node("li", { text: "资料不足或冲突时会明确标记" })
    ]),
    materialEditor(),
    node("label", { className: "consent", for: "consent" }, [
      consent,
      node("span", { text: "我知道答案和反馈会以匿名编号保存，用于改进这套学习方法；请不要填写姓名或其他敏感信息。" })
    ]),
    errorNode(),
    node("div", { className: "button-row" }, [
      button(busy ? "正在准备" : "开始这次陪练", () => withBusy(async () => {
        if (!consent.checked) throw new Error("请先确认匿名试用说明");
        const result = await api("/api/session/start", {
          inviteCode,
          consent: true,
          sourceExcerpt: materialText()
        });
        state = { ...state, ...result, feedback: null, drafts: {} };
      }))
    ])
  ], "hero-panel");
}


function renderInterpretation() {
  const field = textareaField({
    id: "interpretation",
    label: "请先用自己的话说：这道题真正要解释什么？",
    hint: "不用定义所有概念，也不用追求标准措辞。两三句话就够。",
    placeholder: "我理解这道题不是分别介绍两种理性，而是……",
    value: state.drafts?.interpretation || state.snapshot?.questionInterpretation || ""
  });
  return panel("先判断题目，再开始写", "第 1 步 · 审题", [
    questionCard(),
    field.container,
    errorNode(),
    node("div", { className: "button-row" }, [
      button(submitLabel("提交我的理解", "正在阅读"), () => withBusy(async () => {
        const result = await api("/api/session/step", sessionPayload({
          stage: "interpretation",
          input: field.textarea.value
        }));
        applyStepResult(result);
      }))
    ])
  ]);
}


function renderAttempt() {
  const answer = textareaField({
    id: "attempt",
    label: "写下你当前能完成的最好版本",
    hint: "允许不完整、允许暴露不会。不要先搜索范文。",
    placeholder: "从你真正理解的地方开始写……",
    value: state.drafts?.attempt || state.snapshot?.initialAnswer || ""
  });
  return panel("把真实水平交出来", "第 2 步 · 独立作答", [
    questionCard(true),
    feedbackCard(state.feedback),
    node("details", { className: "details-box" }, [
      node("summary", { text: materialText() ? "已添加资料（可修改）" : "补充自己的资料（可选）" }),
      node("div", { className: "details-content" }, [materialEditor({ compact: true })])
    ]),
    answer.container,
    errorNode(),
    node("div", { className: "button-row" }, [
      button(submitLabel("提交独立答案", "正在阅卷"), () => withBusy(async () => {
        state.snapshot.sourceExcerpt = materialText();
        const result = await api("/api/session/step", sessionPayload({
          stage: "attempt",
          input: answer.textarea.value
        }));
        applyStepResult(result);
      }))
    ])
  ]);
}


function renderRepair() {
  const field = textareaField({
    id: "repair",
    label: "只回应上面这个动作",
    hint: "先不用重写整篇。这里检查的是你能否亲自补上关键连接。",
    placeholder: "我的回应是……",
    value: state.drafts?.repair || ""
  });
  return panel("先把一个问题想明白", "第 3 步 · 单点修复", [
    questionCard(true),
    feedbackCard(state.feedback),
    field.container,
    errorNode(),
    node("div", { className: "button-row" }, [
      button(submitLabel("提交我的回应", "正在检查"), () => withBusy(async () => {
        const result = await api("/api/session/step", sessionPayload({ stage: "repair", input: field.textarea.value }));
        applyStepResult(result);
      })),
      button("我现在确实做不到", () => {
        state.stage = "reflection";
        state.snapshot.closureFeedback = "学生在单点修复阶段明确暴露了当前无法完成的环节。";
        saveState();
        render();
      }, "secondary")
    ])
  ]);
}


function renderRewrite() {
  const field = textareaField({
    id: "rewrite",
    label: "请亲自重写答案",
    hint: "保留你原来真实的表达，只修复本轮问题。不必追求满分答案。",
    placeholder: "在这里写下修改后的版本……",
    value: state.drafts?.rewrite || state.snapshot?.rewrittenAnswer || ""
  });
  return panel("现在才进入重写", "第 4 步 · 亲自修改", [
    questionCard(true),
    feedbackCard(state.feedback),
    node("div", { className: "info-card" }, [
      node("h3", { text: "修改前的答案" }),
      paragraph(state.snapshot?.initialAnswer || "暂无初答", "muted")
    ]),
    field.container,
    errorNode(),
    node("div", { className: "button-row" }, [
      button(submitLabel("提交重写版本", "正在对照"), () => withBusy(async () => {
        const result = await api("/api/session/step", sessionPayload({ stage: "rewrite", input: field.textarea.value }));
        applyStepResult(result);
      }))
    ])
  ]);
}


function choiceGroup(name, options) {
  return node("div", { className: "choice-group" }, options.map((option) => {
    const input = node("input", { type: "radio", name, value: option, id: `${name}-${option}` });
    return node("label", { className: "choice-chip", for: `${name}-${option}` }, [input, node("span", { text: option })]);
  }));
}


function checkedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}


function renderReflection() {
  const explanation = textareaField({
    id: "explanation",
    label: "最后，请用一句话说明你改了什么、为什么这样改",
    placeholder: "我原来只是……，现在补上了……，因为……",
    value: state.drafts?.explanation || "",
    compact: true
  });
  const confusion = textareaField({
    id: "confusion",
    label: "哪个地方让你觉得卡、空泛或像被 AI 代写？（可选）",
    placeholder: "没有可以留空；有的话请尽量具体。",
    value: state.drafts?.confusion || "",
    compact: true
  });
  return panel("看见自己到底改了什么", "第 5 步 · 前后对照", [
    questionCard(true),
    feedbackCard(state.feedback),
    node("div", { className: "compare-grid" }, [
      node("div", { className: "compare-card" }, [node("span", { text: "修改前" }), paragraph(state.snapshot?.initialAnswer || "本次没有形成完整初答")]),
      node("div", { className: "compare-card" }, [node("span", { text: "修改后" }), paragraph(state.snapshot?.rewrittenAnswer || "本次明确记录了无法继续的具体环节")])
    ]),
    explanation.container,
    node("fieldset", { className: "field choice-group" }, [
      node("legend", { text: "这次诊断命中了你的真实困难吗？" }),
      ...choiceGroup("diagnosis", ["是", "部分", "否"]).children
    ]),
    node("fieldset", { className: "field choice-group" }, [
      node("legend", { text: "你愿意再用它练另一道题吗？" }),
      ...choiceGroup("reuse", ["是", "否"]).children
    ]),
    confusion.container,
    errorNode(),
    node("div", { className: "button-row" }, [
      button(submitLabel("完成本次陪练", "正在保存"), () => {
        const reflection = {
          studentExplanation: explanation.textarea.value,
          diagnosisHit: checkedValue("diagnosis"),
          willingReuse: checkedValue("reuse"),
          uxConfusion: confusion.textarea.value
        };
        return withBusy(async () => {
          const result = await api("/api/session/complete", sessionPayload({ reflection }));
          state.stage = result.stage;
          state.saved = result.saved;
        });
      })
    ])
  ]);
}


function renderComplete() {
  return panel("这次不是写出满分，而是完成了一次真实修正", "本次完成", [
    node("div", { className: "success-mark", text: "✓" }),
    paragraph("你的初答、关键问题、回应和重写已经以匿名编号保存。老师只会先看前后变化，再查看你属于哪一组。", "lead"),
    node("div", { className: "info-card" }, [
      node("h3", { text: "请带走这一句话" }),
      paragraph(state.drafts?.explanation || "学习不是一次写对，而是知道自己这次真正修正了什么。")
    ]),
    node("div", { className: "button-row" }, [
      button("查看这次前后答案", () => {
        state.stage = "reflection";
        saveState();
        render();
      }, "secondary")
    ])
  ]);
}


function render() {
  setProgress();
  const screens = {
    intro: renderIntro,
    interpretation: renderInterpretation,
    attempt: renderAttempt,
    repair: renderRepair,
    rewrite: renderRewrite,
    reflection: renderReflection,
    complete: renderComplete
  };
  appRoot.replaceChildren((screens[state.stage] || renderIntro)());
  appRoot.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}


setInterval(() => {
  if (!state.startedAt || ["intro", "complete"].includes(state.stage)) return;
  const elapsedMinutes = (Date.now() - Date.parse(state.startedAt)) / 60000;
  if (elapsedMinutes > 40 && !document.querySelector("#time-notice")) {
    const notice = node("div", {
      id: "time-notice",
      className: "notice",
      text: "你已经思考了较长时间。可以暂停，但不会因为时间到了就自动进入下一步。"
    });
    appRoot.querySelector(".panel")?.prepend(notice);
  }
}, 30000);

render();
