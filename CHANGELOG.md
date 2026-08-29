# Changelog

All notable changes to this portfolio site are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [v1.3.0] — 2026-08-28

### Added
- Privacy policy page (`privacy.html`) with plain-language explanation of what
  the site does and does not do, footer link on every page, and sitemap entry.
- Content-Security-Policy meta tag on every page (allows self + Abacus counter
  + LinkedIn badge + Carbon Intensity API only; denies everything else).
- Referrer-Policy meta tag: `strict-origin-when-cross-origin` — only the origin
  is leaked when clicking outbound links.
- X-Content-Type-Options meta tag: `nosniff` — prevents MIME-sniffing attacks.
- Google Preferred Source button (`images/google-preferred-source.png`) on the
  home page — visitors can add this portfolio as a preferred source in their
  Google Search, AI Overviews, and AI Mode results.

### Notes
- GitHub Pages does not support setting real response headers. The meta-tag
  equivalents are the strongest defence available on this host.
- CSP includes `frame-ancestors 'none'` which replaces the missing
  X-Frame-Options header and defeats clickjacking attacks.

## [v1.2.0] — 2026-08-27

### Added
- Unique meta descriptions per page (70–160 chars, SEO-optimised).
- Favicon set: `.ico`, `.svg`, `.png` variants + Apple touch icon + `site.webmanifest`.
- Canonical `<link>` tags on every page.
- `robots.txt` and `sitemap.xml` at repo root.
- Schema.org JSON-LD structured data: `WebSite` on the home page,
  `Person` on the About page (credentials, universities, skills, social).
- Open Graph and Twitter Card meta tags on every page for social sharing
  previews (LinkedIn, WhatsApp, Slack, iMessage etc.).
- `og-image.png` at repo root for social preview cards.
- Cache-busting query string on `assets/styles.css?v=2`.
- Google Search Console + Bing Webmaster Tools verified with sitemap submitted.
- LinkedIn profile updated to link to portfolio (Contact info, Featured section, About).
- GitHub profile + repository description updated with portfolio link and topics.

### Notes
- WebP image conversion evaluated and deferred — current image loading is acceptable.
- Image alt text audited page-by-page and confirmed descriptive.
- Custom domain (e.g. `adammunn.co.uk`) noted as future consideration.

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