import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHostedServer } from '../src/hosted.ts';
import { consume } from '../src/control-plane-client.ts';

const controlPlaneRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mcp-control-plane');
const { Store } = await import(join(controlPlaneRoot, 'src', 'store.js'));
const { createServer } = await import(join(controlPlaneRoot, 'src', 'server.js'));

async function listen(server: import('node:http').Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test('hosted analyze-query consumes quota; SQL never reaches control plane', async t => {
  const store = new Store();
  const admin = 'a'.repeat(32);
  const controlPlane = createServer({ store, adminToken: admin, limits: { free: 2, paid: 10 } });
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
    store.close();
  });

  const adminCall = async (path: string, body: object) => {
    const response = await fetch(`${controlPlaneUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const hostedCall = async (path: string, token: string, body: object) => {
    const response = await fetch(`${hostedUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  assert.equal((await adminCall('/v1/admin/accounts', { accountId: 'db-1' })).status, 201);
  const keyBody = (await adminCall('/v1/admin/keys', { accountId: 'db-1' })).body as { key: string };
  const { key } = keyBody;

  const first = await hostedCall('/v1/analyze-query', key, {
    requestId: 'q1',
    sql: 'SELECT * FROM users OFFSET 50000',
  });
  assert.equal(first.status, 200);
  assert.equal((first.body.usage as { product: string }).product, 'database-doctor');

  assert.equal((await hostedCall('/v1/check-migration', key, {
    requestId: 'm1',
    sql: 'DROP TABLE users;',
  })).status, 200);

  assert.equal((await hostedCall('/v1/analyze-query', key, {
    requestId: 'q2',
    sql: 'SELECT 1',
  })).status, 429);

  for (const payload of consumeCalls as { product: string }[]) {
    assert.deepEqual(Object.keys(payload).sort(), ['product', 'requestId', 'units']);
    assert.equal(payload.product, 'database-doctor');
    assert.equal('sql' in payload, false);
  }
});
