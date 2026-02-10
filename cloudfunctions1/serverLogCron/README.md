# serverLogCron

定时任务云函数：按计划从服务器获取日志并写入 `squad_server_logs` 集合，自动清理 7 天前数据。

## 功能
- 使用 `servers` 集合中的 RCON 信息进行连接（不在代码中硬编码）。
- 默认执行 `ShowServerInfo` 作为日志内容示例（可自行替换为其他指令）。
- 记录北京时间与时间戳。
- 自动删除 7 天前的日志。
- 每次写入同时备份为云存储文件，并在记录中写入 `fileId`。

## 需要的云函数配置
- 在云开发控制台为本函数添加 **定时触发器**。
- 建议频率：每 5~10 分钟执行一次。

## 数据库集合
- `squad_server_logs`：存储日志。

字段示例：
- `time`：北京时间字符串
- `timestamp`：毫秒时间戳
- `serverId` / `serverName`
- `host` / `port`
- `command` / `output` / `ok` / `latency` / `error`
- `fileId`：日志文件在云存储的 FileID

## 依赖
- `luxon`
