import { invoke } from '@tauri-apps/api/core';
import type { AppState, Food, Ingredient, Recipe, RecipeItem, ActivityDefinition, GitHubCsvSource, ServerHealth, SyncPullResponse, SyncPushRequest, SyncPushResponse, SyncResult } from '../types';
import { canonicalizeStateReferences, mergeAliases, mergeById, normalizeFood, normalizeIngredient, resolveCatalogId } from './storage';

export const APP_VERSION = '0.11.9';
const APP_CHANNEL = import.meta.env.DEV ? 'dev' : String(import.meta.env.VITE_NUTRINO_CHANNEL || 'stable');
const DEVICE_ID_STORAGE_KEY = `nutrino.mobile.${APP_CHANNEL}.device_id.v1`;

type MobileDeviceInfo = {
  device_name?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  model?: string | null;
  device?: string | null;
  platform?: string | null;
  os_version?: string | null;
};

let mobileDeviceInfoPromise: Promise<MobileDeviceInfo> | null = null;

function getOrCreateDeviceId(): string {
  try {
    const current = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (current) return current;
    const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return `mobile-${APP_CHANNEL}`;
  }
}

function normalizeHeaderValue(value: unknown): string {
  return String(value ?? '').trim();
}

function parseAndroidModelFromUserAgent(): string {
  if (typeof navigator === 'undefined') return '';
  const match = navigator.userAgent.match(/Android\s+[^;]+;\s*([^;)]*?)(?:\s+Build\/|;|\))/i);
  return normalizeHeaderValue(match?.[1]);
}

function parseOsVersionFromUserAgent(userAgent: string): string | null {
  const android = userAgent.match(/Android\s+([0-9][0-9._]*)/i)?.[1];
  if (android) return android.replace(/_/g, '.');
  const ios = userAgent.match(/(?:CPU(?: iPhone)? OS|iPhone OS|iPad; CPU OS)\s+([0-9_]+)/i)?.[1];
  if (ios) return ios.replace(/_/g, '.');
  return null;
}

function mergeDeviceInfo(fallback: MobileDeviceInfo, nativeInfo: MobileDeviceInfo): MobileDeviceInfo {
  return {
    ...fallback,
    ...nativeInfo,
    os_version: normalizeHeaderValue(nativeInfo.os_version) || fallback.os_version || null,
    platform: normalizeHeaderValue(nativeInfo.platform) || fallback.platform,
  };
}

function fallbackMobileDeviceInfo(): MobileDeviceInfo {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isAndroid = /Android/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || /Macintosh/i.test(userAgent) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  return {
    device_name: parseAndroidModelFromUserAgent() || 'Mobile device',
    model: parseAndroidModelFromUserAgent() || null,
    platform: isAndroid ? 'Android' : isIOS ? 'iOS' : (typeof navigator !== 'undefined' ? navigator.platform || 'Mobile' : 'Mobile'),
    os_version: parseOsVersionFromUserAgent(userAgent),
  };
}

async function getMobileDeviceInfo(): Promise<MobileDeviceInfo> {
  if (!mobileDeviceInfoPromise) {
    mobileDeviceInfoPromise = invoke<MobileDeviceInfo>('get_mobile_device_info')
      .then((info) => mergeDeviceInfo(fallbackMobileDeviceInfo(), info))
      .catch(() => fallbackMobileDeviceInfo());
  }
  return mobileDeviceInfoPromise;
}

function friendlyDeviceName(info: MobileDeviceInfo): string {
  const specific = normalizeHeaderValue(info.device_name);
  if (specific && !['android', 'linux', 'mobile', 'unknown'].includes(specific.toLowerCase())) return specific;
  const manufacturer = normalizeHeaderValue(info.manufacturer || info.brand);
  const model = normalizeHeaderValue(info.model) || parseAndroidModelFromUserAgent();
  if (manufacturer && model && !model.toLowerCase().startsWith(manufacturer.toLowerCase())) return `${manufacturer} ${model}`;
  return model || manufacturer || 'Mobile device';
}

async function nutrinoDeviceHeaders(): Promise<Record<string, string>> {
  const info = await getMobileDeviceInfo();
  const headers: Record<string, string> = {
    'X-Nutrino-Device-Id': getOrCreateDeviceId(),
    'X-Nutrino-Device-Name': friendlyDeviceName(info),
    'X-Nutrino-Device-Platform': normalizeHeaderValue(info.platform) || 'Mobile',
    'X-Nutrino-App-Channel': APP_CHANNEL,
    'X-Nutrino-App-Version': APP_VERSION,
  };
  const manufacturer = normalizeHeaderValue(info.manufacturer || info.brand);
  const model = normalizeHeaderValue(info.model) || parseAndroidModelFromUserAgent();
  const device = normalizeHeaderValue(info.device);
  const osVersion = normalizeHeaderValue(info.os_version);
  if (manufacturer) headers['X-Nutrino-Device-Manufacturer'] = manufacturer;
  if (model) headers['X-Nutrino-Device-Model'] = model;
  if (device) headers['X-Nutrino-Android-Device'] = device;
  if (osVersion) headers['X-Nutrino-OS-Version'] = osVersion;
  return headers;
}


export function normalizeApiBaseUrl(baseUrl: string): string {
  let base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';

  // Users often type LAN endpoints as "192.168.1.202:8090". Browser fetch
  // treats that as an invalid relative URL inside the Android WebView, while the
  // dev build used to work because it generated a full http:// URL automatically.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    base = `http://${base}`;
  }

  if (base && !/\/api\/v1$/i.test(base)) base = `${base}/api/v1`;
  return base;
}

function apiUrl(baseUrl: string, path: string): string {
  const base = normalizeApiBaseUrl(baseUrl);
  return `${base}${path}`;
}

function authSecret(tokenOrPassword: string): string {
  return String(tokenOrPassword || '').trim();
}

async function requestJson<T>(baseUrl: string, tokenOrPassword: string, path: string, init: RequestInit = {}): Promise<T> {
  const secret = authSecret(tokenOrPassword);
  const deviceHeaders = await nutrinoDeviceHeaders();
  const response = await fetch(apiUrl(baseUrl, path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...deviceHeaders,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return await response.json() as T;
}

export async function checkServerHealth(baseUrl: string, tokenOrPassword: string): Promise<ServerHealth> {
  if (!baseUrl.trim()) throw new Error('Missing API base URL.');
  return await requestJson<ServerHealth>(baseUrl, tokenOrPassword, '/health');
}

export async function pingServer(baseUrl: string, tokenOrPassword: string): Promise<string> {
  const result = await checkServerHealth(baseUrl, tokenOrPassword);
  const auth = result.auth_required ? 'password required' : 'no password';
  const channel = result.app_channel ?? (result.dev_mode ? 'dev' : 'stable');
  return result.name ? `${result.name}${result.version ? ` ${result.version}` : ''} · ${channel} · ${auth}` : 'Server is reachable.';
}

function stripRecipeRef(id: string): string {
  return String(id || '').replace(/^recipe:/, '');
}

function pendingCatalogPayload(state: AppState): Pick<SyncPushRequest, 'ingredients' | 'foods' | 'recipes' | 'recipe_items' | 'activities'> {
  const sourceId = state.pairing.sourceId;
  const ingredientIds = new Set<string>();
  const foodIds = new Set<string>();
  const recipeIds = new Set<string>();

  // Diary entries and activity logs are intentionally mobile-private. They no longer
  // pull extra catalog records into the desktop upload payload just because they
  // were used in a local diary entry. Local catalog items still sync through their
  // own pending/source flags below.
  for (const item of state.recipeItems) {
    if (item.pending_sync || recipeIds.has(stripRecipeRef(item.recipe_id))) {
      recipeIds.add(stripRecipeRef(item.recipe_id));
      if (item.food_id.startsWith('ingredient:')) ingredientIds.add(resolveCatalogId(state, 'ingredient', item.food_id));
      else if (!item.food_id.startsWith('recipe:')) foodIds.add(resolveCatalogId(state, 'food', item.food_id));
    }
  }

  return {
    ingredients: state.ingredients.filter((item) => item.pending_sync || item.source_id === sourceId || ingredientIds.has(item.id)),
    foods: state.foods.filter((item) => item.pending_sync || item.source_id === sourceId || foodIds.has(item.id)),
    recipes: state.recipes.filter((item) => item.pending_sync || item.source_id === sourceId || recipeIds.has(item.id)),
    recipe_items: state.recipeItems.filter((item) => item.pending_sync || recipeIds.has(stripRecipeRef(item.recipe_id))),
    activities: state.activities.filter((item) => item.pending_sync || item.source_id === sourceId),
  };
}

function pendingPushPayload(state: AppState, deviceInfo: MobileDeviceInfo): SyncPushRequest {
  return {
    source_id: state.pairing.sourceId,
    device_name: friendlyDeviceName(deviceInfo),
    sent_at: Date.now(),
    ...pendingCatalogPayload(state),
    // Mobile diary entries are local-only privacy data. The desktop server is a
    // catalog source and optional staging inbox, not the canonical diary store.
    intakes: [],
    // Weight logs are private mobile diary/profile data and are not uploaded to desktop.
    weight_logs: [],
    // Activity diary logs are local-only for the same reason as meal entries.
    activity_logs: [],
  };
}

function payloadHasAnything(payload: SyncPushRequest): boolean {
  return Boolean(
    payload.ingredients?.length ||
    payload.foods?.length ||
    payload.recipes?.length ||
    payload.recipe_items?.length ||
    payload.activities?.length
  );
}

function mergePulledCatalog(state: AppState, pulled: SyncPullResponse, serverTime: number): AppState {
  const catalogRevision = Math.max(
    state.pairing.catalogRevision || 0,
    ...((pulled.ingredients ?? []).map((item) => item.updated_at || 0)),
    ...((pulled.foods ?? []).map((item) => item.updated_at || 0)),
    ...((pulled.recipes ?? []).map((item) => item.updated_at || 0)),
    ...((pulled.recipe_items ?? []).map((item) => item.updated_at || 0)),
    ...((pulled.activities ?? []).map((item) => item.updated_at || 0)),
  );

  const aliases = mergeAliases(state.catalogAliases, pulled.aliases ?? []);
  const keepPending = <T extends { id: string; pending_sync?: boolean }>(current: T[], merged: T[]) => {
    const pending = new Map(current.map((item) => [item.id, Boolean(item.pending_sync)]));
    return merged.map((item) => ({ ...item, pending_sync: pending.get(item.id) ?? Boolean(item.pending_sync) }));
  };

  const nextState: AppState = {
    ...state,
    pairing: {
      ...state.pairing,
      sourceId: pulled.source_id || state.pairing.sourceId,
      lastSyncAt: serverTime,
      catalogRevision,
      lastHealthCheckAt: Date.now(),
      lastSyncError: undefined,
    },
    catalogAliases: aliases,
    ingredients: keepPending(state.ingredients, mergeById(state.ingredients, (pulled.ingredients ?? []).map(normalizeIngredient))),
    foods: keepPending(state.foods, mergeById(state.foods, (pulled.foods ?? []).map(normalizeFood))),
    recipes: keepPending(state.recipes, mergeById(state.recipes, (pulled.recipes ?? []).map((recipe) => ({ ...recipe, extra_kcal: recipe.extra_kcal ?? 0, total_weight_g: null })))),
    recipeItems: keepPending(state.recipeItems, mergeById(state.recipeItems, pulled.recipe_items ?? [])),
    activities: keepPending(state.activities, mergeById(state.activities, pulled.activities ?? [])),
  };

  return canonicalizeStateReferences(nextState);
}

export async function pullFromServer(state: AppState): Promise<{ state: AppState; result: SyncResult }> {
  const { baseUrl, lastSyncAt } = state.pairing;
  const password = state.pairing.password ?? state.pairing.token ?? '';
  if (!baseUrl.trim()) throw new Error('Missing API base URL.');

  const catalogCacheIsEmpty = !state.ingredients.length && !state.foods.length && !state.recipes.length && !state.recipeItems.length && !state.activities.length;
  const since = catalogCacheIsEmpty ? 0 : Number(lastSyncAt || 0);
  const pulled = await requestJson<SyncPullResponse>(baseUrl, password, `/sync/pull?since=${encodeURIComponent(String(since))}`);
  const serverTime = pulled.server_time || Date.now();
  const nextState = mergePulledCatalog(state, pulled, serverTime);

  return {
    state: nextState,
    result: {
      ok: true,
      message: 'Downloaded server data.',
      pulledFoods: pulled.foods?.length ?? 0,
      pulledRecipes: pulled.recipes?.length ?? 0,
      pulledActivities: pulled.activities?.length ?? 0,
      pushedIntakes: 0,
      pushedWeightLogs: 0,
      pushedActivityLogs: 0,
    },
  };
}

export async function pushToServer(state: AppState): Promise<{ state: AppState; result: SyncResult }> {
  const { baseUrl } = state.pairing;
  const password = state.pairing.password ?? state.pairing.token ?? '';
  if (!baseUrl.trim()) throw new Error('Missing API base URL.');

  const deviceInfo = await getMobileDeviceInfo();
  const pushPayload = pendingPushPayload(state, deviceInfo);
  if (!payloadHasAnything(pushPayload)) {
    return {
      state: {
        ...state,
        pairing: { ...state.pairing, lastHealthCheckAt: Date.now(), lastSyncError: undefined },
        intakes: state.intakes.map((intake) => intake.pending_sync ? { ...intake, pending_sync: false } : intake),
        weightLogs: state.weightLogs.map((weight) => weight.pending_sync ? { ...weight, pending_sync: false } : weight),
        activityLogs: state.activityLogs.map((activity) => activity.pending_sync ? { ...activity, pending_sync: false } : activity),
      },
      result: {
        ok: true,
        message: 'No local changes to send.',
        pulledFoods: 0,
        pulledRecipes: 0,
        pulledActivities: 0,
        pushedIntakes: 0,
        pushedWeightLogs: 0,
        pushedActivityLogs: 0,
      },
    };
  }

  const pushed = await requestJson<SyncPushResponse>(baseUrl, password, '/sync/push', {
    method: 'POST',
    body: JSON.stringify(pushPayload),
  });

  const sourceId = state.pairing.sourceId;
  const nextState: AppState = {
    ...state,
    pairing: {
      ...state.pairing,
      token: password,
      password,
      lastSyncAt: state.pairing.lastSyncAt,
      lastHealthCheckAt: pushed.server_time || Date.now(),
      lastSyncError: undefined,
    },
    ingredients: state.ingredients.map((item) => item.source_id === sourceId ? { ...item, pending_sync: false } : item),
    foods: state.foods.map((item) => item.source_id === sourceId ? { ...item, pending_sync: false } : item),
    recipes: state.recipes.map((item) => item.source_id === sourceId ? { ...item, pending_sync: false } : item),
    recipeItems: state.recipeItems.map((item) => ({ ...item, pending_sync: false })),
    activities: state.activities.map((item) => item.pending_sync ? { ...item, pending_sync: false } : item),
    intakes: state.intakes.map((intake) => intake.pending_sync ? { ...intake, pending_sync: false } : intake),
    weightLogs: state.weightLogs.map((weight) => weight.pending_sync ? { ...weight, pending_sync: false } : weight),
    activityLogs: state.activityLogs.map((activity) => activity.pending_sync ? { ...activity, pending_sync: false } : activity),
  };

  return {
    state: nextState,
    result: {
      ok: true,
      message: 'Local catalog data sent to the desktop inbox. Diary and weight data stayed on this device.',
      pulledFoods: 0,
      pulledRecipes: 0,
      pulledActivities: 0,
      pushedIntakes: 0,
      pushedWeightLogs: 0,
      pushedActivityLogs: 0,
    },
  };
}

export async function syncWithServer(state: AppState): Promise<{ state: AppState; result: SyncResult }> {
  return pullFromServer(state);
}


function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = cells[index] ?? ''; });
    return row;
  });
}


function parseNameI18n(row: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {};
  const rawJson = row.name_i18n_json || row.name_i18n;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      for (const [code, value] of Object.entries(parsed || {})) {
        const language = String(code || '').trim().toLowerCase();
        const name = String(value ?? '').trim();
        if (language && name) values[language] = name;
      }
    } catch { /* ignore invalid optional i18n JSON */ }
  }
  for (const [key, value] of Object.entries(row)) {
    const match = key.match(/^name[_-]([a-z]{2})$/i);
    const language = match?.[1]?.toLowerCase();
    const name = String(value || '').trim();
    if (language && name) values[language] = name;
  }
  return values;
}

function num(value: string | undefined, fallback = 0): number {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const secret = String(token || '').trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

async function fetchGitHubCsvFiles(source: GitHubCsvSource): Promise<Array<{ path: string; text: string }>> {
  const branch = source.branch || 'main';
  const base = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents`;
  const startPath = source.path ? `/${source.path.replace(/^\/+|\/+$/g, '').split('/').map(encodeURIComponent).join('/')}` : '';
  const queue = [`${base}${startPath}?ref=${encodeURIComponent(branch)}`];
  const files: Array<{ path: string; text: string }> = [];
  while (queue.length) {
    const url = queue.shift()!;
    const response = await fetch(url, { headers: githubHeaders(source.token) });
    if (!response.ok) throw new Error(`GitHub ${response.status}: ${response.statusText}`);
    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload : [payload];
    for (const item of entries) {
      if (item.type === 'dir' && item.url) queue.push(`${item.url}?ref=${encodeURIComponent(branch)}`);
      if (item.type === 'file' && String(item.name || '').toLowerCase().endsWith('.csv') && item.download_url) {
        const csvResponse = await fetch(item.download_url, { headers: githubHeaders(source.token) });
        if (csvResponse.ok) files.push({ path: item.path || item.name, text: await csvResponse.text() });
      }
    }
  }
  return files;
}

function classifyCsv(path: string, rows: Record<string, string>[]): 'ingredients' | 'foods' | 'recipes' | 'activities' | null {
  const headers = Object.keys(rows[0] || {});
  const name = path.toLowerCase();
  if (name.includes('ingredient') || name.includes('alapanyag')) return 'ingredients';
  if (headers.includes('kcal_per_100g') || name.includes('food')) return 'foods';
  if (headers.includes('ingredients_json') || headers.includes('recipe_id') || name.includes('recipe')) return 'recipes';
  if (headers.includes('kcal_per_min') || headers.includes('met') || name.includes('activity')) return 'activities';
  return null;
}

export async function syncGitHubCsvSources(state: AppState, force = false): Promise<{ state: AppState; imported: number; message: string }> {
  const now = Date.now();
  let imported = 0;
  let next = JSON.parse(JSON.stringify(state)) as AppState;
  const ingredientMap = new Map(next.ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const foodMap = new Map(next.foods.map((food) => [food.id, food]));
  const recipeMap = new Map(next.recipes.map((recipe) => [recipe.id, recipe]));
  const activityMap = new Map(next.activities.map((activity) => [activity.id, activity]));
  const itemMap = new Map(next.recipeItems.map((item) => [item.id, item]));

  for (const source of next.githubSources.filter((entry) => entry.enabled)) {
    if (!force && source.lastSyncAt && now - source.lastSyncAt < 23 * 60 * 60 * 1000) continue;
    try {
      const files = await fetchGitHubCsvFiles(source);
      for (const file of files) {
        const rows = parseCsv(file.text);
        const kind = classifyCsv(file.path, rows);
        if (!kind) continue;
        for (const row of rows) {
          if (kind === 'ingredients') {
            const name = row.name || row.title;
            if (!name) continue;
            const id = row.id || `github-ingredient-${source.owner}-${source.repo}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            ingredientMap.set(id, normalizeIngredient({
              id, source_id: `github:${source.owner}/${source.repo}`, name,
              name_i18n: parseNameI18n(row),
              note: row.note || row.description || null,
              default_unit: row.default_unit || 'g', serving_size_g: row.serving_size_g ? num(row.serving_size_g, 0) : null,
              kcal_per_100g: num(row.kcal_per_100g), carbs_per_100g: num(row.carbs_per_100g), fat_per_100g: num(row.fat_per_100g), protein_per_100g: num(row.protein_per_100g),
              sugars_per_100g: num(row.sugars_per_100g), fiber_per_100g: num(row.fiber_per_100g), salt_per_100g: num(row.salt_per_100g),
              updated_at: now, deleted_at: null,
            } as Ingredient));
            imported++;
          } else if (kind === 'foods') {
            const name = row.name || row.title;
            if (!name) continue;
            if (row.catalog_kind === 'ingredient') {
              const id = row.id || `github-ingredient-${source.owner}-${source.repo}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              ingredientMap.set(id, normalizeIngredient({
                id, source_id: `github:${source.owner}/${source.repo}`, name,
                name_i18n: parseNameI18n(row),
                note: row.note || row.description || null,
                default_unit: row.default_unit || 'g', serving_size_g: row.serving_size_g ? num(row.serving_size_g, 0) : null,
                kcal_per_100g: num(row.kcal_per_100g), carbs_per_100g: num(row.carbs_per_100g), fat_per_100g: num(row.fat_per_100g), protein_per_100g: num(row.protein_per_100g),
                sugars_per_100g: num(row.sugars_per_100g), fiber_per_100g: num(row.fiber_per_100g), salt_per_100g: num(row.salt_per_100g),
                updated_at: now, deleted_at: null,
              } as Ingredient));
            } else {
              const id = row.id || `github-food-${source.owner}-${source.repo}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              foodMap.set(id, normalizeFood({
                id, source_id: `github:${source.owner}/${source.repo}`, name,
                name_i18n: parseNameI18n(row),
                brand: row.brand || null,
                catalog_kind: 'food',
                note: row.note || row.description || null,
                default_unit: row.default_unit || 'g', serving_size_g: row.serving_size_g ? num(row.serving_size_g, 0) : null,
                kcal_per_100g: num(row.kcal_per_100g), carbs_per_100g: num(row.carbs_per_100g), fat_per_100g: num(row.fat_per_100g), protein_per_100g: num(row.protein_per_100g),
                sugars_per_100g: num(row.sugars_per_100g), fiber_per_100g: num(row.fiber_per_100g), salt_per_100g: num(row.salt_per_100g), barcode: row.barcode || row.ean || row.upc || null,
                updated_at: now, deleted_at: null,
              }));
            }
            imported++;
          } else if (kind === 'activities') {
            const name = row.name || row.title;
            if (!name) continue;
            const id = row.id || `github-activity-${source.owner}-${source.repo}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            activityMap.set(id, { id, source_id: `github:${source.owner}/${source.repo}`, code: row.code || id, name, name_i18n: parseNameI18n(row), description: row.description || null, activity_type: row.activity_type || row.type || 'custom', met: num(row.met, 1), kcal_per_min: num(row.kcal_per_min, 0), updated_at: now, deleted_at: null });
            imported++;
          } else if (kind === 'recipes') {
            const name = row.name || row.title;
            if (!name) continue;
            const id = row.recipe_id || row.id || `github-recipe-${source.owner}-${source.repo}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            recipeMap.set(id, { id, source_id: `github:${source.owner}/${source.repo}`, name, name_i18n: parseNameI18n(row), description: row.description || null, note: row.note || null, servings_count: row.servings_count ? num(row.servings_count, 1) : null, total_weight_g: null, extra_kcal: row.extra_kcal ? num(row.extra_kcal, 0) : 0, updated_at: now, deleted_at: null });
            if (row.ingredients_json) {
              try {
                const ingredients = JSON.parse(row.ingredients_json) as Array<{ food_id: string; amount_g: number }>;
                for (const ingredient of ingredients) {
                  if (!ingredient.food_id || !ingredient.amount_g) continue;
                  const itemId = `github-recipe-item-${id}-${ingredient.food_id}`;
                  itemMap.set(itemId, { id: itemId, recipe_id: id, food_id: ingredient.food_id, amount_g: Number(ingredient.amount_g), updated_at: now, deleted_at: null });
                }
              } catch { /* ignore invalid recipe row */ }
            }
            imported++;
          }
        }
      }
      source.lastSyncAt = now;
      source.lastStatus = `Imported ${imported} item(s) from ${files.length} CSV file(s).`;
    } catch (error) {
      source.lastStatus = String(error);
    }
  }

  next.ingredients = [...ingredientMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  next.foods = [...foodMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  next.recipes = [...recipeMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  next.activities = [...activityMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  next.recipeItems = [...itemMap.values()];
  return { state: next, imported, message: imported ? `GitHub CSV sync imported ${imported} item(s).` : 'No GitHub CSV changes to import.' };
}
