# chrome-mcp-bridge-2026-skill

> 通过 Node.js 桥接脚本稳定连接 streamable-HTTP MCP 服务，自动管理 session ID，支持所有 JSON-RPC 方法。可在 `--server` 模式下作为标准 MCP Server 供任意 AI 客户端使用。

```
AI 客户端              Stdio MCP              mcp-bridge.js          HTTP POST+SSE           MCP 服务端
(Claude/Cursor/VS Code) ◄──────────────►      (Session 管理)          ◄──────────────►       (Chrome 浏览器)
                                                                                              http://127.0.0.1:12306/mcp
```

---

## ✨ 能力概览

对接 [mcp-chrome-2026](https://github.com/phoenixlucky/mcp-chrome-2026) 服务，覆盖 **9 大类 30+ 浏览器自动化工具**：

| 分类 | 核心工具 | 能力 |
|:---:|:---|:---|
| 📊 浏览器管理 | `chrome_navigate` · `chrome_close_tabs` · `chrome_switch_tab` | 页面导航、标签页管理 |
| 📸 截图视觉 | `chrome_screenshot` · `chrome_computer` · `chrome_gif_recorder` | 截图、坐标交互、GIF 录制 |
| 🌐 网络监控 | `chrome_network_capture` · `chrome_block_images` | 请求捕获、资源拦截 |
| 🔍 内容分析 | `chrome_get_page_text` · `chrome_extract` · `chrome_read_page` | 正文提取、结构化数据抽取 |
| 🎯 交互操作 | `chrome_click_element` · `chrome_fill_or_select` · `chrome_keyboard` · `chrome_upload_file` | 点击、填表、键盘、上传 |
| 💻 脚本执行 | `chrome_javascript` · `chrome_console` | 页面 JS 执行、日志捕获 |
| 📚 数据管理 | `chrome_history` · `chrome_bookmark_search/add/delete` | 历史记录、书签 CRUD |
| 🕸️ 抓取提取 | `chrome_scroll` · `chrome_wait` · `chrome_click_and_wait` | 滚动、等待、组合操作 |
| ⚡ 性能分析 | `performance_start_trace` · `performance_analyze_insight` | Trace 录制、性能分析 |

> 执行 `node mcp-bridge.js call tools/list` 获取实时工具列表。

---

## 🚀 快速安装

### 前置条件

| 要求 | 说明 |
|------|------|
| **Node.js** ≥ 18 | 内置 `fetch` API，零外部依赖 |
| **Chrome 浏览器** | 已安装 |
| **Native Host 桥接器** | `npm install -g @ethanwilkins/mcp-chrome-bridge-2026` |

### 1️⃣ 启动 MCP 服务

```bash
# 安装桥接器（postinstall 自动注册 Native Messaging Host）
npm install -g @ethanwilkins/mcp-chrome-bridge-2026

# 启动服务
mcp-chrome-bridge start
```

确认服务在线：

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:12306/mcp
# 预期输出: 200
```

### 2️⃣ 获取本仓库

```bash
git clone https://github.com/phoenixlucky/chrome-mcp-bridge-2026-skill.git
cd chrome-mcp-bridge-2026-skill
```

---

## 🔧 快速使用

### 方式 A：通过 MCP 客户端（推荐）

在项目根目录创建（或使用已有的）`.mcp.json`：

```json
{
  "mcpServers": {
    "chrome": {
      "command": "node",
      "args": ["<脚本绝对路径>\\mcp-bridge.js", "--server"],
      "env": {
        "MCP_SERVER_URL": "http://127.0.0.1:12306/mcp"
      }
    }
  }
}
```

启动客户端后，`chrome_*` 工具自动可用。

### 方式 B：CLI 直接调用

```powershell
# 初始化
node mcp-bridge.js init

# 调用工具（--stdin 避免 PowerShell & 转义）
$body = @'
{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}
'@
$body | node mcp-bridge.js call tools/call --stdin

# 关闭
node mcp-bridge.js close
```

---

## 📋 CLI 命令参考

| 命令 | 参数 | 说明 |
|:---|:---|:---|
| `init` | — | 初始化连接，获取 session ID |
| `call` | `<method>` `[params\|--stdin]` | 调用 JSON-RPC 方法 |
| `ping` | — | 心跳保活 |
| `close` | — | 关闭连接，清理 session |
| `path` | — | 输出脚本绝对路径 |

**参数传递方式：**

```powershell
# 直接传入（简单参数）
node mcp-bridge.js call tools/call '{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}'

# 管道模式（推荐，避免特殊字符转义）
echo '{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}' | node mcp-bridge.js call tools/call --stdin

# 文件重定向
node mcp-bridge.js call tools/call --stdin < params.json
```

---

## 🖥️ 在 AI 客户端中配置

### Claude Desktop

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

### VS Code (Cline / Continue)

在 `.mcp.json` 或项目配置中添加相同配置。

### Cursor

在 Settings → MCP Servers 中添加：

| 字段 | 值 |
|------|-----|
| Name | chrome |
| Type | command |
| Command | `node` |
| Args | `["path/to/mcp-bridge.js", "--server"]` |

### Windsurf

在 `windsurf.json` 或 MCP 配置中添加 stdio server。

> 原理相同：配置一个 stdio MCP server，`command` 为 `node`，`args` 为 `["<脚本绝对路径>", "--server"]`。

---

## 📦 项目结构

```
chrome-mcp-bridge-2026-skill/
├── mcp-bridge.js       # 🧩 Node.js 桥接脚本（核心，零外部依赖）
├── SKILL.md            # 📘 AI 代理操作手册（自动配置 + CLI 速查）
├── README.md           # 📖 本文件（项目首页）
├── .mcp.json           # ⚙️ MCP 配置模板
├── reasonix.toml       # ⚙️ Reasonix 项目配置
├── .gitignore
└── LICENSE
```

---

## ⚙️ 技术细节

### Session 生命周期

```
init → POST /mcp {initialize} → 服务端分配 sessionId
      → 持久化到 %TEMP%/mcp-bridge-session.json
      → 后续请求自动附加 Mcp-Session-Id 头
      → 超时自动检测 → 清理 → re-init
```

| 阶段 | 请求头 | 响应处理 |
|:---|:---|:---|
| 初始化 | `Accept: text/event-stream, application/json` | 提取 `Mcp-Session-Id` 响应头 |
| 调用 | `Mcp-Session-Id: <id>` + 同上 Accept | 解析 JSON 或 SSE 流 |
| 通知 | 同上 | 无需等待响应 |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MCP_SERVER_URL` | `http://127.0.0.1:12306/mcp` | 后端 MCP 服务地址 |
| `DEBUG` | 空 | 设为 `1` 开启调试日志 |

---

## 📚 相关资源

| 资源 | 链接 |
|:---|:---|
| 📘 MCP 规范 | [spec.modelcontextprotocol.io](https://spec.modelcontextprotocol.io) |
| 🌐 Chrome MCP 服务 | [github.com/phoenixlucky/mcp-chrome-2026](https://github.com/phoenixlucky/mcp-chrome-2026) |
| 🤖 Reasonix 框架 | [reasonix.ai](https://reasonix.ai) |
| 📄 工具文档 | [TOOLS_zh.md](https://github.com/phoenixlucky/mcp-chrome-2026/blob/master/docs/TOOLS_zh.md) |
| 🤖 AI 操作手册 | [SKILL.md](./SKILL.md) |

---

## ⚖️ 许可证

[MIT](LICENSE) © 2026 [phoenixlucky](https://github.com/phoenixlucky)
