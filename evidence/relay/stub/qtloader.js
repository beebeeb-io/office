// STUB ENGINE (harness only, never shipped): stands in for Qt's qtloader.js. Booting
// "finishes" after 200 ms by creating the `Module.uno_main` port the relay waits for.
window.QtLoader = function (config) {
  return {
    loadEmscriptenModule: function () {
      setTimeout(function () {
        window.Module = { uno_main: {} };
        config.showCanvas();
      }, 200);
    },
  };
};
