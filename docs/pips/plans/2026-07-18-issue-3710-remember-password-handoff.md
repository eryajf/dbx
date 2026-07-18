# Issue 3710「记住密码」功能开发与验证交接

## 文档状态

- 日期：2026-07-18
- 仓库：`t8y2/dbx`
- 开发分支：`issue_3710`
- GitHub Issue：[#3710](https://github.com/t8y2/dbx/issues/3710)
- Issue 标题：`[Feature] 连接密码支持“记住密码”开关，满足不允许保存密码的合规场景`
- 当前状态：功能主体、MongoDB 修复、Turso 凭据清理和 JDBC 特殊字符修复已完成；仍需在有 JDK 21 和真实数据库的公司电脑进行集成验证。
- 重要提示：生成本文档时工作区仍有未提交修改。换电脑前必须提交并推送本分支，或导出补丁，否则公司电脑无法获得这些代码。

## 1. 原始需求

Issue 3710 来自企业安全合规场景，报告环境为 DBX v0.5.58、Windows 桌面端。核心痛点如下：

1. 创建连接时没有“是否记住密码”的选择，密码会自动持久化。
2. 企业安全规范要求软件不能记住密码，也不能将密码明文保存到本地。
3. 不记住密码时，每次连接都应弹窗输入一次性密码。
4. 记住密码时，连接应能自动登录。
5. Issue 原文还要求：编辑一个已经保存密码的连接时，不应回显密码明文，只提示“已保存”。

本次开发过程中又补充了以下维护要求：

- 功能不能只支持 MySQL/PostgreSQL/Redis，原则上所有数据库连接类型都应支持。
- “记住密码”复选框应放在密码输入框右侧，而不是另起一行放在下方。
- MongoDB 的原生驱动和 Legacy Agent 驱动都必须支持一次性密码。
- Redis Sentinel 的数据库密码和 Sentinel 密码需要分别处理。
- MQ、Nacos 等把凭据放在 `external_config` 中的连接也需要处理。
- MongoDB URL、H2/Dremio/JDBC connection string 中嵌入的密码不能绕过“不保存密码”。
- 本地 SQLite/File 存储、云同步和旧配置迁移都不能残留被禁用持久化的凭据。

## 2. 当前行为定义

### 2.1 默认行为

- 新建连接的 `remember_password` 默认值为 `true`，保持旧版本兼容性。
- 旧配置缺少该字段时，Rust 和前端都按 `true` 处理。
- 密码输入框右侧显示“记住密码”复选框。

### 2.2 勾选“记住密码”

- 主密码保存到受保护的 connection secret 槽，而不是连接元数据 JSON。
- Redis Sentinel、MQ、Nacos 和 connection string 凭据使用各自的 secret key。
- 下次连接时自动使用保存的凭据。
- Turso 放在 `url_params` 中的 `authToken` 会迁移到标准密码 secret 槽，并从公开连接元数据中删除。

### 2.3 取消“记住密码”

- 保存连接时清除数据库主密码。
- 每次重新连接时显示一次性凭据输入弹窗。
- 用户输入的凭据只写入本次运行时连接配置，不回写前端连接列表和持久化配置。
- Redis Sentinel 会同时询问数据库密码和 Sentinel 密码。
- MQ 根据当前认证类型询问 Token、Basic Password、API Key Value 或 OAuth Client Secret。
- Nacos `usernamePassword` 认证会询问密码。
- MongoDB/H2/Dremio/JDBC connection string 中的嵌入密码会被清除。
- Turso `url_params` 中的 `authToken`、`auth_token`、`auth-token` 会被丢弃。

### 2.4 取消输入

- 关闭一次性密码弹窗会取消当前连接尝试。
- 多个并发连接请求通过队列依次显示凭据弹窗。

## 3. 前端实现

### 3.1 复选框布局

`RememberPasswordInput.vue` 将以下元素放在同一个 flex 行中：

- 左侧：`PasswordInput`
- 右侧：“记住密码”复选框

该组件已经替换连接表单中主要的密码、Token 和 Secret 输入项。MongoDB URL 模式没有独立密码 input，因此复选框放在 URL textarea 右侧。

关键文件：

- `apps/desktop/src/components/connection/RememberPasswordInput.vue`
- `apps/desktop/src/components/connection/ConnectionDialog.vue`
- `apps/desktop/src/components/connection/CloudflareD1ConnectionFields.vue`
- `apps/desktop/src/components/ui/PasswordInput.vue`

### 3.2 一次性凭据弹窗

全局弹窗由以下文件组成：

- `apps/desktop/src/components/connection/ConnectionPasswordPromptDialog.vue`
- `apps/desktop/src/stores/connectionCredentialStore.ts`
- `apps/desktop/src/components/layout/AppDialogs.vue`

`connectionCredentialStore` 维护当前请求和等待队列，返回 `ConnectionCredentialValues | null`。弹窗提交后，凭据只传给当前连接 Promise。

### 3.3 凭据提取、清理和运行时注入

集中逻辑位于：

- `apps/desktop/src/lib/connection/connectionPasswordPersistence.ts`

主要职责：

- `connectionCredentialFields`：确定某种连接需要询问哪些凭据。
- `connectionCredentialValues`：从顶层字段、MongoDB URI、H2/Dremio/JDBC URL、MQ/Nacos 配置和 Turso URL 参数中提取已有凭据。
- `persistentConnectionConfig`：生成允许持久化的连接配置。
- `connectionWithCredentials`：为单次连接生成带运行时凭据的配置。

支持的特殊载体：

| 类型 | 凭据位置 | 当前处理 |
| --- | --- | --- |
| 普通数据库 | `password` | 清除或运行时注入 |
| MongoDB | URI userinfo | 保存前去除密码，运行时重新编码注入 |
| H2 | `;PASSWORD=` / `;PWD=` | 保存前去除；运行时只使用 JDBC 独立 password 参数 |
| Legacy Dremio | `;password=` / `;pwd=` | 保存前去除；运行时只使用 JDBC 独立 password 参数 |
| Arrow Flight SQL | URI userinfo/query | 保存前去除，运行时 URI 编码注入 |
| Generic JDBC | URI、分号属性、query | 保存前去除，运行时使用顶层 JDBC credentials |
| Redis Sentinel | `password` + `redis_sentinel_password` | 分别询问和清理 |
| MQ | `external_config.auth` | 支持 token/basic/apiKey/oauth2 |
| Nacos | `external_config.auth.password` | 与顶层 password 同步 |
| Turso | `password` 或 `url_params` token | URL 参数 Token 迁移到标准密码槽 |

### 3.4 Connection Store

`apps/desktop/src/stores/connectionStore.ts` 负责：

1. 保存前调用 `persistentConnectionConfig`。
2. 连接前判断 `remember_password`。
3. 缺少凭据时请求一次性密码弹窗。
4. 将运行时配置传给 `api.connectDb`。
5. 保持前端保存配置始终为无一次性凭据版本。
6. 使用无密码配置生成 database metadata fingerprint，避免后台 metadata 刷新因为运行时密码不同而失效。

## 4. Rust 存储与同步实现

### 4.1 配置模型

`ConnectionConfig` 和反序列化中间结构都新增：

```rust
#[serde(default = "default_true")]
pub remember_password: bool
```

关键文件：

- `crates/dbx-core/src/models/connection.rs`
- `apps/desktop/src/types/database.ts`

### 4.2 SQLite 存储

`crates/dbx-core/src/storage.rs` 的保存、加载和 metadata-preserving 保存路径均已处理：

- `remember_password = true`：保存主密码、Sentinel、MQ、Nacos 和 connection string secret。
- `remember_password = false`：删除对应 secret，保留清理后的 connection string 结构。
- 加载旧配置时发现禁用持久化但仍有明文/secret，会主动删除并重写配置 JSON。
- Turso URL 参数 Token 会迁移到 `MAIN_PASSWORD_KEY`，或者在禁用持久化时丢弃。

### 4.3 File Secret Store

`crates/dbx-core/src/connection_secrets.rs` 同样覆盖：

- JSON 文件元数据脱敏。
- secret store 保存、恢复和删除。
- 旧明文配置迁移。
- MongoDB/H2/Dremio/JDBC connection string 清理。
- Turso URL 参数 Token 的提取、清理和迁移。

### 4.4 云同步

`crates/dbx-core/src/cloud_sync.rs` 的公开快照始终清除：

- 主密码和 Sentinel 密码。
- connection string。
- MQ/Nacos 认证 secret。
- Turso `url_params` 中的 Token。

启用同步密码时：

- `remember_password = true` 的认证 secret 进入加密 payload。
- `remember_password = false` 的认证 secret 不进入加密 payload。
- 清理后的 connection string 结构仍可进入加密 payload，便于另一台电脑重建连接地址。
- 应用旧同步快照时，禁用持久化的连接不能被旧 payload 重新写回密码。

## 5. MongoDB 问题与修复过程

### 5.1 用户复现

MySQL、Redis、PostgreSQL 的“不保存密码”连接工作正常，但 MongoDB 多次出现：

```text
MongoDB connection failed: Kind: SCRAM failure: Authentication failed.
CommandError { code: 18, code_name: "AuthenticationFailed" }
```

### 5.2 原生驱动根因

MongoDB URL 被解析成 `ClientOptions` 后，URI 中原有或清理后残留的 credential 对象可能优先于顶层运行时密码。仅修改顶层 `ConnectionConfig.password` 不能保证 SCRAM 实际使用该密码。

修复位于：

- `crates/dbx-core/src/db/mongo_driver.rs`

新增 `connect_with_password_policy`：

- 记住密码时，URI credential 保持权威，兼容原行为。
- 不记住密码时，用运行时 username/password 覆盖解析后的 credential。
- 只覆盖 username/password，保留 `authSource` 和 `authMechanism`，避免再次触发 SCRAM 认证库或机制错误。

### 5.3 Legacy Agent 根因

Legacy Mongo Agent 需要在传给 Java Agent 的 URI 中得到运行时凭据。修复位于：

- `crates/dbx-core/src/agent_connection.rs`
- `agents/drivers/mongodb/src/test/java/com/dbx/agent/mongodb/MongoAgentTest.java`

不记住密码时，运行时 username/password 会经过百分号编码后注入 MongoDB URI，同时保留 hosts、database、`authSource` 和 `authMechanism`。

### 5.4 自动回退后的第二个根因

原生驱动失败并自动回退 Legacy 后，前端曾重新读取磁盘配置来确认 driver profile。磁盘配置没有一次性密码，因此会丢失本次运行时凭据。

修复方式：

- 新增 Tauri 命令 `connection_runtime_driver_profile`。
- 前端直接读取后端内存中的运行时 driver profile。
- 不再为确认 fallback 而重新加载 passwordless 磁盘配置。

关键文件：

- `src-tauri/src/commands/connection.rs`
- `src-tauri/src/lib.rs`
- `apps/desktop/src/lib/backend/api.ts`
- `apps/desktop/src/lib/backend/tauri.ts`
- `apps/desktop/src/lib/backend/http.ts`
- `apps/desktop/src/stores/connectionStore.ts`

## 6. 本轮代码复查后补充的修复

### 6.1 Turso URL 参数 Token 泄露

Turso UI 明确允许：

```text
authToken=xxx
```

后端也会从 `url_params` 读取 `authToken`、`auth_token` 或 `auth-token`。此前“不记住密码”只清理顶层 `password`，导致 Token 仍可能进入本地 `config_json` 和云同步公开快照。

现在的处理：

- 前端保存前提取和删除 Token。
- 勾选记住时迁移到标准 password secret。
- 取消记住时直接丢弃。
- SQLite、File、旧配置加载和云同步再次执行后端清理，防止绕过前端。

### 6.2 H2/Legacy Dremio 分号密码

此前运行时会把一次性密码拼回：

```text
;PASSWORD=<password>
```

当密码包含 `;` 时，JDBC 会把它解析为连接属性分隔符，造成 URL 格式错误或属性注入。

现在 H2 和 Legacy Dremio：

- connection string 始终保持无密码版本。
- 一次性密码只通过 `DriverManager.getConnection(url, username, password)` 的独立 password 参数传递。
- 回归测试使用了包含分号的密码。

## 7. 当前自动化验证记录

### 7.1 本轮最新结果

| 验证项 | 结果 |
| --- | --- |
| 前端凭据与 connection store 定向测试 | 2 files / 24 tests passed |
| `connection_secrets` Rust 测试 | 16 passed |
| `storage` Rust 测试 | 46 passed |
| `cloud_sync` Rust 测试 | 21 passed |
| TypeScript `vue-tsc` | passed |
| 相关前端 `oxlint` | passed |
| `cargo check --workspace --all-targets` | passed；仅有已有的 duplicate `#[test]` warning |
| `cargo fmt --all` | passed |
| `git diff --check` | passed |

本轮曾因命令参数写法误触发前端全量 Vitest：

- 3768 tests passed。
- 8 tests failed/timeout。
- 失败项都依赖本机监听 `127.0.0.1`，当前 Codex 沙箱返回 `listen EPERM`；不属于本功能断言失败。

### 7.2 此前同一分支的验证记录

- 前端生产构建通过。
- `cargo fmt --check` 通过。
- workspace all-targets check 通过。
- `dbx-core` 全量测试曾得到 2176 passed、6 ignored、1 failed。
- 唯一失败是需要真实 PostgreSQL/Docker 环境的既有测试，不是本功能单元测试。

### 7.3 尚未完成的自动验证

- Java Mongo Agent Gradle 测试：当前电脑最高只有 JDK 18，项目贡献规范要求 JDK 21。
- 最终代码完成后的真实 MongoDB SCRAM 冒烟测试。
- Windows 10 桌面端的最终 UI 和存储验证。

## 8. 公司电脑环境准备

建议环境：

- Node.js >= 22.13.0
- pnpm 10.27.0
- Rust stable，与仓库 lockfile 兼容
- JDK 21
- 可用的 MongoDB、MySQL、PostgreSQL、Redis 环境
- 如需完整集成测试，准备 Docker Desktop

获取代码前先确认家中电脑已经完成：

```bash
git status
git add <issue 3710 files>
git commit -m "feat(connection): support optional password persistence"
git push -u origin issue_3710
```

公司电脑：

```bash
git fetch origin
git switch issue_3710
pnpm install
```

如果不希望先提交，可在当前电脑导出补丁并安全传输：

```bash
git diff --binary > issue-3710.patch
```

注意：普通 `git diff` 不包含未跟踪的新文件。导出补丁前应先 `git add -N` 新文件，或者直接提交到分支。

## 9. 推荐验证命令

### 9.1 前端

```bash
pnpm exec vitest run \
  apps/desktop/src/lib/connection/connectionPasswordPersistence.spec.ts \
  apps/desktop/src/stores/__tests__/connectionStore.credentials.spec.ts

pnpm typecheck
pnpm lint
pnpm build
```

### 9.2 Rust

```bash
cargo test -p dbx-core connection_secrets::tests
cargo test -p dbx-core storage::tests
cargo test -p dbx-core cloud_sync::tests
cargo test -p dbx-core db::mongo_driver::tests
cargo check --workspace --all-targets
cargo fmt --all -- --check
```

### 9.3 Java Mongo Agent

在 `agents` 目录执行：

```bash
./gradlew :mongodb:test
```

Windows：

```powershell
.\gradlew.bat :mongodb:test
```

确保 `java -version` 和 Gradle toolchain 都指向 JDK 21。

### 9.4 Rust Mongo Live Test

测试文件：

- `crates/dbx-core/tests/live_mongodb_find_one.rs`

需要以下环境变量：

```bash
export DBX_LIVE_MONGODB_URL='mongodb://host:27017/app?authSource=admin'
export DBX_LIVE_MONGODB_USERNAME='test-user'
export DBX_LIVE_MONGODB_PASSWORD='test-password'
```

然后按测试名执行被忽略的 live test。不要把真实密码写入仓库、Shell history、截图或本文档。

## 10. 手工验收矩阵

### 10.1 通用数据库

至少验证：MySQL、PostgreSQL、Redis、MongoDB、SQLite Cipher、H2。

每种数据库检查：

1. 新建连接时复选框默认勾选。
2. 复选框位于密码输入框右侧。
3. 勾选后保存、关闭应用、重新打开，可以直接连接。
4. 取消勾选后保存，连接列表配置中不保留密码。
5. 每次断开后重新连接都会弹出一次性密码窗口。
6. 取消弹窗不会产生错误连接状态。
7. 输入错误密码时显示驱动真实认证错误，再次连接仍会重新询问。
8. 输入正确密码后连接成功，但编辑/保存配置不会出现该一次性密码。

### 10.2 MongoDB 重点矩阵

建议准备一个用户创建在 `admin`、业务库位于其他 database 的 MongoDB：

| 驱动/输入模式 | 记住 | 预期 |
| --- | --- | --- |
| Native Auto + 表单 | 是 | 直接连接 |
| Native Auto + 表单 | 否 | 弹窗后 SCRAM 成功 |
| Native Auto + URL + `authSource=admin` | 是 | 直接连接 |
| Native Auto + URL + `authSource=admin` | 否 | 弹窗后保留 authSource 并成功 |
| Legacy + 表单 | 否 | Agent URI 注入运行时密码并成功 |
| Native 自动 fallback 到 Legacy | 否 | fallback 后不丢失一次性密码 |

密码至少覆盖：

- 普通字母数字。
- 包含 `@`、`:`、`/`、`%` 的密码。
- 用户名包含需要 URL 编码的字符。
- `SCRAM-SHA-1` 和 `SCRAM-SHA-256`（环境允许时）。

### 10.3 Redis Sentinel

- 数据节点有密码、Sentinel 无密码。
- Sentinel 有密码、数据节点无密码。
- 两者都有密码且不同。
- 不记住时弹窗必须显示两个独立字段，不能相互覆盖。

### 10.4 MQ 和 Nacos

MQ 分别验证：

- Token
- Basic
- API Key（`apiKey`、兼容 `api_key`/`apikey`）
- OAuth2 Client Secret

Nacos 验证：

- `none`
- `usernamePassword`
- 不记住时 nested password 和顶层运行时 password 一致。

### 10.5 Turso

分别使用以下参数名：

- `authToken`
- `auth_token`
- `auth-token`

检查：

1. 记住时 Token 从 `url_params` 移入 secret 槽。
2. 不记住时 Token 不进入本地配置和同步快照。
3. 其他 URL 参数仍被保留。
4. 重连时使用弹窗输入的 Token。

### 10.6 H2 和 Legacy Dremio

使用包含以下字符的密码：

```text
part1;part2=value
```

检查 connection string 中没有重新出现 `PASSWORD=`/`password=`，连接仍通过独立 JDBC password 参数成功。

## 11. 存储与安全检查

对于 `remember_password = false` 的连接：

- `connections.config_json` 中不应出现数据库密码、Sentinel 密码、MQ/Nacos secret、Mongo URI password 或 Turso Token。
- `connection_secrets` 中不应存在主密码、Sentinel、MQ Auth 或 Nacos Auth secret。
- 云同步公开 snapshot 不应包含任何上述凭据。
- 即使给云同步设置加密口令，不记住的认证 secret 也不应进入 encrypted payload。

对于 `remember_password = true` 的连接：

- 公开连接元数据仍不应包含密码。
- secret 应位于 secret store 或加密同步 payload。
- Turso Token 不应继续留在 `url_params`。

## 12. 仍需确认或后续完善

### 12.1 已保存密码的编辑回显策略

Issue 原文要求：

> 已保存密码在编辑连接时不可回显明文，仅提示“已保存”。

当前实现仍将已保存凭据恢复到运行时 `ConnectionConfig`，连接表单的 `PasswordInput` 也保留自定义眼睛按钮。因此，如果严格按 Issue 原文验收，这一项还需要单独的产品和架构决定。

推荐的完整方案不是只隐藏眼睛图标，而是：

1. `load_connections` 返回脱敏配置和 `has_saved_password` 等状态，不把 secret 发给前端。
2. 编辑页显示“已保存”，用户只有输入新密码或清除已保存密码两种操作。
3. `connect_db` 在后端将保存的 secret 合并到运行时配置。
4. Redis Sentinel、MQ、Nacos 和 connection string secret 需要各自的 saved-state 元数据。
5. Web 后端与 Tauri 后端保持相同行为。

如果维护者认为当前遮罩输入框加显隐按钮是有意的产品调整，应在 Issue/PR 中明确记录偏离原始验收条件的原因。

### 12.2 真实 MongoDB 最终验证

此前用户在中间版本上多次复现 SCRAM code 18。虽然当前代码已经修复 native credential override、Legacy URI 注入和 fallback 重载问题，但最终版本仍必须在用户真实 MongoDB 环境重新验证，不能仅以单元测试代替。

### 12.3 JDK 21

Mongo Legacy Agent 测试必须在 JDK 21 下执行。当前开发电脑的 JDK 18 结果不能作为 Java Agent 已验证的依据。

## 13. 提交前最后检查

```bash
git status --short --branch
git diff --check
git diff --stat
git diff
git diff --cached
```

确认：

- 新增的 6 个前端文件和本文档都已纳入提交。
- 没有 `dist`、构建产物、本地数据库、真实密码或日志文件。
- 所有 `ConnectionConfig` Rust 测试初始化都包含或兼容 `remember_password`。
- PR 描述明确列出 MongoDB、Turso、H2/Dremio 和云同步安全边界。
- PR 中记录 JDK 21/真实 MongoDB 的验证结果，或明确标记为待验证。

