import init, {
  list_zip_entries,
  extract_zip_entry,
  rdf_clear,
  rdf_load_xml,
  rdf_triple_count,
  rdf_query,
} from './pkg/rust_wasm_zip.js';

// ══════════════════════════════════════════
// Config
// ══════════════════════════════════════════

const API_HOST = 'https://cgmes-replay.azurewebsites.net';
const LS_KEY = 'cim-api-key';

// The base path the API returns in file paths — stripped so paths are relative to the CGMES root folder.
const FILE_BASE_PATH = '\\\\fs61\\driftdata\\Drift\\Arkiv\\CGMES\\';

// ══════════════════════════════════════════
// State
// ══════════════════════════════════════════

let fetchedScenarios = [];
let cgmesRootHandle = null;   // Source folder (File System Access API)
let destFolderHandle = null;  // Destination folder for exports
let loadedScenarioLabel = null;
let lastQueryResult = null;   // For CSV export

// ══════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════

function filterScenarioTypes(types) {
  return types.filter((t) => !t.startsWith('-'));
}

function getApiKey() {
  return apiKeyInput.value;
}

async function apiFetch(path, params = {}) {
  const url = new URL(path, API_HOST);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-API-KEY': getApiKey(),
    },
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

function toLocalISOString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Strip the base path prefix from a file path returned by the API,
 * normalising backslashes to forward slashes so it works with File System Access API.
 */
function stripBasePath(filePath) {
  let p = filePath.replace(/\\/g, '/');
  const base = FILE_BASE_PATH.replace(/\\/g, '/');
  if (p.startsWith(base)) p = p.slice(base.length);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

// ══════════════════════════════════════════
// File System Access helpers
// ══════════════════════════════════════════

async function walkPath(root, relativePath) {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  let dir = root;
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg);
  }
  return dir;
}

async function getFileByPath(root, relativePath) {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const fileName = parts.pop();
  const dir = parts.length > 0 ? await walkPath(root, parts.join('/')) : root;
  return dir.getFileHandle(fileName);
}

async function unzipAndLoadToGraph(fileHandle, zipPath) {
  const file = await fileHandle.getFile();
  const zipBytes = new Uint8Array(await file.arrayBuffer());

  const entries = list_zip_entries(zipBytes);
  if (!entries) return { xmlCount: 0, error: `Invalid zip: ${zipPath}` };

  let xmlCount = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.isDir || !entry.name.toLowerCase().endsWith('.xml')) continue;
    const extracted = extract_zip_entry(zipBytes, i);
    if (!extracted) continue;
    rdf_load_xml(new Uint8Array(extracted.bytes), `http://cim/${extracted.name}`);
    xmlCount++;
  }
  return { xmlCount };
}

// ══════════════════════════════════════════
// Predefined SPARQL queries
// ══════════════════════════════════════════

const PREDEFINED_QUERIES = [
  {
    name: 'List all RDF types',
    query: `SELECT ?type (COUNT(?s) AS ?count)
WHERE {
  ?s a ?type .
}
GROUP BY ?type
ORDER BY DESC(?count)
LIMIT 50`,
  },
  {
    name: 'All Substations',
    query: `PREFIX cim: <http://iec.ch/TC57/2013/CIM-schema-cim16#>
SELECT ?substation ?name
WHERE {
  ?substation a cim:Substation .
  ?substation cim:IdentifiedObject.name ?name .
}
ORDER BY ?name
LIMIT 100`,
  },
  {
    name: 'Voltage Levels',
    query: `PREFIX cim: <http://iec.ch/TC57/2013/CIM-schema-cim16#>
SELECT ?vl ?name ?subName
WHERE {
  ?vl a cim:VoltageLevel .
  ?vl cim:IdentifiedObject.name ?name .
  OPTIONAL {
    ?vl cim:VoltageLevel.Substation ?sub .
    ?sub cim:IdentifiedObject.name ?subName .
  }
}
ORDER BY ?name
LIMIT 100`,
  },
];

// ══════════════════════════════════════════
// DOM refs
// ══════════════════════════════════════════

const btnSettings = document.getElementById('btn-settings');
const settingsDrawer = document.getElementById('settings-drawer');
const btnCloseSettings = document.getElementById('btn-close-settings');
const apiKeyInput = document.getElementById('api-key');
const btnSaveKey = document.getElementById('btn-save-key');
const settingsStatus = document.getElementById('settings-status');
const btnPickSource = document.getElementById('btn-pick-source');
const sourceFolderLabel = document.getElementById('source-folder-label');
const btnPickDest = document.getElementById('btn-pick-dest');
const destFolderLabel = document.getElementById('dest-folder-label');

const layoutEl = document.getElementById('layout');
const btnExpandLeft = document.getElementById('btn-expand-left');
const btnRestoreLeft = document.getElementById('btn-restore-left');
const btnExpandRight = document.getElementById('btn-expand-right');
const btnRestoreRight = document.getElementById('btn-restore-right');
const topbarLoaded = document.getElementById('topbar-loaded');
const loadedBadge = document.getElementById('loaded-badge');

const dateFrom = document.getElementById('date-from');
const dateTo = document.getElementById('date-to');
const scenarioTypeSelect = document.getElementById('scenario-type-select');
const takeInput = document.getElementById('take-input');
const btnFetchScenarios = document.getElementById('btn-fetch-scenarios');
const scenarioTableWrap = document.getElementById('scenario-table-wrap');
const scenarioResultsInfo = document.getElementById('scenario-results-info');
const scenarioTableBody = document.getElementById('scenario-table-body');

const loadDetail = document.getElementById('load-detail');
const cimFileList = document.getElementById('cim-file-list');
const cimProgressFill = document.getElementById('cim-progress-fill');
const cimProgressText = document.getElementById('cim-progress-text');

const querySelect = document.getElementById('query-select');
const queryInput = document.getElementById('query-input');
const btnRunQuery = document.getElementById('btn-run-query');
const queryResult = document.getElementById('query-result');
const btnExportCsv = document.getElementById('btn-export-csv');

let backdrop = null;

// ══════════════════════════════════════════
// Init
// ══════════════════════════════════════════

await init();

// Restore API key
const savedKey = localStorage.getItem(LS_KEY);
if (savedKey) apiKeyInput.value = savedKey;

// Default dates (last 24h)
const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
dateFrom.value = toLocalISOString(yesterday);
dateTo.value = toLocalISOString(now);

// Populate predefined queries
PREDEFINED_QUERIES.forEach((q, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = q.name;
  querySelect.appendChild(opt);
});

querySelect.addEventListener('change', () => {
  const idx = querySelect.value;
  if (idx !== '') queryInput.value = PREDEFINED_QUERIES[idx].query;
});

// Auto-load scenario types if key exists
if (savedKey) loadScenarioTypes();

// Open settings on first visit
if (!savedKey) setTimeout(openSettings, 300);

// ══════════════════════════════════════════
// Settings drawer
// ══════════════════════════════════════════

function openSettings() {
  settingsDrawer.hidden = false;
  requestAnimationFrame(() => settingsDrawer.classList.add('open'));
  backdrop = document.createElement('div');
  backdrop.className = 'settings-backdrop';
  backdrop.addEventListener('click', closeSettings);
  document.body.appendChild(backdrop);
}

function closeSettings() {
  settingsDrawer.classList.remove('open');
  setTimeout(() => { settingsDrawer.hidden = true; }, 200);
  if (backdrop) { backdrop.remove(); backdrop = null; }
}

btnSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);

// Save API key
btnSaveKey.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    localStorage.setItem(LS_KEY, key);
    settingsStatus.textContent = 'Key saved.';
    loadScenarioTypes();
    setTimeout(closeSettings, 600);
  } else {
    localStorage.removeItem(LS_KEY);
    settingsStatus.textContent = 'Key cleared.';
  }
});

// Source folder picker
btnPickSource.addEventListener('click', async () => {
  try {
    cgmesRootHandle = await window.showDirectoryPicker({ mode: 'read' });
    sourceFolderLabel.textContent = cgmesRootHandle.name;
  } catch {
    // cancelled
  }
});

// Destination folder picker
btnPickDest.addEventListener('click', async () => {
  try {
    destFolderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    destFolderLabel.textContent = destFolderHandle.name;
  } catch {
    // cancelled
  }
});

// ══════════════════════════════════════════
// Panel collapse / expand
// ══════════════════════════════════════════

function setView(view) {
  layoutEl.dataset.view = view;

  btnExpandLeft.hidden = view !== 'both';
  btnRestoreLeft.hidden = view !== 'left';
  btnExpandRight.hidden = view !== 'both';
  btnRestoreRight.hidden = view !== 'right';
}

btnExpandLeft.addEventListener('click', () => setView('left'));
btnRestoreLeft.addEventListener('click', () => setView('both'));
btnExpandRight.addEventListener('click', () => setView('right'));
btnRestoreRight.addEventListener('click', () => setView('both'));

// ══════════════════════════════════════════
// Load scenario types
// ══════════════════════════════════════════

async function loadScenarioTypes() {
  try {
    const types = await apiFetch('/scenario/scenario');
    const filtered = filterScenarioTypes(types);
    scenarioTypeSelect.innerHTML = '<option value="">All</option>';
    for (const t of filtered) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      scenarioTypeSelect.appendChild(opt);
    }
  } catch {
    // Silently fail
  }
}

// ══════════════════════════════════════════
// Fetch scenarios — one row per scenario+time
// ══════════════════════════════════════════

btnFetchScenarios.addEventListener('click', async () => {
  if (!getApiKey()) { openSettings(); return; }

  try {
    btnFetchScenarios.disabled = true;
    btnFetchScenarios.textContent = 'Fetching...';

    const params = {};
    if (dateFrom.value) params.startDate = new Date(dateFrom.value).toISOString();
    if (dateTo.value) params.endDate = new Date(dateTo.value).toISOString();
    if (scenarioTypeSelect.value) params.scenario = scenarioTypeSelect.value;
    if (takeInput.value) params.take = takeInput.value;

    fetchedScenarios = await apiFetch('/scenario/page', params);

    renderScenarioTable();
  } catch (e) {
    alert(`Failed to fetch scenarios: ${e.message}`);
  } finally {
    btnFetchScenarios.disabled = false;
    btnFetchScenarios.textContent = 'Fetch Scenarios';
  }
});

function renderScenarioTable() {
  scenarioTableBody.innerHTML = '';

  for (const item of fetchedScenarios) {
    const tr = document.createElement('tr');

    // Time
    const tdTime = document.createElement('td');
    tdTime.className = 'cell-time';
    tdTime.textContent = formatTime(item.scenarioTime);
    tr.appendChild(tdTime);

    // Type
    const tdType = document.createElement('td');
    tdType.className = 'cell-type';
    tdType.textContent = item.scenario;
    tr.appendChild(tdType);

    // Load button
    const tdAction = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'btn-load-row';
    btn.textContent = 'Load';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadScenario(item.scenarioTime, item.scenario, tr);
    });
    tdAction.appendChild(btn);
    tr.appendChild(tdAction);

    tr.addEventListener('click', () => loadScenario(item.scenarioTime, item.scenario, tr));

    scenarioTableBody.appendChild(tr);
  }

  scenarioTableWrap.hidden = false;
  scenarioResultsInfo.textContent = `${fetchedScenarios.length} scenario(s)`;
}

// ══════════════════════════════════════════
// Load a single scenario into the RDF graph
// ══════════════════════════════════════════

async function loadScenario(scenarioTime, scenario, clickedRow) {
  // Need source folder
  if (!cgmesRootHandle) {
    alert('Please select the CGMES source folder in Settings first.');
    openSettings();
    return;
  }

  // Highlight row
  scenarioTableBody.querySelectorAll('tr').forEach((r) => r.classList.remove('loaded'));
  clickedRow.classList.add('loaded');

  const label = `${scenario} @ ${formatTime(scenarioTime)}`;

  // Show progress
  loadDetail.hidden = false;
  cimProgressFill.style.width = '0%';
  cimProgressText.textContent = `Fetching file list for ${label}...`;
  cimFileList.innerHTML = '';

  try {
    // Fetch the file list: GET /scenario/{scenarioTime}/{scenario}
    const files = await apiFetch(`/scenario/${encodeURIComponent(scenarioTime)}/${encodeURIComponent(scenario)}`);

    // files should be an array of file path strings
    const relativePaths = files.map(stripBasePath);

    // Show file list
    const ul = document.createElement('ul');
    for (const p of relativePaths) {
      const li = document.createElement('li');
      li.textContent = p;
      ul.appendChild(li);
    }
    cimFileList.innerHTML = '';
    cimFileList.appendChild(ul);

    // Clear graph before loading
    rdf_clear();

    let loaded = 0;
    let totalXml = 0;
    const errors = [];

    for (let i = 0; i < relativePaths.length; i++) {
      const zipPath = relativePaths[i];
      const zipName = zipPath.split('/').pop();
      cimProgressText.textContent = `[${i + 1}/${relativePaths.length}] Loading ${zipName}...`;
      cimProgressFill.style.width = `${Math.round((i / relativePaths.length) * 100)}%`;

      try {
        const fileHandle = await getFileByPath(cgmesRootHandle, zipPath);
        const result = await unzipAndLoadToGraph(fileHandle, zipPath);
        totalXml += result.xmlCount;
        if (result.error) errors.push(result.error);
        else loaded++;
      } catch (e) {
        errors.push(`${zipName}: ${e.message || e}`);
      }
    }

    const tripleCount = rdf_triple_count();
    cimProgressFill.style.width = '100%';

    const summary = `${loaded}/${relativePaths.length} zips, ${totalXml} XML files, ${tripleCount.toLocaleString()} triples`;
    cimProgressText.textContent = errors.length
      ? `${summary} | ${errors.length} error(s): ${errors.join('; ')}`
      : `${summary} — Ready for queries.`;

    // Update loaded badge everywhere
    loadedScenarioLabel = `${label} — ${tripleCount.toLocaleString()} triples`;
    topbarLoaded.textContent = label;
    topbarLoaded.hidden = false;
    loadedBadge.textContent = label;
    loadedBadge.hidden = false;
    btnRunQuery.disabled = false;

    // Auto-switch to query panel
    setView('right');
  } catch (e) {
    cimProgressText.textContent = `Error: ${e.message}`;
    cimProgressFill.style.width = '0%';
  }
}

// ══════════════════════════════════════════
// SPARQL query execution
// ══════════════════════════════════════════

btnRunQuery.addEventListener('click', () => {
  const sparql = queryInput.value.trim();
  if (!sparql) return;

  queryResult.innerHTML = '';
  lastQueryResult = null;
  btnExportCsv.hidden = true;

  try {
    const t0 = performance.now();
    const result = rdf_query(sparql);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

    if (!result || !result.columns) {
      queryResult.innerHTML = '<p class="error">No results returned.</p>';
      return;
    }

    lastQueryResult = result;

    const info = document.createElement('p');
    info.className = 'result-info';
    info.textContent = `${result.rows.length} row(s) in ${elapsed}s`;
    queryResult.appendChild(info);

    if (result.rows.length === 0) return;

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of result.columns) {
      const th = document.createElement('th');
      th.textContent = col;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of result.rows) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    queryResult.appendChild(table);

    btnExportCsv.hidden = false;
  } catch (e) {
    queryResult.innerHTML = `<p class="error">${e}</p>`;
  }
});

// ══════════════════════════════════════════
// Export CSV
// ══════════════════════════════════════════

btnExportCsv.addEventListener('click', async () => {
  if (!lastQueryResult) return;

  const { columns, rows } = lastQueryResult;

  // Build CSV
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });

  if (destFolderHandle) {
    // Save to destination folder
    const name = `query-${Date.now()}.csv`;
    try {
      const fh = await destFolderHandle.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(blob);
      await writable.close();
      alert(`Saved ${name} to ${destFolderHandle.name}`);
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    }
  } else {
    // Fallback: browser download
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `query-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
});
