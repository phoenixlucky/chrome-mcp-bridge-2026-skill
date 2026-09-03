<div align="center">

# chrome-mcp-bridge-2026-skill

**新版 MCP 2026-07-28 /mcp-new bridge · v4.1.0**

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
node .\mcp-bridge.js path
.\install.ps1
```

安装器只生成/合并当前项目的 `.mcp.json`，并把 `__BRIDGE_PATH__` 替换为当前仓库中的绝对路径；它不会启动或注册后端服务。配置完成后完全重启 AI 客户端。

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

完整模板见 [.mcp.json.example](./.mcp.json.example)。服务启用鉴权时填写 `CHROME_MCP_API_KEY`；不要提交真实 key。

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

## Bridge CLI 示例

不要直接手写旧式 JSON-RPC HTTP 请求；使用本仓库的新版 bridge：

```powershell
# /mcp-new 使用 server/discover，不使用 initialize 或 Session
node .\mcp-bridge.js init

# 发现工具
node .\mcp-bridge.js call tools/list

# 调用工具；--stdin 可避免 PowerShell 解释 URL 中的 &
$body = @'
{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}
'@
$body | node .\mcp-bridge.js call tools/call --stdin
```

`node .\mcp-bridge.js close` 只会清理旧 `/mcp` 的 Session；对 `/mcp-new` 不执行 Session 关闭请求。

## 环境变量

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `MCP_SERVER_URL` | `http://127.0.0.1:12306/mcp-new` | 后端端点；`/mcp` 使用旧兼容协议 |
| `MCP_PROTOCOL_MODE` | `auto` | `auto`、`stateless` 或 `legacy` |
| `MCP_PROTOCOL_VERSION` | 按端点选择 | `/mcp-new` 默认 `2026-07-28` |
| `MCP_SERVER_ORIGIN` | `http://127.0.0.1` | 发给 HTTP 服务的 Origin；必须在白名单中 |
| `CHROME_MCP_API_KEY` | 空 | 发送为 `Authorization: Bearer <key>` |

注意：`MCP_SERVER_ORIGIN` 对 HTTP 请求同样生效，不是只给 stdio 配置使用。不要使用服务端未白名单允许的伪造 Origin。

## 验证与排障

```powershell
Invoke-RestMethod 'http://127.0.0.1:12306/status?probe=1'
node --test test/native-config.test.js test/mcp-bridge-new.test.js
```

服务状态应同时满足 `connectionState=ready`、`extension.connected=true`、`nativeHost.connected=true`、`probe.ok=true`、`tools.count>0`。401/403 检查 API key 和 Origin；远程或云端 AI 中的 `127.0.0.1` 指向远程机器，无法访问用户电脑上的 Chrome。

## 项目结构

```text
chrome-mcp-bridge-2026-skill/
├── mcp-bridge.js                 # 新版 /mcp-new bridge，同时兼容旧 /mcp
├── SKILL.md                      # AI 代理使用规则
├── .mcp.json.example             # stdio 配置模板
├── install.ps1                   # 生成配置，不启动/注册后端
└── test/                         # 配置与新版协议回归测试
```

详细规则见 [SKILL.md](./SKILL.md)；上游接口说明见 [`MCP_NEW_zh.md`](https://github.com/phoenixlucky/mcp-chrome-2026/blob/master/docs/MCP_NEW_zh.md)。
