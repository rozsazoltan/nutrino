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
- Prefer modern glass surfaces over heavy bordered boxes. Borders should be subtle hairlines or inset highlights, not visible outlines around every component.
- In light mode, use airy warm-green surfaces, soft tinted cards, high readability, and restrained Nutrino green accents instead of flat gray panels.
- Use blur, translucency, and layered opacity for app bars, dialogs, sheets, navigation, and elevated cards when it improves depth without reducing readability.
- Support system, light, and dark theme modes.
- Keep the current Lucide-based icon pack and Nutrino primary green as the brand color.
- Avoid unrelated visual redesigns, decorative noise, and inconsistent one-off component styles.
- After meaningful frontend changes, verify the affected app visually when a local target is available.

## UI polish guardrails

- In light mode, helper, muted, placeholder and secondary text must remain readable. Do not use low-opacity text for essential labels, form hints or row metadata.
- Prefer filled/glass fields and soft elevation over visible framed borders. Inputs should look calm and modern, not like boxed legacy form controls.
- Avoid stacking borders on cards, rows, sheets and dialogs. Use blur, translucency, shadow and spacing to separate surfaces.
- Activity picker rows should not show catalog source chips for every activity. Source metadata is useful for catalog management, not for routine activity logging.
- The home quick-add menu must visually follow the same glass sheet/list pattern as other app menus; avoid a separate legacy action sheet style.
- Bottom navigation active state should color the icon capsule only, not the entire tab button.
- Update prompts must respect same-day dismissals across the header badge, chip and dialog; do not keep resurfacing an update after the user postponed it.
- Fluid-day skip should be a compact decline affordance, while resuming tracking should be an explicit enable-style action.
