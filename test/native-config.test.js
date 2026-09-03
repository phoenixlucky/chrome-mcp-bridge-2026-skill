const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('template uses native mcp-chrome-stdio with auth settings', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json.example'), 'utf8'));
  const server = config.mcpServers.chrome;

  assert.equal(server.command, 'mcp-chrome-stdio');
  assert.equal(server.args, undefined);
  assert.equal(server.env.MCP_SERVER_URL, 'http://127.0.0.1:12306/mcp-new');
  assert.equal(server.env.MCP_SERVER_ORIGIN, 'chrome-extension://mcp-stdio');
  assert.ok(Object.hasOwn(server.env, 'CHROME_MCP_API_KEY'));
});

test('installer no longer launches the removed bridge', () => {
  const installer = fs.readFileSync(path.join(ROOT, 'install.ps1'), 'utf8');
  assert.match(installer, /mcp-chrome-stdio/);
  assert.match(installer, /mcp-chrome-bridge start/);
  assert.match(installer, /全局安装 \$PackageName/);
  assert.doesNotMatch(installer, /npm install/);
  assert.match(installer, /\$SkipConfig/);
  assert.match(installer, /自动生成原生 mcp-chrome-stdio 配置/);
  assert.doesNotMatch(installer, /检查后端 MCP 服务/);
  assert.doesNotMatch(installer, /mcp-bridge\.js/);
  assert.doesNotMatch(installer, /Reasonix/);
});
