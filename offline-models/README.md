# Apex offline model bundle

Run `pnpm models:stage` after the local model smoke tests have populated `.model-smoke-cache`. The staging script copies only the pinned Whisper Tiny, Qwen3 0.6B, and Kokoro 82M model files required by Apex. Model weights are intentionally excluded from Git.
