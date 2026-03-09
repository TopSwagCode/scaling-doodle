/* tslint:disable */
/* eslint-disable */

export function extract_zip_entry(data: Uint8Array, index: number): any;

export function init_panic_hook(): void;

export function list_zip_entries(data: Uint8Array): any;

export function rdf_clear(): void;

export function rdf_load_xml(data: Uint8Array, filename: string): number;

export function rdf_query(sparql: string): any;

export function rdf_triple_count(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly extract_zip_entry: (a: number, b: number, c: number) => any;
    readonly list_zip_entries: (a: number, b: number) => any;
    readonly rdf_load_xml: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly rdf_query: (a: number, b: number) => [number, number, number];
    readonly rdf_triple_count: () => [number, number, number];
    readonly init_panic_hook: () => void;
    readonly rdf_clear: () => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
