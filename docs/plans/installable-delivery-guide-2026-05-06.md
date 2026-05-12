# 双端可安装交付指南（Electron + RN）

日期：2026-05-06

## 目标

本指南用于产出可安装包：

- 桌面端：Electron 安装包（macOS/Windows/Linux）
- 移动端：React Native 安装包（Android APK、iOS 模拟器包）

## 1) 环境依赖修复

若 `pnpm typecheck` 报 `packages/shared/node_modules/typescript/bin/tsc` 丢失：

```bash
pnpm install
pnpm typecheck
```

说明：该问题来自 workspace 依赖软链失效，重新安装后可恢复。

## 2) 桌面端打包（Electron）

### 2.1 关键命令

```bash
# 开发调试
pnpm dev:desktop-electron

# 仅构建桌面代码
pnpm build:desktop-electron

# 生成本地目录产物（unpacked）
pnpm dist:desktop-electron

# 生成 macOS 安装包
pnpm dist:desktop-electron:mac

# 生成 Windows 安装包
pnpm --filter @agentline/desktop-electron dist:win
```

### 2.2 产物位置

- `packages/desktop-electron/release/`

### 2.3 运行机制

打包前会自动执行 `prepare:runtime`：

1. 根目录执行 `pnpm build:bundle` 生成 server 可分发内容
2. 拷贝到 `packages/desktop-electron/runtime/agentline`
3. 在 runtime 里安装生产依赖（`npm install --omit=dev`）
4. 打包时作为 `extraResources` 内置进安装包

这保证安装后不依赖你本地源码仓库即可启动内置 server。

## 3) 移动端打包（RN / Expo）

### 3.1 关键命令

```bash
# 开发调试
pnpm dev:mobile-rn

# 类型检查
pnpm typecheck:mobile-rn

# Android Debug APK（可直接安装）
pnpm dist:mobile-rn:android:debug-apk

# Android Release APK（需要签名配置）
pnpm dist:mobile-rn:android:release-apk

# iOS 模拟器包
pnpm dist:mobile-rn:ios:simulator
```

### 3.2 产物位置

Android：
- `packages/mobile-rn/android/app/build/outputs/apk/debug/app-debug.apk`
- `packages/mobile-rn/android/app/build/outputs/apk/release/app-release.apk`（若签名配置完成）

iOS：
- 由 `expo run:ios` 生成并安装到模拟器（真机 IPA 需要 Apple 签名体系）

## 4) 当前可交付边界

已可交付：
- Electron 桌面端可构建并进入安装包流程
- RN 移动端可生成 Android 可安装 APK（debug）

需要你提供后可完成“商用发布”：
- macOS 签名/公证证书
- Windows 代码签名证书（可选但建议）
- Android release keystore
- iOS 开发者签名配置（证书 + profile）

## 5) 最小验收清单

1. 安装桌面端应用，确认可启动并看到 server 状态页。  
2. 桌面端点击 `Open Dashboard` 可打开本地 AgentLine。  
3. 安装 Android APK，打开后看到登录/主机/会话占位三屏。  
4. `pnpm typecheck` 无报错。  

## 6) 本次已生成产物（2026-05-06）

桌面端（macOS）：
- `/path/to/AgentLine/packages/desktop-electron/release/AgentLine Desktop-0.1.0-arm64.dmg`
- `/path/to/AgentLine/packages/desktop-electron/release/AgentLine Desktop-0.1.0-arm64-mac.zip`

移动端（Android）：
- `/path/to/AgentLine/packages/mobile-rn/android/app/build/outputs/apk/debug/app-debug.apk`

移动端（iOS 模拟器）：
- `/path/to/DerivedData/AgentLineMobile/Build/Products/Release-iphonesimulator/AgentLineMobile.app`

## 7) 安装方式（本机）

Android APK 安装到已连接设备：

```bash
adb install -r /path/to/AgentLine/packages/mobile-rn/android/app/build/outputs/apk/debug/app-debug.apk
```

iOS 模拟器安装（若需要手动重装）：

```bash
xcrun simctl install booted /path/to/DerivedData/AgentLineMobile/Build/Products/Release-iphonesimulator/AgentLineMobile.app
```
