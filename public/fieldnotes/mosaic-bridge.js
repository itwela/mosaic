// Fieldnotes runs inside Mosaic as an iframe, either as the Field notes page or
// as a pane in a workspace (?pane=<panel id>). It expects window.__TAURI__ the
// way the standalone app had it, so hand it a small stand-in that routes its
// commands to Mosaic's fieldnotes_* handlers. Webview zoom is left out on
// purpose: zooming the webview would zoom all of Mosaic, so Fieldnotes falls
// back to CSS zoom. Drag-drop arrives from the parent via __fieldnotesDrop.
(() => {
  const internals = window.parent?.__TAURI_INTERNALS__;
  if (!internals) return;

  const pane = new URLSearchParams(location.search).get('pane') || 'main';
  if (pane !== 'main') document.documentElement.classList.add('in-pane');

  // Follow Mosaic's theme (Settings > Theme), live.
  const root = window.parent.document.documentElement;
  const mirrorTheme = () => { document.documentElement.dataset.theme = root.dataset.theme || 'mosaic'; };
  mirrorTheme();
  new MutationObserver(mirrorTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  // Every open copy shares one data file, but each keeps its own view
  // (client, list, zoom, sort) so panes can sit on different clients.
  const viewKey = `fieldnotes-view-${pane}`;
  const VIEW_FIELDS = ['activeClient', 'activeTab', 'zoom', 'sortFirst'];
  const readView = () => {
    try { return JSON.parse(localStorage.getItem(viewKey) || '{}'); } catch { return {}; }
  };
  // A new pane starts at 100% rather than inheriting the main page's zoom.
  const paneDefaults = pane === 'main' ? {} : { zoom: 1 };
  const withOwnView = (data) => ({ ...data, _settings: { ...(data?._settings || {}), ...paneDefaults, ...readView() } });

  const channel = new BroadcastChannel('fieldnotes-sync');
  const call = (cmd, args) => internals.invoke(`fieldnotes_${cmd}`, args);

  async function invoke(cmd, args) {
    if (cmd === 'load_state') return withOwnView(await call(cmd, args));
    const result = await call(cmd, args);
    if (cmd === 'save_state') {
      const settings = args?.state?._settings || {};
      const view = {};
      for (const field of VIEW_FIELDS) if (field in settings) view[field] = settings[field];
      localStorage.setItem(viewKey, JSON.stringify(view));
      channel.postMessage({ from: pane });
    }
    return result;
  }

  // Another copy saved: pick up its changes so this one never saves over them.
  // `state`, `clients` and `render` are app.js globals.
  channel.onmessage = async ({ data }) => {
    if (data?.from === pane) return;
    const fresh = withOwnView(await call('load_state'));
    for (const c of fresh._custom_clients || []) {
      if (!clients.some((x) => x.id === c.id)) clients.push(c);
    }
    state = fresh;
    render();
  };

  let dropHandler = null;
  window.__fieldnotesDrop = (event) => dropHandler?.(event);
  window.__TAURI__ = {
    core: { invoke },
    webview: {
      getCurrentWebview: () => ({
        onDragDropEvent: async (handler) => { dropHandler = handler; return () => { dropHandler = null; }; },
      }),
    },
  };
})();
