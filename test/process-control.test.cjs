const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDarwinProcessList,
  targetProcessMatches,
  stopDarwinTarget
} = require('../adapters/desktop/process-control');

const target = {
  appDir: '/Applications/Antigravity.app',
  appExe: '/Applications/Antigravity.app/Contents/MacOS/Antigravity'
};

test('process control includes Antigravity helpers but excludes EasyAntigravity', () => {
  const rows = parseDarwinProcessList([
    '18190 /Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper --import=dist/server.cjs',
    '36579 /Volumes/lenovo/easyanti/.build/EasyAntigravity.app/Contents/MacOS/easyantigravity',
    '40700 /Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=9333'
  ].join('\n'));

  assert.equal(rows.length, 3);
  assert.equal(targetProcessMatches(rows[0].command, target), true);
  assert.equal(targetProcessMatches(rows[1].command, target), false);
  assert.equal(targetProcessMatches(rows[2].command, target), true);
});

test('stopDarwinTarget waits for the target process set to disappear', async () => {
  let alive = true;
  const signals = [];
  const execute = async () => ({
    stdout: alive
      ? '18190 /Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper --import=dist/server.cjs\n'
        + '40700 /Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=9333\n'
        + '36579 /Volumes/lenovo/easyanti/.build/EasyAntigravity.app/Contents/MacOS/easyantigravity\n'
      : ''
  });
  const result = await stopDarwinTarget(target, {
    execute,
    kill: (pid, signal) => { signals.push([pid, signal]); alive = false; },
    sleepFn: async () => {},
    pollIntervalMs: 0
  });

  assert.deepEqual(result, {
    ok: true,
    initialPids: [18190, 40700],
    remainingPids: []
  });
  assert.deepEqual(signals, [[18190, 'SIGTERM'], [40700, 'SIGTERM']]);
});
