# Philosophy Coach Expression Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fixed-question coaching flow recover once from transient model failures, show feedback as “already clear / one missing point / explanation”, and end with a plain-text expression note the student can copy away.

**Architecture:** Keep the existing state machine and `/api/session/step`. Extend the model response contract with two student-visible strings, retry the same upstream request at most once, and deterministically assemble the completion note from the Kant fixture plus session data. The browser renders only escaped plain text and owns clipboard behavior. No new dependency, model call, database field, or product surface is introduced.

**Tech Stack:** Node.js ESM, built-in `fetch`, `node:test`, vanilla browser JavaScript and CSS, CloudBase Run, existing Feishu Base recorder.

## Global Constraints

- Preserve the current stages and existing Feishu table structure.
- A transient request gets two total upstream attempts, never nested retry loops.
- Logs may contain action, attempt, status and upstream request ID; never student text, invite codes, API keys or full request bodies.
- `studentEvidence` and `missingPoint` are short plain-text fields. Internal diagnostic fields stay server-side.
- The expression note is generated without another model request.
- “一种可行作答” must not be labelled as the unique standard answer.
- Visual work is limited to readable blocks, wrapping and usable controls.
- Add focused tests first and keep affected code coverage at or above 80%.

---

### Task 1: Retry transient upstream failures once

**Files:**
- Modify: `src/coach/providers.mjs`
- Modify: `test/adapters.test.mjs`

**Interface:** `createCloudbaseCoach(...)` keeps its current caller API and may additionally accept injectable `delay` and `logger` test seams. Every request has at most two attempts.

- [ ] **Step 1: Add failing provider tests**

Cover these cases with a queued `fetchImpl`:

```js
test("CloudBase coach retries one non-2xx response and succeeds", async () => {
  const fetchImpl = queuedFetch([
    response(503, { requestId: "req-first" }),
    response(200, validCoachBody()),
  ]);
  const coach = createCloudbaseCoach({ fetchImpl, delay: async () => {} });
  assert.equal((await coach(validContext())).message, "先抓住自由的两种用法。");
  assert.equal(fetchImpl.calls.length, 2);
});
```

Also assert that two non-2xx responses reject with `COACH_UPSTREAM_ERROR`, and captured log arguments do not include the supplied student answer or API key.

- [ ] **Step 2: Run the focused test and confirm it fails for missing HTTP retry**

Run: `node --test test/adapters.test.mjs`

Expected: the 503-then-200 case rejects after the first response.

- [ ] **Step 3: Implement one bounded retry path**

Use one loop for HTTP errors, timeouts, network errors and invalid model output:

```js
for (let attempt = 1; attempt <= 2; attempt += 1) {
  try {
    const response = await fetchImpl(...);
    if (!response.ok) throw upstreamHttpError(response, body);
    return normalizeProviderResponse(body);
  } catch (error) {
    logSafeFailure({ action: context.action, attempt, error });
    if (attempt === 2) throw publicCoachError(error);
    await delay(RETRY_DELAY_MS);
  }
}
```

Extract request IDs only from known response headers or response JSON. Do not log the input payload.

- [ ] **Step 4: Run provider tests**

Run: `node --test test/adapters.test.mjs`

Expected: all provider tests pass; success after one retry makes exactly two calls.

- [ ] **Step 5: Commit the retry change**

```bash
git add src/coach/providers.mjs test/adapters.test.mjs
git commit -m "fix: retry transient coach failures once"
```

---

### Task 2: Expose concise evidence and one missing point

**Files:**
- Modify: `src/coach/response-contract.mjs`
- Modify: `src/coach/prompt.mjs`
- Modify: `src/coach/providers.mjs`
- Modify: `test/coach-core.test.mjs`
- Modify: `test/adapters.test.mjs`
- Modify: `test/api.test.mjs`
- Modify: `test/coaching-flow-v2.test.mjs`

**Interface:** Valid model JSON adds required string fields `studentEvidence` and `missingPoint`. `studentFacingFeedback()` returns both, while `learnerNeed`, `sourceStatus` and gate decisions remain hidden.

- [ ] **Step 1: Add failing contract and API assertions**

```js
assert.deepEqual(studentFacingFeedback(normalized), {
  message: normalized.message,
  studentEvidence: normalized.studentEvidence,
  missingPoint: normalized.missingPoint,
  focus: normalized.focus,
  teaching: normalized.teaching,
  nextActions: normalized.nextActions,
});
assert.equal("learnerNeed" in publicFeedback, false);
```

Update valid response fixtures only after the failing assertion is present. Add a P04-style scenario asserting that the response distinguishes the basically correct theoretical-reason part from the missing positive practical reality/connection.

- [ ] **Step 2: Run focused tests and confirm the contract fails**

Run:

```bash
node --test test/coach-core.test.mjs test/api.test.mjs test/coaching-flow-v2.test.mjs
```

- [ ] **Step 3: Implement the contract and prompt**

Require both fields to be non-empty strings. Tell the model:

```text
message: 先给一句结论
studentEvidence: 只概括学生已经说对的部分
missingPoint: 本轮唯一要补的关系或表达问题
teaching: 重点前置，用空行分成短段，不重复催答
```

Update deterministic/local fixtures so every path returns the same contract.

- [ ] **Step 4: Run all affected tests**

Run:

```bash
node --test test/coach-core.test.mjs test/adapters.test.mjs test/api.test.mjs test/coaching-flow-v2.test.mjs
```

- [ ] **Step 5: Commit the feedback contract**

```bash
git add src/coach/response-contract.mjs src/coach/prompt.mjs src/coach/providers.mjs test/coach-core.test.mjs test/adapters.test.mjs test/api.test.mjs test/coaching-flow-v2.test.mjs
git commit -m "feat: structure student coaching feedback"
```

---

### Task 3: Build the deterministic expression note

**Files:**
- Create: `src/coach/expression-note.mjs`
- Create: `test/expression-note.test.mjs`
- Modify: `src/app.mjs`
- Modify: `test/api.test.mjs`

**Interface:** When a step enters `complete`, `/api/session/step` additionally returns:

```js
{
  expressionNote: {
    question,
    answerHook,
    initialExpression,
    studentEvidence,
    aiSupplement,
    answerStructure: ["...", "...", "..."],
    finalExpression,
    possibleAnswer,
    nextRecallQuestion,
  }
}
```

- [ ] **Step 1: Add failing pure-function tests**

Assert all nine sections are present, student text is preserved verbatim, the answer structure has three items, and missing optional model fields fall back to the fixed Kant fixture instead of producing `undefined`.

- [ ] **Step 2: Run the focused test and confirm the module is absent**

Run: `node --test test/expression-note.test.mjs`

- [ ] **Step 3: Implement a small fixture-backed builder**

Keep the question-specific constants in one module and expose only:

```js
export function buildExpressionNote({ question, snapshot, feedback }) { ... }
```

Do not call a model, fetch data or modify the snapshot.

- [ ] **Step 4: Attach the note only on completion**

In `processStep`, build the note after the final snapshot update and return `expressionNote: null` for earlier stages. Add API assertions for both branches.

- [ ] **Step 5: Run note and API tests**

Run: `node --test test/expression-note.test.mjs test/api.test.mjs`

- [ ] **Step 6: Commit the note builder**

```bash
git add src/coach/expression-note.mjs src/app.mjs test/expression-note.test.mjs test/api.test.mjs
git commit -m "feat: generate completion expression notes"
```

---

### Task 4: Render readable feedback and copyable completion output

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/server.test.mjs`

**Interfaces:** Browser state persists `expressionNote`. Feedback renders in the fixed order from the design. Completion offers copy-all, copy-final and copy-possible-answer actions. Clipboard failure exposes a selectable textarea containing the exact requested text.

- [ ] **Step 1: Add failing client-contract tests**

Assert the shipped client includes and uses:

```js
splitTeaching(text)
formatExpressionNote(note)
copyText(text)
```

Also assert visible headings `你已经说对的`, `现在只补这一点`, `一种可行作答`, and three distinct copy actions.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test test/server.test.mjs`

- [ ] **Step 3: Implement pure text rendering**

- Split `teaching` on blank lines and render each segment with `textContent`/escaped template output.
- Store `result.expressionNote` in local state.
- Format the full note with fixed section headings and blank lines.
- Use `navigator.clipboard.writeText`; on failure show a labelled readonly textarea and select it.
- Keep buttons wrapping on narrow screens and avoid horizontal scrolling.

- [ ] **Step 4: Run server/client tests**

Run: `node --test test/server.test.mjs`

- [ ] **Step 5: Commit the browser flow**

```bash
git add public/app.js public/styles.css test/server.test.mjs
git commit -m "feat: render and copy expression notes"
```

---

### Task 5: Full verification and deployment

**Files:**
- Modify if necessary: `scripts/verify-production.mjs`
- Modify if necessary: `docs/pilot-runbook.md`

- [ ] **Step 1: Run the full automated suite with coverage**

Run:

```bash
npm test
npm run test:coverage
python3 -m unittest tests/philosophy_answer_coach/test_skill_contract.py -v
```

Expected: all tests pass; affected JavaScript coverage remains at least 80%.

- [ ] **Step 2: Start the local service and verify representative flows**

Test at least:

1. `我不知道` → help choice, no repeated urging.
2. P04-like partial understanding → correct part and missing connection are separated.
3. Complete restatement and revision → expression note and all copy texts appear.
4. Simulated first 503 → silent automatic success on retry.
5. Simulated second failure → original answer remains available for retry.

- [ ] **Step 3: Check the two required viewports**

Use approximately `700×570` and `390×844`. Confirm question visibility, input access, wrapping feedback, copy buttons and fallback textarea without horizontal overflow.

- [ ] **Step 4: Deploy the existing CloudBase service**

Deploy only to the already-authorized environment and service, with no paid add-on and no Feishu schema mutation:

```bash
npx --yes --package @cloudbase/cli tcb cloudrun deploy \
  -e first-001sijiao-d1fad71w28f4562b \
  -s philosophy-coach \
  --port 80 \
  --source .
```

Stop if CloudBase requests a new paid resource.

- [ ] **Step 5: Run production smoke checks**

Use an unused pilot invite and verify the partial-understanding and completion paths. Do not alter the Feishu table structure.

- [ ] **Step 6: Record final evidence**

Report test counts, coverage, deployed revision/URL, smoke result, and any remaining limitation. Do not claim deployment success without a live response.

---

## Plan Self-Review Checklist

- [ ] Every design acceptance item maps to a task or explicit non-goal.
- [ ] All new field names match across contract, provider fixtures, API and browser.
- [ ] No unfinished placeholder markers remain.
- [ ] Retry count is globally bounded to two attempts.
- [ ] No test or log assertion exposes student content or credentials.
- [ ] Expression note is deterministic and copy output is plain text.
- [ ] No new dependency or Feishu schema change is introduced.
