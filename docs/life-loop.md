# Our Home Life Loop — Roadmap V2

## 核心模型

Our Home Runtime 负责**持续保存、整理和验证状态**；Hermes 不是常驻采集器，而是在发生明确的 Wake Event、用户真实对话或需要决策时按需唤醒。

```text
Phone facts / user declarations
          ↓
Local MCP or Cloud Runtime
          ↓
Persistent observations + Life State
          ↓
Wake Event (only when a transition is meaningful)
          ↓
Hermes activation on demand
          ↓
WakeDecision candidate
          ↓
Configured notification delivery
```

这不是“AI 一直醒着观察用户”。Runtime 可以持续运行和重试；没有足够事实、没有 Wake Event 或没有用户对话时，Hermes 不需要被调用。

## 事实、推断与表达

- **事实（observation）**：由手机、日历或用户明确提供；必须保存 source、deviceId、observedAt 和 confidence。
- **Life State**：对当前有效事实的受限聚合，例如“最近有前台 App”或“设备报告充电”。它不是情绪、睡眠、姿势或意图的断言。
- **Wake Event**：Life State 的明确转换，例如 became_active、became_idle 或 charging_started。
- **推断/决定（WakeDecision）**：Hermes 或另一个决策器产生的候选；不能回写成现实事实。
- **表达（proactive delivery）**：候选经通知通道投递；失败保留 pending，不能伪称已送达。

无数据、过期数据或冲突数据必须呈现为 unknown/unavailable，而不是用旧状态补全。

## 两种传输职责

### Local MCP Mode

Local MCP 是同一台 Android 手机上的即时读取通道：

```text
Hermes/RikkaHub host on the same phone
        ↓ MCP Streamable HTTP
127.0.0.1:<port>/mcp/<installation-secret>
        ↓
Android Companion facts
```

它只绑定 loopback、使用安装级随机 secret、拒绝浏览器 Origin，且不返回 Cloud bootstrap/device token。Local Mode 只提供确定性的本机工具和当前设备事实；不向 Cloud Runtime 双写实时 observation。没有前台服务时，Android 杀死 Companion 进程后 Local MCP 会停止。

### Cloud Runtime Mode

Cloud Mode 是远程/备用的持久链路：

```text
Android WorkManager
        ↓ protected HTTPS
Cloud Runtime → Life State → Wake Engine → Hermes → FCM
```

Cloud Runtime 接收授权上报、保存历史、维持 activePhoneDeviceId、生成 Wake Event，并在需要时调用 Hermes。当前 Life State 与 FCM 只使用 active device；旧 device 保留历史但不污染当前状态。

在 JSON Store V0.1 阶段，Cloud Runtime 必须由**一个 Node 进程**同时拥有 HTTP/MCP transport、JsonStore 和 Life Loop。Life Loop 不再独立打开第二份 JsonStore；下一轮 cycle 只在上一轮结束后调度，所有 Hermes/Webhook/FCM 出站请求都有超时。不要运行两个进程同时写同一个 JSON data file。

Local 与 Cloud 是明确模式，不得让同一份实时状态同时双写。

## Roadmap V2

### V0.1 — Phone Reality Integrity + Local MCP

- Android 仅上报/读取用户授权的设备事实。
- 前台 App 过滤 Companion、Launcher、Settings、System UI，并带 freshness。
- Cloud Runtime 引入 activePhoneDeviceId；当前 Life State、Wake 与 FCM 不跨设备混合。
- Local MCP Streamable HTTP：loopback、安装级 secret、health/device-context/current-usage/local-notification。
- Cloud 与 Local 模式互斥；不做截图、Accessibility、设备控制或前台服务。
- Diagnostics 显示 phone → Runtime → Life State → Wake → decision → delivery 的已知检查点。
- Cloud Runtime 使用单进程 Store owner；Life Loop 不重入，网络出站有 timeout。
- 周期 app usage 统一为 `usage_summary`；未启用的 `app_timeline` / `steps` 发送路径不保留悬空 contract。

### V0.2 — 验证与可靠性

- 真机验证 Local MCP 同机宿主兼容性、后台 WorkManager、权限拒绝和厂商省电限制。
- 补强 observation freshness、重复事件、队列恢复与诊断可读性。
- 完成随机 device credential、单设备 revoke/rotate；不依赖只能整体轮换的派生 token。
- 不扩大采集范围；所有“not verified”保持显式。

### V0.3 — 决策边界

- 仅在有 Wake Event 或用户对话时按需激活 Hermes。
- 加入冷却、安静时段、每日上限、可解释的候选和人工确认边界。
- 决策失败时保持 pending/retry，不把失败写成已处理。

### V0.4 — 可选通知通道

- 在用户明确配置后完善 FCM 或其他通知适配器。
- 保持 active device 路由、投递 ACK 与失败诊断。
- 不新增任意系统控制。

### V1.0 — 可审计个人 Runtime

- 用可靠持久化层替代原型 JSON store，优先考虑 SQLite WAL；需要远程多实例时再考虑 Postgres。
- 完成迁移、备份、访问控制、数据导出/删除与长期兼容。
- 对每条事实、推断、Wake、决策和投递保留可审计来源链。

V0.4 及之后是路线图，不是当前实现范围。

## 当前限制

- `127.0.0.1` 只能由同一台 Android 手机上的宿主访问；电脑、云端 Hermes 和其他设备不能直接访问。
- CI 不能替代真机 MCP host compatibility 测试；未做真机测试时必须标记 **not verified**。
- Runtime 维持状态不代表 Hermes 永久运行。
- JSON Store 仍是单进程 V0.1 原型，不支持多个独立 Node 进程安全共享同一 data file。
- device token 目前仍是 V0.1 派生凭据；单设备 revoke/rotate 尚未完成。
- 在身份、权限和通知确认前，不应把个人生活数据裸露到公网。
