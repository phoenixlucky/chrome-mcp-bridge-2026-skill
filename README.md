<h1 align="center">chrome-mcp-bridge-2026-skill</h1>

<p align="center">Chrome MCP 原生 stdio 配置 skill · v4.0.0</p>

> 上游 `mcp-chrome-bridge-2026` v2.5.5 已提供原生 `mcp-chrome-stdio`。它默认连接 `/mcp-new`，失败自动回退 `/mcp`，本项目不再重复实现 HTTP bridge。

## 快速开始

```powershell
npm install -g @ethanwilkins/mcp-chrome-bridge-2026@latest
mcp-chrome-bridge start
.\install.ps1
```

安装脚本会：

- 检查原生包版本（最低 v2.5.5）
- 同步 skill 和 MCP 配置模板
- 可选生成/更新当前目录的 `.mcp.json`
- 检查后端 HTTP MCP 服务

## MCP 客户端配置

复制 [.mcp.json.example](./.mcp.json.example)，或直接使用：

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

服务启用鉴权时，把 `CHROME_MCP_API_KEY` 填为服务端配置的 key。原生 stdio 会自动发送 `Authorization: Bearer <key>`；`MCP_SERVER_ORIGIN` 用于通过服务端 Origin 白名单校验。

不要把真实 API key 提交到仓库。

## 原生通道能力

`mcp-chrome-stdio` 已覆盖本项目原来 bridge 的职责：

- `/mcp-new` 无 Session，失败自动回退 `/mcp`
- 统一处理 JSON-RPC、deadline、取消、重试和错误映射
- 同时接受 newline JSON 与 `Content-Length` stdio framing
- 复用后端动态工具列表、权限策略和进度处理
- 读取 `MCP_SERVER_URL`、`MCP_SERVER_ORIGIN`、`CHROME_MCP_API_KEY`

上游说明：

- [项目 README](https://github.com/phoenixlucky/mcp-chrome-2026)
- [`/mcp-new` 接口说明](https://github.com/phoenixlucky/mcp-chrome-2026/blob/master/docs/MCP_NEW_zh.md)

## 从旧 bridge 迁移

将旧配置：

```json
{
  "command": "node",
  "args": [".../mcp-bridge.js", "--server"]
}
```

替换为：

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

然后重新运行 `.\install.ps1 -WriteConfig`，完全退出并重启 AI 客户端。旧的 `MCP_PROTOCOL_MODE`、`MCP_PROTOCOL_VERSION` 和 bridge 路径不再需要。

## 环境变量

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `MCP_SERVER_URL` | `http://127.0.0.1:12306/mcp-new` | 后端地址；原生通道自动回退 `/mcp` |
| `MCP_SERVER_ORIGIN` | `chrome-extension://mcp-stdio` | 后端 Origin 白名单值 |
| `CHROME_MCP_API_KEY` | 空 | 服务启用鉴权时必填，发送为 Bearer token |
| `CHROME_MCP_ALLOWED_TOOLS` | 空 | 上游工具范围限制 |
| `CHROME_MCP_REQUIRE_APPROVAL` | 空 | 上游高风险工具审批开关 |

## 验证

```powershell
Get-Command mcp-chrome-stdio
node --test test/native-config.test.js
```

项目文件：

```text
chrome-mcp-bridge-2026-skill/
├── install.ps1
├── SKILL.md
├── README.md
├── .mcp.json.example
└── test/native-config.test.js
```

许可证：MIT。
