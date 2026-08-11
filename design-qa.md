# Design QA

**Comparison target**

- Source visual truth: `/Users/xiaoshushenxia/.codex/generated_images/019fb1cc-20b1-7a72-9870-73e413431317/exec-b687cf23-1106-4acf-8bbb-26acda3a50a0.png`
- Source pixels: `852 × 1846`; normalized proportionally into `390 × 844` with warm-paper padding.
- Mobile implementation: `design-qa/screenshots/plum-stage-2.png`, `390 × 844` pixels at a `390 × 844` CSS viewport.
- Desktop implementation: `design-qa/screenshots/implementation-700x570.png`, `700 × 570` pixels at a `700 × 570` CSS viewport.
- State: second learning stage, after the student answered “不知道”; desktop evidence additionally covers the completed state.
- Full-view comparison: `design-qa/screenshots/comparison-mobile.png`.
- Latest teaching-state comparison: `design-qa/screenshots/latest-comparison-390x844.png`.
- Latest loading evidence: `design-qa/screenshots/latest-loading-visible-390x844.png` and `design-qa/screenshots/latest-loading-700x570.jpg`.
- Focused evidence: the header was inspected separately in both viewports. A separate focused artifact is unnecessary in the final pass because the full-view comparison renders the title, branch, stage line and completion condition legibly at 1:1 mobile density.

**Findings**

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: the Chinese serif display hierarchy, larger title requested by the user, plum-colored stage heading and readable body hierarchy match the selected direction. The implementation uses local Songti/STSong fallbacks, so no remote font failure is introduced.
- Spacing and layout rhythm: the paper-like single column, fine rules, left editorial markers and low-radius controls match the source. The live page contains the full original exam question and real AI feedback, so it is intentionally denser than the compressed static mock; the sticky stage/condition strip preserves orientation.
- Colors and tokens: warm ivory, ink black, plum wine and muted gold are consistent across both captures; there are no green remnants, decorative gradients or heavy shadows.
- Image quality and asset fidelity: the implementation uses the exact approved short-branch artwork cropped from the selected mock. It is rendered with `object-fit: contain`, keeps its aspect ratio, does not overlap the title, and does not crop a flower. Intermediate stages use an ink-fade mask whose boundaries sit between large blossoms; the final state shows the whole branch.
- Copy and content: stage names, completion conditions, question, teaching focus and primary action are student-facing. Internal evaluator labels remain absent.
- Icons and affordances: the three secondary actions keep real Lucide icons (prompt, example, reference), while the burgundy primary action remains visually dominant.

**Comparison history**

1. Initial pass found P1 page jumping after submissions. Removed automatic `scrollIntoView`, then kept the largest rendered app height so stage changes no longer shrink and clamp the scroll position. Browser evidence: `321.5 → 321.5`, `653 → 653`, `1408.5 → 1408.5` across the tested transitions.
2. Second pass found P2 branch/title overlap at both target widths. Assigned independent image and title regions. Post-fix geometry: mobile image right `138`, title left `142`; desktop image right `258`, title left `288`.
3. Third pass found P2 crop/distortion risk: a cover crop could remove blossoms, while clip animation could temporarily show half a flower. Switched to aspect-ratio-preserving `contain` and discrete ink-fade progress stops. Post-fix evidence: `design-qa/screenshots/plum-stage-1.png`, `design-qa/screenshots/plum-stage-2.png`, `design-qa/screenshots/implementation-390x844.png`.
4. Fourth pass found P2 feedback density. Moved diagnostic evidence into an optional disclosure while keeping the conclusion and one key relation visible. Post-fix evidence: `design-qa/screenshots/comparison-mobile.png`.

**Primary interactions tested**

- Start a fresh anonymous session.
- Submit “不知道” and enter teaching without being催答.
- Enter restatement, submit a correct relationship, and enter revision.
- Submit the revised expression and reach completion.
- Copy the full expression note; clipboard contained 931 characters and the expected title.
- Three state transitions preserved the current scroll position.
- `390 × 844` and `700 × 570` had no horizontal overflow.
- Browser console warnings/errors: none.
- Automated verification: `68/68` tests passed. Coverage: lines `91.66%`, branches `75.29%`, functions `91.78%`.

**2026-08-06 interaction pass**

- The visible four-step progress now shows completed, current and pending states: `初次作答 → 弄懂关系 → 用自己的话说 → 改进答案`.
- Teaching presents exactly three icon actions: `给我一个提示`, `讲明白（解释＋例子）`, `看一种可行作答`. The explanation response contains the key relationship followed by a short example; `request_example` remains backend-only compatibility.
- Submission feedback appears in the originating composer before the request leaves: saved/submitted, tutor thinking, indeterminate loading line, generated, and the next action.
- At `700 × 570`, the request status remained visible in the viewport and the scroll position was unchanged from loading to generated (`1075.5 → 1075.5`). At `390 × 844`, the student's `不知道` remained in the textarea while loading.
- Both target widths retained their exact CSS viewport width with no horizontal overflow (`390 → 390`, `700 → 700`).
- Latest implementation screenshots: `design-qa/screenshots/latest-teaching-390x844.png` and `design-qa/screenshots/latest-teaching-700x570.jpg`.

**Open Questions**

- None blocking this single-question MVP.

**Implementation Checklist**

- [x] Preserve the existing learning state machine and real controls.
- [x] Keep stage and completion condition visible.
- [x] Preserve the three secondary icons.
- [x] Prevent page jumping, image/text overlap, branch truncation and image distortion.
- [x] Verify mobile and narrow-desktop sizes.

**Follow-up Polish**

- P3: after real-student testing, adjust only the density of unusually long model explanations; do not change the current hierarchy before evidence shows a recurring problem.

final result: passed
