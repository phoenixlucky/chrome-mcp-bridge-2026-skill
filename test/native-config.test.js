const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('template uses the stateless bridge with protocol and Origin settings', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json.example'), 'utf8'));
  const server = config.mcpServers.chrome;

  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['__BRIDGE_PATH__', '--server']);
  assert.equal(server.env.MCP_SERVER_URL, 'http://127.0.0.1:12306/mcp-new');
  assert.equal(server.env.MCP_PROTOCOL_MODE, 'stateless');
  assert.equal(server.env.MCP_PROTOCOL_VERSION, '2026-07-28');
  assert.equal(server.env.MCP_SERVER_ORIGIN, 'http://127.0.0.1');
  assert.ok(Object.hasOwn(server.env, 'CHROME_MCP_API_KEY'));
});

test('installer resolves the bridge path without starting or registering services', () => {
  const installer = fs.readFileSync(path.join(ROOT, 'install.ps1'), 'utf8');
  assert.match(installer, /mcp-bridge\.js/);
  assert.match(installer, /不会启动或注册后端服务/);
  assert.doesNotMatch(installer, /npm install/);
  assert.match(installer, /\$SkipConfig/);
});

test('install.ps1 keeps a UTF-8 BOM so Windows PowerShell 5.1 reads Chinese correctly', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'install.ps1'));
  assert.deepEqual([...raw.subarray(0, 3)], [0xEF, 0xBB, 0xBF],
    'install.ps1 must start with a UTF-8 BOM, otherwise PowerShell 5.1 mangles the Chinese strings and the script fails to parse');
});

test('install.ps1 delegates to the cross-platform install.js', () => {
  const installer = fs.readFileSync(path.join(ROOT, 'install.ps1'), 'utf8');
  assert.match(installer, /install\.js/);
  assert.match(installer, /--skip-config/);
  assert.match(installer, /--no-probe/);
});

test('package.json wires up runnable scripts and the Node floor', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '>=18');
  // `node --test test` 在 Windows 上会报 MODULE_NOT_FOUND，必须用显式 glob/文件列表
  assert.match(pkg.scripts.test, /--test/);
  assert.doesNotMatch(pkg.scripts.test, /--test test(\s|$)/);
  for (const name of ['doctor', 'tools', 'install:config']) {
    assert.ok(pkg.scripts[name], `missing npm script: ${name}`);
  }
});
