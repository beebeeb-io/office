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
 *
 * PHASE 4 ADDITIONS (task 1567 goal 4, 2026-09-27) -- UNO dispatch + status
 * listeners, outline, zoom, newDocument, and change events. Two message
 * shapes now flow over the SAME port:
 *   - request/response (as above): every message has an `id`; exactly one
 *     reply comes back for it.
 *   - unsolicited EVENTS (no `id`): { event: "statusChanged", listenerId, state }
 *                                   { event: "modified", modified: boolean }
 *                                   { event: "selectionChanged", text }
 *     bb-office-api.js's onmessage tells these apart by the presence of
 *     `event` instead of `id`.
 *
 * New request ops:
 *   { op: "dispatch", id, command, args? }
 *     -> { ok, kind: "dispatch" }
 *   { op: "addStatusListener", id, command }
 *     -> { ok, kind: "addStatusListener", listenerId, initial: {isEnabled, state} }
 *        (UNO's addStatusListener guarantees one synchronous callback with the
 *        CURRENT state before it returns -- that value rides THIS reply's
 *        `initial` field rather than a separate "statusChanged" event, since
 *        the latter provably races the caller's own event-subscriber
 *        bookkeeping: confirmed empirically, 2026-09-27, see the comment on
 *        doAddStatusListener. Only LATER real changes arrive as events.)
 *   { op: "removeStatusListener", id, listenerId } -> { ok }
 *   { op: "getOutline", id } -> { ok, kind: "getOutline", result: [{level, text}] }
 *     Writer only; a non-Writer active document returns an empty outline
 *     rather than throwing (no heading concept in Calc/Impress).
 *   { op: "goToHeading", id, index } -> { ok }
 *   { op: "setZoom", id, percent } -> { ok }
 *   { op: "newDocument", id, kind, templateBytes? }
 *     kind: "writer"|"calc"|"impress"; templateBytes optional (Uint8Array) ->
 *     opened with AsTemplate:true so saving never overwrites the template.
 *     -> { ok, kind: "newDocument", result: { docKind } }
 *   { op: "addModifiedListener", id } -> { ok, listenerId }
 *   { op: "removeModifiedListener", id, listenerId } -> { ok }
 *   { op: "addSelectionListener", id } -> { ok, listenerId }
 *   { op: "removeSelectionListener", id, listenerId } -> { ok }
 *
 * KNOWN GAP, not resolved (3 real attempts, documented in the task file's
 * 2026-09-27 phase-4 note): the selectionChanged event carries the selected
 * TEXT, not a screen-pixel rect. com.sun.star.accessibility.XAccessible does
 * not resolve on either the document window or its controller in this build
 * (getAvailableServiceNames() lists zero com.sun.star.accessibility.* service
 * implementations at all), which is the one generic, app-agnostic UNO
 * mechanism that exposes on-screen geometry for an arbitrary selection --
 * this WASM target appears to compile out the accessibility bridge entirely
 * (native AT-SPI/IAccessible2/UIA glue has no WASM equivalent). No rect-based
 * floating-toolbar positioning is possible through UNO alone as a result;
 * the caller would need to derive a rect some other way (e.g. Qt canvas
 * hit-testing) if this is required later.
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

  // Task 1567 goal 2 (phase 4, 2026-09-27): document-only canvas. Every
  // UNO-API-opened document gets its OWN frame/window (confirmed empirically:
  // XFramesSupplier.getFrames() goes from 1 -> 2 after a single
  // loadComponentFromURL call) -- it does NOT automatically become the
  // visible one; the Start Center frame stays on top until something calls
  // toFront()/setVisible(true) on the new window (screenshotted proof:
  // evidence/screenshots/probe-chrome3-tofront.png). This is the ONE function
  // every document-opening path (doOpen, doNewDocument) must call.
  //
  // Hides: menubar, all toolbars, statusbar, sidebar deck (all five are
  // children of the SAME XLayoutManager -- confirmed empirical enumeration
  // showed 15 docked elements under one manager, and
  // XLayoutManager::setVisible(false) hides all of them in one call, more
  // reliable than hiding each by name since toolbar resource URLs differ per
  // module (Writer/Calc/Impress each have their own object-bar names) --
  // .lock() additionally stops LO re-showing a context toolbar later (e.g.
  // Impress's picture toolbar on shape selection)); rulers (off by default in
  // this build for Writer's vertical ruler, ON by default for the horizontal
  // one -- both explicitly forced off here since the ONLY place that
  // property exists is Writer's ViewSettings, wrapped in try/catch since
  // Calc/Impress throw UnknownPropertyException for it, confirmed
  // empirically). Does NOT hide: the native Qt window title bar. Attempted
  // (patches/0005-emscripten-frameless-window-REVERTED.patch,
  // Qt::FramelessWindowHint) and it DID remove the bar, but it also broke the
  // toFront()/setVisible() switch below -- the newly created document's frame
  // stopped becoming the visible one on the shared #qtcanvas at all, tested
  // both ways (evidence/probe-chrome3.js run against both artifacts).
  // Reverted rather than ship a document that opens invisibly. This is an
  // OPEN item -- see that patch file's own notes for the next angle to try
  // (the Qt WASM QPA's window-activation/compositing code) or a host-page
  // CSS crop as a product-level workaround instead of an engine fix. This
  // function also explicitly closes the Start Center (see
  // closeOtherEmptyFrames below) since no config/UNO call makes an
  // ALREADY-CREATED Start Center frame stop
  // being its own separate top-level frame.
  function applyDocumentChrome(model) {
    var css = Module.uno.com.sun.star;
    var controller = getController(model);
    var frame = controller.getFrame();
    var containerWindow = frame.getContainerWindow();

    try {
      var xTopWindow = css.awt.XTopWindow.query(containerWindow);
      if (xTopWindow) xTopWindow.toFront();
      var xWindow = css.awt.XWindow.query(containerWindow);
      xWindow.setVisible(true);
      xWindow.setFocus();
    } catch (e) {
      console.error("bb-office-worker: applyDocumentChrome toFront/setVisible failed:", e);
    }

    try {
      var ps = css.beans.XPropertySet.query(frame);
      var lm = css.frame.XLayoutManager.query(ps.getPropertyValue("LayoutManager").get());
      if (lm) {
        lm.setVisible(false);
        lm.lock();
      }
    } catch (e) {
      /* best-effort */
    }

    try {
      var vss = css.view.XViewSettingsSupplier.query(controller);
      if (vss) {
        var viewSettings = vss.getViewSettings();
        viewSettings.setPropertyValue("ShowHoriRuler", new Module.uno_Any(Module.uno_Type.Boolean(), false));
        viewSettings.setPropertyValue("ShowVertRuler", new Module.uno_Any(Module.uno_Type.Boolean(), false));
      }
    } catch (e) {
      /* Calc/Impress: no ruler properties on their ViewSettings -- not an error */
    }

    closeOtherEmptyFrames(model);
  }

  // Closes every OTHER top-level frame that has no document model at all
  // (the Start Center's own "StartModule" component, or a leftover empty
  // frame) -- never a frame that holds a real document, even an unsaved one.
  function closeOtherEmptyFrames(keepModel) {
    var css = Module.uno.com.sun.star;
    var ctx = Module.getUnoComponentContext();
    var desktop = css.frame.Desktop.create(ctx);
    var framesSupplier = css.frame.XFramesSupplier.query(desktop);
    var frames = framesSupplier.getFrames();
    var n = frames.getCount ? frames.getCount() : frames.size();
    for (var i = 0; i < n; i++) {
      var f = frames.getByIndex ? frames.getByIndex(i).get() : frames.get(i);
      var xf = css.frame.XFrame.query(f);
      var frameController = xf.getController();
      var comp = frameController ? frameController.getModel() : null;
      if (comp === keepModel) continue;
      if (!comp) {
        try {
          xf.close(false);
        } catch (e) {
          /* best-effort */
        }
      }
    }
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
    applyDocumentChrome(model);
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

  // ---------------------------------------------------------------------
  // Phase 4: UNO dispatch, status/modified/selection listeners, outline,
  // zoom, newDocument. See the file header's PROTOCOL section.
  // ---------------------------------------------------------------------

  // The doc opened via bbOffice.open() (state.model) is authoritative when
  // present; otherwise fall back to whatever LO itself currently considers
  // active (a document opened by a real UI click through the Start Center,
  // which never goes through doOpen()). Confirmed empirically (2026-09-27):
  // getCurrentComponent() returns a live, non-null, freshly-queried wrapper
  // each call -- do not compare it by `===` to a previously held reference,
  // just use it directly each time.
  function getActiveModel() {
    if (state.model) return state.model;
    var css = Module.uno.com.sun.star;
    var ctx = Module.getUnoComponentContext();
    var desktop = css.frame.Desktop.create(ctx);
    return css.frame.XDesktop.query(desktop).getCurrentComponent();
  }

  function getController(model) {
    var css = Module.uno.com.sun.star;
    return css.frame.XModel.query(model).getCurrentController();
  }

  // com.sun.star.util.URL (offapi/com/sun/star/util/URL.idl) -- ALL fields
  // must be present on the InOutParam constructor or embind throws
  // "Missing field" (confirmed empirically; the type is not tolerant of a
  // partial object the way a plain-in PropertyValue struct is).
  function parseUnoUrl(commandUrl) {
    var css = Module.uno.com.sun.star;
    var ctx = Module.getUnoComponentContext();
    var InOutURL = Module["uno_InOutParam_com$sun$star$util$URL"];
    var inst = new InOutURL({
      Complete: commandUrl, Main: "", Protocol: "", User: "", Password: "",
      Server: "", Port: 0, Path: "", Name: "", Arguments: "", Mark: "",
    });
    var trans = css.util.URLTransformer.create(ctx);
    trans.parseStrict(inst);
    return inst.val;
  }

  function doDispatch(command, argsList) {
    var css = Module.uno.com.sun.star;
    var model = getActiveModel();
    if (!model) {
      throw new Error("bbOffice.dispatch: no active document");
    }
    var frame = getController(model).getFrame();
    var dp = css.frame.XDispatchProvider.query(frame);
    var url = parseUnoUrl(command);
    var disp = dp.queryDispatch(url, "", 0);
    if (!disp) {
      throw new Error("bbOffice.dispatch: no dispatch handler for " + command);
    }
    var pvs = (argsList || []).map(function (a) {
      var t;
      if (typeof a.value === "boolean") t = Module.uno_Type.Boolean();
      else if (typeof a.value === "number") t = Module.uno_Type.Long();
      else t = Module.uno_Type.String();
      return mkPV(a.name, t, a.value);
    });
    var seq = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(pvs);
    try {
      disp.dispatch(url, seq);
    } finally {
      seq.delete();
    }
    return { dispatched: true };
  }

  // listenerId -> { dispose: function() } for every kind of listener below,
  // in one registry -- the page only ever needs to hand the id back on
  // remove, never cares what kind it was.
  var listeners = {};
  var nextListenerId = 1;

  function doAddStatusListener(port, command) {
    var css = Module.uno.com.sun.star;
    var model = getActiveModel();
    if (!model) {
      throw new Error("bbOffice.onState: no active document");
    }
    var frame = getController(model).getFrame();
    var dp = css.frame.XDispatchProvider.query(frame);
    var url = parseUnoUrl(command);
    var disp = dp.queryDispatch(url, "", 0);
    if (!disp) {
      throw new Error("bbOffice.onState: no dispatch handler for " + command);
    }
    var listenerId = nextListenerId++;
    // UNO's addStatusListener fires ONE synchronous callback with the current
    // state before it returns. If that callback just posts a normal "event"
    // message, it provably races the page's own subscription bookkeeping: the
    // page only calls eventSubscribers.set(listenerId, cb) AFTER this whole
    // op's reply resolves, but this synchronous callback fires (and its
    // postMessage arrives) BEFORE that reply is even sent -- confirmed
    // empirically (2026-09-27, evidence/probe-api-e2e.js): the initial value
    // was silently dropped, only later real toggles came through. Fix: buffer
    // the first callback and return it as part of THIS op's own reply instead
    // of as a separate event -- no race is possible on a value carried by the
    // reply the caller is already awaiting.
    var gotInitial = false;
    var initialState = null;
    var listenerObj = {
      statusChanged: function (evt) {
        var value;
        try {
          value = evt.State.get();
        } catch (e) {
          value = null;
        }
        var payload = { isEnabled: !!evt.IsEnabled, state: value };
        if (!gotInitial) {
          gotInitial = true;
          initialState = payload;
          return;
        }
        port.postMessage({
          event: "statusChanged",
          listenerId: listenerId,
          command: command,
          isEnabled: payload.isEnabled,
          state: payload.state,
        });
      },
      disposing: function () {},
    };
    var ref = Module.unoObject(["com.sun.star.frame.XStatusListener"], listenerObj);
    var xStatusListener = css.frame.XStatusListener.query(ref);
    disp.addStatusListener(xStatusListener, url); // fires the current state synchronously, into initialState above
    listeners[listenerId] = {
      dispose: function () {
        disp.removeStatusListener(xStatusListener, url);
      },
    };
    return { listenerId: listenerId, initial: initialState };
  }

  function doAddModifiedListener(port) {
    var css = Module.uno.com.sun.star;
    var model = getActiveModel();
    if (!model) {
      throw new Error("bbOffice.onModifiedChange: no active document");
    }
    var xModifiable = css.util.XModifiable.query(model);
    var listenerId = nextListenerId++;
    var listenerObj = {
      modified: function () {
        var modified = false;
        try {
          modified = !!xModifiable.isModified();
        } catch (e) {
          /* document may be closing */
        }
        port.postMessage({ event: "modified", listenerId: listenerId, modified: modified });
      },
      disposing: function () {},
    };
    var ref = Module.unoObject(["com.sun.star.util.XModifyListener"], listenerObj);
    var xModifyListener = css.util.XModifyListener.query(ref);
    xModifiable.addModifyListener(xModifyListener);
    listeners[listenerId] = {
      dispose: function () {
        xModifiable.removeModifyListener(xModifyListener);
      },
    };
    return listenerId;
  }

  function doAddSelectionListener(port) {
    // See the file header's "KNOWN GAP" note: no screen rect is available in
    // this build (no accessibility bridge). This reports the selected text
    // only.
    var css = Module.uno.com.sun.star;
    var model = getActiveModel();
    if (!model) {
      throw new Error("bbOffice.onSelectionChange: no active document");
    }
    var controller = getController(model);
    var xSelSupplier = css.view.XSelectionSupplier.query(controller);
    var listenerId = nextListenerId++;
    var listenerObj = {
      selectionChanged: function () {
        var text = "";
        try {
          var sel = xSelSupplier.getSelection();
          var xTextRange = css.text.XTextRange.query(sel && sel.get ? sel.get() : sel);
          if (xTextRange) text = xTextRange.getString();
        } catch (e) {
          /* non-text selection (e.g. a Calc cell range, a Draw shape) -- not
             an error, just nothing to report as text */
        }
        port.postMessage({ event: "selectionChanged", listenerId: listenerId, text: text });
      },
      disposing: function () {},
    };
    var ref = Module.unoObject(["com.sun.star.view.XSelectionChangeListener"], listenerObj);
    var xListener = css.view.XSelectionChangeListener.query(ref);
    xSelSupplier.addSelectionChangeListener(xListener);
    listeners[listenerId] = {
      dispose: function () {
        xSelSupplier.removeSelectionChangeListener(xListener);
      },
    };
    return listenerId;
  }

  function doRemoveListener(listenerId) {
    var l = listeners[listenerId];
    if (!l) return { removed: false };
    delete listeners[listenerId];
    l.dispose();
    return { removed: true };
  }

  // Writer-only; the heading paragraph style convention ("Heading 1".."Heading
  // 10") is the internal, locale-independent UNO ParaStyleName -- confirmed
  // against the running document (2026-09-27 probes), not the localized
  // display name a user sees in the sidebar.
  var HEADING_RE = /^Heading (\d+)$/;

  function enumerateHeadingParagraphs(model) {
    var css = Module.uno.com.sun.star;
    var xTextDocument = css.text.XTextDocument.query(model);
    if (!xTextDocument) return [];
    var xText = xTextDocument.getText();
    var enumAccess = css.container.XEnumerationAccess.query(xText);
    var en = enumAccess.createEnumeration();
    var headings = [];
    while (en.hasMoreElements()) {
      var anyEl = en.nextElement();
      var parEl = anyEl.get ? anyEl.get() : anyEl;
      var parProps = css.beans.XPropertySet.query(parEl);
      var styleName = "";
      try {
        styleName = parProps.getPropertyValue("ParaStyleName").get();
      } catch (e) {
        continue;
      }
      var m = HEADING_RE.exec(styleName);
      if (!m) continue;
      var parRange = css.text.XTextRange.query(parEl);
      headings.push({ level: parseInt(m[1], 10), text: parRange.getString(), range: parRange });
    }
    return headings;
  }

  function doGetOutline() {
    var model = getActiveModel();
    if (!model) return [];
    return enumerateHeadingParagraphs(model).map(function (h) {
      return { level: h.level, text: h.text };
    });
  }

  function doGoToHeading(index) {
    var model = getActiveModel();
    if (!model) {
      throw new Error("bbOffice.goToHeading: no active document");
    }
    var headings = enumerateHeadingParagraphs(model);
    var h = headings[index];
    if (!h) {
      throw new Error("bbOffice.goToHeading: no heading at index " + index + " (outline has " + headings.length + ")");
    }
    var css = Module.uno.com.sun.star;
    var controller = getController(model);
    var vcs = css.text.XTextViewCursorSupplier.query(controller);
    if (!vcs) {
      throw new Error("bbOffice.goToHeading: active document has no text view cursor");
    }
    var viewCursor = vcs.getViewCursor();
    viewCursor.gotoRange(h.range.getStart(), false);
    return { level: h.level, text: h.text };
  }

  // Zoom is NOT uniform across apps (confirmed empirically, 2026-09-27):
  // Writer's controller implements com.sun.star.view.XViewSettingsSupplier,
  // whose getViewSettings() is a SEPARATE XPropertySet carrying ZoomValue --
  // querying XPropertySet directly on the Writer controller itself succeeds
  // (query does not throw) but getPropertyValue("ZoomValue") then throws
  // UnknownPropertyException, so this order matters, it is not just
  // defensive. Calc and Impress controllers have NO XViewSettingsSupplier at
  // all (query returns null, no exception) and instead expose ZoomValue as a
  // property directly ON the controller.
  function getZoomPropertySet(controller) {
    var css = Module.uno.com.sun.star;
    var vss = css.view.XViewSettingsSupplier.query(controller);
    if (vss) return vss.getViewSettings(); // Writer
    return css.beans.XPropertySet.query(controller); // Calc / Impress
  }

  function doSetZoom(percent) {
    var model = getActiveModel();
    if (!model) {
      throw new Error("bbOffice.setZoom: no active document");
    }
    var controller = getController(model);
    var propSet = getZoomPropertySet(controller);
    if (!propSet) {
      throw new Error("bbOffice.setZoom: active document has no zoom property set");
    }
    // ZoomValue is a `short` (offapi com.sun.star.view.ViewSettings); no
    // ZoomType change (stays whatever the user last picked, e.g. "page width").
    propSet.setPropertyValue("ZoomValue", new Module.uno_Any(Module.uno_Type.Short(), percent));
    return { zoom: percent };
  }

  var FACTORY_URL = { writer: "private:factory/swriter", calc: "private:factory/scalc", impress: "private:factory/simpress" };

  // Task 1567 goal 3 (theming), 2026-09-27 -- KNOWN GAP, documented not
  // hidden. Writes org.openoffice.Office.Common/Appearance/ApplicationAppearance
  // (0=auto,1=light,2=dark) and .../Misc/SymbolStyle (icon theme). The WRITE
  // is real and verified (read back correctly via a fresh
  // ConfigurationAccess immediately after commitChanges()) -- confirmed
  // 2026-09-27 via evidence/probe-theme.js. What is NOT proven, after 3 real
  // attempts, each a genuinely different angle: (1) setting it after a
  // document is already open and screenshotting -- no visible change; (2)
  // opening a BRAND NEW document/window after the write -- still the old
  // theme; (3) setting it as early as JS can possibly run (immediately on
  // Module.uno_init resolving, before any document is opened) -- still no
  // effect on the Start Center or any window opened afterward. Working
  // theory: color scheme / icon theme resolution happens once, very early in
  // Desktop::Main() startup, well before UNO scripting is wired up at all,
  // and is cached for the process lifetime with no UNO-reachable broadcast to
  // invalidate it. This function is still provided (the write half is
  // correct and will matter once a live-repaint path is found, or if a
  // future build pre-seeds the config file before boot) -- but calling it on
  // a running document must NOT be presented to a user as "theme switched".
  function doSetTheme(theme) {
    var css = Module.uno.com.sun.star;
    var ctx = Module.getUnoComponentContext();
    function getSingleton(name) {
      var any = ctx.getValueByName("/singletons/" + name);
      return any.get();
    }
    function setConfig(path, propName, value, unoType) {
      var cp = css.lang.XMultiServiceFactory.query(getSingleton("com.sun.star.configuration.theDefaultProvider"));
      var pv = mkPV("nodepath", Module.uno_Type.String(), path);
      var pvAny = new Module.uno_Any(Module.uno_Type.Struct("com.sun.star.beans.PropertyValue"), pv);
      var argSeq = new Module.uno_Sequence_any([pvAny]);
      var access = cp.createInstanceWithArguments("com.sun.star.configuration.ConfigurationUpdateAccess", argSeq);
      argSeq.delete();
      var ps = css.beans.XPropertySet.query(access);
      ps.setPropertyValue(propName, new Module.uno_Any(unoType, value));
      css.util.XChangesBatch.query(access).commitChanges();
    }
    var appearance = theme === "dark" ? 2 : theme === "light" ? 1 : 0;
    var symbolStyle = theme === "dark" ? "colibre_dark_svg" : "colibre_svg";
    setConfig("/org.openoffice.Office.Common/Appearance", "ApplicationAppearance", appearance, Module.uno_Type.Short());
    setConfig("/org.openoffice.Office.Common/Misc", "SymbolStyle", symbolStyle, Module.uno_Type.String());
    return { theme: theme, appliedLive: false }; // see the function comment: write succeeds, repaint does not happen
  }

  function doNewDocument(kind, templateBytesU8) {
    var css = Module.uno.com.sun.star;
    var ctx = Module.getUnoComponentContext();
    var desktop = css.frame.Desktop.create(ctx);
    var factoryUrl = FACTORY_URL[kind];
    if (!factoryUrl) {
      throw new Error("bbOffice.newDocument: unknown kind " + kind);
    }
    var pvs = [];
    var loadUrl = factoryUrl;
    var seqToDelete = null;
    if (templateBytesU8 && templateBytesU8.length) {
      var seq = new Module.uno_Sequence_byte(toSignedByteArray(templateBytesU8));
      var inputStream = css.io.SequenceInputStream.createStreamFromSequence(ctx, seq);
      seq.delete();
      pvs.push(mkPV("InputStream", Module.uno_Type.Interface("com.sun.star.io.XInputStream"), inputStream));
      pvs.push(mkPV("AsTemplate", Module.uno_Type.Boolean(), true));
      loadUrl = "private:stream";
    }
    var args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(pvs);
    var model;
    try {
      model = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(loadUrl, "_blank", 0, args);
    } finally {
      args.delete();
    }
    if (!model) {
      throw new Error("bbOffice.newDocument: loadComponentFromURL returned null for " + kind);
    }
    if (state.model) {
      try {
        css.util.XCloseable.query(state.model).close(false);
      } catch (e) {
        /* best-effort */
      }
    }
    state.model = model;
    state.saveExt = kind === "writer" ? "docx" : kind === "calc" ? "xlsx" : "pptx";
    state.openFilename = null;
    applyDocumentChrome(model);
    return { docKind: kind };
  }

  // Test-only diagnostic (task 1567 goal 5's chrome-hiding proof): a durable,
  // numeric assertion surface so the Playwright suite does not rely on
  // screenshots alone (screenshots rot; a boolean does not). Not part of the
  // product API surface (no JSDoc entry in bb-office-api.js), same pattern as
  // __testShellExecute above.
  function doDebugChromeState() {
    var css = Module.uno.com.sun.star;
    var model = getActiveModel();
    if (!model) return { hasModel: false };
    var controller = getController(model);
    var frame = controller.getFrame();
    var ps = css.beans.XPropertySet.query(frame);
    var lm = css.frame.XLayoutManager.query(ps.getPropertyValue("LayoutManager").get());
    return { hasModel: true, layoutManagerVisible: !!lm.isVisible() };
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
          } else if (msg.op === "dispatch") {
            var dispatchResult = doDispatch(msg.command, msg.args);
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "dispatch", result: dispatchResult });
          } else if (msg.op === "addStatusListener") {
            var statusListenerResult = doAddStatusListener(Module.uno_mainPort, msg.command);
            reply(Module.uno_mainPort, msg.id, {
              ok: true,
              kind: "addStatusListener",
              listenerId: statusListenerResult.listenerId,
              initial: statusListenerResult.initial,
            });
          } else if (msg.op === "removeStatusListener") {
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "removeStatusListener", result: doRemoveListener(msg.listenerId) });
          } else if (msg.op === "addModifiedListener") {
            var modListenerId = doAddModifiedListener(Module.uno_mainPort);
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "addModifiedListener", listenerId: modListenerId });
          } else if (msg.op === "removeModifiedListener") {
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "removeModifiedListener", result: doRemoveListener(msg.listenerId) });
          } else if (msg.op === "addSelectionListener") {
            var selListenerId = doAddSelectionListener(Module.uno_mainPort);
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "addSelectionListener", listenerId: selListenerId });
          } else if (msg.op === "removeSelectionListener") {
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "removeSelectionListener", result: doRemoveListener(msg.listenerId) });
          } else if (msg.op === "getOutline") {
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "getOutline", result: doGetOutline() });
          } else if (msg.op === "goToHeading") {
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "goToHeading", result: doGoToHeading(msg.index) });
          } else if (msg.op === "setZoom") {
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "setZoom", result: doSetZoom(msg.percent) });
          } else if (msg.op === "newDocument") {
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "newDocument", result: doNewDocument(msg.docKind, msg.templateBytes) });
          } else if (msg.op === "setTheme") {
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "setTheme", result: doSetTheme(msg.theme) });
          } else if (msg.op === "__debugChromeState") {
            reply(Module.uno_mainPort, msg.id, { ok: true, kind: "__debugChromeState", result: doDebugChromeState() });
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
