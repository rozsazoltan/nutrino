import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkNutrinoUpdates, compareVersionStrings, normalizeReleaseVersion } from './releases';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('release update helpers', () => {
  it('compares semantic versions with optional v prefixes', () => {
    expect(compareVersionStrings('v1.2.10', '1.2.9')).toBe(1);
    expect(compareVersionStrings('1.2', '1.2.0')).toBe(0);
    expect(compareVersionStrings('1.2.0-beta.2', '1.2.0-beta.10')).toBe(-1);
    expect(normalizeReleaseVersion(' v2.0.1 ')).toBe('2.0.1');
  });

  it('returns latest when no newer non-draft release is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          { tag_name: 'v1.0.0', draft: false, prerelease: false, assets: [] },
          { tag_name: 'v9.0.0', draft: true, prerelease: false, assets: [] },
        ],
      })),
    );

    const result = await checkNutrinoUpdates('1.0.0', { target: 'android' });

    expect(result.status).toBe('latest');
    expect(result.release).toBeUndefined();
  });

  it('selects the newest stable Android APK by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            tag_name: 'v1.2.0-beta.1',
            name: 'Nutrino v1.2.0 beta',
            html_url: 'https://example.test/beta',
            draft: false,
            prerelease: true,
            published_at: '2026-06-09T00:00:00Z',
            assets: [{ name: 'nutrino.apk', browser_download_url: 'https://example.test/beta.apk' }],
          },
          {
            tag_name: 'v1.1.0',
            name: 'Nutrino v1.1.0',
            html_url: 'https://example.test/stable',
            draft: false,
            prerelease: false,
            published_at: '2026-06-08T00:00:00Z',
            assets: [
              { name: 'nutrino.AppImage', browser_download_url: 'https://example.test/nutrino.AppImage' },
              { name: 'nutrino.apk', browser_download_url: 'https://example.test/nutrino.apk' },
            ],
          },
        ],
      })),
    );

    const result = await checkNutrinoUpdates('1.0.0', { target: 'android' });

    expect(result.status).toBe('available');
    expect(result.release?.version).toBe('1.1.0');
    expect(result.release?.assetName).toBe('nutrino.apk');
    expect(result.release?.downloadUrl).toBe('https://example.test/nutrino.apk');
  });

  it('can include prereleases when the user enabled prerelease checks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            tag_name: 'v1.2.0-beta.1',
            draft: false,
            prerelease: true,
            assets: [{ name: 'nutrino.apk', browser_download_url: 'https://example.test/beta.apk' }],
          },
          {
            tag_name: 'v1.1.0',
            draft: false,
            prerelease: false,
            assets: [{ name: 'nutrino.apk', browser_download_url: 'https://example.test/stable.apk' }],
          },
        ],
      })),
    );

    const result = await checkNutrinoUpdates('1.0.0', { includePrereleases: true, target: 'mobile' });

    expect(result.includePrereleases).toBe(true);
    expect(result.release?.version).toBe('1.2.0-beta.1');
    expect(result.release?.prerelease).toBe(true);
  });

  it('surfaces GitHub release API failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    );

    await expect(checkNutrinoUpdates('1.0.0', { target: 'desktop' })).rejects.toThrow('GitHub releases HTTP 500');
  });
});
