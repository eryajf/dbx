import assert from "node:assert/strict";
import { test } from "vitest";
import { classifyRedisCommand, evaluateRedisCommandSafety, firstRedisCommandToken, parseRedisCommandArgv } from "../src/redis-command.js";

test("firstRedisCommandToken normalizes the command name", () => {
  assert.equal(firstRedisCommandToken("  get session:1"), "GET");
});

test("parseRedisCommandArgv handles quoted values and escapes", () => {
  assert.deepEqual(parseRedisCommandArgv('SET session:1 "hello world"'), ["SET", "session:1", "hello world"]);
  assert.deepEqual(parseRedisCommandArgv("SET key line\\nnext;"), ["SET", "key", "line\nnext"]);
  assert.throws(() => parseRedisCommandArgv('GET "unterminated'), /unterminated quote/);
});

test("classifyRedisCommand mirrors DBX redis command safety classes", () => {
  assert.equal(classifyRedisCommand("GET session:1"), "allowed");
  assert.equal(classifyRedisCommand("JSON.GET session:1 $"), "allowed");
  assert.equal(classifyRedisCommand("SET session:1 value"), "write");
  assert.equal(classifyRedisCommand("JSON.SET session:1 $ {}"), "write");
  assert.equal(classifyRedisCommand("GETEX session:1 EX 30"), "write");
  assert.equal(classifyRedisCommand("XREADGROUP GROUP workers agent STREAMS jobs >"), "write");
  assert.equal(classifyRedisCommand("DEL session:1"), "confirm");
  assert.equal(classifyRedisCommand("FLUSHDB"), "blocked");
  assert.equal(classifyRedisCommand("KEYS *"), "blocked");
  assert.equal(classifyRedisCommand("FCALL mutate 0"), "blocked");
  assert.equal(classifyRedisCommand("XGROUP CREATE jobs workers $"), "blocked");
  assert.equal(classifyRedisCommand("VENDOR.WRITE key value"), "blocked");
  assert.equal(classifyRedisCommand('GET "unterminated'), "blocked");
});

test("evaluateRedisCommandSafety blocks write commands when writes are disabled", () => {
  const decision = evaluateRedisCommandSafety("SET session:1 value", { allowWrites: false });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /read-only/i);
});

test("evaluateRedisCommandSafety requires high-risk mode for blocked commands", () => {
  const blocked = evaluateRedisCommandSafety("KEYS *", { allowWrites: true, allowDangerous: false });
  const allowed = evaluateRedisCommandSafety("KEYS *", { allowWrites: true, allowDangerous: true });

  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason ?? "", /high-risk/i);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.skipSafetyCheck, true);
});

test("evaluateRedisCommandSafety allows explicit-key destructive commands in safe-write mode", () => {
  const allowed = evaluateRedisCommandSafety("DEL session:1", { allowWrites: true, allowDangerous: false });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.skipSafetyCheck, false);
});

test("evaluateRedisCommandSafety fails closed for unknown commands", () => {
  const safeWrite = evaluateRedisCommandSafety("VENDOR.WRITE key value", {
    allowWrites: true,
    allowDangerous: false,
  });
  const readOnly = evaluateRedisCommandSafety("VENDOR.WRITE key value", {
    allowWrites: false,
    allowDangerous: false,
  });

  assert.equal(safeWrite.allowed, false);
  assert.match(safeWrite.reason ?? "", /high-risk/i);
  assert.equal(readOnly.allowed, false);
  assert.match(readOnly.reason ?? "", /read-only/i);
});
