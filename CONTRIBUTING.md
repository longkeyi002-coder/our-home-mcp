# Contributing to Our Home

## 1. 先看设计宪法

开始任何功能、重构、行为变化或测试工作前，先阅读：

`docs/OUR_HOME_DESIGN.md`

它是本开发线唯一的设计真相来源。

开始编码前必须回答：

> 这个改动对应设计文档的哪个章节？

如果没有对应章节，先停止编码并修改设计文档。

---

## 2. 三个不可绕过的核心原则

1. **两个世界的数据必须隔离。** Earth、AI World、Fiction 必须保留明确的 world / provenance 边界。
2. **AI 与用户是双向关系。** AI 不是纯工具，但主动行为必须尊重用户控制、安静策略和权限边界。
3. **AI 的长期偏好从经历中形成。** 不用固定 personality/likes 配置伪装成长；Soul 的变化必须可追溯、缓慢、可解释。

此外，Runtime Core 必须保持 provider-neutral，Hermes 只是一个 BrainAdapter。

---

## 3. Issue 要求

每个功能、重构或行为变更 Issue 必须包含：

```text
Design Reference: OH-xx, OH-Px
User/System Problem: ...
Acceptance: ...
Risk: privacy / safety / cost / none
```

如果是 bug：引用被违反的设计章节或验收要求。

---

## 4. PR 要求

每个 PR 必须写明：

```text
Design Reference:
Problem:
What changed:
What intentionally did NOT change:
Design-derived tests:
Privacy / safety / cost impact:
```

Review 时先对照设计，不先对照实现偏好。

---

## 5. 测试从设计推导

重要测试必须能够回答“它在保护哪条设计约束”。

示例：

- `OH-30/OH-32`：EARTH 查询不能混入 AI_WORLD 事实。
- `OH-40`：重复事件不能制造 wake/message storm。
- `OH-60`：Runtime Core 不依赖 Hermes 类型。
- `OH-63`：WSS 断线不影响 FCM delivery。
- `OH-51`：未审批的 Skill/MCP proposal 不能执行安装。
- `OH-67`：Brain Provider 失败时 Runtime / AI World 的低成本状态仍能运行。

新增关键设计能力时，同一 PR 应加入对应自动化测试；无法自动化时必须写人工验收步骤。

---

## 6. Phase Review

每个 Phase 结束前必须做一次设计 Review：

- 功能是否符合设计；
- 是否出现设计外功能；
- 是否偏离核心原则；
- 是否遗漏用户控制；
- 是否遗漏隐私 / 安全 / 成本约束；
- 测试是否来自设计要求；
- 文档与代码是否一致。

没有完成 Review，不把 Phase 标记为完成。

---

## 7. 分支规则

当前唯一新开发线：

`rebuild/ai-life-runtime-v01`

`main` 和旧实验分支只作为参考。不要 force-push，不删除历史，不整体合并已经归档的实验 PR。

---

## 8. Secrets 与权限

禁止提交：

- Provider API keys；
- FCM service account secrets；
- 长期公网 tunnel token；
- 固定生产 device credentials；
- 正式 signing private key。

任何新增权限或外部副作用能力都要先对照 `OH-42`、`OH-50`、`OH-51`、`OH-52`。
