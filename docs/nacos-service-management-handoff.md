# Nacos 服务管理改造交接（Issue #4670）

> 最后更新：2026-08-03  
> 工作分支：`issue_4670`  
> 状态：本地实现中，尚未提交、尚未推送。

本文用于继续完成和验收 DBX 的 Nacos 服务管理改造。对应 Issue：[t8y2/dbx#4670](https://github.com/t8y2/dbx/issues/4670)。

## 1. 本次改造目标

初始问题是服务/实例写入后，DBX 可能没有展示 Nacos 的最终状态；进一步扩展为服务管理的日常运维闭环。

当前实现覆盖：

- 服务跨分组列表、筛选、详情、创建、编辑、删除；
- 实例列表、集群筛选、持久实例注册、注销；
- 实例权重、启停、健康标记、元数据编辑；
- 完整实例身份、写后乐观更新与回读校验；
- Nacos v2/v3 路由选择，以及 r-nacos 的能力降级。

不在本轮范围内：Nacos v3 健康检查器管理、订阅者/客户端诊断、全量批量元数据治理。

## 2. 当前工作区与主要文件

工作区已有未提交改动，不能用 `git reset --hard` 或 `git checkout --` 清理。

核心实现文件：

- `apps/desktop/src/components/nacos/NacosAdminConsole.vue`：服务和实例管理 UI；
- `crates/dbx-core/src/nacos/http.rs`：Nacos HTTP 路由、兼容与解析；
- `crates/dbx-core/src/nacos/types.rs`、`service.rs`、`port.rs`：服务管理模型与能力；
- `src-tauri/src/commands/nacos_cmd.rs`：Tauri 传输层；
- `crates/dbx-web/src/routes/nacos.rs`：Web 传输层；
- `apps/desktop/src/lib/backend/{api,http,nacos-tauri}.ts`、`apps/desktop/src/types/nacos.ts`：前端契约；
- `tmp/nacos-test-services.go`：本地手工测试数据生成器。

注意：`tmp/` 被 `.gitignore` 忽略。该 Go 脚本当前只存在于本地工作区；在提交前如需随代码交付，应移到受版本管理的 `scripts/` 或测试目录，或显式 `git add -f`。

## 3. Nacos v2 的关键兼容结论

本地 Nacos 版本为 `2.5.2`。经过真实接口验证，下面的差异很重要：

| 场景 | 应使用的接口/行为 | 原因 |
| --- | --- | --- |
| 跨分组服务列表 | `GET /v1/ns/catalog/services` | `/v2/ns/service/list` 在不传分组时会合法返回空列表，官方控制台可通过 Catalog 列出各分组服务。 |
| 指定分组的空服务 | `GET /v2/ns/service/list` 补充查询 | Catalog 不枚举空服务；只有用户显式输入分组时补查。 |
| 管理实例列表 | `GET /v1/ns/catalog/service` + `GET /v1/ns/catalog/instances` | 普通 Naming 列表会隐藏 `enabled=false` 的实例；Catalog 返回禁用实例，适合管理页。 |
| 服务/实例写入 | 优先 `/v1/ns/...` | 本地 `/v2/ns/...` 兼容路由可能接受请求却将部分字段（例如权重）按默认值保存。 |
| 集群过滤 | DBX 收到结果后按 `clusterName` 二次过滤 | Nacos v2.5.2 对 `clusters=blue` 可能仍返回全部实例。 |

服务详情 `GET /v2/ns/service` 不包含实例权重；权重需从实例列表接口读取。

## 4. 已实现的交互与行为

### 服务列表与请求一致性

- 服务列表、实例列表各自有请求代次和当前连接/命名空间/筛选/已选服务快照校验，旧响应不会覆盖新选择。
- 服务列表默认可跨分组显示服务和 `groupName`、集群数、实例数、健康数、保护状态。
- Nacos 自动清理无实例服务；对于新建空服务，应尽快注册实例或在指定分组中管理。

### 服务管理

- 创建、编辑、删除服务；删除前会检查服务是否仍有实例。
- 服务元数据和选择器都校验为 JSON 对象。
- 空的选择器 `{}` 会被视为未设置，避免 Nacos 报 `not match any type of selector`。
- 保护阈值保存时校验为 `0~1` 的有限数字；默认值 `0` 表示关闭该阈值。
- 保护阈值输入改为十进制文本输入，允许从 `0` 直接输入 `.5` 得到 `0.5`，不再被 number 控件中间态重置。

### 实例管理

- 统一身份：`namespace + group + service + ip + port + cluster + ephemeral`，用于行键、加载态、确认操作和回读匹配。
- DBX 只允许手工注册**持久实例**，临时实例必须由业务客户端提供心跳。
- 权重改为草稿交互：上下微调/输入只修改本地草稿，出现“保存 / 还原”；点击保存后才显示一次确认框并提交最终值。
- 启停、健康标记、注销仍有确认机制；写成功后先乐观更新，再有限次回读服务端状态。
- 禁用实例不会消失：实例管理页优先使用 Catalog 接口，禁用实例仍显示“已下线”、“启用”和“编辑”。
- “编辑实例”弹窗可修改权重和元数据；元数据必须是 JSON 对象。
- 实例卡片中权重和元数据采用固定两列布局；展开元数据不会使权重区域上下跳动。

### 对话框与文案

- 服务创建/编辑、注册实例、编辑实例的遮罩点击和 Esc 均不会关闭对话框；只能用关闭按钮或取消按钮关闭。
- 本轮新增服务管理文案已直接中文化。全局 i18n 尚未补齐，见“后续工作”。

## 5. 本地环境

### Nacos v2（主要验收环境）

用户本地 Docker 映射：

```text
管理地址：http://127.0.0.1:8849/nacos
Nacos 端口：容器 8848 -> 主机 8849
版本：2.5.2
模式：standalone
命名空间：public
```

DBX 连接应显式选择 Nacos `2.x`，地址填写 `http://127.0.0.1:8849/nacos`。

### Nacos v3

用户本地存在 Nacos `3.1.0`：控制台端口映射到主机 `8010`，Server/Admin API 端口映射到主机 `8818`。DBX 的 v3 地址应填写 Server/Admin API 地址，推荐：

```text
http://127.0.0.1:8818/nacos
```

不要把 `8010` 的 Console 静态页面地址当作 v3 Admin API 地址。

### r-nacos

用户本地 r-nacos `0.8.5` 映射为主机 `3848 -> 8848`。r-nacos 必须根据能力矩阵降级；未证实的服务/实例写能力应只读，不应显示“写入成功”。

## 6. 测试数据生成器

从仓库根目录运行，并保持进程运行：

```bash
go run ./tmp/nacos-test-services.go -group DBX_TEST
```

按 Ctrl+C 会注销脚本注册的实例。默认注册持久实例：

| 服务 | 地址 | 集群 | 初始权重 |
| --- | --- | --- | --- |
| `dbx-demo-api` | `127.0.0.1:19001` | `blue` | `1` |
| `dbx-demo-api` | `127.0.0.1:19002` | `green` | `2` |
| `dbx-demo-api` | `127.0.0.1:19003` | `green-shadow` | `0.5` |
| `dbx-demo-worker` | `127.0.0.1:19004` | `default` | `1` |

脚本使用 v1 Naming API。不要在同一服务中用同一 `IP:端口` 注册不同集群：Nacos v2 会覆盖已有实例。

## 7. v2 手工验收步骤

先准备变量：

```bash
BASE='http://127.0.0.1:8849/nacos'
NS='public'
```

### 7.1 服务列表与跨分组

1. DBX 服务页清空服务名、分组，点击“加载”。
2. 应看到 `DBX_TEST` 下的两个脚本服务。
3. 输入服务名、分组分别筛选；清空分组后仍可跨分组列出非空服务。
4. API 复核：

```bash
curl --noproxy '*' -sS -G "$BASE/v1/ns/catalog/services" \
  --data-urlencode "namespaceId=$NS" \
  --data-urlencode 'pageNo=1' \
  --data-urlencode 'pageSize=100' | jq
```

### 7.2 集群过滤

1. 选中 `dbx-demo-api`。
2. 在右侧“筛选实例集群”输入 `blue`，点击“筛选”。
3. 只应显示 `blue` 实例；点击“清除”后恢复全部实例。

### 7.3 服务创建与编辑

创建一个隔离服务：

```text
服务名：dbx-ui-crud
分组：DBX_E2E
保护阈值：0.5
元数据：{"owner":"dbx-ui","scenario":"service-crud"}
选择器：留空
```

创建空服务后马上注册实例，否则 Nacos 可能在约一分钟后自动清理空服务。编辑服务后可用：

```bash
curl --noproxy '*' -sS -G "$BASE/v1/ns/service" \
  --data-urlencode "namespaceId=$NS" \
  --data-urlencode 'groupName=DBX_E2E' \
  --data-urlencode 'serviceName=dbx-ui-crud' | jq
```

核验元数据、`protectThreshold`、选择器。

### 7.4 实例注册、权重与元数据

在 `dbx-ui-crud` 中注册持久实例：

```text
IP：127.0.0.1
端口：19101
集群：manual
权重：1
元数据：{"source":"dbx-ui","role":"manual-test"}
```

修改权重并点“保存”后，用下列命令复核（服务详情接口不会展示权重）：

```bash
curl --noproxy '*' -sS -G "$BASE/v1/ns/catalog/instances" \
  --data-urlencode "namespaceId=$NS" \
  --data-urlencode 'serviceName=DBX_E2E@@dbx-ui-crud' \
  --data-urlencode 'clusterName=manual' \
  --data-urlencode 'pageNo=1' \
  --data-urlencode 'pageSize=100' | jq '.list[] | {ip, port, clusterName, weight, healthy, enabled, metadata}'
```

### 7.5 禁用实例回归

1. 对 `dbx-ui-crud` 的手工实例点击“禁用”，确认操作。
2. 点击“刷新”。
3. 预期：卡片仍存在，状态为“已下线”，操作按钮为“启用”和“编辑”。
4. 用上节 Catalog 命令复核 `enabled: false`。
5. 点击“启用”并刷新，预期恢复 `enabled: true`。

普通 Naming 查询可用于说明差异：

```bash
curl --noproxy '*' -sS -G "$BASE/v1/ns/instance/list" \
  --data-urlencode "namespaceId=$NS" \
  --data-urlencode 'groupName=DBX_E2E' \
  --data-urlencode 'serviceName=dbx-ui-crud' | jq
```

禁用时这里可能返回空 `hosts`，这是 Nacos Naming 消费视图的行为，不能用于管理页枚举。

### 7.6 删除保护与外部同步

- 服务仍有实例时点击删除：DBX 应拒绝删除。
- 注销实例后立即删除服务：服务应消失。
- 使用 curl 或官方 Nacos 控制台外部注册/修改实例后，DBX 点击“加载/刷新”应同步显示最终状态。
- 服务、实例切换和筛选快速连续执行时，最终 UI 必须对应最后一次操作。

## 8. 已执行的自动验证

本轮已经通过：

```bash
pnpm typecheck
git diff --check
env GO111MODULE=off go test ./tmp
cargo test -p dbx-core v2_service_list_
cargo test -p dbx-core 'v2_'
cargo test -p dbx-core filters_instance_list_when_nacos_ignores_cluster_parameter
cargo test -p dbx-core v2_instance_list_uses_catalog_and_keeps_disabled_instances
```

Rust 中已覆盖：跨分组服务列表、指定分组空服务回退、v2 通过 v1 写实例、v2 Catalog 仍返回禁用实例、Nacos 忽略集群参数时 DBX 本地过滤。

## 9. 尚待继续的事项

1. **v3 真实环境验收**：验证 `/v3/admin/ns/...` 服务、实例的读写路径；确认 DBX 连接填写 `8818/nacos`，不是 `8010`。
2. **r-nacos 真实环境验收**：验证能力矩阵是否正确禁用未支持的写操作，并且 UI 有明确说明。
3. **国际化**：本轮新增服务管理 UI 为便于当前中文验收，部分文案直接写为中文；用户要求功能稳定后再统一补齐其他语言。
4. **测试脚本纳管**：`tmp/nacos-test-services.go` 目前被忽略，交付前应移动或强制加入版本控制。
5. **完整构建/CI**：当前通过了定向 Rust 测试与前端类型检查；提交前按仓库标准执行完整构建、测试和 CI。
6. **后续增强（明确不在当前两期）**：v3 健康检查器管理、订阅者/客户端诊断、全量批量元数据治理；Raw API 可作为高级兜底。

## 10. 下一次继续开发的建议顺序

1. 重启本地 DBX，先手工确认最新两项 UI：保护阈值可输入 `0.5`；展开元数据时权重不跳动。
2. 完成上面的 v2 验收矩阵，记录异常接口响应。
3. 对 Nacos v3 做相同的服务创建、实例注册、权重修改、禁用/启用、删除非空服务验证。
4. 再验证 r-nacos 的只读/能力降级边界。
5. 清理和整理改动、将测试脚本纳管、补国际化，最后提交 PR。
