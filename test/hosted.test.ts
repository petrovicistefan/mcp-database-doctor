import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHostedServer } from '../src/hosted.ts';
import { consume } from '../src/control-plane-client.ts';

const KEY = 'mcp_test_key';

async function listen(server: http.Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

function createFakeControlPlane({ limit = 2 } = {}) {
  const seen = new Map<string, number>();
  let used = 0;
  const events: Record<string, unknown>[] = [];
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || new URL(req.url ?? '/', 'http://x').pathname !== '/v1/usage/consume') {
      return send(404, { error: 'not_found' });
    }
    if ((req.headers.authorization ?? '') !== `Bearer ${KEY}`) return send(401, { error: 'unauthorized' });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { requestId: string; units: number };
    events.push(body);
    const prev = seen.get(body.requestId);
    if (prev !== undefined) {
      if (prev !== body.units) return send(409, { error: 'request_id_conflict' });
      return send(200, { allowed: true, duplicate: true, used, limit });
    }
    if (used + body.units > limit) return send(429, { allowed: false, used, limit, error: 'quota_exceeded' });
    used += body.units;
    seen.set(body.requestId, body.units);
    return send(200, { allowed: true, duplicate: false, used, limit });
  });
  return { server, events };
}

test('hosted analyze-query consumes quota; SQL never reaches control plane', async t => {
  const { server: controlPlane, events } = createFakeControlPlane();
  const controlPlaneUrl = await listen(controlPlane);
  const consumeCalls: unknown[] = [];
  const consumeImpl = async (opts: Parameters<typeof consume>[0]) => {
    const result = await consume(opts);
    consumeCalls.push(result.payload);
    return result;
  };
  const hosted = createHostedServer({ controlPlaneUrl, consumeImpl });
  const hostedUrl = await listen(hosted);
  t.after(async () => {
    await Promise.all([
      new Promise<void>(resolve => controlPlane.close(() => resolve())),
      new Promise<void>(resolve => hosted.close(() => resolve())),
    ]);
  });

  const hostedCall = async (path: string, token: string, body: object) => {
    const response = await fetch(`${hostedUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  const first = await hostedCall('/v1/analyze-query', KEY, {
    requestId: 'q1',
    sql: 'SELECT * FROM users OFFSET 50000',
  });
  assert.equal(first.status, 200);
  assert.equal((first.body.usage as { product: string }).product, 'database-doctor');

  assert.equal((await hostedCall('/v1/check-migration', KEY, {
    requestId: 'm1',
    sql: 'DROP TABLE users;',
  })).status, 200);

  assert.equal((await hostedCall('/v1/analyze-query', KEY, {
    requestId: 'q2',
    sql: 'SELECT 1',
  })).status, 429);

  for (const payload of consumeCalls as { product: string }[]) {
    assert.deepEqual(Object.keys(payload).sort(), ['product', 'requestId', 'units']);
    assert.equal(payload.product, 'database-doctor');
    assert.equal('sql' in payload, false);
  }
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ['product', 'requestId', 'units']);
    assert.equal('sql' in event, false);
  }
});
