export async function request(route, { body, method = body === undefined ? 'GET' : 'POST' } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(route, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `请求失败 (${response.status})`);
    return data;
  } finally { clearTimeout(timeout); }
}

export const api = {
  status: () => request('/api/status'),
  logs: () => request('/api/logs?limit=200'),
  configure: body => request('/api/config', { body }),
  launch: () => request('/api/launch', { method: 'POST' }),
  openRules: () => request('/api/danger-rules/open', { method: 'POST' }),
  reloadRules: () => request('/api/danger-rules/reload', { method: 'POST' }),
  restore: () => request('/api/danger-rules/cleanup', { method: 'POST' }),
  hide: () => request('/api/hide', { method: 'POST' })
};
