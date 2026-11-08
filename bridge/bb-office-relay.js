/* -*- Mode: JS; tab-width: 2; indent-tabs-mode: nil -*- */
/*
 * Beebeeb office bridge: the postMessage relay for a host on another origin.
 *
 * The desktop app loads the engine page (bb-office-host.html) from its own
 * `bboffice` scheme, which is a different origin from the app's window. The app
 * therefore cannot read `frame.contentWindow.bbOffice` directly. This script runs
 * on the engine page, next to bb-office-api.js, and relays calls from the parent
 * window to `window.bbOffice` by postMessage.
 *
 * Rules, checked on every message:
 *   - the sender must be `window.parent` (no other window can drive the engine);
 *   - the sender's origin must be in the allowed list (the `data-parent-origins`
 *     attribute of this script's tag, space separated);
 *   - replies go to that exact origin, never "*".
 * Bytes travel as transferable ArrayBuffers, never as base64 or strings.
 *
 * Wire shape (all messages carry `bbOffice: 1`):
 *   parent -> engine  { bbOffice: 1, id, method, args }
 *   engine -> parent  { bbOffice: 1, id, ok: true, value } | { bbOffice: 1, id, ok: false, error }
 *   engine -> parent  { bbOffice: 1, event: <subscription id>, payload }
 * `method: "ready"` answers `true` once the engine takes calls (bbOffice exists
 * and the engine's `Module.uno_main` port is up), else `false`; the parent polls it.
 * Subscriptions (onState, onModifiedChange, onSelectionChange) take the
 * subscription id as their last argument; `method: "unsubscribe", args: [id]` ends one.
 */

(function (global) {
  "use strict";

  var script = global.document && global.document.currentScript;
  var attr = script ? script.getAttribute("data-parent-origins") || "" : "";
  var allowed = attr.split(/\s+/).filter(Boolean);

  // The bridge methods the parent may call. Anything else is refused.
  var CALLS = [
    "open", "save", "insertImage", "insertHyperlink", "dispatch", "getOutline",
    "getDocStats", "goToHeading", "setZoom", "getSlideSize", "newDocument",
    "setTheme", "setWorkspaceColor",
  ];
  var SUBSCRIPTIONS = ["onState", "onModifiedChange", "onSelectionChange"];
  // Which argument of a call carries bytes (an ArrayBuffer on the wire).
  var BYTES_ARG = { open: 0, insertImage: 0, newDocument: 1 };

  var subscriptions = Object.create(null);
  var refused = 0;

  function engineReady() {
    var m = global.Module;
    return !!(global.bbOffice && m && m.uno_main);
  }

  /** A Uint8Array that owns its whole buffer, so the buffer can be transferred. */
  function ownBuffer(u8) {
    return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8 : u8.slice();
  }

  function reply(origin, msg, transfer) {
    msg.bbOffice = 1;
    global.parent.postMessage(msg, origin, transfer || []);
  }

  function run(method, args, origin) {
    if (method === "ready") return Promise.resolve(engineReady());
    if (method === "unsubscribe") {
      var stop = subscriptions[args[0]];
      delete subscriptions[args[0]];
      if (stop) stop();
      return Promise.resolve(true);
    }
    if (!engineReady()) return Promise.reject(new Error("the engine is not ready"));
    var bridge = global.bbOffice;
    if (SUBSCRIPTIONS.indexOf(method) >= 0) {
      var sub = String(args[args.length - 1]);
      var head = args.slice(0, -1);
      head.push(function (payload) {
        reply(origin, { event: sub, payload: payload });
      });
      return bridge[method].apply(bridge, head).then(function (unsub) {
        subscriptions[sub] = unsub;
        return true;
      });
    }
    if (CALLS.indexOf(method) < 0) return Promise.reject(new Error("unknown method " + method));
    var at = BYTES_ARG[method];
    if (at !== undefined && args[at] instanceof ArrayBuffer) args[at] = new Uint8Array(args[at]);
    return bridge[method].apply(bridge, args);
  }

  function onMessage(event) {
    var msg = event.data;
    if (!msg || msg.bbOffice !== 1 || typeof msg.method !== "string") return;
    if (event.source !== global.parent || allowed.indexOf(event.origin) < 0) {
      refused += 1;
      return;
    }
    var origin = event.origin;
    var id = msg.id;
    var args = Array.isArray(msg.args) ? msg.args : [];
    Promise.resolve()
      .then(function () {
        return run(msg.method, args, origin);
      })
      .then(
        function (value) {
          if (value instanceof Uint8Array) {
            var own = ownBuffer(value);
            reply(origin, { id: id, ok: true, value: own.buffer }, [own.buffer]);
          } else {
            reply(origin, { id: id, ok: true, value: value === undefined ? null : value });
          }
        },
        function (err) {
          reply(origin, { id: id, ok: false, error: String((err && err.message) || err) });
        }
      );
  }

  global.addEventListener("message", onMessage);
  // Read-only counters for the harness: how many messages were refused.
  global.bbOfficeRelay = {
    allowedOrigins: function () {
      return allowed.slice();
    },
    refused: function () {
      return refused;
    },
  };
})(window);
