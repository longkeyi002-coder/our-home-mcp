# Hermes Companion Android V0.1

这是 Hermes Life Runtime 的 Android companion。它只上报用户明确允许的基础设备状态和手动状态，不读取屏幕内容。

## 架构

```text
Android Companion
  ├─ BatteryManager / ConnectivityManager
  ├─ UsageStatsManager（仅包名，需用户授权）
  ├─ Room pending_events
  └─ WorkManager retry
          ↓ HTTPS
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

### GitHub Actions 自动构建

仓库中的 `.github/workflows/android-companion.yml` 会在 Android Companion 代码变更或手动触发时，使用 JDK 17、Android SDK 35 和 Gradle Wrapper 运行测试并构建 Debug APK。构建完成后，可在对应的 GitHub Actions run 的 Artifacts 中下载 `hermes-companion-debug-apk`。

## 配置和首次连接

1. 在服务端设置 `OUR_HOME_INGEST_TOKEN`，启动 HTTP 服务并通过 HTTPS 暴露。
2. 安装 App，在 Settings 中填写 Hermes Server HTTPS Base URL。
3. 填写服务端的 ingest token（仅用于首次注册；App 会用 Android Keystore 加密保存 bootstrap 和 device token）。
4. 点击 `Save and connection test`。App 调用 `/v1/phone/register`，随后上传排队的心跳。

要启用 FCM，把项目自己的 `google-services.json` 放到 `android-companion/app/`（该文件已被 gitignore），再构建安装。没有此文件时 Firebase Google Services 插件不会启用，CI 仍可编译和运行 JVM 测试。App 会获取 Firebase Installation ID 与 registration token，并通过同一个受保护的 `/v1/phone/register` 更新；token refresh 也会重新注册。

服务端仍接受旧格式的 `Authorization: Bearer <OUR_HOME_INGEST_TOKEN>`，因此已有客户端保持兼容。注册返回的设备 token 是由服务端 ingest token 和 device ID 派生的设备凭据，服务端不保存明文 token。

## 权限

- `INTERNET`：访问配置的 Hermes API。
- `ACCESS_NETWORK_STATE`：报告 online/offline connectivity state。
- `POST_NOTIFICATIONS`：Android 13+ 首次启动请求，用于显示 Hermes Life 系统通知。
- Usage Access（用户在系统设置中主动授予）：读取最近的 foreground package 名称。未授权时显示 `Permission required`，不会上传屏幕内容。

不申请定位、通知全文、通讯录、短信、麦克风、相机、Accessibility 或截屏权限。

## 已实现

- 可配置 HTTPS server URL。
- 设备注册和 Keystore 加密凭据。
- 电量、充电状态、网络状态、App 版本心跳。
- UsageStatsManager 前台 package 摘要（有权限时）。
- 手动状态：在家、上班、通勤、忙、休息、睡觉、累、自定义状态。
- Room 本地事件队列；上传成功收到 HTTP 2xx 后删除，失败保留并按指数退避重试。
- WorkManager 一次性上传和 15 分钟周期上传。
- Debug / Diagnostics 页面。
- FCM 前台消息主动显示固定 `hermes_life` channel 的系统通知；后台 notification payload 使用 FCM/Android 标准系统行为，点击后打开现有 Companion Activity。

## Android 后台限制和未实现

V0.1 不承诺永久驻留或实时采集。WorkManager 的周期任务最短约 15 分钟，并可能因 Doze、厂商省电策略或系统调度延迟。UsageStatsManager 只能在任务运行时查询最近事件；没有授权或系统尚未产生事件时，前台包名可能为空。

本版本未实现 GPS 持续定位、截图、OCR、屏幕内容、Accessibility 内容监听、微信聊天、通知全文、麦克风、相机、联系人、SMS 和 keylogger。

## 测试

普通 JVM 测试覆盖 API URL 校验和 JSON 字段序列化；Android instrumentation 测试覆盖 Room 队列、失败保留和成功 ACK 删除：

```bash
./gradlew test
./gradlew connectedAndroidTest
```

Instrumentation 测试需要已连接 Android 模拟器或真机。
