# nutrino

Offline-first nutrition tracker built with Tauri v2 for logging daily meals, calories, macros, activity, BMI, and weight, with desktop database sync for foods and recipes.

`nutrino` is designed for people who want nutrition tracking without depending on public food databases or online food search. You maintain your own food, recipe, and activity catalog on a desktop server. The mobile app syncs that catalog on your local network and keeps diary data offline on the device.

- [What it is](#what-it-is)
- [How it works](#how-it-works)
  - [Desktop server](#desktop-server)
  - [Mobile app](#mobile-app)
  - [Data model and sync](#data-model-and-sync)
  - [Backup and restore](#backup-and-restore)
- [Privacy](#privacy)
- [Contributing](#contributing)

## What it is

`nutrino` is a two-app nutrition tracking system:

- `nutrino Desktop` manages the local food database, recipes, activity definitions, CSV imports/exports, backups, and the LAN API server.
- `nutrino Mobile` is the daily diary app for Android. It tracks meals, activities, calories, macros, BMI, weight, and goals while staying usable offline.

The desktop app is the catalog source of truth. The mobile app is the personal diary and offline cache. Fresh installs intentionally do not contain preloaded foods or recipes; use the separate CSV starter files when you want the optional Hungarian catalog.

## How it works

```text
Desktop app
  ├─ stores foods, recipes, activities and desktop settings
  ├─ exposes a local LAN API, for example http://192.168.1.202:8090/api/v1
  └─ increases catalog_revision when catalog data changes

Mobile app
  ├─ pulls foods, recipes and activities from the desktop server
  ├─ stores diary/profile/weight data locally on the device
  ├─ monitors server health and catalog_revision
  └─ continues working when the desktop server is offline
```

Mobile diary entries are not uploaded to the desktop server. This is intentional: the desktop manages shared catalog data, while personal diary data stays on the phone unless you export it.

### Desktop server

- Local food catalog management with optional notes; fresh installs start with an empty food/recipe catalog
- Recipe builder using stable food IDs and optional recipe notes; recipes are imported or created by the user
- Activity catalog management
- CSV import/export for foods, recipes, and activities
- ZIP backup/restore with manifest validation
- Local LAN API server for mobile sync
- System tray support
- Optional launch on Windows startup
- Optional start hidden in tray
- Optional auto-start LAN API server

### Mobile app

- Offline-first daily diary
- Home dashboard with today-only calories, supplied/burned values, and macro rings that roll over at midnight
- Meal sections: Activity, Breakfast, Lunch, Dinner, Snack
- Food and recipe picker with shared search, including notes
- Local recipe customization per diary entry
- Activity logging from catalog, watch, or manual kcal input
- Calendar diary with weight, BMI, daily macros, and editable day unlock
- Profile with height, weight, birthday/age, gender, activity level, and weekly goal
- BMI and kcal status coloring
- Hungarian and English UI
- ZIP export/import for complete app data

### Data model and sync

The catalog sync model is one-way:

```text
Desktop catalog → Mobile cache
```

The desktop server owns:

- foods with optional notes, imported from CSV or created manually
- recipes with optional notes, imported from CSV or created manually
- recipe ingredients
- activity definitions

The mobile app owns:

- diary entries
- activity logs
- weight logs
- profile and calculation settings
- app language and local UI settings

The desktop `/api/v1/health` endpoint exposes a `catalog_revision`. The mobile app polls it and pulls fresh catalog data when the revision changes.

### Optional starter catalog CSVs

Fresh desktop databases are intentionally empty for foods and recipes. Nutrino does not silently preload example foods into a new installation.

Use the separate CSV starter files when you want the optional Hungarian catalog:

```text
nutrino-foods-v0.5.24.csv
nutrino-recipes-v0.5.24.csv
```

The CSV starter catalog is intentionally kept outside the monorepo ZIP. Importing these CSVs is an explicit user action from the desktop app.

### Backup and restore

Both apps support full ZIP backup/restore.

Desktop exports use this format:

```text
nutrino-desktop-server-v0.5.24-YYYYMMDD-HHMMSS.zip
```

Mobile exports use this format:

```text
nutrino-mobile-app-v0.5.24-YYYYMMDD-HHMMSS.zip
```

Each backup contains a `manifest.json` with the app name, backup type, version, and export timestamp. Import validates the manifest before allowing overwrite.

After a mobile factory reset, use **Restore backup** on the first-run setup screen to import a previous mobile ZIP backup before creating a new profile. The mobile app also keeps local **Backup Profiles** separately from the normal profile. It creates safety restore points before export, import, backup-profile restore, and factory reset so an in-app reset does not remove the last recoverable state.

On Android, mobile backup export uses the Android Storage Access Framework save picker directly and writes the ZIP through Android's selected document URI. The app reads the selected file back byte-for-byte before reporting success, so a `0 B` file is not treated as a valid export. The older WebView download, share-sheet-only, and Tauri dialog URI-write paths are intentionally avoided for Android backup export because they can produce files that other Android apps see as empty. Mobile import uses the same Android document picker before falling back to non-Android picker paths.

## Third-party notices and acknowledgements

Nutrino includes a **Licenses** view in the apps and a `THIRD_PARTY_NOTICES.md` file in the repository. The notices cover the current direct runtime/tooling projects and icon sources used by Nutrino.

Special thanks to OpenNutriTracker for the privacy-first nutrition tracker inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.

## Privacy

`nutrino` is designed to be local-first and privacy-first.

- No public food database is queried.
- No account is required.
- No analytics are collected.
- Mobile diary data stays on the phone.
- Desktop catalog data stays on your machine.
- Sync happens only against your configured desktop LAN API server.

## Contributing

Issues and pull requests are welcome.

- Report bugs: https://github.com/rozsazoltan/nutrino/issues
- Request features: https://github.com/rozsazoltan/nutrino/issues
- Source code: https://github.com/rozsazoltan/nutrino

Please include the app version, platform, and reproduction steps when reporting bugs.

### Requirements

- Node.js
- pnpm
- Rust and Cargo
- Tauri v2 prerequisites
- Android Studio, Android SDK and NDK for Android development
- A physical Android device or emulator for mobile testing

### Get started

Repository layout:
```text
nutrino/
  apps/
    desktop/        Tauri v2 desktop app and LAN API server
    mobile/         Tauri v2 Android-first mobile app
  packages/
    shared/         Shared TypeScript domain types
    ui/             Shared design tokens
  .github/          GitHub Actions and issue templates
```

Install dependencies from the repository root:

```bash
pnpm install
```

Run the desktop app:

```bash
pnpm desktop:dev
```

Initialize the generated Android project once per fresh checkout:

```bash
pnpm mobile:android:init
```

Run the mobile app on a connected Android device. Replace the host with your desktop LAN IP:

```bash
pnpm mobile:android:dev -- --host 192.168.1.202
```

### Root scripts

```bash
pnpm desktop:dev                  # run the desktop Tauri app
pnpm desktop:build                # build the desktop app
pnpm mobile:android:init          # generate Android project once, patched as dev by default
pnpm mobile:android:patch         # patch generated Android project as dev by default
pnpm mobile:android:dev           # live Android development: Nutrino Dev + Vite dev server
pnpm mobile:android:build         # packaged offline dev APK, aarch64 only
pnpm mobile:android:apk           # packaged offline dev APK: Nutrino Dev / net.datarose.nutrino.mobile.dev
pnpm mobile:android:apk:dev       # explicit packaged offline dev APK
pnpm mobile:android:apk:stable    # stable release APK: Nutrino / net.datarose.nutrino.mobile, aarch64 only
pnpm mobile:android:apk:release   # same stable release APK path; uses real signing if configured, otherwise local debug-sign fallback
pnpm mobile:android:aab           # Play Store-oriented stable AAB: aarch64 + armv7
pnpm mobile:android:universal     # packaged offline dev universal APK for all Android ABIs, slower
pnpm check                        # run web builds for both apps
```

### Recommended Android dev flow

Dev channel installs as a separate app named `Nutrino Dev` with package ID `net.datarose.nutrino.mobile.dev`. This lets you keep your stable `Nutrino` app installed while developing.

Use `pnpm mobile:android:dev` only for live development. It intentionally uses Tauri's `build.devUrl` and a Vite dev server, so that app expects your desktop dev server to be reachable from the phone.

```bash
pnpm mobile:android:init
pnpm mobile:android:dev -- --host <your-desktop-lan-ip>
```

The stable channel keeps package ID `net.datarose.nutrino.mobile`. The Android scripts patch both `src-tauri/tauri.conf.json` and the generated Android project before running Tauri, so the CLI starts the correct `MainActivity` for the selected channel.

### Recommended Android APK build flow

For daily development/testing without a Vite server, build the packaged dev APK. It uses the dev package ID but bundles the built frontend from `dist`, so it works offline after installation:

```bash
pnpm mobile:android:apk
# or
pnpm mobile:android:apk:dev
```

Only use the explicit debug APK when you specifically need the Android/Rust debug profile:

```bash
pnpm mobile:android:apk:dev:debug
```

For your own stable sideload build, use the stable APK command. This uses the stable package ID and app name. It builds the optimized release variant; if you have not configured a real keystore yet, the generated Android project is patched to use Android debug signing only as a local sideload fallback:

```bash
pnpm mobile:android:apk:stable
```

The explicit release alias is also available:

```bash
pnpm mobile:android:apk:release
```

If no `src-tauri/gen/android/keystore.properties` exists, Nutrino patches the generated Android project to sign local release APKs with Android's debug signing config so the APK is still a valid sideloadable Android package. Configure a real release keystore before distributing outside your own devices or publishing to a store. Use `pnpm mobile:android:apk:stable:debug` only when you specifically need to inspect a debug stable build; use the normal APK commands for offline installable builds.

For a Play Store-oriented release bundle:

```bash
pnpm mobile:android:aab
```

The default fast APK commands target only `aarch64`, which is the normal ABI for modern physical Android phones. The universal Android debug build is intentionally separate because compiling all Android ABIs is much slower:

```bash
pnpm mobile:android:universal
```

After `tauri android init`, Nutrino's patch step force-copies the canonical Nutrino launcher icon resources into the generated Android project. If Android still shows the Tauri icon, remove the old generated Android project or run:

```bash
cd apps/mobile
pnpm android:patch
# optionally, for a fully clean rebuild
pnpm android:clean
pnpm android:init
```

If an older generated Android project still contains slow Gradle settings from a previous Nutrino version, run:

```bash
cd apps/mobile
pnpm android:patch
# optionally, for a fully clean rebuild
pnpm android:clean
```


### Android Kotlin daemon cache recovery

If Android dev/build logs show Kotlin daemon errors like `this and base files have different roots` on Windows, run a clean + patch cycle. Nutrino disables Kotlin incremental compilation in the generated Android project because Tauri plugin Kotlin sources may live in the Cargo registry on `C:` while the generated Android project lives on another drive such as `D:`. Rust and Gradle parallelism remain enabled.

```bash
pnpm mobile:android:clean
pnpm mobile:android:patch
pnpm mobile:android:dev -- --host <your-desktop-lan-ip>
```

The mobile app intentionally avoids using `tauri.localhost` for LAN API access in development. The desktop LAN IP is used instead.

## Third-party notices

Selected UI SVG icons are from Lucide and are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

`nutrino` is licensed under **AGPL-3.0-only**.

See [LICENSE](LICENSE) for details.
