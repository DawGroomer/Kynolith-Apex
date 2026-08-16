import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("disabled update checks never perform an outbound request", async () => {
  const { checkForUpdate } = require("../electron/update-check.cjs");

  let requests = 0;

  const result = await checkForUpdate({
    enabled: false,
    currentVersion: "0.3.1",
    fetchImpl: async () => {
      requests++;
      throw new Error("fetch must not be called");
    }
  });

  assert.equal(requests, 0);
  assert.deepEqual(result, {
    status: "disabled"
  });
});

test("newer stable GitHub release is reported as available", async () => {
  const { checkForUpdate } = require("../electron/update-check.cjs");

  const result = await checkForUpdate({
    enabled: true,
    currentVersion: "0.3.1",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          tag_name: "v0.4.0",
          prerelease: false,
          html_url: "https://github.com/DawGroomer/Kynolith-Apex/releases/tag/v0.4.0"
        };
      }
    })
  });

  assert.deepEqual(result, {
    status: "available",
    version: "0.4.0",
    url: "https://github.com/DawGroomer/Kynolith-Apex/releases/tag/v0.4.0"
  });
});

test("prerelease versions are ignored", async () => {
  const { checkForUpdate } = require("../electron/update-check.cjs");

  const result = await checkForUpdate({
    enabled: true,
    currentVersion: "0.3.1",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          tag_name: "v0.4.0-beta.1",
          prerelease: true,
          html_url: "https://example.invalid/prerelease"
        };
      }
    })
  });

  assert.deepEqual(result, {
    status: "current"
  });
});

test("same or older releases are ignored", async () => {
  const { checkForUpdate } = require("../electron/update-check.cjs");

  for (const tag of ["v0.3.1", "v0.3.0", "0.2.9"]) {
    const result = await checkForUpdate({
      enabled: true,
      currentVersion: "0.3.1",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            tag_name: tag,
            prerelease: false,
            html_url: "https://example.invalid/release"
          };
        }
      })
    });

    assert.deepEqual(result, {
      status: "current"
    });
  }
});
