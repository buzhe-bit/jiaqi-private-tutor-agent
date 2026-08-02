const TRANSITIONS = {
  interpretation: {
    CLARIFY_QUESTION: "interpretation",
    SUBMIT_ATTEMPT: "attempt"
  },
  attempt: {
    REPAIR_ONE_ISSUE: "repair",
    REWRITE: "rewrite"
  },
  repair: {
    REPAIR_ONE_ISSUE: "repair",
    REWRITE: "rewrite"
  },
  rewrite: {
    REPAIR_ONE_ISSUE: "repair",
    REWRITE: "rewrite",
    CLOSE_LOOP: "reflection"
  }
};


export function nextStageFor(stage, gate) {
  const nextStage = TRANSITIONS[stage]?.[gate];
  if (!nextStage) {
    throw new Error(`状态 ${stage} 不允许接收 ${gate}`);
  }
  return nextStage;
}


export function expectedGatesFor(stage) {
  return Object.keys(TRANSITIONS[stage] || {});
}
