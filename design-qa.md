# Mini Program Design QA

## Evidence

- Source visual truth: `/Users/xiaoshushenxia/.codex/generated_images/019fb1cc-20b1-7a72-9870-73e413431317/exec-58e925c3-c885-42f4-bd71-952e38e22544.png`
- Source pixels: `853 × 1844`; intended CSS viewport: `390 × 844`; normalized source: `design-qa/wechat-native-2026-08-13/04-source-390x844.png`.
- Native implementation: WeChat DevTools Stable `2.01.2510290`, iPhone 12/13 Pro simulator, repository root imported for the archived simulator capture. The current project AppID is `wxfa3953c780a246d8`.
- Full DevTools capture: `design-qa/wechat-native-2026-08-13/02-teaching-with-floating-tutor-full.png` (`1200 × 768`).
- Normalized implementation crop: `design-qa/wechat-native-2026-08-13/03-implementation-390x844.png`.
- Literal same-input comparison: `design-qa/wechat-native-2026-08-13/05-comparison-side-by-side.png` (`780 × 844`).
- Compared state: teaching stage after first submission, before student restatement.

## Full-view comparison evidence

The normalized side-by-side comparison confirms the intended product language is preserved in the native build: warm paper background, plum/wine accents, Song-style headings, a structured tutor card, student/coach hierarchy, three help entries, the primary restatement path and the floating tutor.

The native screenshot contains a longer realistic conversation than the visual target, so its lower controls are below the first viewport. This is an intentional content-height difference rather than missing UI: the native accessibility tree confirms all three help actions and the primary restatement button are rendered, and native scrolling reaches them.

## Focused-region comparison evidence

- Header/progress: native capture verifies the plum asset, stage title, four progress markers and completion condition remain visible at the top after submission.
- Conversation: long tutor content wraps into semantic sections without horizontal overflow; student answer is right aligned and visually distinct.
- Help/actions: all three icon actions render with the same labels as the source; the main restatement button follows them.
- Floating tutor: dragged from the right edge to the left content area and remained within the safe area; a subsequent tap opened the native bottom question sheet.
- Safe area: the sheet button and content sit above the iPhone home indicator; no bottom control is clipped.

## Findings

- No actionable P0/P1/P2 mismatch remains for this MVP state.
- The simulator's system font metrics are slightly denser than the generated visual target, but hierarchy, wrapping and legibility remain intact; classified as acceptable native-platform variance.
- The full first viewport cannot show both a long tutor explanation and the bottom action bar simultaneously. Keeping the explanation readable takes precedence; sticky progress and the movable tutor preserve orientation and help access.

## Primary interactions tested

- Imported the repository root and compiled the archived simulator capture; the current project uses the configured AppID above.
- Opened today's recommendation and entered the training page.
- Submitted a first answer and verified progress advanced from step 1 to step 2.
- Verified all three teaching actions are present.
- Dragged the floating tutor and verified its position changes within the safe area.
- Tapped the tutor after dragging and opened the bottom follow-up sheet.
- Verified the sheet respects the iPhone safe area.
- Native debugger reported 0 errors. The seven warnings are accessibility/image-description notices for decorative/local assets, not runtime failures.

## Comparison history

- Iteration 1: replaced the web-like report layout with a single-column native learning flow; made the question collapsible; promoted the current action; preserved the three icon help choices.
- Iteration 2: replaced the fixed tutor button with native `movable-area` / `movable-view`, added a bottom question sheet, safe-area spacing and position persistence.
- Iteration 3: added semantic paragraph fallback, inline request/error states, post-response anchoring and narrow-screen overflow protections.
- Native pass: installed Tencent-signed WeChat DevTools, compiled the current branch, exercised the main teaching path, captured the rendered state and compared it against the source in one normalized side-by-side image. No new P0/P1/P2 issue was found.

## Follow-up polish

- P3: after the real CloudBase / DeepSeek E2E path and a fresh preview QR are confirmed, repeat the same pass on one physical iPhone and one Android device.
- P3: add accessible descriptions for the decorative plum image and the three local icon assets to remove the remaining simulator warnings.

final result: passed (visual/simulator QA only; it does not confirm real CloudBase / DeepSeek E2E or online capacity)
