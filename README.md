# CIM Tools — Rust/WASM Zip Extractor & SPARQL Query Engine

Browser-based tool for working with CIM (Common Information Model) data. All processing runs client-side using Rust compiled to WebAssembly.

**Tab 1 — Zip Extractor:** Select a folder of zip files, extract them to a destination folder.

**Tab 2 — CIM SPARQL:** Load a CIM scenario (zip files from a network share), unzip in-memory, parse the RDF/XML, and run SPARQL queries against the combined graph.

## Prerequisites

```bash
# Rust toolchain
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

## Build

```bash
wasm-pack build --target web --out-dir docs/pkg
```

This compiles the Rust code to WASM and outputs the JS bindings + `.wasm` file into `docs/pkg/`.

After building, remove the generated `.gitignore` inside `docs/pkg/` so the files can be committed for GitHub Pages:

```bash
rm -f docs/pkg/.gitignore
```

## Run locally

```bash
python3 -m http.server 8080 --directory docs
```

Open http://localhost:8080 in Chrome or Edge (File System Access API is Chromium-only).

## Deploy to GitHub Pages

1. Build and commit `docs/pkg/`:
   ```bash
   wasm-pack build --target web --out-dir docs/pkg
   rm -f docs/pkg/.gitignore
   git add docs/
   git commit -m "Build WASM"
   git push
   ```
2. In your GitHub repo, go to **Settings > Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Set **Branch** to `main` and **Folder** to `/docs`.
5. Save — the site will be live at `https://<user>.github.io/<repo>/`.

## Project structure

```
rust-wasm-test/
├── Cargo.toml          # Rust dependencies (wasm-bindgen, zip, oxigraph, etc.)
├── src/
│   └── lib.rs          # Rust WASM module: zip + RDF/SPARQL functions
├── docs/               # Static site (served by GitHub Pages)
│   ├── index.html
│   ├── style.css
│   ├── app.js          # File System Access API + WASM orchestration
│   └── pkg/            # wasm-pack output (committed for GitHub Pages)
├── .gitignore
└── README.md
```

## Adding scenarios

Edit the `SCENARIOS` object in `docs/app.js`. Each scenario is a list of zip file paths relative to the CGMES root folder the user picks:

```js
const SCENARIOS = {
  'My Scenario': [
    'OFFLINE/2025/01/03/some_file.zip',
    'EQ/2024/12/20/another_file.zip',
  ],
};
```

## Adding SPARQL queries

Edit the `PREDEFINED_QUERIES` array in `docs/app.js`:

```js
const PREDEFINED_QUERIES = [
  {
    name: 'My Query',
    query: `PREFIX cim: <http://iec.ch/TC57/2013/CIM-schema-cim16#>
SELECT ?s ?name WHERE {
  ?s a cim:Substation .
  ?s cim:IdentifiedObject.name ?name .
}`,
  },
  // ...
];
```

## Browser requirements

- Chrome or Edge (File System Access API)
- WebAssembly support
