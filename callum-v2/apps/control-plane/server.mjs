import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openDatabase } from './db.mjs';
import { ControlPlane } from './service.mjs';

const db = openDatabase();
const control = new ControlPlane(db);
await control.seed();
const port = Number(process.env.V2_PORT || 8788);
const adminToken = process.env.V2_ADMIN_TOKEN;
if (!adminToken || adminToken.length < 32) throw new Error('V2_ADMIN_TOKEN must be at least 32 characters');
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const webOrigin = process.env.V2_WEB_ORIGIN || `http://localhost:${port}`;

function authorized(actual, expected) {
  if (!actual || typeof actual !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
  res.end(JSON.stringify(body));
}
async function body(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 32768) throw new Error('BODY_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function bearer(req) { return /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1] || ''; }
async function staticFile(pathname, res) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^[a-z0-9/_-]+\.(html|css|js)$/i.test(name) || name.includes('..')) return json(res, 404, { error: 'NOT_FOUND' });
  const file = resolve(webRoot, name);
  if (!file.startsWith(resolve(webRoot))) return json(res, 404, { error: 'NOT_FOUND' });
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html':'text/html', '.css':'text/css', '.js':'text/javascript' })[extname(file)],
      'cache-control': 'no-store', 'x-content-type-options':'nosniff',
      'content-security-policy': `default-src 'self'; connect-src 'self' ${webOrigin}; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` });
    res.end(content);
  } catch { json(res, 404, { error: 'NOT_FOUND' }); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;
    const origin = req.headers.origin;
    if (origin && origin !== webOrigin && origin !== `http://localhost:${port}` && !origin.startsWith('chrome-extension://')) return json(res, 403, { error: 'ORIGIN_DENIED' });
    if (origin && (origin === webOrigin || origin.startsWith('chrome-extension://'))) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-headers', 'authorization,content-type');
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (path === '/api/health' && req.method === 'GET') {
      await db.query('SELECT 1');
      return json(res, 200, { status: 'ok', environment: process.env.V2_ENVIRONMENT || 'local', protocolVersion: 1 });
    }
    if (!path.startsWith('/api/')) return staticFile(path, res);
    const data = req.method === 'POST' ? await body(req) : {};
    if (path.startsWith('/api/admin/')) {
      if (!authorized(bearer(req), adminToken)) return json(res, 401, { error: 'UNAUTHORIZED' });
      if (path === '/api/admin/overview' && req.method === 'GET') return json(res, 200, await control.overview());
      if (path === '/api/admin/operators' && req.method === 'POST') return json(res, 200, await control.createOperator(data.id, data.cohort, data.dailyLimit));
      if (path === '/api/admin/operators/disable' && req.method === 'POST') { await control.disableOperator(data.id, data.disabled); return json(res, 200, { ok:true }); }
      if (path === '/api/admin/installations' && req.method === 'POST') return json(res, 200, await control.createInstallation(data.operatorId, data.extensionVersion, data.buildSha));
      if (path === '/api/admin/installations/revoke' && req.method === 'POST') { await control.revokeInstallation(data.id); return json(res, 200, { ok:true }); }
      if (path === '/api/admin/runs' && req.method === 'POST') return json(res, 200, await control.createRun(data));
      if (/^\/api\/admin\/runs\/[0-9a-f-]+\/(pause|resume)$/.test(path) && req.method === 'POST') {
        const [, , , , id, operation] = path.split('/');
        if (operation === 'pause') await control.pauseRun(id); else await control.resumeRun(id);
        return json(res, 200, { status: operation === 'pause' ? 'paused' : 'running' });
      }
      if (path === '/api/admin/flags' && req.method === 'POST') { await control.setFlag(data.flagKey, data.disabled); return json(res, 200, { ok: true }); }
      if (path === '/api/admin/configs' && req.method === 'POST') return json(res, 200, await control.createConfig(data.config, data.minVersion));
      if (path === '/api/admin/configs/activate' && req.method === 'POST') return json(res, 200, await control.activateConfig(data.version, data.channel, data.rolloutPercent ?? 100));
      if (path === '/api/admin/pay-rules' && req.method === 'POST') {
        if (!Number.isInteger(data.version) || !Number.isInteger(data.amountMinor) || data.amountMinor < 0 || !/^[A-Z]{3}$/.test(data.currency || '') || data.eventType !== 'connection_confirmed') throw new Error('PAY_RULE_INVALID');
        await db.query(`INSERT INTO callum_v2.pay_rules(version,event_type,amount_minor,currency,enabled) VALUES ($1,$2,$3,$4,$5)`,
          [data.version,data.eventType,data.amountMinor,data.currency,data.enabled === true]);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'NOT_FOUND' });
    }
    const installation = await control.installation(bearer(req));
    if (path === '/api/installation' && req.method === 'GET') return json(res, 200, {
      id: installation.id, operatorId: installation.operator_id, extensionVersion: installation.extension_version,
      buildSha: installation.build_sha, environment: process.env.V2_ENVIRONMENT || 'local', protocolVersion: 1
    });
    if (path === '/api/commands/claim' && req.method === 'POST') return json(res, 200, await control.claim(installation));
    const match = /^\/api\/commands\/([0-9a-f-]+)\/(authorize|ack)$/.exec(path);
    if (match && req.method === 'POST') {
      if (match[2] === 'authorize') return json(res, 200, await control.authorizeAction(installation, match[1]));
      if (data.commandId !== match[1]) throw new Error('COMMAND_ID_MISMATCH');
      return json(res, 200, await control.acknowledge(installation, data));
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error.message || '') ? error.message : 'INTERNAL_ERROR';
    if (code === 'INTERNAL_ERROR') console.error('V2 request failed', error.code || error.name);
    const status = code === 'UNAUTHORIZED' ? 401 : code === 'INTERNAL_ERROR' ? 500 : 400;
    json(res, status, { error: code });
  }
});
const bindHost = process.env.V2_BIND_HOST || '127.0.0.1';
server.listen(port, bindHost, () => console.log(`Callum V2 ${process.env.V2_ENVIRONMENT || 'local'} listening on ${bindHost}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => db.close().finally(() => process.exit())));
