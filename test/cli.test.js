const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = path.join(ROOT, 'mcp-bridge.js');
const INSTALLER = path.join(ROOT, 'install.js');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** 运行 CLI，返回 { code, stdout, stderr }（不因非零退出码 reject）。 */
function runCli(args, { cwd = ROOT, env = {}, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BRIDGE, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

const STATUS_OK = {
  server: { version: '2.7.6', running: true },
  connectionState: 'ready',
  extension: { connected: true, state: 'ready' },
  nativeHost: { connected: true, state: 'ready' },
  probe: { ok: true, elapsedMs: 3 },
  tools: { count: 2 },
};

/** 起一个假后端：GET /status 返回状态，POST /mcp-new 返回 JSON-RPC 结果。 */
async function startMockBackend({ status = STATUS_OK, postStatus = 200, postResult } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      if (postStatus !== 200) {
        res.writeHead(postStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Method not found' },
        }));
        return;
      }
      const result = postResult
        ? postResult(body)
        : body.method === 'tools/list'
          ? {
              resultType: 'complete',
              tools: [
                { name: 'chrome_navigate', description: '打开 URL 或刷新标签页', inputSchema: { type: 'object' } },
                { name: 'chrome_get_page_text', description: '读取页面正文', inputSchema: { type: 'object' } },
              ],
            }
          : { resultType: 'complete' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/mcp-new` };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cli-'));
}

test('--version prints the package version and exits 0', async () => {
  const result = await runCli(['--version']);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), PACKAGE.version);
  const short = await runCli(['-v']);
  assert.equal(short.stdout.trim(), PACKAGE.version);
});

test('--help documents the new commands and exits 0', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.code, 0);
  for (const needle of ['doctor', 'tools', '--stdio', '--args-file', 'MCP_BRIDGE_DIAG']) {
    assert.ok(result.stdout.includes(needle), `help should mention ${needle}`);
  }
  const bare = await runCli([]);
  assert.equal(bare.code, 0);
  assert.ok(bare.stdout.includes('doctor'));
});

test('unknown commands fail with an actionable hint', async () => {
  const result = await runCli(['definitely-not-a-command']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /未知命令/);
  assert.match(result.stderr, /--help/);
});

test('tools lists names and one-line purposes instead of full schemas', async t => {
  const backend = await startMockBackend();
  t.after(() => backend.server.close());

  const result = await runCli(['tools'], { env: { MCP_SERVER_URL: backend.url } });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /已发现 2 个工具/);
  assert.match(result.stdout, /chrome_navigate\s+打开 URL 或刷新标签页/);
  assert.match(result.stdout, /chrome_get_page_text\s+读取页面正文/);
  // 完整 schema 不应出现在概览输出里
  assert.ok(!result.stdout.includes('inputSchema'));

  const single = await runCli(['tools', 'chrome_navigate'], { env: { MCP_SERVER_URL: backend.url } });
  assert.equal(single.code, 0);
  assert.equal(JSON.parse(single.stdout).name, 'chrome_navigate');

  const missing = await runCli(['tools', 'nope'], { env: { MCP_SERVER_URL: backend.url } });
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /未找到工具/);
});

test('doctor reports a healthy chain and exits 0', async t => {
  const backend = await startMockBackend();
  t.after(() => backend.server.close());

  // 在一个临时"项目"里放好指向本仓库 bridge 的配置
  const projectDir = tempDir();
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectDir, '.mcp.json'), JSON.stringify({
    mcpServers: { chrome: { command: 'node', args: [BRIDGE, '--server'] } },
  }), 'utf8');

  const result = await runCli(['doctor'], { cwd: projectDir, env: { MCP_SERVER_URL: backend.url } });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /AI 客户端配置/);
  assert.match(result.stdout, /浏览器链路/);
  assert.match(result.stdout, /2 个工具/);
  assert.match(result.stdout, /一切就绪/);

  const json = await runCli(['doctor', '--json'], { cwd: projectDir, env: { MCP_SERVER_URL: backend.url } });
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.version, PACKAGE.version);
  assert.ok(payload.checks.every(check => check.ok));
});

test('doctor explains a refused backend connection and exits 1', async t => {
  const projectDir = tempDir();
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectDir, '.mcp.json'), JSON.stringify({
    mcpServers: { chrome: { command: 'node', args: [BRIDGE, '--server'] } },
  }), 'utf8');

  // 占一个端口再释放，确保拿到的是"确实没人监听"的端口
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const closedPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));

  const result = await runCli(['doctor'], {
    cwd: projectDir,
    env: { MCP_SERVER_URL: `http://127.0.0.1:${closedPort}/mcp-new` },
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /后端服务/);
  assert.match(result.stdout, /连接被拒绝/);
  assert.match(result.stdout, /下一步/);
});

test('doctor flags a config that points at a different bridge copy', async t => {
  const backend = await startMockBackend();
  t.after(() => backend.server.close());

  const projectDir = tempDir();
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectDir, '.mcp.json'), JSON.stringify({
    mcpServers: { chrome: { command: 'node', args: ['C:\\somewhere-else\\mcp-bridge.js', '--server'] } },
  }), 'utf8');

  const result = await runCli(['doctor'], { cwd: projectDir, env: { MCP_SERVER_URL: backend.url } });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /未找到指向本仓库 bridge/);
  assert.match(result.stdout, /install\.js/);
});

test('doctor reports the client config consistently whether or not one exists', async t => {
  const backend = await startMockBackend();
  t.after(() => backend.server.close());

  // cwd 里没有 .mcp.json，doctor 会回退到仓库根目录查找
  const projectDir = tempDir();
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  const result = await runCli(['doctor'], { cwd: projectDir, env: { MCP_SERVER_URL: backend.url } });
  const repoConfig = path.join(ROOT, '.mcp.json');
  if (fs.existsSync(repoConfig)) {
    assert.equal(result.code, 0);
    assert.match(result.stdout, /AI 客户端配置/);
    assert.ok(result.stdout.includes(repoConfig));
  } else {
    assert.equal(result.code, 1);
    assert.match(result.stdout, /未找到 \.mcp\.json/);
  }
});

test('ping answers locally instead of forwarding to a backend that lacks the method', async t => {
  const backend = await startMockBackend();
  t.after(() => backend.server.close());

  const child = spawn(process.execPath, [BRIDGE, '--server'], {
    cwd: ROOT,
    env: { ...process.env, MCP_SERVER_URL: backend.url, MCP_PROTOCOL_MODE: 'stateless' },
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
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n');

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ping did not respond')), 5000);
    const check = () => responses.length >= 2 ? (clearTimeout(timer), resolve()) : setTimeout(check, 20);
    check();
  });
  const ping = responses.find(message => message.id === 2);
  assert.deepEqual(ping.result, {});
  assert.equal(ping.error, undefined);
  assert.ok(!backend.requests.some(request => request.method === 'ping'),
    'ping must not be forwarded to the backend');
});

test('non-retryable 4xx responses are not retried three times', async t => {
  const backend = await startMockBackend({ postStatus: 404 });
  t.after(() => backend.server.close());

  const result = await runCli(['call', 'tools/list'], { env: { MCP_SERVER_URL: backend.url } });
  assert.equal(result.code, 1);
  assert.equal(backend.requests.length, 1, 'a 404 should fail fast instead of retrying');
  assert.match(result.stderr, /MCP HTTP 404/);
});

test('cli ping reports service liveness without a backend ping method', async t => {
  const backend = await startMockBackend();
  t.after(() => backend.server.close());

  const result = await runCli(['ping'], { env: { MCP_SERVER_URL: backend.url } });
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.alive, true);
  assert.equal(payload.connectionState, 'ready');
  assert.equal(payload.toolCount, 2);
  assert.ok(!backend.requests.some(request => request.method === 'ping'));
});

test('--stdio is accepted as an alias for --server', async t => {
  const backend = await startMockBackend();
  t.after(() => backend.server.close());

  const child = spawn(process.execPath, [BRIDGE, '--stdio'], {
    cwd: ROOT,
    env: { ...process.env, MCP_SERVER_URL: backend.url, MCP_PROTOCOL_MODE: 'stateless' },
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

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('--stdio alias did not respond')), 5000);
    const check = () => responses.length >= 1 ? (clearTimeout(timer), resolve()) : setTimeout(check, 20);
    check();
  });
  assert.equal(responses[0].result.serverInfo.name, 'mcp-bridge-server');
});

test('install.js writes a config pointing at this repo bridge', async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'nested', '.mcp.json');

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INSTALLER, '--out', out, '--no-probe'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(config.mcpServers.chrome.args, [BRIDGE, '--server']);
  assert.equal(config.mcpServers.chrome.env.MCP_SERVER_URL, 'http://127.0.0.1:12306/mcp-new');
  assert.equal(config.mcpServers.chrome.env.MCP_PROTOCOL_VERSION, '2026-07-28');
});

test('install.js preserves other servers and refuses to clobber invalid JSON', async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const mergePath = path.join(dir, 'merge.json');
  fs.writeFileSync(mergePath, JSON.stringify({
    mcpServers: { other: { command: 'echo', args: ['hi'] } },
    note: 'keep me',
  }), 'utf8');
  const merged = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INSTALLER, '--out', mergePath, '--no-probe', '--quiet'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', reject);
    child.on('close', code => resolve(code));
  });
  assert.equal(merged, 0);
  const after = JSON.parse(fs.readFileSync(mergePath, 'utf8'));
  assert.deepEqual(after.mcpServers.other, { command: 'echo', args: ['hi'] });
  assert.equal(after.note, 'keep me');
  assert.deepEqual(after.mcpServers.chrome.args, [BRIDGE, '--server']);

  const badPath = path.join(dir, 'bad.json');
  fs.writeFileSync(badPath, 'not json{', 'utf8');
  const bad = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INSTALLER, '--out', badPath, '--no-probe'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', reject);
    child.on('close', code => resolve(code));
  });
  assert.equal(bad, 1);
  assert.equal(fs.readFileSync(badPath, 'utf8'), 'not json{');
});

test('install.js --skip-config performs checks without writing', async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, '.mcp.json');

  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INSTALLER, '--out', out, '--skip-config', '--no-probe'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(code, 0);
  assert.equal(fs.existsSync(out), false);
});
