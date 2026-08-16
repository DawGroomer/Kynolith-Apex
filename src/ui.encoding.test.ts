import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("user-facing HTML contains no mojibake encoding artifacts", async () => {
  const html = await fs.readFile("public/index.html", "utf8");

  const mojibake = [
    "â€”",
    "â€“",
    "â€™",
    "â€œ",
    "â€",
    "Ã",
    "Â"
  ];

  for (const artifact of mojibake) {
    assert.equal(
      html.includes(artifact),
      false,
      `public/index.html contains mojibake: ${artifact}`
    );
  }
});
