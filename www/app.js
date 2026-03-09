import init, {
  list_zip_entries,
  extract_zip_entry,
  rdf_clear,
  rdf_load_xml,
  rdf_triple_count,
  rdf_query,
} from './pkg/rust_wasm_zip.js';

// ══════════════════════════════════════════
// Scenarios
// ══════════════════════════════════════════
// Each scenario is a list of zip file paths relative to the CGMES root folder.
// Later this will come from an API call — just replace SCENARIOS / activeScenario.

const SCENARIOS = {
  'OFFLINE 2025-01-03 23h': [
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKSK_TP_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKE_TP_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKKS_SV_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKCO_TP_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKSB_SSH_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKW_TP_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKCO_SV_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKKS_TP_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKKO_SV_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKSK_SSH_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKKO_SSH_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKSB_SV_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKE_SSH_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKSB_TP_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKW_SV_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKKS_SSH_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKW_SSH_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKKO_TP_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKSK_SV_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKCO_SSH_001.zip',
    'OFFLINE/2025/01/03/20250104T2230Z_23_DKE_SV_001.zip',
    'Boundry/20230828T0000Z__ENTSOE_TPBD_001.zip',
    'EQ/2024/12/20/20241215T2300Z__DKKO_EQ_001.zip',
    'EQ/2024/12/17/20241215T2300Z__DKKS_EQ_001.zip',
    'EQ/2024/12/20/20241215T2300Z__DKCO_EQ_001.zip',
    'EQ/2024/12/17/20241215T2300Z__DKW_EQ_001.zip',
    'EQ/2024/12/20/20241215T2300Z__DKSK_EQ_001.zip',
    'EQ/2024/12/17/20241215T2300Z__DKSB_EQ_001.zip',
    'EQ/2024/12/17/20241215T2300Z__DKE_EQ_001.zip',
  ],
};

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

// ── Populate scenario dropdown ──
Object.keys(SCENARIOS).forEach((name) => {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
  scenarioSelect.appendChild(opt);
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
  const scenarioName = scenarioSelect.value;
  if (!scenarioName) return;

  const scenarioFiles = SCENARIOS[scenarioName];
  if (!scenarioFiles || !scenarioFiles.length) return;

  // Ask user to pick the CGMES root folder (reuse if already picked)
  if (!cgmesRootHandle) {
    try {
      cgmesRootHandle = await window.showDirectoryPicker({ mode: 'read' });
    } catch {
      return; // User cancelled
    }
  }

  btnLoadScenario.disabled = true;
  btnRunQuery.disabled = true;
  cimProgressSection.hidden = false;
  cimProgressFill.style.width = '0%';
  queryResult.innerHTML = '';

  // Show file list
  renderCimFileList(scenarioFiles);

  // Clear graph
  rdf_clear();

  let loaded = 0;
  let totalXml = 0;
  let errors = [];

  for (let i = 0; i < scenarioFiles.length; i++) {
    const zipPath = scenarioFiles[i];
    const zipName = zipPath.split('/').pop();
    cimProgressText.textContent = `[${i + 1}/${scenarioFiles.length}] Unzipping & loading ${zipName}...`;
    cimProgressFill.style.width = `${Math.round((i / scenarioFiles.length) * 100)}%`;

    try {
      const fileHandle = await getFileByPath(cgmesRootHandle, zipPath);
      const result = await unzipAndLoadToGraph(fileHandle, zipPath);
      totalXml += result.xmlCount;
      if (result.error) {
        errors.push(result.error);
      } else {
        loaded++;
      }
    } catch (e) {
      errors.push(`${zipName}: ${e.message || e}`);
    }
  }

  const tripleCount = rdf_triple_count();
  cimProgressFill.style.width = '100%';
  btnRunQuery.disabled = false;
  btnLoadScenario.disabled = false;

  const summary = [`${scenarioName}: ${loaded}/${scenarioFiles.length} zips, ${totalXml} XML files, ${tripleCount.toLocaleString()} triples`];
  if (errors.length) summary.push(`${errors.length} error(s)`);
  cimStatus.textContent = summary.join(' | ');
  cimProgressText.textContent = errors.length
    ? `Ready. Errors: ${errors.join('; ')}`
    : 'Ready for queries.';
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
