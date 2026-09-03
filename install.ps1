#!/usr/bin/env pwsh
<#
.SYNOPSIS
  生成当前项目的 .mcp.json，并固定使用仓库内新版 mcp-bridge.js。

.PARAMETER SkipConfig
  跳过 .mcp.json 自动生成。

.PARAMETER ConfigPath
  要写入的 MCP 配置路径；默认是当前目录的 .mcp.json。
#>

param(
  [switch]$SkipConfig,
  [string]$ConfigPath = (Join-Path (Get-Location) '.mcp.json')
)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$TemplatePath = Join-Path $RepoRoot '.mcp.json.example'
$BridgePath = Join-Path $RepoRoot 'mcp-bridge.js'

if (-not (Test-Path -LiteralPath $BridgePath)) {
  throw "未找到新版 bridge: $BridgePath"
}
if (-not (Test-Path -LiteralPath $TemplatePath)) {
  throw "未找到配置模板: $TemplatePath"
}

if (-not $SkipConfig) {
  $template = Get-Content -LiteralPath $TemplatePath -Raw | ConvertFrom-Json
  $template.mcpServers.chrome.args = @($BridgePath, '--server')

  if (Test-Path -LiteralPath $ConfigPath) {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    if (-not $config.PSObject.Properties['mcpServers']) {
      $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{})
    }
    $config.mcpServers | Add-Member -Force -NotePropertyName chrome -NotePropertyValue $template.mcpServers.chrome
  } else {
    $config = $template
  }

  $json = $config | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText($ConfigPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  Write-Host "✅ 已生成 bridge 配置: $ConfigPath"
}

Write-Host '✅ 已确认新版 mcp-bridge.js 存在:' $BridgePath
Write-Host '默认端点: /mcp-new（MCP 2026-07-28，无会话）'
Write-Host '安装器不会启动或注册后端服务；请确保已有 Chrome MCP 服务运行后，再完全重启 AI 客户端。'
