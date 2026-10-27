// Read only the active composer's conversation identifier, never message props or history.
// IDE's Preact internals are optional: unknown/ambiguous layouts fail closed.
function currentConversationId(win, doc, target = 'hub') {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (target !== 'ide') {
    const id = win.location.pathname.match(/\/c\/([^/]+)/)?.[1];
    return id && guid.test(id) ? id.toLowerCase() : null;
  }
  if (!['vscode-file:', 'file:'].includes(win.location.protocol)
    || !/\/workbench\.html$/.test(win.location.pathname)) return null;
  const boxes = [...doc.querySelectorAll('[id="antigravity.agentSidePanelInputBox"]')]
    .filter(box => box.isConnected && box.getClientRects().length
      && !box.closest('[hidden],[inert]') && win.getComputedStyle(box).visibility !== 'hidden'
      && box.querySelector('[data-testid="model-selector-trigger"]'));
  if (boxes.length !== 1) return null;
  const box = boxes[0], root = box.closest('.antigravity-agent-side-panel');
  if (!root?.__k) return null;
  const queue = [root.__k], seen = new Set(), ids = new Set();
  while (queue.length && seen.size < 5000) {
    let vnode = queue.pop();
    if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) continue;
    seen.add(vnode);
    if (typeof vnode.type === 'string' && vnode.__e && vnode.__e !== box
      && typeof vnode.__e.contains === 'function' && !vnode.__e.contains(box)) continue;
    if (vnode.__e === box) {
      for (let depth = 0; vnode && depth < 16; depth++, vnode = vnode.__) {
        if (Object.prototype.hasOwnProperty.call(vnode.props || {}, 'cascadeId')) {
          const id = vnode.props.cascadeId;
          // Empty/new composers must not inherit a previous conversation from a parent.
          if (typeof id !== 'string' || !guid.test(id)) return null;
          ids.add(id.toLowerCase());
          break;
        }
      }
    } else if (Array.isArray(vnode.__k)) queue.push(...vnode.__k);
  }
  return !queue.length && ids.size === 1 ? [...ids][0] : null;
}

module.exports = { currentConversationId };
