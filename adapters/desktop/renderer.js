const { installI18n } = require('../../features/i18n');
const { installContextWidget } = require('../../features/context-widget');

function rendererSource(dictionary, settings, binding) {
  return `(() => {
    if (window !== window.top) return;
    const generation = (window.__easyagMountGeneration || 0) + 1;
    window.__easyagMountGeneration = generation;
    function mount() {
      if (window.__easyagMountGeneration !== generation) return;
      (${installI18n.toString()})(window, document, ${JSON.stringify(dictionary)}, ${settings.enableI18n});
      (${installContextWidget.toString()})(window, document, ${settings.enableContextMonitor === true}, event => {
        if (typeof window[${JSON.stringify(binding)}] === 'function') window[${JSON.stringify(binding)}](JSON.stringify(event));
      });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  })();`;
}

const disposeSource = 'window.__easyagMountGeneration = (window.__easyagMountGeneration || 0) + 1; window.__easyagI18n?.dispose(); window.__easyagContext?.dispose();';
module.exports = { rendererSource, disposeSource };
