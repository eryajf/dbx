# DBX MCP Server

MCP server for [DBX](https://github.com/t8y2/dbx) — lets AI agents (Claude Code, Cursor, etc.) query your databases using connections already configured in DBX.

[中文](#中文说明) | English

## Features

- **Zero config** — Automatically reads your DBX connections (including passwords from system keyring)
- **Up to 10 tools** — List/add/remove connections, inspect schemas, execute SQL or Redis commands, and use desktop UI integration
- **Connection pooling** — Reuses database connections across queries
- **Direct execution** — PostgreSQL, MySQL, SQLite, and compatible databases (Doris, StarRocks, etc.) can run without opening DBX
- **Data read/write by default** — regular `INSERT` and effectively scoped `UPDATE`/`DELETE` statements work out of the box, while broad or destructive operations require Full access
- **DBX UI integration** — Open tables directly in the DBX desktop app from your AI agent

## Quick Start

### 1. Install

```bash
npm install -g @dbx-app/mcp-server
```

Or run directly:

```bash
npx @dbx-app/mcp-server
```

### 2. Configure Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "dbx": {
      "command": "dbx-mcp-server"
    }
  }
}
```

For Windows portable builds, set `DBX_DATA_DIR` to the portable data directory that contains `dbx.db`:

```json
{
  "mcpServers": {
    "dbx": {
      "command": "dbx-mcp-server",
      "env": {
        "DBX_DATA_DIR": "D:\\DBX_x64-portable\\data"
      }
    }
  }
}
```

Or for development (from source):

```json
{
  "mcpServers": {
    "dbx": {
      "command": "npx",
      "args": ["tsx", "packages/mcp-server/src/index.ts"],
      "cwd": "/path/to/dbx"
    }
  }
}
```

### 3. Use

In Claude Code, just ask:

- "List my database connections"
- "Show the tables in my local-pg connection"
- "Describe the users table"
- "Query the average salary from employees"
- "Open the orders table in DBX"

## CLI

For terminal, script, and Codex workflows, install the dedicated CLI package:

```bash
npm install -g @dbx-app/cli
dbx connections list --json
dbx query local "select 1" --json
```

See the [DBX CLI README](../cli/README.md) for command details.

## Tools

| Tool                        | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `dbx_list_connections`      | List connections available to the current MCP session |
| `dbx_add_connection`        | Add a new database connection                        |
| `dbx_remove_connection`     | Remove a database connection                         |
| `dbx_list_tables`           | List tables and views for a connection               |
| `dbx_describe_table`        | Get column definitions for a table                   |
| `dbx_get_schema_context`    | Get compact table and column context for writing SQL |
| `dbx_execute_query`         | Execute a SQL query (max 100 rows)                   |
| `dbx_execute_redis_command` | Execute a Redis command on a Redis connection        |
| `dbx_open_table`            | Open a table in DBX desktop app UI                   |
| `dbx_execute_and_show`      | Execute SQL and show the result in DBX desktop       |

## SQL Safety

`dbx_execute_query` accepts multiple SQL statements and executes them one at a time after checking each statement. Choose one of three permission modes in **Settings → MCP**:

| Permission mode | Internal mode value | Allowed operations |
| --- | --- | --- |
| Read only | `read_only` | Allows only requests DBX classifies as reads; recognized writes and MCP connection changes are blocked |
| Data read/write | `safe_write` | Regular `INSERT`, `UPDATE`/`DELETE` with an effective filter, MongoDB updates/deletes with a verifiably effective filter, and ordinary Redis writes or deletion of explicit keys |
| Full access | `high_risk_write` | Also permits table-wide `UPDATE`/`DELETE`, DDL, `TRUNCATE`, MongoDB clearing/schema changes, Redis `FLUSH*`, and equivalent destructive operations |

A syntactic `WHERE` is not sufficient by itself: missing or ineffective filters such as `WHERE TRUE` and `WHERE 1 = 1` remain high risk. SQL that cannot be classified safely is blocked unless the required high-risk permission is present. Redis connections use `dbx_execute_redis_command` instead of `dbx_execute_query`, but follow the same DBX-managed levels.

Classification fails closed for opaque operations. Complementary null predicates, predicates made only from constants/functions, opaque MongoDB filters such as `$where`/`$expr`/`$nor`, and unknown Redis commands cannot bypass the selected DBX permission level.

DBX MCP permission enforcement is an application-layer statement-shape guard, not a substitute for database authorization. This limitation also applies to read-only mode: static classification cannot identify every side effect hidden in a user-defined or volatile function such as `SELECT app_mutate_users()`. It also cannot prevent an agent from enumerating keys first and then issuing many individually scoped changes. Use a read-only or least-privileged database account as the final enforcement boundary. `dbx_execute_and_show` is available only for SQL connections.

### DBX-managed MCP policy

DBX stores one authoritative MCP policy in **Settings → MCP**:

- **Allowed connections** controls which stable connection IDs are visible and resolvable.
- **Permission mode** selects **Read only**, **Data read/write**, or **Full access** for every MCP client.

The DBX policy is reloaded for each MCP request and is authoritative. A connection's general **Read Only** option and DBX production protection remain upper bounds even when high-risk operations are enabled. Normal client configs do not need permission or connection-scope environment variables. DBX-generated configs contain only the runtime settings required to start the server and connect it to the current DBX instance; Web mode includes `DBX_WEB_URL` and a `DBX_WEB_PASSWORD` placeholder.

Updated servers ignore `DBX_MCP_ALLOW_WRITES` and `DBX_MCP_ALLOW_DANGEROUS_SQL`. The old `DBX_MCP_SCOPE_CONNECTION_ID`, `DBX_MCP_SCOPE_CONNECTION_IDS`, and `DBX_MCP_SCOPE_CONNECTION_NAME` variables are read only for backward compatibility and can only narrow the DBX allowlist. DBX no longer generates or recommends them, so they can be removed from client configs after upgrading. Operational settings such as `DBX_DATA_DIR`, `DBX_WEB_URL`, `DBX_WEB_PASSWORD`, and diagnostic flags remain available where their documented deployment mode requires them.

## SQL Diagnostics Privacy

SQL statements are not included in normal MCP errors and are not logged by default. To enable temporary diagnostics, set `DBX_MCP_DEBUG_SQL=1` (or `DBX_SQL_DEBUG=1`). Diagnostic statements redact quoted literals and common secret assignments, and are truncated to 512 characters. Do not enable this setting unless the resulting diagnostic metadata is appropriate for the environment.

## How It Works

```
AI Agent → MCP Server → Database
                ↓
         DBX SQLite database (dbx.db)
```

The MCP server reads your database connections from DBX's SQLite database:

- **macOS**: `~/Library/Application Support/com.dbx.app/dbx.db`
- **Linux**: `~/.local/share/com.dbx.app/dbx.db`
- **Windows**: `%APPDATA%\com.dbx.app\dbx.db`

Windows portable builds store data next to `DBX.exe`, usually in `data\dbx.db`. Set `DBX_DATA_DIR` to that `data` folder instead of copying `dbx.db` into the default directory.

## DBX Web / Docker Mode

When connecting MCP to a deployed DBX Web instance, set `DBX_WEB_URL` instead of reading local desktop storage:

```json
{
  "mcpServers": {
    "dbx": {
      "command": "dbx-mcp-server",
      "env": {
        "DBX_WEB_URL": "https://dbx.example.com",
        "DBX_WEB_PASSWORD": "your-web-password"
      }
    }
  }
}
```

If the Web instance has password protection enabled, `DBX_WEB_PASSWORD` is required. Use the same password you enter on the DBX Web login page, including the password created by the first-run setup screen. You do not need to set `DBX_PASSWORD` on the DBX Web server just for MCP; `DBX_PASSWORD` is only a server-side environment override. Without `DBX_WEB_PASSWORD`, MCP calls fail before any connection data is returned. Desktop local mode does not use `DBX_WEB_PASSWORD`.

## DBX UI Integration

The `dbx_open_table` tool communicates with the running DBX app to open tables directly in the UI. This requires DBX to be running. If DBX is not running, the tool will return an error message.

PostgreSQL, MySQL, SQLite, Doris, StarRocks, and Redshift queries run directly from the MCP server. Redis standalone command execution also runs directly. Other database types, plus Redis Sentinel/Cluster or SSH-backed Redis connections, still use the DBX desktop bridge unless `DBX_WEB_URL` is configured.

## Requirements

- [DBX](https://github.com/t8y2/dbx) installed with at least one connection configured
- Node.js 22.13.0 或更高版本

## License

Apache-2.0

---

## 中文说明

[DBX](https://github.com/t8y2/dbx) 的 MCP Server，让 AI 编程助手（Claude Code、Cursor 等）直接使用 DBX 中已配置的数据库连接查询数据。

### 特性

- **零配置** — 自动读取 DBX 的连接配置
- **最多 10 个工具** — 列出/添加/删除连接、检查 Schema、执行 SQL 或 Redis 命令，以及使用桌面 UI 联动
- **连接池** — 跨查询复用数据库连接
- **直接执行** — PostgreSQL、MySQL、SQLite 及兼容数据库（Doris、StarRocks 等）无需打开 DBX 即可查询
- **默认允许数据读写** — 普通 `INSERT`、带有效过滤条件的 `UPDATE` / `DELETE` 可直接执行，大范围或破坏性操作需要完全访问权限
- **DBX UI 联动** — 从 AI 助手直接在 DBX 桌面端打开表

### 快速开始

#### 1. 安装

```bash
npm install -g @dbx-app/mcp-server
```

或直接运行：

```bash
npx @dbx-app/mcp-server
```

#### 2. 配置 Claude Code

在项目的 `.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "dbx": {
      "command": "dbx-mcp-server"
    }
  }
}
```

Windows 便携版需要在 MCP 配置中设置 `DBX_DATA_DIR`，指向包含 `dbx.db` 的便携版数据目录：

```json
{
  "mcpServers": {
    "dbx": {
      "command": "dbx-mcp-server",
      "env": {
        "DBX_DATA_DIR": "D:\\DBX_x64-portable\\data"
      }
    }
  }
}
```

#### 3. 使用

在 Claude Code 中直接说：

- "列出我的数据库连接"
- "查看 local-pg 上有哪些表"
- "查看 users 表的结构"
- "查询最近 7 天的订单数量"
- "打开 orders 表"

### CLI

终端、脚本和 Codex 工作流请安装独立 CLI 包：

```bash
npm install -g @dbx-app/cli
dbx connections list --json
dbx query local "select 1" --json
```

命令详情见 [DBX CLI README](../cli/README.md)。

### 工具列表

| 工具                        | 说明                                  |
| --------------------------- | ------------------------------------- |
| `dbx_list_connections`      | 列出当前 MCP 会话可访问的数据库连接   |
| `dbx_add_connection`        | 添加新的数据库连接                    |
| `dbx_remove_connection`     | 删除数据库连接                        |
| `dbx_list_tables`           | 列出指定连接的表和视图                |
| `dbx_describe_table`        | 获取表的列定义                        |
| `dbx_get_schema_context`    | 获取适合 AI 写 SQL 的紧凑表结构上下文 |
| `dbx_execute_query`         | 执行 SQL 查询（最多返回 100 行）      |
| `dbx_execute_redis_command` | 在 Redis 连接上执行 Redis 命令        |
| `dbx_open_table`            | 在 DBX 桌面端打开指定表               |
| `dbx_execute_and_show`      | 执行 SQL 并在 DBX 桌面端展示结果      |

### SQL 安全

`dbx_execute_query` 支持多条 SQL 语句，会逐条完成安全检查并依次执行。请在 **设置 → MCP** 中选择一个权限模式：

| 权限模式 | 内部模式值 | 允许的操作 |
| --- | --- | --- |
| 只读 | `read_only` | 仅允许 DBX 判定为读取的请求；禁止已识别的写入和 MCP 连接管理变更 |
| 数据读写 | `safe_write` | 允许普通 `INSERT`、带有效过滤条件的 `UPDATE`/`DELETE`、MongoDB 带可验证有效过滤条件的更新/删除，以及 Redis 普通写入和明确键删除 |
| 完全访问 | `high_risk_write` | 额外允许全表 `UPDATE`/`DELETE`、DDL、`TRUNCATE`、MongoDB 清空/结构变更、Redis `FLUSH*` 及等价破坏性操作 |

仅仅出现 `WHERE` 并不等于安全；缺少有效过滤条件以及 `WHERE TRUE`、`WHERE 1 = 1` 等无效条件仍属于高风险。无法可靠分类的 SQL 会按所需高风险权限失败关闭。Redis 连接使用 `dbx_execute_redis_command`，不通过 `dbx_execute_query` 执行，但遵循相同的 DBX 中央权限等级。

不透明操作统一失败关闭：互补空值条件、仅由常量/函数构成的条件、MongoDB 的 `$where`/`$expr`/`$nor` 等不透明过滤器，以及未识别的 Redis 命令都不能绕过 DBX 所选权限等级。

DBX MCP 权限是应用层的语句形状保护，不能替代数据库授权；此限制同样适用于只读模式。静态分类无法识别 `SELECT app_mutate_users()` 等用户自定义函数或 volatile 函数中的所有副作用，也无法阻止 Agent 先枚举主键、再执行大量逐条变更。请使用数据库只读账号或最小权限账号作为最终硬边界。`dbx_execute_and_show` 仅支持 SQL 连接。

#### DBX 管理的 MCP 策略

DBX 在 **设置 → MCP** 中保存一份权威策略：

- **允许访问的连接** 决定哪些稳定连接 ID 可以被列出和解析。
- **权限模式** 为所有 MCP 客户端统一选择 **只读**、**数据读写** 或 **完全访问**。

DBX 会在每次 MCP 请求时重新读取这份权威策略。即使允许高风险操作，连接自身的通用“只读模式”和 DBX 生产库保护仍然是权限上限。常规客户端配置不需要声明权限或连接范围环境变量。DBX 生成的配置只包含启动 Server 并连接当前 DBX 实例所需的运行参数；Web 模式会包含 `DBX_WEB_URL` 和 `DBX_WEB_PASSWORD` 占位值。

新版 Server 会忽略 `DBX_MCP_ALLOW_WRITES` 和 `DBX_MCP_ALLOW_DANGEROUS_SQL`。旧的 `DBX_MCP_SCOPE_CONNECTION_ID`、`DBX_MCP_SCOPE_CONNECTION_IDS` 和 `DBX_MCP_SCOPE_CONNECTION_NAME` 仅为兼容已有配置而继续读取，而且只能进一步收窄 DBX allowlist。DBX 不再生成或推荐这些变量，升级后可以从客户端配置中删除。`DBX_DATA_DIR`、`DBX_WEB_URL`、`DBX_WEB_PASSWORD` 和诊断开关等运行环境变量仍按对应部署方式使用。

### 工作原理

MCP Server 从 DBX 的 SQLite 数据库读取连接信息：

- **macOS**: `~/Library/Application Support/com.dbx.app/dbx.db`
- **Linux**: `~/.local/share/com.dbx.app/dbx.db`
- **Windows**: `%APPDATA%\com.dbx.app\dbx.db`

Windows 便携版的数据通常在 `DBX.exe` 同级的 `data\dbx.db`。请把 `DBX_DATA_DIR` 设置为这个 `data` 文件夹，不要手工复制 `dbx.db` 到默认目录。

### DBX Web / Docker 模式

如果 MCP 连接的是已部署的 DBX Web 实例，请设置 `DBX_WEB_URL`，不要读取本机桌面端存储：

```json
{
  "mcpServers": {
    "dbx": {
      "command": "dbx-mcp-server",
      "env": {
        "DBX_WEB_URL": "https://dbx.example.com",
        "DBX_WEB_PASSWORD": "你的 Web 访问密码"
      }
    }
  }
}
```

当 Web 实例启用了密码保护时，必须提供 `DBX_WEB_PASSWORD`。这里填写的就是 DBX Web 登录页使用的密码，也包括首次打开 Web 页面时通过 setup 设置的密码。为了让 MCP 可用，不需要在启动 DBX Web 时额外设置 `DBX_PASSWORD`；`DBX_PASSWORD` 只是服务端环境变量覆盖。未提供 `DBX_WEB_PASSWORD` 时，MCP 调用会在返回任何连接数据前失败。桌面本地模式不使用 `DBX_WEB_PASSWORD`。

### DBX UI 联动

`dbx_open_table` 工具通过本地 HTTP 接口与运行中的 DBX 应用通信，直接在 UI 中打开表。需要 DBX 正在运行。

PostgreSQL、MySQL、SQLite、Doris、StarRocks、Redshift 查询可由 MCP Server 直接执行。Redis standalone 命令执行也会直接连接。其他数据库类型，以及 Redis Sentinel/Cluster 或 SSH Redis 连接，仍会走 DBX 桌面端 bridge，除非配置了 `DBX_WEB_URL` 使用 Web 后端。

### 系统要求

- 已安装 [DBX](https://github.com/t8y2/dbx) 并配置了至少一个数据库连接
- Node.js 22.13.0 or newer
