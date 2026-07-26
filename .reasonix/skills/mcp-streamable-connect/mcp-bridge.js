#!/usr/bin/env node
/**
 * mcp-bridge.js — Streamable HTTP MCP 桥接脚本 (修复版)
 *
 * 🔧 修复内容：
 *   1. 新增 --stdin 模式：从 stdin 读取 JSON params，避免 PowerShell 中 & 被截断
 *   2. JSON-RPC 错误检测：服务器返回 {error:{...}} 时正确抛出异常
 *   3. Session 自动恢复：检测到 session 错误后自动清理并重新 init
 *   4. callWithRetry 在 session 重试耗尽时触发自动重新初始化
 */

'use strict';

const MCP_URL = 'http://127.0.0.1:12306/mcp';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const STDIN_TIMEOUT_MS = 3000;
const SESSION_FILE = require('path').join(
  require('os').tmpdir(),
  'mcp-bridge-session.json'
);

const fs = require('fs');

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

// ── JSON-RPC 错误检测（修复 #2） ────────────────────────────────────────
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
        if (isJsonRpcError(evt.data)) {  // 🔧 修复 #2：检测 SSE 中的错误
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
    if (isJsonRpcError(json)) {  // 🔧 修复 #2：检测 JSON 响应中的错误
      const err = new Error(json.error.message || '未知错误');
      err.jsonRpcError = json.error;
      err.isSessionError = isSessionError(json);
      throw err;
    }
    return json;
  }
}

// ── 带重试的调用（修复 #3：session 自动恢复）───────────────────────────
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
        // 🔧 修复 #3：重试耗尽后自动重新 init
        console.error('[桥接] Session 重试耗尽，尝试重新初始化...');
        try {
          await sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: { roots: { listChanged: false }, sampling: {} },
            clientInfo: { name: 'mcp-bridge', version: '1.0.0' },
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

// ── 从 stdin 读取 JSON（修复 #1：解决 & 截断问题）──────────────────────
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

// ── CLI 入口 ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command) {
    console.log(`
mcp-bridge.js — Streamable HTTP MCP 桥接工具

用法:
  node mcp-bridge.js init                             初始化连接
  node mcp-bridge.js call <method> [params|--stdin]   调用方法
  node mcp-bridge.js ping                             心跳保活
  node mcp-bridge.js close                            关闭连接

  # --stdin 模式（避免 shell 转义问题，推荐！）
  echo '{"name":"x","arguments":{}}' | node mcp-bridge.js call tools/call --stdin
  node mcp-bridge.js call tools/call --stdin < params.json
`);
    process.exit(0);
  }

  try {
    let result;
    switch (command) {
      case 'init':
        result = await callWithRetry('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { roots: { listChanged: false }, sampling: {} },
          clientInfo: { name: 'mcp-bridge', version: '1.0.0' },
        });
        break;

      case 'call': {
        const method = args[1];
        if (!method) { console.error('错误: 请指定方法名'); process.exit(1); }
        let params = {};
        if (args[2]) {
          if (args[2] === '--stdin') {
            params = await readStdin();  // 🔧 修复 #1
          } else {
            try { params = JSON.parse(args[2]); }
            catch {
              console.error('错误: params 不是有效 JSON');
              console.error('收到:', args[2].substring(0, 200));
              console.error('\n💡 提示: 参数含 & 等特殊字符时，请用 --stdin 模式:');
              console.error(`  echo '${args[2].substring(0, 100)}' | node mcp-bridge.js call ${method} --stdin`);
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
