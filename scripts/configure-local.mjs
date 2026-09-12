import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../.env.local", import.meta.url);
const original = await readFile(path, "utf8");
if (/^DEMO_ACCESS_SECRET=\s*$/m.test(original)) {
  const updated = original.replace(/^DEMO_ACCESS_SECRET=\s*$/m, `DEMO_ACCESS_SECRET=${randomBytes(32).toString("base64url")}`);
  assert.notEqual(updated, original);
  await writeFile(path, updated);
  console.log("Generated the local demo access key.");
} else {
  console.log("The local demo access key is already configured.");
}
