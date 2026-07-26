<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Reasonix-Skill-6C47FF?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTIgMmw1IDUgLTUgNS01LTUgNS01eiIvPjwvc3ZnPg==">
    <img alt="browser-localmcp-skills" src="https://img.shields.io/badge/Reasonix-Skill-6C47FF?style=for-the-badge">
  </picture>
</p>

<h1 align="center">browser-localmcp-skills</h1>

<p align="center">
  <strong>为 AI 代理提供稳定可靠的 Streamable HTTP MCP 连接能力</strong>
</p>

<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node"></a>
  <a href="https://reasonix.ai"><img src="https://img.shields.io/badge/Reasonix-ready-6C47FF" alt="Reasonix"></a>
  <a href="https://spec.modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-Streamable_HTTP-FF6B35" alt="MCP"></a>
  <a href="https://github.com/phoenixlucky/mcp-chrome-2026"><img src="https://img.shields.io/badge/Chrome_MCP-v2.0-4285F4?logo=googlechrome&logoColor=white" alt="Chrome MCP"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="License"></a>
  <br>
  <a href="#-快速开始"><img src="https://img.shields.io/badge/🚀-快速开始-6C47FF" alt="快速开始"></a>
  <a href="#-能力矩阵"><img src="https://img.shields.io/badge/📊-能力矩阵-6C47FF" alt="能力矩阵"></a>
  <a href="#-桥接脚本"><img src="https://img.shields.io/badge/🔧-桥接脚本-6C47FF" alt="桥接脚本"></a>
  <a href="#-技术细节"><img src="https://img.shields.io/badge/🧪-技术细节-6C47FF" alt="技术细节"></a>
</p>

---

<br>

## 🎯 问题与解决方案

### 问题背景

[Streamable HTTP](https://spec.modelcontextprotocol.io/2025-04-07/basic/transports/) 是 MCP 协议的核心传输方式之一，它通过 **HTTP POST + SSE (Server-Sent Events)** 实现客户端与服务端的双向通信。每次连接服务端会分配一个唯一的 `sessionId`，后续请求都必须携带此 ID。

**但 AI 代理面临一个关键瓶颈**：bash 执行环境是短生命周期的，无法维持 SSE 长连接来接收和保持 session ID。这导致：

- ❌ 每次请求都要重新 `initialize`，效率低下
- ❌ Session 频繁超时断裂
- ❌ 无法接收服务端推送的通知

### 解决方案

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Agent (Reasonix)                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │               mcp-streamable-connect 技能                   │  │
│  │   ┌──────────────┐    CLI 调用     ┌──────────────────┐   │  │
│  │   │  SKILL.md    │ ──────────────→ │  mcp-bridge.js   │   │  │
│  │   │  (操作手册)   │ ←────────────── │  (Node.js 桥接)  │   │  │
│  │   └──────────────┘   JSON 响应     └─────────┬────────┘   │  │
│  └───────────────────────────────────────────────┼────────────┘  │
└───────────────────────────────────────────────────┼──────────────┘
                                                    │ HTTP POST
                                                    │ Accept: text/event-stream
                                                    ▼
                              ┌─────────────────────────────────────┐
                              │     MCP 服务端 (streamable-http)     │
                              │  ┌───────────────────────────────┐  │
                              │  │  Session Manager              │  │
                              │  │  ┌─────────────────────────┐  │  │
                              │  │  │ sessionId 自动分配/验证 │  │  │
                              │  │  └─────────────────────────┘  │  │
                              │  │  ┌─────────────────────────┐  │  │
                              │  │  │ 工具 / 资源 / Prompt    │  │  │
                              │  │  └─────────────────────────┘  │  │
                              │  └───────────────────────────────┘  │
                              │         http://127.0.0.1:12306/mcp   │
                              └─────────────────────────────────────┘
                                              │
                                              ▼
                              Session ID 持久化层
                         ┌────────────────────────────────────┐
                         │  %TEMP%/mcp-bridge-session.json    │
                         │  自动读取 · 自动更新 · 自动清理    │
                         └────────────────────────────────────┘
```

**mcp-bridge.js** 作为一个轻量中间层，封装了 Streamable HTTP 协议的完整生命周期管理——AI 代理只需通过简单的 CLI 命令即可稳定使用任何 MCP 服务。

<br>

## ✨ 核心特性

<table>
  <tr>
    <td width="33%" align="center">
      <h3>🔌 零配置连接</h3>
      <p>一条命令初始化，session ID 自动持久化到临时文件，跨调用无缝复用</p>
    </td>
    <td width="33%" align="center">
      <h3>🔄 智能自动恢复</h3>
      <p>Session 超时自动检测 → 清理过期状态 → 重新 init 初始化，全程无人工干预</p>
    </td>
    <td width="33%" align="center">
      <h3>📡 双协议解析</h3>
      <p>即时 JSON 响应和 SSE 流式响应均正确解析，兼容所有标准 MCP 服务端实现</p>
    </td>
  </tr>
  <tr>
    <td width="33%" align="center">
      <h3>📥 --stdin 参数模式</h3>
      <p>通过管道传入 JSON 参数，彻底解决 PowerShell/bash 中 <code>&amp;</code> 等特殊字符被截断问题</p>
    </td>
    <td width="33%" align="center">
      <h3>⚡ 零外部依赖</h3>
      <p>仅使用 Node.js v18+ 内置 <code>fetch</code> API，无需 npm install，即克隆即用</p>
    </td>
    <td width="33%" align="center">
      <h3>🧩 Reasonix 原生集成</h3>
      <p>以技能包形式存在，安装即用，与 AI Agent 工作流深度契合</p>
    </td>
  </tr>
</table>

<br>

## 🚀 快速开始

### 前置条件

| 要求 | 说明 |
|------|------|
| **Node.js** ≥ 18 | 内置 `fetch` API，无需额外依赖 |
| **Reasonix** | AI Agent 框架，支持 MCP 技能发现 |
| **MCP 服务** | 运行在 `http://127.0.0.1:12306/mcp` 的 streamable-http 服务 |

### 安装 Chrome MCP 服务

本技能包需要一个运行中的 [mcp-chrome-2026](https://github.com/phoenixlucky/mcp-chrome-2026) 服务作为后端。按照以下三步即可完成安装：

#### 1️⃣ 安装 Chrome 扩展

从 [Releases 页面](https://github.com/phoenixlucky/mcp-chrome-2026/releases) 下载 `chrome-mcp-server-*.zip`，然后：

1. 打开 Chrome 地址栏输入 `chrome://extensions/`
2. 开启右上角的 **开发者模式**
3. 将下载的 `.zip` 文件直接拖入页面完成安装

#### 2️⃣ 安装 Native Host（桥接器）

```bash
# npm（推荐，postinstall 自动注册 Native Messaging Host）
npm install -g @ethanwilkins/mcp-chrome-bridge-2026

# 或使用 pnpm
pnpm install -g @ethanwilkins/mcp-chrome-bridge-2026
```

> 如需手动注册：`mcp-chrome-bridge register`

#### 3️⃣ 启动服务

```bash
# 一键启动（推荐）
mcp-chrome-bridge start

# 或克隆仓库后使用脚本
start-server.bat
```

服务将在 `http://127.0.0.1:12306/mcp` 监听。确认服务在线：

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:12306/mcp
# 预期输出: 200
```

---

### 安装本技能包

```bash
# 克隆仓库
git clone https://github.com/phoenixlucky/browser-localmcp-skills.git
cd browser-localmcp-skills

# 技能位于 .reasonix/skills/mcp-streamable-connect/
# Reasonix 自动发现并注册，无需额外操作
```

### 快速验证

```bash
# 1️⃣ 确认 MCP 服务在线
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:12306/mcp
# 预期输出: 200

# 2️⃣ 初始化连接
node .reasonix/skills/mcp-streamable-connect/mcp-bridge.js init

# 3️⃣ 列出可用工具
node .reasonix/skills/mcp-streamable-connect/mcp-bridge.js call tools/list

# 4️⃣ 调用工具（示例：导航到网页）
node .reasonix/skills/mcp-streamable-connect/mcp-bridge.js call tools/call \
  '{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}'

# 5️⃣ 关闭连接
node .reasonix/skills/mcp-streamable-connect/mcp-bridge.js close
```

<br>

## 📊 能力矩阵

本技能包对接 [mcp-chrome-2026](https://github.com/phoenixlucky/mcp-chrome-2026) 服务，覆盖 **9 大类 30+ 浏览器自动化工具**：

| 分类 | 工具 | 核心能力 |
|:---:|:---|:---|
| <h3>📊</h3>**浏览器管理** | `get_windows_and_tabs` · `chrome_navigate` · `chrome_close_tabs` · `chrome_switch_tab` | 窗口标签页管理、页面导航、历史控制 |
| <h3>📸</h3>**截图视觉** | `chrome_screenshot` · `chrome_computer`¹ · `chrome_gif_recorder` | 全页/元素截图、坐标鼠标键盘交互、操作 GIF 录制 |
| <h3>🌐</h3>**网络监控** | `chrome_network_capture` · `chrome_network_request` · `chrome_block_images` | 请求捕获、自定义请求、资源拦截 |
| <h3>🔍</h3>**内容分析** | `chrome_read_page` · `chrome_get_web_content` · `chrome_get_page_text` · `chrome_extract` | 无障碍树分析、内容提取、Readability 正文解析、结构化数据抽取 |
| <h3>🎯</h3>**交互操作** | `chrome_click_element` · `chrome_fill_or_select` · `chrome_keyboard` · `chrome_upload_file` · `chrome_handle_dialog` · `chrome_request_element_selection` | 点击、表单填写、键盘快捷键、文件上传、对话框处理、人工辅助选元素 |
| <h3>💻</h3>**脚本执行** | `chrome_javascript` · `chrome_console` | 在页面上下文执行 JS、捕获控制台日志 |
| <h3>📚</h3>**数据管理** | `chrome_history` · `chrome_bookmark_search/add/delete` | 历史记录检索、书签 CRUD |
| <h3>🕸️</h3>**抓取提取** | `chrome_get_tab_url` · `chrome_scroll` · `chrome_get_scroll_state` · `chrome_wait` · `chrome_click_and_wait` | URL 获取、滚动控制、等待元素、组合操作 |
| <h3>⚡</h3>**性能分析** | `performance_start_trace` · `performance_stop_trace` · `performance_analyze_insight` | 页面性能 Trace 录制、DevTools 性能分析 |

> ¹ `chrome_computer` 是一个全能计算机器人，支持鼠标点击/拖动/滚动、键盘输入、文字填写、页面等待、缩放调整等操作，可替代多个独立工具。
>
> 💡 **提示**：详细的工具调用示例和参数说明请参阅 [SKILL.md](.reasonix/skills/mcp-streamable-connect/SKILL.md)。执行 `node mcp-bridge.js call tools/list` 可获取实时的工具列表及参数签名。

<br>

## 🔧 桥接脚本

### CLI 命令参考

```
node mcp-bridge.js <command> [args...]
```

| 命令 | 参数 | 说明 |
|:---|:---|:---|
| `init` | — | 初始化 MCP 连接，获取 session ID |
| `call` | `<method>` `[params\|--stdin]` | 调用 JSON-RPC 方法（详见下方） |
| `ping` | — | 心跳保活，延长 session 有效期 |
| `close` | — | 发送 close 通知，清理 session 文件 |
| *(无参数)* | — | 显示帮助信息 |

#### `call` 命令的参数传递方式

`call` 支持两种参数传递方式：

**方式一：命令行直接传入**（适合简单参数）
```bash
node mcp-bridge.js call tools/call '{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}'
```

**方式二：`--stdin` 管道模式（推荐，避免特殊字符被 shell 截断）**
```powershell
# 通过管道传入 JSON（解决 PowerShell 中 & 等字符的转义问题）
echo '{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}' | node mcp-bridge.js call tools/call --stdin

# 也可以从文件重定向
node mcp-bridge.js call tools/call --stdin < params.json
```

### 完整工作流

```bash
# ── 建立连接 ──
node mcp-bridge.js init

# ── 浏览器自动化 ──
node mcp-bridge.js call tools/call '{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}'
node mcp-bridge.js call tools/call '{"name":"chrome_wait","arguments":{"selector":".main-content","waitFor":"visible"}}'
node mcp-bridge.js call tools/call '{"name":"chrome_extract","arguments":{"selector":".data-item","fields":[{"name":"title","type":"text"}]}}'
node mcp-bridge.js call tools/call '{"name":"chrome_screenshot","arguments":{"fullPage":true,"storeBase64":true}}'

# ── 清理退出 ──
node mcp-bridge.js close
```

### Session 生命周期管理

```
                  ┌──────────┐
                  │  启动     │
                  └────┬─────┘
                       ▼
              ┌────────────────┐
              │  mcp-bridge.js │
              │     init       │
              └───────┬────────┘
                      │ POST /mcp {initialize}
                      ▼
              ┌────────────────┐     Mcp-Session-Id     ┌──────────────────┐
              │  MCP 服务端     │ ←──────────────────── │  持久化到临时文件  │
              │  分配 sessionId │ ────────────────────→ │  session.json    │
              └───────┬────────┘     响应头              └──────────────────┘
                      │
            ┌─────────┼─────────┐
            │         │         │
            ▼         ▼         ▼
       ┌────────┐ ┌────────┐ ┌────────┐      ┌──────────────┐
       │ 调用工具 │ │ 心跳   │ │ 关闭   │  ←── │  自动恢复机制  │
       │ 复用 ID │ │ 延长   │ │ 清理   │      │  session 超时 │
       └────────┘ └────────┘ └────────┘      │  →清理→重试   │
                                             │  →自动 re-init │
                                             └──────────────┘
```

> **智能自动恢复**：当服务端返回 Session 相关错误时，桥接脚本会自动清理过期 session 文件并重试请求。重试耗尽后，将自动执行 `init` 重新初始化连接，最大程度减少人工干预。

<br>

## 📦 项目结构

```
browser-localmcp-skills/
│
├── .reasonix/
│   └── skills/
│       └── mcp-streamable-connect/          # 📦 技能包
│           ├── SKILL.md                     #   ├─ AI 操作手册
│           └── mcp-bridge.js                #   └─ Node.js 桥接脚本
│
├── reasonix.toml                            # ⚙️ Reasonix 项目配置
├── .gitignore                               # 🔒 版本控制忽略规则
├── README.md                                # 📖 项目总览（本文件）
│   └── 详细工具操作手册 → 见 SKILL.md
│
└── LICENSE                                  # ⚖️ MIT 许可证
```

<br>

## 🧪 技术细节

### 关于 MCP Streamable HTTP Transport

本桥接脚本遵循 [MCP 规范](https://spec.modelcontextprotocol.io) 的 Streamable HTTP Transport 实现：

| 阶段 | 请求头 | 响应处理 |
|:---|:---|:---|
| 初始化 | `Accept: text/event-stream, application/json` | 提取 `Mcp-Session-Id` 响应头 |
| 调用 | `Mcp-Session-Id: <id>` + 同上 Accept | 解析 JSON 或 SSE 流 |
| 通知 | 同上 | 无需等待响应 |

### 关于 Chrome MCP 服务

[mcp-chrome-2026](https://github.com/phoenixlucky/mcp-chrome-2026) 基于 Chrome DevTools Protocol (CDP)，提供全面的浏览器自动化能力。所有工具均返回统一格式：

```json
{
  "content": [{ "type": "text", "text": "响应数据..." }],
  "isError": false
}
```

<br>

## 📚 相关资源

| 资源 | 链接 |
|:---|:---|
| 📘 MCP 规范文档 | [spec.modelcontextprotocol.io](https://spec.modelcontextprotocol.io) |
| 🌐 Chrome MCP 服务 | [github.com/phoenixlucky/mcp-chrome-2026](https://github.com/phoenixlucky/mcp-chrome-2026) |
| 🤖 Reasonix 框架 | [reasonix.ai](https://reasonix.ai) |
| 📄 Chrome MCP 工具文档 | [TOOLS_zh.md](https://github.com/phoenixlucky/mcp-chrome-2026/blob/master/docs/TOOLS_zh.md) |

<br>

## ⚖️ 许可证

[MIT](LICENSE) © 2026 [phoenixlucky](https://github.com/phoenixlucky)
