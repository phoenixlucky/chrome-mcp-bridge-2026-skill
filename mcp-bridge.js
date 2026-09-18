#!/usr/bin/env node
/**
 * mcp-bridge.js — Streamable HTTP MCP 桥接脚本 (v4.2.0)
 *
 * 一个通用的 MCP 协议桥接工具，支持两种运行模式：
 *
 * 🖥️ CLI 模式（默认）：
 *   将 streamable-http MCP 服务通过 CLI 命令暴露给 shell 环境使用。
 *   适用于不支持 SSE 长连接的 AI 代理。
 *
 * 🧩 Server 模式（--server / --stdio）：
 *   作为一个标准的 stdio MCP Server 运行，内部自动代理到
 *   streamable-http MCP 服务。任何支持 MCP 的客户端
 *   （Claude Desktop、VS Code、Cursor、Codex 等）都可以直接配置使用。
 *
 * 常用命令（完整列表见 --help）：
 *   --server | --stdio   以 stdio MCP Server 模式运行（给 AI 客户端用）
 *   doctor               自检：Node 版本 / 客户端配置 / 后端链路 / 工具清单
 *   tools [name]         列出工具用途；给出 name 时只显示该工具的完整 schema
 *   init                 初始化连接（/mcp-new 走 server/discover）
 *   call <method> ...    调用任意 MCP 方法（推荐配合 --stdin）
 *   ping | close         心跳保活 / 清理连接
 *   path                 显示脚本绝对路径
 *   --help | --version   帮助 / 版本
 *
 * 环境变量：
 *   MCP_SERVER_URL    - 后端 MCP 服务地址（默认 http://127.0.0.1:12306/mcp-new）
 *   MCP_SERVER_ORIGIN - 发往后端的 Origin（默认 http://127.0.0.1）
 *   CHROME_MCP_API_KEY - 可选的后端 API Key（转发为 Bearer）
 *   MCP_PROTOCOL_MODE - auto（默认）、stateless 或 legacy
 *   MCP_BRIDGE_DIAG   - 设为 1 记录 stdio 收发诊断日志（默认关闭）
 *   DEBUG             - 设为 1 开启详细日志
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

// ── 配置 ──────────────────────────────────────────────────────────────────

const MCP_URL = process.env.MCP_SERVER_URL || 'http://127.0.0.1:12306/mcp-new';
const MCP_ORIGIN = process.env.MCP_SERVER_ORIGIN || 'http://127.0.0.1';
const CHROME_MCP_API_KEY = process.env.CHROME_MCP_API_KEY?.trim();
const MCP_PROTOCOL_MODE = (process.env.MCP_PROTOCOL_MODE || 'auto').trim().toLowerCase();
const MCP_SERVER_PATH = (() => {
  try { return new URL(MCP_URL).pathname.replace(/\/$/, '') || '/'; } catch { return ''; }
})();
const USE_STATELESS_PROTOCOL = MCP_PROTOCOL_MODE === 'stateless'
  || (MCP_PROTOCOL_MODE !== 'legacy' && MCP_SERVER_PATH === '/mcp-new');
const MCP_PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION
  || (USE_STATELESS_PROTOCOL ? '2026-07-28' : '2025-11-25');
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const LONG_TOOL_TIMEOUT_MS = 120_000;
const MIN_TOOL_TRANSPORT_TIMEOUT_MS = 20_000;
const LONG_TOOL = /(?:performance|trace|record|download|upload|proxy_diagnostics|collect_virtual_list)/;
const MAX_RETRIES = 2;
const STDIN_TIMEOUT_MS = 3000;
const STATUS_TIMEOUT_MS = 5000;
const SESSION_FILE = path.join(os.tmpdir(), 'mcp-bridge-session.json');
const SERVER_NAME = 'mcp-bridge-server';
const SERVER_VERSION = '4.2.0';
const BACKEND_CLIENT_NAME = 'mcp-bridge-backend';
const BACKEND_CLIENT_VERSION = '4.2.0';

// 诊断日志：默认关闭，避免长会话里每条 stdio 消息都同步写盘。
const DIAG_ENABLED = envFlag('MCP_BRIDGE_DIAG') || envFlag('DEBUG');
const DIAG_MAX_BYTES = 2 * 1024 * 1024;
const DIAG_IN = path.join(os.tmpdir(), 'bridge-diag-in.log');
const DIAG_OUT = path.join(os.tmpdir(), 'bridge-diag-out.log');

// MCP 协议版本协商 — 与服务端 SDK 列表保持一致
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26',
  '2024-11-05', '2024-10-07',
];
const LATEST_PROTOCOL_VERSION = '2026-07-28';
/** 本次会话协商确定的协议版本（在 initialize 时确定） */
let negotiatedProtocolVersion = LATEST_PROTOCOL_VERSION;
let requestSequence = 0;

function debug(...args) {
  if (process.env.DEBUG) console.error('[桥接-debug]', ...args);
}

/** 把 "1"/"true"/"yes" 视为开启；空串、"0"、"false"、"no" 视为关闭。 */
function envFlag(name) {
  const raw = process.env[name];
  if (raw === undefined) return false;
  const value = String(raw).trim().toLowerCase();
  return value !== '' && value !== '0' && value !== 'false' && value !== 'no' && value !== 'off';
}

/** 诊断日志按大小上限截断写入；失败不影响主流程。 */
function diagAppend(file, data) {
  if (!DIAG_ENABLED) return;
  try {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
    if (fs.statSync(file).size + buf.length > DIAG_MAX_BYTES) return;
    fs.appendFileSync(file, buf);
  } catch { /* 诊断日志属于可选能力 */ }
}

/** 每次启动清空上一轮诊断日志，便于定位当前会话问题。 */
function resetDiagLogs() {
  if (!DIAG_ENABLED) return;
  for (const file of [DIAG_IN, DIAG_OUT]) {
    try { fs.writeFileSync(file, ''); } catch { /* 忽略 */ }
  }
}

// stdout 被客户端提前关闭时不要抛出未捕获异常，直接优雅退出。
process.stdout.on('error', err => {
  if (err && err.code === 'EPIPE') process.exit(0);
});

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

function isSessionError(json) {
  if (!json || !json.error) return false;
  const msg = (typeof json.error === 'string' ? json.error : json.error.message || '').toLowerCase();
  return msg.includes('session') || msg.includes('invalid mcp');
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function unwrapJsonRpcResponse(json) {
  if (json && typeof json === 'object' && hasOwn(json, 'error')) {
    const err = new Error(typeof json.error === 'string' ? json.error : json.error.message || '未知错误');
    if (typeof json.error === 'object') err.jsonRpcError = json.error;
    err.isSessionError = isSessionError(json);
    // 语义性错误重试没有意义：直接失败比反复等待更快。
    const code = err.jsonRpcError && err.jsonRpcError.code;
    if (code === -32601 || code === -32602) err.retryable = false;
    throw err;
  }
  return json && typeof json === 'object' && hasOwn(json, 'result') ? json.result : json;
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

function parseSSEEventBlock(block) {
  const event = {};
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event.event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length) {
    const data = dataLines.join('\n');
    try { event.data = JSON.parse(data); } catch { event.data = data; }
  }
  return event;
}

/**
 * Consume an MCP SSE response incrementally. Notifications are delivered
 * before the final JSON-RPC response so a stdio client can observe progress
 * while a long-running tool is still executing.
 */
async function consumeSSEStream(response, requestId, onNotification) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalMessage = null;

  const handleBlock = async (block) => {
    const event = parseSSEEventBlock(block);
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.id === requestId && (hasOwn(message, 'result') || hasOwn(message, 'error'))) {
      finalMessage = message;
      return;
    }
    if (message.method && message.id === undefined) {
      await onNotification?.(message);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let separator;
    while ((separator = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      await handleBlock(block);
    }
    if (done) break;
  }
  if (buffer.trim()) await handleBlock(buffer);
  return finalMessage;
}

// ── HTTP 请求 ─────────────────────────────────────────────────────────────

function timeoutFor(method, params = {}) {
  if (method !== 'tools/call') return DEFAULT_TOOL_TIMEOUT_MS;
  const args = params.arguments || {};
  const ceiling = LONG_TOOL.test(params.name || '')
    ? LONG_TOOL_TIMEOUT_MS
    : DEFAULT_TOOL_TIMEOUT_MS;
  const requested = Number(args.timeoutMs ?? args.timeout);
  return Number.isFinite(requested)
    ? Math.min(Math.max(requested, MIN_TOOL_TRANSPORT_TIMEOUT_MS), ceiling)
    : ceiling;
}

function backendParams(params = {}) {
  if (!USE_STATELESS_PROTOCOL) return params;
  const meta = params && typeof params._meta === 'object' && params._meta !== null
    ? params._meta
    : {};
  return {
    ...params,
    _meta: {
      ...meta,
      'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
      'io.modelcontextprotocol/clientInfo': {
        name: BACKEND_CLIENT_NAME,
        version: BACKEND_CLIENT_VERSION,
      },
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  };
}

function backendMethodHeaders(method, params) {
  if (!USE_STATELESS_PROTOCOL) return {};
  const headers = {
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    'Mcp-Method': method,
  };
  if (method === 'tools/call' && params?.name) headers['Mcp-Name'] = params.name;
  return headers;
}

async function sendRequest(method, params = {}, options = {}) {
  const sessionId = USE_STATELESS_PROTOCOL ? null : loadSession();
  const requestParams = backendParams(params);
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream, application/json',
    Origin: MCP_ORIGIN,
    ...backendMethodHeaders(method, requestParams),
  };
  if (CHROME_MCP_API_KEY) headers.Authorization = `Bearer ${CHROME_MCP_API_KEY}`;
  if (!USE_STATELESS_PROTOCOL && sessionId && method !== 'initialize') {
    headers['Mcp-Session-Id'] = sessionId;
  }

  const isNotification = method === 'close' || method.startsWith('notifications/');
  const body = isNotification
    ? { jsonrpc: '2.0', method, params: requestParams }
    : { jsonrpc: '2.0', id: `${Date.now()}-${++requestSequence}`, method, params: requestParams };

  const requestTimeoutMs = timeoutFor(method, params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(MCP_URL, {
      method: 'POST', headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error(`请求超时 (${requestTimeoutMs}ms): ${method}`);
    if (err.code === 'ECONNREFUSED') throw new Error(`无法连接 MCP 服务: ${MCP_URL} — 请确认服务已启动`);
    throw new Error(`网络错误: ${err.message}`);
  }
  try {
    if (!response.ok) {
      const detail = (await response.text()).trim().replace(/\s+/g, ' ').slice(0, 300);
      const err = new Error(`MCP HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      err.httpStatus = response.status;
      // 4xx 多为请求本身有问题（404 端点错误、401/403 鉴权），重试只是浪费 3 次往返。
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        err.retryable = false;
      }
      throw err;
    }
    const newSessionId = response.headers.get('Mcp-Session-Id');
    if (!USE_STATELESS_PROTOCOL && newSessionId) saveSession(newSessionId);

    const contentType = (response.headers.get('Content-Type') || '').toLowerCase();

    if (contentType.includes('text/event-stream')) {
      const responseMessage = await consumeSSEStream(response, body.id, options.onNotification);
      if (responseMessage) return unwrapJsonRpcResponse(responseMessage);
      throw new Error(`MCP SSE 响应缺少请求 ${body.id} 的 JSON-RPC 结果`);
    } else {
      const json = await response.json();
      if (!json || typeof json !== 'object' || (!hasOwn(json, 'result') && !hasOwn(json, 'error'))) {
        throw new Error('MCP HTTP 响应不是有效的 JSON-RPC 结果');
      }
      return unwrapJsonRpcResponse(json);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`请求超时 (${requestTimeoutMs}ms): ${method}`);
    if (err.code === 'ECONNREFUSED') throw new Error(`无法连接 MCP 服务: ${MCP_URL} — 请确认服务已启动`);
    if (err.message && err.message.startsWith('MCP ')) throw err;
    throw new Error(`网络错误: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ── 带重试的调用 ─────────────────────────────────────────────────────────

async function callWithRetry(method, params = {}, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await sendRequest(method, params, options);
    } catch (err) {
      lastError = err;
      if (!USE_STATELESS_PROTOCOL && (err.isSessionError || (err.message && (
        err.message.toLowerCase().includes('session') ||
        err.message.toLowerCase().includes('invalid mcp')
      )))) {
        clearSession();
        if (attempt <= MAX_RETRIES) {
          console.error(`[桥接] Session 已过期，清理后重试 (${attempt}/${MAX_RETRIES})...`);
          continue;
        }
        console.error('[桥接] Session 重试耗尽，尝试重新初始化...');
        try {
          await sendRequest('initialize', legacyInitializeParams());
          console.error('[桥接] 重新初始化成功，重试原请求...');
          return await sendRequest(method, params, options);
        } catch (initErr) {
          throw new Error(`Session 恢复失败: ${initErr.message}`);
        }
      }
      if (err.retryable === false) throw err;
      if (attempt <= MAX_RETRIES) {
        console.error(`[桥接] 请求失败，正在重试 (${attempt}/${MAX_RETRIES}): ${err.message}`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function legacyInitializeParams() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { roots: { listChanged: false }, sampling: {} },
    clientInfo: { name: BACKEND_CLIENT_NAME, version: BACKEND_CLIENT_VERSION },
  };
}

async function initializeBackend() {
  return USE_STATELESS_PROTOCOL
    ? callWithRetry('server/discover')
    : callWithRetry('initialize', legacyInitializeParams());
}

// ── 从 stdin 读取 JSON（CLI --stdin 模式）────────────────────────────────

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      return reject(new Error('stdin 模式需要管道输入，例如: echo \'{"key":"value"}\' | node mcp-bridge.js call ... --stdin'));
    }
    const chunks = [];
    let timeout;
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      const input = chunks.join('').trim();
      if (!input) return reject(new Error('stdin 为空'));
      try { resolve(JSON.parse(input)); }
      catch (e) { reject(new Error(`stdin 内容不是有效 JSON: ${e.message}`)); }
    });
    process.stdin.on('error', err => { clearTimeout(timeout); reject(err); });
    timeout = setTimeout(() => {
      if (!process.stdin.readableEnded) { process.stdin.destroy(); reject(new Error(`stdin 读取超时 (${STDIN_TIMEOUT_MS}ms)`)); }
    }, STDIN_TIMEOUT_MS);
  });
}

// ── MCP Server 模式（--server）────────────────────────────────────────────

/**
 * stdin 持久输入缓冲：常驻监听 data 事件，把收到的字节累积到缓冲区。
 * 这样多条 MCP 消息即使合并进同一个 chunk 也不会丢失（原一次性 listener 实现会丢）。
 */
let mcpInputBuffer = Buffer.alloc(0);
let mcpInputWaiters = [];
let mcpInputEnded = false;
/** 客户端使用的 stdio framing：'content-length'（标准 MCP/LSP）或 'newline'（裸 JSON 行，Reasonix 用这种） */
let clientFraming = 'content-length';

process.stdin.on('data', chunk => {
  diagAppend(DIAG_IN, chunk);
  mcpInputBuffer = Buffer.concat([mcpInputBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  const waiter = mcpInputWaiters.shift();
  if (waiter) waiter();
});
process.stdin.on('end', () => {
  mcpInputEnded = true;
  const waiter = mcpInputWaiters.shift();
  if (waiter) waiter();
});
process.stdin.on('error', () => {
  mcpInputEnded = true;
  const waiter = mcpInputWaiters.shift();
  if (waiter) waiter();
});

/**
 * 从 stdin 读取一个完整的 JSON-RPC 消息。
 *
 * 同时支持两种 stdio framing（增量解析，兼容单 chunk 多消息）：
 *   1. Content-Length 帧（标准 MCP）：
 *        Content-Length: N\r\n\r\n{body 恰好 N 字节}
 *   2. newline-delimited JSON（Reasonix 等客户端）：
 *        {jsonrpc...}\n
 *
 * 识别到哪种格式就记录到 clientFraming，响应用相同格式回写。
 */
async function readMcpMessage() {
  while (true) {
    if (mcpInputBuffer.length === 0) {
      if (mcpInputEnded) throw new Error('stdin closed');
      await new Promise(resolve => mcpInputWaiters.push(resolve));
      continue;
    }
    // 跳过消息之间的前导空白/空行，避免缓冲里有垃圾字节时一直等待。
    let skip = 0;
    while (skip < mcpInputBuffer.length) {
      const byte = mcpInputBuffer[skip];
      if (byte !== 0x0A && byte !== 0x0D && byte !== 0x20 && byte !== 0x09) break;
      skip++;
    }
    if (skip > 0) {
      mcpInputBuffer = mcpInputBuffer.subarray(skip);
      continue;
    }
    const firstByte = mcpInputBuffer[0];
    if (firstByte === 0x7B /* '{'：newline-delimited JSON（Reasonix 风格） */) {
      const nlIdx = mcpInputBuffer.indexOf('\n');
      if (nlIdx !== -1) {
        const line = mcpInputBuffer.subarray(0, nlIdx).toString('utf-8').trim();
        mcpInputBuffer = mcpInputBuffer.subarray(nlIdx + 1);
        if (line) {
          try {
            clientFraming = 'newline';
            return JSON.parse(line);
          } catch (e) {
            // 非法 JSON 行：跳过，继续解析
          }
        }
        continue;
      }
      // 无换行：数据不完整或已结束，走末尾统一处理
    } else {
      // Content-Length 帧（标准 MCP/LSP）
      const headerEnd = mcpInputBuffer.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const header = mcpInputBuffer.subarray(0, headerEnd).toString('utf-8');
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // 丢弃无效头部，避免阻塞后续消息
          mcpInputBuffer = mcpInputBuffer.subarray(headerEnd + 4);
          throw new Error('MCP 消息缺少 Content-Length 头');
        }
        const contentLength = parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        if (mcpInputBuffer.length >= bodyStart + contentLength) {
          const body = mcpInputBuffer.subarray(bodyStart, bodyStart + contentLength).toString('utf-8');
          mcpInputBuffer = mcpInputBuffer.subarray(bodyStart + contentLength);
          clientFraming = 'content-length';
          try {
            return JSON.parse(body);
          } catch (e) {
            throw new Error(`JSON 解析失败: ${e.message}`);
          }
        }
      }
    }
    // 已缓冲数据不足一整条消息：等待更多输入
    if (mcpInputEnded) {
      // stdin 已关闭但 buffer 还有残留：尝试把残留当作最后一条 newline JSON
      const rest = mcpInputBuffer.toString('utf-8').trim();
      if (rest) {
        mcpInputBuffer = Buffer.alloc(0);
        try {
          clientFraming = 'newline';
          return JSON.parse(rest);
        } catch { /* 忽略残留 */ }
      }
      throw new Error('stdin closed');
    }
    await new Promise(resolve => mcpInputWaiters.push(resolve));
  }
}

/** 向 stdout 写入一个 JSON-RPC 消息（自动匹配客户端的 framing） */
function writeMcpMessage(msg) {
  const body = JSON.stringify(msg);
  let payload;
  if (clientFraming === 'newline') {
    payload = body + '\n';
  } else {
    const byteLen = Buffer.byteLength(body, 'utf-8');
    payload = `Content-Length: ${byteLen}\r\n\r\n${body}`;
  }
  try { diagAppend(DIAG_OUT, payload); } catch {}
  process.stdout.write(payload);
}

/** 统一的后端工具响应提取 */
function extractTools(backendResult) {
  if (!backendResult) return [];
  if (Array.isArray(backendResult.tools)) return backendResult.tools;
  if (backendResult.result && Array.isArray(backendResult.result.tools)) return backendResult.result.tools;
  if (Array.isArray(backendResult)) return backendResult;
  return [];
}

let toolsCache = null;
let toolsCacheExpiresAt = 0;

async function listTools() {
  if (USE_STATELESS_PROTOCOL && toolsCache && toolsCacheExpiresAt > Date.now()) {
    return toolsCache;
  }

  const result = await callWithRetry('tools/list');
  const payload = result && typeof result === 'object' && !Array.isArray(result)
    ? { ...result, tools: extractTools(result) }
    : { tools: extractTools(result) };
  const ttlMs = Number(payload.ttlMs);
  if (USE_STATELESS_PROTOCOL && Number.isFinite(ttlMs) && ttlMs > 0) {
    toolsCache = payload;
    toolsCacheExpiresAt = Date.now() + ttlMs;
  }
  return payload;
}

function writeBackendResult(id, result) {
  writeMcpMessage({ jsonrpc: '2.0', id, result });
}

function writeBackendError(id, err) {
  writeMcpMessage({
    jsonrpc: '2.0',
    id,
    error: err.jsonRpcError || { code: -32603, message: err.message },
  });
}

async function forwardRequest(id, method, params, options = {}) {
  try {
    const result = await callWithRetry(method, params, options);
    writeBackendResult(id, result);
  } catch (err) {
    writeBackendError(id, err);
  }
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
            ...(USE_STATELESS_PROTOCOL ? {} : {
              roots: { listChanged: false },
              sampling: {},
            }),
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
      try {
        writeBackendResult(id, await listTools());
      } catch (err) {
        console.error(`[mcp-server] tools/list 代理失败: ${err.message}`);
        writeMcpMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: `Backend tools/list failed: ${err.message}` },
        });
      }
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
        const callParams = USE_STATELESS_PROTOCOL
          ? { ...params, name, arguments: args || {} }
          : {
              name,
              arguments: args || {},
              ...(params && params._meta ? { _meta: params._meta } : {}),
            };
        const result = await callWithRetry('tools/call', callParams, {
          onNotification: (notification) => writeMcpMessage(notification),
        });

        // 新协议的 input_required/task/resultType 字段必须完整透传。
        const response = result && typeof result === 'object' && !Array.isArray(result)
          && (Array.isArray(result.content) || result.resultType || result.task)
          ? result
          : { content: [{
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            }] };
        writeBackendResult(id, response);
      } catch (err) {
        writeBackendError(id, err);
      }
      return;
    }

    case 'ping':
      // ping 只是存活探测，bridge 自身就在响应。后端 /mcp-new 未实现该方法（会返回 404），
      // 转发过去只会让客户端把 ping 失败误判成服务故障，因此本地直接返回空结果。
      writeMcpMessage({
        jsonrpc: '2.0',
        id,
        result: {},
      });
      return;

    case 'server/discover':
    case 'resources/list':
    case 'resources/read':
    case 'prompts/list':
    case 'prompts/get':
    case 'tasks/get':
    case 'tasks/update':
    case 'tasks/result':
      if (USE_STATELESS_PROTOCOL) {
        await forwardRequest(id, method, params);
        return;
      }
      if (method === 'resources/list') {
        writeMcpMessage({ jsonrpc: '2.0', id, result: { resources: [] } });
      } else if (method === 'prompts/list') {
        writeMcpMessage({ jsonrpc: '2.0', id, result: { prompts: [] } });
      } else {
        writeMcpMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
      return;

    default:
      // Forward extensions and future MCP methods without another bridge release.
      await forwardRequest(id, method, params);
  }
}

async function startMcpServer() {
  // 先开始监听 stdin，确保 Reasonix 的 initialize 请求不会丢失
  console.error('[mcp-server] 正在监听 stdin（MCP stdio 协议）...');
  resetDiagLogs();

  // 在后台异步初始化后端连接，不阻塞 stdin 处理
  let backendReady = false;
  let backendTools = [];

  async function initBackendAsync() {
    try {
      console.error('[mcp-server] 正在连接后端 MCP 服务...');
      const initResult = await initializeBackend();
      console.error('[mcp-server] 后端 MCP 连接成功');

      try {
        const toolsResult = await listTools();
        backendTools = extractTools(toolsResult);
        console.error(`[mcp-server] 已加载 ${backendTools.length} 个工具`);
      } catch (err) {
        console.error(`[mcp-server] 获取工具列表失败: ${err.message}`);
      }
      backendReady = true;
    } catch (err) {
      console.error(`[mcp-server] 后端连接失败: ${err.message}`);
      console.error('[mcp-server] 仍将继续监听，但后端工具可能不可用');
    }
  }

  // 异步启动后端初始化
  initBackendAsync().catch(err => {
    console.error(`[mcp-server] 后端初始化异常: ${err.message}`);
  });

  // 主循环：立即开始处理 stdin 请求
  while (true) {
    let message;
    try {
      message = await readMcpMessage();
    } catch (err) {
      if (err.message === 'stdin closed') {
        console.error('[mcp-server] stdin 关闭，优雅退出');
        if (!USE_STATELESS_PROTOCOL) {
          try { await sendRequest('close'); } catch {}
        }
        if (!USE_STATELESS_PROTOCOL) clearSession();
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

// ── 自检 / 工具浏览（doctor、tools）────────────────────────────────────────

const STATUS_URL = (() => {
  try { return new URL('/status?probe=1', new URL(MCP_URL).origin).toString(); }
  catch { return null; }
})();

/**
 * 读取后端 /status。注意：该端点同样校验 Origin，
 * 所以必须带上 MCP_SERVER_ORIGIN，否则会得到 403 而不是真实状态。
 */
async function fetchStatus(timeoutMs = STATUS_TIMEOUT_MS) {
  if (!STATUS_URL) throw new Error(`MCP_SERVER_URL 不是合法 URL: ${MCP_URL}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json', Origin: MCP_ORIGIN };
  if (CHROME_MCP_API_KEY) headers.Authorization = `Bearer ${CHROME_MCP_API_KEY}`;
  try {
    const response = await fetch(STATUS_URL, { headers, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 响应，保留原文 */ }
    return { ok: response.ok, status: response.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** 把 fetch 抛出的原始错误翻译成用户能直接行动的说明。 */
function describeFetchError(err) {
  if (!err) return '未知错误';
  if (err.name === 'AbortError') return `探测超时 (${STATUS_TIMEOUT_MS}ms)`;
  const cause = err.cause || {};
  const code = err.code || cause.code;
  if (code === 'ECONNREFUSED') return '连接被拒绝（本地服务未运行）';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '地址无法解析（检查 MCP_SERVER_URL）';
  if (code === 'ECONNRESET') return '连接被重置';
  if (Array.isArray(cause.errors) && cause.errors.length) {
    return cause.errors.map(item => item.code || item.message).join(' / ');
  }
  return cause.message || err.message || String(err);
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  try { return JSON.parse(raw); }
  catch (err) { throw new Error(`文件不是有效 JSON (${filePath}): ${err.message}`); }
}

/** 在 cwd 与本仓库根目录查找 .mcp.json，并判断它是否指向本脚本。 */
function inspectClientConfig() {
  const candidates = [path.join(process.cwd(), '.mcp.json'), path.join(__dirname, '.mcp.json')];
  const seen = new Set();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!fs.existsSync(resolved)) continue;
    let json;
    try { json = JSON.parse(fs.readFileSync(resolved, 'utf-8')); }
    catch (err) { return { path: resolved, ok: false, detail: `JSON 解析失败: ${err.message}` }; }
    const servers = json && typeof json.mcpServers === 'object' && json.mcpServers ? json.mcpServers : {};
    for (const [key, server] of Object.entries(servers)) {
      const args = Array.isArray(server?.args) ? server.args : [];
      const pointsHere = args.some(arg => {
        try { return path.resolve(String(arg)) === path.resolve(__filename); } catch { return false; }
      });
      if (pointsHere) return { path: resolved, ok: true, detail: `mcpServers.${key} → 本仓库 bridge` };
    }
    return {
      path: resolved,
      ok: false,
      detail: `未找到指向本仓库 bridge 的 mcpServers 条目（当前：${Object.keys(servers).join(', ') || '空'}）`,
    };
  }
  return null;
}

function firstLine(text, max = 72) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

async function runTools(argv) {
  const jsonMode = argv.includes('--json');
  const name = argv.find(arg => !arg.startsWith('-'));
  const payload = await listTools();
  const tools = extractTools(payload);

  if (name) {
    const tool = tools.find(item => item.name === name);
    if (!tool) {
      console.error(`错误: 未找到工具 "${name}"。运行 "node mcp-bridge.js tools" 查看全部工具名。`);
      process.exit(1);
    }
    console.log(JSON.stringify(tool, null, 2));
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`已发现 ${tools.length} 个工具 — ${MCP_URL}`);
  console.log('');
  const width = tools.reduce((max, tool) => Math.max(max, tool.name.length), 0);
  for (const tool of tools) {
    console.log(`${tool.name.padEnd(width)}  ${firstLine(tool.description)}`);
  }
  console.log('');
  console.log(`查看单个工具的完整 schema: node ${path.basename(__filename)} tools <name>`);
}

async function runDoctor(argv) {
  const jsonMode = argv.includes('--json');
  const checks = [];
  const add = (name, ok, detail, hint) => checks.push({ name, ok, detail, hint: hint || null });

  // 1. Node 运行时
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('Node.js 运行时', nodeMajor >= 18, `v${process.versions.node}`, '请安装 Node.js 18 或更高版本');

  // 2. bridge 脚本
  add('bridge 脚本', fs.existsSync(__filename), __filename, '仓库文件缺失，请重新拉取本项目');

  // 3. AI 客户端配置
  const config = inspectClientConfig();
  if (config) {
    add('AI 客户端配置', config.ok, `${config.path} — ${config.detail}`,
      `运行 "node install.js"（或 .\\install.ps1）生成配置，然后完全重启 AI 客户端`);
  } else {
    add('AI 客户端配置', false, '未找到 .mcp.json',
      '运行 "node install.js"（或 .\\install.ps1）生成配置');
  }

  // 4~6. 后端服务与浏览器链路
  let statusResponse = null;
  try {
    statusResponse = await fetchStatus();
  } catch (err) {
    const reason = describeFetchError(err);
    const refused = /连接被拒绝|ECONNREFUSED/i.test(reason);
    add('后端服务', false, `${MCP_URL} — ${reason}`,
      refused
        ? 'Chrome MCP 服务未运行：请启动本地服务，或确认 CHROME_MCP_AUTOSTART_SERVER 没有被设为 0'
        : '请检查 MCP_SERVER_URL 是否指向正确的地址与端口');
  }

  if (statusResponse) {
    const { ok, status, json, text } = statusResponse;
    if (!ok) {
      const detail = (json && (json.error || json.message)) || firstLine(text, 120) || '无响应体';
      add('后端服务', false, `${STATUS_URL} — HTTP ${status}: ${detail}`,
        status === 401 || status === 403
          ? '鉴权或 Origin 被拒绝：检查 CHROME_MCP_API_KEY 与 MCP_SERVER_ORIGIN 是否在服务端白名单中'
          : '端点不存在或路径有误：确认 MCP_SERVER_URL 指向 /mcp-new');
    } else {
      const server = json?.server || {};
      add('后端服务', true,
        `${STATUS_URL} — HTTP 200（服务 v${server.version || '未知'}${server.running === false ? '，未运行' : ''}）`);
      const connectionState = json?.connectionState;
      const extension = json?.extension || {};
      const nativeHost = json?.nativeHost || {};
      const probe = json?.probe || {};
      const chainOk = connectionState === 'ready' && extension.connected === true
        && nativeHost.connected === true && probe.ok === true;
      add('浏览器链路', chainOk,
        `connectionState=${connectionState ?? '未知'} · extension=${extension.state ?? (extension.connected ? 'ready' : '未连接')}`
        + ` · nativeHost=${nativeHost.state ?? (nativeHost.connected ? 'ready' : '未连接')}`
        + ` · probe=${probe.ok === true ? `ok(${probe.elapsedMs ?? '?'}ms)` : '失败'}`,
        '链路未就绪：确认 Chrome 已打开、扩展已启用、Native Host 已注册');
      const toolCount = json?.tools?.count ?? 0;
      add('工具清单', toolCount > 0, `${toolCount} 个工具`,
        '工具数为 0：检查扩展连接与工具白名单（CHROME_MCP_ALLOWED_TOOLS）');
    }
  }

  const ok = checks.every(check => check.ok);

  if (jsonMode) {
    console.log(JSON.stringify({
      ok,
      version: SERVER_VERSION,
      endpoint: MCP_URL,
      origin: MCP_ORIGIN,
      protocolMode: USE_STATELESS_PROTOCOL ? 'stateless' : 'legacy',
      protocolVersion: MCP_PROTOCOL_VERSION,
      checks,
    }, null, 2));
    process.exit(ok ? 0 : 1);
  }

  console.log(`mcp-bridge.js doctor (v${SERVER_VERSION})`);
  console.log(`端点: ${MCP_URL}`);
  console.log(`Origin: ${MCP_ORIGIN}${CHROME_MCP_API_KEY ? ' · API Key 已配置' : ''}`);
  console.log('');
  for (const check of checks) {
    console.log(`${check.ok ? '✅' : '❌'} ${check.name}  ${check.detail}`);
  }
  const hints = checks.filter(check => !check.ok && check.hint);
  if (hints.length) {
    console.log('');
    console.log('下一步:');
    for (const check of hints) console.log(`  · ${check.name}: ${check.hint}`);
  }
  console.log('');
  console.log(ok ? '结论: ✅ 一切就绪，可以开始浏览器任务。' : '结论: ❌ 存在问题，请按上面的「下一步」处理后重试。');
  process.exit(ok ? 0 : 1);
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

function helpText() {
  const psHint = isPowerShell()
    ? '\n🔵 检测到 PowerShell 环境：参数含 & ? 等字符时请用 --stdin，避免被 shell 解释。\n'
    : '';
  return `
mcp-bridge.js — Streamable HTTP MCP 桥接工具 (v${SERVER_VERSION})

支持协议版本: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}

用法: node mcp-bridge.js <命令> [参数]

命令:
  doctor [--json]                     自检：Node / 客户端配置 / 后端链路 / 工具清单
  tools [name] [--json]               列出工具用途；给出 name 时显示该工具完整 schema
  --server | --stdio                  以 stdio MCP Server 模式运行（供 AI 客户端调用）
  init                                初始化连接（/mcp-new 走 server/discover）
  call <method> [params|--stdin]       调用 MCP 方法
  call <method> --args-file <路径>     从文件读取 params JSON
  ping                                心跳保活
  close                               关闭连接（清理旧 /mcp Session）
  path                                显示脚本绝对路径
  --help, -h                          显示本帮助
  --version, -v                       显示版本号

环境变量:
  MCP_SERVER_URL        后端 MCP 服务地址（默认 ${MCP_URL}）
  MCP_SERVER_ORIGIN     后端 Origin（默认 ${MCP_ORIGIN}）
  MCP_PROTOCOL_MODE     auto、stateless 或 legacy（默认 auto）
  MCP_PROTOCOL_VERSION  请求协议版本（默认 ${MCP_PROTOCOL_VERSION}）
  CHROME_MCP_API_KEY    可选后端 API Key（Bearer 转发）
  MCP_BRIDGE_DIAG       设为 1 记录 stdio 收发诊断日志
  DEBUG                 设为 1 开启调试日志

示例:
  # 第一步：自检整条链路
  node mcp-bridge.js doctor

  # 查看全部工具用途（比 dump 完整 schema 清爽）
  node mcp-bridge.js tools

  # 调用工具：--stdin 可避免 shell 转义问题
  echo '{"name":"chrome_navigate","arguments":{"url":"https://example.com"}}' | node mcp-bridge.js call tools/call --stdin

  # PowerShell heredoc
  $body = @'
  {"name":"chrome_navigate","arguments":{"url":"https://example.com?lang=en"}}
  '@
  $body | node mcp-bridge.js call tools/call --stdin

MCP 客户端配置示例（.mcp.json / claude_desktop_config.json）:
  {
    "mcpServers": {
      "chrome-bridge": {
        "command": "node",
        "args": ["${getScriptPath().replace(/\\/g, '\\\\')}", "--server"]
      }
    }
  }
  更省事：直接运行 node install.js（或 .\\install.ps1）自动生成配置。
${psHint}`;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  // 无参数 / --help / --version
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(helpText());
    process.exit(0);
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(SERVER_VERSION);
    process.exit(0);
  }

  // ── stdio MCP Server 模式（--server，兼容 --stdio 别名）──────────────
  if (command === '--server' || command === '--stdio' || command === 'stdio') {
    await startMcpServer();
    return;
  }

  // ── 自检 / 工具浏览（自带输出与退出码）───────────────────────────────
  if (command === 'doctor' || command === 'status') {
    await runDoctor(rest);
    return;
  }
  if (command === 'tools' || command === 'list') {
    await runTools(rest);
    return;
  }

  // ── 常规 CLI 模式 ──────────────────────────────────────────────────
  try {
    let result;
    switch (command) {
      case 'init':
        result = await initializeBackend();
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
        const method = rest[0];
        if (!method || method.startsWith('-')) { console.error('错误: 请指定方法名'); process.exit(1); }
        let params = {};
        const stdinFlag = rest.includes('--stdin');
        const argsFileFlag = rest.indexOf('--args-file');
        if (stdinFlag) {
          params = await readStdin();
        } else if (argsFileFlag !== -1) {
          const filePath = rest[argsFileFlag + 1];
          if (!filePath) { console.error('错误: --args-file 需要文件路径'); process.exit(1); }
          try { params = readJsonFile(filePath); }
          catch (err) { console.error(`错误: ${err.message}`); process.exit(1); }
        } else if (rest[1]) {
          const raw = rest[1];
          try { params = JSON.parse(raw); }
          catch {
            console.error('错误: params 不是有效 JSON');
            console.error('收到:', raw.substring(0, 200));
            if (isPowerShell()) {
              console.error('\n💡 检测到 PowerShell 环境！请改用 heredoc + --stdin 模式：');
              console.error('');
              console.error('   $body = @\'');
              console.error(`   ${raw.replace(/&/g, '`&').substring(0, 200)}`);
              console.error("   '@");
              console.error(`   $body | node mcp-bridge.js call ${method.replace(/'/g, "''")} --stdin`);
              console.error('');
            } else {
              console.error('\n💡 提示: 参数含 & 等特殊字符时，请用 --stdin 模式:');
              console.error(`  echo '${raw.substring(0, 100)}' | node mcp-bridge.js call ${method} --stdin`);
            }
            console.error('  也可以把 JSON 写进文件后用 --args-file <路径>。');
            process.exit(1);
          }
        }
        result = await callWithRetry(method, params, {
          onNotification: (notification) => {
            console.error(`[MCP notification] ${JSON.stringify(notification)}`);
          },
        });
        break;
      }

      case 'ping':
        if (USE_STATELESS_PROTOCOL) {
          // /mcp-new 没有 ping 方法，这里用真实的存活探测代替，避免"心跳"命令必定报 404。
          let probe;
          try {
            probe = await fetchStatus();
          } catch (err) {
            console.error(`[桥接] 服务不可用: ${MCP_URL} — ${describeFetchError(err)}`);
            console.error('💡 运行 "node mcp-bridge.js doctor" 查看完整诊断。');
            process.exit(1);
          }
          if (!probe.ok) {
            const detail = (probe.json && (probe.json.error || probe.json.message))
              || firstLine(probe.text, 120) || '无响应体';
            console.error(`[桥接] 服务不可用: ${STATUS_URL} — HTTP ${probe.status}: ${detail}`);
            process.exit(1);
          }
          result = {
            alive: true,
            endpoint: MCP_URL,
            serverVersion: probe.json?.server?.version ?? null,
            connectionState: probe.json?.connectionState ?? null,
            toolCount: probe.json?.tools?.count ?? null,
          };
        } else {
          result = await callWithRetry('ping');
        }
        break;

      case 'close':
        if (!USE_STATELESS_PROTOCOL) {
          try { await sendRequest('close'); } catch {}
          clearSession();
        }
        console.log(USE_STATELESS_PROTOCOL ? '无状态连接已关闭' : '连接已关闭，session 已清理');
        process.exit(0);
        break;

      default:
        console.error(`错误: 未知命令 "${command}"`);
        console.error('运行 "node mcp-bridge.js --help" 查看可用命令。');
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`[桥接] 错误: ${err.message}`);
    if (err.jsonRpcError) console.error(`[桥接] JSON-RPC 错误码: ${err.jsonRpcError.code}`);
    console.error('💡 运行 "node mcp-bridge.js doctor" 检查配置与后端链路。');
    process.exit(1);
  }
}

main();
