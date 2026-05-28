export type ReleaseTarget = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'desktop' | 'mobile';

export interface UpdateRelease {
  version: string;
  tag: string;
  name: string;
  url: string;
  prerelease: boolean;
  publishedAt: string;
  assetName?: string;
  downloadUrl: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  includePrereleases: boolean;
  checkedAt: number;
  status: 'available' | 'latest';
  release?: UpdateRelease;
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string | null;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: GitHubReleaseAsset[];
}

const releasesUrl = 'https://api.github.com/repos/rozsazoltan/nutrino/releases';

export function compareVersionStrings(left: string, right: string): number {
  const a = String(left || '').replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const b = String(right || '').replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const av = Number.isFinite(a[index]) ? a[index] : 0;
    const bv = Number.isFinite(b[index]) ? b[index] : 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

export function normalizeReleaseVersion(tagOrVersion: string): string {
  return String(tagOrVersion || '').trim().replace(/^v/i, '');
}

function preferredAsset(release: GitHubRelease, target: ReleaseTarget): GitHubReleaseAsset | undefined {
  const assets = release.assets || [];
  const byName = (patterns: RegExp[]) => assets.find((asset) => patterns.some((pattern) => pattern.test(asset.name || '')));
  if (target === 'android') return byName([/\.apk$/i]);
  if (target === 'ios') return byName([/\.ipa$/i, /ios/i]);
  if (target === 'windows') return byName([/\.msi$/i, /\.exe$/i, /windows/i]);
  if (target === 'macos') return byName([/\.dmg$/i, /\.app\.tar\.gz$/i, /darwin|macos|mac/i]);
  if (target === 'linux') return byName([/\.appimage$/i, /\.deb$/i, /\.rpm$/i, /linux/i]);
  if (target === 'mobile') return byName([/\.apk$/i, /\.ipa$/i]);
  return byName([/\.msi$/i, /\.exe$/i, /\.dmg$/i, /\.appimage$/i, /\.deb$/i, /\.rpm$/i]);
}

function toUpdateRelease(release: GitHubRelease, target: ReleaseTarget): UpdateRelease | null {
  const tag = String(release.tag_name || '').trim();
  if (!tag) return null;
  const asset = preferredAsset(release, target);
  const url = String(release.html_url || `https://github.com/rozsazoltan/nutrino/releases/tag/${encodeURIComponent(tag)}`);
  return {
    version: normalizeReleaseVersion(tag),
    tag,
    name: String(release.name || tag),
    url,
    prerelease: release.prerelease === true,
    publishedAt: String(release.published_at || ''),
    assetName: asset?.name,
    downloadUrl: asset?.browser_download_url || url,
  };
}

export async function checkNutrinoUpdates(currentVersion: string, options: { includePrereleases?: boolean; target: ReleaseTarget }): Promise<UpdateCheckResult> {
  const response = await fetch(releasesUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub releases HTTP ${response.status}`);
  const releases = await response.json() as GitHubRelease[];
  const candidates = releases
    .filter((release) => !release.draft)
    .filter((release) => options.includePrereleases || !release.prerelease)
    .map((release) => toUpdateRelease(release, options.target))
    .filter((release): release is UpdateRelease => Boolean(release))
    .sort((a, b) => compareVersionStrings(b.version, a.version));

  const release = candidates.find((candidate) => compareVersionStrings(candidate.version, currentVersion) > 0);
  return {
    currentVersion,
    includePrereleases: options.includePrereleases === true,
    checkedAt: Date.now(),
    status: release ? 'available' : 'latest',
    release,
  };
}
