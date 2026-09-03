#!/usr/bin/env pwsh
<#
.SYNOPSIS
  自动生成当前项目的 .mcp.json，并测试 mcp-chrome-bridge start。

.PARAMETER SkipConfig
  跳过自动生成 .mcp.json。

.PARAMETER ConfigPath
  指定要写入的 MCP 配置路径；默认是当前目录的 .mcp.json。
#>

param(
  [switch]$SkipConfig,
  [string]$ConfigPath = (Join-Path (Get-Location) '.mcp.json')
)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$PackageName = '@ethanwilkins/mcp-chrome-bridge-2026'
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

# ── Step 1: 自动生成项目 MCP 配置 ─────────────────────────────────────
if (-not $SkipConfig) {
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
  Write-OK '已自动生成原生 mcp-chrome-stdio 配置'
}

# ── Step 2: 只测试后端启动命令 ───────────────────────────────────────
Write-Step '测试 mcp-chrome-bridge start...'
$bridgeCommand = Get-Command mcp-chrome-bridge -ErrorAction SilentlyContinue
if (-not $bridgeCommand) {
  Write-Err "未找到 mcp-chrome-bridge，请先全局安装 $PackageName 后重试"
  exit 1
}

$stdoutPath = Join-Path ([IO.Path]::GetTempPath()) "mcp-chrome-bridge-start-$PID.out"
$stderrPath = Join-Path ([IO.Path]::GetTempPath()) "mcp-chrome-bridge-start-$PID.err"
try {
  $startProcess = if ($bridgeCommand.CommandType -eq 'ExternalScript') {
    Start-Process -FilePath 'pwsh.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $bridgeCommand.Source, 'start') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  } else {
    Start-Process -FilePath $bridgeCommand.Source -ArgumentList 'start' -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  }
} catch {
  Write-Err "无法执行 mcp-chrome-bridge start，请先全局安装 $PackageName 后重试"
  exit 1
}

if ($startProcess.WaitForExit(5000)) {
  if ($startProcess.ExitCode -ne 0) {
    $details = @((Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue), (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)) -join "`n"
    if ($details.Trim()) { Write-Host $details.Trim() -ForegroundColor $Yellow }
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    Write-Err "mcp-chrome-bridge start 启动失败，请先全局安装 $PackageName 后重试"
    exit 1
  }
  Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  Write-OK 'mcp-chrome-bridge start 已成功退出'
} else {
  Write-OK 'mcp-chrome-bridge start 正在运行'
}

Write-Host ''
Write-Host '🎉 安装检查完成！' -ForegroundColor $Green
Write-Host '使用同一份 stdio 配置即可接入 Claude、Cursor、VS Code/Cline、Windsurf、Continue、Codex 等客户端。' -ForegroundColor $Cyan
Write-Host '默认端点: /mcp-new；失败自动回退: /mcp' -ForegroundColor $Cyan
