# OH-P1 — Earth Life 真机验收

Design Reference: OH-31, OH-32, OH-40, OH-41, OH-42, OH-61, OH-64, OH-66, OH-67, OH-P1

Parent Issue: #11

## 目标

证明真实 Android 设备在用户完成 Runtime 配置后，可以无需点击“立即发送心跳”持续产生低敏 telemetry，并通过 HTTPS 可靠进入 Runtime。

```text
Android
→ local Room queue
→ HTTPS ingest
→ persisted observation
→ Life State
```

WorkManager 的 15 分钟周期是 Android 系统调度的近似周期，可能受 Doze / OEM 电池策略延迟。OH-P1 不把它描述为实时链路。

## 前置条件

1. Runtime 以 HTTP transport 启动并配置 `OUR_HOME_INGEST_TOKEN`。
2. Android App 填写 Runtime HTTPS 地址和同一个 bootstrap registration token。
3. 不要求 Usage Access 才能上报 battery / charging / connectivity。
4. 若要验证 foreground package / usage summary，再单独授予 Usage Access。

## A. 未配置时的数据最小化

1. 清除 App 数据或安装新 APK。
2. 不填写 Runtime 地址和 token。
3. 打开 App，等待后台 worker 被安排。
4. 打开“调试 / 诊断”。

预期：

- periodic work 可以处于 scheduled；
- 因 Runtime 尚未配置，UploadWorker 直接成功退出；
- 不因为未配置而产生新的 telemetry pending events；
- 不申请截图、Accessibility、位置、通讯录等额外权限。

## B. 配置后的首轮自动采集

1. 填写 Runtime 地址和注册令牌。
2. 保存配置后重新启动 App；后续 UI 保存动作也应触发 immediate work（见 #16）。
3. 不点击“立即发送心跳”。

预期：

- 已配置设备在 App 进程启动时会 enqueue 一次 immediate UploadWorker；
- 产生 device heartbeat：battery / charging / connectivity；
- heartbeat `clientEventId` 在同一 15 分钟 bucket 内稳定；
- Runtime 保存 `source=phone`、`confidence=observed` 的 observation；
- diagnostics 的 Last successful upload 更新；
- pending event 数回落到 0。

## C. Usage Access 降级

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
4. 等待一次 automatic collection 或触发开发验收用 immediate worker。

预期：

- heartbeat 可携带最近 foreground package；
- usage summary 进入 Runtime；
- Life State 可由近期真实 usage/foreground observation 推导 `active_on_phone`；
- stale usage 不得继续作为当前现实。

## D. 断网排队与恢复

1. 在设备已配置后断开网络。
2. 让 periodic worker 运行一次。

预期：

- 当前状态仍被写入本地 Room pending queue；
- 不因网络错误删除事件；
- 自动安排一个要求 `NetworkType.CONNECTED` 的 immediate work。

3. 恢复网络。

预期：

- pending queue 自动重试；
- 成功 ACK 后删除对应 pending event；
- Last successful upload 更新；
- 重试采用退避，不进行高频请求。

## E. 去重

同一个 periodic heartbeat bucket 重复执行时：

- Android Room `dedupeKey` 只保留一个待发送 heartbeat；
- Runtime 的同一 `clientEventId` 重试不能产生重复 observation；
- 重复上报不得制造 wake storm。

## F. Runtime 证据

OH-P1 验收至少保存这些证据：

- Android diagnostics 截图或文本：worker status、last periodic collection、last successful upload、pending count、Usage Access、last error；
- Runtime observation：deviceId、kind、observedAt、source、confidence、clientEventId；
- Runtime Life State：lastObservedAt、foregroundPackage、battery、charging、connectivity/currentActivity；
- 一次断网 → pending → 恢复上传的记录。

任何 token、FCM credential、设备认证密钥不得出现在验收截图或日志中。

## 当前自动化保护

- JVM: `TelemetryPolicyTest` 验证配置门控和 heartbeat bucket ID 稳定性。
- Android instrumentation: `QueueRepositoryTest` 验证失败保留、成功删除、heartbeat/usage dedupe。
- Node: observation persistence、phone registration auth、usage retention、Life State、Wake dedupe 等测试。
- CI: Android JVM tests + lint + assembleDebug；Node typecheck + tests + build。
