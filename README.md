# Our Home MCP

独立的 Our Home 生活系统 MCP 和 Life Loop，既可以供 Hermes Agent 调用，也可以独立运行。它不修改 Hermes 核心，也不包含前端。

当前版本使用本地 JSON 数据层，目的是先固定 MCP 工具契约、持续上下文和数据真实性边界。真实 Home Backend 接入后，可以替换 `JsonStore`，不需要改变 Hermes 侧工具名称。

## 重要边界

MCP 是工具接口；它本身不会凭空产生意识，也不会在没有进程运行时唤醒 AI。当前 V0.1 的 Cloud Runtime 由**一个 Node 进程**同时拥有 HTTP/MCP transport、`JsonStore` 和 Life Loop；Life Loop 只在 `OUR_HOME_RUN_WORKER=true` 时启用。这样避免 HTTP ingestion 与另一个 worker 进程各自持有 JSON 副本并互相覆盖。

Life Loop 能投递“已经生成的主动消息候选”，并可在 Wake Event 出现时按配置调用 Hermes。它不会凭空推断你在做什么；手机状态、屏幕使用情况、日历和天气必须由明确的数据适配器写入 observation，并带来源与置信级别。

## Android Companion

仓库内的 android-companion/ 是 Android Companion V0.1：

Android Companion → Public Hermes API → Life State → Life Loop → AI

它使用 BatteryManager、ConnectivityManager 和用户主动授予的 Usage Access，仅上报电量、充电状态、网络状态、前台 package 摘要、usage summary 和手动状态。事件先写入 Room，再由 WorkManager 上传；成功 ACK 后删除，网络失败则保留并指数退避重试。详见 android-companion/README.md。

## 能力

读取：

- `home.get_today`
- `home.get_status`
- `home.get_life_context`
- `home.get_runtime_diagnostics`
- `home.record_observation`
- `home.list_observations`
- `home.add_routine`
- `home.list_routines`
- `home.list_diary`
- `home.list_messages`
- `home.list_actions`
- `home.list_relationship_events`
- `home.list_activity`

写入：

- `home.write_diary`
- `home.leave_message`
- `home.schedule_proactive_message`
- `home.list_proactive_messages`
- `home.dismiss_proactive_message`
- `home.create_action`
- `home.update_action`
- `home.propose_relationship_event`
- `home.approve_relationship_event`
- `home.mark_message_read`

所有返回都带 `dataSource: local-mock`。示例数据不是 Hermes 真实活动，关系提案在批准前也不是已确认事实。

## 安装与检查

```bash
npm install
npm run check
```

## Cloud Runtime + Life Loop（单进程）

构建后，使用一个长期运行的 Runtime 进程同时承载 HTTP/MCP、手机 ingestion、JSON Store 和 Life Loop：

```bash
npm run build
OUR_HOME_DATA_FILE=./data/our-home.json \
OUR_HOME_WORKER_INTERVAL_MS=60000 \
OUR_HOME_RUN_WORKER=true \
npm run start:runtime
```

`npm run worker` 为兼容旧启动命令保留，但现在同样启动这个**整合 Runtime**，不再创建一个独立 worker-owned `JsonStore`。不要再同时运行一个 `start:http` 进程和另一个 `worker` 进程指向同一个 JSON 文件。

Life Loop 每轮记录心跳、读取生活上下文、可选地调用决策适配器生成候选、查找已到期候选并交给通知适配器。下一轮只会在上一轮完整结束后再调度，避免慢 Hermes/网络调用造成重入。`OUR_HOME_OUTBOUND_TIMEOUT_MS` 控制 Hermes、Webhook 与 FCM 出站请求超时，默认 30000ms。

### Hermes Life Runtime

先在 Hermes 的 `~/.hermes/.env` 启用公开 API Server 并设置 `API_SERVER_KEY`，启动 `hermes gateway`。如需让 agent turn 使用 Our Home tools，另在 Hermes 侧连接本仓库 MCP。然后启动 Runtime：

```bash
OUR_HOME_HERMES_API_URL='http://127.0.0.1:8642' \
OUR_HOME_HERMES_API_KEY='same-as-API_SERVER_KEY' \
OUR_HOME_HERMES_CONVERSATION='our-home-life-runtime' \
OUR_HOME_RUN_WORKER=true \
npm run dev:worker
```

Runtime 使用 Hermes 的公开 `POST /v1/responses`，默认模型为 `hermes-agent`，默认 named conversation 为 `our-home-life-runtime`；可分别用 `OUR_HOME_HERMES_MODEL` 和 `OUR_HOME_HERMES_CONVERSATION` 覆盖。固定 conversation 由 Hermes 在 Life Loop cycle 和 Runtime 重启之间自动续接。API key 只从环境变量读取，不写入数据文件或日志。

Hermes 配置完整时优先于旧 decision webhook；否则若配置 `OUR_HOME_DECISION_WEBHOOK_URL`，Runtime 使用原有 webhook；两者都没有时不消费 pending Wake Event。同一个 event 不会同时调用两个 Decision Engine。Hermes 调用、认证、超时、响应解析或 contract 校验失败时，event 保持 pending，供下一个 cycle 重试。

最小 smoke test：启动 Hermes gateway，以上述环境变量运行 Runtime；写入一个会产生 Wake Event 的 observation，确认 Hermes 日志出现 `/v1/responses` turn，并检查数据文件中该 event 变为 `handled`（或失败时仍为 `pending`）。Hermes 必须返回纯 `WakeDecision` V0.1 JSON。

旧 webhook 仍可用：配置 `OUR_HOME_DECISION_WEBHOOK_URL` 后，Runtime 会 POST `{ wakeEvent, context }`，服务返回现有 `WakeDecision` V0.1。返回内容经过 schema 校验，并通过原子的 `applyWakeDecision()` 进入主动消息队列或忽略该 event。

通知选择顺序是：`OUR_HOME_FIREBASE_PROJECT_ID` 与 `GOOGLE_APPLICATION_CREDENTIALS` 都存在时使用 FCM HTTP v1；否则回退到 webhook；两者都未配置时使用 noop，候选消息保持 `pending` 并在下一 cycle 重试。`GOOGLE_APPLICATION_CREDENTIALS` 只能指向运行环境中的 service-account 文件，不要把 JSON、private key 或 access token 放进仓库、数据文件或日志。

V0.1 只向 `activePhoneDeviceId` 对应且带 `pushToken` 的 Android Companion 投递 FCM；旧 registration 保留历史，但不会作为当前投递目标。配置 webhook 的示例：

```bash
OUR_HOME_NOTIFY_WEBHOOK_URL='https://your-notifier.example/webhook' \
OUR_HOME_NOTIFY_WEBHOOK_TOKEN='optional-token' \
OUR_HOME_RUN_WORKER=true \
npm run dev:worker
```

发送出去的事件类型是 `our_home.proactive_message`。它是通用 Webhook，不绑定 Telegram、微信或其他具体渠道；后续可以单独增加手机通知适配器。

手机端可以通过受保护的 HTTP API 上报状态：

首次安装先注册设备（注册需要同一个 `OUR_HOME_INGEST_TOKEN`）：

```http
POST /v1/phone/register
Authorization: Bearer <OUR_HOME_INGEST_TOKEN>
Content-Type: application/json

{"deviceId":"android-main","appVersion":"0.1.0","pushFid":"firebase-installation-id","pushToken":"fcm-registration-token"}
```

服务端返回设备 token；Android Companion 将其保存到 Android Keystore，之后用设备 token 调用下面两个 endpoint。同一 `deviceId` 再注册会更新现有 push address，不会增加重复设备。

```http
POST /v1/phone/heartbeat
Authorization: Bearer <DEVICE_TOKEN>
Content-Type: application/json

{"deviceId":"android-main","status":"screen_on","batteryPercent":82}
```

Android Companion V0.1 还会发送 charging、appVersion、connectivityState、foregroundPackage、observedAt 和 clientEventId 字段。周期 app usage 统一通过 `usage_summary` 上报；尚未启用的 `app_timeline` / `steps` 发送路径已移除，避免 Android 与 Runtime observation contract 漂移。

也可以批量上报 `POST /v1/observations`，例如 `screen_app`、`device_presence` 或 `calendar`。服务端会强制把这些记录标为 `source=phone`、`confidence=observed`，不会接受手机端把它们伪装成其他来源。

## 给 Hermes 使用：stdio

stdio 是本机 Hermes 最简单的方式：MCP 作为独立子进程运行。**不要让 stdio 进程与另一个 Cloud Runtime 进程同时写同一个 JSON data file。** 当前 JSON Store 只适合作为单进程 V0.1 原型；V1.0 将替换为可靠数据库。

```bash
npm run build
```

在 Hermes 的 MCP 配置中添加类似配置：

```json
{
  "name": "our-home",
  "command": "node",
  "args": ["/absolute/path/to/our-home-mcp/dist/index.js"],
  "env": {
    "OUR_HOME_DATA_FILE": "/absolute/path/to/our-home-data.json"
  }
}
```

## 给 Hermes 使用：Streamable HTTP

HTTP 模式适合 MCP 与 Hermes 不在同一进程或未来部署为独立服务：

```bash
OUR_HOME_MCP_TRANSPORT=http \
OUR_HOME_MCP_TOKEN='replace-with-a-long-random-token' \
OUR_HOME_MCP_HOST=127.0.0.1 \
npm run dev
```

地址：`http://127.0.0.1:8787/mcp`

进程检查地址：`http://127.0.0.1:8787/healthz`

如果绑定到非本机地址，服务会强制要求 `OUR_HOME_MCP_TOKEN`；生产环境还应放在 HTTPS 或受保护的反向代理后面。不要把个人生活数据服务裸露到公网。

默认不开放跨域；只有浏览器客户端确实需要调用时，才设置 `OUR_HOME_MCP_CORS_ORIGIN`。

当前 Token 是服务级别的共享密钥，不是完整的用户级鉴权；在接入真实个人数据或公网部署前，必须再增加用户身份、权限范围和写入审批。当前 device token 仍是 V0.1 凭据模型，单设备 revoke/rotate 将作为下一项安全加固完成。

## 数据边界

- `REALITY` 只能由真实系统适配器写入；当前没有 REALITY 适配器。
- Agent 日记和主动留言是 `AGENT_LIFE`。
- 关系事件包含 `proposedBy`、`approvedBy`、`approvalStatus`。
- 家的 Presence 当前是 `HOME_STATE`，无真实数据时使用 `unknown` 或 `waiting`。
- Hermes Memory 不替代结构化日记、关系事件和行动数据。

## 后续替换点

1. 用 SQLite/Postgres 等可靠持久化层替换 `src/store.ts` 的 `JsonStore`。
2. 增加 Hermes 事件只读适配器，将 Tool Call、Session、任务活动归类为 `REALITY`。
3. 给写工具增加用户级鉴权和更细粒度审批，并完善 device credential revoke/rotate。
4. 再决定是否加入 MCP Apps UI；当前不需要可视化组件。

<!-- test push from Hermes Agent v0.21.0 -->
