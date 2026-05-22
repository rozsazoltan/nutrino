import type { AppState, ServerHealth, SyncPullResponse, SyncPushRequest, SyncPushResponse, SyncResult } from '../types';
import { canonicalizeStateReferences, mergeAliases, mergeById, normalizeFood, resolveCatalogId } from './storage';

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function authSecret(tokenOrPassword: string): string {
  return String(tokenOrPassword || '').trim();
}

async function requestJson<T>(baseUrl: string, tokenOrPassword: string, path: string, init: RequestInit = {}): Promise<T> {
  const secret = authSecret(tokenOrPassword);
  const response = await fetch(apiUrl(baseUrl, path), {
    ...init,
    headers: {
      Accept: 'application/json',
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

function pendingCatalogPayload(state: AppState): Pick<SyncPushRequest, 'foods' | 'recipes' | 'recipe_items' | 'activities'> {
  const sourceId = state.pairing.sourceId;
  const foodIds = new Set<string>();
  const recipeIds = new Set<string>();
  const activityIds = new Set<string>();

  for (const intake of state.intakes) {
    if (!intake.pending_sync) continue;
    if (intake.item_type === 'recipe') recipeIds.add(stripRecipeRef(intake.food_id));
    else if (intake.item_type === 'food' || !intake.item_type) foodIds.add(resolveCatalogId(state, 'food', intake.food_id));
  }

  for (const log of state.activityLogs) {
    if (log.pending_sync && log.activity_id) activityIds.add(resolveCatalogId(state, 'activity', log.activity_id));
  }

  for (const item of state.recipeItems) {
    if (item.pending_sync || recipeIds.has(stripRecipeRef(item.recipe_id))) {
      recipeIds.add(stripRecipeRef(item.recipe_id));
      foodIds.add(resolveCatalogId(state, 'food', item.food_id));
    }
  }

  return {
    foods: state.foods.filter((item) => item.pending_sync || item.source_id === sourceId || foodIds.has(item.id)),
    recipes: state.recipes.filter((item) => item.pending_sync || item.source_id === sourceId || recipeIds.has(item.id)),
    recipe_items: state.recipeItems.filter((item) => item.pending_sync || recipeIds.has(stripRecipeRef(item.recipe_id))),
    activities: state.activities.filter((item) => item.pending_sync || item.source_id === sourceId || activityIds.has(item.id)),
  };
}

function pendingPushPayload(state: AppState): SyncPushRequest {
  return {
    source_id: state.pairing.sourceId,
    device_name: typeof navigator !== 'undefined' ? `${navigator.platform || 'Mobile'} ${navigator.userAgent.includes('Android') ? 'Android' : ''}`.trim() : 'Mobile device',
    sent_at: Date.now(),
    ...pendingCatalogPayload(state),
    intakes: state.intakes
      .filter((intake) => intake.pending_sync)
      .map((intake) => ({
        id: intake.id,
        item_type: intake.item_type,
        food_id: intake.item_type === 'recipe' ? `recipe:${resolveCatalogId(state, 'recipe', intake.food_id)}` : intake.item_type === 'food' ? resolveCatalogId(state, 'food', intake.food_id) : intake.food_id,
        source_id: intake.source_id,
        consumed_at: intake.consumed_at,
        meal_type: intake.meal_type,
        amount_g: intake.amount_g,
        food_snapshot_json: intake.food_snapshot_json,
        note_title: intake.note_title ?? null,
        note_description: intake.note_description ?? null,
      })),
    weight_logs: state.weightLogs
      .filter((weight) => weight.pending_sync)
      .map((weight) => ({
        id: weight.id,
        measured_at: weight.measured_at,
        weight_kg: weight.weight_kg,
        bmi: weight.bmi,
        source: weight.source,
      })),
    activity_logs: state.activityLogs
      .filter((activity) => activity.pending_sync)
      .map((activity) => ({
        id: activity.id,
        activity_id: activity.activity_id ? resolveCatalogId(state, 'activity', activity.activity_id) : null,
        activity_name: activity.activity_name,
        performed_at: activity.performed_at,
        duration_min: activity.duration_min,
        kcal: activity.kcal,
        source: activity.source,
      })),
  };
}

function payloadHasAnything(payload: SyncPushRequest): boolean {
  return Boolean(
    payload.intakes.length ||
    payload.weight_logs.length ||
    payload.activity_logs.length ||
    payload.foods?.length ||
    payload.recipes?.length ||
    payload.recipe_items?.length ||
    payload.activities?.length
  );
}

function mergePulledCatalog(state: AppState, pulled: SyncPullResponse, serverTime: number): AppState {
  const catalogRevision = Math.max(
    state.pairing.catalogRevision || 0,
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
    foods: keepPending(state.foods, mergeById(state.foods, (pulled.foods ?? []).map(normalizeFood))),
    recipes: keepPending(state.recipes, mergeById(state.recipes, pulled.recipes ?? [])),
    recipeItems: keepPending(state.recipeItems, mergeById(state.recipeItems, pulled.recipe_items ?? [])),
    activities: keepPending(state.activities, mergeById(state.activities, pulled.activities ?? [])),
  };

  return canonicalizeStateReferences(nextState);
}

export async function pullFromServer(state: AppState): Promise<{ state: AppState; result: SyncResult }> {
  const { baseUrl, lastSyncAt } = state.pairing;
  const password = state.pairing.password ?? state.pairing.token ?? '';
  if (!baseUrl.trim()) throw new Error('Missing API base URL.');

  const catalogCacheIsEmpty = !state.foods.length && !state.recipes.length && !state.recipeItems.length && !state.activities.length;
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

  const pushPayload = pendingPushPayload(state);
  if (!payloadHasAnything(pushPayload)) {
    return {
      state: {
        ...state,
        pairing: { ...state.pairing, lastHealthCheckAt: Date.now(), lastSyncError: undefined },
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
      message: 'Local data sent to the desktop inbox.',
      pulledFoods: 0,
      pulledRecipes: 0,
      pulledActivities: 0,
      pushedIntakes: pushPayload.intakes.length,
      pushedWeightLogs: pushPayload.weight_logs.length,
      pushedActivityLogs: pushPayload.activity_logs.length,
    },
  };
}

export async function syncWithServer(state: AppState): Promise<{ state: AppState; result: SyncResult }> {
  return pullFromServer(state);
}
