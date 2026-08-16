import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("importing server.ts does not start a process-lifetime server", async () => {
  const script = `
    delete process.env.KYNOLITH_DESKTOP;
    await import("./src/server.ts");
    console.log("IMPORT_OK");
  `;

  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: "0"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", chunk => {
      stdout += chunk;
    });

    child.stderr.on("data", chunk => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 3000);

    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });

  assert.equal(
    result.timedOut,
    false,
    `Import kept the child process alive.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );

  assert.equal(
    result.code,
    0,
    `Import process exited unsuccessfully.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );

  assert.match(result.stdout, /IMPORT_OK/);
});
