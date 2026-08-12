import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { clampCoachPosition, defaultCoachPosition } = require("../miniprogram/core/floating-coach.js");


test("11. floating tutor starts inside the readable safe area", () => {
  assert.deepEqual(defaultCoachPosition({ width: 390, height: 844 }), { x: 306, y: 626 });
});


test("12. dragged tutor is clamped away from screen edges and bottom action", () => {
  assert.deepEqual(
    clampCoachPosition({ x: 999, y: 999 }, { width: 390, height: 844 }),
    { x: 306, y: 626 }
  );
  assert.deepEqual(
    clampCoachPosition({ x: -80, y: -20 }, { width: 390, height: 844 }),
    { x: 12, y: 104 }
  );
});
