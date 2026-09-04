# Our Home — Presence / Visual / Privacy / Notification 实施计划

Status: PLANNED — coding must not begin until the Design Constitution is amended.

Canonical design: `docs/OUR_HOME_DESIGN.md`

## 1. 目标

让 Android Companion 从“低频设备遥测”升级为 Our Home 在手机上的克制感知入口，同时保持 Runtime 驱动、低模型成本和用户可控隐私。

目标体验：

```text
屏幕亮/灭、解锁/锁屏、前台 App 变化
→ Presence State
→ 持续时间 / 用户主动声明 / 最近视觉理解
→ Context Understanding
→ Curiosity：是否值得看一眼？
→ 可选 Visual Observation
→ Care：是否值得联系用户？
→ Wake / Brain / FCM
→ Android 系统通知
→ 点击进入对应 Our Home Chat
```

核心不是持续监控，也不是固定每 N 分钟截图；而是“持续感知 → 偶尔观察 → 有选择地关心”。

## 2. 与现有阶段的关系

- OH-P1 保持不变：15 分钟级 WorkManager + UsageEvents 是低频事实记录、补偿与对账链路，不承担实时 Presence。
- 新增 Presence / Visual 阶段作为 OH-P1 与 OH-P2 之间的能力层。
- OH-P2 继续负责 Wake → Brain → Decision → FCM → Android notification 的主动消息闭环。
- WSS / Local MCP 不是日常 Presence 的依赖。

## 3. 模块拆分

### A. Presence Sensor（Android，本地、低成本）

负责：

- 前台 App 变化事件；
- 当前 App 起始时间与 dwell time；
- screen on / screen off；
- unlock / lock；
- Accessibility 服务健康状态；
- 本地事件去重、debounce、离线排队。

实现方向：

- AccessibilityService 只用于窗口/package 变化与 Android 11+ 的显式授权截图能力；
- `canRetrieveWindowContent=false`，不采集 Accessibility 原始 UI Tree；
- 屏幕状态使用系统事件维护；
- UsageStats / UsageEvents 继续作为约 15 分钟 reconciliation/fallback。

### B. Context Understanding（Runtime）

融合：

- `observed`：App、screen、dwell；
- `user_declared`：用户主动说“我在打游戏”等；
- 最近一次 visual summary；
- freshness / conflict / confidence。

状态至少区分：

- UNKNOWN：系统知道设备事实，但不知道用户在做什么；
- PARTIAL：有部分依据；
- KNOWN：已有足够上下文；
- CONFLICT：用户声明与设备事实明显冲突；
- STALE：已有理解需要重新确认。

### C. Curiosity Engine（Runtime，默认规则，不用 LLM）

决定“哥哥要不要看一眼”。因素包括：

- 当前状态是否 UNKNOWN；
- 同一 App 持续时间；
- 距离上次视觉观察多久；
- 用户是否已经主动说明；
- 最近是否刚观察过；
- screen 是否可用；
- App / 场景隐私策略；
- 当前视觉预算与 cooldown；
- AI 当前活动/忙闲状态（后续可接 AI World）。

用户主动说明只降低观察需求，不意味着永远不再观察。

### D. Visual Observation（Android + Vision Provider）

只有 Curiosity 通过安全策略后才触发一次观察。

- Android 11+：Accessibility screenshot；
- Android 8–10：若未来支持，使用用户明确同意的 MediaProjection session；
- 不固定每 15/30 分钟机械截图；
- 可以在长时间保持同一 App 时再次产生观察理由；
- 原始截图默认不长期保存；
- 长期主要保存结构化视觉摘要 + provenance + timestamp + confidence；
- Vision Provider 与 Brain Provider 解耦。

### E. Sensitive App Guard（Android 本地优先）

安全策略必须在截图上传前生效。

默认类别：

1. 普通：按 Curiosity 规则可自动观察。
2. 私人：相机、相册、文件、云盘、聊天等，由用户选择“允许自动观察 / 仅我允许时 / 永远不看”。
3. 高度敏感：银行、支付、密码管理、身份认证、支付确认、密码/验证码等默认硬保护。

强规则：

- AI / Soul / Curiosity 无权解除 Guard；
- 系统 Secure Window 永不绕过；
- 高度敏感页面默认不截图、不上传；
- 用户明确要求可看时，只建立一次性或限时临时授权；切 App、锁屏或超时自动失效；
- 用户自定义“永远不看”优先于所有自动行为；
- 记录允许/拒绝/被 Guard 拦截的审计事件，但不得记录被禁止页面内容。

### F. Care Engine（Runtime）

“看到了”与“发消息”必须分开。

可根据：

- dwell time；
- 用户作息/目标；
- Context Understanding；
- visual summary；
- quiet hours；
- 最近提醒 cooldown；
- urgency；
- 用户主动程度偏好；

决定：保持沉默 / 生成 wake / 生成 proactive message。

示例：持续游戏较久 → 可观察一次 → 若仍持续且满足 Care policy → 提醒休息；若屏幕关闭/离开游戏 → 取消过时提醒。

### G. Notification & Deep Link

```text
Runtime → FCM → Android system notification
```

- App 不在前台时显示系统通知；
- 点击通知进入对应 Our Home Chat / message destination，而不是停在诊断首页；
- 通知预览支持：完整内容 / 仅显示“哥哥给你发了一条消息” / 锁屏隐藏；
- 保留 provider-neutral payload。

### H. Android UI 收敛

Android Companion 定位：Our Home 在手机上的“感知入口”，不是 Runtime 工程控制台。

常规 UI 只保留：

- Home：哥哥是否正在感知；
- 隐私与感知：视觉、App 隐私、主动消息；
- Settings：通知、后台运行；
- Diagnostics：下沉到 Advanced，仅用于开发/排错。

不在主界面暴露 Runtime URL、token、worker、pending、WebSocket 等工程术语。

权限 onboarding：

```text
点“去授权”
→ 尽量跳到对应系统页
→ 用户完成系统开关
→ 返回 Our Home
→ 自动检测
→ 显示完成并进入下一项
```

针对 OPPO / OnePlus / ColorOS 等侧载场景，检测/解释“允许受限制的设置”步骤，并提供最短路径；无法直接开启的系统安全开关只做清晰引导，不尝试绕过。

## 4. 实施顺序

### Stage 0 — Design & Guardrails

1. 修改 `OUR_HOME_DESIGN.md`，新增 Presence / Visual / Sensitive Guard / Permission UX / Notification Deep Link 设计条款。
2. 更新 `DESIGN_TEST_MATRIX.md`。
3. 新建 GitHub implementation issue，所有代码引用新的 Design IDs。

### Stage 1 — Android Presence V0.1

1. Accessibility service（package transition only, no UI-tree retrieval）。
2. screen on/off + unlock/lock state。
3. transition debounce/dedupe + Room queue。
4. diagnostics 增加 Presence health 与 last transition。
5. 继续保留 UsageEvents reconciliation。

### Stage 2 — Privacy Policy V0.1

1. App privacy category / per-app policy 数据模型。
2. Sensitive App Guard。
3. temporary visual grant 生命周期。
4. audit record。
5. 本地单元测试 + 真机验证。

### Stage 3 — Visual Observation V0.1

1. screenshot capability gate。
2. Android 11+ Accessibility screenshot。
3. raw screenshot ephemeral handling。
4. structured vision summary ingest。
5. visual freshness + cooldown + budget。

### Stage 4 — Curiosity / Context V0.1

1. observed + user_declared + visual summary 融合。
2. UNKNOWN / KNOWN / CONFLICT / STALE。
3. rule-based Curiosity，不调用 LLM 做常驻轮询。
4. 长时间同 App 仍可再次观察。

### Stage 5 — Care + FCM deep link

1. 长时使用 Care candidate。
2. wake/message cooldown。
3. FCM payload 携带 destination/message id。
4. notification click route 到 Chat。
5. foreground/background delivery acceptance。

### Stage 6 — UI / Permission Onboarding

1. 首页收敛为 presence status。
2. 隐私与感知页。
3. per-app policy。
4. permission health / repair flow。
5. OPPO / OnePlus constrained-settings guidance。
6. diagnostics 下沉 Advanced。

## 5. 第一批真机验收场景

### Scenario A — 用户已声明游戏

1. 用户说“我去打游戏”。
2. 手机进入游戏 App。
3. Context 识别声明与观测一致。
4. 哥哥可偶尔观察，但不机械重复截图。
5. 连续游戏较久后 Care 可触发一次休息提醒。
6. 切出游戏或熄屏后，游戏 session 结束，不继续发送过时提醒。

### Scenario B — 用户未声明游戏

1. 进入游戏 App，未告诉哥哥。
2. Presence 知道 package 与 dwell。
3. UNKNOWN 持续后 Curiosity 上升。
4. 安全策略允许时观察一次。
5. 视觉摘要形成“正在打游戏”的 observed/inferred context。
6. 系统可选择沉默，也可在 Care 条件成立时联系用户。

### Scenario C — 敏感 App

1. 打开银行/支付/密码类 App。
2. Presence 可保留最小 package/category 事实。
3. Visual Guard 在本地拦截截图。
4. Curiosity/Care/Brain 无法越权。
5. 用户明确“这次可以看”时才创建临时授权。
6. 切出 App / 锁屏 / 超时后临时授权自动失效。

### Scenario D — 系统通知

1. Our Home 不在前台。
2. Runtime 发送 proactive FCM。
3. 系统通知出现。
4. 点击后进入对应 Chat/message destination。
5. 不落到工程诊断页。

## 6. 非目标

本阶段不做：

- Accessibility UI Tree 文本抓取；
- 键盘/密码/验证码采集；
- 麦克风持续监听；
- 相机后台采集；
- 绕过 FLAG_SECURE / secure-window；
- 每次 App 切换都调用 LLM；
- 固定高频截图 cron；
- 让 Brain 自己修改隐私规则；
- 用 WSS 维持日常感知。

## 7. 成本与可靠性原则

```text
Presence / dwell / screen / Guard / cooldown
→ deterministic Runtime / Android logic

只有真正需要理解或写消息
→ Vision / Brain
```

所有事件必须可去重、可重试、可审计；网络断开时先本地排队；恢复后上传。截图类数据遵循最短生命周期和最小化持久化。
