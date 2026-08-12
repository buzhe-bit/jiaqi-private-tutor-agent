const FAB_SIZE = 72;
const EDGE = 12;
const TOP_SAFE = 104;
const BOTTOM_RESERVED = 146;

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), Math.max(min, max));
}

function clampCoachPosition(point = {}, viewport = {}) {
  const width = Number(viewport.width) || 390;
  const height = Number(viewport.height) || 844;
  return {
    x: Math.round(clamp(point.x, EDGE, width - FAB_SIZE - EDGE)),
    y: Math.round(clamp(point.y, TOP_SAFE, height - FAB_SIZE - BOTTOM_RESERVED))
  };
}

function defaultCoachPosition(viewport = {}) {
  return clampCoachPosition({ x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER }, viewport);
}

module.exports = { clampCoachPosition, defaultCoachPosition };
