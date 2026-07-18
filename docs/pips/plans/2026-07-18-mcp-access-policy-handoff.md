# MCP 访问策略与全局只读交接说明

## 文档状态

- 日期：2026-07-18
- 分支：`issue_3696`
- 关联 Issue：[#3696](https://github.com/t8y2/dbx/issues/3696)、[#3800](https://github.com/t8y2/dbx/issues/3800)
- 用途：记录当前实现、测试结论、最新产品决策和后续开发步骤，便于在另一台电脑继续开发。

## 最新产品决策

DBX“设置 → MCP”中的“只读模式”应当是用户启用 MCP 全局只读的主要入口。

用户不应为了让 MCP 整体只读，再逐个打开连接并配置只读。连接级 `mcp_access` 可以保留为高级、可选的纵深防护能力，用于禁用某个连接或让个别连接永久只读，但它不应成为启用全局只读的必需步骤。

期望语义：

1. 在 MCP 设置页打开“只读模式”后，所有 MCP 会话都不能通过 DBX 写入。
2. 客户端设置 `DBX_MCP_ALLOW_WRITES=1` 不能覆盖 DBX 中已经打开的全局只读。
3. 关闭全局只读后，连接级 `disabled`、`read_only` 和 DBX 通用连接只读仍然生效。
4. 客户端环境变量只能进一步收紧权限，不能放宽 DBX 管理的策略。
5. 会话连接范围继续支持多选，范围选择与读写权限彼此独立。

建议的最终权限关系：

```text
effective_write_allowed =
  client_allows_writes
  AND global_mcp_policy_allows_writes
  AND connection_mcp_policy_allows_writes
  AND connection_general_policy_allows_writes
  AND production_policy_allows_writes
```

任意一层拒绝写入，最终都必须拒绝。

## 当前实现状态

### 已实现

- `ConnectionConfig` 新增 `mcp_access`：`disabled`、`read_only`、`read_write`。
- 旧连接缺少该字段时默认按 `read_write` 处理。
- MCP Server 会隐藏 `disabled` 连接，并阻止按 ID 或名称解析。
- 连接级 MCP 只读已覆盖 SQL、MongoDB 和 Redis 的主要写入路径。
- DBX 通用连接只读比 MCP 权限更强。
- 客户端环境变量经过连接策略收紧，不能放宽连接级只读。
- 会话连接范围已改为多选：
  - 单选生成 `DBX_MCP_SCOPE_CONNECTION_ID`。
  - 多选生成逗号分隔的 `DBX_MCP_SCOPE_CONNECTION_IDS`。
  - 多连接会话不指定连接时返回 `CONNECTION_REQUIRED`。
- 多选配置增加旧版 fail-closed 哨兵：

```text
DBX_MCP_SCOPE_CONNECTION_IDS=id-1,id-2
DBX_MCP_SCOPE_CONNECTION_ID=__dbx_multi_scope_requires_updated_server__
```

新版 MCP Server 优先读取复数范围；旧版只会读取无效单选 ID，因此不会把不支持的多选配置误判为“未限制范围”。

### 当前“只读模式”的实际行为

MCP 设置页的“只读模式”目前只保存在前端 `localStorage`：

```text
dbx-mcp-config-readonly
```

打开开关后，页面只会在下方生成的客户端配置文本中附加：

```text
DBX_MCP_ALLOW_WRITES=0
```

它不会：

- 自动修改外部 AI 客户端已经保存的 MCP 配置。
- 自动重启外部 MCP Server 进程。
- 保存成 MCP Server 可以直接读取的 DBX 全局策略。
- 修改某个连接的 `mcp_access`。

这与用户对“DBX 中已经打开只读”的直觉不一致，是下一步需要解决的核心体验问题。

## 已完成的人工测试与结论

测试使用本地工作区构建产物：

```text
command = /Users/eryajf/.nvm/versions/node/v22.21.1/bin/node
args = /Users/eryajf/code/github/dbx-er/packages/mcp-server/dist/index.js
```

测试客户端环境变量为：

```text
DBX_MCP_ALLOW_WRITES=1
DBX_MCP_SCOPE_CONNECTION_ID=d2d50c5a-1cef-4cf3-80c0-70234014049d
```

目标连接 `mysql-localhost` 的 MCP 权限仍是 `read_write`。因此 MCP 成功向 `aa.field_types_test` 新增了三条数据，ID 为 7、8、9。

该结果符合当前实现，并不表示连接级只读拦截失效：

- MCP 设置页虽然打开了“只读模式”，但外部客户端仍明确传入 `DBX_MCP_ALLOW_WRITES=1`。
- 目标连接本身仍为 `mcp_access=read_write`。
- MCP Server 同时收到“客户端允许写”和“连接允许写”，所以最终允许写入。

这次测试证明了当前 UI 容易让用户误认为设置开关已经实时约束 MCP Server。

## 下一步推荐方案

### P0：增加 DBX 管理的全局 MCP 策略

将 MCP 设置页的“只读模式”从纯配置生成器选项升级为 DBX 持久化安全策略。

建议增加全局字段：

```text
mcp_read_only: boolean
```

默认值为 `false`，保持旧用户兼容。

建议存入 SQLite 的 `app_settings.settings_json`。该表同时被桌面应用和本地 MCP Server 使用，适合作为 DBX 管理策略的单一事实来源。不要继续只存 `localStorage`。

涉及位置：

- Rust 设置模型与存储：
  - `crates/dbx-core/src/storage.rs`
  - `src-tauri/src/commands/app_settings.rs`
- 前端设置模型：
  - `apps/desktop/src/stores/settingsStore.ts`
  - `apps/desktop/src/components/editor/EditorSettingsDialog.vue`
- Node 本地存储读取：
  - `packages/node-core/src/connections.ts`，或新增独立的 `mcp-settings.ts`
- MCP 策略合并：
  - `packages/node-core/src/mcp-policy.ts`
  - `packages/mcp-server/src/index.ts`

推荐让 MCP Server 在工具调用时读取最新全局策略，避免 DBX 中切换只读后必须重启 MCP 进程。如果考虑性能，可以做短时间缓存，但必须提供明确的失效机制。

### P0：统一策略合并入口

不要在 SQL、MongoDB、Redis 工具中分别拼装判断。建议扩展 `mcp-policy.ts`，统一计算：

```ts
interface McpGlobalPolicy {
  readOnly: boolean;
}

effectiveMcpSqlSafety(config, globalPolicy, env)
```

优先级建议：

1. `mcp_access=disabled`：不可见、不可访问。
2. DBX 通用连接 `read_only=true`：禁止所有写入。
3. 连接 `mcp_access=read_only`：禁止 MCP 写入。
4. 全局 `mcp_read_only=true`：禁止所有 MCP 写入。
5. 客户端 `DBX_MCP_ALLOW_WRITES=0`：收紧为只读。
6. 客户端 `DBX_MCP_ALLOW_WRITES=1`：只有以上 DBX 策略都允许时才能写。
7. 生产库保护继续作为独立的最终约束。

### P0：调整 MCP 设置页文案和状态

全局策略实现后：

- “只读模式”文案应明确表示它会约束所有 MCP 客户端，而不仅是生成示例配置。
- 生成的客户端配置仍可附加 `DBX_MCP_ALLOW_WRITES=0`，作为对旧 MCP Server 的兼容保护。
- UI 保存失败时必须回滚开关并提示错误，不能只更新本地视觉状态。
- 设置页应显示策略已保存，并说明 MCP 客户端环境变量无法覆盖该策略。

连接编辑页中的“MCP 访问权限”建议保留，但文案应明确它是“单连接高级覆盖”：

- `Disabled`：该连接完全不对 MCP 暴露。
- `Read only`：即使全局允许写，该连接仍只读。
- `Read and write`：服从全局 MCP 策略，不代表一定允许写。

### P1：覆盖 Web 模式

本地 MCP Server 可以直接读取 SQLite `app_settings`。Web 模式不能假设读取同一份本地文件，需要通过后端接口获得全局策略。

建议扩展 `Backend`：

```ts
loadMcpGlobalPolicy(): Promise<McpGlobalPolicy>
```

- Desktop backend：从 `app_settings` 读取。
- Web backend：调用 DBX Web API。
- 测试 backend：显式返回默认策略。

不能只修桌面直连路径，否则 Web MCP 仍会绕过设置页的全局只读。

### P1：修复 npm 发布链路

当前 npm 状态：

- `@dbx-app/mcp-server@0.4.31` 已发布。
- `@dbx-app/node-core@0.4.31` 已发布。
- `@dbx-app/node-core@0.4.31` 依赖 `@dbx-app/mongo-shell@^0.1.0`。
- `@dbx-app/mongo-shell@0.1.0` 未发布，并且工作区 package 标记为 `private: true`。

因此全局升级 MCP Server 会在安装依赖时遇到 404。

后续需要在以下方案中选择一种：

1. 将 `mongo-shell` 改为可发布包，并加入 Node packages release workflow；或
2. 将其构建产物打包进 `node-core`，不再作为 npm 运行时依赖。

修复前继续使用工作区本地构建产物验证。

## 本地继续开发方式

在新电脑拉取分支并安装依赖：

```bash
cd /path/to/dbx
pnpm install
pnpm --filter @dbx-app/mcp-server build
```

客户端不要指向全局 `dbx-mcp-server`，而应指向当前工作区产物：

```json
{
  "mcpServers": {
    "dbx-local": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/dbx/packages/mcp-server/dist/index.js"]
    }
  }
}
```

每次修改 `mcp-server`、`node-core` 或 `mongo-shell` 后重新构建，并重启对应 MCP 会话。

本地构建仍可能显示版本 `0.4.30`，因为 MCP Server 报告的是工作区 `packages/mcp-server/package.json` 中的版本号。这不能用于判断是否运行了最新工作区代码，应以启动参数中的绝对 `dist/index.js` 路径为准。

## 后续验证清单

### 全局只读

1. 所有连接保持 `mcp_access=read_write`。
2. 在 DBX MCP 设置页打开全局只读。
3. 客户端故意设置 `DBX_MCP_ALLOW_WRITES=1`。
4. `SELECT 1` 成功。
5. `UPDATE test_table SET id = id WHERE 1 = 0` 返回只读错误。
6. 不逐个修改连接也能对多个连接生效。

### 连接级覆盖

1. 关闭全局只读。
2. 连接 A 设置 `read_only`，连接 B 保持 `read_write`。
3. 客户端设置 `DBX_MCP_ALLOW_WRITES=1`。
4. A 写入返回 `CONNECTION_READ_ONLY`。
5. B 的安全写入允许执行。
6. 连接 C 设置 `disabled` 后不出现在 `dbx_list_connections` 中，也不能按 ID 访问。

### 会话收紧

1. 全局只读关闭，连接为 `read_write`。
2. 客户端设置 `DBX_MCP_ALLOW_WRITES=0`。
3. 读取成功，写入返回 `SQL_BLOCKED`。

### 多选范围

1. 单选生成真实 `DBX_MCP_SCOPE_CONNECTION_ID`。
2. 多选同时生成复数 ID 和旧版 fail-closed 哨兵。
3. `dbx_list_connections` 只显示所选连接。
4. 多连接时省略连接参数返回 `CONNECTION_REQUIRED`。
5. 显式指定范围内连接后正常执行。

### 数据库类型

对 SQL、MongoDB、Redis 分别验证：

- 读取命令允许。
- 全局只读阻止写命令。
- 连接级只读阻止写命令。
- 客户端 `ALLOW_WRITES=1` 无法覆盖 DBX 策略。

## 当前验证状态

本轮代码由用户进行人工验证。助手没有运行测试、构建、lint 或格式化命令。

提交前建议由用户根据时间选择执行：

```bash
pnpm --filter @dbx-app/node-core test
pnpm --filter @dbx-app/mcp-server test
pnpm typecheck
```

全局 MCP 只读持久化尚未实现；本文档记录的是下一阶段产品方向和实施计划，不应把当前设置页开关描述为已经具备全局强制策略。
