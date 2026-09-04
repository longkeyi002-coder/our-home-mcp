# GPT Life Runtime / Our Home — Rebuild V0.1

> **本文件是 `rebuild/gpt-life-runtime-v01` 分支唯一的项目入口与规划书。**
>
> 旧 README、旧 PR、旧实验分支和旧文档全部视为“参考资料”，不再作为新开发的需求来源。新开发人员先读完本文件，再开始写代码。

## 0. 当前决定

这个项目过去同时尝试了：Android 上报、Life State、Wake Engine、Hermes Activation、FCM、Local MCP、反向 WebSocket、Cloudflare Relay、GPT 调试页、Usage Timeline 等多条路线，技术上积累了很多可复用部件，但产品目标和连接方式混在一起，已经不适合继续在原分支上堆功能。

因此从现在开始：

- `main`：保留为旧稳定基线，不直接继续堆新需求。
- `codex/phone-reality-local-mode`：保留为实验/参考分支，不再作为主开发线。
- `rebuild/gpt-life-runtime-v01`：**新的唯一开发线**。
- 不删除旧分支，不 force-push，不清历史；旧代码只在需要时有选择地移植。

新项目先把“大脑”抽象为可替换的 `BrainAdapter`：

1. 开发期先支持 `manual-debug` / GPT 调试工作流；
2. 如果后续决定使用 GPT API，则增加 `OpenAI/GPT BrainAdapter`；
3. 最终可以切换成 `Hermes BrainAdapter`；
4. Android、Life State、Wake Engine、通知与 Thought Thread 不因换大脑而重写。

---

# 1. 产品到底是什么

一句话定义：

> **这是一个让 AI 拥有“手机感知、持续生活状态、事件唤醒、主动通知和自己的未完成事情”的 Life Runtime。Android 是身体，Runtime 是生命维持层，GPT/Hermes 是可替换的大脑。**

不是：

- 普通聊天 App；
- 手机 Dashboard；
- 单纯 MCP Server；
- 单纯反向隧道工具；
- 每分钟调用一次大模型的 Cron；
- 把所有手机原始数据不停上传给模型。

用户最终应该感受到：

```text
手机持续低成本感知
        ↓
Runtime 维护 Life State
        ↓
发生“值得注意”的变化
        ↓
Wake Engine 生成 Wake Event
        ↓
BrainAdapter 被唤醒
        ↓
AI 决定：忽略 / 记住 / 继续想 / 主动联系
        ↓
Thought Thread 被更新
        ↓
必要时给 Android 发通知或执行安全动作
```

核心原则：

> **不要用大模型维持生命。用 Runtime 维持生命，用大模型产生思想。**

---

# 2. 当前仓库里已经有什么

## 2.1 `main` 可作为稳定参考的能力

`main` 当前包含这些已经形成基本结构的模块：

- `LifeObservation`
- `LifeState`
- `WakeEvent`
- `WakeDecision`
- 独立 `Life Loop / worker`
- Hermes Decision Engine 适配器
- FCM 通知发送
- Android Companion 基础采集
- Usage Timeline
- Phone register / heartbeat / observations HTTP API
- MCP tools
- JSON Store 原型

这些概念仍然有效，但新开发不要求保留旧文件结构。

## 2.2 `codex/phone-reality-local-mode` 中值得复用的实验成果

这个实验分支在 `main` 之上增加了大量 Android/Relay 代码，当前约 69 个提交领先于 `main`。其中有价值的部分包括：

- `android-companion/.../platform/UsageTimeline.kt`
- `android-companion/.../local/LocalMcpServer.kt`
- `android-companion/.../tunnel/RelayProtocol.kt`
- `android-companion/.../tunnel/ReverseTunnelService.kt`
- `android-companion/.../CompanionProductState.kt`
- `android-companion/.../CompanionDashboardActivity.kt`
- `src/phone-relay.ts`
- `test/phone-relay.test.ts`
- `test/active-device.test.ts`
- `test/runtime-reliability.test.ts`

这些代码要“阅读后有选择地移植”，不要整体复制实验分支。

## 2.3 真机已经验证过什么

2026-09-04 的真机 GPT Diagnostic Report 已确认：

- Android Local MCP `:5000` 可启动；
- MCP `initialize` 成功；
- `notifications/initialized` 返回 202；
- `tools/list` 成功；
- `get_local_health` 成功；
- `get_device_context` 成功；
- `get_current_usage` 成功；
- Usage Access 已授权；
- 通知权限已授权；
- 手机网络正常；
- Android 到远端 Relay 的 WebSocket 真实 `onOpen` 成功；
- 测试通知可以在手机显示。

这说明“手机内部能力”和“手机主动连出到 Relay”两部分是可行的。

**尚未被这个报告证明：**

- 当前 ChatGPT 对话能主动读取手机；
- 远端 GPT/Hermes → Relay → Android → Local MCP → 返回 的完整 round-trip；
- 手机状态变化会自动生成 Wake Event 并真正唤醒大脑；
- 大脑产生的主动决定能完整走到用户手机；
- Thought Thread 已实现。

---

# 3. 新架构：只保留一条主链

## 3.1 总体架构

```text
┌──────────────────────── Android Companion ────────────────────────┐
│ Battery / Charging / Network / Usage / Foreground App            │
│ Permission State / Local Diagnostics                             │
│                                                                  │
│ A. Telemetry: HTTPS → Runtime                                    │
│ B. Control:   WSS outbound → Relay（仅需要实时读取/动作时）       │
│ C. Delivery:  FCM / system notification                          │
└──────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────── Life Runtime ─────────────────────────────┐
│ Device Registry                                                   │
│ Observation Ingest                                                │
│ Life State Reducer                                                │
│ Wake Engine                                                       │
│ Thought Thread Store                                              │
│ Action / Notification Queue                                       │
│ Diagnostics / Event Trace                                         │
│                                                                  │
│              BrainAdapter interface                               │
└──────────────────────────────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     Manual Debug     GPT Adapter    Hermes Adapter
      （开发期）       （可选）        （最终可切）
```

## 3.2 三条数据通道必须分开

### Telemetry Plane — 手机主动上报

用途：让 Runtime 持续知道“用户生活正在发生什么”。

手机只上传摘要：

- battery
- charging
- connectivity
- foreground package
- usage session summary
- screen/idle presence（如系统允许且用户授权）
- 后续 location state / calendar summary

不要默认上传：

- 截图；
- 键盘内容；
- 聊天正文；
- 通知正文；
- Accessibility 原始事件流；
- 高频秒级历史。

### Control Plane — 远端实时调用手机

用途：AI 在需要时读取最新设备状态，或执行一个明确、安全、可审计的手机动作。

建议继续使用：

```text
Android outbound WSS → Relay → Local MCP
```

原因：

- 手机不需要暴露 5000 端口；
- 不依赖家庭公网 IP；
- NAT 下也能工作；
- 适合实时 `get_device_context` / `send_local_notification` / 后续 `open_url`。

### Delivery Plane — AI 主动联系用户

首选：

```text
Runtime → FCM → Android system notification
```

通知与 Control Plane 不耦合。WebSocket 临时断开时，主动通知仍然可以通过 FCM 发送。

---

# 4. BrainAdapter：不要再把系统绑死在 Hermes 或 ChatGPT

统一接口建议：

```ts
interface BrainAdapter {
  evaluate(input: BrainInput): Promise<BrainDecision>
}
```

`BrainInput` 至少包含：

- `wakeEvent`
- 当前 `lifeState`
- 最近重要 observations
- 用户 routines
- `thoughtThread`
- 最近主动消息与冷却状态
- 当前时间 / quiet hours

`BrainDecision` V0.1：

```ts
type BrainDecision =
  | { action: "ignore"; reason?: string }
  | { action: "remember"; memory: StructuredMemory }
  | { action: "continue_thought"; thread: ThoughtThreadUpdate }
  | { action: "notify"; title: string; message: string; reason: string }
```

注意：

- 不保存模型隐藏 Chain-of-Thought；
- 只保存结构化、可展示的意图、任务、结论、等待事项；
- BrainAdapter 失败不能丢 Wake Event；应保持 pending 并可重试；
- 同一 Wake Event 必须幂等，不能生成重复通知。

---

# 5. Thought Thread：AI 的“虚拟生活”

用户要的“AI 有自己的生活”不能靠无限聊天上下文实现。

需要一个明确的持久化结构：

```ts
interface ThoughtThreadItem {
  id: string
  kind: "task" | "question" | "plan" | "waiting" | "idea"
  title: string
  summary: string
  status: "open" | "waiting" | "done" | "dropped"
  createdAt: string
  updatedAt: string
  nextReviewAt?: string
  relatedWakeEventIds: string[]
}
```

例如：

```text
正在做：
- 等她结束长时间使用手机后再问是否要休息

等待：
- 用户稍后回复昨天提到的旅行计划

想继续研究：
- 如何降低夜间连续刷手机的频率
```

这才是可持续的“虚拟生活”。

**禁止把模型私有推理过程或完整思维链存下来。**

---

# 6. 数据模型 V0.1

重建时建议收敛成下面几个核心实体。

## Device

```text
deviceId
platform
appVersion
credentialHash
pushToken
lastSeenAt
status
```

## Observation

```text
id
deviceId
kind
observedAt
source
confidence
value / metadata
expiresAt
clientEventId
```

## LifeState

```text
observedAt
activeDeviceId
lastPhoneActivityAt
devicePresence
foregroundPackage
batteryPercent
charging
connectivity
currentActivity
confidence
reasons[]
```

## WakeEvent

```text
id
type
priority
status
observedAt
reason
dedupeKey
previousLifeState
lifeState
attempts
lastError
```

## ThoughtThreadItem

见上一节。

## ActionRequest

```text
id
type
status
createdAt
dueAt
payload
requiresApproval
result
```

## DiagnosticSnapshot

```text
appVersion
deviceId
permissions
localMcp
telemetry
websocket
push
lastError
selfTest[]
createdAt
```

---

# 7. 存储与资源预算

服务器资源有限，V0.1 不做“大数据平台”。

建议：

- 原始 phone observations：保留 72 小时；
- usage session 明细：保留 14 天；
- 14 天前 usage 做小时级聚合；
- Wake Event：保留 30～90 天；
- Thought Thread：长期保留，但只存结构化摘要；
- debug logs：7 天；
- 不存截图缓存；
- 不在服务器运行本地大模型；
- 不做 embeddings/vector DB，除非以后真实需要。

新实现优先 SQLite WAL，而不是继续扩大单个 JSON 文件。

要求：

- 单进程写入或明确事务；
- 进程 crash 后可恢复；
- schema migration 可测试；
- 不把 token/private key 放数据库日志。

---

# 8. Android Companion V0.1 产品界面

Android 不应再是“隧道配置器”。

首页只回答四个问题。

## 8.1 AI 有没有连上我

```text
AI 连接
Runtime       已连接 / 未连接
实时桥接      已连接 / 正在重连 / 未启用
最后通信      8 秒前
```

不要把“WebSocket onOpen”直接写成“GPT 已连接”。

连接状态必须分层显示。

## 8.2 AI 现在知道我什么

```text
电量           84%
充电           否
网络           在线
当前 App       ChatGPT
本次使用       13 分钟
今天屏幕使用   4 小时 2 分
```

只显示真实读取的数据。

## 8.3 AI 最近做了什么

```text
12:10 读取设备状态
12:08 Wake Engine 发现长期活跃
12:08 AI 决定暂不打扰
11:45 发送了一条主动通知
```

每一项来自真实 Event Trace，不生成假日志。

## 8.4 AI 自己正在做什么

显示 Thought Thread：

```text
正在考虑  1
等待事情  2
开放计划  1
```

用户可进入查看结构化条目。

## 8.5 Diagnostics

继续保留已经验证有用的：

```text
运行完整检测
复制检测报告
分享检测报告
```

报告至少检查：

- Local MCP
- permissions
- usage
- network
- telemetry ingest
- WSS relay
- push notification
- last runtime exchange

报告不包含完整 credential/token。

---

# 9. V0.1 功能边界

## 必须做

- Battery / charging / connectivity sensing
- Usage Access onboarding
- Foreground App / Usage Timeline
- HTTP telemetry ingest
- Device registration + per-device credential
- Life State reducer
- Wake Engine
- Thought Thread 数据结构
- BrainAdapter 抽象
- 一个可测试的 Mock/Manual BrainAdapter
- FCM proactive notification
- Local MCP
- outbound WSS relay
- end-to-end diagnostics
- App 首页状态展示

## 暂缓

- GPS 精确轨迹
- 屏幕截图
- OCR
- Accessibility 自动点击
- 任意坐标点击
- 读取聊天内容
- 电话/短信自动发送
- 自动购物/支付
- 完整日历写入

## V0.2 再考虑

- 粗粒度 location state：home / away / commute
- Calendar summary
- `open_app`
- `open_url`
- 用户批准后的有限动作
- 更完整的 AI personal tasks

---

# 10. 开发阶段与验收

## Phase 0 — Clean Foundation

目标：先把代码结构整理清楚。

建议目录：

```text
runtime/
  domain/
  store/
  ingest/
  wake/
  brain/
  notification/
  relay/
  diagnostics/
android-companion/
  sensing/
  transport/
  local-mcp/
  ui/
  diagnostics/
test/
```

验收：

- `npm run check` 全绿；
- Android unit tests + `assembleDebug` + lint 全绿；
- 无硬编码公网 token；
- 无生产签名密钥进入仓库。

## Phase 1 — Phone → Runtime

目标：手机自动上报，Runtime 真正知道手机状态。

验收：

```text
打开 App
→ 授权
→ 产生 usage / battery observation
→ Runtime 收到
→ Device lastSeen 更新
→ App 显示“最近同步”
```

用户不需要点“上传”。

## Phase 2 — Life State + Wake Engine

目标：原始观测转换为少量、有意义的状态变化。

至少覆盖：

- became_active
- became_idle
- charging_started
- battery_low
- device_offline
- long_usage_session（新）

验收：相同状态不能重复产生无限 Wake Event。

## Phase 3 — BrainAdapter + Thought Thread

先实现 Mock/Manual BrainAdapter：

- 可以稳定返回 ignore / notify / update thought；
- 可测试；
- 不依赖真实 GPT/Hermes。

然后再接 GPT 或 Hermes。

验收：

```text
Wake Event
→ BrainAdapter
→ Decision
→ Wake Event handled
→ Thought Thread 更新
```

失败时 event 保持可重试。

## Phase 4 — Proactive Notification

目标：AI 可以真正主动出现在手机上。

验收：

```text
真实 phone event
→ Life State
→ Wake Event
→ Brain Decision notify
→ FCM
→ Android notification
→ Event Trace 全链路可见
```

这是 V0.1 最重要的 E2E 验收。

## Phase 5 — Remote Phone Read

目标：远端真正读取手机，而不是手机自己测试自己。

验收：

```text
remote client
→ Relay :8790/mcp
→ Android WSS
→ Local MCP :5000
→ get_device_context
→ response 返回 remote client
```

App 同时记录：

```text
收到远端调用
执行 get_device_context
返回成功
```

## Phase 6 — GPT / Hermes Brain

到这一步才接真实大脑。

必须遵守：

- adapter 可替换；
- Runtime 不依赖某个模型 provider；
- provider 超时不破坏 Life State；
- provider 失败不重复通知；
- token 使用量有上限。

最终切 Hermes 时，只替换 BrainAdapter，不重写 Android。

---

# 11. 从旧实验分支移植什么

## 可以优先移植

### Android

- Usage Timeline tracker
- Local MCP server
- Relay protocol
- ReverseTunnelService 的连接/指数退避思路
- Boot recovery
- ProductState / real activity logging
- GPT Diagnostic Report 的 copy/share UX
- notification test

### Runtime

- Life State reducer
- Wake Engine / dedupe
- atomic WakeDecision handling
- notifier retry semantics
- FCM sender
- phone relay 的 bounded in-flight / timeout
- active device isolation tests
- runtime non-reentrant cycle tests

## 不要原样带入新主线

- 硬编码 TryCloudflare hostname
- 硬编码 tunnel token
- 固定 deviceId
- query-string 长期 credential
- 仓库内 prototype debug keystore 作为正式方案
- “连接 WebSocket = GPT 已连接”的产品状态
- MainActivity / Dashboard 两套重叠 UI
- Cloud / Local 两套互相打架的模式开关
- 为了调试临时增加但没有产品意义的按钮

---

# 12. 网络与凭据策略

## 开发期

可以继续使用临时 Relay 做 smoke，但 APK 中不要再写死长期 token。

建议注册流程：

```text
首次安装
→ 用户确认配对
→ POST /v1/device/register
→ Runtime 返回 device credential
→ Android Keystore 保存
→ 后续自动认证
```

Credential 必须支持：

- rotate
- revoke
- lastUsedAt
- per-device scope

## 正式公网

- 使用固定域名 / Named Tunnel 或正常 TLS 域名；
- Quick Tunnel 只用于临时测试；
- Relay 内网端口不直接暴露；
- 手机始终主动连出；
- 服务端 credential 不写进 App 源码。

---

# 13. 安全与真实性规则

1. `REALITY` 只能来自真实系统读取或用户明确声明。
2. AI 推测必须标记 inferred，不可以冒充 observed。
3. 不做静默权限升级。
4. 不自动授予 Usage Access / Accessibility。
5. 敏感动作必须可审批、可撤销、可审计。
6. 不把 Tunnel Token、FCM service account、API key、正式 signing key 提交 Git。
7. Diagnostic Report 默认脱敏。
8. App 页面只展示真实能力；未实现就明确写“未实现”。

---

# 14. 测试清单

## Runtime

- Observation schema
- duplicate clientEventId
- active device isolation
- stale foreground
- usage retention/compaction
- Wake dedupe
- Wake retry
- BrainAdapter timeout
- Brain invalid response
- notification retry
- idempotent delivery
- store restart recovery
- concurrent cycle protection

## Android

- Usage Access denied/granted
- notification denied/granted
- Local MCP start/stop
- initialize
- notifications/initialized
- tools/list
- get_device_context
- get_current_usage
- WSS reconnect
- process death
- reboot recovery
- copy diagnostic report
- share diagnostic report

## E2E

必须有一条自动/半自动 smoke：

```text
Android observation
→ Runtime
→ LifeState
→ WakeEvent
→ BrainAdapter
→ ProactiveCandidate
→ FCM
→ Android notification
```

另有一条：

```text
Remote MCP call
→ Relay
→ Android
→ Local MCP
→ response
```

这两条都通过，才可以说“系统跑通”。

---

# 15. 旧 GitHub 内容怎么处理

为了不丢历史，本次不删除任何旧分支。

当前分支角色：

| 分支 | 角色 |
|---|---|
| `main` | 旧稳定基线 / 参考 |
| `rebuild/gpt-life-runtime-v01` | **唯一新开发线** |
| `codex/phone-reality-local-mode` | Android Local MCP / Relay / GPT Diagnostics 实验参考 |
| `codex/android-reverse-tunnel-v01` | 旧 reverse tunnel 历史参考 |
| `codex/usage-access-onboarding` | 旧 Usage Access 历史参考 |
| `feature/android-companion-v0.2-auto-heartbeat` | 旧自动上报实验参考 |
| `fix/runtime-reliability-audit` | 旧 reliability 实验参考 |
| `build/android-apk` | 构建历史参考 |

新开发人员不要在这些旧分支继续加功能。

PR #9 也只作为旧实验集成的历史参考，不应继续扩大需求。

---

# 16. 新开发人员的执行规则

1. **只在 `rebuild/gpt-life-runtime-v01` 开发。**
2. 第一步先阅读旧代码，不立刻复制。
3. 每次只完成一个 Phase 的一个明确能力。
4. 小 commit，不做一次性巨大重构。
5. 每个真实能力必须有可观察状态或测试。
6. 不因为 UI 显示“Connected”就当 E2E 成功。
7. 不删除旧历史。
8. 不修改 `main`，直到一个 Phase 完整验收后再决定是否 PR。
9. Node 改动后必须 `npm run check`。
10. Android 改动后必须运行 unit tests、assembleDebug、lint。

---

# 17. 下一位开发者可以直接使用的任务说明

复制下面这段即可开始：

```text
继续开发 longkeyi002-coder/our-home-mcp。

唯一工作分支：rebuild/gpt-life-runtime-v01
唯一需求来源：该分支根目录 README.md

不要继续扩展旧 PR #9，也不要修改 main、删除历史分支或 force-push。

先完成 Phase 0：Clean Foundation。

目标：
1. 阅读 main 与 codex/phone-reality-local-mode 中可复用实现。
2. 设计新的 runtime / android 模块边界，消除 Cloud/Local/Relay/UI 重叠职责。
3. 保留并移植：Life State、Wake Engine、Usage Timeline、Local MCP、Relay protocol、FCM、diagnostics 的可靠部分。
4. 不移植硬编码 Quick Tunnel、token、固定 device ID、正式用途 debug keystore、重复 UI。
5. 优先改为 SQLite WAL 持久化抽象，保留清晰 migration/test 边界。
6. 保证 npm run check 全绿。
7. 保证 Android unit tests + assembleDebug + lint 全绿。
8. 完成后提交小而清晰的 commits，并报告：改了什么、测试结果、下一阶段阻塞。

不要提前做位置、截图、Accessibility、手机自动点击。
```

---

# 18. V0.1 最终完成定义

只有下面这条链真正跑通，V0.1 才算完成：

```text
用户正常使用手机
        ↓
Android 自动产生真实 Observation
        ↓
Runtime 收到并维护 Life State
        ↓
发生有意义的变化
        ↓
Wake Engine 生成唯一 Wake Event
        ↓
BrainAdapter 被唤醒
        ↓
更新 Thought Thread
        ↓
决定是否主动联系用户
        ↓
FCM 通知送达 Android
        ↓
App 能显示完整真实事件记录
```

同时还必须具备：

```text
Remote client
→ Relay
→ Android WebSocket
→ Local MCP
→ 实时读取设备状态
→ 返回 Remote client
```

达到这里后，大脑从 GPT 换成 Hermes，只应该是“更换 Adapter”，而不是重新做一遍整个系统。
