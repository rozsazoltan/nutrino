# Repository Instructions

Act as a senior software engineer and architecture partner for Nutrino.

When the user writes in Hungarian, answer in Hungarian by default. Write issue titles, PR descriptions, commit messages, changelogs, release notes, documentation, code comments, and product copy in natural professional English unless the user explicitly asks for Hungarian.

## Engineering Standards

- Prefer production-ready, typed, modular changes over broad rewrites.
- Keep responsibilities clear across Vue, TypeScript, Rust, Tauri, and release tooling.
- Preserve local-first privacy boundaries: mobile diary data stays private unless the user explicitly exports, imports, approves a handoff, or copies generated data.
- Use existing repo patterns, scripts, and helper APIs before introducing new abstractions.
- Add or update tests close to changed behavior when the change affects calculations, persistence, release selection, sync, Tauri commands, or workflow invariants.

## Documentation Boundaries

- `README.md` is user-facing usage documentation only.
- `CONTRIBUTING.md` is the developer, setup, testing, release, and contribution guide.
- Changelogs and release notes must follow Keep a Changelog categories: Added, Changed, Removed, Fixed, and Security.
- Commit messages must follow Conventional Commits 1.0.0.

## Tooling

- Use mise and aube as the local toolchain entry points.
- Run focused checks first while developing, then the relevant full gate before finishing.
- For release workflow changes, update and run `aube run check:release-workflows` or `node scripts/check-release-workflows.mjs`.
- Do not introduce npm, pnpm, yarn, or bun lockfiles; this repo uses aube-managed JavaScript dependencies.

## Release Automation

Nutrino release automation is split by responsibility:

```text
verzly/github-release  -> release branch, version bump, merge, tag, release, cleanup
verzly/tauri-release   -> Android, iOS, Windows, macOS, Linux artifacts
verzly/android-signing -> Android release keystore helper and fingerprint verification
```

Keep release configuration in `.github/release/*.toml` and workflow orchestration in `.github/workflows/release.yml`.

## Android Signing

- `mise.toml` pins `github:verzly/android-signing` to `0.3.0`.
- `.github/workflows/release.yml` must verify the Android release keystore fingerprint with `verzly/android-signing@v0.3.0` before building Android artifacts.
- CI must verify an existing key; it must not generate a new release keystore.
- Stable Android sideload updates require the same Android application identifier, the same release key, the same signing certificate fingerprint, and an increasing `versionCode`.
- Required CI values are `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and `ANDROID_SIGNING_CERT_SHA256`.
- Treat release keystores, base64 keystores, passwords, and generated `keystore.properties` files as secrets. Never commit them.

## UI Design Direction

- Maintain a clean iOS/macOS-inspired interface: calm surfaces, restrained contrast, soft system shadows, consistent spacing, and compact readable controls.
- Prefer modern glass surfaces over bordered boxes. Desktop and mobile app UI should not use visible component outlines; separate surfaces with opacity, blur, spacing, and soft elevation instead.
- In light mode, use airy warm-green surfaces, soft tinted cards, high readability, and restrained Nutrino green accents instead of flat gray panels.
- Use blur, translucency, and layered opacity for app bars, dialogs, sheets, navigation, and elevated cards when it improves depth without reducing readability.
- Support system, light, and dark theme modes.
- Keep the current Lucide-based icon pack and Nutrino primary green as the brand color.
- Avoid unrelated visual redesigns, decorative noise, and inconsistent one-off component styles.
- After meaningful frontend changes, verify the affected app visually when a local target is available.

## UI polish guardrails

- In light mode, helper, muted, placeholder and secondary text must remain readable. Do not use low-opacity text for essential labels, form hints or row metadata.
- Prefer filled/glass fields and soft elevation over visible framed borders. Inputs should look calm and modern, not like boxed legacy form controls.
- Avoid visible borders on cards, rows, sheets, dialogs, navigation, chips, and list items. Use blur, translucency, shadow and spacing to separate surfaces.
- Activity picker rows should not show catalog source chips for every activity. Source metadata is useful for catalog management, not for routine activity logging.
- The home quick-add menu must visually follow the same glass sheet/list pattern as other app menus; avoid a separate legacy action sheet style.
- Bottom navigation active state should color the icon capsule only, not the entire tab button.
- Update prompts must respect same-day dismissals across the header badge, chip and dialog; do not keep resurfacing an update after the user postponed it.
- Fluid-day skip should be a compact decline affordance, while resuming tracking should be an explicit enable-style action.

- Desktop controls should follow the mobile visual language: pill-shaped, borderless, softly elevated, and theme-aware. Active navigation must not color the full row; only the icon capsule may carry the selected state.
- Do not use light text on light cards or dark text on dark cards. Define separate light/dark text tokens for any new surface, chart, metric, or control state.
- Prefer opacity for layered surfaces, not for essential typography. Labels, values, macros, and action text must remain fully readable in both light and dark mode.

## Executive UI Quality Bar

- Treat Nutrino UI polish as product-critical. Aim for a calm, premium, closed-source-app feel: minimal visible chrome, excellent spacing, sharp hierarchy, and no compressed labels.
- Do not place desktop page actions beside titles/descriptions when that squeezes copy. The title and description own the row; actions wrap below with comfortable spacing.
- Form fields must never show legacy top borders, hard outlines, or inset highlight lines. Use filled/glass surfaces, clear text contrast, and a diffuse focus glow.
- Settings screens need generous margins between modules, rows, and theme choices on mobile and desktop. Avoid edge-to-edge cramped lists unless intentionally designed as a native grouped list.
- Navigation selection should be subtle and icon-led, inspired by minimalist launchers: no full-row active slabs and no heavy selected borders.

## Niagara-like Calm UI Guardrail

- Use Niagara Launcher as inspiration only for interaction and visual principles: list-first hierarchy, very low chrome, one-handed clarity on mobile, and fast scannable rows. Do not copy proprietary assets, screens, names, or exact layouts.
- Avoid “background soup”: do not stack many differently tinted cards inside each other. Prefer one calm page background, transparent/list rows, and only a few elevated hero/modal surfaces.
- Catalog management on desktop should read as a clean list, not an old spreadsheet. Use row spacing, soft hover, readable columns, and compact inline actions; avoid full-width green hover slabs or boxed action pills.
- Inputs, selects, tables, settings rows, chips, and nav items must stay borderless. No top inset lines, no hard outlines, no visible table grid, no selected full-row slabs.
- Buttons should not sit beside long titles/descriptions on desktop when that compresses copy. Page actions wrap below; row actions stay compact and secondary.
- Light and dark mode must have separate high-contrast text tokens. Decorative opacity is allowed on surfaces, not on essential text.

## Current UI correction guardrails

- Desktop settings must visually follow the mobile settings model: one readable column, grouped sections, rounded row actions, icon/copy/action alignment, and no nested boxed panels.
- Mobile bottom navigation should use the older, calmer pattern: transparent tab buttons, a translucent bottom bar, and color only on the active icon capsule. Never tint every nav icon capsule by default.
- Avoid full-page decorative gradients on mobile. Use a calm, solid app background and reserve blur/opacity for cards, sheets, and app bars.
- Mobile cards should use one consistent glass surface token, not many unrelated green/gray tinted backgrounds. Rows inside cards should usually stay transparent.

## Desktop catalog and server layout rules

- Server panels must be structurally readable before they are decorative: input fields in a dedicated field row, actions in a separate action row, and no button may overlap a label or input.
- Sidebar navigation needs a clearly separated but quiet surface. Use opacity, blur and shadow; do not leave the menu visually lost in the page background.
- Catalog cards must not place four action buttons beside the title. Use a title row with one overflow/menu trigger, then let the description/note use the full content width.
- CSV “skip duplicates” is a boolean option and must render as a real checkbox, not as a radio-looking pill, switch, or ambiguous custom control.
- Do not solve cramped desktop UI by shrinking text. Fix the structure: move actions into overflow menus, create a second row, or simplify the action surface.

## Desktop settings and recovery rules

- Catalog card titles and the overflow menu trigger must share the same first row. The description and metadata belong below on full width.
- Overflow menus must be layered above following DOM content. Keep card/list wrappers overflow-visible and raise the open menu/card z-index.
- Desktop language selection can use available width. Prefer responsive multi-column grids instead of a long one-column list when the viewport is wide.
- Settings rows must keep the chevron, toggle, or trailing control aligned at the far right of the row. Never let trailing icons wrap into a third line under the copy.
- Destructive desktop recovery actions must create a local backup profile before data deletion whenever possible, then ask for final confirmation before continuing.
- Desktop must expose local backup profiles in Settings, matching the mobile recovery model: list profiles, create a manual profile, restore, and delete.

## Desktop information and catalog presentation rules

- Desktop Settings should keep long informational content out of the main settings page. Licenses, Privacy, and About belong in subdialogs opened from concise settings rows, matching the mobile settings pattern.
- Destructive settings rows must not become large red slabs. Use a subtle danger icon/accent and keep the row visually calm until the confirmation step.
- Desktop food catalog entries should not render as spreadsheet-like tables. Use card/list rows with the title and overflow menu on the first line, one full-width description/identity line, and one scannable data line for nutrition.
- Recipe nutrition metadata may use responsive multi-column grids when space allows. Do not force two-column layouts on wide desktop screens.
- Overflow menus must behave like top-layer UI. The open card/menu must receive the highest practical z-index and all relevant wrappers must remain overflow-visible.

## Flat mobile and menu layering rules

- Mobile controls should stay flat: no decorative shadows, no hover rings, no hard outlines, and no colored shadow glows on routine card actions.
- Mobile fluid card actions must share one calm flat visual language. Avoid separate green/red raised button treatments unless the destructive state is part of a confirmation flow.
- Mobile sheets, add-item dialogs, inputs, and pickers must not show legacy top borders or white inset highlight lines.
- Compact mobile filters may use an icon-sized select affordance when the surrounding context already explains the search scope; avoid truncated labels like “Kata”.
- Overflow menus on mobile and desktop must be able to escape parent card clipping and must render above following DOM content. Prefer explicit open classes, overflow-visible wrappers, and top-layer z-index values over relying on native details stacking.
- License, Privacy, and About subdialogs should use icon/title/body hierarchy. Do not underline license cards or compress title, description, and license into one row.
