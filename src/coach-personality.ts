export function applyTemper(message: string, level: number, seed: string, positive = false): string {
  if (level <= 0) return message;
  if (positive) {
    if (level === 4) return `Hell yeah! ${message}`;
    return level >= 2 ? `That's more like it. ${message}` : message;
  }
  const choices = level === 1 ? ["Come on, ", "Let's sharpen it up—"]
    : level === 2 ? ["Damn it, ", "Come on, wake it up—"]
      : level === 3 ? ["For fuck's sake, ", "Damn it, ", "Stop throwing the damn corner away—", "Wake up and drive the thing—"]
        : ["Hot damn, ", "Come on, hoss—", "Yeehaw, now quit foolin' around—", "Lord have mercy, "];
  return `${choose(choices, seed)}${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

export function applyRowdyCorner(message: string, positive: boolean, seed: string): string {
  if (positive) return choose(["Hell yeah! Clean corner.", "Hot damn! Nailed it.", "That's racin'! Good corner."], seed);
  const lower = message.toLowerCase();
  if (lower.includes("coast")) return choose(["Quit coasting, partner.", "Trail that brake, cowboy."], seed);
  if (lower.includes("brake") || lower.includes("release")) return choose(["Easy, hoss. Smooth release.", "Settle down—smooth that brake."], seed);
  if (lower.includes("throttle") || lower.includes("power")) return choose(["Easy, cowboy. One throttle squeeze.", "Wait, then mash it clean."], seed);
  return choose(["Come on, hoss. Hit your marks.", "Easy now. Clean it up."], seed);
}

function choose<T>(values: T[], seed: string): T { return values[hash(seed) % values.length] as T; }
function hash(value: string): number { let result = 0; for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0; return result; }
