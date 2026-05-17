# 远程中继退出隔离问题复盘（2026-05-16）

## 1. 背景

本轮目标是让“桌面端平台账号登录态”与“移动端是否还能通过中继连接该桌面”严格绑定。

期望行为：

1. 桌面端登录平台账号后，控制平面心跳维持在线状态。
2. 手机端只能在桌面端当前仍登录平台账号时发起并完成中继连接。
3. 桌面端退出平台账号后，中继访问应立即不可用。
4. 手机端刷新设备列表后，不应再看到一个可连接的在线设备假象。

你这次提供的复现场景是：

1. 中继连接成功
2. 桌面端退出登录
3. 中继连接失败
4. 移动端刷新设备列表
5. 再次点击连接
6. 连接成功

并且：退出后移动端仍能看到连续的心跳。

这组现象说明：

- 上一轮修复已经让“某一部分连接路径”在退出后能失败
- 但桌面端的退出登录没有把运行中的控制平面桥接状态真正收敛到“已退出”
- 设备在线状态和连接可用性仍可能在刷新后被重新恢复

---

## 2. 这次现象说明了什么

这次现象非常关键，因为它把问题范围进一步收敛了。

如果桌面端退出后：

- 第 3 步连接失败
- 但第 6 步刷新后又成功

那么说明问题已经不再主要是“连接到达桌面后没有鉴权”，而更像是：

1. 退出时，旧的 relay / server 连接被短暂切断了，所以第一次重连失败。
2. 但退出后的某个重启或重配过程，又把桌面端的 control-plane bridge 恢复起来了。
3. 一旦 bridge 恢复，桌面端重新注册设备、重新发送心跳、重新进入 relay waiting 状态。
4. 移动端刷新设备列表后，又拿到了新的在线状态和新的 grant，于是重新连接成功。

换句话说：

> 现在的残留问题，核心已经不是“桌面侧准入门缺失”，而是“桌面退出事务没有把 bridge / heartbeat / relay waiting 这一整套运行态彻底拉闸”。

---

## 3. 上一轮修复解决了什么

上一轮修复是必要的，而且方向没有错。它主要解决的是“连接准入层”的问题。

已经补上的内容包括：

1. 桌面端新增了 `DesktopConnectionAdmissionService`
2. relay 到达桌面后的 `srp_hello`
3. `srp_proof`
4. `srp_resume_init`
5. `srp_resume`
6. 远程 session `authEpoch`

也就是说，当前实现已经尝试保证：

- 即使中继已经把流量送到桌面
- 桌面也会再次检查当前桌面账号态是否允许继续认证
- 已有的 remote session 也不能跨越 logout 世代继续复用

这部分修复主要落在：

- `packages/server/src/services/DesktopConnectionAdmissionService.ts`
- `packages/server/src/routes/ws-srp-handlers.ts`
- `packages/server/src/remote-access/RemoteAccessService.ts`
- `packages/server/src/remote-access/RemoteSessionService.ts`

所以，上一轮修复并不是“无效”，而是：

> 它修的是“连接到了桌面之后能不能进”，但没有彻底修掉“桌面退出后为什么又重新变成在线可连接”。

---

## 4. 为什么当前修复仍然不完整

### 4.1 真正未收敛的是“退出事务”，不是“SRP 准入层”

当前桌面端退出登录的 Electron 主流程在：

- `packages/desktop-electron/src/electron/main.ts:612`

流程大致是：

1. 调远端 `POST /api/v1/auth/logout`
2. 调本地 `DELETE /api/remote-access/control-plane/config`
3. 清 Electron 自己保存的 `desktopConfig.controlPlane.accessToken`
4. 更新 `ServerManager` 的控制平面配置
5. restart 桌面内嵌 server

其中第 2 步非常关键，因为真正负责停止 bridge、清 relay config、清服务端持久化配置的，是本地 server 路由：

- `packages/server/src/remote-access/routes.ts:790`

这个本地 DELETE 会做：

1. bump `authEpoch`
2. 失效本地 remote sessions
3. `controlPlaneBridgeService.reconfigure({ baseUrl/accessToken/relayUrl: undefined })`
4. `remoteAccessService.clearRelayConfig()`
5. `onRelayConfigChanged()` 停止 relay client
6. `serverSettingsService.updateSettings(...)` 清空服务端持久化控制平面 token/baseUrl/relayUrl

也就是说：

> 真正能把桌面运行态彻底关停的是 server 里的 DELETE 事务，而不是 Electron 主进程里把 `desktopConfig.accessToken` 改成空字符串。

### 4.2 当前退出链路存在“双状态源”问题

现在控制平面登录态实际上有两份持久化来源：

1. Electron 主进程自己的 `desktopConfig.controlPlane`
2. Server 进程自己的 `serverSettingsService` 持久化配置

服务端启动时，会这样决定最终使用哪份 control-plane 配置：

- `packages/server/src/index.ts:486-491`

具体逻辑是：

1. 优先使用启动环境变量中的 `CONTROL_PLANE_*`
2. 如果环境变量没有值，则回退到 `serverSettingsService` 里的已保存值

这里的关键点是：

- Electron `ServerManager` 只会在值为真时注入环境变量
- 见 `packages/desktop-electron/src/electron/serverManager.ts:255-289`
- 当 Electron 把 `accessToken` 设为空字符串时，它不会传 `CONTROL_PLANE_ACCESS_TOKEN`
- 这并不等于“显式传入空值覆盖服务端旧值”
- 对 server 来说，这反而会触发“回退到 `serverSettingsService` 旧值”

也就是说，如果本地 DELETE 没有真正把 serverSettings 清掉，那么：

1. Electron 侧看起来已经退出了
2. 但 server restart 后会重新从自己的持久化设置里捡回旧 token
3. 然后重新启动 control-plane bridge
4. 继续发送心跳
5. 继续进入 relay waiting 状态

这就是当前设计里最关键的漏洞：

> “Electron 退出态”和“Server 运行态”不是同一个单一真相，而是两套可能分叉的状态源。

### 4.3 本地 DELETE 失败会被吞掉，导致假退出

Electron 的 `logoutControlPlane()` 对本地 DELETE 的处理是：

- `packages/desktop-electron/src/electron/main.ts:628-639`

如果请求失败，只会：

1. `console.warn(...)`
2. 然后继续往下执行
3. 保存 Electron 自己的退出态
4. restart server

这意味着：

- 即使真正负责“停止 bridge + 清服务端 token”的本地 DELETE 没成功
- UI 仍然会表现为“已经退出”
- 然后 server 还有机会在重启后从旧持久化配置中恢复 control-plane bridge

这是为什么这次问题会表现成“退出后不完全隔离”的根本原因之一。

可以简单概括成：

> 当前 logout 流程把“本地 bridge 清理失败”当成了可忽略错误，但它其实是一个会直接破坏安全边界的关键失败。

---

## 5. 为什么会出现“退出后先失败，刷新后又成功”

基于当前实现，最符合现象的链路是：

1. 桌面端点击退出登录。
2. Electron 发起远端 logout，并尝试调用本地 `DELETE /control-plane/config`。
3. 桌面端 server 进程在 restart 过程中，旧的 relay waiting 连接被中断。
4. 因为旧 waiting socket 没了，所以手机端立刻再点一次连接，会先失败。
5. 但如果本地 DELETE 没有完整落到 server 里，那么 server restart 后会：
   - 从 `serverSettingsService` 恢复旧 control-plane token
   - 重新启动 `ControlPlaneBridgeService`
   - 重新注册设备
   - 重新发送心跳
   - 重新进入 relay waiting 状态
6. 移动端刷新设备列表时，会看到新的在线状态。
7. 再次点击连接，就又成功了。

所以你看到的“先失败、刷新后又成功”其实不是随机现象，而是非常符合当前代码结构的：

- “先失败”来自 server restart 把旧连接切断
- “后成功”来自 server restart 又把旧 control-plane 配置捡回来

---

## 6. 为什么退出后还能看到连续的心跳

这点也很重要。

当前 relay/control-plane 侧设备在线判断主要依赖：

- `devices.last_seen_at`
- `issueClientConnectGrant()` 中的 `isDeviceOffline()`
- `listDevices()` / heartbeat 视图

相关代码：

- `packages/relay/src/control-plane.ts:590`
- `packages/relay/src/control-plane.ts:1221`
- `packages/relay/src/index.ts:734`

而 `last_seen_at` 只有一种正常更新来源：

- 桌面端 `ControlPlaneBridgeService.sendHeartbeat()`
- `packages/server/src/services/ControlPlaneBridgeService.ts`

因此，如果退出后你还能看到“连续更新”的心跳，这几乎可以直接说明：

1. 桌面端某个 server 进程里的 `ControlPlaneBridgeService` 仍在运行，或者
2. 它在 restart 后又重新启动了，并继续使用旧 token 调 control-plane heartbeat 接口

这和上面的“双状态源 + restart 回捡旧 token”判断是高度一致的。

换句话说：

> 只要心跳还在持续刷新，就说明问题不是单纯的设备列表缓存，而是桌面端 bridge 实际上还活着。

---

## 7. 当前设计还缺哪一层

除了上面的退出事务问题，当前设计在“设备可连接状态建模”上也还缺一层显式状态。

现在移动端看到的主要是：

1. 最近心跳时间
2. relay 是否在线

但这并不等价于：

- 桌面端当前仍登录平台账号
- 桌面端当前仍允许中继访问

这意味着，即使未来我们把“连续心跳”问题修掉，只依赖 60 秒心跳超时，也仍会留下两个 UX / 逻辑问题：

1. 桌面刚退出时，设备列表可能还会在最多 60 秒内显示在线
2. 手机端仍可能先看到“能连”的表象，再在连接阶段失败

所以从产品语义上，真正应该区分的是两个状态：

1. `heartbeat freshness`：机器最近有没有活着
2. `desktop account authenticated / relay available`：这台机器当前是否允许中继远程接入

当前实现前者有了，后者没有成为控制平面的单独一等状态。

---

## 8. 新的修复方案

下面是建议的新方案，目标是把“退出登录后远程中继不可用”做成一个不可绕过、可验证的原子事务。

### 8.1 方案原则

原则只有三条：

1. 桌面端本地状态必须是远程可用性的最终真相。
2. 本地 logout 必须先把 bridge / relay 在桌面端停掉，再做其他清理。
3. 任何本地清理失败都不能被当成可忽略错误。

### 8.2 把 logout 改成“本地优先、单事务收敛”

新的退出事务建议改为：

1. 桌面端先进入本地 `loggedOut` 运行态
   - 这个状态应立即阻断新的 relay admission
   - 即使后续网络请求失败，也不能继续接受远程连接
2. 立即停止 `ControlPlaneBridgeService`
   - 停 timer
   - 终止后续 heartbeat
   - 清掉当前 runtime 中的 `deviceId / relayUsername / accessToken` 可用态
3. 立即停止 `RelayClientService`
   - 切断 waiting / paired relay socket
4. bump `authEpoch`
5. 失效所有 remote sessions
6. 清空 server 侧 `serverSettingsService` 中的 control-plane 持久化配置
7. 清空 Electron `desktopConfig` 中的 control-plane 配置
8. 最后再 best-effort 调远端 `/api/v1/auth/logout`
   - 这一步用于服务端账号态回收
   - 但不应成为本地断开远程可用性的前置条件

也就是说：

> 本地停桥、停 relay、清持久化，必须先完成；远端 logout 是补充同步，不是本地安全边界的前提。

### 8.3 不允许“空环境变量 -> 回退旧持久化配置”这种复活路径

这块需要从设计上彻底堵住。

建议二选一，推荐两者都做：

1. 删除“双状态源”模式，统一以 server 持久化设置为唯一真相
   - Electron 不再单独保留一份控制平面 token 真相
   - Electron 只通过受保护 API 读写 server 侧状态
2. 即使保留双状态源，也必须引入显式“已退出覆盖位”
   - 例如 `CONTROL_PLANE_DISABLED=1`
   - 或 server 启动时识别“显式清空”而不是对空值走 fallback

核心要求是：

- “Electron 把 token 清空”必须被 server 理解为“显式禁用”
- 不能再被解释成“那我去读取旧持久化 token”

### 8.4 本地 `DELETE /control-plane/config` 失败不能吞

这一步必须升格为硬失败。

新的处理方式建议是：

1. 如果本地 DELETE 失败，不要继续假装退出完成
2. 不要直接 restart 成一个不确定状态
3. 应该把 UI 状态标为“退出未完成 / 本地服务状态未收敛”
4. 同时本地 runtime 先进入 `relay blocked` 安全态

换句话说：

> 与其给用户一个“看起来退出了、实际上还能被远程连进来”的假成功，不如明确告诉用户本地退出事务没有完成。

### 8.5 控制平面增加“桌面账号可用性”显式状态

为了满足你要的 UX，建议控制平面新增或显式维护一个设备可连接状态，而不是只看 `last_seen_at`。

建议设备状态至少拆成：

1. `lastHeartbeatAt`
2. `desktopAccountAuthenticated`
3. `relayAvailable`
4. `lastLogoutAt`（可选，便于调试）

移动端设备列表判断逻辑改为：

- 只有 `desktopAccountAuthenticated=true` 且 `relayAvailable=true` 且 `heartbeat` 未超时，才显示为可连接

桌面退出登录时：

- 不需要等 60 秒心跳超时
- 应该立即把设备标为 `relay unavailable / logged out`

这样才能满足：

- 手机端刷新设备列表后直接看到离线或不可连接
- 不再出现“列表像在线、点进去才失败”的假象

### 8.6 增加退出后的本地一致性校验

logout 完成后，建议强制校验以下断言：

1. `GET /api/remote-access/control-plane/status`
   - `enabled = false`
   - `running = false`
   - `deviceId` 为空
   - `relayUsername` 为空
2. `GET /api/remote-access/relay/status`
   - `status = disconnected`
3. `serverSettingsService`
   - control-plane token/baseUrl/relayUrl 已清空
4. 后续 2 个 heartbeat interval 内
   - 不应再出现新的 heartbeat 上报
5. 移动端刷新设备列表
   - 设备显示为不可连接
   - 再次申请 `client-connect grant` 时应直接拿到 `device_offline` 或等价拒绝

---

## 9. 建议实施拆分

建议按下面顺序做，避免再次出现“修了准入层，但退出事务没收口”的问题。

### PR-1：退出事务收敛

内容：

1. 把 desktop logout 改成“本地先停桥、停 relay、清状态，再远端 logout”
2. 本地 DELETE 失败改为硬失败
3. 去掉 restart 触发的状态复活路径
4. 增加测试覆盖“logout 后 bridge 不再恢复”

### PR-2：单一状态源 / 显式禁用态

内容：

1. 统一 control-plane 状态来源
2. 或引入显式禁用覆盖位，禁止 server fallback 到旧 token
3. 增加 server 启动集成测试，覆盖“空 token 不得恢复旧 token”

### PR-3：设备可连接状态建模

内容：

1. relay/control-plane 增加 `desktopAccountAuthenticated` / `relayAvailable`
2. 设备列表和 grant 申请同时参考这个状态
3. 登出时立即把设备标为不可连接，而不是等待 heartbeat 超时

### PR-4：可观测性和回归测试

内容：

1. 增加 logout、bridge stop、relay stop、heartbeat 停止日志
2. 增加端到端测试：
   - 登录 -> 连接成功
   - 退出 -> 连接失败
   - 刷新设备列表 -> 仍失败
   - 等待 2 个 heartbeat interval -> 无新心跳

---

## 10. 建议验收场景

修复完成后，至少要通过以下场景：

1. 桌面登录，手机登录，同账号连接成功
2. 桌面退出登录后，5 秒内刷新设备列表，设备显示不可连接
3. 桌面退出登录后，手机端不管是否刷新列表，再次连接都失败
4. 桌面退出登录后，relay grant 申请直接失败，不进入“看似正在连接”的阶段
5. 桌面退出登录后，服务端不再收到新 heartbeat
6. 桌面重新登录后，设备重新上线，手机端再次可连接
7. 桌面 logout 时即使远端 `/api/v1/auth/logout` 超时，本地也必须先失效中继可用性

---

## 11. 结论

这次问题之所以“还是没有彻底解决”，不是因为上一轮方向错了，而是因为上一轮只补强了“连接准入层”，没有彻底收拢“退出事务层”。

当前最核心的残留问题是：

1. Electron 和 server 存在双 control-plane 状态源
2. 本地 bridge 清理失败会被吞掉
3. server restart 存在回捡旧 token 的路径
4. 设备列表只看 heartbeat freshness，没有把“桌面当前是否已登录平台账号”建模成显式可连接状态

因此现在的现象才会是：

- 退出后先失败
- 刷新后又成功
- 并且心跳还在继续

一句话总结：

> 现在缺的不是再补一个连接校验，而是把“桌面退出登录”升级成一个本地优先、不可复活、可验证收敛的注销事务。
