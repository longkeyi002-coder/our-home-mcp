# Our Home / AI Life Runtime

> 当前唯一开发分支：`rebuild/ai-life-runtime-v01`
>
> **开发前必读：[`docs/OUR_HOME_DESIGN.md`](docs/OUR_HOME_DESIGN.md)**
>
> 该文档是本开发线唯一的设计真相来源。任何功能、Issue、PR、测试和架构变更都必须引用对应 `OH-xx / OH-Px` 章节；设计里没有的能力，默认不做。

## 三个不可绕过的核心原则

1. **两个世界的数据必须隔离。** Earth、AI World、Fiction 必须保留明确的 `world + provenance` 边界。
2. **AI 和用户是双向互动的关系。** AI 可以有自己的生活、观点、探索和主动行为，但用户始终保留权限、隐私和主动联系控制权。
3. **AI 的偏好从体验中逐渐形成，不是预设的。** Soul 必须由经历和反馈缓慢演化，并且可追溯、可解释。

另外：**Our Home 不绑定 Hermes。** Hermes 只是当前可用的一个 Brain Provider；Runtime Core 必须保持 provider-neutral。

---

## 项目是什么

Our Home 是一个长期运行的 AI 伴侣生活系统：

```text
Earth Life / 用户现实世界
          ↕
       Life Runtime
          ↕
AI World / AI 自己的虚拟生活
```

AI 有自己的房子、城市 / 星球、天气、工作、兴趣、活动、收藏、笔记、任务和未完成事项；用户在真实世界持续生活。两个世界共享同一个“现在”，但事实绝不混淆。

核心不是让大模型一直运行：

```text
Runtime 负责持续存在
Brain 负责真正需要思考的时候思考
```

---

## 系统结构

```text
Earth sources
Android / calendar / real web / user declarations
                     │
                     ▼
              Observation Ingest
                     │
                     ▼
                Earth Life State
                     │
              meaningful change
                     ▼
                 Wake Engine
                     │
                     ▼
                BrainAdapter
          Hermes / GPT / Claude / local
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
     AI World update       Earth-side action
          │                     │
          └──────── Runtime ────┘
                                │
                                ▼
                         FCM / approved action
```

### 手机三条通道分开

日常感知：

```text
Android → HTTPS → Runtime
```

实时远程读取：

```text
Remote → Relay → Android outbound WSS → Local MCP
```

主动消息：

```text
Runtime → FCM → Android notification
```

WebSocket 不是日常 Telemetry 的唯一依赖；WSS 断开时，自动上报与主动通知仍应继续工作。

---

## 真假记忆边界

长期记录至少要区分：

```text
world:
EARTH | AI_WORLD | FICTION

provenance:
observed | user_declared | inferred | simulated | authored | model_generated
```

例如：

- Android 检测到手机电量 42% → `EARTH + observed`
- 用户说“今天很累” → `EARTH + user_declared`
- Runtime 推测“可能准备睡觉” → `EARTH + inferred`
- AI 在自己的书房整理收藏 → `AI_WORLD + simulated/authored`

AI World 的雨不能证明东京在下雨，推测也不能自动升级成事实。

详细规则：[`docs/world-model.md`](docs/world-model.md)；若与总设计冲突，以 `OUR_HOME_DESIGN.md` 为准。

---

## Brain 可替换

Runtime Core 只依赖通用 `BrainAdapter`。

当前可以接 Hermes，以后可以接 GPT、Claude、本地模型、自建 Agent 或其他实现。替换 Brain 不能要求重写 Android、Life State、Wake Engine、AI World、Delivery 或事实边界。

---

## 当前可复用能力

仓库当前已经有或可继续复用的基础：

- Android battery / charging / connectivity sensing
- Usage Access + foreground package / Usage Timeline
- WorkManager 周期采集与上传
- Room pending queue
- `/v1/phone/register`
- `/v1/phone/heartbeat`
- `/v1/observations`
- Life State
- Wake Event / dedupe / retry
- Wake Decision 原子消费
- Hermes adapter
- FCM notifier
- MCP tools
- JSON Store 原型

历史实验中的 Local MCP、Relay、reverse WSS、diagnostics 等仅择优迁移，不整体合并旧 PR。

---

## 当前开发顺序

开发 Phase 以 [`docs/OUR_HOME_DESIGN.md`](docs/OUR_HOME_DESIGN.md) 的 `OH-P0`～`OH-P8` 为准：

```text
P0  Clean Foundation
P1  Earth Life 真机链路
P2  Wake + 主动消息最小闭环
P3  AI World V0.1
P4  Continuity + Soul V0.1
P5  Autonomous Exploration
P6  Relationship Feedback Loop
P7  Remote Read + Controlled Actions
P8  Creative Output & Capability Proposals
```

`docs/roadmap.md` 是执行摘要，不得覆盖总设计。

---

## 开发治理

见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

核心规则：

```text
设计章节
→ Issue
→ PR
→ 设计推导测试
→ Phase Review
```

每项工作开始前先写 `Design Reference: OH-xx / OH-Px`。如果找不到对应设计章节，先改设计，不能先写代码。

---

## V0.1 完成标准

至少证明三件事：

```text
A. Android observation
→ Runtime → Life State → Wake → Brain → Decision → FCM → Android

B. AI World 在模型休眠时仍持续
→ 有未完成事项
→ 下一次 Wake 可以继续
→ 与 Earth 事实不混

C. 同一 Runtime 至少可运行 Mock Brain + 一个真实 Provider
```

代码存在不等于完成；验收必须是真实、可观察、可追溯的端到端链路。

---

## 支持文档

- [`docs/OUR_HOME_DESIGN.md`](docs/OUR_HOME_DESIGN.md) — **设计宪法 / 唯一真相来源**
- [`docs/architecture.md`](docs/architecture.md) — 技术架构说明
- [`docs/world-model.md`](docs/world-model.md) — 世界与真假记忆规则
- [`docs/roadmap.md`](docs/roadmap.md) — 开发执行摘要
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Issue / PR / 测试 / Review 规则

---

## 当前一句话状态

**方向已经固定：Our Home 要让用户和 AI 各自在自己的世界持续生活，通过 Life Runtime 双向影响；Runtime 维护连续性、事实边界和低成本运行，Brain 只负责真正需要理解、选择、反思和创造的部分。**
