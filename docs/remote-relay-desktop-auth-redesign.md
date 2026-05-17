# 远程中转鉴权改造说明（桌面端强鉴权版）

## 1. 背景

当前远程访问链路已经具备以下能力：

- 桌面端登录平台账号后，自动向控制平面注册设备并发送心跳
- 手机端登录同一平台账号后，可以看到设备在线状态并发起连接
- 中转服务器只保存平台账号、设备、grant、连接映射，不保存桌面端访问密码
- 桌面端通过 SRP 校验访问密码，密码本身不会发到中转服务器

但当前仍存在一个不符合目标设计的问题：

- 电脑端退出平台账号后，手机端仍然可以继续连接并远程控制

这说明“平台账号登录态”和“桌面端是否允许远程访问”的绑定还不够硬。

---

## 2. 目标行为

目标行为明确为：

1. 平台账号登录态由桌面端心跳维持，服务端只维护“此桌面是否在线且已登录平台账号”
2. 手机端点击连接后，中转服务器只负责路由和平台账号校验，不负责最终放行
3. 最终是否允许建立远程连接，必须由桌面端在连接建立时再次判断
4. 桌面端只有在“当前仍登录平台账号”的情况下，才允许进行桌面侧认证
5. 桌面端退出平台账号后：
   - 不再发送有效心跳
   - 不再允许新的中转连接建立
   - 既有可恢复远程 session 失效
   - 中转 grant 即使之前签发过，也不能再被桌面端放行

一句话概括：

> 中转服务器负责“找到这台机器并把流量送过去”，桌面端负责“决定这次连接能不能进来”。

---

## 3. 现状设计

### 3.1 当前链路分层

当前逻辑实际上分成三层：

1. 控制平面账号层
   - 维护平台账号登录态
   - 维护 device / heartbeat / relay username
   - 给桌面端签发 `server-register grant`
   - 给手机端签发 `client-connect grant`

2. Relay 路由层
   - 桌面端用 `server-register grant` 注册到 relay
   - 手机端用 `client-connect grant` 请求连接到对应桌面
   - relay 只校验 grant、账号是否一致、桌面对应平台 session 是否还有效

3. 桌面端主机鉴权层
   - 桌面端收到连接后，走 SRP 或 SRP resume
   - SRP 成功后创建远程 session
   - 后续可以用远程 session resume 直接恢复连接

### 3.2 当前“谁在放行”

当前实际放行是两段式：

1. relay 先放行“客户端是否可以接入到桌面 WebSocket”
2. 桌面再放行“访问密码是否正确 / resume proof 是否正确”

问题在于第二段放行目前只依赖“主机访问密码/SRP session 是否有效”，没有硬绑定“桌面当前是否仍登录平台账号”。

---

## 4. 现状实现方式

### 4.1 桌面端在线与平台登录态维护

相关代码：

- `packages/server/src/services/ControlPlaneBridgeService.ts`
- `packages/server/src/index.ts`

当前方式：

- 桌面端通过 `ControlPlaneBridgeService.syncNow()` 执行：
  - `registerDevice()`
  - `ensureRelayConfig()`
  - `sendHeartbeat()`
- 若控制平面返回 `401`，桌面端会：
  - `stop()`
  - 设置 `pausedReason = "unauthorized"`
- 桌面端启动 relay client 时，会先检查 control-plane bridge 状态
  - 未配置或 `unauthorized` 时，不启动 relay client

结论：

- “桌面是否保持 relay 在线”已经和平台登录态部分绑定
- 这一层本身不是主要漏洞点

### 4.2 手机端发起中转连接

相关代码：

- `packages/relay/src/index.ts`
- `packages/relay/src/control-plane.ts`
- `packages/relay/src/ws-handler.ts`

当前方式：

- 手机端平台 token 调 `POST /api/v1/relay/grants/client-connect`
- 服务端 `issueClientConnectGrant()` 会校验：
  - 设备归属当前账号
  - 设备 `last_seen_at` 没超时，否则报 `device_offline`
- relay WebSocket 收到 `client_connect` 时，会校验：
  - `clientGrant` 是否有效
  - grant 对应账号是否和等待中的桌面连接一致
  - 桌面注册时绑定的平台 session 是否仍有效

结论：

- relay 已经能保证“这是同账号设备，且桌面对应平台 session 在 relay 看来还没被撤销”
- 但 relay 这里只是“允许流量对接到桌面”，还不是最终业务放行

### 4.3 桌面端 SRP / session resume 放行

相关代码：

- `packages/server/src/routes/ws-srp-handlers.ts`
- `packages/server/src/routes/ws-relay-handlers.ts`
- `packages/server/src/remote-access/RemoteAccessService.ts`
- `packages/server/src/remote-access/RemoteSessionService.ts`

当前方式：

- `handleSrpHello()` 只校验：
  - `remoteAccessService.getCredentials()` 是否存在
  - 用户名是否匹配
- `handleSrpProof()` 成功后创建远程 session
- `handleSrpResumeInit()` / `handleSrpResume()` 只校验：
  - 本地 `RemoteSessionService` 里 session 是否存在
  - proof 是否有效
  - session 是否过期

关键点：

- 这里没有检查 `ControlPlaneBridgeService` 当前是否仍然是已登录/已授权状态
- 也没有检查“此远程 session 是否创建于当前桌面登录世代”

结论：

- 只要请求还能到达桌面 WebSocket
- 且桌面本地还保留了 host-access 凭证 / remote session
- 桌面就可能继续放行

---

## 5. 问题根因

“电脑端退出后，手机端仍可连接”的根因，不是单点故障，而是三件事叠加：

### 5.1 Host-access 鉴权和平台登录态是两套状态

当前桌面端远程放行使用的是：

- `RemoteAccessService` 中的 SRP 凭证
- `RemoteSessionService` 中的 resume session

这两套状态与平台账号登录态不是同一个状态机。

也就是说：

- 平台账号退出了
- 但桌面端本地 SRP 凭证还在
- 已建立的远程 session 也可能还在

于是桌面侧仍可继续完成认证。

### 5.2 桌面端最终放行时没有再次检查“当前是否已登录平台账号”

在以下入口都没有看到“桌面登录态硬校验”：

- `handleSrpHello()`
- `handleSrpProof()`
- `handleSrpResumeInit()`
- `handleSrpResume()`

因此现状是：

- relay 负责把流量送到桌面
- 桌面只看 SRP/password 或 session resume
- 不看“桌面当前是否还登录平台”

这与目标设计不一致。

### 5.3 远程 session 是长生命周期的，可绕过“重新输密码”

`RemoteSessionService` 默认允许：

- idle 7 天
- max 30 天

这意味着：

- 一旦某次桌面侧 SRP 成功过
- 后面移动端可以走 `srp_resume`
- 如果桌面未主动清空这些 session，后续就可能继续连上

这也是当前问题能持续复现的重要原因。

---

## 6. 现有方式 vs 改造后方式

### 6.1 设备在线判断

现有方式：

- 控制平面根据 `last_seen_at` 判断在线
- 手机端可据此看到在线/离线

改造后：

- 保持不变
- 继续由服务端维护 1 分钟超时离线
- 手机端显示“最近心跳时间 / 已离线多久”

说明：

- 这层解决“设备在不在”
- 不负责最终放行

### 6.2 Relay grant 的职责

现有方式：

- `client-connect grant` 既承担“账号授权”职责，也间接变成了连接可用性的主要依据

改造后：

- `client-connect grant` 只作为“路由票据”
- 它只证明：
  - 手机端账号有权找这台设备
  - 设备最近心跳未超时
- 它不再代表“桌面一定允许连接”

说明：

- relay 负责把请求送到桌面
- 桌面负责最终接受或拒绝

### 6.3 桌面端 SRP 首次认证

现有方式：

- 只要桌面本地仍有 host-access 凭证，就可以走 SRP

改造后：

- 在 `handleSrpHello()` 前增加桌面侧 admission gate：
  - 必须 `controlPlaneBridgeState.enabled === true`
  - 必须 `pausedReason !== "unauthorized"`
  - 必须桌面存在当前有效 `deviceId` / `relayUsername`
  - 必须当前 host access 处于允许状态
- 不满足时，桌面直接返回明确拒绝原因并断开

说明：

- 这样手机即使已经打到桌面 WebSocket，桌面也会主动阻断

### 6.4 桌面端 SRP resume

现有方式：

- 只要 `RemoteSessionService` 中 session 还在，proof 正确就恢复

改造后：

- `RemoteSessionService` 中的每个 session 增加以下绑定字段：
  - `controlPlaneSessionEpoch`
  - `deviceLoginEpoch`
  - 可选：`issuedUnderDeviceId`
- `handleSrpResumeInit()` 和 `handleSrpResume()` 增加 admission gate：
  - 当前桌面必须仍登录平台账号
  - session 的 epoch 必须与当前桌面登录 epoch 一致
- epoch 不一致时，直接拒绝 resume，并提示需要重新连接

说明：

- 这样旧 session 无法跨“退出登录 -> 再尝试连接”继续复用

### 6.5 桌面端退出登录

现有方式：

- 已有一部分动作：
  - 控制平面 logout
  - 清理 control-plane config
  - 清理 relay config
  - `invalidateUserSessions(existingUsername)`

改造后：

- 退出登录统一走一个“桌面远程失效总入口”，确保原子化执行：
  1. 先标记本机 `deviceLoginEpoch++`
  2. 关闭 control-plane bridge
  3. 停止 relay client
  4. 清除 relay config
  5. 清空所有 remote session
  6. 撤销所有本地待处理 connect challenge / pending resume challenge
  7. 更新服务端设备状态等待心跳超时为离线

说明：

- 关键不是“尽量断”，而是“即使有漏网连接请求，桌面鉴权也已经拒绝”

---

## 7. 建议改造方案

## 7.1 新增“桌面侧连接准入门禁”

新增一个统一能力，例如：

- `DesktopConnectionAdmissionService`

职责：

- 统一判断当前桌面是否允许远程连接
- 被以下入口共同调用：
  - relay 接入后的 SRP hello
  - SRP proof
  - session resume init
  - session resume
  - 后续如有 WebView 自动登录桥接，也统一走这里

建议接口：

- `canAcceptRemoteConnection(): { allowed: boolean; reason?: string; epoch?: number }`
- `assertCanAcceptRemoteConnection(): void`
- `getCurrentLoginEpoch(): number`

准入条件建议：

- 桌面已登录平台账号
- `ControlPlaneBridgeService` 非 unauthorized
- relay config 与当前 device registration 一致
- remote access 已启用
- host-access 凭证存在

### 7.2 为远程 session 增加“登录世代”绑定

在 `RemoteSessionService` 写入 session 时，记录：

- `loginEpoch`
- `controlPlaneSessionId` 或可替代的会话世代标识

校验规则：

- resume 时若 `session.loginEpoch !== currentLoginEpoch`，拒绝

这样即使：

- 某次 session 之前创建成功
- 用户后来退出平台账号

旧 session 也无法再恢复。

### 7.3 将“桌面退出登录”变成远程访问的硬失效事件

需要把桌面退出平台账号定义为一个明确领域事件，例如：

- `onDesktopAccountLoggedOut()`

此事件统一触发：

- relay 断开
- remote session 失效
- login epoch 递增
- 挂起的连接挑战作废

这样可以避免今天这种“某些层清掉了，但另一些层还能继续工作”的分裂状态。

### 7.4 明确 relay 与 desktop 的职责边界

改造后的职责分工：

- relay/control-plane：
  - 账号体系
  - 设备在线态
  - 路由 grant
  - 转发流量

- desktop：
  - host access 密码校验
  - session resume 校验
  - 当前登录态准入判断
  - logout 后立即失效

这正是你要求的“认证发生在电脑端”。

---

## 8. 代码改造点

### 8.1 需要保留的现有实现

1. `packages/server/src/services/ControlPlaneBridgeService.ts`
   - 保留设备注册、心跳、grant 获取逻辑

2. `packages/relay/src/control-plane.ts`
   - 保留设备在线判断、grant 签发、session active 检查

3. `packages/relay/src/ws-handler.ts`
   - 保留 relay pairing、账号归属校验

### 8.2 需要调整的桌面端实现

1. `packages/server/src/routes/ws-srp-handlers.ts`
   - `handleSrpHello()`
   - `handleSrpProof()`
   - `handleSrpResumeInit()`
   - `handleSrpResume()`

改造方式：

- 增加桌面登录态 admission gate
- 在 SRP 首登和 resume 两条路径都强制检查

2. `packages/server/src/remote-access/RemoteSessionService.ts`

改造方式：

- session 结构新增 `loginEpoch`
- 创建 session 时写入
- resume 校验时比对
- 新增按 epoch 失效或全量失效能力

3. `packages/server/src/remote-access/routes.ts`

改造方式：

- 将桌面退出平台账号后的清理逻辑收敛为统一失效动作
- 避免现在分散在多个 route 中的清理逻辑出现遗漏

4. `packages/server/src/index.ts`

改造方式：

- relay client 启停保留
- 但新增对 desktop admission state 的注入
- 让 WebSocket 鉴权层能直接读取当前桌面登录态

5. 新增服务（建议）

- `packages/server/src/services/DesktopConnectionAdmissionService.ts`

职责：

- 封装所有“桌面当前是否允许远程连接”的判断
- 减少控制平面状态判断散落在多处

---

## 9. 推荐流程（改造后）

### 9.1 手机端点击连接

1. 手机端用平台账号向控制平面请求 `client-connect grant`
2. 控制平面检查：
   - 设备归属当前账号
   - 最近 1 分钟内有心跳
3. relay 根据 grant 把连接送到对应桌面
4. 桌面收到连接后，不立即视为可用，而是先走 admission gate
5. admission gate 通过后，才允许：
   - SRP hello / proof
   - 或 session resume
6. 桌面认证通过后，才真正建立远程会话

### 9.2 桌面端退出平台账号

1. 桌面执行平台 logout
2. 本地触发 `onDesktopAccountLoggedOut()`
3. login epoch 增加
4. relay client 停止
5. remote session 全部作废
6. 之后手机端即使手里还拿着旧 grant 或旧 sessionId：
   - relay 层可能很快失败
   - 即使打到桌面，桌面 admission gate 也必拒绝

---

## 10. 验收场景

建议按以下场景验收：

1. 正常连接
   - 桌面已登录平台账号
   - 手机登录同账号
   - 点击连接成功

2. 桌面退出后首次连接
   - 桌面退出平台账号
   - 手机点击连接
   - 应直接失败，且原因明确为“桌面未登录/设备离线/连接不可用”

3. 桌面退出后 resume 连接
   - 先成功连过一次，拿到 session
   - 桌面退出平台账号
   - 手机再次进入
   - 不能通过 resume 恢复

4. grant 竞态
   - 手机先拿到 `client-connect grant`
   - 在使用 grant 前，桌面退出登录
   - 该次连接也必须失败

5. 桌面重新登录
   - 桌面重新登录平台账号
   - 心跳恢复
   - 手机重新点击连接
   - 允许重新建立新连接
   - 旧 session 不可复用，新 session 可复用

---

## 11. 风险与兼容性

### 风险

1. 需要处理好 logout 瞬间的竞态
2. 需要避免误伤 LAN 直连模式
3. 需要区分“平台登录态失效”和“host access 未配置”两类错误文案

### 兼容策略

1. 仅对 relay 远程路径强制增加 desktop admission gate
2. LAN 直连可继续按现有 SRP 模式工作，除非产品决定也统一要求平台登录
3. remote session 新字段做向后兼容：
   - 老 session 可在版本切换时直接判失效
   - 不建议兼容旧 session 跨版本复用

---

## 12. 结论

当前问题的本质不是 relay 没断干净，而是：

- 远程访问最终放行仍由桌面本地 SRP/session 决定
- 但桌面本地 SRP/session 没有和“平台账号当前登录态”做强绑定

所以本次改造的核心不是继续补前端跳转，也不是继续补 relay grant，而是：

1. 在桌面端增加统一的连接准入门禁
2. 把 remote session 绑定到桌面当前登录世代
3. 把“退出平台账号”变成远程访问立即失效的硬事件

只有这样，才能保证：

> 电脑端退出登录时，远程中转不可用；并且最终认证发生在电脑端。
