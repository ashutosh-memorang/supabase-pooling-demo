// Local demo server: http://127.0.0.1:3000
//   /     the sign-up demo (needs only APP_DATABASE_URL and DELIVERY_DATABASE_URL in .env)
//   /lab  the detailed experiments (needs the extra lab setup, see README → Detailed lab)
// Listens on loopback only and runs one action at a time.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { countUsers, LOGINS, reset, runScript, signup } from './lib/signup.mjs';

const PORT = Number(process.env.PORT ?? 3000);
let busy = null;

const actions = {
  signup: (body) => signup(body),
  script: (body) => runScript(body),
  reset: () => reset(),
};

// The lab is optional: load it only if its configuration is present.
let labError = null;
try {
  const [{ EXPERIMENTS }, { REALISTIC }, { recycleBackends }, { setup }, { cleanup }, config] = await Promise.all([
    import('./lib/experiments.mjs'),
    import('./lib/realistic.mjs'),
    import('./lib/admin.mjs'),
    import('./scripts/setup.mjs'),
    import('./scripts/cleanup.mjs'),
    import('./lib/config.mjs'),
  ]);
  Object.assign(actions, Object.fromEntries(Object.entries({ ...EXPERIMENTS, ...REALISTIC }).map(([k, fn]) => [k, (o) => fn(o)])), {
    setup: async () => ({ verdict: 'OK', headline: 'Test roles, schema and table are in place.', rows: await setup() }),
    recycle: async () => ({ verdict: 'OK', ...(await recycleBackends()) }),
    cleanup: async () => ({ verdict: 'OK', headline: 'All test roles and data removed. Run Setup to use the lab again.', rows: await cleanup() }),
    labInfo: () => ({
      projectRef: config.PROJECT_REF,
      paths: Object.fromEntries(Object.entries(config.PATHS).map(([k, p]) => [k, { label: p.label, role: p.role, mode: p.mode, endpoint: config.describeEndpoint(p) }])),
    }),
  });
} catch (err) {
  labError = err.message;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, readFileSync(new URL('./public/signup.html', import.meta.url)), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/lab') {
      if (labError) return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Lab not configured</title><body style="font:16px system-ui;padding:24px">
        <h1>The detailed lab is not configured</h1><p>The sign-up demo at <a href="/">/</a> works without it.</p><p>${labError.replace(/</g, '&lt;')}</p>`, 'text/html; charset=utf-8');
      return send(res, 200, readFileSync(new URL('./public/index.html', import.meta.url)), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/users') return send(res, 200, { totalUsers: await countUsers(), logins: LOGINS });
    if (req.method === 'GET' && url.pathname === '/api/info') {
      return actions.labInfo ? send(res, 200, actions.labInfo()) : send(res, 404, { error: labError });
    }
    const m = url.pathname.match(/^\/api\/run\/(\w+)$/) ?? url.pathname.match(/^\/api\/(signup|script|reset)$/);
    if (req.method === 'POST' && m && actions[m[1]]) {
      if (busy) return send(res, 409, { error: `"${busy}" is still running — wait for it to finish.` });
      let body = '';
      for await (const chunk of req) body += chunk;
      busy = m[1];
      const started = Date.now();
      try {
        return send(res, 200, { ...(await actions[m[1]](body ? JSON.parse(body) : {})), seconds: (Date.now() - started) / 1000 });
      } finally {
        busy = null;
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Sign-up demo → http://127.0.0.1:${PORT}   (app login: ${LOGINS.app}, delivery login: ${LOGINS.delivery})`);
  if (labError) console.log('Detailed lab (/lab) is not configured; the sign-up demo works without it.');
});
