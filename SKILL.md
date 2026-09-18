---
name: chrome-mcp-bridge-2026-skill
description: 通过本仓库的 mcp-bridge.js 以 STDIO 入口使用本地 Chrome MCP；帮助 AI 客户端复用或自动启动本地 HTTP 服务、发现浏览器工具并完成网页操作，兼容 /mcp-new 与旧 /mcp 端点。内置 doctor 自检与 tools 工具浏览命令。
---

# 使用本地 Chrome MCP

## 何时使用

用户要你打开网页、搜索、阅读、点击、填写、提取数据或调试浏览器，并且需要通过本地 Chrome MCP 服务完成时，使用本 skill。

## 推荐入口

本仓库自带 bridge，**用绝对路径调用仓库内的脚本**，不要依赖全局同名命令（全局目录或备份目录里的版本可能与本仓库不一致）：

```powershell
node <仓库根目录>/mcp-bridge.js --server
```

`--server` 与 `--stdio` 等价。若已用 `npm link` 把本包链接到全局，也可以直接使用 `chrome-mcp-bridge-2026 --server`。

STDIO 入口会检查本地 HTTP MCP 服务：

- 服务已运行：直接复用；
- 服务未运行：自动启动本地服务；
- 不希望自动启动：设置 `CHROME_MCP_AUTOSTART_SERVER=0`，并确保服务已由用户提前启动。

不要自行执行旧式 `start`、`register` 或 npm 全局安装命令。除非用户明确要求排查安装，否则只配置 STDIO 入口并执行浏览器任务。

## 第一步永远是自检

遇到"连不上/工具不见了/配置不对"，先跑自检，不要盲目重试：

```powershell
node <仓库根目录>/mcp-bridge.js doctor
```

它会依次检查 Node 版本、客户端配置、后端服务、浏览器链路和工具数量，并对失败项给出「下一步」。`doctor` 已经带上了后端要求的合法 `Origin`。

> ⚠️ 不要用裸 `Invoke-RestMethod 'http://127.0.0.1:12306/status?probe=1'` 判断服务状态：`/status` 同样校验 `Origin`，缺少合法 `Origin` 时只会返回 `{"error":"MCP requests must include an allowed Origin or a valid API key."}`，看起来像服务故障。

## AI 客户端配置

Claude、Codex 及其他支持 MCP STDIO 的客户端都使用类似配置：

```json
{
  "mcpServers": {
    "chrome": {
      "command": "node",
      "args": ["<仓库根目录>/mcp-bridge.js", "--server"],
      "env": {
        "MCP_SERVER_URL": "http://127.0.0.1:12306/mcp-new",
        "MCP_PROTOCOL_MODE": "stateless",
        "MCP_PROTOCOL_VERSION": "2026-07-28",
        "MCP_SERVER_ORIGIN": "http://127.0.0.1"
      }
    }
  }
}
```

不要手写这份配置——运行安装器自动生成（它会写入正确的绝对路径，并在写完后探测一次后端）：

```powershell
node <仓库根目录>/install.js     # 跨平台；PowerShell 也可用 .\install.ps1
```

配置完成后**完全重启** AI 客户端。需要关闭自动启动时加入：

```json
"CHROME_MCP_AUTOSTART_SERVER": "0"
```

API Key、工具白名单等既有环境变量继续沿用上游定义，不要改名、删除或写入真实密钥。需要自定义这些选项时，只修改 `env`，不要改 STDIO 命令结构。

常用权限变量如下；未配置时保持上游默认兼容行为：

```json
{
  "CHROME_MCP_API_KEY": "",
  "CHROME_MCP_ALLOWED_TOOLS": "chrome_read_page,chrome_get_tab_url,flow.*",
  "CHROME_MCP_REQUIRE_APPROVAL": "true",
  "CHROME_MCP_APPROVED_TOOLS": "flow.checkout"
}
```

白名单支持工具名和简单前缀通配符。启用审批后，高风险工具（JavaScript、用户脚本、写入/发布、文件上传、Profile 和 `flow.*`）还必须出现在批准清单中；范围外工具可能不会出现在 `tools/list`。

## 一次浏览器任务的工作流

1. **连接**：让客户端启动 `<仓库根目录>/mcp-bridge.js --server`；通常不需要手动启动 HTTP 服务。
2. **发现工具**：先调用 `tools/list`，只使用实时返回的工具名和 `inputSchema`。用 CLI 快速浏览时可用 `node <仓库根目录>/mcp-bridge.js tools`（一行一个工具），需要精确 schema 时用 `tools <name>`。
3. **执行操作**：按任务选择最合适的 Chrome 工具，不要凭记忆虚构工具名或参数。
4. **验证结果**：读取页面、检查表单值或等待网络响应，确认操作确实生效。

服务正常时不必每一步重复检查状态；连接失败时再跑 `doctor`。

若设置了 `CHROME_MCP_AUTOSTART_SERVER=0`，自检结果应至少确认服务 ready、扩展已连接、Native Host 已连接且工具数量大于 0。自动启动失败时，提示用户查看本地服务日志并重试；不要无限重试。

## 工具选择

| 用户意图 | 优先工具或顺序 |
|---|---|
| 打开、刷新或切换网页 | `chrome_navigate`；需要查看标签页时先 `get_windows_and_tabs` |
| 阅读文章正文 | `chrome_get_page_text` |
| 查看按钮、链接和表单 | `chrome_read_page` |
| 点击或填写 | `chrome_read_page` → `chrome_click_element` / `chrome_fill_or_select` |
| 验证表单值 | `chrome_get_form_value` |
| 读取表格或结构化字段 | `chrome_extract` |
| 多页列表 | `chrome_paginate_extract` |
| 递归采集同源页面链接 | `chrome_crawl_links` |
| 提取评论、回复或讨论串 | `chrome_extract_thread` |
| 提取商品 Reviews 摘要 | `chrome_extract_review_summary` |
| 动态/虚拟列表 | `collect_virtual_list` |
| 点击后确认后台请求 | `wait_extract_response` |
| 复杂鼠标键盘交互 | `chrome_computer` |
| 页面异常排查 | `chrome_console` / `chrome_error_logs` / `chrome_network_capture` → `chrome_diagnostic_snapshot` |

定位失败时先重新读取页面，再用 `chrome_locate_element`；仍失败才使用 `chrome_request_element_selection` 请求用户手动选择元素。点击前优先使用可复用的页面 `ref`，不要盲点坐标。

完整工具目录见 [references/tool-catalog.md](./references/tool-catalog.md)，但上游升级后始终以实时 `tools/list` 为准。

## 端点和协议

默认端点是 `http://127.0.0.1:12306/mcp-new`。原有 API Key、工具白名单和以下两种端点都继续支持：

- `/mcp-new`：MCP `2026-07-28` 无 Session 模式，每条请求独立处理；不要对后端先发 `initialize`，不要保存或回传 `Mcp-Session-Id`。
- `/mcp`：旧兼容模式，使用 `initialize` 和 `Mcp-Session-Id`。

STDIO 客户端发给 bridge 自身的 `initialize` 仍应正常处理；“不发送 initialize”只针对后端 `/mcp-new` 请求。

由 bridge 负责适配 `/mcp-new` 所需的协议字段，包括：

- `MCP-Protocol-Version: 2026-07-28`
- 与 JSON-RPC `method` 一致的 `Mcp-Method`
- `tools/call` 对应的 `Mcp-Name`
- 合法的 `Origin`
- `params._meta` 中的协议版本、`clientInfo` 和 `clientCapabilities`

不要手写 HTTP 请求绕过 bridge。调用方传入的 `_meta`、`inputResponses`、`requestState` 等字段，以及结果中的 `resultType`、`task`、`content` 等字段都必须保留和正确处理。

## CLI 速查

```powershell
node <仓库根目录>/mcp-bridge.js doctor          # 自检（排障第一步）
node <仓库根目录>/mcp-bridge.js tools           # 列出全部工具用途
node <仓库根目录>/mcp-bridge.js tools <name>    # 单个工具的完整 schema
node <仓库根目录>/mcp-bridge.js init            # 初始化连接
node <仓库根目录>/mcp-bridge.js --help          # 全部命令
```

调用工具时用 `--stdin`（避免 shell 转义）或 `--args-file <路径>`：

```powershell
$body = @'
{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}
'@
$body | node <仓库根目录>/mcp-bridge.js call tools/call --stdin
```

## 错误与副作用

- 命令不存在：确认调用的是本仓库 `mcp-bridge.js` 的绝对路径；不要换用未知版本脚本。
- 服务未 ready：先跑 `doctor`；确认自动启动是否被 `CHROME_MCP_AUTOSTART_SERVER=0` 关闭，再检查本地服务日志。
- 401/403：检查 API Key、Origin 和工具白名单。
- 工具不存在或参数错误：重新执行 `tools/list`，按实时 schema 修正调用。
- `input_required`：根据返回的输入请求向用户询问必要信息，再用返回状态继续调用。
- 发布、删除、Cookie、Storage、用户脚本、上传文件和 Profile 管理：执行前确认目标和副作用；发布结果不确定时不要自动重试。
