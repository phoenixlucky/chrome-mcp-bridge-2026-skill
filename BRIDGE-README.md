# mcp-streamable-connect

**将 streamable-http MCP 服务桥接到任何 MCP 客户端的通用工具。**

这个工具解决一个特定的兼容性问题：某些 MCP 服务使用 `streamable-http` 传输（需要 HTTP + SSE 长连接管理 session ID），但很多 AI 客户端只支持 `stdio` 传输。本脚本作为中间层，自动管理 session 生命周期，让任何客户端都能用。

## 快速开始

### 1️⃣ 用 `--server` 模式启动（推荐 — 通用方案）

```bash
# 直接启动 MCP Server（输出自动管理 session）
node path/to/mcp-bridge.js --server
```

### 2️⃣ 在 AI 客户端中配置

#### Claude Desktop

编辑 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "chrome": {
      "command": "node",
      "args": ["C:\\path\\to\\mcp-bridge.js", "--server"],
      "env": {
        "MCP_SERVER_URL": "http://127.0.0.1:12306/mcp"
      }
    }
  }
}
```

#### VS Code (Cline / Continue)

在 `.mcp.json` 或项目配置中添加：

```json
{
  "mcpServers": {
    "chrome": {
      "command": "node",
      "args": ["path/to/mcp-bridge.js", "--server"]
    }
  }
}
```

#### Cursor

在 Cursor 设置 → MCP Servers 中添加：

| 字段 | 值 |
|------|-----|
| Name | chrome |
| Type | command |
| Command | `node` |
| Args | `["path/to/mcp-bridge.js", "--server"]` |

#### Windsurf

在 `windsurf.json` 或 MCP 配置中添加 stdio server 指向本脚本。

#### 其他支持 MCP 的客户端

原理相同：配置一个 stdio MCP server，`command` 为 `node`，`args` 为 `["<脚本绝对路径>", "--server"]`。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MCP_SERVER_URL` | `http://127.0.0.1:12306/mcp` | 后端 MCP 服务地址 |
| `DEBUG` | 空 | 设为 `1` 开启调试日志 |

---

## 系统要求

- **Node.js v18+**（支持 `fetch` API）
- **后端 MCP 服务**已在配置的 URL 运行

确认后端服务在线：

```bash
# 应该返回 200
curl -v http://127.0.0.1:12306/mcp
```

---

## CLI 模式（高级用法）

`--server` 模式是推荐用法，但 CLI 模式在脚本调试和测试时也有用。

```bash
# 初始化连接
node mcp-bridge.js init

# 列出可用工具
node mcp-bridge.js call tools/list

# 调用工具（参数通过 --stdin 传入，避免 shell 转义）
echo '{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}' | node mcp-bridge.js call tools/call --stdin

# 关闭连接
node mcp-bridge.js close
```

### PowerShell 用户必读

PowerShell 中 `&` 是命令分隔符，直接传 JSON 参数会失败：

```powershell
# ❌ 这样会报错（& 被当成命令分隔符）
node mcp-bridge.js call tools/call '{"name":"chrome_navigate","arguments":{"url":"https://example.com?a=1&b=2"}}'
```

✅ **正确做法：使用 heredoc + --stdin**

```powershell
$body = @'
{"name":"chrome_navigate","arguments":{"url":"https://example.com?lang=en"}}
'@
$body | node mcp-bridge.js call tools/call --stdin
```

### 所有 CLI 命令

| 命令 | 说明 |
|------|------|
| `path` | 输出脚本自身绝对路径 |
| `init` | 初始化连接 |
| `call <method>` | 调用方法（无参数） |
| `call <method> --stdin` | 从管道读取 JSON 参数后调用 |
| `call <method> '<json>'` | 直接传 JSON 参数（⚠️ 小心 shell 转义） |
| `ping` | 心跳保活 |
| `close` | 关闭连接 |

---

## 桥接脚本路径查找

安装位置不同，脚本路径可能不同。用以下方法查找：

```bash
# 如果知道大概位置，用 path 命令确认
node any/known/path/mcp-bridge.js path

# Linux/macOS
find ~ -name "mcp-bridge.js" 2>/dev/null

# Windows PowerShell
Get-ChildItem -Recurse -Filter mcp-bridge.js $env:APPDATA\reasonix\skills, $env:LOCALAPPDATA\reasonix\skills, .
```

---

## 已知限制

### 1️⃣ SPA 动态页面内容提取不全

`chrome_get_page_text` 底层使用 Mozilla Readability 提取"文章正文"。对于 **X/Twitter、知乎动态、News Feed** 等 SPA 应用，Readability 只能提取到前几条推文。

**替代方案**：

```bash
# 方案 A：用 CSS 选择器提取结构化数据
echo '{"name":"chrome_extract","arguments":{"selector":"article","fields":[{"name":"text","selector":"p","type":"text"}],"limit":50}}' | node mcp-bridge.js call tools/call --stdin

# 方案 B：获取完整文本内容
echo '{"name":"chrome_get_web_content","arguments":{"format":"text"}}' | node mcp-bridge.js call tools/call --stdin

# 方案 C：截图做视觉分析
echo '{"name":"chrome_screenshot","arguments":{"storeBase64":true}}' | node mcp-bridge.js call tools/call --stdin
```

### 2️⃣ 全页截图 `image readback failed`

某些页面下 `fullPage: true` 会失败。改为不加 `fullPage` 参数的普通截图。

### 3️⃣ 滚动懒加载不触发更多内容

某些 SPA 使用虚拟列表，滚动高度增加但不加载新内容。结合多次小步滚动 + `chrome_extract` 分段提取可缓解。

---

## 技术原理

1. AI 客户端通过 **stdio 协议**连接到本脚本
2. 本脚本内部通过 **HTTP POST + SSE** 连接到实际的 MCP 服务
3. 自动管理 `Mcp-Session-Id` 头的传递和持久化（保存到临时文件）
4. 遇到 session 过期自动重建

```
┌─────────────────┐    stdin/stdout     ┌──────────────────┐    HTTP POST+SSE    ┌──────────────────────┐
│  AI 客户端       │ ◄──── MCP ────────► │  mcp-bridge.js   │ ◄──── 代理 ───────► │  mcp-chrome-2026     │
│ (Claude/Cursor/) │   (stdio 协议)     │  (session 管理)   │                     │  (streamable-http)   │
└─────────────────┘                     └──────────────────┘                     └──────────────────────┘
```

---

## 许可证

MIT
