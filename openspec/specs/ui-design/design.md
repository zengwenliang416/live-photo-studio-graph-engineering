---
version: 2.0
name: Live Photo Studio Design System
description: Desktop-first obsidian editorial workbench for a Chinese Live Photo Studio workflow.
colors:
  canvas: "#0a0a0b"
  surface: "#141416"
  surface-raised: "#1c1c1f"
  surface-subtle: "#242428"
  border: "#28282d"
  border-strong: "#35353c"
  text: "#f5f5f0"
  muted: "#a3a39e"
  muted-dim: "#73736c"
  gold: "#e6af2e"
  red: "#ef4444"
  green: "#10b981"
typography:
  display-48:
    fontFamily: Cormorant Garamond
    fontSize: 48px
    fontWeight: 400
    lineHeight: 52px
    letterSpacing: -1.2px
  heading-26:
    fontFamily: Cormorant Garamond
    fontSize: 26px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.4px
  label-14:
    fontFamily: Avenir Next
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0
  copy-14:
    fontFamily: Avenir Next
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0
  button-14:
    fontFamily: Avenir Next
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 40px
rounded:
  sm: 6px
  md: 12px
  lg: 16px
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.canvas}"
    typography: "{typography.button-14}"
    rounded: "{rounded.sm}"
    height: 40px
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.button-14}"
    rounded: "{rounded.sm}"
    height: 40px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label-14}"
    rounded: "{rounded.sm}"
    height: 40px
---

# Live Photo Studio Design System

## Overview

The web application is a desktop-first creative workbench for uploading source photos,
reviewing generated candidates, and downloading an export package for a future
iOS importer. The UI must distinguish a downloadable web package from an asset
already saved in the iPhone Photos library.

## Colors

Use the obsidian canvas with layered slate surfaces and warm ivory text. Gold is
reserved for selection, progress and primary generation actions. Green marks
completed or healthy states; red is reserved for destructive or failed states.
Style cards may use their versioned three-color palettes as content imagery,
while all surrounding workbench chrome stays neutral.

## Typography

Use `display-48` for desktop page titles, `heading-26` for section titles,
`label-14` for labels and metadata, `copy-14` for instructions and status
messages, and `button-14` for actions. Cormorant Garamond is the editorial
display face; Avenir Next is the UI face. Technical identifiers may use a
monospace face only in diagnostic views.

## Layout

The default desktop layout is a persistent 224px navigation rail plus a fluid
workspace. Workspace content may grow to 1440px and uses 12-column composition:
media and task content occupies 7-9 columns while context, settings or actions
occupy 3-5 columns. Project and style catalogs use 3-4 column grids. At 900px
and below, the navigation rail is removed and the workspace collapses to a
single flow. The 390px layout remains fully usable, but it is a responsive
fallback rather than the source of the desktop information architecture.

## Elevation & Depth

Prefer surface and border hierarchy over heavy shadows. Panels use a refined
hairline border; selected media and styles use a gold boundary plus explicit
text/check state. Dialogs use `surface-raised`, a stronger boundary and a gold
focus ring. Do not encode workflow state only through elevation.

## Motion

Use short 150-250ms transitions for local disclosure and button feedback.
Progressive content may fade in after server state changes, but generation and
rendering must not use fake percentage animation. Respect
`prefers-reduced-motion` by disabling non-essential transitions and never block
task completion on animation.

## Shapes

Use `rounded-sm` for buttons, inputs and compact controls, `rounded-md` for
panels and candidate previews, and `rounded-lg` for dialogs or prominent
workflow surfaces. Status badges may use `rounded-md`; avoid a separate pill
system unless the status semantics require it.

## Components

Primary buttons use gold on obsidian and have a visible disabled state.
Secondary buttons use a bordered slate surface. Inputs always have labels,
validation text and visible focus. Style cards contain a local visual preview,
category, palette, suitability and recommended motion. Candidate previews show
selection state with text and border treatment. Loading states describe the
current stage, and error states expose a retry or cancel action when available.

## Voice & Content

User-facing copy is Simplified Chinese. Labels use direct verbs for select,
regenerate, cancel and download actions. Errors state what failed, whether
retry is safe, and the next action. Empty states explain what the user needs to
do. Export copy must say that the ZIP is for the future iOS Importer and must
not claim that it is already saved to Photos.

## Theme & Internationalization

- Theme capability: `dark-only`.
- Theme toggle: `none`.
- Internationalization: `none`.
- Supported locales: `zh-CN`.
- Default locale: `zh-CN`.
- Prototype rule: omit theme and locale controls.

## Do's and Don'ts

- Do use the token names above in prototypes and production code.
- Do require accessible focus states and body text contrast.
- Do pair color state with icon or text.
- Do use the persistent desktop rail and 12-column workbench at wide widths.
- Do use compact high-density grids for style and candidate recognition.
- Don't turn desktop views into a centered 720px mobile form.
- Don't add one-off colors, spacing, shadows, or radii without updating this spec.
- Don't claim that a web ZIP is a Photos-library Live Photo.
