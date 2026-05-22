#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { channelConfig, parseChannel, patchTauriConfig } from './android-channel.mjs';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'src-tauri', 'gen', 'android');
const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePropertiesPath = path.join(androidDir, 'gradle.properties');
const androidIconSourceDir = path.join(projectRoot, 'src-tauri', 'android-icons');
const androidResDir = path.join(androidDir, 'app', 'src', 'main', 'res');
const androidAppGradlePaths = [
  path.join(androidDir, 'app', 'build.gradle.kts'),
  path.join(androidDir, 'app', 'build.gradle'),
];
const NATIVE_STATE_VERSION = 4;
const forceNativeClean = process.argv.includes('--force-native-clean')
  || process.env.NUTRINO_FORCE_ANDROID_NATIVE_CLEAN === '1';

function cpuCount() {
  return Math.max(2, Math.min(os.cpus()?.length || 4, 8));
}

function patchGradleProperties() {
  if (!fs.existsSync(gradlePropertiesPath)) return false;

  const desired = new Map([
    ['org.gradle.daemon', 'true'],
    ['org.gradle.parallel', 'true'],
    ['org.gradle.caching', 'true'],
    ['org.gradle.jvmargs', '-Xmx4096m -Dfile.encoding=UTF-8 -XX:+UseParallelGC'],
    // Keep Rust and Gradle parallel, but disable Kotlin incremental/daemon execution
    // for the generated Android project. On Windows, Cargo registry sources often
    // live on C: while the repository lives on D:, and Kotlin incremental tries to
    // relativize plugin Kotlin sources across those different drive roots.
    ['kotlin.incremental', 'false'],
    ['kotlin.incremental.useClasspathSnapshot', 'false'],
    ['kotlin.compiler.execution.strategy', 'in-process'],
    ['android.javaCompile.suppressSourceTargetDeprecationWarning', 'true'],
  ]);

  const removeKeys = new Set(['org.gradle.workers.max', 'android.defaults.buildfeatures.buildconfig']);
  const lines = fs.readFileSync(gradlePropertiesPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const seen = new Set();
  const next = [];

  for (const line of lines) {
    const index = line.indexOf('=');
    if (index === -1) {
      next.push(line);
      continue;
    }

    const key = line.slice(0, index).trim();
    if (removeKeys.has(key)) continue;

    if (desired.has(key)) {
      seen.add(key);
      next.push(`${key}=${desired.get(key)}`);
      continue;
    }

    next.push(line);
  }

  for (const [key, value] of desired) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }

  if (!next.some((line) => line.startsWith('org.gradle.workers.max='))) {
    next.push(`org.gradle.workers.max=${cpuCount()}`);
  }

  fs.writeFileSync(gradlePropertiesPath, `${next.join('\n')}\n`);
  return true;
}

function setAndroidAttribute(tag, name, value) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}="[^"]*"`);
  if (regex.test(tag)) return tag.replace(regex, `${name}="${value}"`);
  return tag.replace(/<application\b/, `<application ${name}="${value}"`);
}

function patchManifest(config) {
  if (!fs.existsSync(manifestPath)) return false;
  let xml = fs.readFileSync(manifestPath, 'utf8');
  const original = xml;

  if (!xml.includes('android.permission.INTERNET')) {
    xml = xml.replace(/<manifest([^>]*)>/, '<manifest$1>\n    <uses-permission android:name="android.permission.INTERNET" />');
  }
  if (xml.includes('<application') && !xml.includes('android:usesCleartextTraffic=')) {
    xml = xml.replace(/<application\b/, '<application android:usesCleartextTraffic="true"');
  }
  if (xml.includes('<activity') && !xml.includes('android:windowSoftInputMode=')) {
    xml = xml.replace(/<activity\s/, '<activity android:windowSoftInputMode="adjustResize" ');
  }
  xml = xml.replace(/android:name="[^"]*MainActivity"/g, 'android:name=".MainActivity"');
  if (xml.includes('<application')) {
    xml = xml.replace(/<application\b[^>]*>/, (tag) => {
      let next = tag;
      next = setAndroidAttribute(next, 'android:icon', '@mipmap/ic_launcher');
      next = setAndroidAttribute(next, 'android:roundIcon', '@mipmap/ic_launcher_round');
      next = setAndroidAttribute(next, 'android:label', config.label);
      return next;
    });
  }

  fs.writeFileSync(manifestPath, xml);
  return xml !== original;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function copyFileEnsuringDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function patchAndroidIcons() {
  if (!fs.existsSync(androidIconSourceDir) || !fs.existsSync(androidResDir)) return false;

  let copied = 0;
  for (const source of walk(androidIconSourceDir)) {
    const relative = path.relative(androidIconSourceDir, source);
    if (relative.split(path.sep)[0] === 'values') continue;
    const target = path.join(androidResDir, relative);
    copyFileEnsuringDir(source, target);
    copied += 1;
  }

  return copied > 0;
}

function ensureLauncherBackgroundColor() {
  if (!fs.existsSync(androidResDir)) return false;

  const valuesDir = path.join(androidResDir, 'values');
  const colorsPath = path.join(valuesDir, 'colors.xml');
  fs.mkdirSync(valuesDir, { recursive: true });

  if (!fs.existsSync(colorsPath)) {
    fs.writeFileSync(colorsPath, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#07140B</color>\n</resources>\n');
    return true;
  }

  let xml = fs.readFileSync(colorsPath, 'utf8');
  const original = xml;
  if (xml.includes('name="ic_launcher_background"')) {
    xml = xml.replace(/<color\s+name="ic_launcher_background">[^<]*<\/color>/, '<color name="ic_launcher_background">#07140B</color>');
  } else if (xml.includes('</resources>')) {
    xml = xml.replace('</resources>', '    <color name="ic_launcher_background">#07140B</color>\n</resources>');
  } else {
    xml += '\n<resources>\n    <color name="ic_launcher_background">#07140B</color>\n</resources>\n';
  }
  fs.writeFileSync(colorsPath, xml);
  return xml !== original;
}


function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function upsertStringResource(xml, name, value) {
  const escaped = escapeXml(value);
  const regex = new RegExp(`<string\\s+name="${name}"[^>]*>[^<]*<\\/string>`, 'g');
  if (regex.test(xml)) {
    return xml.replace(regex, `<string name="${name}">${escaped}</string>`);
  }
  if (xml.includes('</resources>')) {
    return xml.replace('</resources>', `    <string name="${name}">${escaped}</string>\n</resources>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="${name}">${escaped}</string>\n</resources>\n`;
}

function patchAndroidLabelResources(config) {
  if (!fs.existsSync(androidResDir)) return false;

  const valuesDirs = fs.readdirSync(androidResDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('values'))
    .map((entry) => path.join(androidResDir, entry.name));
  const primaryValuesDir = path.join(androidResDir, 'values');
  if (!valuesDirs.includes(primaryValuesDir)) valuesDirs.unshift(primaryValuesDir);

  let changed = false;
  for (const valuesDir of valuesDirs) {
    fs.mkdirSync(valuesDir, { recursive: true });
    const stringsPath = path.join(valuesDir, 'strings.xml');
    const original = fs.existsSync(stringsPath)
      ? fs.readFileSync(stringsPath, 'utf8')
      : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';

    let xml = original;
    // Older generated Android projects may keep the launcher label in a string
    // resource even after the manifest/applicationId was patched. Replace every
    // previous Nutrino label variant, then make the common app-name keys explicit.
    xml = xml.replace(/>\s*Nutrino Dev\s*</g, `>${escapeXml(config.label)}<`);
    xml = xml.replace(/>\s*Nutrino\s*</g, `>${escapeXml(config.label)}<`);
    for (const name of ['app_name', 'app_label', 'tauri_app_name']) {
      xml = upsertStringResource(xml, name, config.label);
    }

    if (xml !== original) {
      fs.writeFileSync(stringsPath, xml);
      changed = true;
    }
  }

  return changed;
}


function findAndroidAppGradlePath() {
  return androidAppGradlePaths.find((candidate) => fs.existsSync(candidate));
}

function setGradleStringProperty(source, property, value, blockName = 'android') {
  const assignmentRegex = new RegExp(`${property}\\s*=\\s*"[^"]+"`, 'g');
  const groovyRegex = new RegExp(`${property}\\s+"[^"]+"`, 'g');
  let next = source
    .replace(assignmentRegex, `${property} = "${value}"`)
    .replace(groovyRegex, `${property} "${value}"`);

  const hasProperty = new RegExp(`${property}\\s*(=\\s*)?"`).test(next);
  if (!hasProperty) {
    next = next.replace(new RegExp(`${blockName}\\s*\\{`), `${blockName} {\n    ${property} = "${value}"`);
  }
  return next;
}

function ensureBuildConfigFeature(source) {
  const blockRegex = /buildFeatures\s*\{[\s\S]*?\n\s*\}/m;
  const blockMatch = source.match(blockRegex);

  if (blockMatch) {
    const block = blockMatch[0];
    let nextBlock;
    if (/buildConfig\s*=\s*(true|false)/.test(block)) {
      nextBlock = block.replace(/buildConfig\s*=\s*(true|false)/, 'buildConfig = true');
    } else if (/buildConfig\s+(true|false)/.test(block)) {
      nextBlock = block.replace(/buildConfig\s+(true|false)/, 'buildConfig true');
    } else {
      nextBlock = block.replace(/\{/, '{\n        buildConfig = true');
    }
    return source.replace(block, nextBlock);
  }

  const androidBlockRegex = /android\s*\{/;
  if (!androidBlockRegex.test(source)) return source;
  return source.replace(androidBlockRegex, 'android {\n    buildFeatures {\n        buildConfig = true\n    }');
}

function patchAndroidApplicationId(config) {
  const gradlePath = findAndroidAppGradlePath();
  if (!gradlePath) return false;

  let source = fs.readFileSync(gradlePath, 'utf8');
  const original = source;

  source = setGradleStringProperty(source, 'namespace', config.applicationId, 'android');
  source = setGradleStringProperty(source, 'applicationId', config.applicationId, 'defaultConfig');
  source = ensureBuildConfigFeature(source);

  fs.writeFileSync(gradlePath, source);
  return source !== original;
}

function patchReleaseSigningFallback() {
  const gradlePath = findAndroidAppGradlePath();
  if (!gradlePath) return false;

  const keystorePropertiesPath = path.join(androidDir, 'keystore.properties');
  const hasRealKeystore = fs.existsSync(keystorePropertiesPath);
  let source = fs.readFileSync(gradlePath, 'utf8');
  const original = source;

  const markerStart = '// BEGIN NUTRINO LOCAL RELEASE SIGNING FALLBACK';
  const markerEnd = '// END NUTRINO LOCAL RELEASE SIGNING FALLBACK';
  const markerRegex = new RegExp(`\\n?${markerStart}[\\s\\S]*?${markerEnd}\\n?`, 'g');
  source = source.replace(markerRegex, '\n');

  if (!hasRealKeystore) {
    const fallbackBlock = `
${markerStart}
// Local sideload safety: when no real release keystore is configured, sign
// release APKs with the Android debug signing config so the generated APK is
// still a valid Android package. Do not use this fallback for store releases.
android {
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
${markerEnd}
`;
    source = `${source.trimEnd()}\n${fallbackBlock}`;
  }

  fs.writeFileSync(gradlePath, source);
  return source !== original;
}


function hashFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath);
}

function currentNativeIdentityHash(config) {
  const hash = crypto.createHash('sha256');
  hash.update(`nativeStateVersion=${NATIVE_STATE_VERSION}\n`);
  hash.update(`applicationId=${config.applicationId}\n`);
  hash.update(`channel=${config.channel}\n`);
  hash.update(`label=${config.label}\n`);
  hash.update(`productName=${config.productName}\n`);
  for (const relative of ['src-tauri/Cargo.toml', 'src-tauri/build.rs', 'src-tauri/tauri.conf.json']) {
    hash.update(`file=${relative}\n`);
    hash.update(hashFileIfExists(path.join(projectRoot, relative)));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function removePathIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) return false;
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function cleanStaleAndroidNativeState(config) {
  if (!fs.existsSync(androidDir)) return false;

  const statePath = path.join(androidDir, '.nutrino-android-native-state.json');
  const nextState = {
    nativeStateVersion: NATIVE_STATE_VERSION,
    applicationId: config.applicationId,
    channel: config.channel,
    label: config.label,
    productName: config.productName,
    nativeIdentityHash: currentNativeIdentityHash(config),
  };

  let previous = null;
  if (fs.existsSync(statePath)) {
    try {
      previous = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      previous = null;
    }
  }

  const needsClean = forceNativeClean
    || !previous
    || previous.nativeStateVersion !== nextState.nativeStateVersion
    || previous.applicationId !== nextState.applicationId
    || previous.channel !== nextState.channel
    || previous.label !== nextState.label
    || previous.productName !== nextState.productName
    || previous.nativeIdentityHash !== nextState.nativeIdentityHash;

  if (!needsClean) return false;

  const tauriTargetDir = path.join(projectRoot, 'src-tauri', 'target');

  // JNI entrypoint symbols are generated from the active Android package. A
  // stale cross-compiled Rust target can still contain old Java_* exports even
  // when Gradle/Kotlin has already moved to the new package. Removing the whole
  // mobile target directory is slower on the next build, but it is safer than
  // leaving a dev APK that starts and immediately crashes with UnsatisfiedLinkError.
  removePathIfExists(tauriTargetDir);

  removePathIfExists(path.join(androidDir, 'app', 'src', 'main', 'jniLibs'));
  removePathIfExists(path.join(androidDir, 'app', 'build'));
  removePathIfExists(path.join(androidDir, 'build'));
  removePathIfExists(path.join(androidDir, '.gradle'));

  fs.writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
  return true;
}

function normalizeMainActivitySource(source, config) {
  const packageLine = `package ${config.applicationId}`;
  let next = source.trim();

  // Tauri's generated MainActivity should stay intentionally tiny. Older
  // Nutrino builds experimented with status-bar calls here; that broke Android
  // compilation on some generated projects, so keep this file as the clean
  // TauriActivity entrypoint and handle system bars in the web layer instead.
  if (
    !next ||
    next.includes('hideSystemBars()') ||
    next.includes('WindowInsetsController') ||
    next.includes('WindowCompat') ||
    next.includes('import app.tauri.TauriActivity')
  ) {
    return `${packageLine}\n\nimport app.tauri.TauriActivity\n\nclass MainActivity : TauriActivity()\n`;
  }

  if (/^package\s+[^\n]+/m.test(next)) {
    next = next.replace(/^package\s+[^\n]+/m, packageLine);
  } else {
    next = `${packageLine}\n\n${next}`;
  }

  return `${next.trimEnd()}\n`;
}

function removeEmptyDirectories(dir, stopAt) {
  let current = dir;
  const boundary = path.resolve(stopAt);

  while (path.resolve(current).startsWith(boundary) && path.resolve(current) !== boundary) {
    if (!fs.existsSync(current)) {
      current = path.dirname(current);
      continue;
    }

    const entries = fs.readdirSync(current);
    if (entries.length > 0) break;

    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function cleanGeneratedKotlinPackages() {
  const javaRoot = path.join(androidDir, 'app', 'src', 'main', 'java');
  if (!fs.existsSync(javaRoot)) return false;

  const generatedDirs = walk(javaRoot)
    .map((file) => path.dirname(file))
    .filter((dir, index, dirs) => path.basename(dir) === 'generated' && dirs.indexOf(dir) === index);

  let changed = false;
  for (const dir of generatedDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
    removeEmptyDirectories(path.dirname(dir), javaRoot);
    changed = true;
  }

  return changed;
}

function patchMainActivityPackage(config) {
  const javaRoot = path.join(androidDir, 'app', 'src', 'main', 'java');
  const packageDir = path.join(javaRoot, ...config.applicationId.split('.'));
  const targetPath = path.join(packageDir, 'MainActivity.kt');
  const files = walk(javaRoot).filter((file) => file.endsWith('MainActivity.kt'));
  const sourcePath = files.includes(targetPath) ? targetPath : files[0];
  const current = sourcePath && fs.existsSync(sourcePath)
    ? fs.readFileSync(sourcePath, 'utf8')
    : `package ${config.applicationId}\n\nimport app.tauri.TauriActivity\n\nclass MainActivity : TauriActivity()\n`;
  const next = normalizeMainActivitySource(current, config);

  let changed = false;
  fs.mkdirSync(packageDir, { recursive: true });

  if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== next) {
    fs.writeFileSync(targetPath, next);
    changed = true;
  }

  for (const activityPath of files) {
    if (activityPath === targetPath) continue;
    fs.rmSync(activityPath, { force: true });
    removeEmptyDirectories(path.dirname(activityPath), javaRoot);
    changed = true;
  }

  // Tauri CLI validates that this exact Java package directory exists before it
  // starts Gradle. Keep the directory in sync when switching between stable and
  // dev identifiers without forcing users to regenerate src-tauri/gen/android.
  return changed || !sourcePath;
}

const channel = parseChannel();
const config = channelConfig(channel);
const tauriConfigPatched = patchTauriConfig(projectRoot, config.channel).changed;

if (!fs.existsSync(androidDir)) {
  console.log(`Android channel configured before generation: channel=${config.channel}, identifier=${config.applicationId}, label="${config.label}"`);
  console.log('Android project not generated yet. Run pnpm android:init first.');
  process.exit(0);
}

const gradlePatched = patchGradleProperties();
const identityPatched = patchAndroidApplicationId(config);
const signingPatched = patchReleaseSigningFallback();
const iconsPatched = patchAndroidIcons();
const launcherColorPatched = ensureLauncherBackgroundColor();
const labelResourcesPatched = patchAndroidLabelResources(config);
const manifestPatched = patchManifest(config);
const nativeStateCleaned = cleanStaleAndroidNativeState(config);
const generatedKotlinCleaned = cleanGeneratedKotlinPackages();
const activityPackagePatched = patchMainActivityPackage(config);
console.log(`Android generated project patched: channel=${config.channel}, applicationId=${config.applicationId}, label="${config.label}", tauriConfig=${tauriConfigPatched ? 'yes' : 'already ok'}, gradle=${gradlePatched ? 'yes' : 'no'}, identity=${identityPatched ? 'yes' : 'no'}, signingFallback=${signingPatched ? 'yes' : 'no'}, icons=${iconsPatched ? 'yes' : 'no'}, launcherColor=${launcherColorPatched ? 'yes' : 'no'}, labelResources=${labelResourcesPatched ? 'yes' : 'no'}, manifest=${manifestPatched ? 'yes' : 'no'}, nativeState=${nativeStateCleaned ? 'cleaned' : 'already ok'}, generatedKotlin=${generatedKotlinCleaned ? 'cleaned' : 'already clean'}, mainActivityPackage=${activityPackagePatched ? 'yes' : 'already ok'}`);
