# Dawaa Theme Architecture

## Goal
The theme system is a product foundation, not a page-level patch layer.
Every theme must render the same information hierarchy and component behavior with a different palette only.

## Canonical layer order

1. **Legacy/base styles**
   - `index.css`
   - historical design/polish CSS
   - may remain temporarily for compatibility
   - must shrink over time

2. **Legacy compatibility bridge**
   - `src/styles/dawaa-theme.css`
   - translates old hard-coded selectors to semantic theme variables
   - MUST NOT become the home for new component design
   - broad selectors and `!important` are migration debt only

3. **Core design tokens**
   - `src/styles/dawaa-theme-tokens.css`
   - spacing, radius, type scale, control sizes, motion, z-index
   - contains no theme palette colors

4. **Theme palettes / semantic color contract**
   - `src/styles/dawaa-theme-foundation.css`
   - owns Dark, Light and Pharmacy Green palette values
   - owns semantic color roles: background, surface, text, borders, primary, status, overlay, focus, shadows, navigation
   - aligns shadcn/Tailwind semantic CSS variables with Dawaa tokens

5. **Semantic component layer**
   - `src/styles/dawaa-theme-components.css`
   - cards, buttons, inputs, tables, badges, alerts, toolbars, tabs and layout primitives
   - consumes semantic variables only
   - MUST NOT contain hard-coded palette colors

6. **Pages/features**
   - consume semantic component classes or shadcn semantic utilities
   - must not own theme state
   - new/refactored UI should not introduce palette-specific classes for core surfaces such as `bg-slate-*`, `bg-white`, `text-white` or hard-coded hex colors

## Runtime ownership
`ThemeContext` is the only writer of theme state and `<html data-theme>`.

Supported themes:
- `dark`
- `light`
- `pharmacy-green`

`data-theme` is canonical. Legacy `light-mode`/`dark-mode` classes exist only while old CSS is being retired.

## Semantic surface hierarchy
Every theme exposes the same roles:

- `--dawaa-theme-bg`: application canvas
- `--dawaa-theme-bg-soft`: soft section background
- `--dawaa-theme-surface`: default card/panel
- `--dawaa-theme-surface-2`: secondary/hover/soft surface
- `--dawaa-theme-surface-raised`: elevated modal/high-focus surface
- `--dawaa-theme-input`: form controls
- `--dawaa-theme-table-head`, `--dawaa-theme-table-row`, `--dawaa-theme-table-hover`
- `--dawaa-theme-sidebar`, `--dawaa-theme-sidebar-active`, `--dawaa-theme-sidebar-hover`

Pages should never infer hierarchy from literal colors.

## Color philosophy

### Light
Neutral-first, teal-second. White cards sit on a cool neutral canvas. Teal is an interaction/brand accent, not a page wash.

### Dark
Graphite/navy-first, teal-second. Depth comes from controlled surface/elevation separation rather than bright borders or saturated teal backgrounds.

### Pharmacy Green
A branded green alternative with the same neutral hierarchy and component contract, not a renamed Light theme.

## Status colors
Success, warning, danger and info are independent semantic roles. They must not reuse the brand primary color for meaning.

## Accessibility rules
- text/background contrast should target WCAG AA (4.5:1 for normal text)
- focus states remain visible in every theme
- status meaning must not rely on color alone
- reduced-motion preference must disable non-essential motion

## Migration rule
A theme cleanup is complete only when it **removes or isolates old palette ownership**. Adding another override to fix a page is not accepted architecture.

For every refactored page:
1. replace page-level theme colors with semantic classes/tokens
2. remove the corresponding compatibility selectors when no longer needed
3. keep Dark and Light behavior structurally identical
4. verify loading, empty, error, modal, dropdown, table, hover and focus states

## CI expectations
The theme architecture gate must enforce:
- ThemeContext is the only runtime theme writer
- canonical CSS layer order in `main.tsx`
- semantic component CSS contains no hard-coded palette colors
- theme debt is measured and must not expand during migration
