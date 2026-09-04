# AI Life Runtime / Our Home

> 当前唯一开发分支：`rebuild/gpt-life-runtime-v01`
>
> 这个项目不是为 Hermes 专门开发的。Hermes 只是当前可用的一个 Brain Provider；以后可以替换为 GPT、Claude、自建模型、自己的 Agent 或其他兼容适配器。

## 1. 项目到底是什么

这是一个让 AI 拥有两种持续能力的 Life Runtime：

1. **理解地球上的用户生活**：通过 Android、日历、网页等被授权的数据源接收真实观察，维护 Life State，并在有意义的变化发生时生成 Wake Event。
2. **维持 AI 自己的虚拟生活**：AI 有自己的住所、工作、天气、时间、兴趣、活动、收藏、任务与未完成事情。这个世界与现实世界严格分开。

核心不是“让大模型一直运行”。

```text
Runtime 负责持续存在
Brain 负责需要时思考
```

大模型可以随时替换，Runtime 不应因此重写。

---

## 2. 两个世界 + 一座桥

```text
┌──────────────── Earth / 用户现实世界 ────────────────┐
│ 手机、电量、网络、Usage、日历、现实天气、真实网页      │
└────────────────────────┬─────────────────────────────┘
                         │ observations / actions
                         ▼
┌────────────────── AI Life Runtime ───────────────────┐
│ Device Registry                                      │
│ Observation Ingest                                   │
│ Life State                                            │
│ Wake Engine                                           │
│ Memory Provenance                                     │
│ Thought / Task Thread                                 │
│ Notification / Action Queue                          │
│ Relay / MCP / HTTP adapters                          │
│ BrainAdapter                                          │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────── AI Virtual World ────────────────────┐
│ 房子 / 城市 / 星球 / 天气 / 工作 / 爱好 / 活动        │
│ 收藏 / 待办 / 等待事项 / 自己的时间线                 │
└──────────────────────────────────────────────────────┘
```

AI 可以在自己的世界里生活，同时通过 Runtime 的“工作终端”处理地球用户的事情。

---

## 3. 事实和记忆绝不能混

所有长期记忆、事件和状态必须知道自己属于哪个世界、来自哪里。

### Earth Reality

真实系统或外部可信数据源直接观察到的现实事实。

例如：

- Android 检测到当前前台 package
- 手机电量 42%
- 真实天气 API 返回东京下雨

### User Declared

用户明确说过的内容。

例如：

- “我今天很累”

这是可信的用户声明，但不等于传感器独立验证。

### Inferred

AI 或 Runtime 的推测。

例如：

- “她可能准备休息了”

必须始终保持为推测，不得升级成现实事实。

### AI World

AI 自己虚拟世界中真实发生过的事件。

例如：

- AI 世界今天下雨
- AI 在自己的书房整理摄影收藏

这些是 **AI World 的事实**，但永远不能作为 Earth Reality 的证据。

### Fiction / Hypothetical

故事、想象、角色扮演、假设。

这些内容不得进入现实事实层。

详细规则见 `docs/world-model.md`。

---

## 4. Brain 是可替换的

Runtime Core 只依赖通用接口：

```ts
interface BrainAdapter {
  evaluate(input: BrainInput): Promise<WakeDecision>
}
```

当前仓库已有：

- `HermesDecisionEngine`：当前 Hermes 适配器
- `WebhookDecisionEngine`：可以连接任意 HTTP / 自建 Agent

以后可以增加：

- OpenAI / GPT Adapter
- Claude Adapter
- Local Model Adapter
- 自建 Agent Adapter

Android、Life State、Wake Engine、AI World、通知、MCP 不应因为更换 Brain Provider 而重写。

---

## 5. 三条手机通道分开

### Telemetry Plane

手机主动、低成本地上报状态摘要：

```text
Android → HTTPS → Runtime
```

用于持续知道用户生活状态。

### Control Plane

只有需要实时读取或执行明确动作时：

```text
Remote → Relay → Android outbound WSS → Local MCP
```

WebSocket 不是持续感知的主链。

### Delivery Plane

AI 主动联系用户：

```text
Runtime → FCM → Android notification
```

通知与实时 WebSocket 解耦。

---

## 6. 当前可复用能力

`main` 中已有并继续保留为参考的能力：

- Android Battery / Charging / Connectivity sensing
- Usage Access + foreground package / Usage Timeline
- Room pending queue
- WorkManager 周期采集与上传
- `/v1/phone/register`
- `/v1/phone/heartbeat`
- `/v1/observations`
- Life State reducer
- Wake Event / dedupe / retry
- Wake Decision 原子消费
- Hermes adapter
- FCM notifier
- MCP tools
- JSON Store 原型

旧实验分支 `codex/phone-reality-local-mode` 中值得择优移植：

- Local MCP
- Relay protocol
- ReverseTunnelService 的 WSS / reconnect 思路
- phone relay
- diagnostics
- active-device / runtime reliability tests

这些旧分支只作为参考，不继续加功能。

---

## 7. 当前开发原则

1. **只在 `rebuild/gpt-life-runtime-v01` 开发。**
2. `main` 保留为旧稳定参考，不直接堆新需求。
3. 不删除 Git 历史，不 force-push。
4. 不把 Hermes、GPT 或任何 provider 写进 Runtime Core。
5. 不把 WebSocket `onOpen` 描述成“AI 已连接”。
6. 不把 AI World 的天气、经历或记忆冒充 Earth Reality。
7. 不把模型推测升级为 observed fact。
8. 不保存模型隐藏 Chain-of-Thought；只保存结构化任务、结论、等待事项、计划和可展示记忆。
9. 不在源码中硬编码公网 token、Quick Tunnel、deviceId、API key 或正式 signing key。
10. 每个真实能力必须有测试或可观察 diagnostics。

---

## 8. 当前重建顺序

### Phase 0 — Clean Foundation

- 固定通用 BrainAdapter
- 整理文档和 CI
- 确定 Earth / AI World / provenance 边界
- 保留旧代码但停止继续在旧路线堆功能

### Phase 1 — Earth → Runtime

```text
Android 自动观察
→ Runtime ingest
→ Life State
```

用户不需要点“上传”。

### Phase 2 — Wake Engine

```text
Life State change
→ unique Wake Event
```

必须防 wake storm。

### Phase 3 — AI World + Thought Thread

实现 AI 自己持续存在的：

- 当前地点 / 房子 / 工作状态
- 虚拟世界天气与时间
- 爱好 / 兴趣
- 正在做的事情
- task / waiting / plan / idea
- 收藏与想分享的内容

### Phase 4 — BrainAdapter

先用可测试的 mock/manual adapter 验证 Runtime 独立工作，再接 Hermes 或其他真实 Brain。

### Phase 5 — Proactive Delivery

```text
Wake Event
→ BrainDecision
→ FCM
→ Android notification
```

### Phase 6 — Remote Phone Read

```text
Remote client
→ Relay
→ Android WSS
→ Local MCP
→ device context
→ response
```

---

## 9. V0.1 真正完成的定义

只有下面两条链都跑通，才可以说系统完成 V0.1。

### 生活链

```text
用户正常使用手机
→ Android 自动产生真实 Observation
→ Runtime 维护 Life State
→ 有意义变化产生 Wake Event
→ BrainAdapter 被唤醒
→ 更新 AI 的结构化任务 / Thought Thread
→ 决定是否主动联系
→ FCM 通知到 Android
→ Event Trace 可检查
```

### 实时控制链

```text
Remote client
→ Relay
→ Android WebSocket
→ Local MCP
→ get_device_context
→ response 返回 Remote client
```

Brain 从 Hermes 换成其他 AI 时，上面两条链不应重写。

---

## 10. 仓库角色

| 分支 | 角色 |
|---|---|
| `rebuild/gpt-life-runtime-v01` | **唯一新开发线** |
| `main` | 旧稳定基线 / 参考 |
| `codex/phone-reality-local-mode` | Local MCP / Relay / diagnostics 实验参考 |
| `codex/android-reverse-tunnel-v01` | reverse tunnel 历史参考 |
| `feature/android-companion-v0.2-auto-heartbeat` | 自动上报历史参考 |

更详细的设计：

- `docs/architecture.md`
- `docs/world-model.md`
- `docs/roadmap.md`

---

## 11. 当前一句话状态

**方向已经收口：这是一个 provider-neutral 的 AI Life Runtime。手机负责地球感知，Runtime 负责持续状态和两个世界的边界，Brain 负责需要时思考；Hermes 只是当前可替换的一个大脑。**
