---
name: chrome-mcp-bridge-2026-skill
description: 使用仓库内新版 mcp-bridge.js 连接已有的本地 Chrome MCP 服务；默认对接 /mcp-new 无会话 Streamable HTTP，也兼容旧 /mcp Session 端点
version: 4.1.0
---

# Chrome MCP 使用规则

## 只连接已有服务

本 skill 只连接已经运行的 Chrome MCP 服务，不负责启动或注册服务：

- 不执行 `mcp-chrome-bridge start`。
- 不执行 `mcp-chrome-bridge register`。
- 不主动执行 npm 全局安装。

默认端点：`http://127.0.0.1:12306/mcp-new`。

## `/mcp-new` 是无会话模式

`/mcp-new` 使用 MCP `2026-07-28` 的按请求、无会话传输：

- 每一条请求都是独立的 HTTP `POST`。
- 不先执行 `initialize` 或 `notifications/initialized`。
- 不等待、保存或回传 `Mcp-Session-Id`；该端点不依赖 Session。
- 连接旧兼容端点 `/mcp` 时，才使用旧版 initialize + Session 流程。

## 必须使用新版 bridge

不要手写旧式 JSON-RPC HTTP 请求，也不要引用其他备份目录中的 bridge。唯一入口是本仓库的 `mcp-bridge.js`：

```powershell
node .\mcp-bridge.js path
node .\mcp-bridge.js init                 # /mcp-new 使用 server/discover，不使用 initialize
node .\mcp-bridge.js call tools/list
```

调用工具时，PowerShell 使用 `--stdin`，避免 URL 中的 `&` 等字符被 shell 解释：

```powershell
$body = @'
{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}
'@
$body | node .\mcp-bridge.js call tools/call --stdin
```

`mcp-bridge.js` 会根据端点自动选择协议；对 `/mcp-new` 每次请求自动添加新版 headers 和 `_meta`，并禁止使用 Session 文件。

## `/mcp-new` 请求契约

每次新版 HTTP 请求必须同时满足：

| 位置 | 必填内容 |
|:---|:---|
| HTTP header | `MCP-Protocol-Version: 2026-07-28` |
| HTTP header | `Mcp-Method`，必须与 JSON-RPC `method` 完全一致 |
| HTTP header | `Mcp-Name` 仅用于 `tools/call`，必须与 `params.name` 完全一致 |
| HTTP header | `Origin`，必须是服务端白名单中的合法值 |
| JSON-RPC `params` | `_meta` 协议元数据 |
| `_meta` | `io.modelcontextprotocol/protocolVersion: 2026-07-28`，并携带 `clientInfo` 与 `clientCapabilities` |

同时使用：

```text
Content-Type: application/json
Accept: application/json, text/event-stream
```

`_meta` 位于 JSON-RPC 请求体中，不是 HTTP header。bridge 会保留调用方已有的 `_meta` 字段，并补齐：

```json
{
  "_meta": {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      "name": "mcp-bridge-backend",
      "version": "4.1.0"
    },
    "io.modelcontextprotocol/clientCapabilities": {}
  }
}
```

## MCP 客户端配置

### 推荐：客户端只支持 stdio

使用仓库内 bridge 的 `--server` 模式；安装器会把 `__BRIDGE_PATH__` 替换为绝对路径：

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

### 仅当客户端完整支持新版协议时直连 HTTP

只有客户端能为每条请求生成上述 `MCP-Protocol-Version`、`Mcp-Method`、工具调用的 `Mcp-Name`、`_meta` 和合法 `Origin` 时，才直接配置：

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

若客户端不能自定义 `Origin` 或缺少上述任一字段，改用 `mcp-bridge.js --server`。

## 检查服务是否可用

连接或执行浏览器操作前，用以下命令检查已有服务：

```powershell
Invoke-RestMethod 'http://127.0.0.1:12306/status?probe=1'
```

必须同时满足：

```text
connectionState = ready
extension.connected = true
nativeHost.connected = true
probe.ok = true
tools.count > 0
```

如果检查失败，不执行 `start` 或 `register`；提示用户恢复已有服务后再重试。

## 浏览器操作

用户要求浏览网页、搜索内容、读取页面、点击元素或提取数据时，优先使用 Chrome MCP。先运行 `tools/list`，只使用返回列表中的工具和参数，不要虚构工具名或调用方式。

常用工具包括：

- `chrome_navigate`：打开网页
- `chrome_get_page_text`：读取正文
- `chrome_screenshot`：截图
- `chrome_click_element`：点击元素
- `chrome_fill_or_select`：填写表单
- `chrome_extract`：提取结构化数据
- `chrome_scroll`：滚动页面

## 环境变量与排障

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `MCP_SERVER_URL` | `http://127.0.0.1:12306/mcp-new` | 后端端点；`/mcp` 使用旧兼容协议 |
| `MCP_PROTOCOL_MODE` | `auto` | `auto`、`stateless` 或 `legacy` |
| `MCP_PROTOCOL_VERSION` | 按端点选择 | `/mcp-new` 默认 `2026-07-28` |
| `MCP_SERVER_ORIGIN` | `http://127.0.0.1` | 发给 HTTP 服务的合法 Origin；必须在服务端白名单中 |
| `CHROME_MCP_API_KEY` | 空 | 服务启用鉴权时发送为 Bearer token |

HTTP 请求即使来自本机，也必须携带合法 `Origin`；`MCP_SERVER_ORIGIN` 不是只给 stdio 配置的变量。Origin 错误检查该值与服务端白名单，401/403 检查 API key，远程或云端 AI 中的 `127.0.0.1` 则指向远程机器，无法访问用户电脑上的 Chrome。
