import init, {
  list_zip_entries,
  extract_zip_entry,
  rdf_clear,
  rdf_load_xml,
  rdf_triple_count,
  rdf_query,
} from './pkg/rust_wasm_zip.js';

// ══════════════════════════════════════════
// Scenarios — fetched from API
// ══════════════════════════════════════════

// Fetched scenario page results: array of { scenarioTime, scenario }
let fetchedScenarios = [];

/**
 * Filter out negative scenario values (e.g. "-1", "-10").
 * Keep text ones (RT, WK, MO, etc.) and normal numbers (00, 01, 2D, etc.).
 */
function filterScenarioTypes(types) {
  return types.filter((t) => !t.startsWith('-'));
}

/**
 * Call the scenario API with optional filters.
 */
async function apiFetch(path, params = {}) {
  const host = document.getElementById('api-host').value.replace(/\/+$/, '');
  const apiKey = document.getElementById('api-key').value;
  if (!host) throw new Error('API host is required');

  const url = new URL(path, host);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-API-KEY': apiKey,
    },
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Predefined SPARQL queries ──
// Add new entries here to make them available in the dropdown.
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

// ── DOM refs ──
const browserWarning = document.getElementById('browser-warning');
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// Zip tab
const btnSource = document.getElementById('btn-source');
const btnDest = document.getElementById('btn-dest');
const btnExtract = document.getElementById('btn-extract');
const sourceLabel = document.getElementById('source-label');
const destLabel = document.getElementById('dest-label');
const fileListEl = document.getElementById('file-list');
const progressSection = document.getElementById('progress-section');
const progressFill = document.getElementById('progress-fill');
const statusText = document.getElementById('status-text');

// API / scenario search
const apiHostInput = document.getElementById('api-host');
const apiKeyInput = document.getElementById('api-key');
const dateFrom = document.getElementById('date-from');
const dateTo = document.getElementById('date-to');
const scenarioTypeSelect = document.getElementById('scenario-type-select');
const takeInput = document.getElementById('take-input');
const btnFetchTypes = document.getElementById('btn-fetch-types');
const btnFetchScenarios = document.getElementById('btn-fetch-scenarios');
const scenarioResultsDiv = document.getElementById('scenario-results');
const scenarioResultsInfo = document.getElementById('scenario-results-info');
const scenarioResultsList = document.getElementById('scenario-results-list');

// SPARQL tab
const scenarioSelect = document.getElementById('scenario-select');
const btnLoadScenario = document.getElementById('btn-load-scenario');
const cimStatus = document.getElementById('cim-status');
const cimFileList = document.getElementById('cim-file-list');
const cimProgressSection = document.getElementById('cim-progress-section');
const cimProgressFill = document.getElementById('cim-progress-fill');
const cimProgressText = document.getElementById('cim-progress-text');
const querySelect = document.getElementById('query-select');
const queryInput = document.getElementById('query-input');
const btnRunQuery = document.getElementById('btn-run-query');
const queryResult = document.getElementById('query-result');

let sourceDirHandle = null;
let destDirHandle = null;
let zipFiles = [];
let cgmesRootHandle = null; // Reuse across loads so user only picks once

// ── Browser check ──
if (typeof window.showDirectoryPicker === 'undefined') {
  browserWarning.hidden = false;
}

// ── Init WASM ──
await init();

// ── Tab switching ──
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tabContents.forEach((tc) => tc.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ── Set default dates (last 24h) ──
const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
dateFrom.value = toLocalISOString(yesterday);
dateTo.value = toLocalISOString(now);

function toLocalISOString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Fetch scenario types ──
btnFetchTypes.addEventListener('click', async () => {
  try {
    btnFetchTypes.disabled = true;
    const types = await apiFetch('/scenario/scenario');
    const filtered = filterScenarioTypes(types);

    // Clear and repopulate
    scenarioTypeSelect.innerHTML = '<option value="">All</option>';
    for (const t of filtered) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      scenarioTypeSelect.appendChild(opt);
    }
  } catch (e) {
    alert(`Failed to load types: ${e.message}`);
  } finally {
    btnFetchTypes.disabled = false;
  }
});

// ── Fetch scenarios (page endpoint) ──
btnFetchScenarios.addEventListener('click', async () => {
  try {
    btnFetchScenarios.disabled = true;

    const params = {};
    if (dateFrom.value) params.startDate = new Date(dateFrom.value).toISOString();
    if (dateTo.value) params.endDate = new Date(dateTo.value).toISOString();
    if (scenarioTypeSelect.value) params.scenario = scenarioTypeSelect.value;
    if (takeInput.value) params.take = takeInput.value;

    fetchedScenarios = await apiFetch('/scenario/page', params);

    // Group by scenarioTime for the dropdown
    const grouped = new Map();
    for (const item of fetchedScenarios) {
      const key = item.scenarioTime;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item.scenario);
    }

    // Populate scenario select dropdown with unique times
    scenarioSelect.innerHTML = '<option value="">-- Select scenario --</option>';
    for (const [time, types] of grouped) {
      const opt = document.createElement('option');
      opt.value = time;
      const d = new Date(time);
      opt.textContent = `${d.toLocaleString()} (${types.join(', ')})`;
      scenarioSelect.appendChild(opt);
    }

    // Show results summary
    scenarioResultsDiv.hidden = false;
    scenarioResultsInfo.textContent = `${fetchedScenarios.length} result(s), ${grouped.size} unique time(s)`;

    // Render results list
    const ul = document.createElement('ul');
    for (const item of fetchedScenarios) {
      const li = document.createElement('li');
      const d = new Date(item.scenarioTime);
      li.textContent = `${d.toLocaleString()} — ${item.scenario}`;
      ul.appendChild(li);
    }
    scenarioResultsList.innerHTML = '';
    scenarioResultsList.appendChild(ul);
  } catch (e) {
    alert(`Failed to fetch scenarios: ${e.message}`);
  } finally {
    btnFetchScenarios.disabled = false;
  }
});

// ── Populate predefined queries dropdown ──
PREDEFINED_QUERIES.forEach((q, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = q.name;
  querySelect.appendChild(opt);
});

querySelect.addEventListener('change', () => {
  const idx = querySelect.value;
  if (idx !== '') {
    queryInput.value = PREDEFINED_QUERIES[idx].query;
  }
});

// ══════════════════════════════════════════
// Tab 1: Zip Extractor
// ══════════════════════════════════════════

btnSource.addEventListener('click', async () => {
  try {
    sourceDirHandle = await window.showDirectoryPicker({ mode: 'read' });
  } catch {
    return;
  }

  sourceLabel.textContent = sourceDirHandle.name;
  zipFiles = [];

  for await (const [name, handle] of sourceDirHandle.entries()) {
    if (handle.kind === 'file' && name.toLowerCase().endsWith('.zip')) {
      zipFiles.push({ name, handle });
    }
  }

  renderFileList();
  updateExtractButton();
});

btnDest.addEventListener('click', async () => {
  try {
    destDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return;
  }
  destLabel.textContent = destDirHandle.name;
  updateExtractButton();
});

btnExtract.addEventListener('click', async () => {
  if (!zipFiles.length || !destDirHandle) return;

  btnExtract.disabled = true;
  progressSection.hidden = false;

  let totalEntries = 0;
  let processedEntries = 0;

  const zipDataList = [];
  for (const zipFile of zipFiles) {
    setStatus(`Reading ${zipFile.name}...`);
    const file = await zipFile.handle.getFile();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const entries = list_zip_entries(buffer);
    if (!entries) {
      setStatus(`Skipping ${zipFile.name} (invalid zip)`);
      continue;
    }
    totalEntries += entries.length;
    zipDataList.push({ name: zipFile.name, buffer, entries });
  }

  for (const { name: zipName, buffer, entries } of zipDataList) {
    setStatus(`Extracting ${zipName}...`);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.isDir) {
        await getNestedDirHandle(destDirHandle, entry.name);
      } else {
        const result = extract_zip_entry(buffer, i);
        if (result) {
          await writeFile(destDirHandle, result.name, new Uint8Array(result.bytes));
        }
      }
      processedEntries++;
      setProgress(processedEntries / totalEntries);
    }
  }

  setStatus(
    `Done! Extracted ${processedEntries} entries from ${zipDataList.length} zip file(s).`
  );
  btnExtract.disabled = false;
});

function renderFileList() {
  if (!zipFiles.length) {
    fileListEl.innerHTML = '<p class="label">No zip files found in selected folder.</p>';
    return;
  }
  const ul = document.createElement('ul');
  for (const zf of zipFiles) {
    const li = document.createElement('li');
    li.textContent = zf.name;
    ul.appendChild(li);
  }
  fileListEl.innerHTML = '';
  fileListEl.appendChild(ul);
}

function updateExtractButton() {
  btnExtract.disabled = !(zipFiles.length && destDirHandle);
}

function setProgress(fraction) {
  progressFill.style.width = `${Math.round(fraction * 100)}%`;
}

function setStatus(msg) {
  statusText.textContent = msg;
}

async function getNestedDirHandle(root, path) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  let dir = root;
  for (const segment of parts) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}

async function writeFile(root, filePath, data) {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const fileName = parts.pop();
  let dir = root;
  for (const segment of parts) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

// ══════════════════════════════════════════
// Tab 2: CIM SPARQL — Scenario loading
// ══════════════════════════════════════════

/**
 * Navigate a directory handle by a relative path like "OFFLINE/2025/01/03".
 * Returns the subdirectory handle (read-only, no create).
 */
async function walkPath(root, relativePath) {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  let dir = root;
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg);
  }
  return dir;
}

/**
 * Given a root directory handle and a relative path to a file (e.g. "OFFLINE/2025/01/03/file.zip"),
 * return the FileSystemFileHandle.
 */
async function getFileByPath(root, relativePath) {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const fileName = parts.pop();
  const dir = parts.length > 0 ? await walkPath(root, parts.join('/')) : root;
  return dir.getFileHandle(fileName);
}

/**
 * Read a zip file, extract all XML entries, and load each into the RDF graph.
 * Returns { xmlCount, error? }.
 */
async function unzipAndLoadToGraph(fileHandle, zipPath) {
  const file = await fileHandle.getFile();
  const zipBytes = new Uint8Array(await file.arrayBuffer());

  const entries = list_zip_entries(zipBytes);
  if (!entries) {
    return { xmlCount: 0, error: `Invalid zip: ${zipPath}` };
  }

  let xmlCount = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.isDir) continue;
    if (!entry.name.toLowerCase().endsWith('.xml')) continue;

    const extracted = extract_zip_entry(zipBytes, i);
    if (!extracted) continue;

    const xmlBytes = new Uint8Array(extracted.bytes);
    rdf_load_xml(xmlBytes, `http://cim/${extracted.name}`);
    xmlCount++;
  }

  return { xmlCount };
}

btnLoadScenario.addEventListener('click', async () => {
  const selectedTime = scenarioSelect.value;
  if (!selectedTime) return;

  // Get all scenario entries for this time
  const entries = fetchedScenarios.filter((s) => s.scenarioTime === selectedTime);
  if (!entries.length) return;

  // Display selected scenarios
  const scenarioLabel = `${new Date(selectedTime).toLocaleString()} (${entries.map((e) => e.scenario).join(', ')})`;
  cimStatus.textContent = `Selected: ${scenarioLabel}`;
  renderCimFileList(entries.map((e) => `${e.scenarioTime} — ${e.scenario}`));

  // TODO: Wire up file download/loading once the download API endpoint is available.
  // For now, show what was selected.
  cimProgressSection.hidden = false;
  cimProgressFill.style.width = '100%';
  cimProgressText.textContent = `${entries.length} scenario(s) selected. File loading not yet wired to API.`;
});

function renderCimFileList(files) {
  const ul = document.createElement('ul');
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = f;
    ul.appendChild(li);
  }
  cimFileList.innerHTML = '';
  cimFileList.appendChild(ul);
}

// ══════════════════════════════════════════
// SPARQL query execution
// ══════════════════════════════════════════

btnRunQuery.addEventListener('click', () => {
  const sparql = queryInput.value.trim();
  if (!sparql) return;

  queryResult.innerHTML = '';

  try {
    const t0 = performance.now();
    const result = rdf_query(sparql);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

    if (!result || !result.columns) {
      queryResult.innerHTML = '<p class="error">No results returned.</p>';
      return;
    }

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
  } catch (e) {
    queryResult.innerHTML = `<p class="error">${e}</p>`;
  }
});
