// One-off ground-truth probe (task 1567 fix pass): enumerate real UNO
// property names for (a) ViewSettings scrollbar-related props on
// Writer/Calc/Impress, (b) the ColorScheme config node's children, and
// (c) confirm DocumentZoomType enum numeric values via ZoomType readback.
// Never touches repos/office source; read-only against the already-built
// artifact via the existing evidence/serve harness.
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let mainWorker = null;
  page.on("worker", (w) => { if (!mainWorker) mainWorker = w; });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);

  const result = await mainWorker.evaluate(() => {
    return Module.uno_init.then(function () {
      const css = Module.uno.com.sun.star;
      const ctx = Module.getUnoComponentContext();
      const desktop = css.frame.Desktop.create(ctx);
      const out = {};

      function openDoc(url) {
        var args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        var model = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(url, "_blank", 0, args);
        args.delete();
        var controller = css.frame.XModel.query(model).getCurrentController();
        var win = controller.getFrame().getContainerWindow();
        var top = css.awt.XTopWindow.query(win);
        if (top) top.toFront();
        css.awt.XWindow.query(win).setVisible(true);
        return { model: model, controller: controller };
      }

      function listViewSettingsProps(controller) {
        try {
          var vss = css.view.XViewSettingsSupplier.query(controller);
          if (!vss) return { error: "no XViewSettingsSupplier" };
          var vs = vss.getViewSettings();
          var ps = css.beans.XPropertySet.query(vs);
          var info = ps.getPropertySetInfo();
          var props = info.getProperties();
          var n = props.getLength ? props.getLength() : props.length;
          var names = [];
          for (var i = 0; i < n; i++) {
            var p = props.get ? props.get(i) : props[i];
            names.push(p.Name);
          }
          return { names: names };
        } catch (e) {
          return { error: e && e.toString ? e.toString() : String(e) };
        }
      }

      function tryGet(controller, prop) {
        try {
          var vss = css.view.XViewSettingsSupplier.query(controller);
          var vs = vss.getViewSettings();
          var ps = css.beans.XPropertySet.query(vs);
          var v = ps.getPropertyValue(prop);
          return v && v.get ? v.get() : v;
        } catch (e) {
          return "ERR:" + (e && e.toString ? e.toString() : String(e));
        }
      }

      // (a) ViewSettings enumeration, Writer/Calc/Impress
      out.writer = {};
      var w = openDoc("private:factory/swriter");
      out.writer.viewSettingsProps = listViewSettingsProps(w.controller);
      ["ZoomType", "ZoomValue"].forEach(function (p) { out.writer[p] = tryGet(w.controller, p); });

      out.calc = {};
      var c = openDoc("private:factory/scalc");
      out.calc.viewSettingsProps = listViewSettingsProps(c.controller);

      out.impress = {};
      var im = openDoc("private:factory/simpress");
      out.impress.viewSettingsProps = listViewSettingsProps(im.controller);
      ["ZoomType", "ZoomValue"].forEach(function (p) { out.impress[p] = tryGet(im.controller, p); });

      // (a2) Scrollbar candidate props tried directly (Writer ViewSettings'
      // own getPropertySetInfo().getProperties() came back empty -- this
      // implementation doesn't support introspection -- so brute-force a
      // candidate list via getPropertyValue + catch instead.
      function tryCandidates(getPropSet, candidates) {
        var found = {};
        candidates.forEach(function (name) {
          try {
            var ps = getPropSet();
            var v = ps.getPropertyValue(name);
            found[name] = v && v.get ? v.get() : v;
          } catch (e) {
            // leave absent -- property doesn't exist on this object
          }
        });
        return found;
      }
      var scrollCandidates = [
        "ShowVertScrollBar", "ShowHoriScrollBar", "IsVertScrollBarVisible", "IsHoriScrollBarVisible",
        "HasVerticalScrollBar", "HasHorizontalScrollBar", "VScrollBar", "HScrollBar",
        "ShowVerticalScrollBar", "ShowHorizontalScrollBar", "IsVertScrollBar", "IsHoriScrollBar",
        "ScrollBarWidth", "ShowScrollBar", "ShowColumnRowHeaders", "HasColumnRowHeaders",
        "ShowTableGrid", "ShowSheetTabs", "IsSheetTabsVisible",
      ];
      out.writer.scrollCandidates = tryCandidates(function () {
        return css.beans.XPropertySet.query(css.view.XViewSettingsSupplier.query(w.controller).getViewSettings());
      }, scrollCandidates);
      out.calc.scrollCandidates = tryCandidates(function () {
        return css.beans.XPropertySet.query(c.controller);
      }, scrollCandidates);
      out.impress.scrollCandidates = tryCandidates(function () {
        return css.beans.XPropertySet.query(im.controller);
      }, scrollCandidates.concat(["ScrollBar", "IsScrollBar", "ShowScrollBars"]));

      // Impress: try .uno:ScrollBar as a DISPATCH (View menu toggle), not a
      // property -- Impress/Draw's Tools>Options has no scrollbar checkbox,
      // unlike Writer/Calc; the View menu's own "Scroll Bar" entry may be a
      // toggle command instead.
      function parseUnoUrl(commandUrl) {
        var InOutURL = Module["uno_InOutParam_com$sun$star$util$URL"];
        var inst = new InOutURL({
          Complete: commandUrl, Main: "", Protocol: "", User: "", Password: "",
          Server: "", Port: 0, Path: "", Name: "", Arguments: "", Mark: "",
        });
        var trans = css.util.URLTransformer.create(ctx);
        trans.parseStrict(inst);
        return inst.val;
      }
      ["ScrollBar", ".uno:ScrollBar"].forEach(function (cmd) {
        var full = cmd.indexOf(".uno:") === 0 ? cmd : ".uno:" + cmd;
        try {
          var frame = im.controller.getFrame();
          var dp = css.frame.XDispatchProvider.query(frame);
          var url = parseUnoUrl(full);
          var dispatch = dp.queryDispatch(url, "", 0);
          out.impress["dispatchExists_" + full] = !!dispatch;
        } catch (e) {
          out.impress["dispatchErr_" + full] = e && e.toString ? e.toString() : String(e);
        }
      });

      // Zoom-to-fit candidates (item 3): confirm DocumentZoomType enum by
      // setting ZoomType directly on Impress's controller (no
      // XViewSettingsSupplier there, per the earlier finding) and reading
      // ZoomValue back to see what the engine actually computed for
      // "fit whole slide" (ENTIRE_PAGE, assumed value 2).
      try {
        var ps3 = css.beans.XPropertySet.query(im.controller);
        ps3.setPropertyValue("ZoomType", new Module.uno_Any(Module.uno_Type.Short(), 2));
        var zv = ps3.getPropertyValue("ZoomValue");
        out.impress.zoomAfterEntirePage = zv && zv.get ? zv.get() : zv;
      } catch (e) {
        out.impress.zoomFitError = e && e.toString ? e.toString() : String(e);
      }

      // (b) ColorScheme node enumeration -- explore top-level UI node first
      // in case the /ColorSchemes path assumption is wrong or genuinely empty
      // in this minimized WASM package.
      try {
        function getSingleton0(name) {
          var any = ctx.getValueByName("/singletons/" + name);
          return any.get();
        }
        function mkPV0(name, unoType, value) {
          return { Name: name, Handle: -1, Value: new Module.uno_Any(unoType, value), State: 0 };
        }
        function openConfig0(path) {
          var cp = css.lang.XMultiServiceFactory.query(getSingleton0("com.sun.star.configuration.theDefaultProvider"));
          var pv = mkPV0("nodepath", Module.uno_Type.String(), path);
          var pvAny = new Module.uno_Any(Module.uno_Type.Struct("com.sun.star.beans.PropertyValue"), pv);
          var argSeq = new Module.uno_Sequence_any([pvAny]);
          var access = cp.createInstanceWithArguments("com.sun.star.configuration.ConfigurationAccess", argSeq);
          argSeq.delete();
          return access;
        }
        var uiRoot = openConfig0("/org.openoffice.Office.UI");
        var uiRootNames = css.container.XNameAccess.query(uiRoot).getElementNames();
        var uiRootArr = [];
        for (var k = 0; k < (uiRootNames.getLength ? uiRootNames.getLength() : uiRootNames.length); k++) {
          uiRootArr.push(uiRootNames.get ? uiRootNames.get(k) : uiRootNames[k]);
        }
        out.uiRootNodes = uiRootArr;

        var csNode = openConfig0("/org.openoffice.Office.UI/ColorScheme");
        var csNodeNames = css.container.XNameAccess.query(csNode).getElementNames();
        var csNodeArr = [];
        for (var m = 0; m < (csNodeNames.getLength ? csNodeNames.getLength() : csNodeNames.length); m++) {
          csNodeArr.push(csNodeNames.get ? csNodeNames.get(m) : csNodeNames[m]);
        }
        out.colorSchemeNodeChildren = csNodeArr;
      } catch (e) {
        out.uiRootError = e && e.toString ? e.toString() : String(e);
      }

      // (b-old) ColorSchemes SET enumeration (kept for comparison)
      try {
        function getSingleton(name) {
          var any = ctx.getValueByName("/singletons/" + name);
          return any.get();
        }
        function mkPV(name, unoType, value) {
          return { Name: name, Handle: -1, Value: new Module.uno_Any(unoType, value), State: 0 };
        }
        function openConfig(path) {
          var cp = css.lang.XMultiServiceFactory.query(getSingleton("com.sun.star.configuration.theDefaultProvider"));
          var pv = mkPV("nodepath", Module.uno_Type.String(), path);
          var pvAny = new Module.uno_Any(Module.uno_Type.Struct("com.sun.star.beans.PropertyValue"), pv);
          var argSeq = new Module.uno_Sequence_any([pvAny]);
          var access = cp.createInstanceWithArguments("com.sun.star.configuration.ConfigurationAccess", argSeq);
          argSeq.delete();
          return access;
        }
        // list ColorSchemes names
        var schemesAccess = openConfig("/org.openoffice.Office.UI/ColorScheme/ColorSchemes");
        var nameAccess = css.container.XNameAccess.query(schemesAccess);
        var schemeNames = nameAccess.getElementNames();
        var schemeNamesArr = [];
        for (var i = 0; i < (schemeNames.getLength ? schemeNames.getLength() : schemeNames.length); i++) {
          schemeNamesArr.push(schemeNames.get ? schemeNames.get(i) : schemeNames[i]);
        }
        out.colorSchemeNames = schemeNamesArr;
        // Enumerate properties of the first scheme
        if (schemeNamesArr.length) {
          var oneScheme = openConfig("/org.openoffice.Office.UI/ColorScheme/ColorSchemes/" + schemeNamesArr[0]);
          var ps2 = css.beans.XPropertySet.query(oneScheme);
          var info2 = ps2.getPropertySetInfo();
          var props2 = info2.getProperties();
          var names2 = [];
          for (var j = 0; j < (props2.getLength ? props2.getLength() : props2.length); j++) {
            var p2 = props2.get ? props2.get(j) : props2[j];
            names2.push(p2.Name);
          }
          out.colorSchemePropNames = names2;
        }
      } catch (e) {
        out.colorSchemeError = e && e.toString ? e.toString() : String(e);
      }

      return out;
    });
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
