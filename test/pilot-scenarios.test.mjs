import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMockCoach } from "../src/coach/providers.mjs";


const scenarios = JSON.parse(await readFile(
  new URL("../tests/philosophy_answer_coach/scenarios.json", import.meta.url),
  "utf8"
));


for (const scenario of scenarios) {
  test(`pilot scenario: ${scenario.id}`, async () => {
    const coach = createMockCoach();
    const feedback = await coach.evaluate({
      action: scenario.action,
      snapshot: {
        initialAnswer: scenario.stage === "teaching" ? "不知道" : "",
        sourceExcerpt: scenario.id === "source_conflict" ? "学生讲义原文" : ""
      },
      input: scenario.student_input
    });

    assert.equal(feedback.gate, scenario.expected_gate);
    assert.ok(feedback.message.trim());
    assert.ok(feedback.focus.trim());
    assert.doesNotMatch(
      `${feedback.message}\n${feedback.focus}\n${feedback.teaching}`,
      /理解证据|事实依据状态|材料堆积|我的整体阅读/
    );
  });
}


test("P01 不知道样例停止催答并开放全部帮助", async () => {
  const feedback = await createMockCoach().evaluate({
    action: "submit_attempt",
    snapshot: {},
    input: "理论理性也许就是对于事物的看法，实践理性可能引入上帝。我不知道。"
  });

  assert.equal(feedback.gate, "TEACH");
  assert.deepEqual(feedback.nextActions, ["hint", "explain", "reference", "restate"]);
  assert.match(feedback.message, /不让你继续硬写|先不让你/);
});


test("连续没听懂必须明确换讲法", async () => {
  const feedback = await createMockCoach().evaluate({
    action: "ask_followup",
    snapshot: { initialAnswer: "不知道" },
    input: "我还是没听懂，刚才那种解释对我没用。"
  });

  assert.equal(feedback.gate, "TEACH");
  assert.match(`${feedback.message}\n${feedback.teaching}`, /换成|换一种|两个问题/);
});
