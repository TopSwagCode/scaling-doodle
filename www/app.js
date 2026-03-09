import init, { list_zip_entries, extract_zip_entry } from './pkg/rust_wasm_zip.js';

const btnSource = document.getElementById('btn-source');
const btnDest = document.getElementById('btn-dest');
const btnExtract = document.getElementById('btn-extract');
const sourceLabel = document.getElementById('source-label');
const destLabel = document.getElementById('dest-label');
const fileListEl = document.getElementById('file-list');
const progressSection = document.getElementById('progress-section');
const progressFill = document.getElementById('progress-fill');
const statusText = document.getElementById('status-text');
const browserWarning = document.getElementById('browser-warning');

let sourceDirHandle = null;
let destDirHandle = null;
let zipFiles = []; // Array of { name, handle }

// Check browser support
if (typeof window.showDirectoryPicker === 'undefined') {
  browserWarning.hidden = false;
}

await init();

btnSource.addEventListener('click', async () => {
  try {
    sourceDirHandle = await window.showDirectoryPicker({ mode: 'read' });
  } catch {
    return; // User cancelled
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

  // First pass: count total entries across all zips
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

  // Second pass: extract
  for (const { name: zipName, buffer, entries } of zipDataList) {
    setStatus(`Extracting ${zipName}...`);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (entry.isDir) {
        // Create directory
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

  setStatus(`Done! Extracted ${processedEntries} entries from ${zipDataList.length} zip file(s).`);
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

/**
 * Walk a path like "dir/subdir/file.txt" and return the directory handle
 * for the parent, creating directories as needed.
 */
async function getNestedDirHandle(root, path) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  // If path ends without a trailing slash, it's a file — walk only the directory parts
  let dir = root;
  for (const segment of parts) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}

/**
 * Write a file at a nested path under root, creating parent dirs as needed.
 */
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
