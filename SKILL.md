---
name: chrome-mcp-bridge-2026-skill
description: 使用上游原生 `mcp-chrome-stdio` 连接 Chrome MCP；兼容支持 stdio MCP 的主流 AI 助手
version: 4.0.0
---

# Chrome MCP 通用 skill

上游 `@ethanwilkins/mcp-chrome-bridge-2026` v2.5.5 已提供原生 `mcp-chrome-stdio`。直接使用它，不要再启动或维护项目内的 `mcp-bridge.js`。

## 适用客户端

凡是支持本地 stdio MCP Server 的客户端都可以使用，包括 Claude Desktop、Cursor、VS Code/Cline、Windsurf、Continue、Codex 等。各客户端的配置入口不同，但 MCP Server 配置内容相同。

通用配置：

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

将上面的 `mcpServers.chrome` 放入客户端的 MCP 配置中。不要改成 `node mcp-bridge.js --server`，项目已不再提供这个旧桥接脚本。

## 安装

首次使用：

```powershell
npm install -g --allow-scripts=@ethanwilkins/mcp-chrome-bridge-2026 @ethanwilkins/mcp-chrome-bridge-2026@latest
mcp-chrome-bridge start
```

也可以运行项目安装器检查版本并生成当前目录的 `.mcp.json`：

```powershell
.\install.ps1 -WriteConfig
```

不带 `-WriteConfig` 时，安装器只检查原生包和后端服务，不会修改任何 AI 客户端配置。

## 认证与 Origin

服务启用 API Key 时，必须在客户端的 `env` 中填写：

```json
"CHROME_MCP_API_KEY": "你的 API key"
```

原生 stdio 会向后端发送：

```text
Origin: chrome-extension://mcp-stdio
Authorization: Bearer <CHROME_MCP_API_KEY>
```

如果部署环境配置了不同的 Origin 白名单，覆盖 `MCP_SERVER_ORIGIN`。不要把真实 key 写入 Git、skill 文件或公开配置模板。

## 传输行为

- 默认连接 `/mcp-new`，使用 MCP `2026-07-28` 无 Session 传输。
- `/mcp-new` 失败时自动回退兼容 `/mcp`。
- 原生入口统一处理 JSON-RPC、deadline、取消、重试、错误映射和 stdio framing。
- 同时支持 newline JSON 与 `Content-Length` framing。
- 原生入口读取 `MCP_SERVER_URL`、`MCP_SERVER_ORIGIN`、`CHROME_MCP_API_KEY`，以及上游权限策略变量。

不再配置旧 bridge 专用的 `MCP_PROTOCOL_MODE`、`MCP_PROTOCOL_VERSION` 或 `MCP_SESSION_FILE`。

## 浏览器操作规则

需要查看网页、搜索内容、提取数据或操作页面时，优先使用 Chrome MCP 工具：

- 读页面：`chrome_read_page`、`chrome_get_page_text`、`chrome_get_web_content`
- 搜索页面：`search_tabs_content`、`chrome_spa_fetch`
- 交互：`chrome_computer`、`chrome_click_element`、`chrome_fill_or_select`
- 数据：`chrome_extract`、`chrome_extract_records`、`chrome_network_capture`

推荐先读取页面可访问性树，再进行交互；复杂 SPA 使用 `chrome_spa_fetch`。

当用户说“猫娘搜索”“使用猫娘搜下”“使用猫娘MCP搜索”或“使用MCP搜索”时，优先使用浏览器 MCP 搜索并整理结果。

## 排障

```powershell
Get-Command mcp-chrome-stdio
mcp-chrome-bridge status
```

连接失败时依次确认：Chrome 扩展已加载、Native Host 已连接、后端已执行 `mcp-chrome-bridge start`；若是 401/403，检查 `CHROME_MCP_API_KEY`；若是 Origin 错误，检查 `MCP_SERVER_ORIGIN` 与服务端白名单。

详细接口要求见上游 [`MCP_NEW_zh.md`](https://github.com/phoenixlucky/mcp-chrome-2026/blob/master/docs/MCP_NEW_zh.md)。
