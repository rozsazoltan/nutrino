import fs from 'node:fs';
import path from 'node:path';

export function repoRootFromProject(projectRoot) {
  return path.resolve(projectRoot, '..', '..');
}

export function tauriCacheRoot(projectRoot) {
  return path.resolve(process.env.NUTRINO_BUILD_CACHE_DIR || path.join(repoRootFromProject(projectRoot), '.cache', 'tauri'));
}

export function mobileCargoTargetDir(projectRoot) {
  return path.join(tauriCacheRoot(projectRoot), 'cargo-target', 'mobile');
}

export function mobileGradleUserHome(projectRoot) {
  return path.join(tauriCacheRoot(projectRoot), 'gradle');
}

export function androidDistDir(projectRoot, channel = 'stable') {
  return path.join(projectRoot, 'dist', 'android', channel);
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

export function packageVersion(projectRoot) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return String(data.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export function androidPackageFiles(androidDir) {
  const outputsDir = path.join(androidDir, 'app', 'build', 'outputs');
  return walkFiles(outputsDir).filter((file) => /\.(apk|aab)$/i.test(file));
}

export function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function dirSize(targetPath) {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    total += dirSize(path.join(targetPath, entry.name));
  }
  return total;
}

function safeCopyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

export function archiveAndroidPackageOutputs({ projectRoot, androidDir, channel = 'stable' }) {
  const files = androidPackageFiles(androidDir);
  if (files.length === 0) return [];

  const version = packageVersion(projectRoot);
  const targetDir = androidDistDir(projectRoot, channel);
  const copied = [];
  for (const file of files) {
    const relative = path.relative(path.join(androidDir, 'app', 'build', 'outputs'), file)
      .replace(/[\\/]+/g, '-')
      .replace(/^-+/, '');
    const target = path.join(targetDir, `nutrino-mobile-${channel}-v${version}-${relative}`);
    safeCopyFile(file, target);
    copied.push({ from: file, to: target, size: fileSize(target) });
  }
  return copied;
}

export function pruneAndroidPackageOutputs(androidDir) {
  // Keep Java/Kotlin/Gradle compilation caches, but remove final package outputs
  // and duplicated packaged native libraries. These are regenerated on demand and
  // are the usual source of repeated 100+ MB APK/AAB leftovers in gen/android.
  const targets = [
    path.join(androidDir, 'app', 'build', 'outputs'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'apk'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'apk_ide_redirect_file'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'bundle'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'merged_native_libs'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'stripped_native_libs'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'incremental', 'packageArm64Debug'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'incremental', 'packageArm64Release'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'incremental', 'packageDebug'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'incremental', 'packageRelease'),
  ];

  const removed = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    const size = dirSize(target);
    fs.rmSync(target, { recursive: true, force: true });
    removed.push({ path: target, size });
  }
  return removed;
}
