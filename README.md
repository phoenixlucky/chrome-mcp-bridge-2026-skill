<div align="center">

# 🕷️ chrome-mcp-bridge-2026-skill

**Chrome MCP 原生 stdio 配置 Skill · v4.0.0**

连接本地 Chrome 浏览器自动化 MCP 服务，开箱即用。

[![Version](https://img.shields.io/badge/version-4.0.0-6C47FF)](https://github.com/phoenixlucky/chrome-mcp-bridge-2026-skill)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/phoenixlucky/mcp-chrome-2026#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-FF6B35)](https://modelcontextprotocol.io)
[![Upstream](https://img.shields.io/badge/Upstream-mcp--chrome--2026-v2.5.5-4285F4)](https://github.com/phoenixlucky/mcp-chrome-2026)
[![AI Playbook](https://img.shields.io/badge/AI-Playbook-6C47FF)](./SKILL.md)

</div>

---

## 目录

- [✨ 简介](#-简介)
- [🛠️ 核心特性](#️-核心特性)
- [🚀 快速开始](#-快速开始)
- [⚙️ MCP 客户端配置](#️-mcp-客户端配置)
- [🔑 环境变量](#-环境变量)
- [🔁 从旧 bridge 迁移](#-从旧-bridge-迁移)
- [📦 项目结构](#-项目结构)
- [✅ 验证](#-验证)
- [📚 相关资源](#-相关资源)
- [📄 许可证](#-许可证)

---

## ✨ 简介

本项目为 **Chrome MCP（`mcp-chrome-2026`）** 提供即用配置：不再自研 HTTP 桥接脚本，直接使用上游原生 **`mcp-chrome-stdio`**——默认连接 `/mcp-new`，失败自动回退 `/mcp`。

```text
┌─────────────────┐   stdio MCP    ┌────────────────────┐   HTTP POST+SSE   ┌──────────────────────┐
│   AI 客户端       │ ◄────────────► │  mcp-chrome-stdio  │ ◄───────────────► │  mcp-chrome-2026     │
│  Claude / Cursor │                │  原生入口 · 无 Session │                  │  Chrome 浏览器自动化  │
│  VS Code / Codex │                │  /mcp-new → /mcp    │                  │  http://127.0.0.1    │
└─────────────────┘                 └────────────────────┘                  └──────────────────────┘
```

> ⚠️ 本项目**不再维护 `mcp-bridge.js`**。旧配置可参照[迁移指南](#-从旧-bridge-迁移)升级。

---

## 🛠️ 核心特性

| 特性 | 说明 |
|:---|:---|
| 🔌 **零维护连接** | 使用上游原生 `mcp-chrome-stdio`，无需自研桥接层 |
| 🔁 **自动回退** | 默认 `/mcp-new` 无 Session；失败自动回退兼容 `/mcp` |
| 🧭 **协议完备** | 统一处理 JSON-RPC、deadline、取消、重试与错误映射 |
| 📥 **双 framing** | 同时接受 newline JSON 与 `Content-Length` stdio framing |
| 🔑 **鉴权支持** | 读取 `MCP_SERVER_URL` / `MCP_SERVER_ORIGIN` / `CHROME_MCP_API_KEY`，自动发送 Bearer token |
| 🎓 **AI 指南** | [SKILL.md](./SKILL.md) 提供 AI 代理操作规则与排障 |

---

## 🚀 快速开始

### 前置条件

- Node.js ≥ 18
- 已安装并加载 Chrome 扩展的 [mcp-chrome-2026](https://github.com/phoenixlucky/mcp-chrome-2026)

### 安装

首次使用直接运行安装器：

```powershell
.\install.ps1
```

安装器会：

1. ✅ 自动生成 / 合并当前目录的 `.mcp.json`
2. 🚀 测试 `mcp-chrome-bridge start`
3. 🛡️ 无副作用 —— **不会执行 npm 安装**

| 参数 | 说明 |
|:---|:---|
| `-SkipConfig` | 跳过 `.mcp.json` 自动生成 |

> ℹ️ 仅当启动命令不可用或启动失败时，安装器才会提示手动安装 `@ethanwilkins/mcp-chrome-bridge-2026`。

---

## ⚙️ MCP 客户端配置

复制 [.mcp.json.example](./.mcp.json.example) 到项目根目录，或直接使用以下配置：

```json
{
  "mcpServers": {
    "chrome": {
      "command": "mcp-chrome-stdio",
      "env": {
        "MCP_SERVER_URL": "http://127.0.0.1:12306/mcp-new",
        "MCP_SERVER_ORIGIN": "chrome-extension://mcp-stdio",
        "CHROME_MCP_API_KEY": ""
      }
    }
  }
}
```

服务启用鉴权时，在 `CHROME_MCP_API_KEY` 中填写服务端配置的 key；原生 stdio 会自动发送 `Authorization: Bearer <key>`。

> ⚠️ 不要把真实 API key 提交到仓库。

---

## 🔑 环境变量

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `MCP_SERVER_URL` | `http://127.0.0.1:12306/mcp-new` | 后端地址；原生通道自动回退 `/mcp` |
| `MCP_SERVER_ORIGIN` | `chrome-extension://mcp-stdio` | 后端 Origin 白名单值 |
| `CHROME_MCP_API_KEY` | 空 | 服务启用鉴权时必填，发送为 Bearer token |
| `CHROME_MCP_ALLOWED_TOOLS` | 空 | 上游工具范围限制 |
| `CHROME_MCP_REQUIRE_APPROVAL` | 空 | 上游高风险工具审批开关 |

---

## 🔁 从旧 bridge 迁移

**旧配置：**

```json
{
  "command": "node",
  "args": [".../mcp-bridge.js", "--server"]
}
```

**替换为：**

```json
{
  "command": "mcp-chrome-stdio",
  "env": {
    "MCP_SERVER_URL": "http://127.0.0.1:12306/mcp-new",
    "MCP_SERVER_ORIGIN": "chrome-extension://mcp-stdio",
    "CHROME_MCP_API_KEY": ""
  }
}
```

然后重新运行 `.\install.ps1`，**完全退出并重启 AI 客户端**。

> 🔄 旧 bridge 专用的 `MCP_PROTOCOL_MODE`、`MCP_PROTOCOL_VERSION` 与脚本路径不再需要。

---

## 📦 项目结构

```text
chrome-mcp-bridge-2026-skill/
├── install.ps1                 # 安装器：生成配置 + 测试启动
├── SKILL.md                    # AI 代理操作指南
├── README.md                   # 本文件
├── .mcp.json.example           # MCP 配置模板
└── test/native-config.test.js  # 配置/安装器一致性测试
```

---

## ✅ 验证

```powershell
Get-Command mcp-chrome-stdio
node --test test/native-config.test.js
```

测试覆盖：配置模板使用原生 stdio 与认证字段、安装器不再引用旧 bridge / Reasonix。

---

## 📚 相关资源

- [mcp-chrome-2026 项目 README](https://github.com/phoenixlucky/mcp-chrome-2026)
- [`/mcp-new` 接口说明（MCP_NEW_zh.md）](https://github.com/phoenixlucky/mcp-chrome-2026/blob/master/docs/MCP_NEW_zh.md)
- [Model Context Protocol 规范](https://modelcontextprotocol.io)

---

## 📄 许可证

本项目以 [MIT License](https://github.com/phoenixlucky/mcp-chrome-2026#license) 开源（与上游一致）。