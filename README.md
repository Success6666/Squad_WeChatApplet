# Squad 战队及服务器管理小程序（云开发）

本项目基于微信小程序原生 + 云开发（云数据库/云函数/云存储），用于战队创建、成员管理、活动报名与管理后台。

## 许可证

本项目使用 BSD-3-Clause 许可证，详见 `LICENSE`。

## 功能概览

- 战队创建/加入/审核
- 活动创建/报名/统计
- 服务器控制面板（服务器列表、指令、状态、日志）
- 云函数统一读写云数据库

## 运行前准备

- 微信开发者工具
- 已开通的微信云开发环境

## 快速开始

1. 微信开发者工具 → 导入项目
2. 目录选择：仓库根目录
3. 确认：
   - miniprogramRoot：`miniprogram/`
   - cloudfunctionRoot：`cloudfunctions/`
4. 替换以下示例配置为你的真实值：
   - `project.config.json` → `appid`
   - `miniprogram/project.config.json` → `appid`
   - `miniprogram/app.js` → `env`（云环境 ID）

> 所有示例值为占位符，请替换为你的实际信息后再运行。

## 数据库集合（建议：仅云函数可读写）

以下集合在云函数中实际使用：
- `teams` 战队
- `members` 成员/申请
- `activities` 活动
- `signups` 报名
- `profiles` 成员资料
- `admin_list` 管理员列表（全局/后台权限）
- `servers` 服务器配置
- `server_info` 服务器扩展配置（或备用表）
- `admin_actions` 管理操作日志
- `squad_server_logs` 服务器日志归档
- `config` 配置（例如 `SECRET_KEY`）
- `secrets` 敏感配置（例如 `SECRET_KEY`）

### 权限建议

在云开发控制台 → 数据库 → 权限设置：
- 将以上集合全部设置为：**仅云函数可读写**

### 索引建议

- `teams`: `isPublic + createdAt(desc)`
- `members`: `teamId + status + appliedAt(desc)`；`teamId + openId`
- `activities`: `teamId + startTime(desc)`
- `signups`: `activityId + status + createdAt`；`openId + activityId`
- `servers`: `teamId + updatedAt(desc)`
- `admin_actions`: `serverId + timestamp(desc)`
- `squad_server_logs`: `serverId + timestamp(desc)`

## 云函数部署

在微信开发者工具的「云函数」面板里，对每个云函数目录右键：**上传并部署（云端安装依赖）**。

云函数清单：
- `login`
- `teamCreate` / `teamList` / `teamDetail` / `teamMyList` / `teamUpdate` / `teamRemove`
- `memberApply` / `memberReview` / `memberUpdateProfile` / `memberAdminSet` / `memberBanSet` / `memberKick`
- `activityCreate` / `activityList` / `activityDetail` / `activityUpdate` / `activityRemove`
- `profileGet` / `profileUpsert`
- `signupToggle` / `signupStats`
- `addAdmin` / `checkAdmin`
- `serverList` / `serverDetail` / `serverCreate` / `serverUpdate` / `serverRemove`
- `serverTestConnect` / `serverStatus` / `serverCommand` / `serverLogCron`
- `mapData` / `initCollections`

## 服务器控制面板（Squad Server Panel）

该功能用于管理战队服务器（RCON/HTTP），包括服务器配置、指令执行、状态检查与日志归档。

### 功能模块

- 服务器列表与详情：查看服务器、测试连接、读取状态
- 服务器管理：新增/编辑/移除服务器配置
- 管理指令：通过云函数下发管理指令并记录操作审计
- 日志归档：定时任务拉取日志并写入 `squad_server_logs`

### 关键云函数

- `serverList` / `serverDetail`：读取服务器信息
- `serverCreate` / `serverUpdate` / `serverRemove`：服务器配置管理
- `serverTestConnect`：连接测试
- `serverStatus`：服务器状态
- `serverCommand`：执行管理指令并写审计记录
- `serverLogCron`：定时拉取服务器日志

### 数据与权限模型

- 服务器属于战队（`teamId` 绑定）
- 管理操作需管理员权限（战队内 `owner/admin` 或 `admin_list`）
- 操作审计写入 `admin_actions`

### 密钥与敏感配置

- 云函数会从 `config` 或 `secrets` 的 `SECRET_KEY` 读取密钥
- 请在云开发控制台配置真实值（仓库中不包含任何真实密钥）

## 功能测试（最小闭环）

1. A 账号：首页 → 创建战队（A 自动成为队长）
2. B 账号：首页 → 进入战队详情 → 申请加入（pending）
3. A 账号：战队详情 → 审核申请 → 通过 B
4. A 账号：发布活动
5. B 账号：活动详情 → 立即报名 → 取消报名
6. A 账号：活动详情 → 报名统计

## 常见问题

- 看不到图片：云存储 fileID 需要云环境正确、且资源存在。
- `team-card` 默认 logo 使用占位 fileID；你可以上传一张默认图到云存储并替换。
- 如果你希望“未加入战队也能看到活动列表/详情”，需要放宽 `activityList/activityDetail` 的成员校验。
- 服务器面板无法连接：请检查服务器地址/端口、管理协议类型与密钥是否配置正确。
