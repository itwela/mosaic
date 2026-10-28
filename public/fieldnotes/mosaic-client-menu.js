// The client <select> opens the native macOS popup, which can't be styled.
// Hide it behind a glass dropdown that mirrors its options and drives it,
// so app.js keeps handling the change exactly as before.
(() => {
  const select = document.querySelector('#client-select');
  const wrap = select?.closest('.client-select-wrap');
  if (!select || !wrap) return;

  wrap.classList.add('client-menu');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'client-menu-button';
  button.setAttribute('aria-haspopup', 'listbox');
  const panel = document.createElement('div');
  panel.className = 'client-menu-panel';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;
  wrap.append(button, panel);

  const sync = () => {
    button.textContent = select.selectedOptions[0]?.textContent || 'Choose client';
  };
  const close = () => { panel.hidden = true; wrap.classList.remove('open'); };
  const open = () => {
    panel.replaceChildren(...[...select.options].map((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'client-menu-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === select.value));
      item.textContent = option.textContent;
      item.onclick = () => {
        close();
        if (option.value === select.value) return;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      };
      return item;
    }));
    panel.hidden = false;
    wrap.classList.add('open');
  };

  button.onclick = () => (panel.hidden ? open() : close());
  document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // app.js rebuilds the options on every render
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
  select.addEventListener('change', sync);
  sync();
})();
