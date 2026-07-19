import type { SqlSafetyOptions } from "./sql-safety.js";

export type RedisCommandSafety = "allowed" | "write" | "confirm" | "blocked";

export interface RedisCommandResult {
  command: string;
  safety: RedisCommandSafety;
  value: unknown;
}

export interface RedisCommandOptions {
  skipSafetyCheck?: boolean;
  timeoutMs?: number;
  /** Marks an MCP-originated request so remote backends can recheck DBX policy. */
  mcpRequest?: boolean;
}

export interface RedisCommandSafetyDecision {
  allowed: boolean;
  command?: string;
  safety?: RedisCommandSafety;
  reason?: string;
  skipSafetyCheck?: boolean;
}

// Read access is an explicit allowlist. Redis commands added by a newer server,
// module, or proxy must be reviewed before MCP can execute them without the
// high-risk permission.
const READ_ONLY_REDIS_COMMANDS = new Set([
  "BITCOUNT",
  "BITFIELD_RO",
  "BITPOS",
  "COMMAND",
  "DBSIZE",
  "DUMP",
  "ECHO",
  "EXISTS",
  "EXPIRETIME",
  "GEODIST",
  "GEOHASH",
  "GEOPOS",
  "GEORADIUS_RO",
  "GEORADIUSBYMEMBER_RO",
  "GEOSEARCH",
  "GET",
  "GETBIT",
  "GETRANGE",
  "HEXISTS",
  "HGET",
  "HGETALL",
  "HKEYS",
  "HLEN",
  "HMGET",
  "HRANDFIELD",
  "HSCAN",
  "HSTRLEN",
  "HVALS",
  "INFO",
  "LASTSAVE",
  "LCS",
  "LINDEX",
  "LLEN",
  "LPOS",
  "LRANGE",
  "MGET",
  "OBJECT",
  "PEXPIRETIME",
  "PFCOUNT",
  "PING",
  "PTTL",
  "PUBSUB",
  "RANDOMKEY",
  "ROLE",
  "SCAN",
  "SCARD",
  "SDIFF",
  "SINTER",
  "SINTERCARD",
  "SISMEMBER",
  "SMEMBERS",
  "SMISMEMBER",
  "SORT_RO",
  "SRANDMEMBER",
  "SSCAN",
  "STRLEN",
  "SUNION",
  "TIME",
  "TTL",
  "TYPE",
  "WAIT",
  "WAITAOF",
  "XINFO",
  "XLEN",
  "XPENDING",
  "XRANGE",
  "XREAD",
  "XREVRANGE",
  "ZCARD",
  "ZCOUNT",
  "ZDIFF",
  "ZINTER",
  "ZINTERCARD",
  "ZLEXCOUNT",
  "ZMSCORE",
  "ZRANDMEMBER",
  "ZRANGE",
  "ZRANGEBYLEX",
  "ZRANGEBYSCORE",
  "ZRANK",
  "ZREVRANGE",
  "ZREVRANGEBYLEX",
  "ZREVRANGEBYSCORE",
  "ZREVRANK",
  "ZSCAN",
  "ZSCORE",
  "ZUNION",
  // Common read-only module commands.
  "BF.CARD",
  "BF.EXISTS",
  "BF.INFO",
  "BF.MEXISTS",
  "CF.COUNT",
  "CF.EXISTS",
  "CF.INFO",
  "CF.MEXISTS",
  "CMS.INFO",
  "CMS.QUERY",
  "FT._LIST",
  "FT.AGGREGATE",
  "FT.DICTDUMP",
  "FT.EXPLAIN",
  "FT.EXPLAINCLI",
  "FT.INFO",
  "FT.PROFILE",
  "FT.SEARCH",
  "FT.SPELLCHECK",
  "FT.SYNDUMP",
  "FT.TAGVALS",
  "GRAPH.RO_QUERY",
  "JSON.ARRINDEX",
  "JSON.ARRLEN",
  "JSON.GET",
  "JSON.MGET",
  "JSON.OBJKEYS",
  "JSON.OBJLEN",
  "JSON.RESP",
  "JSON.STRLEN",
  "JSON.TYPE",
  "TDIGEST.BYRANK",
  "TDIGEST.BYREVRANK",
  "TDIGEST.CDF",
  "TDIGEST.INFO",
  "TDIGEST.MAX",
  "TDIGEST.MIN",
  "TDIGEST.QUANTILE",
  "TDIGEST.RANK",
  "TDIGEST.REVRANK",
  "TDIGEST.TRIMMED_MEAN",
  "TOPK.INFO",
  "TOPK.LIST",
  "TOPK.QUERY",
  "TS.GET",
  "TS.INFO",
  "TS.MGET",
  "TS.MRANGE",
  "TS.QUERYINDEX",
  "TS.RANGE",
]);

const CONFIRM_REDIS_COMMANDS = new Set([
  "DEL",
  "UNLINK",
  "EXPIRE",
  "EXPIREAT",
  "PEXPIRE",
  "PEXPIREAT",
  "RENAME",
  "RENAMENX",
  "GETDEL",
  "HDEL",
  "JSON.ARRPOP",
  "JSON.ARRTRIM",
  "JSON.CLEAR",
  "JSON.DEL",
  "JSON.FORGET",
  "BLMOVE",
  "BLMPOP",
  "BLPOP",
  "BRPOP",
  "BRPOPLPUSH",
  "LPOP",
  "LMOVE",
  "LMPOP",
  "RPOP",
  "RPOPLPUSH",
  "LREM",
  "LTRIM",
  "SPOP",
  "SREM",
  "ZREM",
  "ZPOPMAX",
  "ZPOPMIN",
  "ZMPOP",
  "BZMPOP",
  "BZPOPMAX",
  "BZPOPMIN",
  "ZREMRANGEBYLEX",
  "ZREMRANGEBYRANK",
  "ZREMRANGEBYSCORE",
  "XDEL",
  "XTRIM",
  "MOVE",
  "SORT",
  "SDIFFSTORE",
  "SINTERSTORE",
  "SUNIONSTORE",
  "ZDIFFSTORE",
  "ZINTERSTORE",
  "ZRANGESTORE",
  "ZUNIONSTORE",
  "PFMERGE",
  "GEOSEARCHSTORE",
]);

const WRITE_REDIS_COMMANDS = new Set([
  "APPEND",
  "BITFIELD",
  "BITOP",
  "COPY",
  "DECR",
  "DECRBY",
  "GEOADD",
  "GEORADIUS",
  "GEORADIUSBYMEMBER",
  "GETEX",
  "GETSET",
  "INCR",
  "INCRBY",
  "INCRBYFLOAT",
  "SET",
  "SETEX",
  "PSETEX",
  "SETNX",
  "SETRANGE",
  "MSET",
  "MSETNX",
  "PERSIST",
  "HSET",
  "HMSET",
  "HINCRBY",
  "HINCRBYFLOAT",
  "HSETNX",
  "JSON.ARRAPPEND",
  "JSON.ARRINSERT",
  "JSON.MERGE",
  "JSON.MSET",
  "JSON.NUMINCRBY",
  "JSON.NUMMULTBY",
  "JSON.SET",
  "JSON.STRAPPEND",
  "JSON.TOGGLE",
  "LINSERT",
  "LSET",
  "LPUSH",
  "LPUSHX",
  "PFADD",
  "RPUSH",
  "RPUSHX",
  "RESTORE",
  "SADD",
  "ZADD",
  "ZINCRBY",
  "SETBIT",
  "SPUBLISH",
  "PUBLISH",
  "TOUCH",
  "XADD",
  "XACK",
  "XAUTOCLAIM",
  "XCLAIM",
  "XREADGROUP",
  "XSETID",
]);

export function firstRedisCommandToken(commandText: string): string | undefined {
  try {
    return parseRedisCommandArgv(commandText)[0]?.toUpperCase();
  } catch {
    return undefined;
  }
}

export function classifyRedisCommand(commandText: string): RedisCommandSafety {
  const command = firstRedisCommandToken(commandText);
  if (!command) return "blocked";
  if (READ_ONLY_REDIS_COMMANDS.has(command)) return "allowed";
  if (CONFIRM_REDIS_COMMANDS.has(command)) return "confirm";
  if (WRITE_REDIS_COMMANDS.has(command)) return "write";
  return "blocked";
}

export function evaluateRedisCommandSafety(commandText: string, options: SqlSafetyOptions = {}): RedisCommandSafetyDecision {
  const command = firstRedisCommandToken(commandText);
  if (!command) {
    return { allowed: false, reason: "Redis command is empty." };
  }

  const safety = classifyRedisCommand(command);
  if (safety !== "allowed" && !options.allowWrites) {
    return {
      allowed: false,
      command,
      safety,
      reason: "MCP Redis command execution is read-only under the current DBX policy.",
    };
  }

  if (safety === "blocked" && !options.allowDangerous) {
    return {
      allowed: false,
      command,
      safety,
      reason: `High-risk Redis command "${command}" is blocked by DBX MCP settings.`,
    };
  }

  return {
    allowed: true,
    command,
    safety,
    skipSafetyCheck: safety === "blocked" && options.allowDangerous === true,
  };
}

export function parseRedisCommandArgv(commandText: string): string[] {
  const trimmed = commandText.trimEnd().replace(/;+$/, "");
  const argv: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const ch of trimmed) {
    if (escaping) {
      if (ch === "n") current += "\n";
      else if (ch === "r") current += "\r";
      else if (ch === "t") current += "\t";
      else current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        argv.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (escaping) current += "\\";
  if (quote) throw new Error("Redis command has an unterminated quote");
  if (current) argv.push(current);
  if (argv.length === 0) throw new Error("Redis command is empty");
  return argv;
}
