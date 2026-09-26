/* -*- Mode: JS; tab-width: 2; indent-tabs-mode: nil -*- */
/*
 * Beebeeb office bridge — pthread-side half (task 1567 phase 3).
 *
 * WHY THIS FILE EXISTS AND WHAT PROBLEM IT SOLVES
 * ------------------------------------------------
 * LibreOffice-WASM built with `-sPROXY_TO_PTHREAD=1` runs `main()` (and therefore
 * all of UNO/UCB/VCL) on a spawned pthread Worker, not on the page's own JS
 * context. Each Worker — the page, and every pthread — gets its OWN, independent
 * Emscripten MEMFS instance; they do not share a filesystem. We proved this
 * empirically (2026-09-27, see the task 1567 file's dated note and
 * evidence/probe-*.js): a file written via the page-reachable `FS.writeFile()` is
 * invisible to `com.sun.star.ucb.SimpleFileAccess.exists()` running in the SAME
 * JS realm, and the reverse (a UCB-side `openFileWrite` write) is invisible to
 * that realm's own `FS.readFile()`. `loadComponentFromURL("file://...")` and
 * `storeToURL("file://...")` are therefore NOT the right mechanism for getting
 * decrypted bytes in and re-encryptable bytes out of this build — no source
 * patch closes that gap; UCB dispatches real file I/O to LO's own background
 * thread pool, whose MEMFS is a third, separate instance again.
 *
 * THE MECHANISM THAT ACTUALLY WORKS: skip `file://`/UCB entirely and use UNO's
 * own in-memory stream API — `com.sun.star.io.SequenceInputStream` (wraps a raw
 * byte sequence as XInputStream) and `com.sun.star.io.SequenceOutputStream`
 * (an XOutputStream that accumulates written bytes and hands them back via
 * `XSequenceOutputStream.getWrittenBytes()`). Passed via the MediaDescriptor's
 * "InputStream"/"OutputStream" properties with a placeholder "private:stream"
 * URL, these never touch UCB's file provider or any background thread — the
 * whole load/edit/save cycle stays on the ONE pthread that owns UNO, which is
 * exactly the same in-memory mechanism already proven working for
 * `private:factory/*` documents in Phase 2. No source patch, no rebuild needed
 * for the byte-marshaling mechanism itself.
 *
 * HOW THIS FILE GETS INTO THE PTHREAD AT ALL: LibreOffice's own
 * `desktop/source/app/initjsunoscripting.cxx` ("LOWA channel") already ships a
 * mechanism for exactly this — the page reads `Module["uno_scripts"]` (a URL
 * list) INSIDE the pthread via `emscripten::val::module_property`, imports each
 * one with `importScripts()` (so it runs in the pthread's own JS realm, with
 * direct access to that realm's `Module`/`Module.uno`), and separately hands the
 * PAGE a `MessagePort` (`Module.uno_main` resolves with it) whose other end is
 * `Module.uno_mainPort`, live inside the pthread. We did not need to patch or
 * rebuild LO to use this — it already ships in the Phase 2 artifact. The one
 * real constraint (proved empirically): `uno_scripts` must be visible to the
 * PTHREAD's own `Module` object at pthread-spawn time. Emscripten's generated
 * pthread bootstrap only forwards a small fixed set of Module keys
 * (`onExit`/`onAbort`/`print`/`printErr`, `wasmMemory`, `wasmModule`, `workerID`)
 * to each new Worker — setting `Module.uno_scripts` on the PAGE alone is
 * silently ignored inside the pthread. The reproducible fix is a one-line
 * `--post-js` snippet at LO-WASM link time (`Module.uno_scripts =
 * Module.uno_scripts || ["/bridge/bb-office-worker.js"];`, placed right after
 * the generated `var Module = typeof Module != "undefined" ? Module : {}`
 * bootstrap line) — see build/wasm.sh's `POST_JS` step. This one line runs
 * identically in every realm the shared JS bundle is loaded into (page AND
 * every pthread), which is why it reaches the pthread when a page-only global
 * assignment does not.
 *
 * PROTOCOL (page <-> this file, over Module.uno_mainPort / Module.uno_main):
 *   page -> worker: { op: "open", id, bytes: Uint8Array, filename: string }
 *                    { op: "save", id }
 *   worker -> page: { id, ok: true, kind: "open", result: { ext } }
 *                    { id, ok: true, kind: "save", bytes: Uint8Array }
 *                    { id, ok: false, error: string }
 *                    { ready: true }                          (once, at startup)
 *
 * One document open at a time (matches task 1567's minimal API ask). Opening a
 * second document closes the first.
 */

(function () {
  "use strict";

  // Canonical LO filter names (confirmed against
  // filter/source/config/fragments/filters/*.xcu's oor:name on the exact pinned
  // commit — these are NOT guessed from the file extension convention).
  var FILTER_BY_EXT = {
    docx: "MS Word 2007 XML",
    xlsx: "Calc MS Excel 2007 XML",
    pptx: "Impress MS PowerPoint 2007 XML",
    // Legacy formats: read-only entry points per task 1567 goal 3's own allowance
    // ("legacy .doc/.xls/.ppt opens read (save as the modern format is
    // acceptable)") — save() always targets the modern filter for the session's
    // format family, chosen in doOpen() below.
    doc: "MS Word 97",
    xls: "MS Excel 97",
    ppt: "MS PowerPoint 97",
  };

  // When a legacy format is opened, save() targets this modern equivalent
  // instead of re-writing the legacy binary format.
  var MODERN_EQUIVALENT = { doc: "docx", xls: "xlsx", ppt: "pptx" };

  var state = { model: null, saveExt: null, openFilename: null };

  function extOf(filename) {
    var m = /\.([a-zA-Z0-9]+)$/.exec(filename || "");
    return m ? m[1].toLowerCase() : "";
  }

  function mkPV(name, unoType, value) {
    return {
      Name: name,
      Handle: -1,
      Value: new Module.uno_Any(unoType, value),
      State: 0,
    };
  }

  function toSignedByteArray(bytesU8) {
    // uno_Sequence_byte maps to C++ `signed char` ([-128,127]); Int8Array's
    // constructor performs the correct two's-complement wraparound for values
    // in [128,255], which Array.from() then hands to embind as plain numbers.
    return Array.from(new Int8Array(bytesU8.buffer, bytesU8.byteOffset, bytesU8.length));
  }

  function fromSignedByteSequence(seq) {
    var size = seq.size();
    var out = new Uint8Array(size);
    for (var i = 0; i < size; i++) {
      var v = seq.get(i);
      out[i] = v < 0 ? v + 256 : v;
    }
    return out;
  }

  function doOpen(bytesU8, filename) {
    var css = Module.uno.com.sun.star;
    var ctx = Module.getUnoComponentContext();
    var desktop = css.frame.Desktop.create(ctx);

    var seq = new Module.uno_Sequence_byte(toSignedByteArray(bytesU8));
    var inputStream = css.io.SequenceInputStream.createStreamFromSequence(ctx, seq);
    seq.delete();

    var ext = extOf(filename);
    var pvs = [mkPV("InputStream", Module.uno_Type.Interface("com.sun.star.io.XInputStream"), inputStream)];
    var openFilter = FILTER_BY_EXT[ext];
    if (openFilter) {
      pvs.push(mkPV("FilterName", Module.uno_Type.String(), openFilter));
    }
    var args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(pvs);
    var model;
    try {
      model = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
        "private:stream",
        "_blank",
        0,
        args
      );
    } finally {
      args.delete();
    }
    if (!model) {
      throw new Error("loadComponentFromURL returned null for " + filename + " (filter " + openFilter + ")");
    }

    if (state.model) {
      try {
        css.util.XCloseable.query(state.model).close(false);
      } catch (e) {
        /* best-effort; the new document is authoritative regardless */
      }
    }

    state.model = model;
    state.saveExt = MODERN_EQUIVALENT[ext] || ext;
    state.openFilename = filename;
    return { ext: ext, saveExt: state.saveExt };
  }

  function doSave() {
    if (!state.model) {
      throw new Error("bbOffice.save() called with no document open");
    }
    var css = Module.uno.com.sun.star;
    var ctx = Module.getUnoComponentContext();
    var filterName = FILTER_BY_EXT[state.saveExt];
    if (!filterName) {
      throw new Error("no save filter mapping for ." + state.saveExt);
    }

    var outStream = css.io.SequenceOutputStream.create(ctx);
    var pvs = [
      mkPV("OutputStream", Module.uno_Type.Interface("com.sun.star.io.XOutputStream"), outStream),
      mkPV("FilterName", Module.uno_Type.String(), filterName),
    ];
    var args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(pvs);
    try {
      css.frame.XStorable.query(state.model).storeToURL("private:stream", args);
    } finally {
      args.delete();
    }

    var xSeqOut = css.io.XSequenceOutputStream.query(outStream);
    var written = xSeqOut.getWrittenBytes();
    var out = fromSignedByteSequence(written);
    written.delete();
    return out;
  }

  function doInsertImage(bytesU8, mimeType) {
    // Task 1567 goal 4's "insert an image (from bytes put into the FS, not a
    // URL)" step. Same principle as doOpen/doSave: no file://, no fetch -- the
    // image bytes go into a SequenceInputStream, com.sun.star.graphic.GraphicProvider
    // decodes it in-memory into an XGraphic, which is then inserted directly as
    // a TextGraphicObject at the current text cursor. Zero network paths, zero
    // MEMFS involvement.
    if (!state.model) {
      throw new Error("bbOffice insertImage: no document open");
    }
    var css = Module.uno.com.sun.star;
    var ctx = Module.getUnoComponentContext();

    var seq = new Module.uno_Sequence_byte(toSignedByteArray(bytesU8));
    var inputStream = css.io.SequenceInputStream.createStreamFromSequence(ctx, seq);
    seq.delete();

    var provider = css.graphic.GraphicProvider.create(ctx);
    var pv = mkPV("InputStream", Module.uno_Type.Interface("com.sun.star.io.XInputStream"), inputStream);
    var mediaProps = new Module.uno_Sequence_com$sun$star$beans$PropertyValue([pv]);
    var graphic;
    try {
      graphic = provider.queryGraphic(mediaProps);
    } finally {
      mediaProps.delete();
    }
    if (!graphic) {
      throw new Error("GraphicProvider.queryGraphic returned null for " + mimeType);
    }

    var xTextDocument = css.text.XTextDocument.query(state.model);
    if (!xTextDocument) {
      throw new Error("bbOffice insertImage: current document is not a text document");
    }
    var xText = xTextDocument.getText();
    // Content objects that become part of a document's own model must be
    // created via THAT document's own service factory (XMultiServiceFactory),
    // not the process-global component context's service manager -- the
    // latter returns null for document-content services like this one
    // (confirmed empirically, 2026-09-27: see task 1567 phase 3 notes).
    var xDocFactory = css.lang.XMultiServiceFactory.query(state.model);
    var xGraphicObject = xDocFactory.createInstance("com.sun.star.text.TextGraphicObject");
    var xGraphicObjectProps = css.beans.XPropertySet.query(xGraphicObject);
    xGraphicObjectProps.setPropertyValue("Graphic", new Module.uno_Any(Module.uno_Type.Interface("com.sun.star.graphic.XGraphic"), graphic));
    xGraphicObjectProps.setPropertyValue(
      "AnchorType",
      new Module.uno_Any(
        Module.uno_Type.Enum("com.sun.star.text.TextContentAnchorType"),
        css.text.TextContentAnchorType.AS_CHARACTER
      )
    );
    var xCursor = xText.createTextCursorByRange(xText.getEnd());
    xText.insertTextContent(xCursor, css.text.XTextContent.query(xGraphicObject), false);
    return { inserted: true };
  }

  function doInsertHyperlink(displayText, url) {
    // Task 1567 goal 4's hyperlink-click egress step. Inserts real, clickable
    // hyperlink text at the end of the current document via the standard
    // "HyperLinkURL" text-cursor property (no navigation happens on insert --
    // only a later real click exercises patches/0002-hyperlink-no-navigate.patch).
    if (!state.model) {
      throw new Error("bbOffice insertHyperlink: no document open");
    }
    var css = Module.uno.com.sun.star;
    var xTextDocument = css.text.XTextDocument.query(state.model);
    if (!xTextDocument) {
      throw new Error("bbOffice insertHyperlink: current document is not a text document");
    }
    var xText = xTextDocument.getText();
    var xCursor = xText.createTextCursorByRange(xText.getEnd());
    xText.insertControlCharacter(xCursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
    var xCursorProps = css.beans.XPropertySet.query(xCursor);
    xCursorProps.setPropertyValue("HyperLinkURL", new Module.uno_Any(Module.uno_Type.String(), url));
    xText.insertString(xCursor, displayText, false);
    return { inserted: true };
  }

  function doTestShellExecute(url) {
    // Task 1567 goal 4's hyperlink-click egress step, direct-mechanism form.
    // com.sun.star.system.SystemShellExecute is the ONE and ONLY UNO service
    // any hyperlink-follow code path in this build funnels through to open a
    // URL (confirmed by reading shell/source/unix/exec/shellexec.cxx's
    // __EMSCRIPTEN__ branch -- see docs/EGRESS.md #10) -- patch
    // 0002-hyperlink-no-navigate.patch replaces its body with a
    // `beebeeb:hyperlink` DOM CustomEvent dispatch instead of window.open().
    // Calling it directly here exercises the exact same C++ code a real
    // hyperlink click invokes, without depending on Playwright's synthetic
    // mouse events correctly triggering LO's own click-to-follow detection
    // (a separate, not-yet-calibrated UI-automation question -- see the task
    // file's dated note).
    var css = Module.uno.com.sun.star;
    var ctx = Module.getUnoComponentContext();
    var sse = css.system.SystemShellExecute.create(ctx);
    sse.execute(url, "", 0);
    return { executed: true };
  }

  function reply(port, id, extra) {
    var msg = Object.assign({ id: id }, extra);
    var transfer = msg.bytes instanceof Uint8Array ? [msg.bytes.buffer] : undefined;
    port.postMessage(msg, transfer);
  }

  Module.uno_init
    .then(function () {
      if (!Module.uno_mainPort) {
        console.error("bb-office-worker: uno_init resolved but uno_mainPort is missing");
        return;
      }
      Module.uno_mainPort.onmessage = function (ev) {
        var msg = ev.data;
        if (!msg || typeof msg.op !== "string") return;
        try {
          if (msg.op === "open") {
            var result = doOpen(msg.bytes, msg.filename);
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "open", result: result });
          } else if (msg.op === "save") {
            var bytes = doSave();
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "save", bytes: bytes });
          } else if (msg.op === "insertImage") {
            var imgResult = doInsertImage(msg.bytes, msg.mimeType);
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "insertImage", result: imgResult });
          } else if (msg.op === "insertHyperlink") {
            var linkResult = doInsertHyperlink(msg.text, msg.url);
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "insertHyperlink", result: linkResult });
          } else if (msg.op === "testShellExecute") {
            var shellResult = doTestShellExecute(msg.url);
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "testShellExecute", result: shellResult });
          } else {
            reply(Module.uno_mainPort, msg.id, { ok: false, error: "unknown op: " + msg.op });
          }
        } catch (e) {
          reply(Module.uno_mainPort, msg.id, { ok: false, error: e && e.toString ? e.toString() : String(e) });
        }
      };
      Module.uno_mainPort.postMessage({ ready: true });
    })
    .catch(function (e) {
      console.error("bb-office-worker: Module.uno_init rejected:", e);
    });
})();
