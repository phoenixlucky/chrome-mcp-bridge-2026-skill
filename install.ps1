#!/usr/bin/env pwsh
<#
.SYNOPSIS
  chrome-mcp-bridge-2026-skill 安装脚本
  自动同步文件到 Reasonix 全局 skill 目录
#>

$ErrorActionPreference = 'Stop'

# ── 路径 ──────────────────────────────────────────────────────────────
$RepoRoot = Split-Path -Parent $PSScriptRoot
$GlobalSkillDir = "$env:APPDATA\reasonix\global-workspace\.reasonix\skills\chrome-mcp-bridge-2026-skill"
$GlobalConfigFile = "$env:APPDATA\reasonix\config.toml"

# ── 颜色 ──────────────────────────────────────────────────────────────
$Green = [ConsoleColor]::Green
$Yellow = [ConsoleColor]::Yellow
$Cyan = [ConsoleColor]::Cyan
$Red = [ConsoleColor]::Red

function Write-Step($msg) { Write-Host "  → $msg" -ForegroundColor $Cyan }
function Write-OK($msg) { Write-Host "  ✅ $msg" -ForegroundColor $Green }
function Write-Warn($msg) { Write-Host "  ⚠️  $msg" -ForegroundColor $Yellow }
function Write-Err($msg) { Write-Host "  ❌ $msg" -ForegroundColor $Red }

Write-Host ""
Write-Host "📦 chrome-mcp-bridge-2026-skill 安装" -ForegroundColor $Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor $Cyan

# ── Step 1: 确保 npm 包已安装 ────────────────────────────────────────
Write-Step "检查 @ethanwilkins/mcp-chrome-bridge-2026..."
$npmVer = npm list -g @ethanwilkins/mcp-chrome-bridge-2026 2>&1 | Select-String "2026@"
if ($npmVer) {
  Write-OK "已安装: $($npmVer.ToString().Trim())"
} else {
  Write-Step "正在全局安装 @ethanwilkins/mcp-chrome-bridge-2026@latest..."
  npm install -g @ethanwilkins/mcp-chrome-bridge-2026@latest 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $ver = npm view @ethanwilkins/mcp-chrome-bridge-2026 version 2>&1
    Write-OK "安装完成: v$ver"
  } else {
    Write-Err "npm 安装失败，请手动执行: npm install -g @ethanwilkins/mcp-chrome-bridge-2026@latest"
  }
}

# ── Step 2: 创建全局 skill 目录 ──────────────────────────────────────
Write-Step "创建全局 skill 目录..."
New-Item -ItemType Directory -Path $GlobalSkillDir -Force | Out-Null
Write-OK "$GlobalSkillDir"

# ── Step 3: 复制核心文件到全局目录 ──────────────────────────────────
Write-Step "同步文件到全局目录..."
$files = @(
  @{src="mcp-bridge.js"; dst="mcp-bridge.js"},
  @{src="SKILL.md"; dst="SKILL.md"},
  @{src=".mcp.json.example"; dst=".mcp.json.example"}
)

$copied = 0
foreach ($f in $files) {
  $srcPath = Join-Path $RepoRoot $f.src
  $dstPath = Join-Path $GlobalSkillDir $f.dst
  if (Test-Path $srcPath) {
    Copy-Item $srcPath $dstPath -Force
    $copied++
  } else {
    Write-Warn "未找到: $srcPath"
  }
}
Write-OK "已同步 $copied 个文件"

# ── Step 4: 注册到 Reasonix 全局配置 ────────────────────────────────
Write-Step "检查全局 MCP 插件注册..."
$pluginName = "chrome-mcp-bridge"
$mcpBridgePath = "$GlobalSkillDir\mcp-bridge.js"

if (Test-Path $GlobalConfigFile) {
  $config = Get-Content $GlobalConfigFile -Raw
  if ($config -match "name\s*=\s*`"$pluginName`"") {
    Write-OK "MCP 插件 '$pluginName' 已在全局配置中注册"
  } else {
    Write-Step "注册 MCP 插件到全局配置..."
    $pluginBlock = @"

[[plugins]]
name    = "$pluginName"
command = "node"
args    = ["$mcpBridgePath", "--server"]
call_timeout_seconds = 300
"@
    Add-Content -Path $GlobalConfigFile -Value $pluginBlock
    Write-OK "MCP 插件 '$pluginName' 已注册"
  }
} else {
  Write-Warn "未找到 Reasonix 全局配置，跳过注册"
}

# ── Step 5: 重启后端服务 ────────────────────────────────────────────
Write-Step "检查后端 MCP 服务..."
try {
  $testReq = [System.Net.WebRequest]::Create("http://127.0.0.1:12306/mcp")
  $testReq.Method = "POST"
  $testReq.ContentType = "application/json"
  $testReq.Accept = "text/event-stream, application/json"
  $testReq.Timeout = 3000
  $testBody = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"install-probe","version":"1.0"}}}'
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($testBody)
  $testReq.ContentLength = $bytes.Length
  $reqStream = $testReq.GetRequestStream()
  $reqStream.Write($bytes, 0, $bytes.Length)
  $reqStream.Close()
  $response = $testReq.GetResponse()
  Write-OK "后端 MCP 服务运行中（端口 12306）"
} catch {
  Write-Step "后端 MCP 服务未运行，正在启动..."
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "mcp-chrome-bridge"
    $psi.Arguments = "start --port 12306"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    Start-Sleep -Seconds 3
    Write-OK "后端 MCP 服务已启动 (PID: $($proc.Id))"
  } catch {
    Write-Warn "后端服务启动失败，请手动执行: mcp-chrome-bridge start"
  }
}

# ── 完成 ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor $Cyan
Write-Host "🎉 安装完成！" -ForegroundColor $Green
Write-Host ""
Write-Host "现在你可以在任意 Reasonix 项目中调用:"
Write-Host "  mcp__chrome-mcp-bridge__connect" -ForegroundColor $Cyan
Write-Host ""
Write-Host "工具列表:"
Write-Host "  chrome_navigate / chrome_screenshot / chrome_extract ... 等 9 大类 36+ 工具" -ForegroundColor $Cyan
Write-Host ""
