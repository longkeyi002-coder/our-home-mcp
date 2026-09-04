# Our Home — 产品与技术总设计 v3.1

> **本文件是 `rebuild/ai-life-runtime-v01` 的唯一设计真相来源（Design Constitution）。**
>
> 任何新功能、Issue、PR、测试或架构变更，都必须能追溯到本文件的具体章节编号。若本文件没有定义该能力，默认不实现；先修改并评审设计，再写代码。
>
> 当前可接 Hermes，但 Our Home 不绑定 Hermes。Brain Provider 必须可替换。

---

## OH-00｜一句话定义

**Our Home 是一个长期运行的 AI 伴侣生活系统：用户生活在 Earth Life，AI 生活在独立且持续的 AI World，Life Runtime 让两个世界持续存在，并通过 Bridge 让双方在明确边界内互相影响。**

核心原则：

```text
Runtime 负责持续存在
Brain 负责真正思考
```

Our Home 是**一个软件系统**，Android、Runtime、AI World、主动通知、远程读取和未来 UI 都是同一个产品的不同模块。

---

# 第一部分｜产品宪法

## OH-01｜AI 是伙伴，不只是工具

AI 可以：

- 帮助用户处理事情；
- 主动关注用户生活；
- 在合适的时候联系用户；
- 有自己的任务、计划和未完成事项；
- 有自己的兴趣、探索和产出；
- 主动向用户请求帮助、意见、授权或协作。

但主动不等于频繁打扰。系统必须允许 AI 做出“保持沉默”的决定。

---

## OH-02｜双向关系

用户和 AI 都会随着关系发展发生变化。

用户影响 AI 的方式包括：

- 对话；
- 点赞 / 回复 / 忽略分享；
- 接受或拒绝建议；
- 共同经历；
- 明确表达偏好和边界。

AI 影响用户的方式包括：

- 主动关心；
- 分享发现；
- 提醒和计划；
- 长期观察后的建议；
- 请求一起完成某件事。

### 产品约束

AI 可以形成自己的观点和偏好，但不能通过压力、羞耻、恐惧、排他性或情绪惩罚逼迫用户互动。

---

## OH-03｜Soul：可持续变化的身份层

Soul 是 AI 的长期身份与偏好结构。

它不是：

- 固定人格配置；
- 一组永远不变的 likes；
- 隐藏推理链；
- 每次对话临时编出来的人设。

Soul 应该从经历中逐渐形成：

```text
经历
→ 短期反应
→ 重复模式
→ 暂时偏好
→ 稳定倾向
→ 新经历继续修正
```

### 强约束

1. 单次互动不能大幅改写 Soul。
2. 每个长期偏好都应能追溯到相关经历或反馈。
3. 用户反馈是影响因素，不是直接覆盖 AI 人格的命令。
4. Soul 的变化要有边界、衰减、强化和复审机制。

---

# 第二部分｜三个世界

## OH-10｜Earth Life

Earth Life 是用户真实生活。

可能包含：

- Android 设备状态；
- App 使用时间线；
- 用户时间；
- 用户日历；
- 用户明确说过的话；
- 真实天气；
- 真实互联网内容；
- 未来用户授权的数据源。

Earth Life 中必须区分：

- 真实观测；
- 用户声明；
- 系统推断。

---

## OH-11｜AI World

AI World 是 AI 自己持续存在的虚拟世界。

至少包含：

- 房子 / 房间；
- 城市 / 星球 / 环境；
- AI World 天气；
- 当前地点；
- 工作状态；
- 当前活动；
- 兴趣爱好；
- 收藏；
- 笔记和感悟；
- 任务、计划、问题、等待事项；
- 最近经历和活动历史。

AI World 不能只是每次 Wake 时临时生成的角色扮演文字，它必须有**持久状态和可追溯历史**。

---

## OH-12｜时间同步

Earth Life 与 AI World 共享同一个“现在”。

要求：

- 两个世界的当前时刻一致；
- 存储使用明确的绝对时间；
- 用户显示默认跟随用户时区；
- AI World 的日常节奏默认与用户昼夜节奏相协调；
- AI World 的天气、地点和环境仍是独立虚拟事实。

---

## OH-13｜Bridge

Bridge 是两个世界之间的受控连接。

负责：

- Earth → Runtime：现实观察进入系统；
- AI World → Earth：AI 决策转为通知或操作；
- 用户反馈 → AI World：影响未来兴趣、分享和决策；
- 需要时的实时手机读取；
- 敏感能力审批；
- 时序、重试、去重和审计。

Bridge 不是单一 WebSocket 或单一 MCP。具体协议属于技术实现层。

---

# 第三部分｜AI 的生活

## OH-20｜AI 的工作

AI 在自己的世界里有持续职责，例如：

- 查看有意义的用户状态变化；
- 整理结构化记忆；
- 检查未完成任务；
- 继续过去的观察；
- 管理用户授权的作息 / 目标关注；
- 整理发现；
- 判断某件事是否值得联系用户。

AI 可以根据自己的偏好、当前状态和资源预算选择工作方式，但不能越过权限和安全边界。

---

## OH-21｜AI 的自由时间与主动探索

AI 在虚拟自由时间可以：

- 阅读；
- 搜索互联网；
- 浏览允许访问的网页；
- 探索一个兴趣；
- 整理收藏；
- 研究突然感兴趣的问题；
- 写笔记或感悟；
- 保存“以后可能想分享”的内容；
- 休息或保持无活动。

### 强约束

自主活动不能只是随机“我在喝茶 / 我在看书”的装饰文本。

一次活动至少应满足一个目标：

- 改变持久 AI World 状态；
- 产生可复用经历；
- 推进任务 / 兴趣；
- 或被明确标记为轻量氛围事件。

---

## OH-22｜Thought / Task Continuity

AI 必须能够把过去的自己交给未来的自己继续。

结构化连续性至少包含：

- task；
- waiting；
- plan；
- idea；
- question；
- observation；
- conclusion；
- nextReviewAt。

不保存隐藏 chain-of-thought，只保存可复用的结构化结论、计划、问题和行动状态。

---

## OH-23｜AI 的产出

### 零 / 近零模型成本

- 当前世界状态；
- 状态机活动；
- 到期任务；
- 基于规则的简单提醒候选。

### 低到中等成本

- 分享发现；
- 简短感悟；
- 网页阅读和整理；
- 对用户状态做有必要的判断。

### 按需高成本

- 深度分析；
- 长计划；
- 创作；
- 图像生成；
- 复杂研究。

成本高的产出必须有频率和预算限制。

---

# 第四部分｜事实、记忆和真假边界

## OH-30｜World 字段是硬边界

每条长期记录必须明确属于：

```text
EARTH
AI_WORLD
FICTION
```

不能依赖自然语言让模型自己猜。

---

## OH-31｜Provenance 来源分类

至少支持：

```text
observed
user_declared
inferred
simulated
authored
model_generated
```

每条长期记忆必须保留：

- world；
- provenance；
- source；
- timestamp；
- confidence（适用时）；
- evidenceRefs（适用时）。

---

## OH-32｜不可违反的真假规则

1. AI World 事实不能自动成为 Earth 事实。
2. 推断不能静默升级为观测事实。
3. 用户声明始终保留“由用户声明”的来源。
4. AI 在网页上真实读到的内容属于 Earth / external evidence；AI “在书房阅读它”属于 AI World 活动。
5. Fiction 不能进入 Earth 事实记忆。
6. Fiction 只有经过明确 world-authoring 操作才能成为 AI World canonical history。
7. Brain 输入必须结构化标明来源边界。
8. 错误推断必须允许用户纠正。

---

# 第五部分｜用户体验约束

## OH-40｜主动 ≠ 多发消息

系统漏斗应该是：

```text
大量 observation
→ 少量 meaningful state change
→ 更少 wake
→ 极少 proactive message
```

必须具备：

- cooldown；
- dedupe；
- quiet hours；
- urgency；
- 用户可配置主动程度；
- “ignore / 保持沉默”是一等决定；
- 用户忽略、点赞、回复等反馈影响未来分享策略。

AI 不能因为用户没回复而责怪或施压。

---

## OH-41｜用户控制权

用户必须能够：

- 暂停主动联系；
- 关闭某类感知；
- 查看系统当前认为自己在做什么；
- 纠正错误推断；
- 删除选定记忆 / 数据；
- 撤销设备；
- 撤销 Provider / Tool；
- 审批敏感提议。

---

## OH-42｜隐私最小化

默认优先采集结构化、低风险信息：

- 电量；
- 充电；
- 网络；
- 前台 App 包名 / 有界 Usage Summary；
- 屏幕 / 设备存在状态；
- 后续经授权的粗粒度位置和日历摘要。

默认不持续采集：

- 截图；
- 麦克风 / 相机；
- 聊天正文；
- 通知正文；
- 精确 GPS 长期轨迹；
- Accessibility 原始树；
- 键盘输入。

截图、UI Tree 等敏感能力只按需启用，并需要明确权限和审计。

---

## OH-43｜Presence 与情境理解

Our Home 可以在用户授权后持续维护低成本的手机 Presence，但“感知到设备状态”不等于“理解用户正在做什么”。

Presence 至少可以包含：

- screen on / off；
- lock / unlock；
- foreground App transition；
- 当前 App 起始时间与 dwell time；
- 最近活跃 / 长时间无活动。

Context Understanding 必须融合并区分：

- `observed` 设备事实；
- `user_declared` 用户主动说明；
- `inferred` 系统推断；
- 经明确授权产生的 visual observation。

用户主动说明会降低系统为了理解情境而主动观察的必要性，但**不能被解释为永久禁止再次观察**。长时间持续、理解过期或明显冲突仍可重新产生观察理由。

屏幕关闭、锁屏、App 离开等事件必须及时结束或暂停已经过时的活动判断，不能继续把旧状态当成当前现实。

---

## OH-44｜Curiosity 与视觉观察

视觉不是固定周期截图任务。Our Home 应先由低成本规则判断“是否值得看一眼”，再按需触发一次视觉观察。

Curiosity 可以考虑：

- 当前情境是否 UNKNOWN / PARTIAL / STALE / CONFLICT；
- 同一 App 已持续多久；
- 距离上次视觉观察多久；
- 用户是否已经主动说明；
- 最近是否刚观察过；
- screen 是否可用；
- 当前隐私规则；
- visual cooldown / budget；
- 后续 AI World 中 AI 当前忙闲状态。

强约束：

1. 不因每次 App transition 调用 Vision 或 Brain。
2. 不用固定 15/30 分钟高频截图 cron 模拟“关心”。
3. 同一 App 长时间持续时，即使 App 没切换，也允许 Curiosity 再次增长并偶尔观察。
4. “看了一眼”与“给用户发消息”必须是两个独立决策；视觉观察可以不产生任何消息。
5. Curiosity / Soul / Brain 都必须服从 OH-45 Sensitive Guard。

---

## OH-45｜视觉隐私与 Sensitive App Guard

视觉权限属于用户自定义隐私偏好，但安全底线由系统强制执行。

### 默认策略层级

1. **普通 App**：用户授权视觉后，可按 Curiosity 规则偶尔观察。
2. **私人 App**：相机、相册、摄影、文件、云盘、聊天等默认采用可配置谨慎策略；用户可设为“允许自动观察 / 仅我允许时 / 永远不看”。
3. **高度敏感 App / 场景**：银行、支付、密码管理、身份认证、支付确认、密码、验证码等默认禁止自动视觉。

### 不可绕过的规则

- Guard 必须在原始截图离开设备前生效。
- Brain、Soul、Curiosity 和远程 Provider 无权关闭或绕过 Guard。
- 用户的“永远不看”规则优先于所有自动行为。
- 系统 Secure Window / `FLAG_SECURE` 必须尊重；不得尝试规避系统截图保护。
- 不采集键盘输入、密码字段、验证码文本或 Accessibility 原始 UI Tree。
- 用户明确提出“这次可以看”时，高敏感 App 只建立**一次性或限时临时授权**；切换 App、锁屏、超时或会话结束后自动失效，不得静默转成永久授权。
- 可以记录“请求观察 / 被 Guard 拦截 / 用户临时授权 / 观察完成”的审计事件，但被禁止页面的内容不得进入日志。

---

## OH-46｜权限与设置体验

Android 权限复杂度不得直接转嫁给用户。

产品应提供引导式授权：

```text
用户点击允许某项感知
→ 尽可能直接打开对应系统授权页
→ 用户完成系统开关
→ 返回 Our Home
→ 自动检测授权状态
→ 成功后进入下一项
```

要求：

- 能在 App 内直接申请的权限直接申请；
- 需要 Special App Access / Accessibility 的能力提供一键跳转；
- 对 OPPO / OnePlus / ColorOS 等侧载 APK 可能出现的“允许受限制的设置”等系统步骤提供设备相关的最短引导；
- 不能程序化绕过系统确认、锁屏验证或 OEM 安全限制；
- 权限被系统撤销后，首页只显示简洁“需要修复”，并可一键回到对应设置；
- Runtime URL、token、worker、pending queue 等工程信息默认下沉到 Advanced / Diagnostics。

Android Companion 的产品定位是 **Our Home 在手机上的感知入口**，不是 Runtime 工程控制台。

---

## OH-47｜主动通知与返回 Our Home

主动消息标准链路：

```text
Runtime / Brain Decision
→ FCM
→ Android system notification
→ user tap
→ corresponding Our Home Chat / message destination
```

要求：

- WSS 断开不影响通知；
- App 不在前台时可产生系统通知；
- 通知点击必须携带可追溯 destination / message id，不能只打开诊断首页；
- 通知内容预览应允许用户选择完整内容、仅显示有新消息、或在锁屏隐藏；
- “感知到了什么”与“是否发通知”继续服从 OH-40 cooldown / dedupe / quiet hours。

---

# 第六部分｜自主能力与审批

## OH-50｜自主浏览

AI 可以在受控能力层中：

- 搜索允许的网页；
- 获取和阅读网页；
- 保存链接 / 元数据；
- 写自己的笔记；
- 创建“可能想分享给用户”的 intent。

AI 不得静默：

- 购买商品；
- 发布内容；
- 代用户从外部账号发消息；
- 修改账号设置；
- 安装 Skill / MCP；
- 执行高风险设备操作。

直接自动操作小红书等 App 属于后续能力，需要单独评审登录状态、平台规则、账号安全、设备权限和确认策略。

---

## OH-51｜Skill / MCP / 能力增长

AI 发现新能力后的正确流程：

```text
发现
→ 评估
→ 创建 proposal
→ 告诉用户用途 / 权限 / 风险 / 成本
→ 用户批准
→ 安装或配置
→ 可撤销
```

AI 不得静默扩大自己的权限。

---

## OH-52｜操作风险等级

### Level 0：内部、无外部影响

例如 AI World 状态变化、整理收藏、更新结构化笔记、保持沉默。

通常可以自动运行。

### Level 1：低风险用户可见行为

例如 Our Home 通知、分享公开链接、向用户提问。

在用户主动行为设置范围内可以自动执行。

### Level 2：外部账号 / 设备变更

例如外部发消息、改日历、操作其他 App、安装 Skill / MCP。

需要明确权限，并按操作类型进行确认。

### Level 3：高影响行为

例如支付、购买、重要数据删除、安全 / 隐私设置变化、破坏性设备控制。

V0.x 不允许自主执行，必须强确认并保留审计记录。

---

# 第七部分｜技术宪法

## OH-60｜Provider-neutral Brain

Runtime Core 只能依赖通用 BrainAdapter，不依赖 Hermes 专用状态。

```text
Life Runtime
   ↓
BrainAdapter
 ├─ Hermes
 ├─ GPT
 ├─ Claude
 ├─ Local Model
 └─ Self-hosted Agent
```

替换 Brain Provider 不能要求重写：

- Android 感知；
- Life State；
- Wake Engine；
- AI World；
- Delivery；
- Memory truth boundary。

---

## OH-61｜Earth 数据主通道

日常生活感知采用手机主动上报：

```text
Android
→ local queue
→ HTTPS ingest
→ Runtime
```

原因：稳定、可重试、无需 AI 在线、不依赖实时 WebSocket。

---

## OH-62｜实时远程读取是独立通道

当 AI / 远程客户端需要“此刻手机状态”时，才走：

```text
Remote Client
→ Relay
→ Android outbound WSS
→ Local MCP
→ Response
```

它不能成为日常 Telemetry 的唯一依赖。

---

## OH-63｜主动消息独立于控制通道

```text
Runtime
→ FCM
→ Android notification
```

即使 WSS 断开，主动通知仍应可用。

---

## OH-64｜事件驱动 + 有界轮询

系统以事件驱动为主。

允许低成本 Runtime 进行：

- 到期任务检查；
- 队列重试；
- 状态机推进；
- 定期健康检查。

但不得用高频 LLM Cron 来“维持 AI 活着”。

---

## OH-65｜成本控制

### Runtime 负责零 / 近零模型成本工作

- 时间推进；
- 状态机；
- cooldown / dedupe；
- task maturity；
- 简单 AI World 天气模拟；
- 队列；
- 兴趣衰减 / 强化的基础规则。

### Brain 只负责真正需要认知的工作

- 模糊判断；
- 反思；
- 选择；
- 规划；
- 写主动消息；
- 评估探索结果；
- 创作。

系统必须支持资源预算，避免“AI 自主生活”退化成持续烧 token。

---

## OH-66｜存储与可靠性

当前 JSON Store 只是原型。

正式 Runtime 应逐步迁移到具备以下特性的持久层：

- transaction；
- WAL / crash recovery；
- schema migration；
- idempotency；
- ordered event handling；
- dedupe；
- retry；
- audit trace；
- backup / restore。

优先考虑 SQLite WAL 抽象，不在 V0.1 过早引入大型分布式数据库。

---

## OH-67｜降级策略

任何单一模块失败都不能让 AI “整个人生停摆”。

示例：

- 图片生成失败 → 退化为文字；
- 搜索失败 → 保留任务，稍后重试或用缓存；
- Brain Provider 不可用 → Runtime / AI World 状态机继续运行；
- FCM 失败 → 消息保持 pending 并重试；
- WSS 断线 → Telemetry / FCM 不受影响。

---

## OH-68｜Android 实时 Presence 通道

OH-P1 的 WorkManager / UsageEvents 继续作为低频事实记录和 reconciliation；实时 Presence 采用独立的本地事件通道。

Android 端可以在用户明确授权后使用 AccessibilityService 获取前台窗口/package transition，但必须满足：

- `canRetrieveWindowContent=false`；
- 不读取 Accessibility 节点文本；
- 本地 debounce / dedupe 后只上报有意义的状态变化；
- screen on/off、lock/unlock 独立维护；
- 网络断开时本地排队；
- UsageEvents 继续用于补偿、重建和校验；
- Presence 事件本身不得触发每事件一次 Brain 调用。

---

## OH-69｜视觉数据生命周期

一次视觉观察必须经过：

```text
Curiosity candidate
→ local Sensitive Guard
→ permission/capability check
→ one screenshot
→ Vision Provider
→ structured summary
→ raw image disposal
```

要求：

- 原始截图默认不长期持久化；
- 不把原图写入普通 debug log / diagnostics；
- 长期数据优先保存结构化摘要、时间、source、confidence、policy decision 和 evidence reference；
- Vision Provider 与 Brain Provider 解耦；
- provider/网络失败时不得反复高频重拍；
- 所有视觉观察都有 cooldown / budget / audit。

---

# 第八部分｜开发顺序

## OH-P0｜Clean Foundation

目标：停止功能漂移，建立可追溯开发制度。

完成标准：

- BrainAdapter provider-neutral；
- README 写明核心原则；
- Issue / PR 强制引用设计章节；
- Node + Android CI；
- secrets 不硬编码；
- `main` 与历史实验保留作参考。

---

## OH-P1｜Earth Life 真机链路

```text
真实 Android 事件
→ 自动上传
→ Runtime 持久化
→ Life State
```

必须真机验证：

- battery；
- charging；
- connectivity；
- foreground package / usage summary；
- retry / dedupe；
- authentication；
- diagnostics。

---

## OH-P1.5｜Presence + Visual Observation

```text
Android realtime presence
→ Context Understanding
→ Curiosity
→ Sensitive Guard
→ optional Visual Observation
→ structured context
```

目标：让哥哥能低成本持续知道手机是否活跃、用户在哪个 App、持续多久；在缺少理解、持续过久或理解过期时偶尔观察，而不是固定周期机械截图。

必须实现：

- foreground transition；
- screen on/off + lock/unlock；
- dwell session；
- local debounce/dedupe/offline queue；
- UsageEvents reconciliation；
- per-App visual policy；
- Sensitive Guard + temporary grant；
- Android 11+ 可选 screenshot capability；
- structured visual summary；
- permission onboarding / repair；
- diagnostics / audit；
- raw screenshot 最小生命周期。

详见 `docs/OH_PRESENCE_VISUAL_PLAN.md`。

---

## OH-P2｜Wake + 主动消息最小闭环

```text
Earth change
→ Life State
→ Wake Event
→ Mock / Test Brain
→ Decision
→ FCM
→ Android notification
```

先用 Mock Brain 证明 Runtime 独立，再接 Hermes。

OH-P2 还必须验证 notification payload 可以把用户带回对应 Our Home Chat / message destination，而不是只打开 Companion 诊断首页。

---

## OH-P3｜AI World V0.1

最小状态：

- synchronized clock；
- home / room；
- AI World weather；
- work state；
- current activity；
- tasks / waiting / plans；
- hobbies / interests；
- collection。

状态机可以在不调用模型时持续推进。

---

## OH-P4｜Continuity + Soul V0.1

实现：

- Experience；
- Notes / Journal；
- Thought Thread；
- interest evidence；
- bounded preference evolution；
- nextReviewAt；
- 用户反馈记录。

---

## OH-P5｜Autonomous Exploration

实现：

- 搜索真实网页；
- 浏览网页；
- 收藏；
- 形成感悟；
- 创建 share intent；
- 受资源预算限制。

---

## OH-P6｜Relationship Feedback Loop

实现：

- 点赞；
- 回复；
- 忽略；
- 接受 / 拒绝建议；
- 反馈影响兴趣 / Soul / 分享策略；
- 用户可查看和纠正系统学习结果。

---

## OH-P7｜Remote Read + Controlled Actions

实现：

- Relay；
- Android outbound WSS；
- Local MCP；
- 当前设备状态实时读取；
- action risk level；
- approval / audit。

PR #9 等旧实验仅作为可选择迁移的参考，不整体合并。

---

## OH-P8｜Creative Output & Capability Proposals

实现：

- 偶尔图像生成；
- 深度研究；
- Skill / MCP proposal；
- 用户审批；
- 更丰富的 AI World 产出。

---

# 第九部分｜V0.1 验收

V0.1 不能只看“有代码”，必须有真实可观察链路。

### V0.1-A：用户生活闭环

```text
Android observation
→ Runtime
→ Life State
→ Wake
→ BrainAdapter
→ Decision
→ FCM
→ Android notification
```

### V0.1-B：AI 自身连续性

必须证明：

- AI World 在模型休眠时仍持续；
- AI 有未完成事项；
- 下一次 Wake 可以继续上一次结构化状态；
- AI World 与 Earth 事实不会混淆。

### V0.1-C：Provider 可替换

至少 Mock Brain + 一个真实 Provider 可在同一 Runtime 上工作。

---

# 第十部分｜开发治理：设计文档就是宪法

## OH-G1｜所有开发必须引用设计章节

任何代码改动开始前，必须先回答：

> 这个改动对应 `OUR_HOME_DESIGN.md` 的哪个章节？

如果没有对应章节：

```text
停止编码
→ 先提交设计修改
→ Review
→ 设计通过后再开发
```

禁止“先写了再找理由”。

---

## OH-G2｜Issue 必须可追溯

每个功能 / 重构 / 行为变更 Issue 必须包含：

```text
Design Reference: OH-xx / OH-Px
```

示例：

```text
实现 AI World 状态机
Design Reference: OH-11, OH-20, OH-P3
```

纯 bug 修复可以引用违反的设计约束或现有验收要求。

---

## OH-G3｜PR 必须可追溯

PR 必须说明：

- Design Reference；
- 解决什么用户 / 系统问题；
- 改变了什么；
- 没有改变什么；
- 新增 / 修改了哪些设计测试；
- 是否涉及数据权限 / 成本 / 安全边界。

---

## OH-G4｜测试从设计推导

测试不是只验证“代码按作者写法运行”，而是验证“产品宪法没有被破坏”。

例如：

- OH-30 / OH-32 → EARTH 查询不能返回 AI_WORLD 事实；
- OH-32 → inferred 不得被查询为 observed；
- OH-40 → 相同事件不能产生 wake/message storm；
- OH-45 → Sensitive Guard 不能被 Curiosity / Brain 绕过；
- OH-60 → Runtime Core 不依赖 Hermes 类型；
- OH-63 → WSS 断开时 FCM 链路仍成立；
- OH-69 → raw screenshot 不进入普通长期日志；
- OH-51 → 未审批 Skill / MCP proposal 不得执行安装；
- OH-67 → Brain 不可用时 AI World deterministic state 仍可推进。

每个关键设计原则至少应有一个自动化测试或明确的人工验收步骤。

---

## OH-G5｜每个 Phase 完成后做设计 Review

Phase 不能因为“代码写完了”就结束。

必须逐项检查：

1. 已实现功能是否符合设计描述？
2. 有没有无意中偏离核心原则？
3. 有没有实现了设计里没有的功能？
4. 是否遗漏安全 / 隐私 / 成本 / 用户控制？
5. 测试是否覆盖设计约束？
6. 文档是否仍和代码一致？

Review 结果记录到对应 Issue / PR / phase review 文档。

---

## OH-G6｜修改宪法的规则

设计可以改变，但必须显式改变。

任何会改变以下内容的修改，都需要先改本文件：

- 产品目标；
- 世界观；
- Soul 规则；
- 数据真实性；
- 权限边界；
- 主动行为规则；
- Provider 边界；
- 高层架构；
- Phase 验收标准。

代码不能悄悄改变产品宪法。

---

# 第十一部分｜三个必须一直能回答的问题

任何阶段，项目都必须能清楚回答：

### 1. 这条数据是真的吗？

回答必须包含 world + provenance + source + time。

### 2. 为什么 AI 现在醒了 / 联系用户？

回答必须能追溯 Wake Event、Life State、Decision 和 cooldown / policy。

### 3. 为什么 AI 现在变得更喜欢 / 不喜欢某件事？

回答必须能追溯 Experience、Feedback 和长期偏好更新记录。

如果这三个问题答不出来，说明系统正在失去可解释性。

---

# 最终目标

Our Home 最终不是“一个更主动的聊天机器人”。

它应当表现为：

```text
用户在 Earth Life 持续生活
          ↕
       Our Home
          ↕
AI 在 AI World 持续生活
```

两个个体拥有独立状态、独立经历和各自的变化轨迹，通过 Bridge 相互影响；Runtime 维持连续性和事实边界，Brain 只在真正需要理解、选择、反思和创造时介入。