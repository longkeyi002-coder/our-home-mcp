# Hermes Companion Android V0.2

这是 Hermes Life Runtime 的 Android companion。它只上报用户明确允许的设备状态、App Timeline、Steps 和手动状态，不读取屏幕内容。

## 架构

```text
Android Companion
  ├─ BatteryManager / ConnectivityManager
  ├─ UsageStatsManager（App Timeline，仅包名，需用户授权）
  ├─ SensorManager（Steps，需活动识别权限）
  ├─ Room pending_events
  └─ WorkManager retry
          ↓ HTTPS（localhost 开发可 HTTP）
Public Hermes API
  ├─ POST /v1/phone/register
  ├─ POST /v1/phone/heartbeat
  └─ POST /v1/observations
          ↓
Life State → Life Loop → AI
```

## 构建和安装

需要 Android Studio、JDK 17 和 Android SDK 35。打开 `android-companion/`，同步 Gradle 后运行：

```bash
./gradlew test
./gradlew assembleDebug
./gradlew lint
```

Debug APK 输出在 `app/build/outputs/apk/debug/app-debug.apk`。可以用 Android Studio 安装，或使用 `adb install -r`。

## 配置和首次连接

1. 在服务端设置 `OUR_HOME_INGEST_TOKEN`，启动 HTTP 服务并通过 HTTPS 暴露。
2. 安装 App，在 Settings 中填写 Hermes Server HTTPS Base URL。
3. 填写服务端的 ingest token（仅用于首次注册；App 会用 Android Keystore 加密保存 bootstrap 和 device token）。
4. 点击 `Save and connection test`。App 调用 `/v1/phone/register`，随后上传排队的心跳。

服务端仍接受旧格式的 `Authorization: Bearer <OUR_HOME_INGEST_TOKEN>`，因此已有客户端保持兼容。注册返回的设备 token 是由服务端 ingest token 和 device ID 派生的设备凭据，服务端不保存明文 token。

## 权限

- `INTERNET`：访问配置的 Hermes API。
- `ACCESS_NETWORK_STATE`：报告 online/offline connectivity state。
- Usage Access（用户在系统设置中主动授予）：读取 App Timeline 的包名和使用时间。未授权时不会上传屏幕内容。
- `ACTIVITY_RECOGNITION`：读取系统步数传感器，按本地日计算 Steps。
- `POST_NOTIFICATIONS`：显示可选实时模式的前台服务通知和“立即同步”动作。

不申请定位、通知全文、通讯录、短信、麦克风、相机、Accessibility 或截屏权限。

## 已实现

- 可配置 HTTPS server URL。
- 设备注册和 Keystore 加密凭据。
- 电量、充电状态、网络状态、App 版本心跳。
- UsageStatsManager 前台 package 摘要（有权限时）。
- App Timeline：前台应用包名、开始/结束时间和使用时长摘要。
- Steps：使用系统 `TYPE_STEP_COUNTER` 按本地日计算步数摘要。
- 手动状态：在家、上班、通勤、忙、休息、睡觉、累、自定义状态。
- Room 本地事件队列；上传成功收到 HTTP 2xx 后删除，失败保留并按指数退避重试。
- WorkManager 一次性上传和 15 分钟周期上传。
- 可选 Foreground Service 实时模式：约每 60 秒采集并上传一次，并提供通知栏“立即同步”动作。
- Debug / Diagnostics 页面。

## Android 后台限制和未实现

默认模式不承诺永久驻留或实时采集。WorkManager 的周期任务最短约 15 分钟，并可能因 Doze、厂商省电策略或系统调度延迟。用户可主动开启 Foreground Service 实时模式，但系统和厂商仍可能限制后台运行。UsageStatsManager 只能在任务运行时查询最近事件；没有授权或系统尚未产生事件时，Timeline 可能为空。

本版本未实现 GPS 持续定位、截图、OCR、屏幕内容、Accessibility 内容监听、微信聊天、通知全文、麦克风、相机、联系人、SMS 和 keylogger。

## 测试

普通 JVM 测试覆盖 API URL 校验和 JSON 字段序列化；Android instrumentation 测试覆盖 Room 队列、失败保留、失败 retry、401 重新注册和成功 ACK 删除：

```bash
./gradlew test
./gradlew connectedAndroidTest
```

Instrumentation 测试需要已连接 Android 模拟器或真机。
