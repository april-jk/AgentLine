# Relay 账号硬门控（方案2）实施计划

日期：2026-05-13  
状态：待审计（未实施）

## 1. 问题复盘（当前漏洞）

现象：电脑端账号退出后，手机端仍可通过 relay 转发连接该主机。

根因是“控制面”和“数据面”没有做强绑定：

1. 控制面会话（`/api/v1/auth/logout`）只撤销 `user_sessions`。
2. Relay 数据面配对（`server_register` / `client_connect`）当前只依赖 `relayUsername + waiting socket`。
3. 桌面端 relay waiting 连接可在账号登出后继续存活，且移动端连接时不携带账号级凭证。

结果：账号登出并不会硬切断 relay 可用性，属于高危授权绕过。

## 2. 安全目标

必须同时满足：

1. Relay 建连必须绑定“当前有效账号会话”，而不是仅绑定 `relayUsername`。
2. 桌面端登出后，已有 waiting/paired relay 链路必须被立刻切断。
3. 移动端每次点击连接都必须带账号授权证明，且证明短时有效、一次性可消费。
4. 默认失败关闭（fail closed）：任一授权校验失败即拒绝中继。

## 3. 非目标（本次不做）

1. 不改 SRP 主机访问密码协议本身（继续沿用现有密码校验链路）。
2. 不改直连（LAN）认证流程。
3. 不引入新外部依赖（优先 Node 内置 `crypto` + 现有 DB 能力）。

## 4. 方案总览（方案2落地形态）

采用“双授权票据 + 会话硬切断”：

1. `server_register_grant`（桌面端票据）  
   桌面端每次向 relay 注册 waiting 连接前，必须先用当前账号 token 从控制面申请短时票据。
2. `client_connect_grant`（手机端票据）  
   手机端每次点击连接前，必须先用当前账号 token 申请一次性票据，再发起 `client_connect`。
3. Relay 在配对时必须同时校验：  
   - client grant 有效；  
   - waiting server 绑定了有效 server grant；  
   - server/client 同账号；  
   - server 绑定会话未被撤销。  
4. 账号登出时，除了撤销 `user_sessions`，还要按 `sessionId` 立刻断开所有 waiting/paired relay 连接。

## 5. 数据模型改造

新增表：`relay_grants`

字段建议：

1. `id`（uuid，主键）
2. `grant_type`（`server_register` | `client_connect`）
3. `token_hash`（sha256，唯一）
4. `user_id`
5. `session_id`
6. `device_id`（client grant 必填；server grant 对应桌面 device）
7. `relay_username`
8. `install_id`（server grant 必填）
9. `issued_at`
10. `expires_at`
11. `consumed_at`（一次性消费时间）
12. `revoked_at`（可选，批量撤销用）
13. `metadata_json`（可选扩展）

索引建议：

1. `token_hash` 唯一索引
2. `(grant_type, expires_at)` 过期清理索引
3. `(session_id, grant_type)` 会话级撤销索引

## 6. 协议与接口改造

### 6.1 控制面新接口

1. `POST /api/v1/relay/grants/server-register`
   - Auth: `Bearer accessToken`
   - 入参：`installId`, `relayUsername`, `deviceId`（可选，默认按当前 installId 解析）
   - 出参：`grant`, `grantId`, `expiresAt`

2. `POST /api/v1/relay/grants/client-connect`
   - Auth: `Bearer accessToken`
   - 入参：`deviceId`（或 `relayUsername`，推荐 `deviceId`）
   - 出参：`grant`, `grantId`, `relayUsername`, `expiresAt`

3. `POST /api/v1/auth/logout` 增强
   - 在 `revokeSession(sessionId)` 之后，调用 `disconnectRelayBySession(sessionId)`。

### 6.2 Relay WebSocket 协议变更

在 `@agentline/shared` 中扩展：

1. `RelayServerRegister`
   - 新增字段：`serverGrant: string`
2. `RelayClientConnect`
   - 新增字段：`clientGrant: string`
3. `RelayClientErrorReason` 新增
   - `auth_required`
   - `grant_invalid`
   - `grant_expired`
   - `grant_consumed`
   - `account_mismatch`
   - `server_session_revoked`

## 7. 关键校验逻辑（Relay 侧）

### 7.1 `server_register` 时

1. 必须带 `serverGrant`。
2. 校验 grant：类型、过期、未消费、`relayUsername` 匹配、`installId` 匹配、`session` 有效。
3. 消费 grant（标记 `consumed_at`）。
4. 把 `userId/sessionId/deviceId` 绑定到该 waiting socket 的上下文。

### 7.2 `client_connect` 时

1. 必须带 `clientGrant`。
2. 校验 client grant：类型、过期、未消费、目标设备/`relayUsername` 匹配。
3. 获取目标 waiting server 的账号上下文并校验：
   - `server.userId === clientGrant.userId`
   - `server.sessionId` 仍为有效会话（未撤销、未过期）
4. 任一失败直接拒绝配对并记录审计日志。
5. 校验通过后消费 client grant，再建立 pair。

### 7.3 登出即时切断

1. `logout` 成功后，relay 扫描当前连接上下文中 `sessionId=被撤销会话` 的 waiting/paired 连接。
2. 统一关闭并写日志（原因：`session_revoked_logout`）。

## 8. 客户端与桌面端改造

### 8.1 桌面服务端（`packages/server`）

1. `ControlPlaneBridgeService` 新增申请 `server-register grant` 的能力。
2. `RelayClientService` 在每次连接/重连时先拿 grant，再发送 `server_register`。
3. 无 token 或 grant 申请失败时，不允许进入 waiting 状态（fail closed）。
4. 退出账号后（已有 `accessToken` 清空 + 重启），由于无法获取 grant，relay 连接不会重新建立。

### 8.2 手机端（`packages/client`）

1. 设备列表点击连接前，先调用 `client-connect grant` 接口。
2. `connectViaRelay` 与 relay 重连流程都必须携带 `clientGrant`。
3. 若无账号态（无 control-plane token），拒绝 relay 连接并引导先登录账号。

## 9. 灰度与上线步骤

建议分三阶段，避免一次性切换导致全量不可用：

1. 阶段A（兼容发布）
   - Relay 支持新字段校验，但先不强制（记录缺失日志）。
   - 发布 server/client 发 grant 版本。
2. 阶段B（小流量强制）
   - 开启 `RELAY_REQUIRE_GRANTS=true` 于 staging/小流量环境。
   - 重点观察 grant 校验失败分布。
3. 阶段C（全量强制）
   - 生产全量开启强制校验。
   - 移除旧无 grant 路径。

建议开关：

1. `RELAY_REQUIRE_SERVER_GRANT`
2. `RELAY_REQUIRE_CLIENT_GRANT`
3. `RELAY_ENFORCE_SERVER_SESSION_ACTIVE`

## 10. 验证计划（必须通过）

### 10.1 单元测试

1. grant 发行与消费（一次性、过期、重放）
2. session 撤销后 grant 失效
3. 账号不一致拦截

### 10.2 集成测试

1. 正常链路：桌面登录 -> 手机登录 -> 连接成功
2. 核心安全链路：桌面登出后，手机再次点击连接被拒绝
3. 登出即时性：登出时已有 paired 连接被主动断开
4. 重放攻击：重复使用同一 `clientGrant` 被拒绝
5. 会话过期：`server.session` 过期后即便 waiting 存在也不可配对

### 10.3 回归测试

1. 直连（LAN）不受影响
2. SRP 密码认证流程不回归
3. 设备列表加载与在线态显示不回归

## 11. 监控与审计日志

新增日志字段（relay）：

1. `grantType`, `grantId`, `grantCheckResult`
2. `rejectReason`
3. `userId`, `sessionId`, `deviceId`, `relayUsername`

关键告警：

1. `grant_invalid/grant_expired` 比例突增
2. `account_mismatch` 非零持续出现
3. `server_session_revoked` 触发率异常升高

## 12. 回滚策略

如出现生产阻断：

1. 临时关闭 `RELAY_REQUIRE_*` 强制开关（仅保留日志）
2. 保留 `logout -> disconnectBySession`（该能力应持续保留）
3. 修复后再灰度开启强制校验

## 13. 实施拆分（PR 级）

1. PR-1：`relay_grants` 数据层 + 控制面发行接口 + 单测
2. PR-2：shared 协议扩展 + relay 校验逻辑 + 日志/监控
3. PR-3：server 端 grant 获取 + `RelayClientService` 注入
4. PR-4：client 端连接前 grant 获取 + 重连路径改造
5. PR-5：logout 即时切断 + 集成测试与 e2e
6. PR-6：强制开关全量开启 + 清理旧路径

## 14. 需你审计拍板的决策点

1. 是否彻底禁用“无账号手工 relay 登录”路径（建议：禁用）。
2. `clientGrant` TTL：30 秒还是 60 秒（建议：60 秒，兼顾弱网）。
3. `serverGrant` TTL：60 秒并每次重连重取（建议：是）。
4. 登出时是否强制断开“已配对中的活跃会话”（建议：是，安全优先）。
5. 强制开关灰度周期（建议：staging 24 小时 + 生产 10%/30%/100%）。

