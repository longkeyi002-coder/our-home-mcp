# Our Home — Presence / Visual / Privacy / Notification 实施计划

Status: IN PROGRESS — Design Constitution 已完成本阶段前置修订，后续代码必须继续遵守对应 Design IDs 与测试门槛。

Canonical design: `docs/OUR_HOME_DESIGN.md`

## 1. 目标

让 Android Companion 从“低频设备遥测”升级为 Our Home 在手机上的克制感知入口，同时保持 Runtime 驱动、低模型成本和用户可控隐私。

目标体验：

```text
屏幕亮/灭、解锁/锁屏、前台 App 变化
→ Local Presence Privacy Guard
→ Presence State
→ 持续时间 / 用户主动声明 / 最近视觉理解
→ Context Understanding
→ Curiosity Eligibility：现在是否值得问 Brain 一次？
→ Brain Visual Decision：这次看 / 不看
→ Visual Privacy Guard
→ 可选 Visual Observation
→ Care：是否值得联系用户？
→ Wake / Brain / FCM
→ Android 系统通知
→ 点击进入对应 Our Home Chat
```

核心不是持续监控，也不是固定每 N 分钟截图；而是“持续感知 → 低成本筛选 → AI 自己决定是否偶尔观察 → 有选择地关心”。

## 2. 与现有阶段的关系

- OH-P1 保持不变：15 分钟级 WorkManager + UsageEvents 是低频事实记录、补偿与对账链路，不承担实时 Presence。
- 新增 Presence / Visual 阶段作为 OH-P1 与 OH-P2 之间的能力层。
- OH-P2 继续负责 Wake → Brain → Decision → FCM → Android notification 的主动消息闭环。
- WSS / Local MCP 不是日常 Presence 的依赖。

## 3. 模块拆分

### A. Local App Inventory（Android，仅本地权限管理）

负责提供用户能理解、能搜索的 App 权限清单。

- 枚举正常用户可启动 App，而不是只列近期 UsageStats；
- 最近使用记录只用于排序和状态提示，不决定 App 是否出现在权限列表；
- 不设置固定 12 个之类的可见数量上限；
- 已保存策略的 App 即使近期没有使用也必须继续可管理；
- 新安装、尚未使用的正常可启动 App 也必须能够提前设置策略；
- 完整已安装 App 清单默认只保留在 Android 本地，不作为 Earth observation 整表上传给 Runtime / Brain；
- 系统组件与无 Launcher 入口的内部 package 默认不作为普通用户设置项展示；
- Android package visibility 限制必须通过最小必要的系统查询能力实现，不以无差别收集所有 package 为目标。

### B. Presence Privacy Guard（Android，本地优先）

回答的是：**AI 是否可以知道用户正在使用哪个 App。**

- 每个 App 至少支持 `ALLOW_PRESENCE` / `HIDE_IDENTITY` 两种用户可理解的结果；
- Guard 必须在 package/app identity 离开手机之前执行；
- 被隐藏 App 不得把具体 packageName、app label、类别或由其可反推出身份的字段上传给 Runtime / Brain；
- 如产品确有状态连续性需要，可只发送不暴露具体 App 身份的通用状态，例如 `private_app_active`，并保持数据最小化；
- 用户关闭某 App 的 Presence 后，Visual Observation 不得绕过该决定泄露该 App 身份或内容；
- AI / Soul / Curiosity / Care 无权自行修改此策略。

### C. Presence Sensor（Android，本地、低成本）

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
- UsageStats / UsageEvents 继续作为约 15 分钟 reconciliation/fallback；
- 对外事件必须经过 Presence Privacy Guard 后再进入上传队列。

### D. Context Understanding（Runtime）

融合：

- `observed`：允许暴露的 App、screen、dwell；
- `user_declared`：用户主动说“我在打游戏”等；
- 最近一次 visual summary；
- freshness / conflict / confidence。

状态至少区分：

- UNKNOWN：系统知道设备事实，但不知道用户在做什么；
- PARTIAL：有部分依据；
- KNOWN：已有足够上下文；
- CONFLICT：用户声明与设备事实明显冲突；
- STALE：已有理解需要重新确认。

### E. Curiosity Eligibility Gate（Runtime，规则，不用 LLM 常驻轮询）

Curiosity 不再直接决定“截图”，只回答：**当前稀疏 dwell 节点是否值得唤醒 Brain 做一次 look-or-ignore 判断。**

因素包括：

- 当前状态是否 UNKNOWN；
- 同一 App 持续时间；
- 距离上次视觉观察多久；
- 用户是否已经主动说明；
- 最近是否刚观察过；
- screen 是否可用；
- 当前视觉预算与 cooldown；
- AI 当前活动/忙闲状态（后续可接 AI World）。

用户主动说明只降低观察需求，不意味着永远不再观察。

这一层必须保持低成本：Presence transition 不直接调用 Brain；只有稀疏 dwell milestone 且 Curiosity/budget 通过时，才生成一个短时 `visual_opportunity`。

### E2. Brain Visual Decision（Runtime / BrainAdapter）

最终“这次看还是不看”由 Brain 决定，而不是由固定阈值直接授权截图。

约束：

- Brain 对 `visual_opportunity` 只能返回 `ignore` 或 `request_visual`；
- opportunity 由 Runtime 绑定当前 `deviceId + packageName + sessionId`，Brain 不能改成另一个 App 或另一个 session；
- Brain 只决定是否值得看以及给出 reason，无权改变 Presence / Visual privacy policy；
- Brain timeout、Provider 故障、decision contract 非法或 opportunity 过期时，默认不看；
- 没有通过 Curiosity eligibility 的普通 Presence 事件不调用 Brain；
- “请求看”仍只是一个请求，Android 本地 Visual Privacy Guard / secure-window / exact-session preflight 拥有最终否决权；
- “看”与“发消息”仍是两次独立决定。

### F. Visual Observation（Android + Vision Provider）

只有 Brain 对一个仍有效的 `visual_opportunity` 返回 `request_visual`，并且 Android 本地 Guard / preflight 继续允许时，才触发一次观察。

- Android 11+：Accessibility screenshot；
- Android 8–10：若未来支持，使用用户明确同意的 MediaProjection session；
- 不固定每 15/30 分钟机械截图；
- 可以在长时间保持同一 App 时再次产生观察理由；
- 原始截图默认不长期保存；
- 长期主要保存结构化视觉摘要 + provenance + timestamp + confidence；
- Vision Provider 与 Brain Provider 解耦。

### G. Visual Privacy Guard（Android 本地优先）

回答的是：**AI 是否可以看到当前 App 的屏幕内容。** 这与 Presence 权限独立，且更严格。

默认类别：

1. 普通：在 Curiosity eligibility + Brain request 后可自动观察。
2. 私人：相机、相册、文件、云盘、聊天等，由用户选择“允许自动观察 / 仅我允许时 / 永远不看”。
3. 高度敏感：银行、支付、密码管理、身份认证、支付确认、密码/验证码等默认硬保护。

强规则：

- AI / Soul / Curiosity / Brain 无权解除 Guard；
- 系统 Secure Window 永不绕过；
- 高度敏感页面默认不截图、不上传；
- 用户明确要求可看时，只建立一次性或限时临时授权；切 App、锁屏或超时自动失效；
- 用户自定义“永远不看”优先于所有自动行为；
- 新安装/未知 App 默认不得自动获得视觉观察权限；
- Presence 为隐藏时，Visual 必须同时拒绝，不能通过截图间接泄露；
- 记录允许/拒绝/被 Guard 拦截的审计事件，但不得记录被禁止页面内容。

### H. Action Permission Boundary（独立于观察权限）

“AI 能看到什么”和“AI 能替用户做什么”必须是两个权限域。

- 支付、发送消息、修改日历、文件操作、未来工具调用等属于 Action Permission；
- 允许或禁止 App Presence，不自动授予或撤销对应 Tool / Action 权限；
- 允许视觉观察，也不等于允许执行现实操作；
- 对支付等高影响动作，优先使用服务方正式提供的授权 / Agent / Tool 通道，不通过截图 + 模拟点击绕过权限模型；
- Action Permission 应有独立授权、撤销和审计链。

### I. Care Engine（Runtime）

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

示例：持续游戏较久 → Curiosity 产生机会 → Brain 可选择观察一次 → 若仍持续且满足 Care policy → 提醒休息；若屏幕关闭/离开游戏 → 取消过时提醒。

### J. Notification & Deep Link

```text
Runtime → FCM → Android system notification
```

- App 不在前台时显示系统通知；
- 点击通知进入对应 Our Home Chat / message destination，而不是停在诊断首页；
- 通知预览支持：完整内容 / 仅显示“哥哥给你发了一条消息” / 锁屏隐藏；
- 保留 provider-neutral payload。

### K. Android UI 收敛

Android Companion 定位：Our Home 在手机上的“感知入口”，不是 Runtime 工程控制台。

常规 UI 只保留：

- Home：哥哥是否正在感知；
- 隐私与感知：视觉、App 隐私、主动消息；
- Settings：通知、后台运行；
- Diagnostics：下沉到 Advanced，仅用于开发/排错。

App 权限 UI 必须保持简洁：

```text
应用列表
→ 每个 App 一个主要开关：哥哥可以感知 / 不感知
→ 点进单个 App 才显示“屏幕观察”高级策略
```

正常 UI 不向用户暴露 Presence Guard、Visual Guard、UsageStats、package visibility 等工程术语。

Action Permission 单独归入“哥哥可以帮我做什么”或等价入口，不塞进 App 观察权限列表。

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
6. sparse dwell milestones：本地低成本检查，只有有意义时长节点才上报，不按分钟制造事件。

### Stage 2 — Privacy Policy V0.1

1. Local App Inventory：完整用户可启动 App 清单 + 搜索 + 最近使用排序。
2. Presence Privacy Guard：per-app 是否允许暴露正在使用的 App 身份。
3. App privacy category / visual per-app policy 数据模型。
4. Visual Privacy Guard / Sensitive App Guard。
5. temporary visual grant 生命周期。
6. Action Permission 与观察权限分离。
7. audit record。
8. 本地单元测试 + 真机验证。

### Stage 3 — Visual Observation V0.1

1. screenshot capability gate。
2. Android 11+ Accessibility screenshot。
3. raw screenshot ephemeral handling。
4. structured vision summary ingest。
5. visual freshness + cooldown + budget。

### Stage 4 — Curiosity / Context / Brain Visual Decision V0.1

1. observed + user_declared + visual summary 融合。
2. UNKNOWN / KNOWN / CONFLICT / STALE。
3. rule-based Curiosity 只做 eligibility gate，不调用 LLM 做常驻轮询。
4. 稀疏 eligibility 通过后，Brain 对当前 device/App/session 做一次 `ignore` / `request_visual` 决策。
5. Brain 不能 retarget，失败/超时/过期默认不看。
6. 长时间同 App 仍可在 cooldown/budget 允许时再次产生新的观察机会。

### Stage 5 — Care + FCM deep link

1. 长时使用 Care candidate。
2. wake/message cooldown。
3. FCM payload 携带 destination/message id。
4. notification click route 到 Chat。
5. foreground/background delivery acceptance。

### Stage 6 — UI / Permission Onboarding

1. 首页收敛为 presence status。
2. 隐私与感知页。
3. 完整可搜索 App 列表 + 简洁的 per-app Presence 开关。
4. 单 App 高级页维护 Visual policy。
5. Action Permission 独立入口。
6. permission health / repair flow。
7. OPPO / OnePlus constrained-settings guidance。
8. diagnostics 下沉 Advanced。

## 5. 第一批真机验收场景

### Scenario A — 用户已声明游戏

1. 用户说“我去打游戏”。
2. 手机进入游戏 App。
3. Context 识别声明与观测一致。
4. Curiosity 通常降低观察需求；若后续稀疏机会成立，Brain 可选择看或继续不看。
5. Brain 请求观察也必须再次通过本地 Guard；不能机械重复截图。
6. 连续游戏较久后 Care 可触发一次休息提醒。
7. 切出游戏或熄屏后，游戏 session 结束，不继续发送过时提醒。

### Scenario B — 用户未声明游戏

1. 进入游戏 App，未告诉哥哥。
2. Presence 在本地识别 package 与 dwell；该 App 的 Presence 策略允许时才把身份上传。
3. UNKNOWN 持续到稀疏 milestone 后，Curiosity eligibility 可以产生一次 `visual_opportunity`。
4. Brain 结合当前 Life Context 决定 `ignore` 或 `request_visual`，不能改看另一个 App。
5. Brain 请求观察后仍必须通过 Android 本地 Visual Guard / exact-session preflight。
6. 视觉摘要形成“正在打游戏”的 observed/inferred context。
7. 系统可选择沉默，也可在 Care 条件成立时联系用户。

### Scenario C — Presence 隐藏 App

1. 用户把某 App 设置为“不让哥哥感知”。
2. Android 本地仍可为实现隐私过滤识别前台 package，但不得把具体身份上传。
3. Runtime / Brain 不得收到该 App 的 packageName、label 或可反推身份的 visual summary。
4. 如需保持设备状态连续性，只允许发送通用 `private_app_active` 或保持沉默。
5. 切回允许 App 后恢复正常 Presence。

### Scenario D — 敏感 App

1. 打开银行/支付/密码类 App。
2. Presence 是否暴露 App 身份由用户的 Presence 策略决定。
3. Visual Guard 在本地拦截默认截图。
4. Curiosity/Care/Brain 无法越权。
5. 用户明确“这次可以看”时才创建临时视觉授权（仍不得绕过 secure window）。
6. 切出 App / 锁屏 / 超时后临时授权自动失效。

### Scenario E — 支付 / Tool Action

1. 用户可独立授权某个正式支付/Tool 能力。
2. 该授权不要求同时开放该 App 的 Presence 或屏幕观察权限。
3. Action 执行仍按工具自身的授权、确认、审计规则完成。
4. 不允许通过视觉权限推导出支付权限。

### Scenario F — 系统通知

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
- 让 Brain 自己选择当前 opportunity 之外的 App/session 去看；
- 通过截图/模拟点击替代正式支付或高影响 Tool 授权；
- 用 WSS 维持日常感知。

## 7. 成本与可靠性原则

```text
Local App Inventory / Presence / dwell / screen / privacy guards / cooldown
→ deterministic Runtime / Android logic
→ sparse Curiosity eligibility

只有 eligibility 成立时
→ Brain look-or-ignore decision

只有 Brain 请求且本地 Guard 仍允许时
→ Vision

只有真正需要联系用户时
→ Brain/Care message decision
```

所有事件必须可去重、可重试、可审计；网络断开时先本地排队；恢复后上传。Brain 失败或 opportunity 过期默认不观察；截图类数据遵循最短生命周期和最小化持久化。隐私拒绝必须在数据离开 Android 设备之前生效。
