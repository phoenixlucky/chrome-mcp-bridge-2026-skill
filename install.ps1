#!/usr/bin/env pwsh
<#
.SYNOPSIS
  生成当前项目的 .mcp.json，并固定使用仓库内新版 mcp-bridge.js。
  这是 install.js 的 PowerShell 包装器；真正的逻辑在 install.js，跨平台通用。

.PARAMETER SkipConfig
  跳过 .mcp.json 自动生成。

.PARAMETER ConfigPath
  要写入的 MCP 配置路径；默认是当前目录的 .mcp.json。

.PARAMETER NoProbe
  跳过后端服务探测。

.EXAMPLE
  .\install.ps1
  .\install.ps1 -ConfigPath '..\my-app\.mcp.json'
  .\install.ps1 -SkipConfig

.NOTES
  本安装器不会启动或注册后端服务；配置完成后请完全重启 AI 客户端。
  本文件必须保存为 UTF-8 with BOM，否则 Windows PowerShell 5.1 会把中文读成乱码并导致解析失败。
#>

param(
  [switch]$SkipConfig,
  [string]$ConfigPath,
  [switch]$NoProbe
)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$BridgePath = Join-Path $RepoRoot 'mcp-bridge.js'
$InstallerPath = Join-Path $RepoRoot 'install.js'

if (-not (Test-Path -LiteralPath $BridgePath)) {
  throw "未找到新版 bridge: $BridgePath"
}
if (-not (Test-Path -LiteralPath $InstallerPath)) {
  throw "未找到 install.js: $InstallerPath"
}

# 解析 Node 可执行文件。某些受限环境里 Get-Command node 取不到，但 node.exe 可以。
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue }
if (-not $nodeCmd) {
  throw '未找到 Node.js。请先安装 Node.js 18 或更高版本，再重新运行本脚本。'
}
$nodeExe = $nodeCmd.Source
if (-not $nodeExe) { $nodeExe = $nodeCmd.Path }

# 尽力做一次版本前置检查；读不到版本时不阻断（install.js 会再次校验并给出明确结论）。
$nodeVersion = $null
try { $nodeVersion = ((& $nodeExe --version) -replace '^v', '').Trim() } catch { $nodeVersion = $null }
if ($nodeVersion -match '^\d+\.') {
  $nodeMajor = [int]($nodeVersion.Split('.')[0])
  if ($nodeMajor -lt 18) {
    throw "Node.js 版本过低（当前 $nodeVersion），需要 >= 18。"
  }
  Write-Host "Node.js: $nodeVersion"
} else {
  Write-Warning '未能读取 Node.js 版本，跳过版本检查（install.js 会再次校验）。'
}

$installerArgs = @($InstallerPath)
if ($SkipConfig) { $installerArgs += '--skip-config' }
if ($NoProbe) { $installerArgs += '--no-probe' }
if ($ConfigPath) { $installerArgs += @('--out', $ConfigPath) }

& $nodeExe @installerArgs
# $LASTEXITCODE 只有在原生命令真正执行后才会被赋值；为空时不误报失败。
if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
  throw "install.js 执行失败（退出码 $LASTEXITCODE）"
}

Write-Host ''
Write-Host '默认端点: /mcp-new（MCP 2026-07-28，无会话）'
Write-Host '安装器不会启动或注册后端服务；请确保已有 Chrome MCP 服务运行后，再完全重启 AI 客户端。'
Write-Host "自检命令: node `"$BridgePath`" doctor"
