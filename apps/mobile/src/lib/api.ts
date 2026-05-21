import type { AppState, ServerHealth, SyncPullResponse, SyncResult } from '../types';
import { mergeById, normalizeFood } from './storage';

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function requestJson<T>(baseUrl: string, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(baseUrl, path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return await response.json() as T;
}

export async function checkServerHealth(baseUrl: string, token: string): Promise<ServerHealth> {
  if (!baseUrl.trim()) throw new Error('Missing API base URL.');
  return await requestJson<ServerHealth>(baseUrl, token, '/health');
}

export async function pingServer(baseUrl: string, token: string): Promise<string> {
  const result = await checkServerHealth(baseUrl, token);
  const auth = result.auth_required ? 'token required' : 'dev auth disabled';
  return result.name ? `${result.name}${result.version ? ` ${result.version}` : ''} · ${auth}` : 'Server is reachable.';
}

export async function syncWithServer(state: AppState): Promise<{ state: AppState; result: SyncResult }> {
  const { baseUrl, token, lastSyncAt } = state.pairing;
  if (!baseUrl.trim()) throw new Error('Missing API base URL.');

  const pulled = await requestJson<SyncPullResponse>(baseUrl, token, `/sync/pull?since=${encodeURIComponent(String(lastSyncAt || 0))}`);
  const serverTime = pulled.server_time || Date.now();
  const catalogRevision = Math.max(
    state.pairing.catalogRevision || 0,
    ...((pulled.foods ?? []).map((item) => item.updated_at || 0)),
    ...((pulled.recipes ?? []).map((item) => item.updated_at || 0)),
    ...((pulled.recipe_items ?? []).map((item) => item.updated_at || 0)),
    ...((pulled.activities ?? []).map((item) => item.updated_at || 0)),
  );

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
    foods: mergeById(state.foods, (pulled.foods ?? []).map(normalizeFood)),
    recipes: mergeById(state.recipes, pulled.recipes ?? []),
    recipeItems: mergeById(state.recipeItems, pulled.recipe_items ?? []),
    activities: mergeById(state.activities, pulled.activities ?? []),
    intakes: state.intakes.map((intake) => ({ ...intake, pending_sync: false })),
    weightLogs: state.weightLogs.map((weight) => ({ ...weight, pending_sync: false })),
    activityLogs: state.activityLogs.map((activity) => ({ ...activity, pending_sync: false })),
  };

  return {
    state: nextState,
    result: {
      ok: true,
      message: 'Catalog sync completed.',
      pulledFoods: pulled.foods?.length ?? 0,
      pulledRecipes: pulled.recipes?.length ?? 0,
      pulledActivities: pulled.activities?.length ?? 0,
      pushedIntakes: 0,
      pushedWeightLogs: 0,
      pushedActivityLogs: 0,
    },
  };
}
