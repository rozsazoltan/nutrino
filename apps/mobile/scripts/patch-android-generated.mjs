#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { channelConfig, parseChannel, patchTauriConfig } from './android-channel.mjs';
import { mobileCargoTargetDir } from './android-artifacts.mjs';

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
const NATIVE_STATE_VERSION = 9;
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
  if (!xml.includes('android.permission.CAMERA')) {
    xml = xml.replace(/<manifest([^>]*)>/, '<manifest$1>\n    <uses-permission android:name="android.permission.CAMERA" />');
  }
  if (!xml.includes('android.permission.POST_NOTIFICATIONS')) {
    xml = xml.replace(/<manifest([^>]*)>/, '<manifest$1>\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
  }
  if (xml.includes('<activity') && !xml.includes('android:windowSoftInputMode=')) {
    xml = xml.replace(/<activity\s/, '<activity android:windowSoftInputMode="adjustResize" ');
  }
  xml = xml.replace(/android:name="[^"]*MainActivity"/g, 'android:name=".MainActivity"');
  if (xml.includes('<application')) {
    xml = xml.replace(/<application\b[^>]*>/, (tag) => {
      let next = tag;
      next = setAndroidAttribute(next, 'android:usesCleartextTraffic', 'true');
      next = setAndroidAttribute(next, 'android:networkSecurityConfig', '@xml/nutrino_network_security_config');
      next = setAndroidAttribute(next, 'android:icon', '@mipmap/ic_launcher');
      next = setAndroidAttribute(next, 'android:roundIcon', '@mipmap/ic_launcher_round');
      next = setAndroidAttribute(next, 'android:label', config.label);
      next = setAndroidAttribute(next, 'android:enableOnBackInvokedCallback', 'true');
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


function ensureNetworkSecurityConfig() {
  if (!fs.existsSync(androidResDir)) return false;
  const xmlDir = path.join(androidResDir, 'xml');
  const configPath = path.join(xmlDir, 'nutrino_network_security_config.xml');
  const content = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;
  fs.mkdirSync(xmlDir, { recursive: true });
  const previous = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  if (previous === content) return false;
  fs.writeFileSync(configPath, content);
  return true;
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

function removePathIfExists(targetPath, options = {}) {
  const { optional = false } = options;
  if (!fs.existsSync(targetPath)) return false;

  try {
    fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    return true;
  } catch (error) {
    const code = error?.code ? String(error.code) : '';
    const isLockedPath = code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY';
    if (optional && isLockedPath) {
      console.warn(`Warning: could not remove optional Android cache path: ${targetPath}`);
      console.warn('Close running Gradle/Java processes if Android dev keeps using stale generated state.');
      return false;
    }
    throw error;
  }
}

function cleanStaleAndroidNativeState(config) {
  if (!fs.existsSync(androidDir)) return false;

  const statePath = path.join(androidDir, '.nutrino-android-native-state.json');
  const nextState = {
    nativeStateVersion: NATIVE_STATE_VERSION,
    applicationId: config.applicationId,
    channel: config.channel,
  };

  let previous = null;
  if (fs.existsSync(statePath)) {
    try {
      previous = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      previous = null;
    }
  }

  const packageChanged = Boolean(previous)
    && (previous.applicationId !== nextState.applicationId || previous.channel !== nextState.channel);
  const needsClean = forceNativeClean
    || !previous
    || previous.nativeStateVersion !== nextState.nativeStateVersion
    || packageChanged;

  if (!needsClean) return false;

  // Keep Cargo's Rust target cache during normal app-version updates. Cargo can
  // incrementally rebuild when Rust sources or dependencies change, and deleting
  // src-tauri/target is what made every copied update recompile the whole Rust
  // dependency graph. Only force-remove it when explicitly requested or when the
  // Android package/channel really changes and JNI symbols may be stale.
  if (forceNativeClean || packageChanged) {
    removePathIfExists(path.join(projectRoot, 'src-tauri', 'target'));
    removePathIfExists(mobileCargoTargetDir(projectRoot));
  }

  removePathIfExists(path.join(androidDir, 'app', 'src', 'main', 'jniLibs'));
  removePathIfExists(path.join(androidDir, 'app', 'build'));
  removePathIfExists(path.join(androidDir, 'build'));
  removePathIfExists(path.join(androidDir, '.gradle'), { optional: true });

  fs.writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
  return true;
}

function mobileMainActivitySource(config) {
  const packageLine = `package ${config.applicationId}`;
  return `${packageLine}

import android.content.res.Configuration
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import org.json.JSONObject
// Tauri generates TauriActivity into the same application package at build time.
// Do not import a global TauriActivity here: with Tauri 2.11 generated Android
// projects that symbol is not exported from that package and Gradle fails with
// "Unresolved reference: TauriActivity".
class MainActivity : TauriActivity() {
    private var nutrinoBackCallback: OnBackInvokedCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureEdgeToEdgeWindow()
        dispatchNutrinoNotificationActionToWebView(intent)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val callback = OnBackInvokedCallback {
                dispatchNutrinoBackToWebView()
            }
            nutrinoBackCallback = callback
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                callback
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        dispatchNutrinoNotificationActionToWebView(intent)
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            nutrinoBackCallback?.let {
                onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it)
            }
            nutrinoBackCallback = null
        }
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
            dispatchNutrinoBackToWebView()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    @Deprecated("Deprecated in Android API 33; Android 13+ uses OnBackInvokedCallback above.")
    override fun onBackPressed() {
        dispatchNutrinoBackToWebView()
    }


    private fun configureEdgeToEdgeWindow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.statusBarColor = Color.TRANSPARENT
            window.navigationBarColor = Color.TRANSPARENT
        }

        val isNightMode = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        var flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION

        if (!isNightMode && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags = flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }
        if (!isNightMode && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags = flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }

        window.decorView.systemUiVisibility = flags
    }

    private fun dispatchNutrinoBackToWebView() {
        findWebView(window?.decorView)?.post {
            findWebView(window?.decorView)?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('nutrino:android-back'))",
                null
            )
        }
    }

    private fun dispatchNutrinoNotificationActionToWebView(intent: Intent?) {
        val payload = buildNutrinoNotificationActionPayload(intent) ?: return
        val payloadString = JSONObject.quote(payload.toString())
        fun dispatch(attempt: Int) {
            val webView = findWebView(window?.decorView)
            if (webView == null) {
                if (attempt < 16) {
                    window?.decorView?.postDelayed({ dispatch(attempt + 1) }, 120)
                }
                return
            }
            webView.post {
                webView.evaluateJavascript(
                    "window.__NUTRINO_PENDING_NOTIFICATION_ACTION__ = JSON.parse($payloadString); window.dispatchEvent(new CustomEvent('nutrino:notification-action', { detail: window.__NUTRINO_PENDING_NOTIFICATION_ACTION__ }))",
                    null
                )
            }
        }
        dispatch(0)
    }

    private fun buildNutrinoNotificationActionPayload(intent: Intent?): JSONObject? {
        if (intent == null) return null
        val notificationId = intent.getIntExtra("NotificationId", Int.MIN_VALUE)
        if (notificationId == Int.MIN_VALUE) return null
        val payload = JSONObject()
        payload.put("notificationId", notificationId)
        payload.put("actionId", intent.getStringExtra("NotificationUserAction") ?: "tap")
        val notificationJson = intent.getStringExtra("LocalNotficationObject")
        if (!notificationJson.isNullOrBlank()) {
            try {
                payload.put("notification", JSONObject(notificationJson))
            } catch (_: Exception) {
            }
        }
        return payload
    }

    private fun findWebView(view: View?): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                val found = findWebView(view.getChildAt(index))
                if (found != null) return found
            }
        }
        return null
    }
}
`;
}

function normalizeMainActivitySource(source, config) {
  // Android hardware Back must not fall through to the default Activity behavior,
  // because on Android 13/14 that can move the Tauri WebView task to the background
  // before the Vue app can show its “press Back again” toast. Keep MainActivity as
  // a small native bridge that turns every Android Back request into a JS event.
  return mobileMainActivitySource(config);
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
    : `package ${config.applicationId}\n\nclass MainActivity : TauriActivity()\n`;
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


function parseRustPluginImplementationClass(source) {
  if (!/class\s+RustPlugin\b/.test(source)) return null;
  const packageMatch = source.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*$/m);
  return packageMatch ? `${packageMatch[1]}.RustPlugin` : 'RustPlugin';
}

function findRustPluginSourceFiles(buildSrcDir) {
  return walk(buildSrcDir).filter((file) => /(^|[\\/])RustPlugin\.(kt|java)$/.test(file));
}

function implementationClassForRustPlugin(buildSrcDir) {
  const pluginFiles = findRustPluginSourceFiles(buildSrcDir);
  for (const file of pluginFiles) {
    const implementationClass = parseRustPluginImplementationClass(fs.readFileSync(file, 'utf8'));
    if (implementationClass) return implementationClass;
  }
  return null;
}

function patchBuildSrcResourceDuplicateStrategy(buildSrcDir) {
  const candidates = [
    path.join(buildSrcDir, 'build.gradle.kts'),
    path.join(buildSrcDir, 'build.gradle'),
  ];
  const gradlePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!gradlePath) return false;

  const markerStart = '// BEGIN NUTRINO BUILDSRC RESOURCE DUPLICATE GUARD';
  const markerEnd = '// END NUTRINO BUILDSRC RESOURCE DUPLICATE GUARD';
  const source = fs.readFileSync(gradlePath, 'utf8');
  if (source.includes(markerStart)) return false;

  const guard = gradlePath.endsWith('.kts')
    ? `${markerStart}\ntasks.withType<org.gradle.language.jvm.tasks.ProcessResources>().configureEach {\n    duplicatesStrategy = org.gradle.api.file.DuplicatesStrategy.EXCLUDE\n}\n${markerEnd}`
    : `${markerStart}\ntasks.withType(org.gradle.language.jvm.tasks.ProcessResources).configureEach {\n    duplicatesStrategy = org.gradle.api.file.DuplicatesStrategy.EXCLUDE\n}\n${markerEnd}`;

  fs.writeFileSync(gradlePath, `${source.trimEnd()}\n\n${guard}\n`);
  return true;
}

function normalizeBuildSrcRustPluginResources() {
  const buildSrcDir = path.join(androidDir, 'buildSrc');
  if (!fs.existsSync(buildSrcDir)) return false;

  const descriptorSuffix = ['META-INF', 'gradle-plugins', 'rust.properties'].join(path.sep);
  const descriptorPaths = walk(buildSrcDir).filter((file) => file.endsWith(descriptorSuffix));
  const implementationClass = implementationClassForRustPlugin(buildSrcDir);
  const currentDescriptor = descriptorPaths
    .map((file) => fs.readFileSync(file, 'utf8'))
    .find((content) => /implementation-class\s*=/.test(content));
  const descriptorContent = implementationClass
    ? `implementation-class=${implementationClass}\n`
    : currentDescriptor;

  let changed = patchBuildSrcResourceDuplicateStrategy(buildSrcDir);

  if (descriptorContent) {
    const canonicalPath = path.join(buildSrcDir, 'src', 'main', 'resources', 'META-INF', 'gradle-plugins', 'rust.properties');
    fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
    if (!fs.existsSync(canonicalPath) || fs.readFileSync(canonicalPath, 'utf8') !== descriptorContent) {
      fs.writeFileSync(canonicalPath, descriptorContent);
      changed = true;
    }

    for (const descriptorPath of descriptorPaths) {
      if (path.resolve(descriptorPath) === path.resolve(canonicalPath)) continue;
      fs.rmSync(descriptorPath, { force: true });
      removeEmptyDirectories(path.dirname(descriptorPath), buildSrcDir);
      changed = true;
    }
  }

  if (changed) {
    removePathIfExists(path.join(buildSrcDir, 'build'));
    removePathIfExists(path.join(buildSrcDir, '.gradle'), { optional: true });
    removePathIfExists(path.join(androidDir, '.gradle'), { optional: true });
  }

  return changed;
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
const networkSecurityPatched = ensureNetworkSecurityConfig();
const labelResourcesPatched = patchAndroidLabelResources(config);
const manifestPatched = patchManifest(config);
const buildSrcRustPluginPatched = normalizeBuildSrcRustPluginResources();
const nativeStateCleaned = cleanStaleAndroidNativeState(config);
const generatedKotlinCleaned = cleanGeneratedKotlinPackages();
const activityPackagePatched = patchMainActivityPackage(config);
console.log(`Android generated project patched: channel=${config.channel}, applicationId=${config.applicationId}, label="${config.label}", tauriConfig=${tauriConfigPatched ? 'yes' : 'already ok'}, gradle=${gradlePatched ? 'yes' : 'no'}, identity=${identityPatched ? 'yes' : 'no'}, signingFallback=${signingPatched ? 'yes' : 'no'}, icons=${iconsPatched ? 'yes' : 'no'}, launcherColor=${launcherColorPatched ? 'yes' : 'no'}, networkSecurity=${networkSecurityPatched ? 'yes' : 'already ok'}, labelResources=${labelResourcesPatched ? 'yes' : 'no'}, manifest=${manifestPatched ? 'yes' : 'no'}, buildSrcRustPlugin=${buildSrcRustPluginPatched ? 'normalized' : 'already ok'}, nativeState=${nativeStateCleaned ? 'cleaned' : 'already ok'}, generatedKotlin=${generatedKotlinCleaned ? 'cleaned' : 'already clean'}, mainActivityPackage=${activityPackagePatched ? 'yes' : 'already ok'}`);
