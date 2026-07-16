import assert from "node:assert/strict";
import { test } from "vitest";
import { buildAgentDownloadCatalog, downloadLinksFor } from "./agentRegistry";

test("offline download catalog includes the JDBC plugin ZIP", () => {
  const catalog = buildAgentDownloadCatalog([]);

  assert.deepEqual(catalog.jdbcPlugin, {
    label: "DBX JDBC Plugin",
    filename: "dbx-jdbc-plugin-latest.zip",
    url: "https://dl.dbxio.com/releases/latest/dbx-jdbc-plugin-latest.zip",
  });
});

test("release assets expose GitHub, CNB, and AtomGit download links", () => {
  assert.deepEqual(downloadLinksFor("https://github.com/t8y2/dbx/releases/download/agents-latest/dbx-agents-offline-macos-aarch64.zip"), [
    { source: "github", url: "https://github.com/t8y2/dbx/releases/download/agents-latest/dbx-agents-offline-macos-aarch64.zip" },
    { source: "cnb", url: "https://cnb.cool/dbxio.com/dbx/-/releases/download/agents-latest/dbx-agents-offline-macos-aarch64.zip" },
    { source: "atomgit", url: "https://atomgit.com/t8y2/dbx/releases/download/agents-latest/dbx-agents-offline-macos-aarch64.zip" },
  ]);
});

test("non-release assets retain their official download link", () => {
  assert.deepEqual(downloadLinksFor("https://dl.dbxio.com/releases/latest/dbx-jdbc-plugin-latest.zip"), [
    { source: "official", url: "https://dl.dbxio.com/releases/latest/dbx-jdbc-plugin-latest.zip" },
  ]);
});
