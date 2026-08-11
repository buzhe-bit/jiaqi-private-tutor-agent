const TRANSITIONS = {
  attempt: {
    TEACH: "teaching",
    REVISE: "revision"
  },
  teaching: {
    TEACH: "teaching"
  },
  restate: {
    TEACH: "restate",
    RETEACH: "teaching",
    REVISE: "revision"
  },
  revision: {
    TEACH: "revision",
    REVISE: "revision",
    CLOSE_LOOP: "complete"
  }
};


const ACTIONS = {
  attempt: new Set(["submit_attempt"]),
  teaching: new Set([
    "request_hint",
    "request_explanation",
    "request_example",
    "request_reference",
    "ask_followup"
  ]),
  restate: new Set(["ask_followup", "submit_restate"]),
  revision: new Set(["ask_followup", "submit_revision"])
};


const ACTION_GATES = {
  submit_attempt: ["TEACH", "REVISE"],
  request_hint: ["TEACH"],
  request_explanation: ["TEACH"],
  request_example: ["TEACH"],
  request_reference: ["TEACH"],
  ask_followup: ["TEACH"],
  submit_restate: ["RETEACH", "REVISE"],
  submit_revision: ["REVISE", "CLOSE_LOOP"]
};


export function nextStageFor(stage, gate) {
  const nextStage = TRANSITIONS[stage]?.[gate];
  if (!nextStage) {
    throw new Error(`状态 ${stage} 不允许接收 ${gate}`);
  }
  return nextStage;
}


export function actionAllowedFor(stage, action) {
  return ACTIONS[stage]?.has(action) || false;
}


export function expectedGatesForAction(action) {
  return ACTION_GATES[action] || [];
}


export function expectedGatesFor(stage) {
  return Object.keys(TRANSITIONS[stage] || {});
}
