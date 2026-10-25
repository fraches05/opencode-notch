<div align="center">

<img src="docs/icon.png" width="132" alt="OpenCode Notch" />

# OpenCode Notch

**A macOS-style notch for Windows — for your OpenCode sessions.**

Approvals, forms, live agent activity and context usage, always one glance away at the top of your screen.

[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?style=flat-square)](#requirements)
[![OpenCode](https://img.shields.io/badge/OpenCode-2.x-111111?style=flat-square)](https://opencode.ai)
[![Electron](https://img.shields.io/badge/Electron-45-47848F?style=flat-square)](https://www.electronjs.org)
[![License](https://img.shields.io/badge/license-MIT-3DA639?style=flat-square)](LICENSE)

[Download](#install) · [Website](https://fraches05.github.io/opencode-notch/) · [Features](#features) · [How it works](#how-it-works) · [Troubleshooting](#troubleshooting)

**English** · [Русский](README.ru.md)

</div>

<p align="center">
  <img src="docs/demo.gif" width="470" alt="OpenCode Notch — collapsing pill, expanding panel, approval request" />
</p>

---

## Why

When you run OpenCode in a terminal, you end up alt-tabbing to check one thing: *did it finish? is it waiting for my approval? what is it doing right now?*

OpenCode Notch puts that answer at the top edge of your screen as a small black capsule. It stays out of the way until an agent needs you — then it unfolds, shows the pending request, and lets you answer without leaving the app you are working in.

No plugins, no hooks, no config files in your project. The notch talks to the local OpenCode background service directly.

## Features

- **Notch that behaves like a notch** — a pill at the top of the screen. Drag it anywhere; when it sits at the top edge, its top corners square off and it melts into the screen.
- **Hover to open, pin to keep** — expand on hover, or pin it open with `Ctrl+Alt+N`.
- **Permission approvals** — `Allow once` / `Always` / `Reject` right in the notch, with a soft chime so you do not miss it.
- **Interactive forms** — text, numbers, selects, checkboxes, multiselect and conditional fields render as real inputs; answer and send without touching the terminal.
- **Live activity line** — what the agent is doing *right now*: `… command: npm test`, `✓ edit: src/routes.ts`, or a snippet of the reasoning it is streaming.
- **Per-session context usage** — `ctx 89.6k / 200k · 45%` from the newest assistant message, plus cumulative tokens and cost in the footer.
- **Quick reply** — type an answer to the selected session straight from the notch.
- **Interrupt** — stop a run from the row, without switching windows.
- **Multiple sessions** — status dots per session: running, waiting for you, done, error, retry.
- **Filter** — type to narrow a long session list.
- **Multi-monitor + position memory** — remembers where you dragged it, per display.
- **Three themes** — Notch, Midnight and Mono, picked from the tray menu and remembered across restarts.
- **Two languages** — English and Russian UI, picked from the tray menu, "System" by default.
- **Tray icon** — Show / Hide, Pin, Center at top, Mute sounds, Theme, Language, Launch at login, Quit.
- **Autostart** — optional "launch at login", starts hidden until something needs you.

## Screenshots

<table>
<tr>
<td align="center" width="50%">
<img src="docs/screenshots/sessions.png" alt="Session list" /><br />
<sub>Three sessions — two running, one just finished</sub>
</td>
<td align="center" width="50%">
<img src="docs/screenshots/form.png" alt="Interactive form" /><br />
<sub>A form from an agent, answered inside the notch</sub>
</td>
</tr>
<tr>
<td colspan="2" align="center">
<img src="docs/screenshots/pill.png" alt="Collapsed pill" width="240" /><br />
<sub>Collapsed: status dots and nothing else</sub>
</td>
</tr>
</table>

## Install

### Option A — download the app (easiest)

1. Open [**Releases**](../../releases/latest) and download `OpenCodeNotch-win-x64.zip`.
2. Unzip it anywhere (for example `C:\Program Files\OpenCode Notch` or your Desktop).
3. Run **`OpenCode Notch.exe`**.

That is it — a black capsule appears at the top of your screen.

> **Windows may warn you.** The build is not code-signed, so SmartScreen shows *"Windows protected your PC"*. Click **More info → Run anyway**. The source is right here in this repository, and you can build it yourself with `npm run dist`.

### Option B — run from source

Requires [Node.js 20+](https://nodejs.org).

```powershell
git clone https://github.com/fraches05/opencode-notch.git
cd opencode-notch
npm install
npm start
```

Or just double-click **`start-notch.cmd`** — it installs dependencies on first run and launches the notch.

### Requirements

- Windows 10 or 11
- [OpenCode](https://opencode.ai) 2.x installed, with its background service available. The notch discovers the service the same way the TUI does — usually nothing to configure.
- No plugin, no API key, no extra configuration.

## Using it

| Action | How |
| --- | --- |
| Open the panel | Hover the pill, or press `Ctrl+Alt+N` |
| Keep it open | Click the 📌 pin, or press `Ctrl+Alt+N` |
| Close the panel | Click ✕, press `Esc`, or move the cursor away |
| Move it | Drag the pill or the panel header |
| Reset position | Tray icon → **Center at top** |
| Answer a permission | `Allow once` / `Always` / `Reject` |
| Reply to a session | Select a row, type in the bottom field, `Enter` |
| Stop a run | The `■` button on a running row |
| Mute the chime | Speaker icon, or tray → **Mute sounds** |
| Change the theme | Tray icon → **Theme** → **Notch** / **Midnight** / **Mono** |
| Change the language | Tray icon → **Language** → **System** / **English** / **Русский** |
| Start with Windows | Tray icon → **Launch at login** |

Settings live in `%APPDATA%\OpenCode Notch\notch.json` (position, pinned, muted, theme, language, autostart).

## How it works

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│  Electron main process   │  HTTP  │  OpenCode background service  │
│  @opencode/client        │ <────> │  discovered on 127.0.0.1      │
│  · service discovery     │        │  · sessions / permissions     │
│  · SSE /api/event        │        │  · forms / models / messages  │
│  · state reducer         │        └───────────────────────────────┘
├──────────────────────────┤
│  Renderer (no network)   │   ← state snapshots + IPC actions
└──────────────────────────┘
```

- The main process discovers the running service with `Service.discover()` and authenticates with `Service.headers()` — the same path OpenCode's own clients use.
- It subscribes to the server-sent event stream at `/api/event` and turns raw events (`session.status`, `permission.asked`, `session.tool.called`, `form.created`, `session.usage.updated`, …) into a small UI snapshot.
- The renderer only draws that snapshot and sends actions back over IPC (`perm:reply`, `session:prompt`, `session:interrupt`, `form:reply`, …). It has no network access.
- The window follows its content: it is a frameless, transparent, always-on-top surface that resizes to the pill or the panel, and re-centres itself when its size changes.

**Privacy:** everything stays on your machine. The notch talks only to your local OpenCode service, sends no telemetry, and stores only its own UI preferences.

## Troubleshooting

**The pill does not appear**
Start OpenCode at least once so its background service exists. If the notch says *reconnecting…*, run `opencode service status` in a terminal.

**Hover does not open the panel**
Click the tray icon and use **Pin panel open** (`Ctrl+Alt+N`) — this also confirms the window is where you expect it. If the key is taken by another app, the notch falls back to `Ctrl+Shift+N`, then `Ctrl+Alt+O`, then `F9`.

**Window is on the wrong monitor or off-screen**
Tray → **Center at top**. Position is remembered per display.

**Nothing happens when I click Allow**
The permission may already be resolved in another client (TUI). The card disappears as soon as the server reports the reply.

**The context number looks large**
`ctx` is the size of the newest assistant message (prompt + cache read + output) — the real context occupancy. The footer shows cumulative session tokens, which include every cache read and grow quickly.

**Where are the logs?**
`%TEMP%\opencode-notch.log` — startup, connection and renderer errors only.

## Related projects

The notch/Dynamic Island genre is bigger than this repository, and that is a good thing:

- [lumiomac.app](https://lumiomac.app) — the macOS app that started this whole idea; genuinely lovely, macOS-only.
- [opencode](https://opencode.ai) — the agent this notch exists for.
- If you are on a Mac, there are several excellent notch apps for coding agents; this project exists because those do not run on Windows and because it talks to OpenCode's own API instead of relying on hooks or window titles.

## Contributing

Issues and pull requests are welcome. If OpenCode changes its API, the failure will usually show up as `reconnecting…` in the header — attach `%TEMP%\opencode-notch.log` to the issue.

Not sure where to start? Good first issues:

- Theme accents / compact mode variants
- Localization
- Packaging an installer (NSIS/MSIX) and code signing
- Better retry/backoff telemetry in the tray tooltip

## Disclaimer

This is an independent, unofficial project. It is not affiliated with, endorsed by, or connected to OpenCode, lumiomac, or any other notch app. "OpenCode" is used descriptively to say what the app works with.

If it saves you a few alt-tabs, a ⭐ helps other people find it.

## License

[MIT](LICENSE)
