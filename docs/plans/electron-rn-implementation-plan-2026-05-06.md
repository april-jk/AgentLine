# Electron + React Native 技术落地方案

日期：2026-05-06  
适用分支：`codex/mobile-desktop-control-architecture`

## 1. 技术路线结论

目标路线：
- 电脑端：Electron（TypeScript）
- 移动端：React Native（TypeScript）

结论：
- 该路线合理，符合 AgentLine 现有 Node/TypeScript/React/Server 架构。
- 后端、协议、安全链路可高复用（`packages/server`、`packages/shared`、`packages/relay`）。
- 主要重构成本在客户端壳层和移动端 UI 迁移。

## 2. 为什么这条路线可行

1. 与现有栈一致
- 当前核心是 TypeScript + Node + WebSocket/SRP/E2E。
- Electron 主进程与现有服务生命周期管理天然匹配。
- RN 可继续使用 TypeScript，降低团队上下文切换成本。

2. 业务核心可复用
- 会话模型、Provider 执行层、Relay、安全协议都在服务端，客户端只需对接。
- 多主机、重连、远程控制能力已有基础实现。

3. 产品形态匹配
- Electron 适合本地常驻、托盘、开机启动、自动更新。
- RN 适合安装式手机控制端、推送、后台唤醒、深链。

## 3. 单仓目录改造（建议）

目标目录：

```txt
packages/
  desktop-electron/          # 新：桌面端 Electron 应用
    src/main/                # 主进程（server 管理、托盘、更新）
    src/preload/             # IPC bridge
    src/renderer/            # 桌面 UI（React，可复用 client 组件）
  mobile-rn/                 # 新：React Native 应用（Expo 或 bare）
    src/
      screens/
      navigation/
      services/
      store/
  client/                    # 现有 web 客户端（保留，作为过渡和管理台）
  server/                    # 现有服务端（核心复用）
  shared/                    # 共享类型、协议、DTO（核心复用）
  relay/                     # 现有 relay（核心复用）
```

现有包处理建议：
- `packages/desktop`（Tauri）与 `packages/mobile`（Tauri mobile）先保留一段时间作为回滚兜底。
- 新包稳定后再移除旧壳。

## 4. 语言与框架定版

桌面端（Electron）：
- `electron`
- `electron-builder`
- `typescript`
- `react` + `vite`（renderer）
- `electron-updater`（自动更新）

移动端（RN）：
- `react-native` + `typescript`
- 建议 `Expo Dev Client + EAS`（发布链路更稳）
- `@react-navigation/native`
- `expo-secure-store`（或 `react-native-keychain`）
- `react-native-push-notification`/Expo Notifications（二选一按发布方案）

后端与协议（沿用）：
- `Node.js + Hono`
- 现有 SRP + NaCl E2E + Relay
- 现有 provider 适配层

## 5. 首批接口清单（M1 必须）

以下接口建议作为“移动控制端最小闭环”：

1. 主机基础信息
- `GET /api/host/status`
- `GET /api/host/capabilities`

2. 会话控制
- `POST /api/sessions/start`
- `POST /api/sessions/:id/resume`
- `POST /api/sessions/:id/cancel`
- `GET /api/sessions`
- `GET /api/sessions/:id`

3. 操作执行（受控）
- `POST /api/ops/provider/check`
- `POST /api/ops/provider/install`
- `POST /api/ops/server/restart`
- `POST /api/ops/command-template/run`

4. 安全与审计
- `POST /api/auth/reverify`（高风险二次认证）
- `GET /api/audit/events?hostId=...`

5. 连接与实时
- `WS /api/ws`（或现有 relay/ws 流程）
- 支持 message stream + approval action + op status push

## 6. 共享代码策略（重点）

优先共享：
- `packages/shared` 的类型、协议 DTO、风险等级枚举、错误码
- 服务端 SDK 调用契约和响应模型

谨慎共享：
- UI 组件（Web 与 RN 组件体系不同）
- 浏览器特有 hook（RN 不可直接复用）

推荐抽离：
- `packages/shared-runtime/`（可选新包）
  - 请求封装
  - 连接状态机（纯 TS）
  - 会话数据合并逻辑
  - 错误码到文案映射（无 DOM 依赖）

## 7. 分阶段实施（具体到开发任务）

### Phase A：基础工程搭建（1 周）

- 新建 `packages/desktop-electron`，接入最小主进程：
  - 启停本地 server
  - 托盘菜单
  - 打开窗口/开机自启
- 新建 `packages/mobile-rn`：
  - 导航骨架
  - 登录页 + 主机列表页
  - API 客户端和安全存储
- CI 增加基础构建检查：
  - desktop-electron build
  - mobile-rn lint/typecheck

### Phase B：控制闭环（1-2 周）

- RN 接入：
  - 会话列表
  - 会话详情（消息流）
  - 审批面板
- 服务端补齐 host/capabilities 和 ops API
- Electron 增加：
  - 运行状态展示
  - 日志入口与错误提示

### Phase C：安全与稳定性（1-2 周）

- 风险分级 + 二次认证
- 审计事件入库/落盘
- 移动端断线重连、后台恢复、消息补偿
- Relay 抖动与多主机切换稳定性测试

### Phase D：发布准备（1 周）

- Electron 打包签名和自动更新链路
- RN 双平台打包与渠道配置
- 上线文档与回滚策略

## 8. 风险与应对

风险 1：RN UI 重写工作量被低估  
应对：先做“控制闭环页面”，非高频页面后置；必要时短期 WebView 过渡。

风险 2：加密/鉴权在 RN 环境兼容问题  
应对：优先验证 SRP + NaCl 在 RN 的随机数与存储依赖；尽早做 POC。

风险 3：桌面壳迁移引入进程管理回归  
应对：先保留 Tauri 版本，双壳并行一段时间；覆盖 server 生命周期回归测试。

## 9. 本周可立即开工事项

1. 创建两个新包骨架：`desktop-electron`、`mobile-rn`。  
2. 在 `shared` 增加 `host/status/capabilities` DTO。  
3. 在 `server` 实现 `GET /api/host/status` 和 `GET /api/host/capabilities`。  
4. 在 RN 中完成“登录 -> 主机列表 -> 会话列表”的最小链路。  
5. 在 Electron 中完成“启动 server -> 打开控制台页面 -> 托盘状态”的最小链路。  
