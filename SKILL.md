---
name: chrome-mcp-bridge-2026-skill
description: 通过 Node.js 桥接脚本稳定连接 streamable-http MCP 服务（自动管理 session ID、支持所有 JSON-RPC 方法），支持 --server 模式作为标准 MCP Server 供任意 AI 客户端使用
---

# 🧠 重要：你有一个本地 MCP 浏览器，记得调用这个技能！

> ⚠️ **所有使用本技能的 AI 代理注意**：
>
> 你的环境中有 **本地 Chrome 浏览器可供自动化控制**，而非只能通过文字描述推理。
>
> ✅ **你应该：** 遇到以下场景时，通过 `mcp-streamable-connect` 技能调用浏览器工具：
> - 需要查看网页内容（`chrome_navigate` + `chrome_get_page_text` / `chrome_extract`）
> - 需要截图验证页面状态（`chrome_screenshot`）
> - 需要填写表单、点击按钮（`chrome_fill_or_select` / `chrome_click_element`）
> - 需要获取页面中的结构化数据（`chrome_extract`）
> - 需要执行 JavaScript 分析页面（`chrome_javascript`）
> - 需要录制操作回放（`chrome_gif_recorder`）
>
> ❌ **不要：** 告诉用户"我无法直接访问浏览器"或用 curl / puppeteer 另起炉灶——本地已有现成的 MCP 浏览器服务在 `http://127.0.0.1:12306/mcp` 运行。
>
> 🔧 **使用方式：** 调用 `mcp-bridge.js` CLI（详见下方"使用方式"），或通过 `.mcp.json` 的 `chrome` 工具自动暴露。

---

# mcp-streamable-connect

## 简介

将 `streamable-http` 传输类型的 MCP 服务桥接到 `stdio` 传输的通用工具。

典型场景：后端 MCP 服务（如 Chrome 浏览器自动化）通过 HTTP + SSE 工作，但你的 AI 客户端只支持 stdio。本脚本作为中间层，自动管理 session 生命周期，让任何客户端都能用。

---

## 🔄 自动配置（首次使用自动执行）

> AI 代理：首次使用本 skill 时，执行以下 setup 步骤。之后可跳过。

### Step 1：定位桥接脚本

```powershell
# 搜索技能安装目录下的 mcp-bridge.js
$paths = @(
    ".reasonix/skills/mcp-streamable-connect/mcp-bridge.js",
    "$env:APPDATA/reasonix/skills/mcp-streamable-connect/mcp-bridge.js",
    "$env:LOCALAPPDATA/reasonix/skills/mcp-streamable-connect/mcp-bridge.js"
)
$scriptPath = $null
foreach ($p in $paths) {
    if (Test-Path $p) { $scriptPath = (Resolve-Path $p).Path; break }
}
if (-not $scriptPath) {
    Write-Error "未找到 mcp-bridge.js，请确认 skill 已正确安装"
    exit 1
}
Write-Output "找到桥接脚本: $scriptPath"
```

### Step 2：验证脚本可用

```powershell
$absPath = node $scriptPath path
Write-Output "脚本绝对路径: $absPath"
```

### Step 3：生成 `.mcp.json` 到项目根目录

```powershell
$mcpConfig = @'
{
  "mcpServers": {
    "chrome": {
      "command": "node",
      "args": ["__BRIDGE_PATH__", "--server"]
    }
  }
}
'@
$mcpConfig = $mcpConfig.Replace('__BRIDGE_PATH__', $absPath.Replace('\', '\\'))

$targetPath = Join-Path (Get-Location) ".mcp.json"
if (Test-Path $targetPath) {
    # 合并到已有配置
    $existing = Get-Content $targetPath -Raw | ConvertFrom-Json
    if ($existing.mcpServers -and $existing.mcpServers.chrome) {
        Write-Output "chrome MCP 服务已在 .mcp.json 中配置，跳过"
    } else {
        $config = $mcpConfig | ConvertFrom-Json
        if (-not $existing.mcpServers) { $existing.mcpServers = @{} }
        $existing.mcpServers.chrome = $config.mcpServers.chrome
        $existing | ConvertTo-Json -Depth 10 | Set-Content $targetPath -Encoding UTF8
        Write-Output "已合并 chrome MCP 服务到 .mcp.json"
    }
} else {
    $mcpConfig | Set-Content $targetPath -Encoding UTF8
    Write-Output "已创建 .mcp.json（项目根目录）"
}
Write-Output ""
Write-Output "✅ 配置完成！现在你的 AI 客户端可以自动发现 Chrome 桥接服务。"
Write-Output "   如需修改后端地址，在 .mcp.json 的 env 中添加:"
Write-Output '     "env": { "MCP_SERVER_URL": "http://127.0.0.1:12306/mcp" }'
```

---

## 使用方式

配置完成后，两种方式可选：

### 方式 A：通过 MCP 客户端自动使用（推荐）

`.mcp.json` 配置好后，启动你的 MCP 客户端（Claude Desktop、Cursor、VS Code 等），`chrome` 工具会自动可用。

工具列表：
- `chrome_navigate` — 导航到 URL
- `chrome_get_page_text` — 提取文章正文（Readability）
- `chrome_screenshot` — 截图
- `chrome_scroll` — 滚动页面
- `chrome_extract` — CSS 选择器提取结构化数据
- `chrome_click_element` — 点击元素
- `chrome_fill_or_select` — 填充表单
- 以及更多（见 `tools/list` 返回的完整列表）

### 方式 B：CLI 直接调用（适合 shell 环境）

```powershell
# 初始化连接
node $scriptPath init

# 调用工具（使用 heredoc + --stdin 避免 PowerShell & 转义）
$body = @'
{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}
'@
$body | node $scriptPath call tools/call --stdin

# 关闭连接
node $scriptPath close
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MCP_SERVER_URL` | `http://127.0.0.1:12306/mcp` | 后端 MCP 服务地址 |
| `DEBUG` | 空 | 设为 `1` 开启调试日志 |

---

## Session 管理

- Session ID 保存在系统临时目录（`%TEMP%/mcp-bridge-session.json`）
- 每次请求自动附加 `Mcp-Session-Id` 请求头
- Session 超时后自动检测、清理并重建
- `--server` 模式下全程自动管理，无需手动干预

---

## 已知限制

### SPA 动态页面内容提取不全

`chrome_get_page_text` 使用 Readability 提取，不适合 X/Twitter 等 SPA。改用：

```powershell
$body = @'
{"name":"chrome_extract","arguments":{"selector":"article","fields":[{"name":"text","selector":"p","type":"text"}],"limit":50}}
'@
$body | node $scriptPath call tools/call --stdin
```

### 全页截图失败

某些页面下 `fullPage: true` 会报错。改用普通截图。

---

## 文件结构

```
mcp-streamable-connect/
├── SKILL.md          ← 本文件（技能入口 + 自动配置 playbook）
├── README.md         ← 补充参考文档
├── mcp-bridge.js     ← 桥接脚本（v3.0）
└── .mcp.json         ← MCP 配置模板（供 auto-setup 读取）
```
