// Harness only: the parent half of the relay protocol (the desktop app has its own copy in TypeScript).
(function () {
  var params = new URLSearchParams(location.search);
  var engineOrigin = params.get("engine");
  var frame = document.getElementById("engine");
  frame.src = engineOrigin + "/bb-office-host.html" + (params.get("deny") ? "?deny=1" : "");
  var next = 1;
  var pending = new Map();
  var events = [];
  window.addEventListener("message", function (e) {
    if (e.origin !== engineOrigin || e.source !== frame.contentWindow) return;
    var m = e.data;
    if (!m || m.bbOffice !== 1) return;
    if (m.event !== undefined) { events.push(m); return; }
    var p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.value) : p.reject(new Error(m.error));
  });
  window.relayCall = function (method, args, transfer, timeoutMs) {
    var id = next++;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      frame.contentWindow.postMessage({ bbOffice: 1, id: id, method: method, args: args || [] }, engineOrigin, transfer || []);
      setTimeout(function () {
        if (pending.delete(id)) reject(new Error("timeout"));
      }, timeoutMs || 3000);
    });
  };
  window.relayEvents = events;
})();
