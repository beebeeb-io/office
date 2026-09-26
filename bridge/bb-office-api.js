/* -*- Mode: JS; tab-width: 2; indent-tabs-mode: nil -*- */
/*
 * Beebeeb office bridge — page-side half (task 1567 phase 3).
 *
 * Exposes the minimal API a Beebeeb web-app document editor needs:
 *
 *   await bbOffice.open(bytes, filename)   // bytes: Uint8Array, already decrypted
 *   const out = await bbOffice.save()      // out: Uint8Array, ready to re-encrypt
 *
 * Talks to bridge/bb-office-worker.js (running inside the pthread that owns
 * UNO/LO — see that file's header comment for why a direct call cannot just
 * touch `Module.FS`/`file://` URLs) over `Module.uno_main`'s MessagePort. Never
 * touches the network and never writes the bytes to a real path — see
 * docs/EGRESS.md and the task file for why that property matters here.
 *
 * Load this file on the SAME page that loads qt_soffice.html (as a sibling
 * <script>, after the WASM module's own bootstrap script tag) — it only reads
 * the page-global `Module` the LO-WASM bundle already defines there.
 */

(function (global) {
  "use strict";

  var pending = new Map();
  var nextId = 1;
  // listenerId -> callback, for unsolicited events (phase 4). Keyed the same
  // way regardless of event kind (statusChanged/modified/selectionChanged) --
  // each op's own onState/onModifiedChange/onSelectionChange wrapper is what
  // keeps the payload shape kind-specific for the caller.
  var eventSubscribers = new Map();

  // `Module` itself does not exist until qtloader.js's own bootstrap runs
  // (triggered by <body onload="init()">), which happens strictly after this
  // script tag executes if it is loaded as a plain sibling <script> -- so this
  // cannot assume `Module`/`Module.uno_main` exist yet at load time. Poll
  // briefly instead of failing immediately; production call sites (open/save)
  // already await this same promise regardless.
  function waitForModule(timeoutMs) {
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        if (typeof Module !== "undefined" && Module.uno_main) {
          resolve(Module.uno_main);
        } else if (Date.now() - start > timeoutMs) {
          reject(new Error("bb-office-api.js: Module.uno_main never appeared within " + timeoutMs + "ms"));
        } else {
          setTimeout(poll, 100);
        }
      })();
    });
  }

  var portPromise = null;

  function getPort() {
    if (!portPromise) {
      portPromise = waitForModule(60000).then(function (unoMain) {
        return unoMain;
      }).then(function (port) {
        port.onmessage = function (ev) {
          var msg = ev.data;
          if (!msg) return;
          if (msg.event) {
            // Unsolicited event (phase 4: statusChanged/modified/selectionChanged)
            // -- not a reply to any pending call. Dispatch by listenerId.
            var cb = eventSubscribers.get(msg.listenerId);
            if (cb) cb(msg);
            return;
          }
          if (msg.id == null) return; // e.g. the worker's own startup {ready:true}
          var resolver = pending.get(msg.id);
          if (!resolver) return;
          pending.delete(msg.id);
          if (msg.ok) {
            resolver.resolve(msg);
          } else {
            resolver.reject(new Error(msg.error || "bbOffice: unknown error"));
          }
        };
        return port;
      });
    }
    return portPromise;
  }

  function call(op, extra, transferList) {
    return getPort().then(function (port) {
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        pending.set(id, { resolve: resolve, reject: reject });
        var msg = Object.assign({ op: op, id: id }, extra);
        port.postMessage(msg, transferList || []);
      });
    });
  }

  global.bbOffice = {
    /**
     * @param {Uint8Array|ArrayBuffer} bytes already-decrypted document bytes
     * @param {string} filename used only to infer the format (extension); not
     *   written anywhere and never leaves this page
     * @returns {Promise<{ext: string, saveExt: string}>}
     */
    open: function (bytes, filename) {
      var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      // Transfer the underlying buffer to the worker realm -- avoids a copy for
      // large documents; the caller's own Uint8Array view becomes unusable
      // after this call, matching office-bridge's Rust-side "caller zeroes its
      // own buffer" contract.
      return call("open", { bytes: u8, filename: filename }, [u8.buffer]).then(function (msg) {
        return msg.result;
      });
    },
    /** @returns {Promise<Uint8Array>} saved bytes, in the open document's format */
    save: function () {
      return call("save", {}).then(function (msg) {
        return msg.bytes;
      });
    },
    /**
     * Egress-proof helper (task 1567 goal 4): insert an image from bytes
     * already in memory -- never a URL, never touches the FS.
     * @param {Uint8Array|ArrayBuffer} bytes
     * @param {string} mimeType e.g. "image/png"
     */
    insertImage: function (bytes, mimeType) {
      var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return call("insertImage", { bytes: u8, mimeType: mimeType }, [u8.buffer]).then(function (msg) {
        return msg.result;
      });
    },
    /** Egress-proof helper: insert a real, clickable hyperlink. */
    insertHyperlink: function (text, url) {
      return call("insertHyperlink", { text: text, url: url }).then(function (msg) {
        return msg.result;
      });
    },
    /**
     * Test-only: invokes com.sun.star.system.SystemShellExecute directly --
     * the exact UNO service any hyperlink-follow path calls to open a URL.
     * Exposed for the egress-proof suite; not part of the product API surface.
     */
    __testShellExecute: function (url) {
      return call("testShellExecute", { url: url }).then(function (msg) {
        return msg.result;
      });
    },
    /** Test-only diagnostic; not part of the product API surface. */
    __debugChromeState: function () {
      return call("__debugChromeState", {}).then(function (msg) {
        return msg.result;
      });
    },

    // -----------------------------------------------------------------
    // Phase 4 (task 1567 goal 4): UNO dispatch + status listeners, outline,
    // zoom, newDocument, change events. See bb-office-worker.js's header for
    // the wire protocol and the one known gap (no selection screen rect).
    // -----------------------------------------------------------------

    /**
     * Dispatch a .uno: command against the active document, e.g.
     * `bbOffice.dispatch(".uno:Bold")`.
     * @param {string} command a ".uno:" command URL
     * @param {Array<{name: string, value: (string|number|boolean)}>} [args]
     * @returns {Promise<{dispatched: boolean}>}
     */
    dispatch: function (command, args) {
      return call("dispatch", { command: command, args: args }).then(function (msg) {
        return msg.result;
      });
    },

    /**
     * Subscribe to a .uno: command's toggled/enabled state (bold, italic,
     * paragraph style, undo/redo-enabled, zoom, ... -- any command LO itself
     * exposes a FeatureStateEvent for). The callback fires once immediately
     * with the current state (UNO's own addStatusListener guarantee), then
     * again on every change.
     * @param {string} command
     * @param {function({isEnabled: boolean, state: *}): void} cb
     * @returns {Promise<function(): void>} resolves to an unsubscribe function
     */
    onState: function (command, cb) {
      return call("addStatusListener", { command: command }).then(function (msg) {
        var listenerId = msg.listenerId;
        eventSubscribers.set(listenerId, function (evt) {
          cb({ isEnabled: evt.isEnabled, state: evt.state });
        });
        // Delivered as part of THIS reply, not a separate event -- see
        // bb-office-worker.js's doAddStatusListener comment for why a plain
        // event would race this function's own subscriber registration.
        if (msg.initial) cb({ isEnabled: msg.initial.isEnabled, state: msg.initial.state });
        var unsubscribed = false;
        return function unsubscribe() {
          if (unsubscribed) return;
          unsubscribed = true;
          eventSubscribers.delete(listenerId);
          call("removeStatusListener", { listenerId: listenerId }); // best-effort; caller does not need to await this
        };
      });
    },

    /** Subscribe to the active document's modified (dirty) state. */
    onModifiedChange: function (cb) {
      return call("addModifiedListener", {}).then(function (msg) {
        var listenerId = msg.listenerId;
        eventSubscribers.set(listenerId, function (evt) {
          cb(evt.modified);
        });
        var unsubscribed = false;
        return function unsubscribe() {
          if (unsubscribed) return;
          unsubscribed = true;
          eventSubscribers.delete(listenerId);
          call("removeModifiedListener", { listenerId: listenerId });
        };
      });
    },

    /**
     * Subscribe to selection changes. NOTE: carries the selected text only --
     * no screen rect is available (see bb-office-worker.js's "KNOWN GAP").
     */
    onSelectionChange: function (cb) {
      return call("addSelectionListener", {}).then(function (msg) {
        var listenerId = msg.listenerId;
        eventSubscribers.set(listenerId, function (evt) {
          cb({ text: evt.text });
        });
        var unsubscribed = false;
        return function unsubscribe() {
          if (unsubscribed) return;
          unsubscribed = true;
          eventSubscribers.delete(listenerId);
          call("removeSelectionListener", { listenerId: listenerId });
        };
      });
    },

    /**
     * @returns {Promise<Array<{level: number, text: string}>>} Writer headings
     * in document order; empty array for a non-Writer active document.
     */
    getOutline: function () {
      return call("getOutline", {}).then(function (msg) {
        return msg.result;
      });
    },

    /** Moves the view cursor to the i-th heading returned by getOutline(). */
    goToHeading: function (index) {
      return call("goToHeading", { index: index }).then(function (msg) {
        return msg.result;
      });
    },

    /** @param {number} percent e.g. 150 for 150% */
    setZoom: function (percent) {
      return call("setZoom", { percent: percent }).then(function (msg) {
        return msg.result;
      });
    },

    /**
     * Opens a brand-new document, closing whatever is currently open.
     * @param {"writer"|"calc"|"impress"} docKind
     * @param {Uint8Array} [templateBytes] optional template to base it on
     *   (opened with AsTemplate so saving never overwrites the template file)
     */
    /**
     * KNOWN GAP (see bb-office-worker.js's doSetTheme comment): the
     * config write is real and persists, but does NOT cause a live repaint
     * in this build -- resolves to { theme, appliedLive: false } always.
     * Do not present this as "theme switched" to a user; treat it as
     * forward-compatible plumbing until the repaint gap is closed.
     * @param {"light"|"dark"|"auto"} theme
     */
    setTheme: function (theme) {
      return call("setTheme", { theme: theme }).then(function (msg) {
        return msg.result;
      });
    },

    newDocument: function (docKind, templateBytes) {
      var extra = { docKind: docKind };
      var transfer = [];
      if (templateBytes) {
        var u8 = templateBytes instanceof Uint8Array ? templateBytes : new Uint8Array(templateBytes);
        extra.templateBytes = u8;
        transfer.push(u8.buffer);
      }
      return call("newDocument", extra, transfer).then(function (msg) {
        return msg.result;
      });
    },
  };
})(window);
