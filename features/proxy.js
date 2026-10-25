function buildProxyLaunch(port, cdpPort, environment = process.env, enableProxy = true) {
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    '--remote-debugging-address=127.0.0.1'
  ];
  const env = { ...environment };
  if (enableProxy) {
    const proxy = `http://127.0.0.1:${port}`;
    const bypass = 'localhost,127.0.0.1,::1,[::1]';
    args.push(
      `--proxy-server=${proxy}`,
      '--proxy-bypass-list=localhost;127.0.0.1;[::1]'
    );
    Object.assign(env, {
      HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy,
      ALL_PROXY: proxy, all_proxy: proxy,
      NO_PROXY: bypass, no_proxy: bypass
    });
  }
  return { args, env };
}

module.exports = { buildProxyLaunch };
