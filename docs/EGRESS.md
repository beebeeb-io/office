# Egress map — LibreOffice core network paths

**Source pinned at:** LibreOffice/core commit `f8941520720922033948ca14081dbb3dabbbe6b7` (master, 2026-09-26), cloned read-only (`git clone --filter=blob:none --depth 1`) into `build/core/` (gitignored, not vendored into this repo — see `build/PINNED_COMMIT`).

## 2026-09-26 — Phase 2 update: interactive Qt/GUI build, confirmed on the Legion

The two open items row #3/#4 flagged for "the interactive Qt/GUI build" are now closed
with source patches (not just config flags), and row #10 (hyperlink navigation) now has
its mitigation implemented, all three on the SAME pinned commit as above, built with
`--with-distro=LibreOfficeWASM32` (`--enable-qt5`, GUI **on**, not `--disable-gui`) on
Guus's Legion (Arch Linux, x86_64):

- **#3/#4 (Extension Manager repository / Additions dialog):** `patches/0003-additions-dialog-disable.patch`
  replaces the single shared chokepoint `sfx2::AdditionsDialogHelper::RunAdditionsDialog`
  (`sfx2/source/dialog/AdditionsDialogHelper.cxx`, called from all six "get more X
  online" sites: `cui/source/tabpages/tpcolor.cxx`, `cui/source/options/appearance.cxx`
  ×2, `cui/source/options/optlingu.cxx` ×2) with a static `weld::MessageDialog` that
  never constructs `AdditionsDialog` and never touches
  `https://extensions.libreoffice.org/api/v0/*.json`. This is now "never compiled to
  fetch," not "compiled but unreachable" — the finding this row flagged as open for
  the GUI build.
- **#10 (hyperlink click → external navigation):** `patches/0002-hyperlink-no-navigate.patch`
  replaces `execute_browser()` in `shell/source/unix/exec/shellexec_em.cxx` — the single
  emscripten-specific body of `com.sun.star.system.SystemShellExecute`
  (`shell/source/unix/exec/shellexec.cxx`'s `__EMSCRIPTEN__` branch is the ONLY caller,
  confirmed by reading the file) — so it dispatches a `beebeeb:hyperlink` DOM
  `CustomEvent` carrying the URL instead of `window.open(...)`. **No browser-native
  open/navigate call exists in LO/Qt code after this patch, anywhere** (this was the one
  path with no native-code disable at all; it now has one). The host page's JS glue
  (not yet wired — that is goal 3/4's Playwright harness, see below) decides what to
  show a user; showing a copy-to-clipboard confirmation instead of navigating is
  task 1567's explicit ask, satisfied at the dispatch layer.
- **Confirmed against the actual generated `config_host.mk` for this exact build**
  (not assumed from `configure.ac`'s intent): `ENABLE_CURL=`, `ENABLE_BREAKPAD=`,
  `ENABLE_ONLINE_UPDATE=`, `ENABLE_EXTENSION_UPDATE=`, `WITH_WEBDAV=` all blank, and
  (the one that must be the OPPOSITE of the headless build) `DISABLE_GUI=` blank +
  `ENABLE_QT5=TRUE` — this is a real GUI build, not headless, and the egress
  guarantees above hold WITH the GUI on, which is the whole point of this phase.
- **`configure` for the GUI/Qt target succeeded with zero toolchain fixes needed** on
  the Legion (Arch Linux x86_64, WSL2) — contrast with Phase 1's 8 fixes + 3 build-time
  bugs on macOS. Real evidence for the Phase 1 recommendation to move off macOS as a
  build host. See `build/PROGRESS.md` for the Phase 2 log.
- **The build succeeded** (2026-09-26, 5 `make` attempts, 2 new real bugs found and
  patched — 0002's own `\x27`-escape bug and 0004's freetype link gap — neither
  egress-related, both build-mechanics). `docs/PHASE2-RESULTS.md` has full numbers.
  **Both new patches are confirmed compiling into the successful artifact.**
- **Egress gate run for real** against the built artifact: a full session (open a
  Writer doc, type, click through all 11 top-level menus, Ctrl+S) captured via
  Playwright shows **0 requests to any non-`self` origin, 0 popups**
  (`evidence/playwright/egress.spec.js`, GREEN). The gate's own red-proof
  (`BB_EGRESS_INJECT_FETCH=1`, with the server's CSP header removed so the CSP itself
  isn't what stops it) shows the capture correctly catches an escaped request
  (count=1). **Not yet exercised in this session:** the "insert an image" and "click a
  hyperlink" steps of the full egress session named in task 1567's own goal 4 — no
  file-based image-insert path was found working yet (see the file-I/O open item in
  `docs/PHASE2-RESULTS.md`), and no hyperlink was created in a document to click.

**Method:** `grep -rn` across the pinned checkout for every network-capable subsystem named in task 1567 (update check, extension/template manager, online help, crash reporter, telemetry, UNO remote, WebDAV/CMIS, curl, hyperlink handling, font download). This is a source-level audit of the *native* LibreOffice code; it does not yet cover UI-level review of the compiled WASM output (goal 3's automated Playwright egress test, still to build — see "What remains" below).

## The one flag that matters most: `--disable-curl`

`configure.ac` makes curl removal a **hard, build-time-enforced** gate, not an independent checkbox anyone could forget to also flip:

```
configure.ac:11779   if test "$enable_curl" != "yes"; then
configure.ac:11780       AC_MSG_ERROR([--disable-breakpad must be used when --disable-curl is used])
configure.ac:11814   if test "$enable_curl" != "yes"; then
configure.ac:11815       AC_MSG_ERROR([--disable-libcmis must be used when --disable-curl is used])
configure.ac:11996   if test "$enable_curl" = "no"; then
configure.ac:11997       AC_MSG_ERROR(["--without-webdav must be used when --disable-curl is used"])
configure.ac:14658   if test "$enable_curl" != "yes"; then
configure.ac:14659       AC_MSG_ERROR([--disable-online-update must be used when --disable-curl is used])
```

Pass `--disable-curl` alone and the **build refuses to configure** unless `--disable-breakpad`, `--disable-libcmis`, `--without-webdav` and `--disable-online-update` are *also* explicitly passed. That means the four network-capable subsystems below cannot silently drift back on in a future rebase — the build itself is the guard. This is the strongest evidence-based answer to "100% sure it doesn't go out the door" available at the native-code layer: not four independent flags to remember, one flag that fails closed.

Confirmed working: the headless `autogen.input` in `build/core/autogen.input` passes all five together and configure accepted them (see `build/PROGRESS.md`).

## Table

| # | Path | file:line | Disabled how | What remains |
|---|------|-----------|---------------|---------------|
| 1 | **libcurl** (the shared HTTP/HTTPS client every path below is built on) | `configure.ac:11422`, `:11779-11815`, `:11996`, `:14658` | `--disable-curl` (cascades 2, 4, 6, 7 below — see box above) | None at the native layer. In WASM, curl would otherwise compile to Emscripten's `fetch`/XHR bridge — removing it at the LO layer means there is no C++ code path left that could even ask Emscripten to make that bridge call. |
| 2 | **Online update check** (`Help > Check for Updates`, background job) | `extensions/source/update/check/updatecheck.cxx`, `updatecheckconfig.cxx:50` (`DOWNLOAD_URL`), registered via `officecfg` `Job` framework | `--disable-online-update` (required once curl is off; `configure.ac:14658`) | The `extensions/source/update/*` module is part of the desktop `Job` execution framework, not part of `--disable-scripting`'s scope — confirm at build time (goal 4) that `Library_updatecheckui`/`Library_updatecheck` are excluded from `--with-wasm-module` link sets, since headless WASM excludes GUI (`--disable-gui`) but the update **check** itself is not strictly a GUI component. Track as an open verification item. |
| 3 | **Extension Manager repository** | `officecfg/registry/data/org/openoffice/Office/ExtensionManager.xcu:23` → `https://extensions.libreoffice.org/` | `--disable-extension-update` (`ENABLE_EXTENSION_UPDATE=` confirmed blank in the actual generated `config_host.mk` for our build); its network path also dies one layer down since it's an `http://` UCB request and the `webdav-curl` UCB provider that handles `http(s)://` URLs isn't built at all without curl | **Corrected finding, verified against the actual build, not assumed:** I initially wrote that `--disable-gui` excludes the `cui`/`desktop` GUI modules from a headless build, so this code simply wouldn't compile in. **That was wrong.** `cui/Module_cui.mk` lists `Library_cui` (which contains `AdditionsDialog.cxx`) with no `DISABLE_GUI`/`ENABLE_HEADLESS` guard, and `RepositoryModule_host.mk` lists the `cui` module unconditionally — confirmed by reading both files after configure ran. **The dialog's code is compiled into this headless build too.** It is still unreachable in practice for two independent reasons: (a) there is no GUI to click it from in a headless build, and (b) even if invoked programmatically, its `http://` UCB request has no content provider to serve it once curl is gone — but "unreachable because no UI" is a weaker guarantee than "not compiled," and does NOT hold once we build the interactive Qt/GUI editing target (task 1566's actual goal), where the menu entry and dialog ARE reachable by a real user. **Flagged as a required source patch (remove the menu entry/dialog, not just rely on the config flag) for the phase-2 GUI build**, now with a verified rather than assumed rationale. |
| 4 | **"Get more extensions/templates" (Additions dialog)** | `cui/source/dialogs/AdditionsDialog.cxx:497` → `https://extensions.libreoffice.org/api/v0/...json` | Same as #3 — `--disable-extension-update` at config level; curl (its actual HTTP transport, one layer down via the UCB `webdav-curl` provider) is absent from this build (confirmed: no `curl` include in the file itself — it goes through UCB, and `ENABLE_CURL=` is blank in `config_host.mk`) | Same corrected finding and same open item as #3 for the Qt/GUI build — this row shares its root cause with #3, listed separately only because it is a distinct file:line. |
| 5 | **Online help fallback URL** | `officecfg/registry/schema/org/openoffice/Office/Common.xcs:3098` → `https://help.libreoffice.org/help.html?` | `--without-help` (upstream default is already `no` — `configure.ac:2917`, "no local help (default)"; we pass it explicitly for the record) | This is inert config *data* unless `--with-help=online` is chosen; not reachable code in our build. No residual risk found. |
| 6 | **Breakpad crash reporter** | `desktop/source/app/crashreport.cxx:135` → `crashreport.libreoffice.org` | `--disable-breakpad` (required once curl is off; upstream default is *also* already off — `configure.ac:11776`, breakpad requires an explicit `--enable-breakpad`) | None found. Belt-and-suspenders: off by upstream default AND explicitly disabled AND its curl dependency is gone. |
| 7 | **WebDAV file-open provider** (`ucb/source/ucp/webdav-curl/`) | `configure.ac:2891-2892`, `:11983-12002` | `--without-webdav` (required once curl is off — `configure.ac:11996`) | None at native layer; the whole `webdav-curl` UCB provider is a curl consumer and won't link without curl. |
| 8 | **CMIS remote file-open provider** (`ucb/source/ucp/cmis/`, `libcmis`) | `configure.ac:11811-11815` | `--disable-libcmis` (required once curl is off) | None found. |
| 9 | **GIO UCB provider** (`ucb/source/ucp/gio/`) — GVfs/GNOME network mounts (smb://, ftp://, etc.) | `ucb/source/ucp/gio/` | Not built for a non-Linux-desktop / WASM host at all (GIO is a GLib/GNOME Unix desktop integration; `wasm32-local-emscripten` has no GLib backend) — not yet confirmed by an actual successful build (see `build/PROGRESS.md`), flagged as a verification item once the build completes. | Verify GIO is absent from the WASM link set once a full build succeeds. |
| 10 | **Hyperlink click → external navigation** | `sfx2/source/appl/openuriexternally.cxx`, `sfx2/source/appl/appopen.cxx` | Not a curl/native-network path — on desktop this shells out to the OS's registered URL handler (`xdg-open`/`open`/`ShellExecute`), which has **no equivalent syscall inside the WASM sandbox** (no `fork`/`exec`, no OS shell access from a browser tab) | **This is a browser-level concern, not a native-code one.** A hyperlink click must be intercepted by *our* JS/Rust glue and either (a) blocked, or (b) turned into an explicit, user-confirmed `window.open(url, '_blank')` in the host page — which is a top-level navigation, and **CSP `connect-src` does NOT govern top-level navigation** (it only governs `fetch`/`XHR`/`WebSocket`/`<img>`/etc. made *by* the page). The egress gate (goal 4 test) must therefore separately assert that a hyperlink click never fires an unconfirmed `window.open`/`location.href` change, in addition to the request-capture assertion. Flagging this explicitly since it is the one path the CSP mitigation described in task 1566 does not cover. |
| 11 | **UNO remote bridge / `--accept=socket,...;urp;`** | `desktop/source/app/officeipcthread.cxx` (single-instance IPC), `desktop/source/lib/init.cxx` (LibreOfficeKit remote API) | Structurally unreachable: there is no `socket()`/`bind()`/`listen()` syscall available to a WASM binary running inside a browser tab — Emscripten's own socket emulation is a *client* that proxies through a JS-side WebSocket the *host page* must explicitly wire up, and our host page never does | Not a configure flag — a structural sandbox property. Worth stating explicitly rather than assuming, since "the sandbox prevents it" is exactly the kind of claim task 1566 says must be checked, not assumed. |
| 12 | **Font download** (e.g. a Google-Fonts-style runtime fetch) | — searched `officecfg/`, `vcl/`, `i18npool/` for `fonts.google` / font-download components | **Not found.** LibreOffice's font substitution table (`vcl/inc/*fontsubst*`, `officecfg/.../VCL.xcs`) is a static local mapping; there is no runtime font-download subsystem in LO core to disable. | No action needed at the native layer. Residual note: in-browser, missing-glyph fallback would need to come from fonts we bundle (WASM has no access to arbitrary system/network font fetch anyway) — a packaging concern, not an egress one. |
| 13 | **OAuth2 auth-fallback flow** (`uui` module) — opens the system/embedded browser to a cloud provider's OAuth login page and runs a local loopback HTTP listener (`OAuth2Request::Impl::listenHTTP`, Boost.Asio `tcp::socket`) to catch the redirect; used for CMIS/WebDAV remote-server authentication | `uui/source/iahndl-oauth2.cxx` (`#include <curl/curl.h>` at line 43, no upstream feature guard), called from `uui/source/iahndl-authentication.cxx:775` | **Found the hard way, not by reading docs:** this is what actually broke the first `make` attempt. `uui/Library_uui.mk` unconditionally called `gb_Library_use_external(uui,curl)` with **no `ENABLE_CURL` guard at all** (unlike `linguistic/Library_lng.mk`, which already correctly guards its own curl use — proof this is a real upstream gap for this one module, not a universal pattern) — `--disable-curl` alone does not build. **Patched** (`uui/Library_uui.mk`, `uui/source/iahndl-authentication.cxx` — both under a new `BB_NO_CURL_OAUTH2` define, since no `HAVE_FEATURE_CURL` config macro exists anywhere upstream to hook into): excludes `iahndl-oauth2.cxx` from compilation and its one call site falls back to the existing manual-code-entry `AuthFallbackDlg` instead of the automatic browser-redirect flow. Also disabled anyway by our already-disabled CMIS/WebDAV (this whole flow's caller path is for exactly those remote-server auth cases). | None — the patch cleared this specific blocker (confirmed: the rebuild got past `uui` and much further, into unrelated later stages — see `build/PROGRESS.md` attempts 11-12). This finding also matters beyond curl: `listenHTTP`'s use of a raw TCP socket is itself something that cannot exist inside a browser WASM sandbox at all (no BSD socket syscall — same structural point as item #11), independent of curl. |
| 14 | **Telemetry / usage statistics** | Searched `configure.ac`, `desktop/`, `vcl/`, `sfx2/` for `telemetry`/`usage-tracking` — the only hit was an unrelated MSVC build-tool env var (`VSCMD_SKIP_SENDTELEMETRY`, `configure.ac:4501`, Windows-only build tooling, not product code) | N/A — no product telemetry subsystem exists in LO core to disable. (LibreOffice's actual telemetry proposals have historically been rejected/removed upstream; this audit found no live code path.) | No action needed. |

## Summary

- **14 paths examined**, sourced from the task's own list (update check, help, extensions, templates, fonts, crash reporting, telemetry, UNO remote, WebDAV/CMIS, curl, hyperlinks) plus GIO, the UNO IPC thread, and the `uui` OAuth2 auth-fallback flow (#13) — the last one found not by reading docs but by an actual build breaking on it (see `build/PROGRESS.md`).
- **9 of 14 fully closed** at the native-code/build-flag layer for the headless module build attempted here (curl, online update, breakpad, WebDAV, CMIS, help, fonts, telemetry, UNO remote/socket — the last two are structural, not flag-gated) — cross-checked against the actual generated `config_host.mk` after a successful `configure` (not just read from `configure.ac`'s intent): `ENABLE_CURL`, `ENABLE_BREAKPAD`, `ENABLE_ONLINE_UPDATE(+_MAR)`, `ENABLE_EXTENSION_UPDATE`, `WITH_WEBDAV` all confirmed blank.
- **1 (OAuth2 auth-fallback, #13) required an actual source patch, not just a flag** — `uui/Library_uui.mk` unconditionally depended on curl with no upstream guard (unlike the sibling `linguistic` module, which is already correctly guarded), and broke the first real `make` attempt. Patched under a new `BB_NO_CURL_OAUTH2` define (no upstream `HAVE_FEATURE_CURL` macro exists to hook into) — see `build/PROGRESS.md` for whether the rebuild after this patch went green.
- **2 (Extension Manager, Additions dialog) are DISABLED AT RUNTIME (config flag) but ARE compiled into this headless build** — corrected finding, see the table rows: my first-pass assumption that `--disable-gui` excludes the whole `cui` module was checked against `cui/Module_cui.mk`/`RepositoryModule_host.mk` and was wrong. They remain unreachable here only because (a) there's no UI to click them and (b) their HTTP transport (curl, via UCB) is absent — weaker than "not compiled," and this gap is explicitly called out as a required source patch for the interactive Qt/GUI build task 1566 actually needs, not assumed solved by a config flag.
- **1 (GIO UCB provider) is expected-absent but not yet build-confirmed** — pending a completed build (see `build/PROGRESS.md`).
- **1 (hyperlink → external navigation) has no native-code disable at all** — it is out of scope for `configure.ac` flags entirely and must be handled at the JS/Rust host-page glue layer plus its own dedicated egress-test assertion, since CSP `connect-src` does not cover top-level navigation. This is the single most important finding of this audit: **the CSP mitigation described in task 1566's decision is necessary but not sufficient** — it does not by itself stop a hyperlink click from navigating the top-level page to an external URL.

## 2026-09-27 — Phase 3: the file-I/O open item closed, image + hyperlink egress steps done

**Root cause of Phase 2's open item, confirmed empirically (not theorized):**
`Module.FS`/plain JS `FS.writeFile()`/`readFile()` and LibreOffice's own C++ file
I/O (`com.sun.star.ucb.SimpleFileAccess`, `loadComponentFromURL("file://...")`,
`storeToURL("file://...")`) operate on **two different, non-overlapping
Emscripten MEMFS instances**, even when both are invoked from the exact same
JS `evaluate()` call in the exact same Worker. Proven with a from-scratch
`/tmp/bbnew12345/` directory (so no stale-cache theory survives): a plain
`FS.mkdir`+`FS.writeFile` there is invisible to `SimpleFileAccess.exists()`
in the same call, AND — the reverse — a real UCB `openFileWrite()` write is
invisible to `FS.stat()` immediately after, in the same call. LibreOffice's
own UCB dispatches real file-provider I/O to its internal thread pool
(the "thread-pool" named Workers visible in the console log), and each of
those OS-thread Workers has its own independent MEMFS — there is no
source patch that closes this for `file://` URLs; it is a structural property
of MEMFS + real OS threads under Emscripten.

**The mechanism that works — and needs no patch or rebuild:** UNO's own
in-memory stream API. `com.sun.star.io.SequenceInputStream.createStreamFromSequence()`
wraps a raw byte sequence as `XInputStream`; `com.sun.star.io.SequenceOutputStream`
is an `XOutputStream` that hands written bytes back via
`XSequenceOutputStream.getWrittenBytes()`. Passed via the MediaDescriptor's
`InputStream`/`OutputStream` properties with a placeholder `"private:stream"`
URL (plus an explicit `FilterName` — required for `OutputStream`, and
recommended for `InputStream` since it skips a possibly-flaky content-type
sniff), `loadComponentFromURL`/`storeToURL` never touch UCB's file provider or
any background thread — same principle as the already-working
`private:factory/*` in-memory documents. Full round trip proven, docx/xlsx/pptx,
real Playwright keyboard events, independent `python-docx`/`openpyxl`/
`python-pptx` verification: see the task file's dated 2026-09-27 note.

**Getting this callable from real page JS (not just Playwright/CDP) — the
"LOWA channel":** LibreOffice's own `desktop/source/app/initjsunoscripting.cxx`
already ships a page&lt;-&gt;pthread `MessageChannel` for exactly this (`Module.uno_main`
resolves on the page with a live `MessagePort`; `Module.uno_mainPort` is its
other end, inside the pthread that runs UNO). No patch needed to use it — but
it only activates a script the page names via `Module["uno_scripts"]`, and
that property must be visible to the **pthread's own** `Module` object at
pthread-spawn time (Emscripten's generated bootstrap only forwards a small
fixed key set — `onExit`/`onAbort`/`print`/`printErr`/`wasmMemory`/`wasmModule`/`workerID`
— to each new Worker; setting it on the page alone is silently ignored inside
the pthread). The reproducible fix is one `--post-js` line at LO-WASM link
time (documented in `evidence/serve/patch-soffice-js.js`'s header, not yet
applied to a fresh Legion rebuild this phase — reproduced against the
already-built Phase 2 artifact instead, so this phase's evidence does not
depend on another build cycle).

**Image insert from bytes (goal 4):** `com.sun.star.graphic.GraphicProvider.queryGraphic()`
decodes a `SequenceInputStream`-wrapped PNG into an `XGraphic` entirely
in-memory (no `file://`, no fetch); a `com.sun.star.text.TextGraphicObject`
— created via the **document's own** `XMultiServiceFactory` (the process-global
component context's service manager returns null for this service; only the
document-scoped factory works, confirmed empirically) — carries it into the
text. Verified: the saved `.docx`'s `word/_rels/document.xml.rels` contains a
real `Type=".../image"` relationship pointing at `media/image1.png` (an
embedded image, never a URL).

**Hyperlink click (goal 4) — mechanism proven, pixel-click gap documented
honestly, not silently dropped:** a real hyperlink was inserted (UNO
`HyperLinkURL` character property; the saved docx's XML confirms a genuine
`<w:hyperlink>` element). **Three real attempts** to trigger LO's own
click-to-follow UI detection with a literal Playwright mouse click — plain
click, Ctrl+click swept across several y-offsets, and a right-click context
menu (which showed no hyperlink-specific entries at all) — did not fire it;
the text cursor visibly lands on the correct run (screenshotted) but no
follow action results. Per this task's own stop-after-3-attempts rule, this
specific UI-automation calibration question is left open rather than looped
on further. **What IS proven, directly and unambiguously:** invoking
`com.sun.star.system.SystemShellExecute.execute()` — the one and only UNO
service any hyperlink-follow code path in this build can reach a URL through
(confirmed by reading `shell/source/unix/exec/shellexec.cxx`'s
`__EMSCRIPTEN__` branch, row #10 above) — dispatches the patched
`beebeeb:hyperlink` DOM `CustomEvent` correctly, with **0 outside requests, 0
popups**, exercised inside the SAME sandboxed-iframe egress session as the
image insert and the full 11-menu click-through
(`evidence/playwright/egress.spec.js`, "zero egress including image insert
and hyperlink click", green; red-proof of the base egress session re-run and
still green after this phase's changes).

**Timings / memory (Chromium, this Mac, localhost dev server — not
production hosting, and OS file cache was hot from repeated same-session
testing; treat as a floor, not a guarantee against a cold real-world CDN
fetch):**

| | cold profile | warm profile (2nd launch, same dir) |
|---|---|---|
| nav → `load` event | 56ms | 53ms |
| `load` → `Module.uno_init` resolves | 3.3s | 2.9s |
| total to interactive (+2s paint settle) | 5.4s | 5.0s |
| peak JS heap (`Performance.getMetrics`, 5 samples) | 24.4MB | 22.5MB |
| Chromium process-tree RSS at settle | 1.45GB | 1.49GB |

Not stress-tested against a large (tens-of-MB) document this phase — all
fixtures used were under 1MB; `office-bridge::fits_memory_budget`'s 100MB
placeholder is explicitly flagged as unmeasured in its own doc comment.

**Bundle size, brotli `-q 11`:**

| file | original | brotli `-q 11` | reduction |
|---|---|---|---|
| `soffice.wasm` | 171,729,371 B | 38,602,455 B | 77.6% |
| `soffice.data` | 96,316,943 B | 15,757,226 B | 83.7% |
| `soffice.js` | 840,288 B | 127,453 B | 84.9% |
| **total** | **268,886,602 B (256MB)** | **54,487,134 B (52MB)** | **79.7%** |

## 2026-09-27 — Fix pass: bundled font set, zero network font loading confirmed

Task 1567 fix-pass item 4 (fixing tofu for non-Latin text + Inter for
documents that use it) added 6 font files to `soffice.data`'s FS image (see
`external/more_fonts/README-beebeeb.md` for the full provenance/license/size
table): Inter Regular/Bold, Noto Sans JP (Adobe's own "SubsetOTF" common-use
subset), Noto Sans Symbols, Noto Sans Symbols 2, Noto Emoji (monochrome).
**Egress-relevant fact, stated explicitly per this task's own "no network
font loading ever" requirement:** all six are packaged into the SAME
Emscripten FS image as every other bundled font (Liberation, Carlito, the
existing Noto Sans Arabic/Hebrew/etc. set) via the identical
`gb_ExternalPackage`/`gb_UnpackedTarball` mechanism `font_liberation` already
uses — there is no code path in this fork that fetches a font over the
network (no `@font-face` with a remote `src`, no Google Fonts CSS link, no
runtime font download). Confirmed by construction, not by a new automated
test: the existing zero-egress Playwright suite
(`evidence/playwright/egress.spec.js` + the web repo's own
`e2e/1567-office-editor-egress-full.spec.ts`) already asserts 0 non-self
requests across a full session that opens/types/saves, and neither test
needed a new assertion for this — a font fetch, if one existed, would already
show up as a captured non-self request in those existing gates.

**Real packaging gap found and fixed, not assumed to "just work":** simply
adding an `ExternalPackage` for a NEW font set (following the established
`font_liberation` pattern exactly) does NOT automatically reach
`soffice.data` on this fork's minimized WASM distro config. The `ooo_fonts`
auto-install aggregation mechanism the OTHER fonts in this directory rely on
(`gb_emscripten_fs_image_autoinstall`, `static/CustomTarget_emscripten_fs_image.mk`)
is wired through scp2's installer module list, which `--with-distro=LibreOfficeWASM32`
does not build — confirmed empirically (`soffice.data`'s byte size did not
change at all after the new `ExternalPackage` step itself succeeded and the
files landed in `instdir/share/fonts/truetype/`). Fixed by listing the 6 new
files explicitly in that same Makefile's file list, the same way it already
explicitly lists `fc_local.conf` and `opens___.ttf` — after the fix,
`soffice.data` grew by exactly 7,524,020 bytes, byte-for-byte matching the 6
files' combined raw size.

## What remains (not yet built, per task 1567 goal 3)

The automated Playwright egress test itself (goal 3's proposal) is **not built in this phase** — phase 1 is source-level audit + build feasibility only. Proposed shape for phase 2:
1. Serve the built WASM bundle from a sandboxed `<iframe>` with `Content-Security-Policy: connect-src 'self'` (or `'none'` if all assets are inlined) on the iframe's own response headers.
2. Playwright's `page.on('request')` + `page.on('websocket')` capture every outbound request during a scripted session: open, type, every top-level menu, insert image, click a hyperlink, save.
3. Assert `requests.filter(r => new URL(r.url()).origin !== ourOrigin).length === 0`, printing the count per task 1566's verification requirement — and separately assert no `window.open`/top-level-navigation event fired without an explicit user-confirmation dialog in between (finding #10 above).
4. Prove the gate is RED first: temporarily add a real `fetch()` call in the JS glue and confirm the test fails before relying on it (per the workspace's "a guard must demonstrate it can go red" rule).
