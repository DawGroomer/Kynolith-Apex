import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startCoachServer } from "./server.js";

const requiredModelFiles = [
  "onnx-community/whisper-tiny.en/config.json",
  "onnx-community/whisper-tiny.en/onnx/encoder_model_quantized.onnx",
  "onnx-community/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx",
  "onnx-community/Qwen3-0.6B-ONNX/config.json",
  "onnx-community/Qwen3-0.6B-ONNX/onnx/model_q4.onnx",
  "onnx-community/Kokoro-82M-v1.0-ONNX/config.json",
  "onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx",
  "onnx-community/Kokoro-82M-v1.0-ONNX/voices/af_heart.bin"
] as const;

const corruptedModelFile =
  "onnx-community/Qwen3-0.6B-ONNX/onnx/model_q4.onnx";
const approvedModelBytes =
  Buffer.from("approved-model-bytes", "utf8");
const approvedManifestHash =
  createHash("sha256")
    .update(approvedModelBytes)
    .digest("hex");

function sha256(value: Buffer): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

async function writeCompleteBundle(
  root: string,
  corrupt = false
): Promise<void> {
  for (const relative of requiredModelFiles) {
    const file = path.join(
      root,
      ...relative.split("/")
    );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      relative === corruptedModelFile && corrupt
        ? Buffer.from("corrupted-model-bytes", "utf8")
        : relative === corruptedModelFile
          ? approvedModelBytes
          : Buffer.from(`approved:${relative}`, "utf8")
    );
  }
}

test(
  "packaged startup rejects a present bundled model with a mismatched manifest hash",
  async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "apex-model-integrity-red-")
    );
    const bundle = path.join(root, "models");
    const dataDir = path.join(root, "data");

    await writeCompleteBundle(bundle, true);

    const corruptedBytes = await readFile(
      path.join(bundle, ...corruptedModelFile.split("/"))
    );
    assert.notEqual(
      sha256(corruptedBytes),
      approvedManifestHash,
      "fixture must represent a corrupted approved model asset"
    );

    let running:
      Awaited<ReturnType<typeof startCoachServer>> | undefined;

    try {
      await assert.rejects(
        async () => {
          running = await startCoachServer({
            port: 0,
            publicDir: path.resolve("public"),
            dataDir,
            bundledModelsDir: bundle,
            allowModelDownloads: false,
            prewarmVoices: false
          });
        },
        /integrity|hash|corrupt|model bundle/i
      );
    }
    finally {
      await running?.close().catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "packaged Electron startup explicitly disables managed model downloads",
  async () => {
    const source = await readFile(
      path.resolve("electron", "main.cjs"),
      "utf8"
    );

    assert.match(
      source,
      /bundledModelsDir:\s*app\.isPackaged[\s\S]{0,500}?allowModelDownloads:\s*false/
    );
  }
);
