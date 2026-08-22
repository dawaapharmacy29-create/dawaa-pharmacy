# Dawaa Theme Architecture

## Goal
The theme system is a product foundation, not a page-level patch layer.
Every theme renders the same information hierarchy and component behavior with a different palette only.

## Canonical layer order

1. **Legacy/base styles**
   - `index.css`
   - historical design/polish CSS
   - compatibility only; this layer must shrink over time

2. **Legacy compatibility bridge**
   - `src/styles/dawaa-theme.css`
   - translates historical hard-coded selectors to semantic variables
   - MUST NOT become the home for new component design
   - broad selectors and `!important` are migration debt only

3. **Core design tokens**
   - `src/styles/dawaa-theme-tokens.css`
   - spacing, radius, type scale, control sizes, motion and z-index
   - contains no palette colors

4. **Foundation semantics**
   - `src/styles/dawaa-theme-foundation.css`
   - declares semantic roles and compatibility utilities used during migration
   - does not own the final product palette anymore

5. **Canonical palettes**
   - `src/styles/dawaa-theme-palettes.css`
   - single owner of Dark, Light and Pharmacy Green color values
   - owns background, surfaces, text, borders, primary, statuses, focus, shadow and navigation values
   - Light is neutral-first; Dark is graphite-first; brand teal is an accent rather than a page wash

6. **Semantic components**
   - `src/styles/dawaa-theme-components.css`
   - cards, buttons, inputs, tables, badges, alerts, toolbars, tabs and shared primitives
   - consumes semantic variables only
   - MUST NOT contain hard-coded palette colors

7. **Application shell**
   - `src/styles/dawaa-theme-shell.css`
   - shared page canvas, header, sidebar, navigation and status-surface behavior
   - owns application chrome only, never feature-specific design

8. **Pages/features**
   - consume semantic components or shadcn semantic utilities
   - never own theme state
   - new/refactored UI must not introduce palette-specific core surfaces such as `bg-slate-*`, `bg-white`, `text-white`, fixed dark overlays or hard-coded hex values

## Runtime ownership
`ThemeContext` is the only writer of theme state and `<html data-theme>`.

Supported themes:
- `dark`
- `light`
- `pharmacy-green`

`data-theme` is canonical. Legacy `light-mode`/`dark-mode` classes exist only while old CSS is retired.

## Semantic surface hierarchy
Every theme exposes the same roles:

- `--dawaa-theme-bg`: application canvas
- `--dawaa-theme-bg-soft`: soft section background
- `--dawaa-theme-surface`: default card/panel
- `--dawaa-theme-surface-2`: secondary/hover/soft surface
- `--dawaa-theme-surface-raised`: elevated/high-focus surface
- `--dawaa-theme-input`: form controls
- `--dawaa-theme-table-head`, `--dawaa-theme-table-row`, `--dawaa-theme-table-hover`
- `--dawaa-theme-sidebar`, `--dawaa-theme-sidebar-active`, `--dawaa-theme-sidebar-hover`
- `--dawaa-theme-ambient`: optional theme-owned page ambience; `none` in neutral light themes

Pages never infer hierarchy from literal colors.

## Color philosophy

### Light
Neutral canvas + white surfaces + restrained status tints. Teal is reserved for brand, focus, active navigation and primary actions. Large empty areas must not carry aqua/mint washes.

### Dark
Graphite/navy hierarchy with three controlled elevation levels. Teal remains a deliberate accent. Depth comes from surfaces and soft borders, not saturated blue/teal backgrounds.

### Pharmacy Green
A branded green alternative with the same neutral hierarchy and component contract, not a renamed Light theme.

## Status colors
Success, warning, danger and info are independent semantic roles. Status cards use low-saturation backgrounds and readable text/borders; color must communicate state without dominating the whole page.

## Accessibility rules
- text/background contrast targets WCAG AA (4.5:1 normal text)
- focus states remain visible in every theme
- status meaning never relies on color alone
- reduced-motion preference disables non-essential motion

## Migration rule
A theme cleanup is complete only when it **removes or isolates old palette ownership**. Adding another page override is not accepted architecture.

For every refactored page:
1. replace page-level theme colors with semantic classes/tokens
2. remove the corresponding compatibility selectors when no longer needed
3. keep Dark and Light structure identical
4. verify loading, empty, error, modal, dropdown, table, hover and focus states
5. remove fixed page-wide gradients/overlays unless they are represented by a semantic ambient token

## CI expectations
The theme architecture gate must enforce:
- ThemeContext is the only runtime theme writer
- canonical CSS layer order in `main.tsx`
- palette values live only in the palette/foundation compatibility area
- semantic component CSS contains no hard-coded palette colors
- application shell does not contain feature-specific selectors
- theme debt is measured and must not expand during migration
