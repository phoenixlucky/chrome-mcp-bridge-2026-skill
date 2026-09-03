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
