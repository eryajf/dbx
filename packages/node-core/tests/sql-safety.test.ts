import assert from "node:assert/strict";
import { test } from "vitest";
import { evaluateSqlSafety, splitSqlStatements, sqlSafetyFromEnv } from "../src/sql-safety.js";
import { classifySqlStatementRisk, supportsHashLineComments } from "../src/sql-risk.js";

test("allows read-only SQL by default", () => {
  const decision = evaluateSqlSafety("select * from users limit 5");

  assert.equal(decision.allowed, true);
});

test("allows read-only EXPLAIN without ANALYZE", () => {
  const decision = evaluateSqlSafety("EXPLAIN SELECT * FROM users");

  assert.equal(decision.allowed, true);
});

test("always blocks persistent database switching in MCP SQL", () => {
  for (const sql of ["USE reporting", "-- select target\nUSE reporting", "/*!50000 USE reporting */"]) {
    for (const options of [
      { allowWrites: false, allowDangerous: false },
      { allowWrites: true, allowDangerous: true },
    ]) {
      const decision = evaluateSqlSafety(sql, options);
      assert.equal(decision.allowed, false, sql);
      assert.match(decision.reason ?? "", /persistent database switching/i, sql);
    }
  }
});

test("allows INSERT as an ordinary write when scoped", () => {
  const decision = evaluateSqlSafety("insert into users (id, role) values (1, 'admin')", sqlSafetyFromEnv({}));

  assert.equal(decision.allowed, true);
});

test("safe-write mode allows single-table UPDATE and DELETE with effective predicates", () => {
  for (const sql of [
    "update users set role = 'admin' where id = 1",
    "update users set role = 'admin' where status = 'pending' and tenant_id = 2",
    "delete from users where id in (1, 2)",
    "delete from users where id = 1 or id = 2",
    "delete from users where id in (1) or id in (2)",
    "delete from users where id between 1 and 2 or id between 4 and 5",
    "update users set disabled = true where name like 'admin%'",
    "update users set disabled = true where name like '_%'",
    "update users set disabled = true where abs(id) = 1",
    "delete from users where lower(email) = 'disabled@example.com'",
    "delete from users where x = 1",
    "delete from users where id is null or status is not null",
    "delete from users where (id is null or not (((id is null)))) and tenant_id = 1",
    "delete from users where (id = 1 or id <> 1) and tenant_id = 1",
    "delete from users where status = 'pending' or status <> 'disabled'",
    "delete from users where extract(year from created_at) = 2026",
  ]) {
    assert.equal(evaluateSqlSafety(sql, { allowWrites: true, allowDangerous: false }).allowed, true, sql);
  }
});

test("safe-write mode rejects unbounded and multi-table UPDATE or DELETE", () => {
  for (const sql of [
    "update users set disabled = true",
    "delete from users",
    "update users set disabled = true where true",
    "delete from users where 1 = 1",
    "delete from users where not (1 = 0)",
    "update users set disabled = true where 2 > 1",
    "update users set disabled = true where id = id",
    "update users set disabled = true where lower(email) = lower(email)",
    "delete from users where id = 1 or 1 = 1",
    "delete from users where id is null or id is not null",
    "delete from users where id is null or not (((id is null)))",
    "delete from users where id is not null or not (((id is not null)))",
    "delete from users where (id is null or status = 'disabled') or id is not null",
    "delete from users where id = 1 or id <> 1",
    "delete from users where id != 1 or 1 = id",
    "delete from users where status = 'disabled' or status != 'disabled'",
    "delete from users where (id = 1 or status = 'disabled') or 1 != id or id is null",
    "delete from users where id > 1 or id <= 1",
    "delete from users where 1 >= id or id > 1",
    "delete from users where id >= 1 or 1 > id",
    "delete from users where id in (1) or id not in (1) or id is null",
    "delete from users where id in (1, 2) or id not in (2, 1) or id is null",
    "delete from users where id between 1 and 2 or id not between 1 and 2 or id is null",
    "delete from users where id = 1 or (id <> 1 and true) or id is null",
    "delete from users where id is not distinct from id",
    "delete from users where id <=> id",
    "update users set disabled = true where name like '%' or name is null",
    "update users set disabled = true where name like '%%' or name is null",
    "update users set disabled = true where abs(1) = 1",
    "delete from users where lower('A') = 'a'",
    "delete from users where coalesce(null, 1) = 1",
    "delete from users where lower(_utf8mb4'A') = 'a'",
    "delete from users where extract(year from date '2026-01-01') = 2026",
    "delete from users where date '2026-01-01' < current_date",
    "delete from users where user = current_user",
    "delete from users where id in (select id from archived_users)",
    "delete from users where exists (select 1 from archived_users)",
    "update users join accounts on accounts.id = users.account_id set users.disabled = true where users.id = 1",
    "update users set disabled = true from accounts where users.account_id = accounts.id",
    "delete users from users join accounts on accounts.id = users.account_id where users.id = 1",
  ]) {
    const blocked = evaluateSqlSafety(sql, { allowWrites: true, allowDangerous: false });
    const allowed = evaluateSqlSafety(sql, { allowWrites: true, allowDangerous: true });

    assert.equal(blocked.allowed, false, sql);
    assert.match(blocked.reason ?? "", /high-risk/i);
    assert.equal(allowed.allowed, true, sql);
  }
});

test("requires high-risk permission for insert forms that update existing rows", () => {
  for (const sql of [
    "insert into users (id) values (1) on duplicate key update role = 'admin'",
    "insert into users (id) values (1) on conflict (id) do update set role = 'admin'",
    "insert or replace into users (id) values (1)",
    "insert overwrite users select * from staging_users",
    "insert into users (id, role) select id, role from staging_users",
    "insert into archive table users",
    "with source as (select * from users) insert into archive table source",
  ]) {
    assert.equal(evaluateSqlSafety(sql, { allowWrites: true, allowDangerous: false }).allowed, false, sql);
    assert.equal(evaluateSqlSafety(sql, { allowWrites: true, allowDangerous: true }).allowed, true, sql);
  }

  assert.equal(
    evaluateSqlSafety("insert into users (id) values (1) on conflict (id) do nothing", {
      allowWrites: true,
      allowDangerous: false,
    }).allowed,
    true,
  );
  assert.equal(
    evaluateSqlSafety("insert into users (id) values ((select max(id) + 1 from users))", {
      allowWrites: true,
      allowDangerous: false,
    }).allowed,
    true,
  );
});

test("blocks high-risk SQL even when writes are enabled", () => {
  const decision = evaluateSqlSafety("drop table users", { allowWrites: true });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /high-risk/i);
});

test("blocks update without where when high-risk writes are disabled", () => {
  const decision = evaluateSqlSafety("update users set disabled = true", { allowWrites: true });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /high-risk/i);
});

test("blocks writes that do not start with a write keyword in read-only mode", () => {
  for (const sql of ["EXPLAIN ANALYZE DELETE FROM users WHERE id = 1", "/*! DELETE FROM users WHERE id = 1 */", "COPY users FROM '/tmp/users.csv'", "COPY users TO '/tmp/users.csv'", "SELECT * INTO backup_users FROM users", "SELECT * FROM users INTO OUTFILE '/tmp/users.csv'", "SELECT setval('user_id_seq', 42)", "SELECT nextval('user_id_seq')", "SELECT pg_terminate_backend(42)", "SELECT * FROM users FOR UPDATE"]) {
    const decision = evaluateSqlSafety(sql);
    assert.equal(decision.allowed, false, sql);
    assert.match(decision.reason ?? "", /read-only|blocked/i);
  }
});

test("known side-effect SELECT and COPY forms require central high-risk permission", () => {
  for (const sql of [
    "COPY users TO STDOUT",
    "COPY (SELECT * FROM users) TO PROGRAM 'cat > /tmp/users.csv'",
    "SELECT setval('user_id_seq', 42)",
    "SELECT nextval('user_id_seq')",
    "SELECT pg_terminate_backend(42)",
    "SELECT * FROM users FOR UPDATE",
    "SELECT * FROM users FOR NO KEY UPDATE",
    "SELECT * FROM users FOR SHARE",
    "SELECT * FROM users FOR KEY SHARE",
  ]) {
    assert.equal(classifySqlStatementRisk(sql).risk, "write", sql);
    assert.equal(evaluateSqlSafety(sql, { allowWrites: true, allowDangerous: false }).allowed, false, sql);
    assert.equal(evaluateSqlSafety(sql, { allowWrites: true, allowDangerous: true }).allowed, true, sql);
  }
});

test("blocks unrecognized SQL unless high-risk writes are explicitly enabled", () => {
  const decision = evaluateSqlSafety("MAINTAIN UNKNOWN THING", { allowWrites: true });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /unrecognized/i);
});

test("blocks multiple SQL statements unless explicitly allowed", () => {
  const decision = evaluateSqlSafety("select 1; select 2");

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /Only one SQL statement/);
});

test("allows multiple read-only SQL statements when enabled", () => {
  const decision = evaluateSqlSafety("select 1; show tables", { allowMultipleStatements: true });

  assert.equal(decision.allowed, true);
});

test("checks every statement in a multi-statement SQL string", () => {
  const decision = evaluateSqlSafety("select 1; delete from users", {
    allowMultipleStatements: true,
    allowWrites: true,
  });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /Statement 2/i);
  assert.match(decision.reason ?? "", /high-risk/i);
});

test("splits statements without altering SQL literals or comments", () => {
  const sql = "SELECT 'a;b' AS value, ''abc'' AS quoted; -- keep comment\nSELECT $$c;d$$ AS dollar;";

  assert.deepEqual(splitSqlStatements(sql), ["SELECT 'a;b' AS value, ''abc'' AS quoted", "-- keep comment\nSELECT $$c;d$$ AS dollar"]);
});

test("keeps tagged dollar quotes and quoted identifiers intact", () => {
  const sql = 'SELECT $body$begin; end$body$ AS body, "semi;colon" AS "quoted;column"; SELECT 2;';

  assert.deepEqual(splitSqlStatements(sql), ['SELECT $body$begin; end$body$ AS body, "semi;colon" AS "quoted;column"', "SELECT 2"]);
});

test("sqlSafetyFromEnv allows writes by default but keeps high-risk SQL blocked", () => {
  const options = sqlSafetyFromEnv({});

  assert.equal(options.allowWrites, true);
  assert.equal(options.allowDangerous, false);
});

test("sqlSafetyFromEnv supports explicitly disabling writes", () => {
  const options = sqlSafetyFromEnv({ DBX_MCP_ALLOW_WRITES: "0" } as NodeJS.ProcessEnv);

  assert.equal(options.allowWrites, false);
  assert.equal(options.allowDangerous, false);
});

// --- Dialect-aware `#` comment handling ---

test("supportsHashLineComments matches Rust mysql-compatible dialect set", () => {
  for (const dbType of ["mysql", "doris", "starrocks", "manticoresearch", "goldendb"]) {
    assert.equal(supportsHashLineComments(dbType), true, dbType);
  }
  for (const dbType of ["postgres", "sqlite", "sqlserver", "oracle", "duckdb", "bigquery", "redshift", ""]) {
    assert.equal(supportsHashLineComments(dbType), false, dbType);
  }
  assert.equal(supportsHashLineComments(undefined), false);
});

test("splitSqlStatements splits PG `#` operator correctly (hashLineComments omitted/default)", () => {
  assert.deepEqual(splitSqlStatements("SELECT a # b; SELECT 2"), ["SELECT a # b", "SELECT 2"]);
});

test("splitSqlStatements splits PG `#` operator correctly (hashLineComments: false)", () => {
  assert.deepEqual(splitSqlStatements("SELECT a # b; SELECT 2", { hashLineComments: false }), ["SELECT a # b", "SELECT 2"]);
});

test("splitSqlStatements treats `#` as comment with hashLineComments: true (MySQL)", () => {
  // With hashLineComments: true, the `;` inside the `#` comment must NOT split.
  // The comment text is preserved in the output (splitter only delimits on `;`, it doesn't strip).
  assert.deepEqual(splitSqlStatements("SELECT 1; # trailing ; comment\nSELECT 2", { hashLineComments: true }), ["SELECT 1", "# trailing ; comment\nSELECT 2"]);
});

test("splitSqlStatements preserves JSONB operator text verbatim", () => {
  const result = splitSqlStatements("SELECT data #>> '{a,b}' FROM t");
  assert.equal(result.length, 1);
  assert.equal(result[0], "SELECT data #>> '{a,b}' FROM t");
});

test("splitSqlStatements handles `#` as operator mid-statement (PG)", () => {
  assert.deepEqual(splitSqlStatements("SELECT 1 # 2; DELETE FROM t"), ["SELECT 1 # 2", "DELETE FROM t"]);
});

test("evaluateSqlSafety blocks PG injection that bypasses # as comment (regression)", () => {
  // Before fix: # would strip "2; DELETE FROM t" as comment, classify as read-only.
  // After fix: # is treated as an operator, so DELETE FROM t is seen as a second write statement.
  const decision = evaluateSqlSafety("SELECT 1 # 2; DELETE FROM t", {
    allowWrites: false,
    allowMultipleStatements: true,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /read-only/i);
});

test("evaluateSqlSafety allows MySQL `#` comment with hashLineComments: true", () => {
  const decision = evaluateSqlSafety("SELECT 1 # delete note", {
    allowWrites: false,
    allowMultipleStatements: true,
    hashLineComments: true,
  });
  assert.equal(decision.allowed, true);
});

test("evaluateSqlSafety with hashLineComments: false still sees DELETE after `#` operator", () => {
  const decision = evaluateSqlSafety("SELECT 1 # 2; DELETE FROM t", {
    allowWrites: false,
    allowMultipleStatements: true,
    hashLineComments: false,
  });
  assert.equal(decision.allowed, false);
});
