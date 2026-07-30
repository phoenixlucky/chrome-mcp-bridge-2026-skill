#!/usr/bin/env node
/**
 * mcp-bridge.js — Streamable HTTP MCP 桥接脚本 (v3.0)
 *
 * 一个通用的 MCP 协议桥接工具，支持两种运行模式：
 *
 * 🖥️ CLI 模式（默认）：
 *   将 streamable-http MCP 服务通过 CLI 命令暴露给 shell 环境使用。
 *   适用于不支持 SSE 长连接的 AI 代理。
 *
 * 🧩 Server 模式（--server）：
 *   作为一个标准的 stdio MCP Server 运行，内部自动代理到
 *   streamable-http MCP 服务。任何支持 MCP 的客户端
 *   （Claude Desktop、VS Code、Cursor 等）都可以直接配置使用。
 *
 * 环境变量：
 *   MCP_SERVER_URL   - 后端 MCP 服务地址（默认 http://127.0.0.1:12306/mcp）
 *   DEBUG             - 设为 1 开启详细日志
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

// ── 配置 ──────────────────────────────────────────────────────────────────

const MCP_URL = process.env.MCP_SERVER_URL || 'http://127.0.0.1:12306/mcp';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const STDIN_TIMEOUT_MS = 3000;
const SESSION_FILE = path.join(os.tmpdir(), 'mcp-bridge-session.json');
const SERVER_NAME = 'mcp-bridge-server';
const SERVER_VERSION = '3.1.0';
const BACKEND_CLIENT_NAME = 'mcp-bridge-backend';
const BACKEND_CLIENT_VERSION = '3.1.0';

// MCP 协议版本协商 — 与服务端 SDK 列表保持一致
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25', '2025-06-18', '2025-03-26',
  '2024-11-05', '2024-10-07',
];
const LATEST_PROTOCOL_VERSION = '2025-11-25';
/** 本次会话协商确定的协议版本（在 initialize 时确定） */
let negotiatedProtocolVersion = LATEST_PROTOCOL_VERSION;

function debug(...args) {
  if (process.env.DEBUG) console.error('[桥接-debug]', ...args);
}

// ── Session 管理 ──────────────────────────────────────────────────────────

function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
      return JSON.parse(raw).sessionId || null;
    }
  } catch {}
  return null;
}

function saveSession(sessionId) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ sessionId, savedAt: Date.now() }), 'utf-8');
  } catch (err) {
    console.error(`[桥接] 警告: 无法写入 session 文件: ${err.message}`);
  }
}

function clearSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  } catch {}
}

// ── JSON-RPC 错误检测 ─────────────────────────────────────────────────────

function isJsonRpcError(json) {
  return json && json.error && (json.error.code || json.error.message);
}

function isSessionError(json) {
  if (!json || !json.error) return false;
  const msg = (json.error.message || '').toLowerCase();
  return msg.includes('session') || msg.includes('invalid mcp');
}

// ── SSE 解析 ──────────────────────────────────────────────────────────────

function parseSSEStream(text) {
  const events = [];
  const lines = text.split('\n');
  let currentEvent = {};
  for (const line of lines) {
    if (line.startsWith('event: ')) currentEvent.event = line.slice(7).trim();
    else if (line.startsWith('data: ')) {
      const dataStr = line.slice(6).trim();
      try { currentEvent.data = JSON.parse(dataStr); } catch { currentEvent.data = dataStr; }
    } else if (line === '' && Object.keys(currentEvent).length > 0) {
      events.push(currentEvent);
      currentEvent = {};
    }
  }
  if (Object.keys(currentEvent).length > 0) events.push(currentEvent);
  return events;
}

// ── HTTP 请求 ─────────────────────────────────────────────────────────────

async function sendRequest(method, params = {}) {
  const sessionId = loadSession();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream, application/json',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const isNotification = method === 'close' || method === 'notifications/**';
  const body = isNotification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: Date.now(), method, params };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(MCP_URL, {
      method: 'POST', headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error(`请求超时 (${REQUEST_TIMEOUT_MS}ms): ${method}`);
    if (err.code === 'ECONNREFUSED') throw new Error(`无法连接 MCP 服务: ${MCP_URL} — 请确认服务已启动`);
    throw new Error(`网络错误: ${err.message}`);
  }
  clearTimeout(timeout);

  const newSessionId = response.headers.get('Mcp-Session-Id');
  if (newSessionId) saveSession(newSessionId);

  const contentType = (response.headers.get('Content-Type') || '').toLowerCase();

  if (contentType.includes('text/event-stream')) {
    const rawText = await response.text();
    const events = parseSSEStream(rawText);
    for (const evt of events) {
      if (evt.event === 'message' && evt.data) {
        if (isJsonRpcError(evt.data)) {
          const err = new Error(evt.data.error.message || '未知错误');
          err.jsonRpcError = evt.data.error;
          err.isSessionError = isSessionError(evt.data);
          throw err;
        }
        return evt.data;
      }
    }
    if (events.length > 0 && events[0].data !== undefined) return events[0].data;
    return { _sseEvents: events };
  } else {
    const json = await response.json();
    if (isJsonRpcError(json)) {
      const err = new Error(json.error.message || '未知错误');
      err.jsonRpcError = json.error;
      err.isSessionError = isSessionError(json);
      throw err;
    }
    return json;
  }
}

// ── 带重试的调用 ─────────────────────────────────────────────────────────

async function callWithRetry(method, params = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await sendRequest(method, params);
    } catch (err) {
      lastError = err;
      if (err.isSessionError || (err.message && (
        err.message.toLowerCase().includes('session') ||
        err.message.toLowerCase().includes('invalid mcp')
      ))) {
        clearSession();
        if (attempt <= MAX_RETRIES) {
          console.error(`[桥接] Session 已过期，清理后重试 (${attempt}/${MAX_RETRIES})...`);
          continue;
        }
        console.error('[桥接] Session 重试耗尽，尝试重新初始化...');
        try {
          await sendRequest('initialize', {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: { roots: { listChanged: false }, sampling: {} },
            clientInfo: { name: BACKEND_CLIENT_NAME, version: BACKEND_CLIENT_VERSION },
          });
          console.error('[桥接] 重新初始化成功，重试原请求...');
          return await sendRequest(method, params);
        } catch (initErr) {
          throw new Error(`Session 恢复失败: ${initErr.message}`);
        }
      }
      if (attempt <= MAX_RETRIES) {
        console.error(`[桥接] 请求失败，正在重试 (${attempt}/${MAX_RETRIES}): ${err.message}`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ── 从 stdin 读取 JSON（CLI --stdin 模式）────────────────────────────────

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      return reject(new Error('stdin 模式需要管道输入，例如: echo \'{"key":"value"}\' | node mcp-bridge.js call ... --stdin'));
    }
    const chunks = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => {
      const input = chunks.join('').trim();
      if (!input) return reject(new Error('stdin 为空'));
      try { resolve(JSON.parse(input)); }
      catch (e) { reject(new Error(`stdin 内容不是有效 JSON: ${e.message}`)); }
    });
    process.stdin.on('error', reject);
    setTimeout(() => {
      if (!process.stdin.readableEnded) { process.stdin.destroy(); reject(new Error(`stdin 读取超时 (${STDIN_TIMEOUT_MS}ms)`)); }
    }, STDIN_TIMEOUT_MS);
  });
}

// ── MCP Server 模式（--server）────────────────────────────────────────────

/**
 * 从 stdin 读取一个完整的 JSON-RPC 消息（Content-Length 协议）
 *
 * MCP stdio 传输协议格式：
 *   Content-Length: N\r\n
 *   \r\n
 *   {"jsonrpc":"2.0","id":1,...}   ← 恰好 N 字节
 */
function readMcpMessage() {
  return new Promise((resolve, reject) => {
    let headerBuffer = '';
    let contentLength = -1;
    let bodyBuffer = null;

    function onData(chunk) {
      const str = chunk.toString();
      if (contentLength === -1) {
        headerBuffer += str;
        const headerEnd = headerBuffer.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const header = headerBuffer.substring(0, headerEnd);
          const match = header.match(/Content-Length:\s*(\d+)/i);
          if (!match) {
            cleanup();
            return reject(new Error('MCP 消息缺少 Content-Length 头'));
          }
          contentLength = parseInt(match[1], 10);
          // 头之后的剩余字节作为 body 开头
          const remaining = Buffer.from(headerBuffer.substring(headerEnd + 4), 'utf-8');
          bodyBuffer = Buffer.from(remaining);
          if (bodyBuffer.length >= contentLength) {
            cleanup();
            try {
              resolve(JSON.parse(bodyBuffer.toString('utf-8', 0, contentLength)));
            } catch (e) {
              reject(new Error(`JSON 解析失败: ${e.message}`));
            }
          }
        }
      } else {
        bodyBuffer = Buffer.concat([bodyBuffer, Buffer.from(str, 'utf-8')]);
        if (bodyBuffer.length >= contentLength) {
          cleanup();
          try {
            resolve(JSON.parse(bodyBuffer.toString('utf-8', 0, contentLength)));
          } catch (e) {
            reject(new Error(`JSON 解析失败: ${e.message}`));
          }
        }
      }
    }

    function onEnd() {
      cleanup();
      reject(new Error('stdin closed'));
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
    }

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.setEncoding('utf-8');
  });
}

/** 向 stdout 写入一个 JSON-RPC 消息（Content-Length 协议，零依赖） */
function writeMcpMessage(msg) {
  const body = JSON.stringify(msg);
  const byteLen = Buffer.byteLength(body, 'utf-8');
  process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${body}`);
}

/** 统一的后端工具响应提取 */
function extractTools(backendResult) {
  if (!backendResult) return [];
  if (Array.isArray(backendResult.tools)) return backendResult.tools;
  if (backendResult.result && Array.isArray(backendResult.result.tools)) return backendResult.result.tools;
  if (Array.isArray(backendResult)) return backendResult;
  return [];
}

/** 初始化后端连接并拉取工具列表 */
async function initBackend() {
  console.error('[mcp-server] 正在连接后端 MCP 服务...');
  const initResult = await callWithRetry('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: { roots: { listChanged: false }, sampling: {} },
    clientInfo: { name: BACKEND_CLIENT_NAME, version: BACKEND_CLIENT_VERSION },
  });
  console.error('[mcp-server] 后端 MCP 连接成功');
  debug(`协商协议版本: ${LATEST_PROTOCOL_VERSION}`);

  let backendTools = [];
  try {
    const toolsResult = await callWithRetry('tools/list');
    backendTools = extractTools(toolsResult);
    console.error(`[mcp-server] 已加载 ${backendTools.length} 个工具`);
  } catch (err) {
    console.error(`[mcp-server] 获取工具列表失败: ${err.message}`);
  }

  return { initResult, backendTools };
}

/** 处理单个 MCP 请求 */
async function handleRequest(id, method, params) {
  debug('收到请求:', method, JSON.stringify(params).substring(0, 200));

  switch (method) {
    case 'initialize': {
      // 版本协商：接受客户端请求的版本（如果在支持列表中）
      const requestedVersion = params && params.protocolVersion;
      const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : LATEST_PROTOCOL_VERSION;
      negotiatedProtocolVersion = negotiated;

      writeMcpMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiated,
          capabilities: {
            tools: {},
            roots: { listChanged: false },
            sampling: {},
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
        },
      });
      return;
    }

    case 'tools/list': {
      let tools = [];
      try {
        const result = await callWithRetry('tools/list');
        tools = extractTools(result);
      } catch (err) {
        console.error(`[mcp-server] tools/list 代理失败: ${err.message}`);
        writeMcpMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: `Backend tools/list failed: ${err.message}` },
        });
        return;
      }
      writeMcpMessage({
        jsonrpc: '2.0',
        id,
        result: { tools },
      });
      return;
    }

    case 'tools/call': {
      const { name, arguments: args } = params;
      if (!name) {
        writeMcpMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tool name' },
        });
        return;
      }
      try {
        const result = await callWithRetry('tools/call', { name, arguments: args || {} });

        // 标准 MCP 响应：content 数组
        let content;
        if (result && Array.isArray(result.content)) {
          content = result.content;
        } else {
          const text = typeof result === 'string'
            ? result
            : JSON.stringify(result, null, 2);
          content = [{ type: 'text', text }];
        }

        // 检查是否有 isError 标记
        const response = { content };
        if (result && result.isError) {
          response.isError = true;
        }

        writeMcpMessage({
          jsonrpc: '2.0',
          id,
          result: response,
        });
      } catch (err) {
        writeMcpMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err.message },
        });
      }
      return;
    }

    case 'ping':
      writeMcpMessage({
        jsonrpc: '2.0',
        id,
        result: {},
      });
      return;

    case 'resources/list':
      writeMcpMessage({
        jsonrpc: '2.0',
        id,
        result: { resources: [] },
      });
      return;

    case 'prompts/list':
      writeMcpMessage({
        jsonrpc: '2.0',
        id,
        result: { prompts: [] },
      });
      return;

    default:
      writeMcpMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
}

/** 快速探测后端 MCP 服务是否存活（短超时）
 *  用 TCP 连接检测端口是否开放，不发送任何 MCP 请求，避免干扰 session */
async function probeBackend(url, timeoutMs = 3000) {
  try {
    const urlObj = new URL(url);
    const port = parseInt(urlObj.port, 10) || 80;
    const host = urlObj.hostname;
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.connect(port, host);
    });
  } catch {
    return false;
  }
}

/** 自动启动后端 Chrome MCP 服务（mcp-chrome-bridge start） */
function autoStartBackend() {
  return new Promise((resolve, reject) => {
    console.error('[mcp-server] 后端 MCP 服务未运行，正在自动启动...');

    const child = spawn('mcp-chrome-bridge', ['start', '--port', '12306'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: process.platform === 'win32',
    });

    let started = false;
    const startupTimeout = setTimeout(() => {
      if (!started) {
        started = true;
        console.error('[mcp-server] 警告: 后端服务启动超时（15s），将继续尝试连接');
        resolve(false);
      }
    }, 15000);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      console.error('[后端]', text.trim());
      // 服务启动后会打印特定信息
      if (!started && (text.includes('listening') || text.includes('started') || text.includes('Server') || text.includes('12306'))) {
        started = true;
        clearTimeout(startupTimeout);
        console.error('[mcp-server] 后端服务已启动');
        // 给服务一点时间完全就绪
        setTimeout(() => resolve(true), 1000);
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      console.error('[后端]', text.trim());
      if (!started && (text.includes('listening') || text.includes('started') || text.includes('Server') || text.includes('12306'))) {
        started = true;
        clearTimeout(startupTimeout);
        console.error('[mcp-server] 后端服务已启动');
        setTimeout(() => resolve(true), 1000);
      }
    });

    child.on('error', (err) => {
      if (!started) {
        started = true;
        clearTimeout(startupTimeout);
        console.error(`[mcp-server] 启动后端服务失败: ${err.message}`);
        resolve(false);
      }
    });

    child.on('exit', (code) => {
      if (!started) {
        started = true;
        clearTimeout(startupTimeout);
        console.error(`[mcp-server] 后端服务异常退出 (code: ${code})`);
        resolve(false);
      }
    });
  });
}

async function startMcpServer() {
  // 自动检测并启动后端 MCP 服务
  const isAlive = await probeBackend(MCP_URL, 3000);
  if (!isAlive) {
    console.error('[mcp-server] 后端 MCP 服务不可用，尝试自动启动...');
    const launched = await autoStartBackend();
    if (launched) {
      // 等待服务完全就绪
      for (let i = 0; i < 10; i++) {
        const ready = await probeBackend(MCP_URL, 2000);
        if (ready) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      console.error('[mcp-server] 自动启动失败，请手动执行: mcp-chrome-bridge start');
    }
  }

  try {
    await initBackend();
  } catch (err) {
    console.error(`[mcp-server] 后端连接失败: ${err.message}`);
    console.error('[mcp-server] 仍将继续监听，但后端工具可能不可用');
  }

  console.error('[mcp-server] 正在监听 stdin（MCP stdio 协议）...');
  console.error('[mcp-server] 按 Ctrl+C 退出');

  while (true) {
    let message;
    try {
      message = await readMcpMessage();
    } catch (err) {
      if (err.message === 'stdin closed') {
        console.error('[mcp-server] stdin 关闭，优雅退出');
        try { await sendRequest('close'); } catch {}
        clearSession();
        process.exit(0);
      }
      console.error(`[mcp-server] 读取消息失败: ${err.message}`);
      continue;
    }

    // 通知类消息（无 id）不响应
    if (!message || message.id === undefined || message.id === null) {
      continue;
    }

    // 异步处理，不阻塞后续消息
    handleRequest(message.id, message.method, message.params || {}).catch(err => {
      console.error(`[mcp-server] 请求处理异常: ${err.message}`);
      writeMcpMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: `Internal error: ${err.message}` },
      });
    });
  }
}

// ── 工具函数 ───────────────────────────────────────────────────────────────

function isPowerShell() {
  const env = process.env;
  return !!(
    (env.PSModulePath) ||
    (env.WT_SESSION) ||
    (env.SHELL && env.SHELL.includes('powershell')) ||
    (process.platform === 'win32' && !env.SHELL)
  );
}

function getScriptPath() {
  return __filename;
}

// ── CLI 入口 ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // 无参数：显示帮助
  if (!command) {
    const psHint = isPowerShell()
      ? '\n🔵 检测到 PowerShell 环境！建议使用 --stdin 模式。\n   详见: node mcp-bridge.js call <method> --stdin'
      : '';
    console.log(`
mcp-bridge.js — Streamable HTTP MCP 桥接工具 (v${SERVER_VERSION})

支持协议版本: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}

模式:
  --server                          以 stdio MCP Server 模式运行
  path                              显示脚本绝对路径
  init                              初始化连接
  call <method> [params|--stdin]    调用方法
  ping                              心跳保活
  close                             关闭连接

环境变量:
  MCP_SERVER_URL                    后端 MCP 服务地址（默认 ${MCP_URL}）
  DEBUG                             设为 1 开启调试日志

--stdin 示例（推荐，避免 shell 转义）:
  echo '{"name":"x","arguments":{}}' | node mcp-bridge.js call tools/call --stdin

PowerShell heredoc 示例:
  $body = @'
  {"name":"chrome_navigate","arguments":{"url":"https://example.com?lang=en"}}
  '@
  $body | node mcp-bridge.js call tools/call --stdin

MCP Server 配置示例（.mcp.json / claude_desktop_config.json）:
  {
    "mcpServers": {
      "chrome-bridge": {
        "command": "node",
        "args": ["${getScriptPath().replace(/\\/g, '\\\\')}", "--server"]
      }
    }
  }
${psHint}`);
    process.exit(0);
  }

  // ── --server 模式 ──────────────────────────────────────────────────
  if (command === '--server') {
    await startMcpServer();
    return;
  }

  // ── 常规 CLI 模式 ──────────────────────────────────────────────────
  try {
    let result;
    switch (command) {
      case 'init':
        result = await callWithRetry('initialize', {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { roots: { listChanged: false }, sampling: {} },
          clientInfo: { name: BACKEND_CLIENT_NAME, version: BACKEND_CLIENT_VERSION },
        });
        if (result && result.protocolVersion) {
          negotiatedProtocolVersion = result.protocolVersion;
        }
        debug(`协商协议版本: ${negotiatedProtocolVersion}`);
        break;

      case 'path':
        console.log(getScriptPath());
        process.exit(0);
        break;

      case 'call': {
        const method = args[1];
        if (!method) { console.error('错误: 请指定方法名'); process.exit(1); }
        let params = {};
        if (args[2]) {
          if (args[2] === '--stdin') {
            params = await readStdin();
          } else {
            try { params = JSON.parse(args[2]); }
            catch {
              console.error('错误: params 不是有效 JSON');
              console.error('收到:', args[2].substring(0, 200));
              if (isPowerShell()) {
                console.error('\n💡 检测到 PowerShell 环境！请改用 heredoc + --stdin 模式：');
                console.error('');
                console.error('   $body = @\'');
                console.error(`   ${args[2].replace(/&/g, '`&').substring(0, 200)}`);
                console.error("   '@");
                console.error(`   $body | node mcp-bridge.js call ${method.replace(/'/g, "''")} --stdin`);
                console.error('');
              } else {
                console.error('\n💡 提示: 参数含 & 等特殊字符时，请用 --stdin 模式:');
                console.error(`  echo '${args[2].substring(0, 100)}' | node mcp-bridge.js call ${method} --stdin`);
              }
              process.exit(1);
            }
          }
        }
        result = await callWithRetry(method, params);
        if (method === 'tools/call' && result && result._sseEvents) {
          const msgEvent = result._sseEvents.find(e => e.event === 'message' && e.data?.result);
          if (msgEvent) result = msgEvent.data;
        }
        break;
      }

      case 'ping':
        result = await callWithRetry('ping');
        break;

      case 'close':
        try { await sendRequest('close'); } catch {}
        clearSession();
        console.log('连接已关闭，session 已清理');
        process.exit(0);
        break;

      default:
        console.error(`错误: 未知命令 "${command}"`);
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`[桥接] 错误: ${err.message}`);
    if (err.jsonRpcError) console.error(`[桥接] JSON-RPC 错误码: ${err.jsonRpcError.code}`);
    process.exit(1);
  }
}

main();
