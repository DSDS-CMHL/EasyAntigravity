const { getJson } = require('../adapters/desktop/cdp');

// DevToolsActivePort can be written before a cold-started browser serves pages.
async function waitForBrowserPage(port, browser, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    // Edge may hand off to a child process and exit successfully during startup.
    if (browser.exitCode !== null && browser.exitCode !== 0) throw new Error(`Browser exited before readiness (${browser.exitCode})`);
    try {
      const pages = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = pages.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Browser page readiness timed out: ${lastError?.message || 'no page target'}`);
}

module.exports = { waitForBrowserPage };
