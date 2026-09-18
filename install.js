#!/usr/bin/env node
/**
 * install.js — 生成 MCP 客户端配置（跨平台：Windows / macOS / Linux 通用）
 *
 * 用法:
 *   node install.js [选项]
 *
 * 选项:
 *   --out, -o <路径>   配置输出路径（默认：当前目录的 .mcp.json）
 *   --skip-config      只做环境检查，不写配置
 *   --no-probe         跳过后端服务探测
 *   --quiet, -q        精简输出
 *   --help, -h         显示帮助
 *
 * 行为:
 *   - 校验 Node.js 版本与 bridge 脚本是否存在；
 *   - 读取 .mcp.json.example，把 __BRIDGE_PATH__ 替换为本仓库 bridge 的绝对路径；
 *   - 目标文件已存在时只更新 mcpServers.chrome，保留其他 server 配置；
 *   - 探测一次后端 /status，提前暴露链路问题；
 *   - 不启动、不注册任何后端服务，也不修改全局客户端配置。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MIN_NODE_MAJOR = 18;
const REPO_ROOT = __dirname;
const BRIDGE_PATH = path.join(REPO_ROOT, 'mcp-bridge.js');
const TEMPLATE_PATH = path.join(REPO_ROOT, '.mcp.json.example');
const SERVER_KEY = 'chrome';
const STATUS_TIMEOUT_MS = 5000;

const HELP = `
install.js — 生成 MCP 客户端配置 (chrome-mcp-bridge-2026-skill)

用法: node install.js [选项]

选项:
  --out, -o <路径>   配置输出路径（默认：当前目录的 .mcp.json）
  --skip-config      只做环境检查，不写配置
  --no-probe         跳过后端服务探测
  --quiet, -q        精简输出
  --help, -h         显示本帮助

说明:
  本脚本不会启动或注册后端服务；配置完成后请完全重启 AI 客户端。
  自检整条链路: node mcp-bridge.js doctor
`;

function parseArgs(argv) {
  const options = {
    out: path.join(process.cwd(), '.mcp.json'),
    skipConfig: false,
    probe: true,
    quiet: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') {
      const value = argv[++i];
      if (!value) throw new Error('--out 需要路径参数');
      options.out = path.resolve(value);
    } else if (arg === '--skip-config') {
      options.skipConfig = true;
    } else if (arg === '--no-probe') {
      options.probe = false;
    } else if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return options;
}

/** 读取模板并生成本仓库的 server 条目。 */
function buildServerEntry() {
  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf-8'));
  const entry = template?.mcpServers?.[SERVER_KEY];
  if (!entry) throw new Error(`配置模板缺少 mcpServers.${SERVER_KEY}: ${TEMPLATE_PATH}`);
  const args = Array.isArray(entry.args) ? entry.args.filter(arg => arg !== '__BRIDGE_PATH__') : ['--server'];
  return { ...entry, args: [BRIDGE_PATH, ...args] };
}

/** 写入配置：已有文件只替换 chrome 条目，保留其他 server。 */
function writeConfig(outPath, entry) {
  let config;
  let merged = false;
  if (fs.existsSync(outPath)) {
    const existing = fs.readFileSync(outPath, 'utf-8').trim();
    if (existing) {
      try {
        config = JSON.parse(existing);
      } catch (err) {
        throw new Error(`目标文件不是有效 JSON，已停止以免覆盖你的配置 (${outPath}): ${err.message}`);
      }
      merged = true;
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }
  config.mcpServers[SERVER_KEY] = entry;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  return { merged };
}

/** 探测后端 /status；失败只提示，不影响安装结果。 */
async function probeBackend(entry) {
  const url = entry?.env?.MCP_SERVER_URL || 'http://127.0.0.1:12306/mcp-new';
  const origin = entry?.env?.MCP_SERVER_ORIGIN || 'http://127.0.0.1';
  const apiKey = entry?.env?.CHROME_MCP_API_KEY;
  const statusUrl = new URL('/status?probe=1', new URL(url).origin).toString();
  const headers = { Accept: 'application/json', Origin: origin };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(statusUrl, { headers, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 保留原文 */ }
    if (!response.ok) {
      const detail = (json && (json.error || json.message)) || text.slice(0, 120);
      return { ok: false, detail: `HTTP ${response.status}: ${detail}`,
        hint: '检查 CHROME_MCP_API_KEY 与 MCP_SERVER_ORIGIN 是否在服务端白名单中' };
    }
    const toolCount = json?.tools?.count ?? 0;
    const chainOk = json?.connectionState === 'ready'
      && json?.extension?.connected === true
      && json?.nativeHost?.connected === true
      && json?.probe?.ok === true;
    return {
      ok: chainOk,
      detail: `服务 v${json?.server?.version ?? '未知'} · connectionState=${json?.connectionState ?? '未知'} · 工具 ${toolCount} 个`,
      hint: chainOk ? null : '链路未就绪：确认 Chrome 已打开、扩展已启用、Native Host 已注册',
    };
  } catch (err) {
    const reason = err.name === 'AbortError' ? `探测超时 (${STATUS_TIMEOUT_MS}ms)` : err.message;
    return {
      ok: false,
      detail: `${url} — ${reason}`,
      hint: 'Chrome MCP 服务未运行：请先启动本地服务，或确认 CHROME_MCP_AUTOSTART_SERVER 没有被设为 0',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`错误: ${err.message}`);
    console.error('运行 "node install.js --help" 查看用法。');
    process.exit(1);
  }

  if (options.help) {
    console.log(HELP);
    return;
  }

  const log = (...args) => { if (!options.quiet) console.log(...args); };
  let failed = false;

  log('chrome-mcp-bridge-2026-skill — 配置生成器');
  log('');

  // 1. Node.js 版本
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= MIN_NODE_MAJOR) {
    log(`✅ Node.js 运行时  v${process.versions.node}`);
  } else {
    failed = true;
    log(`❌ Node.js 运行时  v${process.versions.node}（需要 >= ${MIN_NODE_MAJOR}）`);
  }

  // 2. bridge 与模板
  if (!fs.existsSync(BRIDGE_PATH)) {
    failed = true;
    log(`❌ bridge 脚本  未找到: ${BRIDGE_PATH}`);
  } else {
    log(`✅ bridge 脚本  ${BRIDGE_PATH}`);
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    failed = true;
    log(`❌ 配置模板  未找到: ${TEMPLATE_PATH}`);
  }
  if (failed) {
    log('');
    log('结论: ❌ 环境不完整，请先修复上面的问题。');
    process.exit(1);
  }

  const entry = buildServerEntry();

  // 3. 写配置
  if (options.skipConfig) {
    log('⏭️  已跳过配置写入（--skip-config）');
  } else {
    let result;
    try {
      result = writeConfig(options.out, entry);
    } catch (err) {
      console.error(`❌ 写入配置失败: ${err.message}`);
      process.exit(1);
    }
    log(`✅ 已${result.merged ? '更新' : '生成'}配置  ${options.out}`);
  }

  // 4. 后端探测
  if (options.probe) {
    const probe = await probeBackend(entry);
    log(`${probe.ok ? '✅' : '⚠️ '} 后端链路  ${probe.detail}`);
    if (!probe.ok && probe.hint) log(`   提示: ${probe.hint}`);
  }

  log('');
  log('下一步:');
  if (!options.skipConfig) log(`  1. 完全重启 AI 客户端，让它读取 ${options.out}`);
  log('  2. 运行 "node mcp-bridge.js doctor" 自检整条链路');
  log('');
  log('注意: 本脚本不会启动或注册后端服务。');
}

main().catch(err => {
  console.error(`install.js 异常: ${err.message}`);
  process.exit(1);
});
