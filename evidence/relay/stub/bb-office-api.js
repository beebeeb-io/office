// STUB ENGINE (harness only, never shipped): the same `window.bbOffice` surface as
// bridge/bb-office-api.js. open() keeps a copy of the bytes, save() hands them back,
// so a round trip proves the bytes crossed both ways intact.
(function () {
  var doc = null;
  var name = null;
  window.bbOffice = {
    open: function (bytes, filename) {
      if (!(bytes instanceof Uint8Array)) return Promise.reject(new Error("open wants a Uint8Array"));
      doc = bytes.slice();
      name = filename;
      var ext = filename.split(".").pop();
      return Promise.resolve({ ext: ext, saveExt: ext });
    },
    save: function () {
      if (!doc) return Promise.reject(new Error("nothing open"));
      return Promise.resolve(doc.slice());
    },
    onModifiedChange: function (cb) {
      var t = setTimeout(function () { cb(true); }, 50);
      return Promise.resolve(function () { clearTimeout(t); });
    },
    onSelectionChange: function () { return Promise.resolve(function () {}); },
    onState: function () { return Promise.resolve(function () {}); },
    getOutline: function () { return Promise.resolve([{ level: 1, text: name || "" }]); },
    getDocStats: function () { return Promise.resolve({ words: 3, characters: 12, language: "English (UK)" }); },
    dispatch: function () { return Promise.resolve({ dispatched: true }); },
    newDocument: function (kind) { doc = new Uint8Array(0); name = "new"; return Promise.resolve({ docKind: kind }); },
    setZoom: function (z) { return Promise.resolve({ zoom: z }); },
    goToHeading: function () { return Promise.resolve({ level: 1, text: name || "" }); },
    getSlideSize: function () { return Promise.resolve(null); },
    insertImage: function () { return Promise.resolve({ inserted: true }); },
    insertHyperlink: function () { return Promise.resolve({ inserted: true }); },
    setTheme: function (t) { return Promise.resolve({ theme: t, appliedLive: false }); },
    setWorkspaceColor: function (rgb) { return Promise.resolve({ applied: true, rgb: rgb }); },
    // Harness only: what the engine page sees about isolation.
    _isolation: function () {
      return { crossOriginIsolated: window.crossOriginIsolated, sab: typeof SharedArrayBuffer };
    },
  };
})();
