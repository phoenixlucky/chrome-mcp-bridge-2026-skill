---
name: mcp-streamable-connect
description: 通过 Node.js 桥接脚本稳定连接 streamable-http MCP 服务（自动管理 session ID、支持所有 JSON-RPC 方法），支持 --server 模式作为标准 MCP Server 供任意 AI 客户端使用
---

# mcp-streamable-connect

## 简介

将 `streamable-http` 传输类型的 MCP 服务桥接到 `stdio` 传输的通用工具。

典型场景：后端 MCP 服务（如 Chrome 浏览器自动化）通过 HTTP + SSE 工作，但你的 AI 客户端只支持 stdio。本脚本作为中间层，自动管理 session 生命周期，让任何客户端都能用。

## 安装

### 通过 install_source 安装

```bash
# 从 GitHub 安装（待发布后）
install_source https://raw.githubusercontent.com/你的仓库/mcp-streamable-connect/main/SKILL.md

# 从本地路径安装
install_source /path/to/mcp-streamable-connect
```

### 手动安装

将整个 `mcp-streamable-connect/` 目录复制到你的 skills 目录：

- **全局（所有项目可用）**: `%APPDATA%/reasonix/skills/`
- **项目本地**: `.reasonix/skills/`

## 系统要求

- **Node.js v18+**（支持 `fetch` API）
- **后端 MCP 服务**已在 `http://127.0.0.1:12306/mcp` 运行（可通 `MCP_SERVER_URL` 环境变量修改地址）

## 两种使用方式

### 方式 A：`--server` 模式（通用，推荐）

将脚本作为标准 stdio MCP Server 运行，任何支持 MCP 的客户端都可以直接配置使用。

```bash
# 启动 MCP Server
node path/to/mcp-bridge.js --server

# 或指定后端地址
MCP_SERVER_URL=http://127.0.0.1:12306/mcp node path/to/mcp-bridge.js --server
```

在 AI 客户端的 MCP 配置中添加：

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

> 支持：Claude Desktop、VS Code（Cline/Continue）、Cursor、Windsurf 等所有 stdio MCP 客户端。

### 方式 B：CLI 模式（适合 shell / Reasonix 环境）

通过命令行的方式调用 MCP 服务，适合不支持常驻进程的环境。

```powershell
# 1. 找到脚本路径
$BRIDGE = node path/to/mcp-bridge.js path

# 2. 初始化连接
node $BRIDGE init

# 3. 调用工具（关键：使用 heredoc + --stdin 避免 PowerShell & 转义）
$body = @'
{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}
'@
$body | node $BRIDGE call tools/call --stdin

# 4. 关闭连接
node $BRIDGE close
```

> **⚠️ PowerShell 用户必读**：不能直接在命令行参数中传 JSON，因为 `&` 是 PowerShell 的命令分隔符。**永远使用 heredoc + `--stdin` 模式**。脚本在 JSON 解析失败时会自动打印正确的 heredoc 模板。

## CLI 命令参考

| 命令 | 说明 |
|------|------|
| `path` | 输出脚本自身绝对路径 |
| `init` | 初始化连接，获取 session ID |
| `call <method>` | 调用方法（无参数） |
| `call <method> --stdin` | 从管道读取 JSON 参数后调用 |
| `call <method> '<json>'` | 直接传 JSON（⚠️ 小心 shell 转义） |
| `ping` | 心跳保活 |
| `close` | 关闭连接并清理 session |
| `--server` | 以 stdio MCP Server 模式运行 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MCP_SERVER_URL` | `http://127.0.0.1:12306/mcp` | 后端 MCP 服务地址 |
| `DEBUG` | 空 | 设为 `1` 开启调试日志 |

## Session 管理

- Session ID 保存在系统临时目录（`%TEMP%/mcp-bridge-session.json`）
- 每次请求自动附加 `Mcp-Session-Id` 请求头
- 服务端返回新 session ID 时自动更新
- Session 超时后自动检测、清理并重建
- `--server` 模式下全程自动管理，无需手动干预

## 常见问题

### 连接失败 / `ECONNREFUSED`

后端 MCP 服务未启动。确认服务在线：

```bash
curl -v http://127.0.0.1:12306/mcp
```

### `SessionNotFound`

Session 已超时。运行 `close` 清理，然后重新 `init`（CLI 模式）或重启 `--server`。

### JSON 解析错误 / `&` 被截断

在 PowerShell 下使用 heredoc + `--stdin` 模式（见上方 CLI 模式说明）。

### 全页截图失败 `image readback failed`

改用不带 `fullPage: true` 的普通截图。

### X/Twitter 等 SPA 页面内容提取不全

`chrome_get_page_text` 使用 Readability 提取文章正文，不适合 SPA 动态页面。改用：

```powershell
# 方案 A：CSS 选择器提取结构化数据
$body = @'
{"name":"chrome_extract","arguments":{"selector":"article","fields":[{"name":"text","selector":"p","type":"text"}],"limit":50}}
'@
$body | node $BRIDGE call tools/call --stdin

# 方案 B：获取全部可见文本
$body = @'
{"name":"chrome_get_web_content","arguments":{"format":"text"}}
'@
$body | node $BRIDGE call tools/call --stdin
```

## 文件结构

```
mcp-streamable-connect/
├── SKILL.md              ← 本文件（技能入口 + 完整文档）
├── README.md             ← 补充参考文档
├── mcp-bridge.js         ← 桥接脚本（v3.0）
└── .mcp.json.example     ← MCP 配置模板
```

## 技术原理

```
┌─────────────────┐    stdin/stdout     ┌──────────────────┐    HTTP POST+SSE    ┌──────────────────────┐
│  AI 客户端       │ ◄──── MCP ────────► │  mcp-bridge.js   │ ◄──── 代理 ───────► │  mcp-chrome-2026     │
│ (Claude/Cursor/) │   (stdio 协议)     │  (session 管理)   │                     │  (streamable-http)   │
└─────────────────┘                     └──────────────────┘                     └──────────────────────┘
```
