const PRODUCT = 'database-doctor';

export function assertControlPlaneUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('CONTROL_PLANE_URL must be an http(s) URL');
  }
  return baseUrl.replace(/\/$/, '');
}

export type ConsumeResult = {
  ok: boolean;
  status: number;
  error?: string;
  duplicate?: boolean;
  used?: number;
  limit?: number;
  payload: { product: string; requestId: string; units: number };
};

/** Reserve quota units before a billable hosted op. Never send SQL or plans. */
export async function consume(opts: {
  baseUrl: string;
  apiKey: string;
  requestId: string;
  units?: number;
  product?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ConsumeResult> {
  const {
    baseUrl,
    apiKey,
    requestId,
    units = 1,
    product = PRODUCT,
    fetchImpl = fetch,
    timeoutMs = 10000,
  } = opts;
  const root = assertControlPlaneUrl(baseUrl);
  const payload = { product, requestId, units };
  if (typeof apiKey !== 'string' || !apiKey) return { ok: false, status: 401, error: 'unauthorized', payload };
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) {
    return { ok: false, status: 400, error: 'invalid_request_id', payload };
  }
  if (!Number.isSafeInteger(units) || units < 1) return { ok: false, status: 400, error: 'invalid_units', payload };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${root}/v1/usage/consume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body: Record<string, unknown> | null = null;
    try { body = await response.json() as Record<string, unknown>; } catch { body = null; }
    if (response.status === 200 && body?.allowed) {
      return {
        ok: true,
        status: 200,
        duplicate: Boolean(body.duplicate),
        used: body.used as number | undefined,
        limit: body.limit as number | undefined,
        payload,
      };
    }
    if (response.status === 429) {
      return { ok: false, status: 429, error: 'quota_exceeded', used: body?.used as number | undefined, limit: body?.limit as number | undefined, payload };
    }
    if (response.status === 409) return { ok: false, status: 409, error: 'request_id_conflict', payload };
    if (response.status === 401) return { ok: false, status: 401, error: 'unauthorized', payload };
    return {
      ok: false,
      status: response.status >= 400 ? response.status : 502,
      error: typeof body?.error === 'string' ? body.error : 'control_plane_error',
      payload,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ok: false, status: 502, error: aborted ? 'control_plane_timeout' : 'control_plane_unreachable', payload };
  } finally {
    clearTimeout(timer);
  }
}
