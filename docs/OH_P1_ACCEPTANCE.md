# OH-P1 — Earth Life 真机验收

Design Reference: OH-31, OH-32, OH-40, OH-41, OH-42, OH-61, OH-64, OH-66, OH-67, OH-P1

Parent Issue: #11

## 目标

证明真实 Android 设备可以在首次安装后自动完成 Runtime enrollment，随后无需点击“立即发送心跳”持续产生低敏 telemetry，并通过 HTTPS 可靠进入 Runtime。

```text
Android stable APK
→ default Runtime + register-only enrollment
→ device token
→ local Room queue
→ HTTPS ingest
→ persisted observation
→ Life State
```

WorkManager 的 15 分钟周期是 Android 系统调度的近似周期，可能受 Doze / OEM 电池策略延迟。OH-P1 不把它描述为实时链路。

## 前置条件

1. Runtime 以 HTTP transport 启动并配置 `OUR_HOME_INGEST_TOKEN`。
2. Runtime 推荐额外配置 `OUR_HOME_ENROLLMENT_TOKEN`；该 token 只能注册设备，不能直接 heartbeat/observations/MCP。
3. 用户安装版 APK 通过稳定 signing identity 构建，并注入 `OUR_HOME_DEFAULT_RUNTIME_URL` + register-only enrollment token。
4. MCP token 永不进入 Android APK。
5. 不要求 Usage Access 才能上报 battery / charging / connectivity。
6. 若要验证 foreground package / usage summary，再单独授予 Usage Access。

## A. 首次安装自动配置

1. 安装带稳定签名、默认 Runtime URL 和 enrollment token 的用户版 APK。
2. 不手动填写任何 URL/token。
3. 首次打开 App。

预期：

- 本地无显式配置时采用 build-time 默认 Runtime；
- 自动使用 register-only enrollment token 调用 `/v1/phone/register`；
- registration 成功后保存 device token；
- UI 只有真实 registration 成功后才显示“已连接”；
- manual settings 默认不显示；
- 自动注册失败时才展开手动配置 fallback，并显示具体阶段错误；
- 本地已有显式 custom Runtime 时默认配置不得覆盖它。

安全验收：

- enrollment token 直接调用 `/v1/phone/heartbeat` 或 `/v1/observations` 必须 401；
- MCP token 不得存在于 APK 配置、诊断文本或本地 Android 配置字段；
- 复制诊断只能显示 credential-present flags，不得显示 credential 值。

## B. 首轮自动采集

首次 registration 后不点击“立即发送心跳”。

预期：

- App enqueue immediate UploadWorker；
- `Last worker run` 更新；
- immediate worker 状态可单独观察；
- 产生 device heartbeat：battery / charging / connectivity；
- heartbeat `clientEventId` 在同一 15 分钟 bucket 内稳定；
- Runtime 保存 `source=phone`、`confidence=observed` 的 observation；
- diagnostics 的 Last successful upload 更新；
- pending event 数回落到 0。

注意：`Last periodic collection: never` 只表示 15 分钟 periodic worker 尚未实际执行，不能单独据此判断 immediate worker 是否工作。

## C. 认证失败诊断

使用错误 enrollment/bootstrap token 做一次手动 fallback 验证。

预期：

- `/healthz` 可达不能被显示成“已连接”；
- registration 401 显示类似 `registration HTTP 401 — token rejected`；
- device-token 上传 401 和 re-registration 401 可区分阶段；
- pending event 不因 401 丢失；
- 修正 token 后 registration 成功，pending 自动继续上传。

## D. Usage Access 降级

### 未授权

预期：

- battery / charging / connectivity 继续工作；
- foreground package 为 null；
- 不产生 usage summary；
- 不把“没有权限”伪装成“用户没有使用 App”。

### 已授权

1. 从 App 打开 Usage Access 设置。
2. 授权后回到 App。
3. 正常切换几个 App。
4. 等待 automatic collection 或触发开发验收用 immediate worker。

预期：

- UsageEvents 有活跃 session 时优先使用其当前 package；
- OEM 未提供活跃 session 时，可使用最近约 2 分钟 UsageStats 作为保守 fallback；
- 超过 freshness window 的旧 app 不得作为当前现实；
- usage summary 进入 Runtime；
- Life State 可由近期真实 usage/foreground observation 推导 `active_on_phone`。

## E. 断网排队与恢复

1. 在设备已配置后断开网络。
2. 让 worker 运行一次。

预期：

- 当前状态仍被写入本地 Room pending queue；
- 不因网络错误删除事件；
- immediate worker 进入等待网络/重试状态；
- `Last worker run` 与 worker 状态能用于区分“没运行”和“运行但没上传”。

3. 恢复网络。

预期：

- pending queue 自动重试；
- 成功 ACK 后删除对应 pending event；
- Last successful upload 更新；
- 重试采用退避，不进行高频请求。

## F. 去重

同一个 periodic heartbeat bucket 重复执行时：

- Android Room `dedupeKey` 只保留一个待发送 heartbeat；
- Runtime 的同一 `clientEventId` 重试不能产生重复 observation；
- 重复上报不得制造 wake storm。

## G. 稳定签名升级

用户安装版只允许来自 `Our Home Android Stable APK` workflow（或等价固定 keystore 构建）。

验收：

1. 保存第一次稳定构建的 signer certificate SHA-256。
2. 再生成下一版 stable APK。
3. signer certificate SHA-256 必须一致。
4. versionCode 必须高于已安装版本。
5. 直接覆盖安装，不卸载 App。

预期：

- 安装成功；
- Device ID、本地 Runtime/device token、pending queue 保留；
- Usage Access 等 package-level 用户授权不因签名变化被迫重新开始。

如果当前手机装的是历史随机 CI debug-key APK，而对应私钥已经不存在，则无法密码学上制造同签名升级；最多进行一次迁移到固定 keystore，之后所有版本必须沿用该 signing identity。

## H. Runtime 证据

OH-P1 验收至少保存这些证据：

- Android “复制诊断信息”文本：app version、deviceId、Runtime URL（query 已去除）、periodic/immediate worker status、last worker run、last periodic collection、last successful upload、pending count、Usage Access、credential-present flags、last error；
- Runtime observation：deviceId、kind、observedAt、source、confidence、clientEventId；
- Runtime `/v1/phone/status`：lastSeenAt / lastHeartbeatAt / lastObservationAt；
- Runtime Life State：lastObservedAt、foregroundPackage、battery、charging、connectivity/currentActivity；
- 一次断网 → pending → 恢复上传的记录；
- stable APK signing certificate SHA-256。

任何 token、FCM credential、keystore/password、设备认证密钥不得出现在验收截图或日志中。

## 当前自动化保护

- JVM Android: telemetry policy、auto-config planning、API error stage、diagnostics redaction、usage freshness fallback。
- Android instrumentation: Room queue 失败保留、成功删除、heartbeat/usage dedupe。
- Node: observation persistence、phone registration auth、register-only enrollment token、usage retention、Life State、Wake dedupe 等测试。
- CI: Android JVM tests + lint + assembleDebug；Node typecheck + tests + build。
- User install build: fixed-keystore workflow requires signing/default Runtime/enrollment configuration and verifies signer certificate。
