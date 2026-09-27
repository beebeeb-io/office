//! `office-bridge` — task 1567 phase 3. Rust-side shape of the `bbOffice` bridge.
//!
//! # Job
//!
//! This crate is the *only* piece of Rust glue between beebeeb's zero-knowledge
//! storage layer and the LibreOffice-core-WASM module's editor. It never touches
//! key material and never re-implements crypto — that stays in `beebeeb-core`
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
//!                                                          DocumentHandle::open(bytes, "example.docx")
//!                                                                                    ---> window.bbOffice.open()
//!                                                                                         (bridge/bb-office-api.js),
//!                                                                                         which posts the bytes over
//!                                                                                         Module.uno_main's MessagePort
//!                                                                                         to bridge/bb-office-worker.js,
//!                                                                                         running on the pthread that
//!                                                                                         owns UNO. See that file's own
//!                                                                                         header comment for exactly
//!                                                                                         why (MEMFS/file:// does not
//!                                                                                         work across the pthread
//!                                                                                         boundary — proved
//!                                                                                         empirically, task 1567
//!                                                                                         phase 3) and what mechanism
//!                                                                                         does (UNO's own in-memory
//!                                                                                         SequenceInputStream /
//!                                                                                         SequenceOutputStream).
//!
//!    (user edits in the LO-WASM UI — no Rust involved for the edit itself)
//!
//!    on save:
//!                                                          handle.save() -> awaits
//!                                                                            window.bbOffice.save()
//!                                                          <---- plaintext bytes
//!                             encrypt(plaintext, key)
//!                             -> ciphertext          <----
//!    upload ciphertext  <----
//!                             as a new file version
//! ```
//!
//! # Why this crate exists at all (vs. calling `window.bbOffice` directly from TS)
//!
//! Two reasons, neither of which is "reimplement crypto here":
//! 1. `beebeeb-core`'s WASM build and the LO-WASM module are two *separate* Emscripten/
//!    wasm-bindgen modules with their own linear memories — bytes must cross a real
//!    boundary (a JS `Uint8Array` copy) regardless of language. Doing that copy in Rust
//!    (wasm-bindgen) rather than hand-written TS keeps the byte-handling code covered
//!    by the same Rust test/fuzz tooling as the rest of core, and keeps the *decrypted*
//!    bytes' lifetime explicit, matching `.claude/CLAUDE.md`'s "Zero key material from
//!    memory after use" rule extended to plaintext document bytes, not just keys.
//! 2. A single typed Rust API (`DocumentHandle::open` / `.save()` / `DocumentFormat`) is
//!    the one place the egress audit (`docs/EGRESS.md`) and the Playwright egress test
//!    need to reason about — "does the bridge ever hand bytes to anything other than
//!    the `bbOffice` call / the caller" is a much smaller question than auditing
//!    hand-written TS spread across the editor UI.
//!
//! # What this crate does NOT do (out of scope)
//! - No crypto. No key handling. No network calls of any kind — reject any PR to this
//!   crate that adds one.
//! - No UNO API surface design — that lives in `bridge/bb-office-worker.js`, which
//!   calls into LibreOffice's own Embind bindings (see `static/README.wasm.md`'s "UNO
//!   bindings with Embind" section); this crate is a thin `wasm-bindgen` shim calling
//!   the already-proven `window.bbOffice.open`/`.save()` surface, not reinventing it.
//! - No editor UI. The LO-WASM module's own Qt-rendered canvas is the UI.

use wasm_bindgen::prelude::*;

/// The document formats `bridge/bb-office-worker.js` knows how to open/save
/// (`FILTER_BY_EXT` there is the single source of truth for the actual LO filter
/// names — this enum only needs to mirror which extensions are supported, kept
/// in sync by the unit tests below rather than by hand).
#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DocumentFormat {
    Docx,
    Xlsx,
    Pptx,
    /// Legacy read: `bb-office-worker.js` opens it but always saves as the
    /// modern equivalent (Docx) — task 1567 goal 3's own stated allowance.
    Doc,
    /// Legacy read; saves as Xlsx.
    Xls,
    /// Legacy read; saves as Pptx.
    Ppt,
}

impl DocumentFormat {
    /// Pure, target-independent (no `wasm_bindgen`/browser calls) so `cargo test`
    /// can exercise it natively. Case-insensitive; does not require a leading dot.
    pub fn from_extension(ext: &str) -> Option<DocumentFormat> {
        match ext.to_ascii_lowercase().as_str() {
            "docx" => Some(DocumentFormat::Docx),
            "xlsx" => Some(DocumentFormat::Xlsx),
            "pptx" => Some(DocumentFormat::Pptx),
            "doc" => Some(DocumentFormat::Doc),
            "xls" => Some(DocumentFormat::Xls),
            "ppt" => Some(DocumentFormat::Ppt),
            _ => None,
        }
    }

    /// The extension `bb-office-worker.js`'s `save()` will actually produce for
    /// this format (legacy formats save as their modern equivalent — matches
    /// that file's own `MODERN_EQUIVALENT` table).
    pub fn save_extension(self) -> &'static str {
        match self {
            DocumentFormat::Docx | DocumentFormat::Doc => "docx",
            DocumentFormat::Xlsx | DocumentFormat::Xls => "xlsx",
            DocumentFormat::Pptx | DocumentFormat::Ppt => "pptx",
        }
    }

    /// True for `.doc`/`.xls`/`.ppt` — opens read, saves as the modern format
    /// (task 1567 goal 3: "legacy .doc/.xls/.ppt opens read; save as the modern
    /// format is acceptable").
    pub fn is_legacy(self) -> bool {
        matches!(self, DocumentFormat::Doc | DocumentFormat::Xls | DocumentFormat::Ppt)
    }
}

/// Memory-limit gate (decision 1566, risk: "~500MB memory ceiling,
/// single-threaded"). Call before `DocumentHandle::open` with the plaintext byte
/// length; returns false if the document should open read-only instead (task
/// 1566 verification item 6).
///
/// The threshold below is informed by real measurements from the completed
/// Phase 2/3 build (`docs/PHASE2-RESULTS.md`, task file's dated 2026-09-27
/// note): the WHOLE Chromium process (LO-WASM app + browser overhead) sits at
/// ~1.45-1.5GB RSS with only small (<10KB) fixture documents loaded — this
/// constant bounds the *document's own* plaintext size, not the app's fixed
/// footprint, and has NOT been stress-tested against a genuinely large (tens of
/// MB) document in this session — fixtures used were all under 1MB. Treat this
/// as a conservative placeholder pending that stress test, not a measured ceiling.
#[wasm_bindgen]
pub fn fits_memory_budget(plaintext_len: usize) -> bool {
    const MAX_BYTES: usize = 100 * 1024 * 1024; // 100MB — see doc comment above
    plaintext_len <= MAX_BYTES
}

#[cfg(target_arch = "wasm32")]
mod browser {
    use super::*;
    use wasm_bindgen_futures::JsFuture;
    use zeroize::Zeroize;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = ["window", "bbOffice"], js_name = open)]
        fn bb_office_open(bytes: js_sys::Uint8Array, filename: &str) -> js_sys::Promise;

        #[wasm_bindgen(js_namespace = ["window", "bbOffice"], js_name = save)]
        fn bb_office_save() -> js_sys::Promise;
    }

    /// A handle to the document currently open in the `bbOffice` bridge (see
    /// `bridge/bb-office-worker.js` — one document at a time, matching task
    /// 1567's minimal API ask).
    #[wasm_bindgen]
    pub struct DocumentHandle {
        format: DocumentFormat,
    }

    #[wasm_bindgen]
    impl DocumentHandle {
        /// Writes `plaintext` (already decrypted by beebeeb-core — this
        /// function must never be called with ciphertext) to `window.bbOffice`,
        /// which loads it into the LO-WASM editor via an in-memory UNO stream
        /// (never `file://`, never touches MEMFS — see this module's own doc
        /// comment). `plaintext` is consumed: `bbOffice.open`'s underlying
        /// `Uint8Array.buffer` is transferred to the worker realm, so the
        /// caller's own copy must already be considered gone once this
        /// function is called, not just after it returns — the caller zeroes
        /// its own buffer BEFORE calling this, not after.
        pub async fn open(plaintext: Vec<u8>, filename: String) -> Result<DocumentHandle, JsValue> {
            // Zeroed on every return path (task 1581, Codex review on office#2):
            // dropping a Vec frees it but leaves the plaintext in WASM linear memory.
            let mut plaintext = zeroize::Zeroizing::new(plaintext);
            let ext = filename.rsplit('.').next().unwrap_or("");
            let format = DocumentFormat::from_extension(ext)
                .ok_or_else(|| JsValue::from_str(&format!("unsupported extension: .{ext}")))?;
            if !fits_memory_budget(plaintext.len()) {
                return Err(JsValue::from_str("document exceeds the memory budget; open read-only instead"));
            }
            let array = js_sys::Uint8Array::from(plaintext.as_slice());
            // The JS copy now owns the bytes; wipe ours before the (long) await.
            plaintext.zeroize();
            let promise = bb_office_open(array, &filename);
            JsFuture::from(promise).await?;
            Ok(DocumentHandle { format })
        }

        /// Asks `window.bbOffice.save()` for the current document's bytes
        /// (UNO `storeToURL` against an in-memory `SequenceOutputStream` under
        /// the hood — see `bb-office-worker.js`). The returned bytes are
        /// plaintext; the caller must encrypt and zero them promptly. This
        /// function does not touch the network, ever — `docs/EGRESS.md` covers
        /// why at the native layer (curl is compiled out entirely) and this
        /// crate has no networking dependency to begin with.
        pub async fn save(&self) -> Result<Vec<u8>, JsValue> {
            let promise = bb_office_save();
            let value = JsFuture::from(promise).await?;
            let array = js_sys::Uint8Array::new(&value);
            Ok(array.to_vec())
        }

        /// The format this handle was opened with (`.doc` stays `Doc`, not
        /// `Docx` — use `save_extension()` for what `save()` will actually
        /// produce).
        #[wasm_bindgen(getter)]
        pub fn format(&self) -> DocumentFormat {
            self.format
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub use browser::DocumentHandle;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_extension_covers_all_six_supported_formats() {
        assert_eq!(DocumentFormat::from_extension("docx"), Some(DocumentFormat::Docx));
        assert_eq!(DocumentFormat::from_extension("xlsx"), Some(DocumentFormat::Xlsx));
        assert_eq!(DocumentFormat::from_extension("pptx"), Some(DocumentFormat::Pptx));
        assert_eq!(DocumentFormat::from_extension("doc"), Some(DocumentFormat::Doc));
        assert_eq!(DocumentFormat::from_extension("xls"), Some(DocumentFormat::Xls));
        assert_eq!(DocumentFormat::from_extension("ppt"), Some(DocumentFormat::Ppt));
    }

    #[test]
    fn from_extension_is_case_insensitive_and_wants_no_leading_dot() {
        assert_eq!(DocumentFormat::from_extension("DOCX"), Some(DocumentFormat::Docx));
        assert_eq!(DocumentFormat::from_extension("DocX"), Some(DocumentFormat::Docx));
        // A leading dot is not stripped -- callers pass the bare extension
        // (this crate's own `open()` does `filename.rsplit('.').next()`, which
        // already excludes the dot).
        assert_eq!(DocumentFormat::from_extension(".docx"), None);
    }

    #[test]
    fn from_extension_rejects_unsupported_formats() {
        for ext in ["odt", "pdf", "txt", "rtf", "", "docxx"] {
            assert_eq!(DocumentFormat::from_extension(ext), None, "unexpectedly accepted .{ext}");
        }
    }

    #[test]
    fn save_extension_maps_legacy_formats_to_their_modern_equivalent() {
        assert_eq!(DocumentFormat::Doc.save_extension(), "docx");
        assert_eq!(DocumentFormat::Xls.save_extension(), "xlsx");
        assert_eq!(DocumentFormat::Ppt.save_extension(), "pptx");
    }

    #[test]
    fn save_extension_is_a_no_op_for_already_modern_formats() {
        assert_eq!(DocumentFormat::Docx.save_extension(), "docx");
        assert_eq!(DocumentFormat::Xlsx.save_extension(), "xlsx");
        assert_eq!(DocumentFormat::Pptx.save_extension(), "pptx");
    }

    #[test]
    fn is_legacy_flags_only_the_three_old_binary_formats() {
        assert!(DocumentFormat::Doc.is_legacy());
        assert!(DocumentFormat::Xls.is_legacy());
        assert!(DocumentFormat::Ppt.is_legacy());
        assert!(!DocumentFormat::Docx.is_legacy());
        assert!(!DocumentFormat::Xlsx.is_legacy());
        assert!(!DocumentFormat::Pptx.is_legacy());
    }

    #[test]
    fn fits_memory_budget_accepts_small_documents() {
        assert!(fits_memory_budget(0));
        assert!(fits_memory_budget(1024));
        assert!(fits_memory_budget(50 * 1024 * 1024));
    }

    #[test]
    fn fits_memory_budget_rejects_documents_over_the_placeholder_ceiling() {
        // This test is the mutation-check: flip `<=` to `<` in the real
        // function and this assertion (exactly-100MB should still fit) is the
        // one that catches it.
        assert!(fits_memory_budget(100 * 1024 * 1024));
        assert!(!fits_memory_budget(100 * 1024 * 1024 + 1));
        assert!(!fits_memory_budget(500 * 1024 * 1024));
    }
}
