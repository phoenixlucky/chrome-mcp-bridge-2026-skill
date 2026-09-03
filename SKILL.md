---
name: chrome-mcp-bridge-2026-skill
description: 直接连接已有的本地 Chrome MCP 服务（Streamable HTTP 或 mcp-chrome-stdio）来浏览、搜索、读取和操作网页；不负责启动或注册服务
---

# Chrome MCP 使用规则

## 直接连接已有服务

本 skill 只连接已经运行的 Chrome MCP 服务，不负责启动或注册服务：

- 不执行 `mcp-chrome-bridge start`。
- 不执行 `mcp-chrome-bridge register`。
- 不主动执行 npm 全局安装。

固定服务地址：<http://127.0.0.1:12306/mcp-new>

客户端支持 Streamable HTTP 时，直接配置这个 URL。

客户端只支持 stdio 时，配置：

```json
{
  "command": "mcp-chrome-stdio",
  "env": {
    "MCP_SERVER_URL": "http://127.0.0.1:12306/mcp-new",
    "MCP_SERVER_ORIGIN": "chrome-extension://mcp-stdio"
  }
}
```

服务启用鉴权时，再加入 `CHROME_MCP_API_KEY`；不要提交真实 key。

## 检查服务是否可用

连接或执行浏览器操作前，用以下命令检查服务：

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

本次已验证服务版本为 `2.5.5`、工具数为 `76`；运行时仍以 probe 实际结果为准。

如果检查失败，不执行 `start` 或 `register`；提示用户恢复已有服务后再重试。

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

## 帮助用户配置

如果提示 `not registered in this session`：

1. 停止调用，不要反复重试。
2. 指导用户在 AI 助手的 MCP 设置中直接配置：
   - 类型：`Streamable HTTP`
   - 地址：<http://127.0.0.1:12306/mcp-new>
3. 如果客户端只支持 stdio，改用上面的 `mcp-chrome-stdio` 配置。
4. 配置完成后，要求用户完全重启 AI 助手，再调用 `tools/list`。

如果已有服务不可达，提示用户检查本地服务、扩展和 Native Host。远程或云端 AI 中的 `127.0.0.1` 指向远程机器，无法访问用户电脑上的 Chrome；此时必须改用可远程访问的 MCP 地址。

## 排障

依次确认：服务地址可达、Chrome 扩展已加载、Native Host 已连接。401/403 时检查 `CHROME_MCP_API_KEY`；Origin 错误时检查 `MCP_SERVER_ORIGIN` 与服务端白名单。确认 `tools.count > 0` 后，才调用 `tools/list` 并执行浏览器操作。
