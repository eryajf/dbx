import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const script = fileURLToPath(new URL("./set-release-version.mjs", import.meta.url));

async function run(tag, root) {
  const child = spawn(process.execPath, [script, tag, root], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  return { code, stderr };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dbx-release-version-"));
  await mkdir(join(root, "src-tauri"), { recursive: true });
  await mkdir(join(root, "crates/dbx-web"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "dbx", version: "0.6.59" }) + "\n");
  await writeFile(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "0.6.59" }) + "\n");
  await writeFile(join(root, "src-tauri/Cargo.toml"), 'version = "0.6.59"\n');
  await writeFile(join(root, "crates/dbx-web/Cargo.toml"), 'version = "0.6.59"\n');
  await writeFile(
    join(root, "Cargo.lock"),
    '[[package]]\nname = "dbx"\nversion = "0.6.59"\n\n[[package]]\nname = "dbx-web"\nversion = "0.6.59"\n',
  );
  return root;
}

test("sets the complete beta version across build metadata", async () => {
  const root = await fixture();
  const result = await run("v0.6.60-beta.20261029.1", root);
  assert.equal(result.code, 0, result.stderr);
  for (const relativePath of ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "crates/dbx-web/Cargo.toml", "Cargo.lock"]) {
    assert.match(await readFile(join(root, relativePath), "utf8"), /0\.6\.60-beta\.20261029\.1/);
  }
});

test("sets the base version for a stable build", async () => {
  const root = await fixture();
  const result = await run("v0.6.60", root);
  assert.equal(result.code, 0, result.stderr);
  assert.match(await readFile(join(root, "src-tauri/Cargo.toml"), "utf8"), /version = "0\.6\.60"/);
});
