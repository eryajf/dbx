# MCP 中央访问策略交接说明

## 文档状态

- 日期：2026-07-18
- 分支：`issue_3696`
- 关联 Issue：[#3696](https://github.com/t8y2/dbx/issues/3696)、[#3800](https://github.com/t8y2/dbx/issues/3800)
- 状态：中央策略已实现，自动化检查通过；仍需使用真实数据库完成发布前人工验证。
- 评审：软件 QA 与数据库专项复核均通过，`IS_PASS: YES`。

## 最终产品决策

MCP 权限集中在“设置 → MCP”管理，不再给每个连接增加 `disabled`、`read_only`、`read_write` 三态选项。

DBX 持久化一份中央策略：

```ts
interface McpGlobalPolicy {
  readOnly: boolean;
  allowDangerousSql: boolean;
  allowedConnectionIds: string[] | null;
}
```

UI 使用单一的“权限模式”选择器，内部仍以两个布尔字段兼容现有存储：

| UI 模式 | 内部模式值 | `readOnly` | `allowDangerousSql` |
| ------- | ---------- | ---------- | ------------------- |
| 只读 | `read_only` | `true` | `false` |
| 数据读写 | `safe_write` | `false` | `false` |
| 完全访问 | `high_risk_write` | `false` | `true` |

- `allowedConnectionIds=null`：允许全部连接。
- `allowedConnectionIds=[]`：不允许任何连接。
- 非空数组：只允许其中的稳定连接 ID。
- `readOnly=true`：仅允许 DBX 静态分类为读取的请求，阻止已识别的 MCP 数据库写入及连接新增、删除，`allowDangerousSql` 此时不生效。
- `readOnly=false && allowDangerousSql=false`：数据读写，允许普通 `INSERT`、带有效过滤条件的 `UPDATE`/`DELETE`、MongoDB 带可验证有效过滤条件的更新/删除，以及 Redis 普通写入和明确键删除。
- `readOnly=false && allowDangerousSql=true`：完全访问，在数据读写基础上允许全表 `UPDATE`/`DELETE`、DDL、`TRUNCATE`、MongoDB 清空/结构变更、Redis `FLUSH*` 及等价破坏性操作。
- 通用连接 `read_only=true` 继续作为单连接写保护，并同时约束 DBX 与 MCP。
- 生产库保护始终是权限上限，不能被高风险操作开关覆盖。
- 新版 MCP Server 忽略客户端读写和高风险操作环境变量；当前生成配置不再包含权限或连接范围环境变量。旧客户端 scope 仅作为兼容层继续读取，并且只能收紧连接范围。

最终连接范围：

```text
effective_connections =
  stored_connections
  INTERSECT global_allowed_connection_ids
```

旧配置若仍声明客户端 scope，会在上述结果上继续取交集，但它不再是当前配置方式的一部分。

最终写权限：

```text
effective_write_allowed =
  NOT global_mcp_read_only
  AND NOT connection_read_only
  AND NOT production_protected
```

高风险操作权限由 `allowDangerousSql` 决定，且仍受上述写权限约束。SQL 中仅出现 `WHERE` 不足以降级风险；缺少有效过滤条件以及 `WHERE TRUE`、`WHERE 1 = 1` 等无效条件仍按高风险操作处理。无法可靠分类的操作失败关闭。

## 已实现内容

### 持久化与 API

- 策略以 `app_settings.settings_json.mcp_global_policy` 原子保存，JSON 字段使用 `readOnly`、`allowDangerousSql`、`allowedConnectionIds`。
- 缺少数据库、表、记录或策略字段时按未配置默认值处理：允许全部连接、允许数据读写。
- JSON、SQLite 或 Web API 读取异常返回 `MCP_POLICY_UNAVAILABLE`，MCP 工具失败关闭。
- Tauri 增加 `load_mcp_global_policy`、`save_mcp_global_policy` 命令。
- Web 增加经现有认证中间件保护的 `GET/PUT /api/app-settings/mcp-policy`。
- 通用 app settings 保存会保留并发写入的最新 MCP 策略，避免旧设置快照覆盖安全策略。

### MCP Server 与 Node backend

- `Backend` 增加 `loadMcpGlobalPolicy()`，桌面模式直接读取 SQLite，Web 模式调用策略 API。
- 列表和连接解析始终应用中央 allowlist；旧配置中的客户端 scope 仅作为额外收窄条件兼容读取。
- 按 ID 或名称访问范围外连接返回 `CONNECTION_OUT_OF_SCOPE`。
- SQL 多语句在每条语句执行前重新读取策略；同一 MCP 进程无需重启即可响应设置切换。
- SQL、MongoDB、Redis、`dbx_execute_and_show`、连接新增和删除均使用中央只读与高风险操作策略。
- 删除连接前重新解析目标，不能按隐藏 ID 或名称删除 allowlist 外连接。
- Web MCP 的 SQL、MongoDB、Redis 和连接保存请求携带 `X-DBX-MCP-Request: 1`，普通 Web UI 请求不携带，因此不受 MCP 全局只读影响。
- Web MCP 连接新增、删除使用专用的单连接 `/api/connection/mcp/add` 与 `/api/connection/mcp/remove` 路由；服务端在同一 SQLite 事务中复核最新策略并只修改目标行，避免完整列表快照覆盖 Web UI 的并发连接修改。

### Desktop bridge 与 Web 最终执行边界

- Desktop bridge 自身重新读取中央策略，不信任 Node 传入的 `allow_writes`、`allow_dangerous` 或 Redis `skip_safety_check`。
- bridge 的连接解析、SQL、MongoDB 聚合/索引/文档写入、Redis 命令均检查 allowlist、全局只读、通用连接只读和生产库保护。
- Web query、MongoDB 和 Redis 路由在检测到 MCP 来源标记时执行同样的末端校验。
- MongoDB `$out`、`$merge` 只按顶层聚合阶段识别，避免普通字段值误报。
- SQL 数据读写允许普通 `INSERT` 和带有效过滤条件的 `UPDATE`/`DELETE`；全表修改、DDL、`TRUNCATE` 以及无法可靠分类的写操作需要完全访问权限。
- MongoDB 数据读写允许带可验证有效过滤条件的更新/删除；空过滤、`$where`/`$expr`/`$nor` 等不透明过滤器、`$out`/`$merge` 和结构变更需要完全访问权限。
- Redis 数据读写允许已明确分类的普通键值写入和明确键删除；`FLUSHDB`、`FLUSHALL` 等全局破坏性命令需要完全访问权限，未知命令需要完全访问权限。

### 桌面与 Web 设置 UI

- MCP 设置页同时支持桌面和 Web 模式。
- 两个底层布尔权限字段在 UI 中收敛为互斥的“只读 / 数据读写 / 完全访问”三级选择，内部模式值保持 `read_only / safe_write / high_risk_write` 兼容。
- 权限选择器下方展示读取、范围可控的数据变更、全量/清空、结构与高风险管理、连接管理五类能力对照，并明确所有模式仍受连接 allowlist、连接只读、生产库保护和数据库账号权限约束。
- 连接多选已升级为 DBX 权威 allowlist，并提供“所有连接”和“不允许任何连接”。
- 策略保存期间禁用控件；保存失败回滚并提示；加载失败时禁用策略控件，避免显示可写假象。
- 旧 `dbx-mcp-config-readonly=true` 只在后端策略尚未初始化时迁移为全局只读，保存成功后清理旧键。
- 旧客户端 scope localStorage 不迁移为全局 allowlist，避免把单客户端偏好意外升级为全局限制。
- 生成配置只包含启动 MCP Server 并连接当前 DBX 实例所需的运行参数；Web 模式包含 `DBX_WEB_URL` 和 `DBX_WEB_PASSWORD` 占位值，但不再生成读写、高风险操作或连接 scope 环境变量。
- 旧 scope 环境变量仍由新版 Server 兼容读取，但 DBX 不再展示、生成或推荐；升级后可从客户端配置中删除。

### 连接模型简化

- Rust 与 TypeScript `ConnectionConfig` 已删除 `mcp_access`。
- 连接编辑页、store、i18n、文档和 MCP 运行时不再包含连接级 MCP 三态。
- 旧 JSON 中的 `mcp_access` 会被忽略，且后续序列化不再输出该字段；不会迁移为通用连接只读。

### npm 发布链

- `@dbx-app/mongo-shell` 已移除 `private` 标记。
- package dry-run 会打包 `mongo-shell`。
- `mcp-release.yml` 会先发布固定版本的 `mongo-shell`，再发布依赖它的 `node-core` 与 MCP Server。
- 本轮只修复发布配置，没有实际向 npm 发布。

## 自动化验证结果

```text
pnpm typecheck
  PASS

frontend MCP/settings focused tests
  4 files, 117 tests passed

@dbx-app/node-core
  SQL/MongoDB/Redis/MCP policy focused: 6 files, 92 tests passed
  final full-suite attempt: 147 passed, 7 blocked by sandbox localhost EPERM

root Vitest full suite
  3785 passed, 7 blocked by sandbox localhost EPERM

@dbx-app/mcp-server
  build passed, 3 files, 72 tests passed

cargo check -p dbx-core -p dbx-web
  PASS

cargo check -p dbx
  PASS

cargo test -p dbx-core mcp_
  12 relevant tests passed

cargo test -p dbx-core sql_risk --lib
  14 SQL risk tests passed

cargo test -p dbx-core storage::tests --lib
  44 storage tests passed

cargo test -p dbx-core classifies_safe_confirmed_and_blocked_commands --lib
  1 Redis risk test passed

cargo test -p dbx mcp_
  16 relevant tests passed

cargo test -p dbx-web mcp_
  5 matching tests passed

cargo fmt --check
  PASS

pnpm publish:dry-run
  mongo-shell, node-core, CLI and MCP Server built and packed successfully

git diff --check
  PASS

pnpm lint
  PASS

pnpm build
  PASS
```

Node 全量测试中的 7 项需要绑定临时 localhost 端口，在受限 sandbox 中会以 `listen EPERM` 超时；node-core 其余 147 项及根目录其余 3785 项通过。本轮申请本地监听权限时审批服务返回 503，因此未能在沙箱外重跑这 7 项。受影响的是本地 HTTP/Redis/bridge 测试，与 MCP 风险判断无关；第二轮 Node 安全聚焦测试 92 项、前端/MongoDB/MCP 配置聚焦测试 117 项均全部通过。

真实 MCP stdio 探针使用最新构建的绝对路径、`mysql-localhost` 和临时策略数据库副本，在同一 MCP 进程内完成动态策略验证：只读模式返回 `MCP_READ_ONLY`，且客户端写入/高风险环境变量即使为 `1` 也无法提权；数据读写模式下带有效条件的 `UPDATE` 通过策略层，无条件 `UPDATE`、`TRUNCATE` 和 `USE` 返回 `SQL_BLOCKED`；完全访问模式下无条件更新通过策略层；allowlist 切换为空集后连接列表立即隐藏并返回 `CONNECTION_OUT_OF_SCOPE`。所有写入探针均指向不存在的 `__dbx_mcp_probe_missing__` 表；沙箱禁止连接 `127.0.0.1:3306`，所以通过策略层的探针在驱动连接阶段返回 `EPERM`，未修改数据库数据。

Tauri 测试仍会报告一个与本改造无关的既有 warning：`src-tauri/src/commands/sql_file.rs` 存在重复 `#[test]` 属性。

## 发布前人工验证

1. 所有连接保持普通配置，在 MCP 设置打开全局只读；即使旧客户端仍声明读写或高风险操作环境变量，也不得影响结果。
2. 只读模式下 SQL `SELECT`、MongoDB find、Redis GET 成功；SQL/MongoDB/Redis 写入以及 MCP 连接增删均返回只读错误。
3. 数据读写模式下，普通 `INSERT`、带有效过滤条件的 `UPDATE`/`DELETE`、MongoDB 带可验证有效过滤条件的更新/删除、Redis 已知普通写入和明确键删除成功。
4. 数据读写模式下，全表 `UPDATE`/`DELETE`、`WHERE TRUE`/`WHERE 1 = 1`、DDL、`TRUNCATE`、MongoDB 空过滤清空/结构变更、Redis `FLUSH*` 均被拒绝。
5. 完全访问模式下，上述高风险操作仅在连接非只读且未触发生产库保护时允许。
6. 不重启 MCP 会话，切换任一策略后下一次请求立即应用新权限。
7. allowlist 分别设置为全部、单个、多个、空集，确认列表与按 ID/名称解析符合交集语义。
8. 对 Desktop 直连、需要 bridge 的连接和 Web 模式各执行一次三级权限验证。
9. 直接向 bridge 传入 `allow_writes=true`、`allow_dangerous=true` 或 `skip_safety_check=true`，确认仍不能覆盖 DBX 中央策略。

## 已知边界

- 已经提交到数据库执行的单条语句或事务无法可靠撤销；策略约束下一条语句和后续请求。
- MCP SQL 权限是应用层静态语句形状保护；此限制同样适用于只读模式，无法识别 `SELECT app_mutate_users()` 等用户自定义函数或 volatile 函数的所有副作用。
- 数据读写不能阻止 Agent 先读取并枚举主键、再通过多次带条件语句逐条修改或删除全部数据。
- 数据库账号最小权限仍是最终硬边界；MCP 策略不能替代数据库自身的授权、审计和凭据隔离。
- `dbx_execute_and_show` 仅支持 SQL 连接；MongoDB 和 Redis 必须使用各自的执行工具。
- 旧 MCP Server 不会读取中央策略，必须同时升级 DBX 应用与 MCP Server；当前生成配置不再为旧 Server 输出权限兼容环境变量。
- MCP 策略不是数据库凭据吊销，不能阻止持有凭据的进程绕过 DBX 直接连接数据库。
- Web 的 MCP 来源 header 用于区分 DBX Web UI 与 MCP 执行路径；真正的外部访问控制仍由现有 Web 认证负责。
