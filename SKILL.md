---
name: chrome-mcp-bridge-2026-skill
description: 使用 Chrome MCP 浏览、搜索、读取和操作网页
version: 4.0.0
---

# Chrome MCP 使用规则

## 基本配置

本 skill 使用上游原生 `mcp-chrome-stdio`，不使用或维护旧的 `mcp-bridge.js`。

MCP 服务地址：<http://127.0.0.1:12306/mcp-new>

客户端配置：

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

服务启用鉴权时，在 `CHROME_MCP_API_KEY` 中填写 key；不要提交真实 key。

## 安装器行为

首次使用不主动推荐或执行全局安装。运行：

```powershell
.\install.ps1
```

安装器自动生成/合并当前目录的 `.mcp.json`，并测试 `mcp-chrome-bridge start`；不会执行 npm 安装。使用 `-SkipConfig` 可跳过配置文件生成。

只有启动命令不可用或启动失败时，才提示用户执行：

```powershell
npm install -g --allow-scripts=@ethanwilkins/mcp-chrome-bridge-2026 @ethanwilkins/mcp-chrome-bridge-2026@latest
mcp-chrome-bridge start
```

## 浏览器操作

用户要求浏览网页、搜索内容、读取页面、点击元素或提取数据时，优先使用 Chrome MCP。

执行操作前：

1. 确认当前会话已注册 Chrome MCP。
2. 已注册时先调用 `tools/list`，只使用返回列表中的工具。
3. 只有服务已注册且工具列表可见时，才执行浏览器操作。

常用工具：

- `chrome_navigate`：打开网页
- `chrome_get_page_text`：读取正文
- `chrome_screenshot`：截图
- `chrome_click_element`：点击元素
- `chrome_fill_or_select`：填写表单
- `chrome_extract`：提取结构化数据
- `chrome_scroll`：滚动页面

不要把服务地址当作工具名称，也不要虚构工具或调用方式。

## 帮助用户注册

如果提示 `not registered in this session`：

1. 停止调用，不要反复重试。
2. 指导用户在 AI 助手的 MCP 设置中新增：
   - 服务名：`chrome-mcp-bridge`
   - 类型：`Streamable HTTP`
   - 地址：<http://127.0.0.1:12306/mcp-new>
3. 配置完成后，要求用户完全重启 AI 助手。
4. 重启后重新确认服务已注册，再调用 `tools/list`。

如果服务未启动，提示用户启动本地服务并检查上述地址。远程或云端 AI 中的 `127.0.0.1` 指向远程机器，无法访问用户电脑上的 Chrome；此时必须改用可远程访问的 MCP 地址。

## 排障

依次确认：Chrome 扩展已加载、Native Host 已连接、`mcp-chrome-bridge start` 已运行。401/403 时检查 `CHROME_MCP_API_KEY`；Origin 错误时检查 `MCP_SERVER_ORIGIN` 与服务端白名单。
