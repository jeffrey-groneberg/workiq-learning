export const ORIGIN = 'https://workiq.svc.cloud.microsoft';
export const SCOPE = 'api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask';

export function redact(value) {
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted JWT]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, /^(authorization|access_?token|refresh_?token|id_?token|client_?secret|cookie|set-cookie)$/i.test(key)
        ? '[redacted]' : redact(item),
    ]));
  }
  return value;
}

export function createHttp(getToken, trace, fetchImpl = fetch) {
  return async function request(path, { body, headers = {}, signal } = {}) {
    if (!/^\/(rest|a2a)\//.test(path) || path.includes('..')) {
      throw new Error('Only documented Work IQ REST and A2A paths are allowed.');
    }
    const url = ORIGIN + path;
    const method = body === undefined ? 'GET' : 'POST';
    const requestHeaders = {
      'Content-Type': 'application/json', ...headers,
      Authorization: `Bearer ${await getToken()}`,
    };
    trace({ direction: 'request', method, url, headers: redact(requestHeaders), body });
    const started = performance.now();
    const response = await fetchImpl(url, {
      method, headers: requestHeaders, redirect: 'error', signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const ms = Math.round(performance.now() - started);
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      trace({ direction: 'response', status: response.status, ms, body: text });
      throw new Error(`Work IQ returned HTTP ${response.status} without valid JSON. Check the response in the inspector.`);
    }
    trace({
      direction: 'response', status: response.status, ms,
      requestId: response.headers.get('request-id'), body: data,
    });
    if (!response.ok) {
      const detail = data.error?.message || data.message || response.statusText;
      const hint = {
        401: 'Sign in again with a token for the Work IQ resource.',
        403: 'Check delegated consent, tenant policy and your billing-plan assignment.',
        429: `Rate limited. Retry later${response.headers.get('retry-after') ? ` (Retry-After: ${response.headers.get('retry-after')})` : ''}.`,
      }[response.status] || 'Inspect the response before retrying.';
      throw new Error(`HTTP ${response.status}: ${detail}. ${hint}`);
    }
    return data;
  };
}
