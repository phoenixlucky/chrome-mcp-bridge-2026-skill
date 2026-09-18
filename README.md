<div align="center">

# chrome-mcp-bridge-2026-skill

**新版 MCP 2026-07-28 /mcp-new bridge · v4.2.0**

连接已有的本地 Chrome 浏览器自动化 MCP 服务。

</div>

## 解决的问题

本项目内置并固定使用仓库根目录的 `mcp-bridge.js`，避免 skill 文档、全局安装目录和备份目录之间发生版本错位。默认连接：

```text
http://127.0.0.1:12306/mcp-new
```

`/mcp-new` 是 MCP `2026-07-28` 的无会话端点：每条请求独立处理，不执行或等待 `initialize`，不保存或回传 `Mcp-Session-Id`。旧 `/mcp` 才使用 Session 兼容流程。

## 快速开始

前置条件：Node.js ≥ 18，且 Chrome MCP 服务、扩展和 Native Host 已经运行。

```powershell
# 1. 生成 MCP 客户端配置（自动填入本仓库 bridge 的绝对路径）
node install.js          # 跨平台，推荐
.\install.ps1            # PowerShell 等价写法

# 2. 自检整条链路
node mcp-bridge.js doctor

# 3. 完全重启 AI 客户端，让它读取生成的 .mcp.json
```

安装器只生成/合并配置，**不会启动或注册后端服务**。它会在写入后立刻探测一次后端，提前暴露链路问题。

## 自检（doctor）

一条命令回答"现在到底能不能用"：

```powershell
node mcp-bridge.js doctor          # 人类可读
node mcp-bridge.js doctor --json   # 机器可读，便于脚本/代理判断
```

输出示例：

```text
mcp-bridge.js doctor (v4.2.0)
端点: http://127.0.0.1:12306/mcp-new
Origin: http://127.0.0.1

✅ Node.js 运行时  v22.22.2
✅ bridge 脚本  D:\home\chrome-mcp-bridge-2026-skill\mcp-bridge.js
✅ AI 客户端配置  D:\home\chrome-mcp-bridge-2026-skill\.mcp.json — mcpServers.chrome → 本仓库 bridge
✅ 后端服务  http://127.0.0.1:12306/status?probe=1 — HTTP 200（服务 v2.7.6）
✅ 浏览器链路  connectionState=ready · extension=ready · nativeHost=ready · probe=ok(4ms)
✅ 工具清单  80 个工具

结论: ✅ 一切就绪，可以开始浏览器任务。
```

退出码 `0` 表示全部通过，`1` 表示存在问题；失败项会附带「下一步」提示。

> ⚠️ 不要再用裸 `Invoke-RestMethod 'http://127.0.0.1:12306/status?probe=1'` 判断服务状态：`/status` 同样校验 `Origin`，缺少合法 `Origin` 时只会返回 `{"error":"MCP requests must include an allowed Origin or a valid API key."}`，看起来像服务故障。`doctor` 已经带上了正确 `Origin`，请优先使用它。

## CLI 命令

```powershell
node mcp-bridge.js --help          # 完整帮助
node mcp-bridge.js --version       # 版本号
node mcp-bridge.js doctor          # 自检
node mcp-bridge.js tools           # 列出全部工具（名称 + 用途，一行一个）
node mcp-bridge.js tools <name>    # 只看某个工具的完整 inputSchema
node mcp-bridge.js init            # 初始化连接（走 server/discover）
node mcp-bridge.js ping            # 心跳保活
node mcp-bridge.js path            # 显示脚本绝对路径
node mcp-bridge.js close           # 清理旧 /mcp Session
```

调用工具：

```powershell
# --stdin：最省心，避免 shell 转义（推荐）
$body = @'
{"name":"chrome_navigate","arguments":{"url":"https://example.com?lang=en"}}
'@
$body | node mcp-bridge.js call tools/call --stdin

# 或把 JSON 写进文件
node mcp-bridge.js call tools/call --args-file .\params.json
```

`tools` 只打印名称和一句用途，比直接 dump 80 个工具的完整 schema 清爽得多；需要精确参数时再 `tools <name>`。

## MCP 客户端配置

### stdio 客户端

```json
{
  "mcpServers": {
    "chrome": {
      "command": "node",
      "args": ["__BRIDGE_PATH__", "--server"],
      "env": {
        "MCP_SERVER_URL": "http://127.0.0.1:12306/mcp-new",
        "MCP_PROTOCOL_MODE": "stateless",
        "MCP_PROTOCOL_VERSION": "2026-07-28",
        "MCP_SERVER_ORIGIN": "http://127.0.0.1",
        "CHROME_MCP_API_KEY": ""
      }
    }
  }
}
```

完整模板见 [.mcp.json.example](./.mcp.json.example)；`node install.js` 会把 `__BRIDGE_PATH__` 替换为真实绝对路径。服务启用鉴权时填写 `CHROME_MCP_API_KEY`；不要提交真实 key。

`--server` 与 `--stdio` 等价，两者都可作为入口。

### Streamable HTTP 客户端

只有客户端能为每一条请求生成新版 headers、`_meta` 和合法 `Origin` 时，才直接配置：

```json
{
  "mcpServers": {
    "chrome-mcp-new": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp-new"
    }
  }
}
```

如果客户端不能自定义 `Origin`，或仍发送旧式 initialize/Session 请求，请改用上面的 `mcp-bridge.js --server`。

## `/mcp-new` 新版请求契约

bridge 对每个 HTTP POST 自动发送：

| 位置 | 要求 |
|:---|:---|
| `MCP-Protocol-Version` | 必须为 `2026-07-28` |
| `Mcp-Method` | 必须与 JSON-RPC `method` 完全一致 |
| `Mcp-Name` | `tools/call` 必须携带，且与 `params.name` 完全一致 |
| `Origin` | 必须是服务端白名单中的合法值；默认 `http://127.0.0.1` |
| `params._meta` | 必须包含协议版本，并携带 clientInfo/clientCapabilities |
| `Mcp-Session-Id` | `/mcp-new` 不发送、不保存、不依赖 |

同时使用 `Content-Type: application/json` 和 `Accept: application/json, text/event-stream`。`_meta` 是 JSON-RPC body 中的协议元数据，不是 HTTP header；调用方已有的 `_meta` 会由 bridge 保留并合并。

不要手写这些请求——用 bridge 即可。

## 环境变量

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `MCP_SERVER_URL` | `http://127.0.0.1:12306/mcp-new` | 后端端点；`/mcp` 使用旧兼容协议 |
| `MCP_PROTOCOL_MODE` | `auto` | `auto`、`stateless` 或 `legacy` |
| `MCP_PROTOCOL_VERSION` | 按端点选择 | `/mcp-new` 默认 `2026-07-28` |
| `MCP_SERVER_ORIGIN` | `http://127.0.0.1` | 发给 HTTP 服务的 Origin；必须在白名单中 |
| `CHROME_MCP_API_KEY` | 空 | 发送为 `Authorization: Bearer <key>` |
| `MCP_BRIDGE_DIAG` | 关闭 | 设为 `1` 把 stdio 收发写入临时目录诊断日志 |
| `DEBUG` | 关闭 | 设为 `1` 输出详细调试日志 |

注意：`MCP_SERVER_ORIGIN` 对 HTTP 请求同样生效，不是只给 stdio 配置使用。不要使用服务端未白名单允许的伪造 Origin。

## 排障

| 现象 | 原因与处理 |
|:---|:---|
| `doctor` 报「未找到 .mcp.json」 | 运行 `node install.js`，然后**完全重启** AI 客户端 |
| 客户端里看不到 chrome 工具 | 配置路径不对，或客户端未完全重启；`node mcp-bridge.js doctor` 会指出配置位置 |
| 无法连接 / ECONNREFUSED | 本地 Chrome MCP 服务未运行；启动服务，或检查 `CHROME_MCP_AUTOSTART_SERVER` 是否被设为 `0` |
| HTTP 401 / 403 | 检查 `CHROME_MCP_API_KEY` 与 `MCP_SERVER_ORIGIN` 是否在服务端白名单中 |
| 链路不 ready | Chrome 未打开、扩展未启用，或 Native Host 未注册 |
| 工具数为 0 | 检查扩展连接与 `CHROME_MCP_ALLOWED_TOOLS` 白名单 |
| 远程/云端 AI 中连不上 | 云端环境里的 `127.0.0.1` 指向云端机器，访问不到你电脑上的 Chrome |

## 验证与测试

```powershell
npm test                                  # 或下面的等价写法
node --test "test/*.test.js"
node mcp-bridge.js doctor                 # 端到端链路自检
```

## 项目结构

```text
chrome-mcp-bridge-2026-skill/
├── mcp-bridge.js                 # 新版 /mcp-new bridge，同时兼容旧 /mcp
├── install.js                    # 跨平台配置生成器（Windows/macOS/Linux）
├── install.ps1                   # install.js 的 PowerShell 包装器
├── SKILL.md                      # AI 代理使用规则
├── references/tool-catalog.md    # 80 个工具的用途和选择路径
├── .mcp.json.example             # stdio 配置模板
├── package.json                  # npm test / doctor / tools 脚本
└── test/                         # 配置、新版协议与 CLI 回归测试
```

详细规则见 [SKILL.md](./SKILL.md)，工具用途见 [references/tool-catalog.md](./references/tool-catalog.md)；上游接口说明见 [`MCP_NEW_zh.md`](https://github.com/phoenixlucky/mcp-chrome-2026/blob/master/docs/MCP_NEW_zh.md)。
