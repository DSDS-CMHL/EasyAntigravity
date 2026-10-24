function buildProxyLaunch(port, cdpPort, environment = process.env) {
  const proxy = `http://127.0.0.1:${port}`;
  const bypass = 'localhost,127.0.0.1,::1,[::1]';
  return {
    args: [
      `--remote-debugging-port=${cdpPort}`,
      '--remote-debugging-address=127.0.0.1',
      `--proxy-server=${proxy}`,
      '--proxy-bypass-list=localhost;127.0.0.1;[::1]'
    ],
    env: {
      ...environment,
      HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy,
      ALL_PROXY: proxy, all_proxy: proxy,
      NO_PROXY: bypass, no_proxy: bypass
    }
  };
}

module.exports = { buildProxyLaunch };
