---
version: 1.0
name: Live Photo Studio Design System
description: Mobile-first light UI for a Chinese Live Photo Studio workflow.
colors:
  primary: "#171717"
  secondary: "#4d4d4d"
  tertiary: "#006bff"
  neutral: "#f2f2f2"
  background-100: "#ffffff"
  background-200: "#fafafa"
  gray-100: "#f2f2f2"
  gray-200: "#ebebeb"
  gray-300: "#e6e6e6"
  gray-400: "#eaeaea"
  gray-500: "#c9c9c9"
  gray-600: "#a8a8a8"
  gray-700: "#8f8f8f"
  gray-800: "#7d7d7d"
  gray-900: "#4d4d4d"
  gray-1000: "#171717"
  blue-700: "#006bff"
  red-800: "#ea001d"
  amber-700: "#ffae00"
  green-700: "#28a948"
typography:
  heading-32:
    fontFamily: Geist Sans
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: -1.28px
  heading-24:
    fontFamily: Geist Sans
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.96px
  label-14:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0
  copy-14:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0
  button-14:
    fontFamily: Geist Sans
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
    backgroundColor: "{colors.gray-1000}"
    textColor: "{colors.background-100}"
    typography: "{typography.button-14}"
    rounded: "{rounded.sm}"
    height: 40px
  button-secondary:
    backgroundColor: "{colors.background-100}"
    textColor: "{colors.primary}"
    typography: "{typography.button-14}"
    rounded: "{rounded.sm}"
    height: 40px
  input:
    backgroundColor: "{colors.background-100}"
    textColor: "{colors.primary}"
    typography: "{typography.label-14}"
    rounded: "{rounded.sm}"
    height: 40px
---

# Live Photo Studio Design System

## Overview

The web application is a mobile-first workbench for uploading source photos,
reviewing generated candidates, and downloading an export package for a future
iOS importer. The UI must distinguish a downloadable web package from an asset
already saved in the iPhone Photos library.

## Colors

Use `gray-1000` and `gray-900` for primary and secondary text, `background-100`
and `background-200` for page and elevated surfaces, and `gray-300` for
boundaries. Use `blue-700` for links and focused controls, `green-700` for
success, `amber-700` for recoverable attention, and `red-800` for destructive
or failed states. Disabled controls use `gray-500` with supporting text and
must not rely on color alone. New colors require a token change here.

## Typography

Use `heading-32` for page titles, `heading-24` for section titles,
`label-14` for labels and metadata, `copy-14` for instructions and status
messages, and `button-14` for actions. Technical identifiers may use a
monospace face only in diagnostic views. Do not use arbitrary font sizes in
feature code.

## Layout

The primary content column is fluid with a 390px minimum usable mobile layout
and a 1120px maximum desktop width. Use 16px mobile page padding, 24px desktop
padding, and the spacing tokens for section rhythm. Candidate previews use a
single-column mobile layout and a 2-4 column responsive grid on wider screens.
Primary actions remain reachable near the bottom of the mobile viewport.

## Elevation & Depth

Prefer surface and border hierarchy over heavy shadows. Panels use a 1px
`gray-300` border and at most a small low-contrast shadow. Dialogs and menus
use `background-100`, a stronger boundary, and a visible focus ring in
`blue-700`. Do not encode workflow state only through elevation.

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

Primary buttons use the dark token and have a visible disabled state. Secondary
buttons use a bordered light surface. Inputs always have labels, validation
text, and visible focus. Candidate previews show selection state with text and
border treatment. Tables are for operational comparison; cards are reserved
for media recognition and review. Loading states describe the current stage,
and error states expose a retry or cancel action when available.

## Voice & Content

User-facing copy is Simplified Chinese. Labels use direct verbs for select,
regenerate, cancel and download actions. Errors state what failed, whether
retry is safe, and the next action. Empty states explain what the user needs to
do. Export copy must say that the ZIP is for the future iOS Importer and must
not claim that it is already saved to Photos.

## Theme & Internationalization

- Theme capability: `light-only`.
- Theme toggle: `none`.
- Internationalization: `none`.
- Supported locales: `zh-CN`.
- Default locale: `zh-CN`.
- Prototype rule: omit theme and locale controls.

## Do's and Don'ts

- Do use the token names above in prototypes and production code.
- Do require accessible focus states and body text contrast.
- Do pair color state with icon or text.
- Do use tables for direct operational comparison and media cards only for
  recognition-heavy review.
- Don't add one-off colors, spacing, shadows, or radii without updating this spec.
- Don't claim that a web ZIP is a Photos-library Live Photo.
