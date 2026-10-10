const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

class Events extends EventEmitter {
  constructor(dataDir) {
    super();
    this.setMaxListeners(0);
    this.file = path.join(dataDir, 'easyag.log');
    this.history = [];
  }

  log(category, message, cls = '') {
    const item = { at: new Date().toISOString(), category, message, cls };
    this.history.push(item);
    if (this.history.length > 300) this.history.shift();
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 2 * 1024 * 1024) {
        fs.renameSync(this.file, this.file + '.previous');
      }
      fs.appendFileSync(this.file, JSON.stringify(item) + '\n');
    } catch { /* Logging must not prevent configuration recovery. */ }
    this.emit('message', item);
    return item;
  }

  publish(message) { this.emit('message', message); }
  logs(limit = 100) { return this.history.slice(-Math.min(Math.max(limit, 1), 300)); }
}

module.exports = { Events };
