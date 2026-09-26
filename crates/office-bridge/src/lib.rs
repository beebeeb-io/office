//! `office-bridge` — sketch, task 1567 phase 1. NOT wired into any build yet.
//!
//! # Job
//!
//! This crate is the *only* piece of Rust glue between beebeeb's zero-knowledge
//! storage layer and the LibreOffice-core-WASM module. It never touches key
//! material and never re-implements crypto — that stays in `beebeeb-core`
//! (`repos/core`), per the workspace rule "all crypto/serialization in core
//! Rust, never per-client" (`.claude/CLAUDE.md` → Shared core logic).
//!
//! Call sequence (web client):
//!
//! ```text
//! 1. web/                     beebeeb-core (WASM)         office-bridge (WASM)      LO-WASM module
//!    fetch ciphertext    ---->
//!                             decrypt(ciphertext, key)
//!                             -> plaintext bytes    ---->
//!                                                          load_document(bytes, "example.docx")
//!                                                                                    ---> writes into
//!                                                                                         Emscripten MEMFS
//!                                                                                         at a private path,
//!                                                                                         calls the UNO
//!                                                                                         loadComponentFromURL
//!                                                                                         Embind binding
//!    (user edits in the LO-WASM UI — no Rust involved for the edit itself)
//!
//!    on save:
//!                                                          save_document() -> reads
//!                                                                              the MEMFS bytes back
//!                                                                              out via the UNO
//!                                                                              storeToURL binding
//!                                                          <---- plaintext bytes
//!                             encrypt(plaintext, key)
//!                             -> ciphertext          <----
//!    upload ciphertext  <----
//!                             as a new file version
//! ```
//!
//! # Why this crate exists at all (vs. calling the LO-WASM Embind API directly from TS)
//!
//! Two reasons, neither of which is "reimplement crypto here":
//! 1. `beebeeb-core`'s WASM build and the LO-WASM module are two *separate* Emscripten/
//!    wasm-bindgen modules with their own linear memories — bytes must cross a real
//!    boundary (a JS `Uint8Array` copy) regardless of language. Doing that copy in Rust
//!    (wasm-bindgen) rather than hand-written TS keeps the byte-handling code covered
//!    by the same Rust test/fuzz tooling as the rest of core, and keeps the *decrypted*
//!    bytes' lifetime explicit and zeroed on drop (`zeroize`), matching
//!    `.claude/CLAUDE.md`'s "Zero key material from memory after use" rule extended to
//!    plaintext document bytes, not just keys.
//! 2. A single typed Rust API (`load_document` / `save_document` / `document_bytes`)
//!    is the one place the egress audit (`docs/EGRESS.md`) and the Playwright egress
//!    test need to reason about — "does the bridge ever hand bytes to anything other
//!    than the MEMFS path / the caller" is a much smaller question than auditing
//!    hand-written TS spread across the editor UI.
//!
//! # What this crate does NOT do (out of scope for this sketch)
//! - No crypto. No key handling. No network calls of any kind — reject any PR to this
//!   crate that adds one.
//! - No UNO API surface design — that is LibreOffice's own Embind bindings (see
//!   `static/README.wasm.md`'s "UNO bindings with Embind" section); this crate is a
//!   thin `wasm-bindgen` shim calling *into* that surface, not reinventing it.
//! - No editor UI. The LO-WASM module's own Qt-rendered canvas is the UI.

use wasm_bindgen::prelude::*;

/// A handle to one document loaded into the LibreOffice-WASM module's private
/// in-memory filesystem. Dropping it must remove the backing MEMFS file — see
/// `docs/EGRESS.md` for why nothing here may fall back to IndexedDB/localStorage
/// (ZetaOffice's own "no proof of no autosave-to-disk" risk, decision 1566).
#[wasm_bindgen]
pub struct DocumentHandle {
    memfs_path: String,
    format: DocumentFormat,
}

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DocumentFormat {
    Docx,
    Xlsx,
    Pptx,
}

#[wasm_bindgen]
impl DocumentHandle {
    /// Writes `plaintext` (already decrypted by beebeeb-core — this function must
    /// never be called with ciphertext) into the LO-WASM module's MEMFS, then asks
    /// the UNO `Desktop::loadComponentFromURL` binding to open it.
    ///
    /// `plaintext` is a `Vec<u8>` owned by this call; wasm-bindgen copies it out of
    /// the caller's linear memory, so the caller's own buffer can be zeroed
    /// immediately after this call returns (the caller's responsibility, not this
    /// function's — this function does not keep a second copy beyond the MEMFS one
    /// LO itself needs to have the file open).
    #[wasm_bindgen(constructor)]
    pub fn load(_plaintext: Vec<u8>, _filename: &str, _format: DocumentFormat) -> Result<DocumentHandle, JsValue> {
        // SKETCH — not implemented. Real implementation:
        //   1. write `_plaintext` to a path under the LO-WASM MEMFS mount
        //      (e.g. "/tmp/<uuid>-<_filename>"), via the Embind FS binding.
        //   2. call the UNO Desktop::loadComponentFromURL Embind binding on
        //      "file://" + that path.
        //   3. store the path + format on the returned handle.
        Err(JsValue::from_str("not implemented — phase 1 sketch only"))
    }

    /// Asks the loaded document to save (UNO `storeToURL`, same path it was loaded
    /// from, same format — no format-conversion surface here), then reads the MEMFS
    /// bytes back out and returns them for beebeeb-core to encrypt.
    ///
    /// The returned bytes are plaintext. The caller must encrypt and zero them
    /// promptly; this function does not touch the network, ever — see
    /// `docs/EGRESS.md` item 1 for why that is enforced one layer down (curl is
    /// compiled out of the LO-WASM module entirely) as well as here (this crate
    /// simply contains no networking dependency to begin with).
    #[wasm_bindgen]
    pub fn save(&self) -> Result<Vec<u8>, JsValue> {
        Err(JsValue::from_str("not implemented — phase 1 sketch only"))
    }
}

/// Memory-limit gate (decision 1566, risk: "~500MB memory ceiling, single-threaded").
/// Call before `DocumentHandle::load` with the plaintext byte length; returns false
/// if the document should open read-only instead (task 1566 verification item 6).
///
/// The threshold is a placeholder pending a real measurement from a completed build
/// (see `build/PROGRESS.md`) — do not ship this constant unexamined.
#[wasm_bindgen]
pub fn fits_memory_budget(plaintext_len: usize) -> bool {
    const PLACEHOLDER_MAX_BYTES: usize = 100 * 1024 * 1024; // 100MB — NOT measured yet
    plaintext_len <= PLACEHOLDER_MAX_BYTES
}
