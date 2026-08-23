# Dawaa Theme Architecture

## Goal
The theme system is a product foundation, not a page-level patch layer.
Every theme renders the same information hierarchy and component behavior with a different palette only.

## Canonical layer order

1. **Legacy/base styles**
   - `index.css`
   - structural/layout compatibility only
   - palette ownership is forbidden and this layer must shrink over time

2. **Legacy compatibility bridge**
   - `src/styles/dawaa-theme.css`
   - temporary aliases for known historical consumers
   - MUST NOT become the home for new component design or palette values

3. **Core design tokens**
   - `src/styles/dawaa-theme-tokens.css`
   - spacing, radius, type scale, control sizes, motion and z-index
   - contains no palette colors

4. **Foundation semantics**
   - `src/styles/dawaa-theme-foundation.css`
   - semantic surface/text/status/navigation utilities only
   - palette-neutral; it never declares Dark/Light/Green values

5. **Canonical palettes**
   - `src/styles/dawaa-theme-palettes.css`
   - the single owner of Dark, Light and Pharmacy Green color values
   - owns canvas, surfaces, text, borders, primary, statuses, focus, shadow, chart and navigation values
   - v5 direction: Light is truly neutral-first; general soft surfaces are separated from brand accent-soft surfaces; Dark remains charcoal/graphite-first

6. **Semantic components**
   - `src/styles/dawaa-theme-components.css`
   - cards, buttons, inputs, tables, badges, alerts, toolbars, tabs and operational primitives
   - consumes semantic variables only
   - MUST NOT contain hard-coded palette colors

7. **Application shell**
   - `src/styles/dawaa-theme-shell.css`
   - shared page canvas, header, sidebar and navigation behavior
   - owns application chrome only, never feature-specific design

8. **Pages/features**
   - consume semantic components or shadcn semantic utilities
   - never own theme state
   - migrated UI must not introduce palette-specific core surfaces such as `bg-slate-*`, `bg-white`, `text-white`, fixed dark overlays or hard-coded hex values

## Runtime ownership
`ThemeContext` is the only writer of theme state and `<html data-theme>`.

Supported themes:
- `dark`
- `light`
- `pharmacy-green`

`data-theme` is the only runtime theme contract. Retired `light-mode`, `dark-mode` and `data-palette` engines must not be reintroduced.

## Semantic surface hierarchy
Every theme exposes the same roles:

- `--dawaa-theme-bg`: application canvas
- `--dawaa-theme-bg-soft`: soft section background
- `--dawaa-theme-surface`: default card/panel
- `--dawaa-theme-surface-2`: secondary/hover/soft surface
- `--dawaa-theme-surface-raised`: elevated/high-focus surface
- `--dawaa-theme-soft`: neutral low-emphasis fill; never a brand wash
- `--dawaa-theme-accent-soft`: restrained brand-tinted fill for deliberate brand/selection emphasis
- `--dawaa-theme-accent-border`: restrained brand-tinted border for selected/brand elements
- `--dawaa-theme-input`: form controls
- `--dawaa-theme-table-head`, `--dawaa-theme-table-row`, `--dawaa-theme-table-hover`
- `--dawaa-theme-sidebar`, `--dawaa-theme-sidebar-active`, `--dawaa-theme-sidebar-hover`
- `--dawaa-theme-ambient`: optional theme-owned page ambience; `none` in neutral light themes

Pages never infer hierarchy from literal colors.

## Color philosophy

### Light — v5
The Light theme is an operational neutral theme, not a pale-green version of the brand.

Rules:
- canvas is a soft neutral gray, not mint
- cards are white/near-white with subtle neutral borders
- secondary surfaces are neutral gray and must be visibly distinct from both canvas and cards
- sidebar active/hover backgrounds remain neutral; teal may appear in active text/icon/accent only
- `--dawaa-theme-soft` is neutral and safe for repeated use across large grids
- `--dawaa-theme-accent-soft` is intentionally scarce: brand chips, selected choices, unread indicators, focus-related emphasis and small identity accents
- primary teal is reserved for important actions, active identity, links and focus
- success/warning/danger/info backgrounds stay low-saturation and should not dominate large areas
- charts use their own semantic series/axis/grid/tooltip contract and must remain readable on white surfaces

The desired result is calm hierarchy: canvas → card → soft inner surface → selected/accent state, without aqua/mint wash or white-on-white ambiguity.

### Dark
Charcoal/graphite hierarchy with controlled elevation levels. Teal remains a deliberate accent. Depth comes from surfaces, typography and soft borders—not saturated blue/teal backgrounds.

### Pharmacy Green
A branded green alternative with the same neutral hierarchy and component contract, not a renamed Light theme.

## Status color policy
Success, warning, danger and info are semantic states—not alternative card themes.

Default rule:
- operational cards stay on neutral `surface` / `surface-2`
- state is communicated with a semantic badge, icon, small accent or compact indicator
- a full tinted surface is reserved for a real alert/message where the status itself is the content
- large grids must not become a mosaic of green/yellow/red backgrounds
- status meaning must always include text/iconography, not color alone

This rule applies to dashboards, KPI cards, data-health checks, notification centers and doctor pages.

## Accessibility rules
- text/background contrast targets WCAG AA (4.5:1 normal text)
- focus states remain visible in every theme
- status meaning never relies on color alone
- reduced-motion preference disables non-essential motion

## Migration rule
A theme cleanup is complete only when it **removes or isolates old palette ownership**. Adding another page override is not accepted architecture.

For every refactored page:
1. replace page-level palette colors with semantic classes/tokens
2. remove the corresponding compatibility selectors when no longer needed
3. keep Dark and Light structure identical
4. use neutral cards with status accents unless the component is an actual alert
5. verify loading, empty, error, modal, dropdown, table, hover and focus states
6. remove fixed page-wide gradients/overlays unless represented by a semantic ambient token
7. lock the migrated file to zero theme debt in `audit-theme-debt.cjs`

## CI expectations
The theme architecture gate must enforce:
- ThemeContext is the only runtime theme writer
- canonical CSS layer order in `main.tsx`
- palette values live only in `dawaa-theme-palettes.css`
- every palette implements neutral soft + accent-soft + accent-border contracts
- foundation/base/components/shell/polish files remain palette-neutral
- application shell does not contain feature-specific palette ownership
- migrated zero-debt UI files cannot regress
- global theme debt is measured and must trend downward during migration
