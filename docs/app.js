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

// Base path the API returns in file paths.
// Stripped so paths become relative to the CGMES root folder picked via File System Access API.
const FILE_BASE_PATH = '//fs61.si.energinet.local/DriftData/Drift/Arkiv/CGMES/';

// ══════════════════════════════════════════
// State
// ══════════════════════════════════════════

let fetchedScenarios = [];
let cgmesRootHandle = null;
let destFolderHandle = null;
let loadedScenarioLabel = null;
let lastQueryResult = null;

// ══════════════════════════════════════════
// Console — global debug log
// ══════════════════════════════════════════

const consoleLog = document.getElementById('console-log');
const consoleSummary = document.getElementById('console-summary');
const consoleProgressFill = document.getElementById('console-progress-fill');
const btnClearConsole = document.getElementById('btn-clear-console');
const btnToggleConsole = document.getElementById('btn-toggle-console');
const consolePanel = document.getElementById('console-panel');

function logTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function log(msg, cls = '') {
  const span = document.createElement('span');
  span.className = `log-line${cls ? ` ${cls}` : ''}`;
  const ts = document.createElement('span');
  ts.className = 'log-ts';
  ts.textContent = `[${logTs()}]`;
  span.appendChild(ts);
  span.appendChild(document.createTextNode(msg));
  consoleLog.appendChild(span);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

function setProgress(fraction, summaryText) {
  consoleProgressFill.style.width = `${Math.round(fraction * 100)}%`;
  if (summaryText) consoleSummary.textContent = summaryText;
}

btnClearConsole.addEventListener('click', (e) => {
  e.stopPropagation();
  consoleLog.innerHTML = '';
  consoleSummary.textContent = '';
  consoleProgressFill.style.width = '0%';
});

btnToggleConsole.addEventListener('click', (e) => {
  e.stopPropagation();
  consolePanel.classList.toggle('collapsed');
  btnToggleConsole.innerHTML = consolePanel.classList.contains('collapsed') ? '&#9660;' : '&#9650;';
});

// Click header to toggle too
document.querySelector('.console-header').addEventListener('click', () => {
  consolePanel.classList.toggle('collapsed');
  btnToggleConsole.innerHTML = consolePanel.classList.contains('collapsed') ? '&#9660;' : '&#9650;';
});

// ══════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════

function filterScenarioTypes(types) {
  return types.filter((t) => !t.startsWith('-'));
}

function getApiKey() {
  return apiKeyInput.value;
}

/**
 * Fetch from the API. Logs the request and response to the console.
 */
async function apiFetch(path, params = {}) {
  const url = new URL(path, API_HOST);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }

  log(`GET ${url.pathname}${url.search}`, 'log-http');

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-API-KEY': getApiKey(),
    },
  });

  if (!res.ok) {
    log(`HTTP ${res.status} ${res.statusText}`, 'log-err');
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  const count = Array.isArray(data) ? `${data.length} items` : 'object';
  log(`HTTP 200 — ${count}`, 'log-ok');

  return data;
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
 * Strip the base path from API-returned file paths.
 * Normalises all slashes to forward slashes and is case-insensitive on the prefix.
 */
/**
 * Given a list of file paths, deduplicate by keeping only the highest version.
 * Version is the _NNN.zip suffix, e.g. _001.zip, _002.zip.
 * Files that share the same base (everything before _NNN.zip) are grouped,
 * and only the one with the highest version number is kept.
 */
function deduplicateVersions(files) {
  const groups = new Map(); // baseKey -> { version, path }
  for (const f of files) {
    const match = f.match(/^(.+?)_(\d+)\.zip$/i);
    if (!match) {
      // No version pattern — keep as-is
      groups.set(f, { version: -1, path: f });
      continue;
    }
    const [, base, verStr] = match;
    const ver = parseInt(verStr, 10);
    const existing = groups.get(base);
    if (!existing || ver > existing.version) {
      groups.set(base, { version: ver, path: f });
    }
  }
  return [...groups.values()].map((g) => g.path);
}

function stripBasePath(filePath) {
  let p = filePath.replace(/\\/g, '/');
  const base = FILE_BASE_PATH.replace(/\\/g, '/');

  // Case-insensitive prefix match
  if (p.toLowerCase().startsWith(base.toLowerCase())) {
    p = p.slice(base.length);
  }

  // Also try without the leading //
  const baseNoSlash = base.replace(/^\/\//, '');
  if (p.toLowerCase().startsWith(baseNoSlash.toLowerCase())) {
    p = p.slice(baseNoSlash.length);
  }

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

const querySelect = document.getElementById('query-select');
const queryInput = document.getElementById('query-input');
const btnRunQuery = document.getElementById('btn-run-query');
const queryResult = document.getElementById('query-result');
const btnExportCsv = document.getElementById('btn-export-csv');

let backdrop = null;

// ══════════════════════════════════════════
// Init
// ══════════════════════════════════════════

log('Initializing WASM...', 'log-step');
await init();
log('WASM ready', 'log-ok');

// Restore API key
const savedKey = localStorage.getItem(LS_KEY);
if (savedKey) {
  apiKeyInput.value = savedKey;
  log('API key restored from localStorage', 'log-info');
}

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

log(`Base path for stripping: ${FILE_BASE_PATH}`, 'log-info');
log('Ready.', 'log-done');

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

btnSaveKey.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    localStorage.setItem(LS_KEY, key);
    settingsStatus.textContent = 'Key saved.';
    log('API key saved to localStorage', 'log-ok');
    loadScenarioTypes();
    setTimeout(closeSettings, 600);
  } else {
    localStorage.removeItem(LS_KEY);
    settingsStatus.textContent = 'Key cleared.';
    log('API key cleared', 'log-info');
  }
});

btnPickSource.addEventListener('click', async () => {
  try {
    cgmesRootHandle = await window.showDirectoryPicker({ mode: 'read' });
    sourceFolderLabel.textContent = cgmesRootHandle.name;
    log(`Source folder selected: ${cgmesRootHandle.name}`, 'log-ok');
  } catch {
    log('Source folder selection cancelled', 'log-info');
  }
});

btnPickDest.addEventListener('click', async () => {
  try {
    destFolderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    destFolderLabel.textContent = destFolderHandle.name;
    log(`Destination folder selected: ${destFolderHandle.name}`, 'log-ok');
  } catch {
    log('Destination folder selection cancelled', 'log-info');
  }
});

// ══════════════════════════════════════════
// Panel collapse / expand
// ══════════════════════════════════════════

const panelLeft = document.getElementById('panel-left');
const panelRight = document.getElementById('panel-right');

function setView(view) {
  layoutEl.dataset.view = view;

  // Toggle collapsed bookmark state
  panelLeft.classList.toggle('panel-collapsed', view === 'right');
  panelRight.classList.toggle('panel-collapsed', view === 'left');

  // Show expand button only in split view, restore button only when maximized
  btnExpandLeft.hidden = view !== 'both';
  btnRestoreLeft.hidden = view !== 'left';
  btnExpandRight.hidden = view !== 'both';
  btnRestoreRight.hidden = view !== 'right';
}

btnExpandLeft.addEventListener('click', () => setView('left'));
btnRestoreLeft.addEventListener('click', () => setView('both'));
btnExpandRight.addEventListener('click', () => setView('right'));
btnRestoreRight.addEventListener('click', () => setView('both'));

// Click bookmark tab to restore split view
panelLeft.addEventListener('click', (e) => {
  if (panelLeft.classList.contains('panel-collapsed')) {
    e.stopPropagation();
    setView('both');
  }
});
panelRight.addEventListener('click', (e) => {
  if (panelRight.classList.contains('panel-collapsed')) {
    e.stopPropagation();
    setView('both');
  }
});

// ══════════════════════════════════════════
// Load scenario types
// ══════════════════════════════════════════

async function loadScenarioTypes() {
  try {
    log('Loading scenario types...', 'log-step');
    const types = await apiFetch('/scenario/scenario');
    const filtered = filterScenarioTypes(types);
    scenarioTypeSelect.innerHTML = '<option value="">All</option>';
    for (const t of filtered) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      scenarioTypeSelect.appendChild(opt);
    }
    log(`${filtered.length} scenario types loaded (${types.length - filtered.length} negative values filtered)`, 'log-ok');
  } catch (e) {
    log(`Failed to load types: ${e.message}`, 'log-err');
  }
}

// ══════════════════════════════════════════
// Fetch scenarios
// ══════════════════════════════════════════

btnFetchScenarios.addEventListener('click', async () => {
  if (!getApiKey()) { openSettings(); return; }

  try {
    btnFetchScenarios.disabled = true;
    btnFetchScenarios.textContent = 'Fetching...';

    log('Fetching scenarios...', 'log-step');

    const params = {};
    if (dateFrom.value) params.startDate = new Date(dateFrom.value).toISOString();
    if (dateTo.value) params.endDate = new Date(dateTo.value).toISOString();
    if (scenarioTypeSelect.value) params.scenario = scenarioTypeSelect.value;
    if (takeInput.value) params.take = takeInput.value;

    fetchedScenarios = await apiFetch('/scenario/page', params);

    log(`${fetchedScenarios.length} scenario(s) returned`, 'log-ok');
    renderScenarioTable();
  } catch (e) {
    log(`Fetch failed: ${e.message}`, 'log-err');
  } finally {
    btnFetchScenarios.disabled = false;
    btnFetchScenarios.textContent = 'Fetch Scenarios';
  }
});

function renderScenarioTable() {
  scenarioTableBody.innerHTML = '';

  for (const item of fetchedScenarios) {
    const tr = document.createElement('tr');

    const tdTime = document.createElement('td');
    tdTime.className = 'cell-time';
    tdTime.textContent = formatTime(item.scenarioTime);
    tr.appendChild(tdTime);

    const tdType = document.createElement('td');
    tdType.className = 'cell-type';
    tdType.textContent = item.scenario;
    tr.appendChild(tdType);

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
  if (!cgmesRootHandle) {
    log('No source folder selected — opening settings', 'log-err');
    openSettings();
    return;
  }

  // Ensure console is open
  consolePanel.classList.remove('collapsed');
  btnToggleConsole.innerHTML = '&#9650;';

  // Highlight row
  scenarioTableBody.querySelectorAll('tr').forEach((r) => r.classList.remove('loaded'));
  clickedRow.classList.add('loaded');

  const label = `${scenario} @ ${formatTime(scenarioTime)}`;

  log('', '');
  log(`════ Loading scenario: ${label} ════`, 'log-info');
  setProgress(0, `Loading ${label}...`);

  try {
    // 1. Fetch file list from API
    log(`Fetching file list for ${scenario} at ${scenarioTime}...`, 'log-step');
    const files = await apiFetch(`/scenario/${encodeURIComponent(scenarioTime)}/${encodeURIComponent(scenario)}`);

    log(`API returned ${files.length} file path(s)`, 'log-data');

    // 2. Deduplicate — keep only highest version per file
    const deduplicated = deduplicateVersions(files);
    if (deduplicated.length < files.length) {
      log(`Deduplicated: ${files.length} → ${deduplicated.length} (kept highest versions only)`, 'log-info');
    }

    // 3. Strip base path
    const relativePaths = deduplicated.map(stripBasePath);
    log(`After stripping base path "${FILE_BASE_PATH}":`, 'log-info');
    for (const p of relativePaths) {
      log(`  rel: ${p}`, 'log-info');
    }

    // 4. Clear graph
    log('Clearing RDF graph...', 'log-step');
    rdf_clear();
    log('Graph cleared', 'log-ok');

    // 5. Load each file
    let loaded = 0;
    let totalXml = 0;
    let totalTriples = 0;
    const errors = [];
    const total = relativePaths.length;

    for (let i = 0; i < total; i++) {
      const zipPath = relativePaths[i];
      const zipName = zipPath.split('/').pop();
      const step = `[${i + 1}/${total}]`;

      setProgress(i / total, `${step} ${zipName}`);
      log(`${step} Opening ${zipPath}...`, 'log-step');

      // 4a. Locate file on disk
      let fileHandle;
      try {
        fileHandle = await getFileByPath(cgmesRootHandle, zipPath);
        log(`  Found on disk`, 'log-ok');
      } catch (e) {
        const msg = `${zipPath}: ${e.message || e}`;
        log(`  ERROR finding file: ${msg}`, 'log-err');
        errors.push(msg);
        continue;
      }

      // 4b. Read bytes
      const file = await fileHandle.getFile();
      const zipBytes = new Uint8Array(await file.arrayBuffer());
      const sizeMB = (zipBytes.byteLength / 1024 / 1024).toFixed(2);
      log(`  Read ${sizeMB} MB (${zipBytes.byteLength.toLocaleString()} bytes)`, 'log-ok');

      // 4c. List zip entries
      const entries = list_zip_entries(zipBytes);
      if (!entries) {
        log(`  ERROR: not a valid zip`, 'log-err');
        errors.push(`${zipName}: invalid zip`);
        continue;
      }

      const xmlEntries = entries.filter((e) => !e.isDir && e.name.toLowerCase().endsWith('.xml'));
      log(`  Zip has ${entries.length} entries, ${xmlEntries.length} XML file(s)`, 'log-step');

      // 4d. Extract XML and load into RDF
      let zipXmlCount = 0;
      for (let j = 0; j < entries.length; j++) {
        const entry = entries[j];
        if (entry.isDir || !entry.name.toLowerCase().endsWith('.xml')) continue;

        const extracted = extract_zip_entry(zipBytes, j);
        if (!extracted) {
          log(`  SKIP: could not extract ${entry.name}`, 'log-err');
          continue;
        }

        rdf_load_xml(new Uint8Array(extracted.bytes), `http://cim/${extracted.name}`);
        zipXmlCount++;
      }

      totalXml += zipXmlCount;
      loaded++;

      const triplesNow = rdf_triple_count();
      const newTriples = triplesNow - totalTriples;
      totalTriples = triplesNow;
      log(`  Loaded ${zipXmlCount} XML, +${newTriples.toLocaleString()} triples (total: ${triplesNow.toLocaleString()})`, 'log-ok');
    }

    // 5. Done
    setProgress(1, 'Done');
    const tripleCount = rdf_triple_count();

    log('', '');
    if (errors.length) {
      log(`Completed with ${errors.length} error(s):`, 'log-err');
      for (const e of errors) log(`  ${e}`, 'log-err');
    }
    log(`${loaded}/${total} zips loaded, ${totalXml} XML files, ${tripleCount.toLocaleString()} triples`, 'log-done');
    log('Ready for queries.', 'log-done');

    consoleSummary.textContent = `${loaded}/${total} zips | ${totalXml} XML | ${tripleCount.toLocaleString()} triples`;

    loadedScenarioLabel = `${label} — ${tripleCount.toLocaleString()} triples`;
    topbarLoaded.textContent = label;
    topbarLoaded.hidden = false;
    loadedBadge.textContent = label;
    loadedBadge.hidden = false;
    btnRunQuery.disabled = false;

    setView('right');
  } catch (e) {
    log(`FATAL: ${e.message}`, 'log-err');
    setProgress(0, `Error: ${e.message}`);
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

  log('', '');
  log('Running SPARQL query...', 'log-step');
  log(sparql, 'log-data');

  try {
    const t0 = performance.now();
    const result = rdf_query(sparql);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

    if (!result || !result.columns) {
      log('No results returned', 'log-err');
      queryResult.innerHTML = '<p class="error">No results returned.</p>';
      return;
    }

    log(`${result.rows.length} row(s) in ${elapsed}s`, 'log-ok');

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
    log(`Query error: ${e}`, 'log-err');
    queryResult.innerHTML = `<p class="error">${e}</p>`;
  }
});

// ══════════════════════════════════════════
// Export CSV
// ══════════════════════════════════════════

btnExportCsv.addEventListener('click', async () => {
  if (!lastQueryResult) return;

  const { columns, rows } = lastQueryResult;
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });

  if (destFolderHandle) {
    const name = `query-${Date.now()}.csv`;
    try {
      const fh = await destFolderHandle.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(blob);
      await writable.close();
      log(`Exported ${name} to ${destFolderHandle.name}`, 'log-ok');
    } catch (e) {
      log(`Export failed: ${e.message}`, 'log-err');
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `query-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    log('Exported CSV via browser download', 'log-ok');
  }
});
