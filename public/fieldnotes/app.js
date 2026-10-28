const key = 'fieldnotes-client-checklists-v1';
const labels = {
  pending: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  blocked: 'Needs attention',
  'not-checked': 'Not checked'
};
const standardCycle = ['pending', 'in-progress', 'done', 'blocked'];
const reviewCycle = ['not-checked', 'in-progress', 'done', 'blocked'];

// Built-in clients load from the git-ignored my-clients.js when it exists.
const baseClients = window.FIELDNOTES_BASE_CLIENTS || [];

let clients = [...baseClients];
let activeClient = 'veh';
let active = 'workstream';
let state = {};
let expandedGroups = new Set();
let saveQueue = Promise.resolve();
let activeFilter = 'all';
// Status that sorts to the top; the rest follow sortRest. 'none' keeps list order.
let sortFirst = 'none';
const sortRest = ['blocked', 'in-progress', 'pending', 'not-checked', 'done'];
const sortByStatus = list => {
  if (sortFirst === 'none') return list;
  const order = [sortFirst, ...sortRest.filter(s => s !== sortFirst)];
  return list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => order.indexOf(a.x.status) - order.indexOf(b.x.status) || a.i - b.i)
    .map(({ x }) => x);
};
const imageCache = new Map();

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
let evidenceTarget = null;
let noteTarget = null;

// Zoom configuration & persistence
const zoomKey = 'fieldnotes-app-zoom-v1';
let zoomLevel = 1;

async function setZoom(level, persist = true) {
  zoomLevel = Math.min(1.6, Math.max(0.7, Math.round(level * 10) / 10));
  localStorage.setItem(zoomKey, String(zoomLevel));
  
  const resetBtn = document.querySelector('#zoom-reset');
  if (resetBtn) resetBtn.textContent = `${Math.round(zoomLevel * 100)}%`;
  
  // Use one zoom mechanism only. Stacking CSS zoom on the webview zoom
  // compounded the scale and threw the full-screen image viewer out of step.
  let webviewZoomed = false;
  try {
    const wv = tauri?.webview?.getCurrentWebview?.();
    if (wv?.setZoom) { await wv.setZoom(zoomLevel); webviewZoomed = true; }
  } catch (err) {
    console.debug('Tauri webview setZoom error:', err);
  }
  document.documentElement.style.zoom = webviewZoomed ? '' : String(zoomLevel);

  if (persist && state) {
    state._settings = { ...(state._settings || {}), zoom: zoomLevel };
    save();
  }
}

const save = () => {
  const snapshot = JSON.parse(JSON.stringify(state));
  saveQueue = saveQueue
    .then(() => (invoke ? invoke('save_state', { state: snapshot }) : Promise.resolve(localStorage.setItem(key, JSON.stringify(snapshot)))))
    .then(() => {
      const label = document.querySelector('#save-label');
      const dot = document.querySelector('.save-dot');
      if (label) label.textContent = 'Saved on this device';
      if (dot) dot.style.background = '#e2622a';
    })
    .catch(() => {
      const label = document.querySelector('#save-label');
      if (label) label.textContent = 'Could not save · export a backup';
    });
  return saveQueue;
};

function getCurrentClient() {
  return clients.find(c => c.id === activeClient) || clients[0];
}

function getClientCollections() {
  const c = getCurrentClient();
  return c?.collections || [];
}

function getWorkstreamsForCollection(col) {
  if (col.kind !== 'streams') return [];
  const sourceName = col.streamSource || 'FIELDNOTES_WORKSTREAMS';
  const base = (window[sourceName] || []).map(s => ({
    ...s,
    tasks: s.tasks.map(t => ({ ...t, notes: t.notes || '' }))
  }));
  // Include custom tasks added to this collection
  const custom = (state._custom_tasks?.[col.id] || []);
  if (custom.length && base.length) {
    const last = base[base.length - 1];
    return base.map((s, idx) => idx === base.length - 1 ? { ...s, tasks: [...s.tasks, ...custom] } : s);
  }
  return base;
}

function getItemsForCollection(col) {
  let items = [];
  if (col.kind === 'streams') {
    const streams = getWorkstreamsForCollection(col);
    items = streams.flatMap(s => s.tasks.map(t => ({ ...t, group: s.title })));
  } else if (col.itemSource && window[col.itemSource]) {
    items = window[col.itemSource].map(t => ({ ...t, notes: t.notes || '' }));
  } else if (col.items) {
    items = col.items.map(t => ({ ...t, notes: t.notes || '' }));
  }
  const custom = (state._custom_tasks?.[col.id] || []);
  return [...items, ...custom].map(t => ({
    ...t,
    status: getStatus(t),
    notes: getNotes(t),
    attachments: getAttachments(t)
  }));
}

function allItems() {
  return getClientCollections().flatMap(col => getItemsForCollection(col).map(t => ({ ...t, collection: col.id })));
}

function getStatus(item) {
  return state[item.id]?.status || item.status || (item.initialStatus === 'done' ? 'done' : 'pending');
}

function getNotes(item) {
  return state[item.id]?.notes ?? item.notes ?? '';
}

function getAttachments(item) {
  return state[item.id]?.attachments || [];
}

function activeItems() {
  const collections = getClientCollections();
  const c = collections.find(x => x.id === active) || collections[0];
  if (!c) return [];
  return getItemsForCollection(c);
}

function updateClientDropdown() {
  const sel = document.querySelector('#client-select');
  if (!sel) return;
  sel.innerHTML = clients.map(c => `<option value="${c.id}" ${c.id === activeClient ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const eyebrow = document.querySelector('#masthead-eyebrow');
  if (eyebrow) {
    const current = getCurrentClient();
    eyebrow.textContent = current.eyebrow || `${current.name.toUpperCase()} · CHECKLISTS`;
  }
}

function render() {
  updateClientDropdown();
  const collections = getClientCollections();
  let c = collections.find(x => x.id === active);
  if (!c && collections.length) {
    active = collections[0].id;
    c = collections[0];
  }
  if (!c) {
    // No clients yet: start the user on adding their own.
    document.querySelector('#tabs').innerHTML = '';
    document.querySelector('#list').innerHTML = '';
    const empty = document.querySelector('#empty');
    empty.textContent = 'No clients yet. Use the client menu to add your first one.';
    empty.hidden = false;
    return;
  }

  // Render Tabs with live counts and completion mechanism
  document.querySelector('#tabs').innerHTML = collections.map(x => {
    const list = getItemsForCollection(x);
    const dCount = list.filter(t => t.status === 'done').length;
    const total = list.length;
    const pct = total > 0 ? Math.round((dCount / total) * 100) : 0;
    const isComplete = dCount === total && total > 0;
    const progressState = isComplete ? 'done' : (dCount > 0 ? 'active' : 'idle');
    return `
      <button class="tab ${x.id === active ? 'active' : ''}" data-tab="${x.id}" data-complete="${isComplete}" style="--pct: ${pct}%;">
        <div class="tab-progress-bar" style="width: ${pct}%;"></div>
        <span class="tab-label">${esc(x.label)}</span>
        <span class="tab-badge" data-state="${progressState}">${dCount}/${total}${isComplete ? ' ✓' : ''}</span>
      </button>
    `;
  }).join('');

  document.querySelectorAll('.tab').forEach(b => {
    b.onclick = () => {
      active = b.dataset.tab;
      if (state) {
        state._settings = { ...(state._settings || {}), activeTab: active };
        save();
      }
      render();
    };
  });

  document.querySelector('#list-title').textContent = c.title;
  document.querySelector('#list-kicker').textContent = c.kicker;

  const items = activeItems();
  const done = items.filter(x => x.status === 'done').length;
  const progress = items.filter(x => x.status === 'in-progress').length;
  const attention = items.filter(x => x.status === 'blocked').length;
  const todo = items.filter(x => !['done', 'blocked'].includes(x.status)).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  document.querySelector('#summary').innerHTML = `
    <div class="summary-line">
      <div class="summary-stats">
        <span><strong>${done}</strong> done</span>
        <span><strong>${progress}</strong> active</span>
        <span><strong>${todo}</strong> remaining</span>
        ${attention ? `<span class="attention"><strong>${attention}</strong> attention</span>` : ''}
      </div>
      <div class="progress"><i style="width: ${pct}%"></i></div>
    </div>
  `;
  document.querySelector('#item-count').textContent = `${items.length} items`;
  draw(items);
}

function draw(items) {
  const q = document.querySelector('#search').value.trim().toLowerCase();
  const f = activeFilter;
  document.querySelector('#filter-cycle').textContent = ({
    all: 'All items',
    pending: 'To do',
    'in-progress': 'In progress',
    done: 'Done',
    blocked: 'Needs attention',
    'not-checked': 'Not checked'
  })[f] || 'All items';
  document.querySelector('#sort-cycle').textContent = sortFirst === 'none' ? 'Sort · list' : `Sort · ${labels[sortFirst]}`;

  const filtered = items.filter(x => (!q || `${x.title} ${x.description || ''} ${x.group || ''} ${x.notes}`.toLowerCase().includes(q)) && (f === 'all' || x.status === f));
  document.querySelector('#empty').textContent = 'No items match this view.';
  document.querySelector('#empty').hidden = filtered.length > 0;

  const itemMarkup = (x, i) => `
    <article class="item" data-item-id="${esc(x.id)}" data-status="${x.status}" ${x.notes ? 'data-has-note' : ''} ${x.attachments?.length ? 'data-has-evidence' : ''}>
      <span class="number">${String((x.position ?? i) + 1).padStart(2, '0')}</span>
      <div class="item-main">
        <h3 class="item-title">${esc(x.title)}</h3>
        ${x.description ? `<button type="button" class="detail-trigger" data-detail="${esc(x.id)}">Details</button>` : ''}
        ${x.priority ? `<span class="priority">Priority · ${esc(x.priority)}</span>` : ''}
        <button class="note-trigger" data-note="${esc(x.id)}">${x.notes ? 'Edit note' : 'Add note'}</button>
        <button class="evidence-trigger" data-evidence="${esc(x.id)}">+ Evidence${x.attachments?.length ? ` · ${x.attachments.length}` : ''}</button>
      </div>
      <button class="status-button" data-status="${esc(x.id)}" data-state="${x.status}" title="Click to change status" aria-label="${esc(x.title)}: ${labels[x.status]}. Click to cycle status.">
        <span class="status-icon"></span>
        <span>${labels[x.status] || 'To do'}</span>
      </button>
      ${x.notes ? `<button type="button" class="note-preview" data-note="${esc(x.id)}" aria-label="Edit note for ${esc(x.title)}" title="Click to edit note">${esc(x.notes)}</button>` : ''}
      ${x.attachments?.length ? `
        <div class="attachments">
          ${x.attachments.map(a => `
            <figure class="attachment">
              <img data-attachment="${esc(a.id)}" data-extension="${esc(a.extension)}" alt="${esc(a.name)}">
              <figcaption>
                <span>${esc(a.name)}</span>
                <button data-remove="${esc(x.id)}:${esc(a.id)}" aria-label="Remove screenshot" title="Remove screenshot">×</button>
              </figcaption>
            </figure>
          `).join('')}
        </div>
      ` : ''}
    </article>
  `;

  const col = getClientCollections().find(x => x.id === active);
  if (col && col.kind === 'streams') {
    let out = '';
    const streams = getWorkstreamsForCollection(col);
    for (const s of streams) {
      const groupTasks = s.tasks.map(t => ({
        ...t,
        status: getStatus(t),
        notes: getNotes(t),
        attachments: getAttachments(t),
        group: s.title
      }));
      const matches = sortByStatus(groupTasks.map((x, position) => ({ ...x, position })).filter(x => filtered.some(y => y.id === x.id)));
      if (!matches.length) continue;
      
      const expanded = !!q || f !== 'all' || expandedGroups.has(String(s.number));
      const d = groupTasks.filter(x => x.status === 'done').length;
      const total = groupTasks.length;
      const pct = total > 0 ? Math.round((d / total) * 100) : 0;
      const isComplete = d === total && total > 0;
      const progressState = isComplete ? 'done' : (d > 0 ? 'active' : 'idle');

      // Category summary with subtle progress bar background and progress line
      out += `
        <details class="workstream" data-group="${s.number}" data-complete="${isComplete}" ${expanded ? 'open' : ''}>
          <summary style="--pct: ${pct}%;">
            <div class="group-progress-bar" style="width: ${pct}%;"></div>
            <span class="group-number">${String(s.number).padStart(2, '0')}</span>
            <span class="group-title">${esc(s.title)}</span>
            <span class="group-progress" data-state="${progressState}">
              ${d}/${total}${isComplete ? ' ✓' : ''}
            </span>
            <span class="group-chevron">⌄</span>
          </summary>
          <div class="group-items">
            ${matches.map((x, i) => itemMarkup(x, i)).join('')}
          </div>
        </details>
      `;
    }
    document.querySelector('#list').innerHTML = out;
    document.querySelectorAll('.workstream').forEach(el => {
      el.ontoggle = () => {
        const gid = el.dataset.group;
        if (el.open) expandedGroups.add(gid);
        else expandedGroups.delete(gid);
      };
    });
  } else {
    const positions = new Map(items.map((x, position) => [x.id, position]));
    document.querySelector('#list').innerHTML = sortByStatus(filtered.map(x => ({ ...x, position: positions.get(x.id) }))).map(itemMarkup).join('');
  }

  // Wire status button cycling
  document.querySelectorAll('.status-button').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.status;
      const choices = /^(test-|product-|template-|wrap-)/.test(id) ? reviewCycle : standardCycle;
      const index = choices.indexOf(el.dataset.state);
      const next = choices[(index + 1) % choices.length];
      state[id] = { ...(state[id] || {}), status: next };
      save();
      render();
    };
  });

  // Wire note triggers
  document.querySelectorAll('.note-trigger, .note-preview').forEach(el => {
    el.onclick = () => {
      noteTarget = el.dataset.note;
      const existing = state[noteTarget]?.notes || '';
      document.querySelector('#note-input').value = existing;
      document.querySelector('#note-dialog .dialog-head strong').textContent = existing ? 'Edit note' : 'Add note';
      document.querySelector('#save-note').textContent = existing ? 'Save changes' : 'Save note';
      document.querySelector('#note-dialog').showModal();
    };
  });

  // Wire detail triggers
  document.querySelectorAll('.detail-trigger').forEach(el => {
    el.onclick = () => {
      const item = allItems().find(x => x.id === el.dataset.detail);
      if (!item) return;
      document.querySelector('#detail-title').textContent = item.title;
      document.querySelector('#detail-copy').textContent = item.description || '';
      document.querySelector('#detail-dialog').showModal();
    };
  });

  // Wire evidence trigger
  document.querySelectorAll('.evidence-trigger').forEach(el => {
    el.onclick = () => {
      evidenceTarget = el.dataset.evidence;
      document.querySelector('#evidence-picker').click();
    };
  });

  // Wire remove screenshot
  document.querySelectorAll('[data-remove]').forEach(el => {
    el.onclick = async () => {
      const [itemId, attachmentId] = el.dataset.remove.split(':');
      const attachments = state[itemId]?.attachments || [];
      const entry = attachments.find(a => a.id === attachmentId);
      if (entry && invoke) await invoke('remove_screenshot', { id: entry.id, extension: entry.extension });
      state[itemId] = {
        ...(state[itemId] || {}),
        attachments: attachments.filter(a => a.id !== attachmentId)
      };
      await save();
      render();
    };
  });

  // Render attachment images
  document.querySelectorAll('.attachment img').forEach(img => {
    const cacheKey = `${img.dataset.attachment}.${img.dataset.extension}`;
    if (!imageCache.has(cacheKey)) {
      imageCache.set(cacheKey, invoke ? invoke('read_screenshot', { id: img.dataset.attachment, extension: img.dataset.extension }) : Promise.resolve(''));
    }
    imageCache.get(cacheKey).then(url => {
      if (url) img.src = url;
    }).catch(() => {});
    img.onclick = () => {
      if (!img.src) return;
      const viewer = document.querySelector('#image-viewer');
      viewer.querySelector('img').src = img.src;
      viewer.querySelector('img').alt = img.alt;
      viewer.showModal();
    };
  });
}

// Clicking anywhere in the viewer, including around the image, closes it
document.querySelector('#image-viewer').onclick = event => event.currentTarget.close();

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Client switching
document.querySelector('#client-select').onchange = (e) => {
  activeClient = e.target.value;
  const col = getClientCollections()[0];
  active = col ? col.id : '';
  if (state) {
    state._settings = { ...(state._settings || {}), activeClient, activeTab: active };
    save();
  }
  render();
};

// Wire dialog close buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.onclick = (e) => {
    e.preventDefault();
    btn.closest('dialog')?.close();
  };
});

// Add Client Modal
document.querySelector('#add-client-btn').onclick = () => {
  document.querySelector('#new-client-name').value = '';
  document.querySelector('#new-client-eyebrow').value = '';
  document.querySelector('#new-client-first-tab').value = '';
  document.querySelector('#client-dialog').showModal();
};

document.querySelector('#save-client-btn').onclick = (e) => {
  e.preventDefault();
  const nameInput = document.querySelector('#new-client-name');
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  const eyebrow = document.querySelector('#new-client-eyebrow').value.trim() || `CAVEMAN CREATIVE · ${name.toUpperCase()}`;
  const firstTab = document.querySelector('#new-client-first-tab').value.trim() || 'Scope & Deliverables';
  const id = `client-${Date.now()}`;
  const newClient = {
    id,
    name,
    eyebrow,
    collections: [
      {
        id: `${id}-scope`,
        label: firstTab,
        title: `${name} — ${firstTab}`,
        kicker: eyebrow,
        kind: 'items',
        items: []
      }
    ]
  };
  clients.push(newClient);
  state._custom_clients = [...(state._custom_clients || []), newClient];
  activeClient = id;
  active = `${id}-scope`;
  state._settings = { ...(state._settings || {}), activeClient, activeTab: active };
  save();
  document.querySelector('#client-dialog').close();
  render();
};

// Add Task Modal
document.querySelector('#add-task-btn').onclick = () => {
  document.querySelector('#new-task-title').value = '';
  document.querySelector('#new-task-desc').value = '';
  document.querySelector('#task-dialog').showModal();
};

document.querySelector('#save-task-btn').onclick = (e) => {
  e.preventDefault();
  const titleInput = document.querySelector('#new-task-title');
  const title = titleInput.value.trim();
  if (!title) {
    titleInput.focus();
    return;
  }
  const description = document.querySelector('#new-task-desc').value.trim();
  const id = `custom-${Date.now()}`;
  const newTask = { id, title, description, status: 'pending', notes: '' };
  
  if (!state._custom_tasks) state._custom_tasks = {};
  if (!state._custom_tasks[active]) state._custom_tasks[active] = [];
  state._custom_tasks[active].push(newTask);
  save();
  document.querySelector('#task-dialog').close();
  render();
};

// Toolbar Search & Filters
document.querySelector('#search').oninput = () => draw(activeItems());
document.querySelector('#filter-cycle').onclick = () => {
  const order = ['all', 'pending', 'in-progress', 'done', 'blocked', 'not-checked'];
  activeFilter = order[(order.indexOf(activeFilter) + 1) % order.length];
  draw(activeItems());
};
document.querySelector('#sort-cycle').onclick = () => {
  const order = ['none', ...sortRest];
  sortFirst = order[(order.indexOf(sortFirst) + 1) % order.length];
  state._settings = { ...(state._settings || {}), sortFirst };
  save();
  draw(activeItems());
};
document.querySelector('#print').onclick = () => window.print();

// File menu: close after picking an item or clicking elsewhere.
const fileMenu = document.querySelector('#file-menu');
fileMenu.addEventListener('click', e => { if (e.target.closest('.file-menu-item')) fileMenu.open = false; });
document.addEventListener('click', e => { if (!fileMenu.contains(e.target)) fileMenu.open = false; });

// PDF export: one checklist, or every list for the client grouped by list.
// Notes and evidence screenshots are included; the file lands in Downloads.
async function exportPdf(collections, fileTag) {
  setStatusLabel('Building PDF…');
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 48;
    const textW = W - M * 2 - 24;
    let y = M;
    const ensure = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
    const ink = (r, g, b) => doc.setTextColor(r, g, b);
    const client = getCurrentClient();

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); ink(130, 130, 130);
    doc.text((client.eyebrow || client.name).toUpperCase(), M, y); y += 20;
    doc.setFontSize(20); ink(20, 20, 20);
    doc.text(collections.length === 1 ? collections[0].title : `${client.name} · All lists`, M, y); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); ink(130, 130, 130);
    doc.text(`Exported ${new Date().toLocaleString()}`, M, y); y += 24;

    for (const col of collections) {
      const items = getItemsForCollection(col);
      const done = items.filter(x => x.status === 'done').length;
      if (collections.length > 1) {
        ensure(48);
        doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 20;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14); ink(20, 20, 20);
        doc.text(col.title, M, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); ink(130, 130, 130);
        doc.text(`${done}/${items.length} done`, W - M, y, { align: 'right' }); y += 20;
      } else {
        doc.setFontSize(9); ink(130, 130, 130);
        doc.text(`${done}/${items.length} done`, M, y); y += 18;
      }
      let group = null;
      for (const item of items) {
        if (item.group && item.group !== group) {
          group = item.group;
          ensure(28);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(10); ink(90, 90, 90);
          doc.text(group.toUpperCase(), M, y + 6); y += 20;
        }
        const title = doc.setFont('helvetica', 'bold').setFontSize(11).splitTextToSize(item.title, textW - 90);
        ensure(title.length * 14 + 8);
        const isDone = item.status === 'done';
        doc.setDrawColor(90); doc.rect(M, y - 9, 10, 10);
        if (isDone) { doc.setLineWidth(1.5); doc.line(M + 2, y - 4, M + 4.5, y - 1.5); doc.line(M + 4.5, y - 1.5, M + 8.5, y - 7); doc.setLineWidth(1); }
        ink(isDone ? 110 : 20, isDone ? 110 : 20, isDone ? 110 : 20);
        doc.text(title, M + 24, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        ink(item.status === 'blocked' ? 190 : 130, item.status === 'blocked' ? 60 : 130, item.status === 'blocked' ? 40 : 130);
        doc.text(labels[item.status] || item.status, W - M, y, { align: 'right' });
        y += title.length * 14;
        if (item.notes) {
          doc.setFontSize(9.5); ink(70, 70, 70);
          for (const line of doc.splitTextToSize(item.notes, textW)) { ensure(13); doc.text(line, M + 24, y); y += 13; }
        }
        // Evidence thumbnails, four to a row.
        const shots = invoke ? item.attachments : [];
        const thumbW = (textW - 24) / 4;
        for (let i = 0; i < shots.length; i += 4) {
          const row = await Promise.all(shots.slice(i, i + 4).map(a =>
            invoke('read_screenshot', { id: a.id, extension: a.extension }).catch(() => null)));
          const sizes = await Promise.all(row.map(src => src ? new Promise(r => {
            const img = new Image(); img.onload = () => r(img.height / img.width || 0.75); img.onerror = () => r(0.75); img.src = src;
          }) : 0.75));
          const rowH = Math.min(Math.max(...sizes) * thumbW, thumbW * 1.4);
          ensure(rowH + 12);
          row.forEach((src, j) => {
            if (!src) return;
            const h = Math.min(sizes[j] * thumbW, rowH);
            const fmt = shots[i + j].extension.toLowerCase() === 'png' ? 'PNG' : 'JPEG';
            try { doc.addImage(src, fmt, M + 24 + j * (thumbW + 8), y, h / sizes[j], h); } catch { /* unsupported format */ }
          });
          y += rowH + 8;
        }
        y += 8;
      }
      y += 8;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `fieldnotes-${fileTag}-${stamp}.pdf`;
    if (invoke) {
      const data = doc.output('datauristring').split(',')[1];
      const path = await invoke('write_pdf', { fileName, dataBase64: data });
      setStatusLabel(`PDF saved to ${path.replace(/^.*\/(Downloads\/)/, '$1')}`);
    } else {
      doc.save(fileName);
      setStatusLabel('PDF saved');
    }
  } catch (error) {
    setStatusLabel(`PDF failed · ${error}`);
  }
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
document.querySelector('#pdf-list').onclick = () => {
  const collections = getClientCollections();
  const col = collections.find(x => x.id === active) || collections[0];
  if (col) exportPdf([col], `${slug(getCurrentClient().name)}-${slug(col.label)}`);
};
document.querySelector('#pdf-all').onclick = () => {
  const collections = getClientCollections();
  if (collections.length) exportPdf(collections, `${slug(getCurrentClient().name)}-all-lists`);
};

// Zoom Controls
document.querySelector('#zoom-out').onclick = () => setZoom(zoomLevel - 0.1);
document.querySelector('#zoom-in').onclick = () => setZoom(zoomLevel + 0.1);
document.querySelector('#zoom-reset').onclick = () => setZoom(1);

document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  const k = event.key;
  if (k === '-' || k === '_') {
    event.preventDefault();
    setZoom(zoomLevel - 0.1);
  } else if (k === '+' || k === '=') {
    event.preventDefault();
    setZoom(zoomLevel + 0.1);
  } else if (k === '0') {
    event.preventDefault();
    setZoom(1);
  }
});

// Trackpad pinch-to-zoom support with debounced save
let wheelZoomTimer;
window.addEventListener('wheel', event => {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    clearTimeout(wheelZoomTimer);
    const delta = event.deltaY > 0 ? -0.05 : 0.05;
    const nextLevel = Math.min(1.6, Math.max(0.7, Math.round((zoomLevel + delta) * 10) / 10));
    if (nextLevel !== zoomLevel) {
      setZoom(nextLevel, false);
      wheelZoomTimer = setTimeout(() => {
        if (state) {
          state._settings = { ...(state._settings || {}), zoom: zoomLevel };
          save();
        }
      }, 300);
    }
  }
}, { passive: false });

// Save note dialog
document.querySelector('#save-note').onclick = (e) => {
  e.preventDefault();
  if (noteTarget !== null) {
    state[noteTarget] = {
      ...(state[noteTarget] || {}),
      notes: document.querySelector('#note-input').value.trim()
    };
    save();
    render();
  }
  noteTarget = null;
  document.querySelector('#note-dialog').close();
};

// Attach Evidence
document.querySelector('#evidence-picker').onchange = async event => {
  const files = [...(event.target.files || [])];
  const itemId = evidenceTarget;
  evidenceTarget = null;
  for (const file of files) {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const record = invoke
        ? await invoke('save_screenshot_data', { name: file.name, dataUrl })
        : { id: crypto.randomUUID(), name: file.name, extension: file.name.split('.').pop().toLowerCase(), dataUrl };
      state[itemId] = {
        ...(state[itemId] || {}),
        attachments: [...(state[itemId]?.attachments || []), record]
      };
    } catch (error) {
      document.querySelector('#save-label').textContent = 'Could not attach screenshot';
    }
  }
  await save();
  render();
  event.target.value = '';
};

// Client packages: export one or all clients (definitions, progress, notes, screenshots) and import on another machine
const setStatusLabel = text => {
  const label = document.querySelector('#save-label');
  if (label) label.textContent = text;
};

async function buildClientPackage(client) {
  const isBuiltIn = baseClients.some(c => c.id === client.id);
  const collections = client.collections || [];
  const itemIds = new Set(collections.flatMap(col => getItemsForCollection(col).map(t => t.id)));
  const itemState = {};
  for (const id of itemIds) {
    if (!state[id]) continue;
    const entry = { ...state[id] };
    if (entry.attachments?.length) {
      entry.attachments = await Promise.all(entry.attachments.map(async a => ({
        name: a.name,
        extension: a.extension,
        dataUrl: a.dataUrl || (invoke ? await invoke('read_screenshot', { id: a.id, extension: a.extension }) : '')
      })));
    }
    itemState[id] = entry;
  }
  const customTasks = {};
  for (const col of collections) {
    if (state._custom_tasks?.[col.id]?.length) customTasks[col.id] = state._custom_tasks[col.id];
  }
  return { id: client.id, builtIn: isBuiltIn, client: isBuiltIn ? null : client, itemState, customTasks };
}

async function exportClients(list, fileTag) {
  setStatusLabel('Exporting…');
  try {
    const packages = [];
    for (const c of list) packages.push(await buildClientPackage(c));
    const contents = JSON.stringify({ format: 'fieldnotes-clients', version: 3, exportedAt: new Date().toISOString(), clients: packages }, null, 2);
    const fileName = `fieldnotes-${fileTag}-${new Date().toISOString().slice(0, 10)}.json`;
    if (invoke) {
      const path = await invoke('write_export', { fileName, contents });
      setStatusLabel(`Exported to ${path.replace(/^.*\/(Downloads\/)/, '$1')}`);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatusLabel('Exported');
    }
  } catch (error) {
    setStatusLabel(`Export failed · ${error}`);
  }
}

async function importPackage(data) {
  // Older full backups only carry checklist state; screenshots from them won't exist on a new machine
  if (data?.format === 'fieldnotes-client-checklists' && data.state) {
    const { _settings, ...rest } = data.state;
    Object.assign(state, rest);
    for (const c of rest._custom_clients || []) if (!clients.some(x => x.id === c.id)) clients.push(c);
    return 'backup';
  }
  if (data?.format !== 'fieldnotes-clients' || !Array.isArray(data.clients)) throw new Error('Not a Fieldnotes export');
  const names = [];
  for (const pkg of data.clients) {
    if (!pkg.builtIn && pkg.client) {
      clients = clients.filter(c => c.id !== pkg.client.id);
      clients.push(pkg.client);
      state._custom_clients = [...(state._custom_clients || []).filter(c => c.id !== pkg.client.id), pkg.client];
    } else if (!clients.some(c => c.id === pkg.id)) {
      continue;
    }
    for (const [colId, tasks] of Object.entries(pkg.customTasks || {})) {
      const ids = new Set(tasks.map(t => t.id));
      state._custom_tasks = state._custom_tasks || {};
      state._custom_tasks[colId] = [...(state._custom_tasks[colId] || []).filter(t => !ids.has(t.id)), ...tasks];
    }
    for (const [itemId, entry] of Object.entries(pkg.itemState || {})) {
      for (const old of state[itemId]?.attachments || []) {
        if (invoke && old.id) await invoke('remove_screenshot', { id: old.id, extension: old.extension }).catch(() => {});
      }
      const attachments = [];
      for (const a of entry.attachments || []) {
        if (!a.dataUrl) continue;
        attachments.push(invoke
          ? await invoke('save_screenshot_data', { name: a.name || `screenshot.${a.extension}`, dataUrl: a.dataUrl })
          : { id: crypto.randomUUID(), name: a.name, extension: a.extension, dataUrl: a.dataUrl });
      }
      state[itemId] = { ...entry, attachments };
    }
    names.push(clients.find(c => c.id === pkg.id)?.name || pkg.id);
  }
  return names.join(', ');
}

document.querySelector('#export').onclick = () => exportClients([getCurrentClient()], getCurrentClient().name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
document.querySelector('#export-all').onclick = () => exportClients(clients, 'all-clients');
document.querySelector('#import').onclick = () => document.querySelector('#import-picker').click();
document.querySelector('#import-picker').onchange = async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  setStatusLabel('Importing…');
  try {
    const imported = await importPackage(JSON.parse(await file.text()));
    imageCache.clear();
    await save();
    render();
    setStatusLabel(imported ? `Imported ${imported}` : 'Nothing to import');
  } catch (error) {
    setStatusLabel(`Import failed · ${error.message || error}`);
  }
};

// Initialization
async function init() {
  try {
    state = invoke ? await invoke('load_state') : JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    state = {};
  }

  // Restore custom clients if any
  if (state._custom_clients && Array.isArray(state._custom_clients)) {
    for (const c of state._custom_clients) {
      if (!clients.some(x => x.id === c.id)) clients.push(c);
    }
  }

  // Restore active client & tab
  if (['none', ...sortRest].includes(state._settings?.sortFirst)) sortFirst = state._settings.sortFirst;
  if (state._settings?.activeClient && clients.some(c => c.id === state._settings.activeClient)) {
    activeClient = state._settings.activeClient;
  }
  const currentCollections = getClientCollections();
  if (state._settings?.activeTab && currentCollections.some(c => c.id === state._settings.activeTab)) {
    active = state._settings.activeTab;
  } else if (currentCollections.length) {
    active = currentCollections[0].id;
  }

  // Restore zoom level
  if (state._settings && typeof state._settings.zoom === 'number') {
    zoomLevel = state._settings.zoom;
  } else {
    const storedZoom = Number(localStorage.getItem(zoomKey));
    if (storedZoom) zoomLevel = storedZoom;
  }
  await setZoom(zoomLevel, false);

  if (!state._settings) {
    state._settings = { zoom: zoomLevel, activeClient, activeTab: active };
    save();
  }

  render();

  // Tauri drag-drop handler for screenshots
  if (tauri?.webview?.getCurrentWebview) {
    await tauri.webview.getCurrentWebview().onDragDropEvent(async event => {
      const payload = event.payload;
      if (payload.type === 'leave') {
        document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        return;
      }
      const x = payload.position.x / window.devicePixelRatio;
      const y = payload.position.y / window.devicePixelRatio;
      const target = document.elementFromPoint(x, y)?.closest('[data-item-id]');
      document.querySelectorAll('.drop-target').forEach(el => el.classList.toggle('drop-target', el === target));
      if (payload.type === 'drop') {
        document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        if (!target) return;
        const itemId = target.dataset.itemId;
        for (const sourcePath of payload.paths) {
          try {
            const attachment = await invoke('import_screenshot', { sourcePath });
            state[itemId] = {
              ...(state[itemId] || {}),
              attachments: [...(state[itemId]?.attachments || []), attachment]
            };
          } catch {
            document.querySelector('#save-label').textContent = 'Screenshot not added · use PNG, JPG, GIF or WebP under 25 MB';
          }
        }
        await save();
        render();
      }
    });
  }
}

init();
