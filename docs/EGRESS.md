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

## What remains (not yet built, per task 1567 goal 3)

The automated Playwright egress test itself (goal 3's proposal) is **not built in this phase** — phase 1 is source-level audit + build feasibility only. Proposed shape for phase 2:
1. Serve the built WASM bundle from a sandboxed `<iframe>` with `Content-Security-Policy: connect-src 'self'` (or `'none'` if all assets are inlined) on the iframe's own response headers.
2. Playwright's `page.on('request')` + `page.on('websocket')` capture every outbound request during a scripted session: open, type, every top-level menu, insert image, click a hyperlink, save.
3. Assert `requests.filter(r => new URL(r.url()).origin !== ourOrigin).length === 0`, printing the count per task 1566's verification requirement — and separately assert no `window.open`/top-level-navigation event fired without an explicit user-confirmation dialog in between (finding #10 above).
4. Prove the gate is RED first: temporarily add a real `fetch()` call in the JS glue and confirm the test fails before relying on it (per the workspace's "a guard must demonstrate it can go red" rule).
