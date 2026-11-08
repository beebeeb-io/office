/* -*- Mode: JS; tab-width: 2; indent-tabs-mode: nil -*- */
/*
 * Beebeeb office: boots the engine on bb-office-host.html once the page has loaded.
 * The same steps as the upstream qt_soffice.html's inline init(), moved to a file so
 * the host page has no inline script.
 */
(function (global) {
  "use strict";
  global.addEventListener("load", function () {
    var spinner = document.getElementById("qtspinner");
    var canvas = document.getElementById("qtcanvas");
    var status = document.getElementById("qtstatus");
    canvas.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
    function showSpinner(text) {
      status.textContent = text;
      spinner.style.display = "block";
      canvas.style.display = "none";
    }
    var qtLoader = global.QtLoader({
      canvasElements: [canvas],
      showLoader: function (loaderStatus) {
        showSpinner(loaderStatus + "...");
      },
      showError: function (errorText) {
        showSpinner(errorText);
      },
      showExit: function () {
        var text = "Application exit";
        if (qtLoader.exitCode !== undefined) text += " with code " + qtLoader.exitCode;
        if (qtLoader.exitText !== undefined) text += " (" + qtLoader.exitText + ")";
        showSpinner(text);
      },
      showCanvas: function () {
        spinner.style.display = "none";
        canvas.style.display = "block";
      },
    });
    qtLoader.loadEmscriptenModule("soffice");
  });
})(window);
