class Notifications {
  constructor({ host, events }) { Object.assign(this, { host, events }); }
  show(message) {
    const clean = {
      type: String(message.type || 'interaction'),
      title: String(message.title || '').slice(0, 160),
      detail: String(message.detail || '').slice(0, 600),
      solution: String(message.solution || '').slice(0, 600)
    };
    this.events.emit('notification', clean);
    this.host.showCapsule(clean);
  }
  hide() { this.host.hideCapsule(); }
}

module.exports = { Notifications };
