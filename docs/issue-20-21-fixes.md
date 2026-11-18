# Issue #20 / #21 fixes

Based on the patches and macOS template icon contributed by ddsy2001:

- https://github.com/DSDS-CMHL/EasyAntigravity/issues/20
- https://github.com/DSDS-CMHL/EasyAntigravity/issues/21
- Icon source: https://github.com/ddsy2001/EasyAntigravity/tree/feat/macos-tray-template-icon

Context sampling now requests generator metadata directly. A bounded eight-conversation
cache retains only fields used by statistics, scoped to backend and account. Polls
refresh the final generator as well as new entries so streaming completion remains
visible. Full refreshes occur at least every minute to handle same-sized replacements.
Unsupported endpoints (HTTP 404/405/501) retain the legacy trajectory fallback.
Identity, backend and generation checks still run before results enter the cache.

The widget checks local composer controls and three hit-test points instead of all
historical buttons. Message-stream mutations and closed-card scrolling do not schedule
layout scans. Polling uses four seconds while active and fifteen seconds while idle.
Translation skips newly added ignored subtrees and defers disconnected-node cleanup.
Healthy CDP discovery is throttled, with immediate rescan on socket closure.

macOS uses the contributed 64x64 monochrome alpha-mask PNG with template rendering.
Windows retains its application icon.

Validation: JavaScript syntax checks, unit/integration suite, i18n restoration and
real Edge desktop/IDE layout checks. No macOS runtime is available in the Windows
development environment; menu-bar appearance still requires macOS acceptance testing.
