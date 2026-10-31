# SecScan RedTeam Brand Guidelines

English | [中文](BRAND_GUIDELINES.zh.md)

This document defines the SecScan RedTeam brand: the diamond mark, the wordmark, the red theme, and the rules for using them. It covers the SecScan RedTeam product only. Third-party marks (Meta, Muse Spark, and the services the product connects to) belong to their owners and are never presented as SecScan brand assets.

## The mark

The product mark is a **diamond shield**: a red shield outline drawn as a downward-pointing diamond, a black interior, and a blue crosshair at its center. It is the same artwork as the application icon (`apps/desktop/resources/icon.png`), and the canonical vector lives at [`docs/assets/diamond.svg`](docs/assets/diamond.svg).

- The shield outline uses the RedTeam Red gradient, top `#F43F5E` to bottom `#BE123C`.
- The interior is Interior Black `#0B0F1A`. Never fill the interior with red, white, or a photograph.
- The crosshair is Crosshair Blue `#38BDF8`. It is the only blue in the mark; do not recolor it to match a theme.
- On dark surfaces the mark may sit directly on the background. On light surfaces, place it on the Ink Navy tile `#0D1526` (rounded square, as the app icon does) — never on white or a light color directly.

## The wordmark

The product name is written **SecScan RedTeam**: "SecScan" in one word with capital S on both syllables, "RedTeam" in one word with capital R and T, one space between them.

- In the lockup, "SecScan" renders in white or ink and "RedTeam" in RedTeam Red `#F43F5E`. The lockup font is Montserrat (700 for the name, 500 for taglines).
- Write "SecScan" for the company and "SecScan RedTeam" for the product. The assessment/report pair the product presents is named **Assay + Provenance**; those names refer to the product's two halves (the assessment engine and the evidence record) and never replace the product name.
- Do not write the name as "Sec Scan", "SecScan Red Team", "secscan-redteam" (outside file and package names), or any translation of the name into another script.

## The red theme

SecScan RedTeam's visual identity is **red on black**: deep red and near-black surfaces, red as the primary accent, white and slate for text, Crosshair Blue reserved for the mark and for targeting/selection accents in product UI.

| Token | Value | Use |
|---|---|---|
| RedTeam Red | `#E11D48` | Primary accent, rules, active states |
| Red gradient | `#F43F5E` → `#BE123C` | The mark, banner art, headline accents |
| Surface Black | `#0A0A0F` | Page and panel backgrounds |
| Interior Black | `#0B0F1A` | The mark's interior, inset panels |
| Ink Navy | `#0D1526` | Icon tile, raised surfaces |
| Crosshair Blue | `#38BDF8` | The mark's crosshair, selection accents only |
| Text | `#F8FAFC` / `#CBD5E1` / `#8A94A6` | Headings / body / muted on dark |

Severity colors in reports keep their own meaning (critical/high/medium/low) and are not restyled to the brand red scale; a report's grade colors must stay readable as severity, not decoration.

## Usage rules

- Keep clear space around the mark equal to the crosshair's diameter on all sides. Minimum rendered size: 16 px for the mark alone, 120 px wide for the lockup.
- Do not stretch, rotate, outline, shadow, animate, or re-proportion the mark; do not redraw the crosshair as a different reticle; do not place the mark over busy imagery.
- Product screenshots and reports may show the mark as the application renders it. Marketing or documentation art derives from `docs/assets/diamond.svg` and `docs/assets/banner.svg` rather than re-drawing the geometry.
- The mark and wordmark identify SecScan RedTeam only. Do not use them in a way that implies Meta, Muse, or any connected service endorses SecScan RedTeam, and do not apply them to a different product.

## Voice

SecScan RedTeam documentation and product copy state what was proven and how: claims carry their evidence, limits are named plainly, and nothing is described as verified, covered, or secure beyond what a receipt in hand supports.
