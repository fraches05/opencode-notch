# Changelog

## [0.3.0] — 2026-10-26

### Global session center

- **Session actions** — rename sessions, archive or restore them, and open a project directly in the OpenCode TUI.
- **Renderer layout** — search tools, project views, grouping, command palette, and action affordances are fully localized in English and Russian.
- **Project navigation** — filter sessions by project, switch between grouped and flat views, and optionally reveal archived sessions.
- **Command palette** — use `Ctrl/Cmd + K` for keyboard-first control, with arrow-key session navigation.
- **Responsive panel** — redesigned search toolbar, project tabs, contextual row actions, and compact layouts for narrow screens.
- **Session metadata** — archive state, project grouping, and refreshed activity timestamps now stay synchronized with the OpenCode server.


All notable changes to OpenCode Notch are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-10-25

The "stop alt-tabbing" release: the notch now tells you when a run ends even if
you are not looking at it, and it finally has an installer.

### Added

- **Finish confirmation card** — a Face ID-style panel slides into the notch when
  a run ends, with elapsed time, cost and tokens, a soft two-note chime and a
  4.2 s progress line. Sessions that finished while the notch was closed stay out
  of it, and the card is skipped (sound only) while you are typing in the panel.
- **Windows notifications** — a native toast when a run longer than 20 s ends and
  the notch is hidden or the cursor is elsewhere. Clicking it opens and pins the
  panel. Toggle: tray → *Notify when a run ends*.
- **Update offer** — the notch asks GitHub for the latest release at startup and
  every 6 hours. When a newer version exists, a blue card offers *Download* and
  *Later*, and a small dot appears in the collapsed pill. It never expands the
  panel by itself, and *Later* remembers the version you said no to. Tray →
  *Check for updates* to ask manually.
- **Three themes** — Notch, Midnight and Mono, switched from the tray menu and
  remembered across restarts. Mono is greyscale with colour reserved for alerts.
- **English / Russian UI** — panel and tray, switched from the tray, *System* by
  default (follows the Windows display language).
- **Windows installer** — an NSIS installer (`OpenCodeNotch-Setup-0.2.0.exe`)
  that installs per-user, so Windows does not ask for administrator rights, and
  adds Start-menu and desktop shortcuts. The portable zip is still published.
- `CHANGELOG.md`, and a Telegram contact ([@mrsdsxp](https://t.me/mrsdsxp)) in
  both READMEs and on the website.

### Changed

- The whole palette is variable-driven, so every theme — including Mono — recolours
  cards, buttons, focus rings and hover states consistently.
- Permission approval buttons and the reply placeholder follow the UI language.
- The tray menu grew: *Notify when a run ends*, *Check for updates*, and an update
  entry that appears only when there is something newer.
- README: installer as the recommended install path, screenshots for the finish
  card, the update offer and all three themes.

### Fixed

- Colours in the Mono theme no longer leak from the old hard-coded amber and red
  accents.
- Context-strip and input-focus borders were slightly dimmer than 0.1.0; contrast
  is back where it was.

## [0.1.0] — 2026-10-23

First release.

### Added

- A macOS-style notch for Windows that talks to the local OpenCode service.
- Permission approvals (`Allow once` / `Always` / `Reject`) inside the notch.
- Interactive forms — text, numbers, selects, checkboxes, multiselect, conditional
  fields — answered without touching the terminal.
- Live activity line, per-session context usage, token and cost totals.
- Quick reply and interrupt per session.
- Multi-monitor position memory, hover-to-open, pin with `Ctrl+Alt+N`.
- Tray icon: show/hide, pin, center, mute, launch at login, quit.
- Soft chime on new approvals; portable zip build.
