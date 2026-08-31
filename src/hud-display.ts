export const PRIMARY_DISPLAY_TARGET = "primary-display";
export const SPAN_ALL_DISPLAYS_TARGET = "span-all-displays";

export interface HudBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HudDisplay {
  id: number | string;
  bounds: HudBounds;
}

export interface HudDisplayOption {
  id: string;
  label: string;
  bounds: HudBounds;
}

export interface HudSurfaceResolution {
  bounds: HudBounds;
  target: string;
  fellBack: boolean;
  usedSavedBounds: boolean;
}

export function enumerateHudDisplays(
  displays: readonly HudDisplay[],
  primaryDisplayId: number | string
): HudDisplayOption[] {
  const primaryId = String(primaryDisplayId);
  const ordered = [...displays].sort((left, right) => {
    return left.bounds.x - right.bounds.x ||
      left.bounds.y - right.bounds.y ||
      String(left.id).localeCompare(String(right.id));
  });
  const primary = ordered.find(display => String(display.id) === primaryId) ?? ordered[0];

  const options = ordered.map((display, index) => ({
    id: String(display.id),
    label: `Display ${index + 1} — ${display.bounds.width}×${display.bounds.height} — ${positionLabel(display, primary)}`,
    bounds: { ...display.bounds }
  }));

  options.push({
    id: SPAN_ALL_DISPLAYS_TARGET,
    label: "Span All Displays",
    bounds: unionDisplayBounds(ordered)
  });

  return options;
}

export function unionDisplayBounds(displays: readonly HudDisplay[]): HudBounds {
  if (!displays.length) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const minX = Math.min(...displays.map(display => display.bounds.x));
  const minY = Math.min(...displays.map(display => display.bounds.y));
  const maxX = Math.max(...displays.map(display => display.bounds.x + display.bounds.width));
  const maxY = Math.max(...displays.map(display => display.bounds.y + display.bounds.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

export function resolveHudSurface(
  displays: readonly HudDisplay[],
  requestedTarget: string,
  primaryDisplayId: number | string,
  savedBounds?: HudBounds
): HudSurfaceResolution {
  const primary = displays.find(display => String(display.id) === String(primaryDisplayId)) ?? displays[0];
  if (!primary) {
    return {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      target: PRIMARY_DISPLAY_TARGET,
      fellBack: true,
      usedSavedBounds: false
    };
  }

  const primarySentinel = requestedTarget === PRIMARY_DISPLAY_TARGET;
  const requested = primarySentinel || requestedTarget === SPAN_ALL_DISPLAYS_TARGET
    ? requestedTarget
    : displays.some(display => String(display.id) === requestedTarget)
      ? requestedTarget
      : String(primary.id);
  const effectiveTarget = primarySentinel ? String(primary.id) : requested;
  const surface = effectiveTarget === SPAN_ALL_DISPLAYS_TARGET
    ? unionDisplayBounds(displays)
    : { ...(displays.find(display => String(display.id) === effectiveTarget) ?? primary).bounds };
  const usableSavedBounds = effectiveTarget !== SPAN_ALL_DISPLAYS_TARGET &&
    isUsableBounds(savedBounds) &&
    isWithinSurface(savedBounds, surface)
      ? { ...savedBounds }
      : effectiveTarget === SPAN_ALL_DISPLAYS_TARGET &&
        isUsableBounds(savedBounds) &&
        isWithinSurface(savedBounds, surface)
        ? { ...savedBounds }
        : undefined;

  return {
    bounds: usableSavedBounds ?? surface,
    target: effectiveTarget,
    fellBack: !primarySentinel && requestedTarget !== effectiveTarget,
    usedSavedBounds: Boolean(usableSavedBounds)
  };
}

function positionLabel(display: HudDisplay, primary: HudDisplay | undefined): string {
  if (!primary) return "Center";
  if (display.bounds.x < primary.bounds.x) return "Left";
  if (display.bounds.x > primary.bounds.x) return "Right";
  if (display.bounds.y < primary.bounds.y) return "Above";
  if (display.bounds.y > primary.bounds.y) return "Below";
  return "Center";
}

function isUsableBounds(bounds: HudBounds | undefined): bounds is HudBounds {
  return Boolean(
    bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width >= 640 &&
    bounds.height >= 360
  );
}

function isWithinSurface(bounds: HudBounds, surface: HudBounds): boolean {
  return bounds.x >= surface.x &&
    bounds.y >= surface.y &&
    bounds.x + bounds.width <= surface.x + surface.width &&
    bounds.y + bounds.height <= surface.y + surface.height;
}
