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

// ══════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════

let fetchedScenarios = [];
let selectedTimeSlot = null;

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

const dateFrom = document.getElementById('date-from');
const dateTo = document.getElementById('date-to');
const scenarioTypeSelect = document.getElementById('scenario-type-select');
const takeInput = document.getElementById('take-input');
const btnFetchScenarios = document.getElementById('btn-fetch-scenarios');
const scenarioTableWrap = document.getElementById('scenario-table-wrap');
const scenarioResultsInfo = document.getElementById('scenario-results-info');
const scenarioTableBody = document.getElementById('scenario-table-body');

const selectionDetail = document.getElementById('selection-detail');
const cimStatus = document.getElementById('cim-status');
const cimFileList = document.getElementById('cim-file-list');
const cimProgressSection = document.getElementById('cim-progress-section');
const cimProgressFill = document.getElementById('cim-progress-fill');
const cimProgressText = document.getElementById('cim-progress-text');

const querySelect = document.getElementById('query-select');
const queryInput = document.getElementById('query-input');
const btnRunQuery = document.getElementById('btn-run-query');
const queryResult = document.getElementById('query-result');

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

// Auto-load types if key exists
if (savedKey) loadScenarioTypes();

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
    loadScenarioTypes();
    setTimeout(closeSettings, 600);
  } else {
    localStorage.removeItem(LS_KEY);
    settingsStatus.textContent = 'Key cleared.';
  }
});

// Open settings if no key saved (first-time UX)
if (!savedKey) setTimeout(openSettings, 300);

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
// Fetch & render scenario table
// ══════════════════════════════════════════

btnFetchScenarios.addEventListener('click', async () => {
  if (!getApiKey()) {
    openSettings();
    return;
  }

  try {
    btnFetchScenarios.disabled = true;
    btnFetchScenarios.textContent = 'Fetching...';

    const params = {};
    if (dateFrom.value) params.startDate = new Date(dateFrom.value).toISOString();
    if (dateTo.value) params.endDate = new Date(dateTo.value).toISOString();
    if (scenarioTypeSelect.value) params.scenario = scenarioTypeSelect.value;
    if (takeInput.value) params.take = takeInput.value;

    fetchedScenarios = await apiFetch('/scenario/page', params);

    // Group by scenarioTime
    const grouped = new Map();
    for (const item of fetchedScenarios) {
      const key = item.scenarioTime;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item.scenario);
    }

    // Render table
    scenarioTableBody.innerHTML = '';
    for (const [time, types] of grouped) {
      const tr = document.createElement('tr');
      tr.dataset.time = time;

      // Time cell
      const tdTime = document.createElement('td');
      tdTime.className = 'cell-time';
      tdTime.textContent = formatTime(time);
      tr.appendChild(tdTime);

      // Badges cell
      const tdBadges = document.createElement('td');
      const badgesDiv = document.createElement('div');
      badgesDiv.className = 'scenario-badges';
      for (const t of types) {
        const span = document.createElement('span');
        span.className = 'badge';
        span.textContent = t;
        badgesDiv.appendChild(span);
      }
      tdBadges.appendChild(badgesDiv);
      tr.appendChild(tdBadges);

      // Action cell
      const tdAction = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'btn-load-row';
      btn.textContent = 'Select';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectTimeSlot(time, tr);
      });
      tdAction.appendChild(btn);
      tr.appendChild(tdAction);

      // Row click also selects
      tr.addEventListener('click', () => selectTimeSlot(time, tr));

      scenarioTableBody.appendChild(tr);
    }

    scenarioTableWrap.hidden = false;
    scenarioResultsInfo.textContent = `${fetchedScenarios.length} result(s) across ${grouped.size} time slot(s)`;

    // Clear previous selection
    selectedTimeSlot = null;
    selectionDetail.hidden = true;
  } catch (e) {
    alert(`Failed to fetch scenarios: ${e.message}`);
  } finally {
    btnFetchScenarios.disabled = false;
    btnFetchScenarios.textContent = 'Fetch Scenarios';
  }
});

// ══════════════════════════════════════════
// Select a time slot from the table
// ══════════════════════════════════════════

function selectTimeSlot(time, clickedRow) {
  selectedTimeSlot = time;

  // Highlight row
  scenarioTableBody.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
  clickedRow.classList.add('selected');

  const entries = fetchedScenarios.filter((s) => s.scenarioTime === time);

  cimStatus.textContent = `${formatTime(time)} — ${entries.length} scenario(s)`;

  const ul = document.createElement('ul');
  for (const e of entries) {
    const li = document.createElement('li');
    li.textContent = e.scenario;
    ul.appendChild(li);
  }
  cimFileList.innerHTML = '';
  cimFileList.appendChild(ul);

  selectionDetail.hidden = false;

  // TODO: Wire up file download/loading once the download API endpoint is available.
  cimProgressSection.hidden = false;
  cimProgressFill.style.width = '100%';
  cimProgressText.textContent = `${entries.length} scenario(s) selected. File loading not yet wired to API.`;
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
