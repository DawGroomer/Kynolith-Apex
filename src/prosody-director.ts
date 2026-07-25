export type SpeechRole = "coach" | "spotter";
export type SpeechEmotion = "calm" | "positive" | "urgent" | "firm";

export function directSpeech(value: string, role: SpeechRole, emotion: SpeechEmotion = "calm"): string {
  let text = value
    .replace(/â€”|—/g, ", ")
    .replace(/\bLMU\b/g, "L M U")
    .replace(/\bLMGT3\b/g, "L M G T three")
    .replace(/\bLMDh\b/gi, "L M D h")
    .replace(/\bLMH\b/g, "L M H")
    .replace(/\bABS\b/g, "A B S")
    .replace(/\bTC\b/g, "traction control")
    .replace(/\bPSI\b/g, "P S I")
    .replace(/\bMPH\b/g, "miles per hour")
    .replace(/\bP(\d+)\b/g, "position $1")
    .replace(/(-?\d+)\.(\d)\b/g, "$1 point $2")
    .replace(/\s+/g, " ").trim();
  if (role === "spotter") text = text.replace(/;|:/g, ".").replace(/,\s*/g, ". ");
  if (emotion === "urgent") text = text.replace(/^(Yellow flag|Local yellow|Impact|Spin|Puncture detected)\.\s*/i, "$1! ");
  if (emotion === "positive" && !/[!]$/.test(text)) text = text.replace(/[.]$/, "!");
  return text.replace(/\.{2,}/g, ".").slice(0, 600);
}

export function roleSpeed(requested: number, role: SpeechRole, emotion: SpeechEmotion): number {
  const base = Math.min(1.15, Math.max(.88, requested));
  if (role === "spotter") return Math.min(1.12, Math.max(1, base));
  if (emotion === "urgent") return Math.min(1.12, base + .04);
  return base;
}
