import http from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  analyzeQuery,
  checkMigration,
  explainPlan,
  healthReport,
  suggestIndexes,
} from './doctor.ts';
import { assertControlPlaneUrl, consume, type ConsumeResult } from './control-plane-client.ts';

const PRODUCT = 'database-doctor';
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const MAX_BODY = 2 * 1024 * 1024;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Body = Record<string, unknown>;

function requireSql(body: Body): string {
  if (typeof body.sql !== 'string') throw new HttpError(400, 'invalid_sql');
  return body.sql;
}

const ROUTES: Record<string, (body: Body) => unknown> = {
  '/v1/analyze-query': body => analyzeQuery(requireSql(body)),
  '/v1/check-migration': body => checkMigration(requireSql(body)),
  '/v1/suggest-indexes': body => suggestIndexes(
    requireSql(body),
    Array.isArray(body.existingIndexes) ? body.existingIndexes as { table: string; columns: string[] }[] : [],
  ),
  '/v1/explain-plan': body => {
    if (body.plan === undefined) throw new HttpError(400, 'invalid_plan');
    return explainPlan(body.plan);
  },
  '/v1/health-report': body => healthReport({
    queries: body.queries as string[] | undefined,
    migrations: body.migrations as string[] | undefined,
    plans: body.plans as unknown[] | undefined,
  }),
};

async function readBody(req: http.IncomingMessage): Promise<Body> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large');
    chunks.push(buf);
  }
  if (!chunks.length) throw new HttpError(400, 'invalid_json');
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString()) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    return body as Body;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

function bearer(req: http.IncomingMessage): string {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ') || !auth.slice(7)) throw new HttpError(401, 'unauthorized');
  return auth.slice(7);
}

export function createHostedServer(opts: {
  controlPlaneUrl: string;
  consumeImpl?: typeof consume;
  fetchImpl?: typeof fetch;
}): http.Server {
  const { controlPlaneUrl, consumeImpl = consume, fetchImpl } = opts;
  const baseUrl = assertControlPlaneUrl(controlPlaneUrl);
  return http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(body));
    };
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/health' && req.method === 'GET') return send(200, { status: 'ok' });

      const apiKey = bearer(req);
      const run = ROUTES[path];
      if (req.method !== 'POST' || !run) throw new HttpError(404, 'not_found');

      const body = await readBody(req);
      if (!validId(body.requestId)) throw new HttpError(400, 'invalid_request_id');
      const units = body.units === undefined ? 1 : body.units;
      if (!Number.isSafeInteger(units) || (units as number) < 1) throw new HttpError(400, 'invalid_units');

      const reservation: ConsumeResult = await consumeImpl({
        baseUrl,
        apiKey,
        requestId: body.requestId,
        units: units as number,
        fetchImpl,
      });
      if (!reservation.ok) {
        const status = reservation.status === 429 || reservation.status === 401 || reservation.status === 409
          ? reservation.status
          : reservation.status >= 400 && reservation.status < 600 ? reservation.status : 502;
        throw new HttpError(status, reservation.error ?? 'control_plane_error');
      }

      let report: unknown;
      try {
        report = run(body);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : 'analysis_failed');
      }

      return send(200, {
        report,
        usage: {
          product: PRODUCT,
          requestId: body.requestId,
          units,
          duplicate: reservation.duplicate,
          used: reservation.used,
          limit: reservation.limit,
        },
      });
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Hosted request failure:', error instanceof Error ? error.name : error);
      const status = error instanceof HttpError ? error.status : 500;
      send(status, { error: error instanceof HttpError ? error.message : 'internal_error' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createHostedServer({ controlPlaneUrl: process.env.CONTROL_PLANE_URL ?? '' });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT ?? 3103), process.env.HOST ?? '127.0.0.1', () => {
    console.log('Database Doctor hosted listening');
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
