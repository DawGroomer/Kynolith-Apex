import assert from "node:assert/strict";
import test from "node:test";
import {
  enumerateHudDisplays,
  resolveHudSurface,
  type HudDisplay,
  type HudBounds
} from "./hud-display.js";

const displays: HudDisplay[] = [
  { id: 11, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
  { id: 22, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 33, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
];
const centerDisplay = displays[1]!;

test("enumerates three displays with negative and positive coordinates", () => {
  const options = enumerateHudDisplays(displays, 22);

  assert.deepEqual(
    options.map(option => ({ id: option.id, label: option.label })),
    [
      { id: "11", label: "Display 1 — 1920×1080 — Left" },
      { id: "22", label: "Display 2 — 1920×1080 — Center" },
      { id: "33", label: "Display 3 — 1920×1080 — Right" },
      { id: "span-all-displays", label: "Span All Displays" }
    ]
  );
});

test("resolves a selected center display without clamping to primary", () => {
  const resolved = resolveHudSurface(displays, "22", 22);

  assert.deepEqual(resolved.bounds, centerDisplay.bounds);
  assert.equal(resolved.target, "22");
  assert.equal(resolved.fellBack, false);
});

test("treats the primary-display default as intentional, not as fallback", () => {
  const resolved = resolveHudSurface(displays, "primary-display", 22);

  assert.deepEqual(resolved.bounds, centerDisplay.bounds);
  assert.equal(resolved.target, "22");
  assert.equal(resolved.fellBack, false);
});

test("resolves span-all using the full union including negative-X space", () => {
  const resolved = resolveHudSurface(displays, "span-all-displays", 22);

  assert.deepEqual(resolved.bounds, {
    x: -1920,
    y: 0,
    width: 5760,
    height: 1080
  });
  assert.equal(resolved.target, "span-all-displays");
  assert.equal(resolved.fellBack, false);
});

test("falls back to the primary display when the saved display is disconnected", () => {
  const resolved = resolveHudSurface(displays, "99", 22);

  assert.deepEqual(resolved.bounds, centerDisplay.bounds);
  assert.equal(resolved.target, "22");
  assert.equal(resolved.fellBack, true);
});

test("ignores saved HUD bounds that are stale for the selected surface", () => {
  const staleBounds: HudBounds = {
    x: -1920,
    y: 0,
    width: 1920,
    height: 1080
  };
  const resolved = resolveHudSurface(displays, "22", 22, staleBounds);

  assert.deepEqual(resolved.bounds, centerDisplay.bounds);
  assert.equal(resolved.usedSavedBounds, false);
});
