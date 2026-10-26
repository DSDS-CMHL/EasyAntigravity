export async function request(route, { body, method = body === undefined ? 'GET' : 'POST', timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('请求超时，请检查本地代理或网络连接')), timeoutMs);
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
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  status: () => request('/api/status'),
  logs: () => request('/api/logs?limit=200'),
  configure: body => request('/api/config', { body }),
  getProjects: () => request('/api/cli/projects'),
  createProject: body => request('/api/cli/create-project', { body }),
  launchCli: body => request('/api/cli/launch', { body }),
  openFolder: folderPath => request('/api/cli/open-folder', { body: { folderPath } }),
  setTheme: theme => request('/api/theme', { body: { theme }, method: 'POST' }),
  hide: () => request('/api/hide', { method: 'POST' }),
  quit: () => request('/api/quit', { method: 'POST' })
};
