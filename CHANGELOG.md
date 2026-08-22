# Changelog

All notable changes to this portfolio site are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [v1.1.0] — 2026-08-22

### Added
- Mobile hamburger navigation (`scripts/mobile-nav.js`) — collapses the nav
  to a single button on screens ≤ 780px, expands on tap, closes on link
  selection, Escape, or resize to desktop.
- Single-open dropdown behaviour — opening one nav dropdown closes any others.
- LinkedIn profile badge on the About page Contact grid.
- Site version widget on the About page.

### Changed
- Contact grid on the About page now uses a two-column layout: Email + Location
  stacked on the left, LinkedIn badge on the right.
- Header brand text wraps on very narrow viewports instead of overflowing.
- Contact strip search button is full-width on narrow viewports.
- Hero action buttons stack full-width on very narrow viewports.
- Comment box, RRT controls and other form inputs use 16px font-size on
  mobile to prevent iOS Safari's auto-zoom on focus.

### Fixed
- Broken `@media (max-width: 640px)` block that was silently wrapping the
  entire Live Carbon Intensity Dashboard CSS inside a mobile-only query.
- Missing header headshot competing with the hamburger for space on mobile.
- Duplicate LinkedIn card in the Contact section.

## [v1.0.0] — 2026-08-06

Initial public release. Portfolio deployed to
`https://munn-a-eng.github.io/`.

### Features
- Seven pages: Home, About, Experience, CAD, Manufacturing, Robotics &
  Automation, Dissertation.
- Interactive site architecture SVG diagram.
- Live UK Carbon Intensity API dashboard with 24-hour sparkline (RAG
  bands), generation-mix donut chart, cursor tooltip, refresh button.
- RRT path-planning interactive canvas (vanilla JS reimplementation of a
  MATLAB simulation).
- Ctrl+K site search over a build-time-generated index.
- Site-wide accessibility widget: light/dark/high-contrast themes,
  text-size scaling, reduced-motion toggle. Preferences persisted via
  localStorage.
- Comment box on the home page (obfuscated `mailto:`, no backend).
- Visitor counter (Abacus API).