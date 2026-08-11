import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


const scenarios = JSON.parse(await readFile(
  new URL("./fixtures/learning-loop-scenarios.json", import.meta.url),
  "utf8"
));
const ISSUE_TYPES = new Set([
  "knowledge_missing",
  "concept_misunderstanding",
  "relation_broken",
  "expression_scattered",
  "basically_mastered",
  "delayed_recall_unstable"
]);
const MASTERY_STATES = new Set(["unstable", "developing", "stable"]);


test("long-term learning contract contains sixteen representative behaviors", () => {
  assert.equal(scenarios.length, 16);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 16);
});


for (const scenario of scenarios) {
  test(`long-term behavior contract: ${scenario.id}`, () => {
    assert.ok(scenario.studentInput.trim());
    assert.equal(ISSUE_TYPES.has(scenario.expectedIssueType), true);
    assert.equal(MASTERY_STATES.has(scenario.expectedMasteryStatus), true);
    assert.equal([1, 3, 7, 14].includes(scenario.expectedReviewAfterDays), true);
    assert.ok(scenario.expectedVisibleBehavior.trim());
  });
}
