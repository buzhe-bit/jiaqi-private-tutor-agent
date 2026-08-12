# Mini Program Design QA

## Evidence

- Source visual truth: `/Users/xiaoshushenxia/.codex/generated_images/019fb1cc-20b1-7a72-9870-73e413431317/exec-58e925c3-c885-42f4-bd71-952e38e22544.png`
- Source pixels: `853 × 1877`; intended CSS viewport: `390 × 844`; normalized design density: approximately `2.19x`.
- Implementation: native WeChat mini-program in `/Users/xiaoshushenxia/Documents/New project/01-项目/私教智能体/miniprogram/`.
- Implementation screenshot: unavailable.
- Intended viewport/state: `390 × 844`, teaching stage after the first tutor explanation, before student restatement.

## Full-view comparison evidence

Blocked. The selected source mock was opened and reviewed, but this Mac does not have WeChat DevTools installed and no native mini-program renderer is available. Code inspection and automated template tests are not a substitute for a rendered implementation screenshot.

## Focused-region comparison evidence

Blocked for the same reason. The following regions still require a rendered inspection:

- top plum branch and four-step sticky progress;
- structured tutor card with long Chinese content;
- three icon help actions and primary restatement button;
- draggable floating tutor and bottom question sheet;
- safe-area spacing above the native tab bar.

## Findings

- [P1] Native visual evidence is missing.
  - Location: whole training screen.
  - Evidence: source image is available, but there is no WeChat-rendered implementation screenshot.
  - Impact: exact font fallback, `rpx` spacing, sticky behavior, movable-view layering and native textarea rendering cannot be judged reliably.
  - Fix: import the repository root into WeChat DevTools in tourist mode, capture the teaching state at `390 × 844`, then compare it with the source mock.

## Automated evidence completed

- 12 representative mini-program behavior and adversarial layout samples pass.
- 31 focused mini-program tests pass.
- 193 full-project tests pass.
- Long one-line tutor responses are split into semantic paragraphs.
- Floating tutor position is clamped and persisted locally.
- Drafts survive failed follow-ups and unfinished sessions survive app restart.
- Tab icons are local PNG assets derived from Iconoir and include license attribution.

## Comparison history

- Iteration 1: replaced the web-like report layout with a single-column native learning flow; made the question collapsible; promoted the current action; preserved the three icon help choices.
- Iteration 2: replaced the fixed tutor button with native `movable-area` / `movable-view`, added a bottom question sheet, safe-area spacing and position persistence.
- Iteration 3: added semantic paragraph fallback, inline request/error states, post-response anchoring and narrow-screen overflow protections.
- Post-fix visual evidence: unavailable until WeChat DevTools renders the project.

## Follow-up polish

- P3: after native capture, tune title fallback weight and plum crop if WeChat's font metrics differ from the mock.
- P3: verify the movable tutor does not feel too large on smaller Android devices.

final result: blocked
