#!/usr/bin/env pwsh
<#
.SYNOPSIS
  安装原生 mcp-chrome-stdio，并可选生成当前项目的 .mcp.json。

.PARAMETER WriteConfig
  将 .mcp.json.example 合并/写入当前目录的 .mcp.json。

.PARAMETER ConfigPath
  指定要写入的 MCP 配置路径；默认是当前目录的 .mcp.json。
#>

param(
  [switch]$WriteConfig,
  [string]$ConfigPath = (Join-Path (Get-Location) '.mcp.json')
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageName = '@ethanwilkins/mcp-chrome-bridge-2026'
$MinimumNativeVersion = [version]'2.5.5'
$TemplatePath = Join-Path $RepoRoot '.mcp.json.example'

$Green = [ConsoleColor]::Green
$Yellow = [ConsoleColor]::Yellow
$Cyan = [ConsoleColor]::Cyan
$Red = [ConsoleColor]::Red

function Write-Step($Message) { Write-Host "  → $Message" -ForegroundColor $Cyan }
function Write-OK($Message) { Write-Host "  ✅ $Message" -ForegroundColor $Green }
function Write-Warn($Message) { Write-Host "  ⚠️  $Message" -ForegroundColor $Yellow }
function Write-Err($Message) { Write-Host "  ❌ $Message" -ForegroundColor $Red }

Write-Host ''
Write-Host '📦 Chrome MCP 通用 skill 安装（原生 stdio）' -ForegroundColor $Cyan
Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor $Cyan

# ── Step 1: 安装/检查原生 MCP 包 ─────────────────────────────────────
Write-Step "检查 $PackageName..."
$installedVersion = $null
$npmVersion = npm list -g $PackageName --depth=0 2>&1 | Select-String "$PackageName@"
if ($npmVersion -and $npmVersion.ToString() -match '@(?<Version>\d+\.\d+\.\d+)') {
  $installedVersion = [version]$Matches.Version
}

if ($installedVersion -and $installedVersion -ge $MinimumNativeVersion) {
  Write-OK "已安装: v$installedVersion"
} else {
  Write-Step "正在安装 $PackageName@latest（需要 >= v$MinimumNativeVersion）..."
  npm install -g "$PackageName@latest" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Err "npm 安装失败，请手动执行: npm install -g $PackageName@latest"
    exit 1
  }
  Write-OK '原生 MCP 包安装完成'
}

if (-not (Get-Command mcp-chrome-stdio -ErrorAction SilentlyContinue)) {
  Write-Err "未找到 mcp-chrome-stdio，请重新安装 $PackageName"
  exit 1
}
Write-OK '已找到 mcp-chrome-stdio'

# ── Step 2: 可选生成项目 MCP 配置 ────────────────────────────────────
if ($WriteConfig) {
  Write-Step "写入 MCP 配置: $ConfigPath"
  if (-not (Test-Path $TemplatePath)) {
    Write-Err "未找到配置模板: $TemplatePath"
    exit 1
  }
  $template = Get-Content $TemplatePath -Raw | ConvertFrom-Json
  if (Test-Path $ConfigPath) {
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    if (-not $config.PSObject.Properties['mcpServers']) {
      $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{})
    }
    $config.mcpServers | Add-Member -Force -NotePropertyName chrome -NotePropertyValue $template.mcpServers.chrome
  } else {
    $config = $template
  }
  $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  Write-OK '已生成原生 mcp-chrome-stdio 配置'
}

# ── Step 3: 检查 HTTP 服务 ───────────────────────────────────────────
Write-Step '检查后端 MCP 服务...'
try {
  $serverUrl = if ($env:MCP_SERVER_URL) { $env:MCP_SERVER_URL } else { 'http://127.0.0.1:12306/mcp-new' }
  $isStateless = $serverUrl.TrimEnd('/') -match '/mcp-new$'
  $origin = if ($env:MCP_SERVER_ORIGIN) { $env:MCP_SERVER_ORIGIN } else { 'chrome-extension://mcp-stdio' }
  $testReq = [System.Net.WebRequest]::Create($serverUrl)
  $testReq.Method = 'POST'
  $testReq.ContentType = 'application/json'
  $testReq.Accept = 'application/json, text/event-stream'
  $testReq.Headers.Add('Origin', $origin)
  if ($env:CHROME_MCP_API_KEY) {
    $testReq.Headers.Add('Authorization', "Bearer $($env:CHROME_MCP_API_KEY)")
  }
  if ($isStateless) {
    $testReq.Headers.Add('MCP-Protocol-Version', '2026-07-28')
    $testReq.Headers.Add('Mcp-Method', 'server/discover')
  }
  $body = if ($isStateless) {
    '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"install-probe","version":"1.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'
  } else {
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"install-probe","version":"1.0"}}}'
  }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $testReq.ContentLength = $bytes.Length
  $requestStream = $testReq.GetRequestStream()
  $requestStream.Write($bytes, 0, $bytes.Length)
  $requestStream.Close()
  $response = $testReq.GetResponse()
  $response.Close()
  Write-OK "后端 MCP 服务运行中（$serverUrl）"
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  if ($statusCode -eq 401 -or $statusCode -eq 403) {
    Write-Warn '后端要求 API Key，请设置 $env:CHROME_MCP_API_KEY 后重试'
  } else {
    Write-Warn '后端服务未运行，请先执行: mcp-chrome-bridge start'
  }
}

Write-Host ''
Write-Host '🎉 安装检查完成！' -ForegroundColor $Green
Write-Host '使用同一份 stdio 配置即可接入 Claude、Cursor、VS Code/Cline、Windsurf、Continue、Codex 等客户端。' -ForegroundColor $Cyan
Write-Host '默认端点: /mcp-new；失败自动回退: /mcp' -ForegroundColor $Cyan
