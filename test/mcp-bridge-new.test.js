const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = path.join(ROOT, 'mcp-bridge.js');

function runBridge(url, method, params) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BRIDGE, 'call', method, '--stdin'], {
      cwd: ROOT,
      env: {
        ...process.env,
        MCP_SERVER_URL: url,
        MCP_PROTOCOL_MODE: 'auto',
        MCP_SERVER_ORIGIN: 'http://test-origin',
        CHROME_MCP_API_KEY: 'test-api-key',
        DEBUG: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`bridge exited ${code}: ${stderr}`));
      try { resolve(JSON.parse(stdout)); }
      catch (err) { reject(new Error(`invalid bridge JSON: ${err.message}\n${stdout}`)); }
    });
    child.stdin.end(JSON.stringify(params));
  });
}

test('stateless /mcp-new requests use headers, metadata, and preserve MRTR fields', async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ headers: req.headers, body });
      const result = body.method === 'tools/list'
        ? { resultType: 'complete', tools: [{ name: 'echo', inputSchema: { type: 'object' } }], ttlMs: 1000, cacheScope: 'public' }
        : { resultType: 'input_required', inputRequests: { confirm: { message: 'confirm?' } }, requestState: 'sealed' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    });
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/mcp-new`;

  const list = await runBridge(url, 'tools/list', {});
  assert.equal(list.resultType, 'complete');
  assert.equal(list.tools[0].name, 'echo');

  const call = await runBridge(url, 'tools/call', {
    name: 'echo',
    arguments: { value: 'ok' },
    _meta: { progressToken: 'progress-1' },
    inputResponses: { confirm: { action: 'accept' } },
    requestState: 'previous-state',
  });
  assert.equal(call.resultType, 'input_required');
  assert.equal(call.requestState, 'sealed');

  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.method, 'tools/list');
  assert.equal(requests[0].headers['mcp-protocol-version'], '2026-07-28');
  assert.equal(requests[0].headers['mcp-method'], 'tools/list');
  assert.equal(requests[0].headers['mcp-name'], undefined);
  assert.equal(requests[0].headers['mcp-session-id'], undefined);
  assert.equal(requests[0].headers.origin, 'http://test-origin');
  assert.equal(requests[0].headers.authorization, 'Bearer test-api-key');
  assert.equal(requests[0].body.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
  assert.deepEqual(requests[0].body.params._meta['io.modelcontextprotocol/clientCapabilities'], {});
  assert.equal(requests[1].headers['mcp-method'], 'tools/call');
  assert.equal(requests[1].headers['mcp-name'], 'echo');
  assert.equal(requests[1].body.params._meta.progressToken, 'progress-1');
  assert.deepEqual(requests[1].body.params.inputResponses, { confirm: { action: 'accept' } });
  assert.equal(requests[1].body.params.requestState, 'previous-state');
});

test('stdio server mode uses discover instead of backend initialize', async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ headers: req.headers, body });
      const result = body.method === 'tools/list'
        ? { resultType: 'complete', tools: [], ttlMs: 1000, cacheScope: 'private' }
        : { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    });
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const child = spawn(process.execPath, [BRIDGE, '--server'], {
    cwd: ROOT,
    env: {
      ...process.env,
      MCP_SERVER_URL: `http://127.0.0.1:${port}/mcp-new`,
      MCP_PROTOCOL_MODE: 'stateless',
      MCP_SERVER_ORIGIN: 'http://test-origin',
      CHROME_MCP_API_KEY: 'test-api-key',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  const responses = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (const line of buffer.split('\n').slice(0, -1)) {
      if (line.trim()) responses.push(JSON.parse(line));
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28' } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stdio server response timeout')), 5000);
    const check = () => responses.length >= 2 ? (clearTimeout(timer), resolve()) : setTimeout(check, 20);
    check();
  });
  assert.equal(responses[0].result.protocolVersion, '2026-07-28');
  assert.deepEqual(responses[1].result.tools, []);
  assert.ok(requests.some(request => request.body.method === 'server/discover'));
  assert.ok(requests.every(request => request.body.method !== 'initialize'));
});
