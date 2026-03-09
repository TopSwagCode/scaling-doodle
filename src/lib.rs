use std::cell::RefCell;
use std::io::{Cursor, Read};

use oxigraph::io::{RdfFormat, RdfParser};
use oxigraph::sparql::QueryResults;
use oxigraph::store::Store;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use zip::ZipArchive;

// ── Init ──

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

// ── Zip types ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ZipEntry {
    name: String,
    size: u64,
    is_dir: bool,
}

#[derive(Serialize)]
struct ExtractedEntry {
    name: String,
    bytes: Vec<u8>,
}

fn sanitize_name(name: &str) -> String {
    name.replace("../", "")
        .trim_start_matches('/')
        .to_string()
}

#[wasm_bindgen]
pub fn list_zip_entries(data: &[u8]) -> JsValue {
    let cursor = Cursor::new(data);
    let mut archive = match ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return JsValue::NULL,
    };

    let entries: Vec<ZipEntry> = (0..archive.len())
        .filter_map(|i| {
            let file = archive.by_index_raw(i).ok()?;
            Some(ZipEntry {
                name: sanitize_name(file.name()),
                size: file.size(),
                is_dir: file.is_dir(),
            })
        })
        .collect();

    serde_wasm_bindgen::to_value(&entries).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn extract_zip_entry(data: &[u8], index: u32) -> JsValue {
    let cursor = Cursor::new(data);
    let mut archive = match ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return JsValue::NULL,
    };

    let mut file = match archive.by_index(index as usize) {
        Ok(f) => f,
        Err(_) => return JsValue::NULL,
    };

    if file.is_dir() {
        return JsValue::NULL;
    }

    let name = sanitize_name(file.name());
    let mut bytes = Vec::with_capacity(file.size() as usize);
    if file.read_to_end(&mut bytes).is_err() {
        return JsValue::NULL;
    }

    let entry = ExtractedEntry { name, bytes };
    serde_wasm_bindgen::to_value(&entry).unwrap_or(JsValue::NULL)
}

// ── RDF / SPARQL ──

thread_local! {
    static STORE: RefCell<Store> = RefCell::new(Store::new().unwrap());
}

#[derive(Serialize)]
struct SparqlResult {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
}

#[wasm_bindgen]
pub fn rdf_clear() {
    STORE.with(|s| {
        *s.borrow_mut() = Store::new().unwrap();
    });
}

#[wasm_bindgen]
pub fn rdf_load_xml(data: &[u8], filename: &str) -> Result<u32, JsValue> {
    STORE.with(|s| {
        let store = s.borrow();
        let cursor = Cursor::new(data);

        // Build a base IRI so relative references like "#_uuid" resolve properly.
        let base_iri = format!("http://cim/{}", filename);
        let parser = RdfParser::from_format(RdfFormat::RdfXml).with_base_iri(&base_iri)
            .map_err(|e| JsValue::from_str(&format!("Invalid base IRI: {}", e)))?;

        store
            .load_from_reader(parser, cursor)
            .map_err(|e| JsValue::from_str(&format!("Parse error ({}): {}", filename, e)))?;

        Ok(store.len().map_err(|e| JsValue::from_str(&e.to_string()))? as u32)
    })
}

#[wasm_bindgen]
pub fn rdf_triple_count() -> Result<u32, JsValue> {
    STORE.with(|s| {
        let store = s.borrow();
        Ok(store.len().map_err(|e| JsValue::from_str(&e.to_string()))? as u32)
    })
}

#[wasm_bindgen]
pub fn rdf_query(sparql: &str) -> Result<JsValue, JsValue> {
    STORE.with(|s| {
        let store = s.borrow();
        let results = store
            .query(sparql)
            .map_err(|e| JsValue::from_str(&format!("SPARQL error: {}", e)))?;

        match results {
            QueryResults::Solutions(solutions) => {
                let columns: Vec<String> = solutions
                    .variables()
                    .iter()
                    .map(|v| v.as_str().to_string())
                    .collect();

                let mut rows = Vec::new();
                for solution in solutions {
                    let solution =
                        solution.map_err(|e| JsValue::from_str(&format!("Row error: {}", e)))?;
                    let row: Vec<String> = columns
                        .iter()
                        .map(|col| {
                            solution
                                .get(col.as_str())
                                .map(|t| t.to_string())
                                .unwrap_or_default()
                        })
                        .collect();
                    rows.push(row);
                }

                let result = SparqlResult { columns, rows };
                serde_wasm_bindgen::to_value(&result)
                    .map_err(|e| JsValue::from_str(&e.to_string()))
            }
            QueryResults::Boolean(b) => {
                let result = SparqlResult {
                    columns: vec!["result".to_string()],
                    rows: vec![vec![b.to_string()]],
                };
                serde_wasm_bindgen::to_value(&result)
                    .map_err(|e| JsValue::from_str(&e.to_string()))
            }
            QueryResults::Graph(_) => Err(JsValue::from_str(
                "CONSTRUCT/DESCRIBE queries not yet supported",
            )),
        }
    })
}
