<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { lucideSvg, type IconName } from './icons';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import * as QRCode from 'qrcode';
import { commands } from './lib/commands';
import type { ActivityDefinition, ActivityInput, CatalogDuplicateSuggestion, DesktopSettings, Food, FoodInput, Recipe, RecipeDetail, RecipeInput, RecipeInputItem, ServerStatus, SyncInboxEntry, SyncPushPayload } from './types';

type Tab = 'dashboard' | 'foods' | 'recipes' | 'activities' | 'server' | 'settings';
type CatalogKind = 'food' | 'recipe' | 'activity';
type RecipeCatalogItem = Food & { catalog_source: 'food' | 'recipe' };
type ModalKind = CatalogKind | null;

const tab = ref<Tab>('dashboard');
const modal = ref<ModalKind>(null);
const status = ref<ServerStatus | null>(null);
const foods = ref<Food[]>([]);
const recipes = ref<RecipeDetail[]>([]);
const activities = ref<ActivityDefinition[]>([]);
const syncInbox = ref<SyncInboxEntry[]>([]);
const duplicateSuggestions = ref<CatalogDuplicateSuggestion[]>([]);
const duplicateCanonicalSelections = ref<Record<string, string>>({});
const mergePicker = ref<{ kind: CatalogKind; aliasId: string; aliasName: string; query: string; selectedId: string } | null>(null);
const qrDialog = ref<{ title: string; svg: string; payload: string } | null>(null);
const skipCsvDuplicates = ref(true);
const reviewingInboxEntry = ref<SyncInboxEntry | null>(null);
const reviewPayloadText = ref('');
const reviewAdvancedJson = ref(false);
const exportText = ref('');
const recipeExportText = ref('');
const activityExportText = ref('');
const message = ref('');
const loading = ref(false);
const port = ref(8090);
const activityQuery = ref('');
const foodQuery = ref('');
const foodSort = ref<'name' | 'kcal' | 'protein' | 'carbs' | 'fat'>('name');
const recipeQuery = ref('');
const recipeSort = ref<'name' | 'kcal' | 'protein' | 'carbs' | 'fat'>('name');
const settings = ref<DesktopSettings | null>(null);
const appVersion = '0.8.0';
const appChannel = import.meta.env.DEV ? 'dev' : String(import.meta.env.VITE_NUTRINO_CHANNEL || 'stable');
const appName = appChannel === 'dev' ? 'Nutrino Desktop Dev' : 'Nutrino Desktop';
document.title = appName;
const repositoryUrl = 'https://github.com/rozsazoltan/nutrino';
const issueUrl = 'https://github.com/rozsazoltan/nutrino/issues/new/choose';
const starUrl = 'https://github.com/rozsazoltan/nutrino/stargazers';
const foodCsvHeader = 'id,name,brand,catalog_kind,note,barcode,default_unit,serving_size_g,kcal_per_100g,carbs_per_100g,fat_per_100g,protein_per_100g,sugars_per_100g,fiber_per_100g,salt_per_100g';
const recipeCsvHeader = 'recipe_id,name,description,note,total_weight_g,servings_count,ingredients_json';
const activityCsvHeader = 'id,code,name,description,activity_type,met,kcal_per_min';
const csvImportNotes = [
  'Keep the first row as the exact header row shown here.',
  'Leave id/recipe_id empty when Nutrino should generate a new local ID.',
  'Use dot decimals, for example 12.5, not 12,5.',
  'Recipe ingredients_json must contain food_id and amount_g values; amounts are stored in grams.',
];
const desktopOnboardingKey = 'nutrino.desktop.onboarded.v1';
const onboardingOpen = ref(false);
const onboardingStep = ref(0);
const onboardingPort = ref(8090);
const serverPassword = ref('');
const onboardingPassword = ref('');
let messageTimer: number | undefined;

const nutrinoLogoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"> <rect width="64" height="64" rx="18" fill="#0D2514"/> <g fill="#33E36A"> <circle cx="18" cy="14" r="5"/> <circle cx="18" cy="26" r="5"/> <circle cx="18" cy="38" r="5"/> <circle cx="18" cy="50" r="5"/> <circle cx="29" cy="24" r="5"/> <circle cx="35" cy="34" r="5"/> <circle cx="46" cy="14" r="5"/> <circle cx="46" cy="26" r="5"/> <circle cx="46" cy="38" r="5"/> <circle cx="46" cy="50" r="5"/> </g> </svg>';

type ThirdPartyNotice = {
  name: string;
  license: string;
  purpose: string;
  url: string;
  note?: string;
};

const thirdPartyNotices: ThirdPartyNotice[] = [
  { name: 'Nutrino', license: 'AGPL-3.0-only', purpose: 'Application source code and project license.', url: repositoryUrl },
  { name: 'Vue', license: 'MIT', purpose: 'Reactive user interface framework for the mobile and desktop apps.', url: 'https://vuejs.org/' },
  { name: 'Tauri', license: 'MIT OR Apache-2.0', purpose: 'Native desktop/mobile runtime, app shell and platform bridge.', url: 'https://tauri.app/' },
  { name: 'Rust', license: 'MIT OR Apache-2.0', purpose: 'Systems language and native backend ecosystem used by Tauri.', url: 'https://www.rust-lang.org/' },
  { name: 'JSZip', license: 'MIT OR GPL-3.0', purpose: 'Creation and validation of portable ZIP backups.', url: 'https://github.com/Stuk/jszip' },
  { name: 'qrcode', license: 'MIT', purpose: 'Generating catalog QR codes in the desktop app.', url: 'https://github.com/soldair/node-qrcode' },
  { name: 'tauri-plugin-android-fs', license: 'MIT OR Apache-2.0', purpose: 'Android Storage Access Framework file picker used for reliable mobile ZIP backup import/export.', url: 'https://docs.rs/crate/tauri-plugin-android-fs/latest' },
  { name: 'Lucide Icons', license: 'ISC', purpose: 'Open-source SVG icon set used across the app interface.', url: 'https://lucide.dev/', note: 'Some Lucide icons are derived from Feather Icons, MIT licensed.' },
  { name: 'Vite', license: 'MIT', purpose: 'Development server and frontend production build tooling.', url: 'https://vite.dev/' },
  { name: 'TypeScript', license: 'Apache-2.0', purpose: 'Typed JavaScript language tooling used by the frontend codebase.', url: 'https://www.typescriptlang.org/' },
  { name: 'OpenNutriTracker', license: 'GPL-3.0', purpose: 'Inspiration for a privacy-first, open-source nutrition tracker.', url: 'https://github.com/simonoppowa/OpenNutriTracker', note: 'Thank you for the inspiration. No OpenNutriTracker source code or assets are copied into Nutrino.' },
];

const acknowledgements = [
  'Thank you to OpenNutriTracker for showing how good a privacy-first open-source nutrition tracker can feel.',
  'Thank you to Tauri and Rust for making a small, local-first desktop and mobile architecture possible.',
  'Thank you to Vue, Vite, TypeScript, JSZip and Lucide for the developer tools, runtime pieces and icons used by Nutrino.',
];

const emptyFoodForm = (): FoodInput => ({
  id: null,
  name: '',
  brand: '',
  catalog_kind: 'food',
  note: '',
  barcode: '',
  default_unit: 'g',
  serving_size_g: null,
  kcal_per_100g: 0,
  carbs_per_100g: 0,
  fat_per_100g: 0,
  protein_per_100g: 0,
  sugars_per_100g: 0,
  fiber_per_100g: 0,
  salt_per_100g: 0,
});

const emptyActivityForm = (): ActivityInput => ({
  id: null,
  code: 'custom',
  name: '',
  description: '',
  activity_type: 'custom',
  met: 3,
  kcal_per_min: 3.8,
});

const emptyRecipeForm = (): RecipeInput => ({
  id: null,
  name: '',
  description: '',
  note: '',
  total_weight_g: null,
  servings_count: null,
  items: [{ food_id: '', amount_g: 100 }],
});

const foodForm = ref<FoodInput>(emptyFoodForm());
const activityForm = ref<ActivityInput>(emptyActivityForm());
const recipeForm = ref<RecipeInput>(emptyRecipeForm());
const recipeIngredientSearch = ref<Record<number, string>>({});

const editingFoodId = computed(() => foodForm.value.id || null);
const editingRecipeId = computed(() => recipeForm.value.id || null);
const editingActivityId = computed(() => activityForm.value.id || null);

const totalFoods = computed(() => foods.value.length);
const totalRecipes = computed(() => recipes.value.length);
const totalActivities = computed(() => activities.value.length);
const avgKcal = computed(() => foods.value.length ? Math.round(foods.value.reduce((sum, food) => sum + food.kcal_per_100g, 0) / foods.value.length) : 0);

const totalIngredients = computed(() => foods.value.filter((food) => food.catalog_kind === 'ingredient').length);
const totalPreparedFoods = computed(() => foods.value.filter((food) => food.catalog_kind !== 'ingredient').length);
const latestFoodUpdatedAt = computed(() => latestUpdatedAt(foods.value));
const latestRecipeUpdatedAt = computed(() => latestUpdatedAt(recipes.value.map((detail) => detail.recipe)));
const latestActivityUpdatedAt = computed(() => latestUpdatedAt(activities.value));

function latestUpdatedAt(items: Array<{ updated_at?: number | null; deleted_at?: number | null }>): number | null {
  const latest = items.filter((item) => !item.deleted_at).reduce((max, item) => Math.max(max, Number(item.updated_at || 0)), 0);
  return latest > 0 ? latest : null;
}

function formatFreshness(value: number | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

function foodKindLabel(food: Food): string {
  return food.catalog_kind === 'ingredient' ? 'Ingredient' : 'Food';
}

const sortedFoods = computed(() => {
  const q = foodQuery.value.trim().toLowerCase();
  const items = q ? foods.value.filter((food) => `${food.name} ${food.brand ?? ''} ${food.note ?? ''} ${food.barcode ?? ''} ${food.id}`.toLowerCase().includes(q)) : [...foods.value];
  return items.sort((a, b) => {
    if (foodSort.value === 'kcal') return b.kcal_per_100g - a.kcal_per_100g;
    if (foodSort.value === 'protein') return b.protein_per_100g - a.protein_per_100g;
    if (foodSort.value === 'carbs') return b.carbs_per_100g - a.carbs_per_100g;
    if (foodSort.value === 'fat') return b.fat_per_100g - a.fat_per_100g;
    return a.name.localeCompare(b.name);
  });
});

const sortedRecipes = computed(() => {
  const q = recipeQuery.value.trim().toLowerCase();
  const items = q ? recipes.value.filter((detail) => `${detail.recipe.name} ${detail.recipe.description ?? ''} ${detail.recipe.note ?? ''} ${detail.recipe.id}`.toLowerCase().includes(q)) : [...recipes.value];
  return items.sort((a, b) => {
    if (recipeSort.value === 'kcal') return b.nutrition.kcal_per_100g - a.nutrition.kcal_per_100g;
    if (recipeSort.value === 'protein') return b.nutrition.protein_per_100g - a.nutrition.protein_per_100g;
    if (recipeSort.value === 'carbs') return b.nutrition.carbs_per_100g - a.nutrition.carbs_per_100g;
    if (recipeSort.value === 'fat') return b.nutrition.fat_per_100g - a.nutrition.fat_per_100g;
    return a.recipe.name.localeCompare(b.recipe.name);
  });
});

const apiDisplay = computed(() => status.value?.base_url ?? 'Start the server to pair mobile');
const serverRunning = computed(() => Boolean(status.value?.running));

const navigation: Array<{ key: Tab; label: string; icon: AppIconName }> = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'foods', label: 'Foods', icon: 'foods' },
  { key: 'recipes', label: 'Recipes', icon: 'recipes' },
  { key: 'activities', label: 'Activities', icon: 'activities' },
  { key: 'server', label: 'Server', icon: 'server' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

const settingRows: Array<{ key: keyof DesktopSettings; title: string; body: string; icon: AppIconName }> = [
  { key: 'remember_window_state', title: 'Remember window position and size', body: 'Restore the latest desktop window geometry on next launch.', icon: 'settings' },
  { key: 'launch_at_startup', title: 'Launch at system startup', body: 'Register nutrino Desktop for Windows login startup.', icon: 'server' },
  { key: 'run_in_background', title: 'Run in background', body: 'Keep the tray process alive so the LAN API can keep running.', icon: 'dashboard' },
  { key: 'auto_start_server', title: 'Start API server on app launch', body: 'Automatically start the LAN server on the saved port.', icon: 'server' },
  { key: 'close_to_tray', title: 'Close button hides to tray', body: 'When background mode is enabled, X hides the window instead of exiting.', icon: 'settings' },
  { key: 'start_hidden_to_tray', title: 'Start hidden in tray on Windows login', body: 'Start in the tray when launched by Windows startup.', icon: 'dashboard' },
];



type SettingRow = (typeof settingRows)[number];

const settingGroups: Array<{ title: string; subtitle: string; rows: SettingRow[] }> = [
  {
    title: 'Runtime',
    subtitle: 'Server and background behavior.',
    rows: [settingRows[1], settingRows[3], settingRows[2]],
  },
  {
    title: 'Window behavior',
    subtitle: 'Desktop window and tray preferences.',
    rows: [settingRows[0], settingRows[4], settingRows[5]],
  },
];

const appIconMap = {
  dashboard: 'layoutDashboard',
  foods: 'utensils',
  recipes: 'bookOpenText',
  activities: 'activity',
  server: 'server',
  settings: 'settings',
  add: 'plus',
  edit: 'squarePen',
  trash: 'trash2',
  refresh: 'refreshCw',
  reset: 'rotateCcw',
  export: 'upload',
  import: 'download',
  shield: 'shield',
  info: 'info',
  star: 'star',
  repo: 'bookOpen',
  issue: 'bug',
  database: 'database',
  licenses: 'badgeInfo',
} as const satisfies Record<string, IconName>;

type AppIconName = keyof typeof appIconMap | IconName;

const filledIconNames = new Set<IconName>();

function icon(name: AppIconName, filled = false) {
  const resolved = appIconMap[name as keyof typeof appIconMap] ?? (name as IconName);
  return lucideSvg(resolved, { filled: filled && filledIconNames.has(resolved) });
}

const activityIconSvgs: Record<string, string> = {
  bicycling: lucideSvg('bike'),
  running: lucideSvg('personStanding'),
  waterActivities: lucideSvg('wavesHorizontal'),
  winterActivities: lucideSvg('snowflake'),
  dancing: lucideSvg('music'),
  sport: lucideSvg('dumbbell'),
  conditioningExercise: lucideSvg('dumbbell'),
  default: lucideSvg('activity'),
};

function activityIcon(type: string) {
  return activityIconSvgs[type] ?? activityIconSvgs.default;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function setMessage(value: string) {
  if (messageTimer) window.clearTimeout(messageTimer);
  message.value = value;
  if (value) {
    messageTimer = window.setTimeout(() => {
      if (message.value === value) message.value = '';
    }, 6500);
  }
}

function typeLabel(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

async function refreshAll() {
  status.value = await commands.getServerStatus();
  serverPassword.value = status.value.token || '';
  foods.value = await commands.listFoods();
  recipes.value = await commands.listRecipes();
  activities.value = await commands.listActivities();
  if (status.value.port) port.value = status.value.port;
  settings.value = await commands.getDesktopSettings();
  syncInbox.value = await commands.listSyncInbox();
  duplicateSuggestions.value = await commands.listCatalogDuplicateSuggestions();
}


async function startServer() {
  loading.value = true;
  try {
    await commands.setServerPassword(serverPassword.value.trim());
    status.value = await commands.startServer(port.value);
    setMessage('LAN API server started. Use your desktop LAN IP with this port on mobile.');
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}


async function saveServerPassword() {
  loading.value = true;
  const restart = serverRunning.value;
  try {
    if (restart) await commands.stopServer();
    status.value = await commands.setServerPassword(serverPassword.value.trim());
    if (restart) status.value = await commands.startServer(port.value);
    setMessage(status.value.auth_required ? 'Server password saved. Mobile must use this password.' : 'Server password cleared. Mobile can sync without a password.');
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function stopServer() {
  loading.value = true;
  try {
    status.value = await commands.stopServer();
    setMessage('LAN API server stopped. Mobile can continue with its offline cache.');
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}


function syncInboxSummary(entry: SyncInboxEntry) {
  const parts = [
    entry.summary.foods ? `${entry.summary.foods} foods` : '',
    entry.summary.recipes ? `${entry.summary.recipes} recipes` : '',
    entry.summary.activities ? `${entry.summary.activities} activities` : '',
    entry.summary.intakes ? `${entry.summary.intakes} meals/notes` : '',
    entry.summary.activity_logs ? `${entry.summary.activity_logs} activity logs` : '',
    entry.summary.weight_logs ? `${entry.summary.weight_logs} weights` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No data items';
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function inboxPayloadCount(payload: SyncPushPayload | undefined, key: keyof SyncPushPayload) {
  const value = payload?.[key];
  return Array.isArray(value) ? value.length : 0;
}

function openInboxReview(entry: SyncInboxEntry) {
  reviewingInboxEntry.value = JSON.parse(JSON.stringify(entry));
  reviewPayloadText.value = JSON.stringify(entry.payload, null, 2);
  reviewAdvancedJson.value = false;
}

function closeInboxReview() {
  reviewingInboxEntry.value = null;
  reviewPayloadText.value = '';
  reviewAdvancedJson.value = false;
}

const reviewFoods = computed<Food[]>(() => reviewingInboxEntry.value?.payload.foods ?? []);
const reviewRecipes = computed<Recipe[]>(() => reviewingInboxEntry.value?.payload.recipes ?? []);
const reviewActivities = computed<ActivityDefinition[]>(() => reviewingInboxEntry.value?.payload.activities ?? []);
const reviewIntakes = computed<SyncPushPayload['intakes']>(() => reviewingInboxEntry.value?.payload.intakes ?? []);
const reviewActivityLogs = computed<SyncPushPayload['activity_logs']>(() => reviewingInboxEntry.value?.payload.activity_logs ?? []);
const reviewWeightLogs = computed<SyncPushPayload['weight_logs']>(() => reviewingInboxEntry.value?.payload.weight_logs ?? []);

function reviewPayloadArray(key: keyof SyncPushPayload): unknown[] {
  const value = reviewingInboxEntry.value?.payload?.[key];
  return Array.isArray(value) ? value : [];
}

function removeReviewPayloadItem(key: keyof SyncPushPayload, index: number) {
  if (!reviewingInboxEntry.value) return;
  const value = reviewingInboxEntry.value.payload[key];
  if (!Array.isArray(value)) return;
  value.splice(index, 1);
}

function toggleReviewAdvancedJson() {
  reviewAdvancedJson.value = !reviewAdvancedJson.value;
  if (reviewAdvancedJson.value && reviewingInboxEntry.value) {
    reviewPayloadText.value = JSON.stringify(reviewingInboxEntry.value.payload, null, 2);
  }
}

async function saveInboxReview() {
  if (!reviewingInboxEntry.value) return;
  loading.value = true;
  try {
    const payloadJson = reviewAdvancedJson.value ? reviewPayloadText.value : JSON.stringify(reviewingInboxEntry.value.payload, null, 2);
    const updated = await commands.updateSyncInboxPayload(reviewingInboxEntry.value.id, payloadJson);
    reviewingInboxEntry.value = JSON.parse(JSON.stringify(updated));
    reviewPayloadText.value = JSON.stringify(updated.payload, null, 2);
    const idx = syncInbox.value.findIndex((entry) => entry.id === updated.id);
    if (idx >= 0) syncInbox.value[idx] = updated;
    setMessage('Mobile upload draft updated. Review the list, then record it when ready.');
  } catch (error) {
    setMessage(`Invalid upload draft: ${String(error)}`);
  } finally {
    loading.value = false;
  }
}

function catalogOptions(kind: CatalogKind) {
  if (kind === 'food') return foods.value.map((food) => ({ id: food.id, name: food.name, subtitle: `${round(food.kcal_per_100g)} kcal / 100g · ${food.brand || 'no brand'}` }));
  if (kind === 'recipe') return recipes.value.map((detail) => ({ id: detail.recipe.id, name: detail.recipe.name, subtitle: `${round(detail.nutrition.kcal_per_100g)} kcal / 100g · ${detail.recipe.description || 'no description'}` }));
  return activities.value.map((activity) => ({ id: activity.id, name: activity.name, subtitle: `code ${activity.code} · MET ${round(activity.met)} · ${activity.activity_type}` }));
}

const mergePickerOptions = computed(() => {
  if (!mergePicker.value) return [];
  const query = mergePicker.value.query.trim().toLowerCase();
  return catalogOptions(mergePicker.value.kind)
    .filter((item) => item.id !== mergePicker.value?.aliasId)
    .filter((item) => !query || `${item.name} ${item.id} ${item.subtitle}`.toLowerCase().includes(query))
    .slice(0, 80);
});

function openMergePicker(kind: CatalogKind, aliasId: string, aliasName: string) {
  mergePicker.value = { kind, aliasId, aliasName, query: aliasName, selectedId: '' };
}

function closeMergePicker() {
  mergePicker.value = null;
}

async function confirmMergePicker() {
  if (!mergePicker.value || !mergePicker.value.selectedId) return;
  const { kind, aliasId, aliasName, selectedId } = mergePicker.value;
  const target = catalogOptions(kind).find((item) => item.id === selectedId);
  const targetName = target?.name || selectedId;
  if (!window.confirm(`Merge "${aliasName}" into "${targetName}"? Old diary/calendar entries will point to the kept item and the alias will sync to mobile.`)) return;
  loading.value = true;
  try {
    await commands.mergeCatalogItem(kind, aliasId, selectedId);
    setMessage(`${kind} merged. Old diary/calendar references now point to the kept item.`);
    closeMergePicker();
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function mergeCatalogInto(kind: CatalogKind, aliasId: string, aliasName: string) {
  openMergePicker(kind, aliasId, aliasName);
}

function duplicateSuggestionKey(suggestion: CatalogDuplicateSuggestion) {
  return `${suggestion.kind}:${suggestion.key}`;
}

function duplicateCanonicalId(suggestion: CatalogDuplicateSuggestion) {
  const key = duplicateSuggestionKey(suggestion);
  return duplicateCanonicalSelections.value[key] || suggestion.items[0]?.id || '';
}

function setDuplicateCanonical(suggestion: CatalogDuplicateSuggestion, id: string) {
  duplicateCanonicalSelections.value = { ...duplicateCanonicalSelections.value, [duplicateSuggestionKey(suggestion)]: id };
}

function editDuplicateItem(kind: string, id: string) {
  if (kind === 'food') {
    const item = foods.value.find((food) => food.id === id);
    if (item) openFoodModal(item);
  } else if (kind === 'recipe') {
    const item = recipes.value.find((recipe) => recipe.recipe.id === id);
    if (item) openRecipeModal(item);
  } else if (kind === 'activity') {
    const item = activities.value.find((activity) => activity.id === id);
    if (item) openActivityModal(item);
  }
}

async function mergeDuplicateSuggestion(suggestion: CatalogDuplicateSuggestion) {
  const canonicalId = duplicateCanonicalId(suggestion);
  const aliases = suggestion.items.filter((item) => item.id !== canonicalId);
  if (!canonicalId || !aliases.length) return;
  const canonical = suggestion.items.find((item) => item.id === canonicalId);
  if (!window.confirm(`Keep "${canonical?.name || canonicalId}" and merge ${aliases.length} duplicate item(s) into it? Diary/calendar entries will be rewritten and aliases will sync to mobile.`)) return;
  loading.value = true;
  try {
    for (const alias of aliases) {
      await commands.mergeCatalogItem(suggestion.kind, alias.id, canonicalId);
    }
    setMessage(`${aliases.length} duplicate ${suggestion.kind} item(s) merged.`);
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}


async function mergeAllDuplicateSuggestions() {
  const suggestions = duplicateSuggestions.value.filter((suggestion) => {
    const canonicalId = duplicateCanonicalId(suggestion);
    return canonicalId && suggestion.items.some((item) => item.id !== canonicalId);
  });
  if (!suggestions.length) return;
  const aliasCount = suggestions.reduce((count, suggestion) => count + suggestion.items.filter((item) => item.id !== duplicateCanonicalId(suggestion)).length, 0);
  if (!window.confirm(`Execute ${suggestions.length} merge suggestion(s) and merge ${aliasCount} duplicate item(s) into the selected kept items?`)) return;
  loading.value = true;
  try {
    let merged = 0;
    for (const suggestion of suggestions) {
      const canonicalId = duplicateCanonicalId(suggestion);
      for (const alias of suggestion.items.filter((item) => item.id !== canonicalId)) {
        await commands.mergeCatalogItem(suggestion.kind, alias.id, canonicalId);
        merged++;
      }
    }
    setMessage(`${merged} duplicate item(s) merged.`);
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

function encodeCatalogQrPayload(kind: CatalogKind, item: Food | Recipe | ActivityDefinition): string {
  const json = JSON.stringify({ app: 'nutrino', version: 1, kind, item });
  return `nutrino-catalog-v1:${btoa(unescape(encodeURIComponent(json)))}`;
}

async function showCatalogQr(kind: CatalogKind, item: Food | Recipe | ActivityDefinition, title: string) {
  try {
    const payload = encodeCatalogQrPayload(kind, item);
    const svg = await QRCode.toString(payload, { type: 'svg', margin: 1, width: 280 });
    qrDialog.value = { title, svg, payload };
  } catch (error) {
    setMessage(String(error));
  }
}

async function acceptInboxEntry(entry: SyncInboxEntry) {
  if (!window.confirm('Record this mobile upload on the server? Exact duplicates will be merged and aliases will sync back to mobile.')) return;
  loading.value = true;
  try {
    const result = await commands.acceptSyncInbox(entry.id);
    setMessage(`Mobile upload recorded. ${result.inserted_or_updated} items saved, ${result.merged} duplicates merged.`);
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function rejectInboxEntry(entry: SyncInboxEntry) {
  if (!window.confirm('Reject this mobile upload? The phone will keep its local data, but this server will not record this batch.')) return;
  loading.value = true;
  try {
    await commands.rejectSyncInbox(entry.id);
    setMessage('Mobile upload rejected.');
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

function openFoodModal(food?: Food) {
  if (food) {
    foodForm.value = {
      id: food.id,
      name: food.name,
      brand: food.brand ?? '',
      catalog_kind: food.catalog_kind === 'ingredient' ? 'ingredient' : 'food',
      note: food.note ?? '',
      barcode: food.barcode ?? '',
      default_unit: food.default_unit,
      serving_size_g: food.serving_size_g ?? null,
      kcal_per_100g: food.kcal_per_100g,
      carbs_per_100g: food.carbs_per_100g,
      fat_per_100g: food.fat_per_100g,
      protein_per_100g: food.protein_per_100g,
      sugars_per_100g: food.sugars_per_100g,
      fiber_per_100g: food.fiber_per_100g,
      salt_per_100g: food.salt_per_100g,
    };
  } else {
    foodForm.value = emptyFoodForm();
  }
  modal.value = 'food';
}

function openActivityModal(activity?: ActivityDefinition) {
  if (activity) {
    activityForm.value = {
      id: activity.id,
      code: activity.code,
      name: activity.name,
      description: activity.description ?? '',
      activity_type: activity.activity_type,
      met: activity.met,
      kcal_per_min: activity.kcal_per_min,
    };
  } else {
    activityForm.value = emptyActivityForm();
  }
  modal.value = 'activity';
}

function openRecipeModal(recipe?: RecipeDetail) {
  if (recipe) {
    recipeForm.value = {
      id: recipe.recipe.id,
      name: recipe.recipe.name,
      description: recipe.recipe.description ?? '',
      note: recipe.recipe.note ?? '',
      total_weight_g: recipe.recipe.total_weight_g ?? null,
      servings_count: recipe.recipe.servings_count ?? null,
      items: recipe.items.map((item) => ({ food_id: item.food_id, amount_g: item.amount_g })),
    };
  } else {
    recipeForm.value = emptyRecipeForm();
  }
  if (!recipeForm.value.items.length) addRecipeItem();
  recipeIngredientSearch.value = {};
  modal.value = 'recipe';
}

function requestCloseModal() {
  if (!modal.value || window.confirm('Close this data-entry panel without saving?')) {
    closeModal();
  }
}

function closeModal() {
  modal.value = null;
}

async function saveFood() {
  loading.value = true;
  try {
    await commands.saveFood({
      ...foodForm.value,
      brand: foodForm.value.catalog_kind === 'ingredient' ? null : foodForm.value.brand,
    });
    setMessage(editingFoodId.value ? 'Food updated.' : 'Food created.');
    closeModal();
    foodForm.value = emptyFoodForm();
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}


async function moveFoodCatalogKind(food: Food, catalogKind: 'food' | 'ingredient') {
  loading.value = true;
  try {
    await commands.saveFood({
      id: food.id,
      name: food.name,
      brand: catalogKind === 'ingredient' ? null : food.brand ?? null,
      catalog_kind: catalogKind,
      note: food.note ?? null,
      barcode: food.barcode ?? null,
      default_unit: food.default_unit,
      serving_size_g: food.serving_size_g ?? null,
      kcal_per_100g: food.kcal_per_100g,
      carbs_per_100g: food.carbs_per_100g,
      fat_per_100g: food.fat_per_100g,
      protein_per_100g: food.protein_per_100g,
      sugars_per_100g: food.sugars_per_100g,
      fiber_per_100g: food.fiber_per_100g,
      salt_per_100g: food.salt_per_100g,
    });
    setMessage(catalogKind === 'ingredient' ? 'Moved to ingredients.' : 'Moved to foods.');
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function removeFood(food: Food) {
  const confirmed = window.confirm(`Delete ${food.name}? Existing logs keep their snapshots, but this food will no longer be selectable.`);
  if (!confirmed) return;
  loading.value = true;
  try {
    await commands.deleteFood(food.id);
    setMessage('Food deleted.');
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}


function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function readCsvFile(event: Event): Promise<string | null> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return null;
  try {
    return await file.text();
  } finally {
    input.value = '';
  }
}

async function importFoodsFromFile(event: Event) {
  const text = await readCsvFile(event);
  if (!text) return;
  loading.value = true;
  try {
    const result = await commands.commitCsv(text, skipCsvDuplicates.value);
    setMessage(`Imported ${result.inserted_or_updated} foods. Skipped ${result.skipped}.`);
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function importRecipesFromFile(event: Event) {
  const text = await readCsvFile(event);
  if (!text) return;
  loading.value = true;
  try {
    const result = await commands.importRecipesCsv(text, skipCsvDuplicates.value);
    setMessage(`Imported ${result.inserted_or_updated} recipes. Skipped ${result.skipped}.`);
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function importActivitiesFromFile(event: Event) {
  const text = await readCsvFile(event);
  if (!text) return;
  loading.value = true;
  try {
    const result = await commands.importActivitiesCsv(text, skipCsvDuplicates.value);
    setMessage(`Imported ${result.inserted_or_updated} activities. Skipped ${result.skipped}.`);
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function exportFoods() {
  try {
    const text = await commands.exportFoodsCsv();
    downloadCsv(`nutrino-foods-${new Date().toISOString().slice(0, 10)}.csv`, text);
    setMessage('Foods CSV exported.');
  } catch (error) {
    setMessage(String(error));
  }
}


function addRecipeItem() {
  recipeForm.value.items.push({ food_id: recipeCatalogItems.value[0]?.id ?? '', amount_g: 100 });
}

function removeRecipeItem(index: number) {
  recipeForm.value.items.splice(index, 1);
  if (!recipeForm.value.items.length) addRecipeItem();
}

function selectedFood(item: RecipeInputItem) {
  return recipeCatalogItems.value.find((food) => food.id === item.food_id) ?? null;
}

function recipeItemServingSize(item: RecipeInputItem) {
  const servingSize = Number(selectedFood(item)?.serving_size_g || 0);
  return Number.isFinite(servingSize) && servingSize > 0 ? servingSize : 0;
}

function recipeItemPieces(item: RecipeInputItem) {
  const servingSize = recipeItemServingSize(item);
  const amount = Number(item.amount_g || 0);
  if (!servingSize || !Number.isFinite(amount) || amount <= 0) return '';
  return Math.round((amount / servingSize) * 100) / 100;
}

function setRecipeItemPieces(item: RecipeInputItem, event: Event) {
  const servingSize = recipeItemServingSize(item);
  const target = event.target as HTMLInputElement | null;
  const pieces = Number(target?.value ?? 0);
  if (!servingSize || !Number.isFinite(pieces)) return;
  item.amount_g = Math.max(0, Math.round(pieces * servingSize * 10) / 10);
}

function onRecipeItemFoodChange(item: RecipeInputItem) {
  const servingSize = recipeItemServingSize(item);
  if (servingSize && (!Number.isFinite(Number(item.amount_g)) || Number(item.amount_g) <= 0 || Number(item.amount_g) === 100)) {
    item.amount_g = Math.round(servingSize * 10) / 10;
  }
}

function recipeItemServingLabel(item: RecipeInputItem) {
  const servingSize = recipeItemServingSize(item);
  return servingSize ? `${round(servingSize)} g / db` : 'Only grams available for this food';
}

const recipeFormNutrition = computed(() => {
  let totalWeight = 0;
  let kcal = 0;
  let carbs = 0;
  let fat = 0;
  let protein = 0;

  for (const item of recipeForm.value.items) {
    const food = selectedFood(item);
    if (!food || !item.amount_g) continue;
    totalWeight += item.amount_g;
    kcal += food.kcal_per_100g * item.amount_g / 100;
    carbs += food.carbs_per_100g * item.amount_g / 100;
    fat += food.fat_per_100g * item.amount_g / 100;
    protein += food.protein_per_100g * item.amount_g / 100;
  }

  const finishedWeight = Number(recipeForm.value.total_weight_g || 0) > 0 ? Number(recipeForm.value.total_weight_g) : totalWeight;
  const ratio = finishedWeight > 0 ? 100 / finishedWeight : 0;
  return {
    totalWeight: finishedWeight,
    kcalTotal: kcal,
    kcalPer100g: kcal * ratio,
    carbsPer100g: carbs * ratio,
    fatPer100g: fat * ratio,
    proteinPer100g: protein * ratio,
  };
});

async function saveRecipe() {
  loading.value = true;
  try {
    await commands.saveRecipe({
      ...recipeForm.value,
      items: recipeForm.value.items.filter((item) => item.food_id && item.amount_g > 0),
    });
    setMessage(editingRecipeId.value ? 'Recipe updated.' : 'Recipe created.');
    closeModal();
    recipeForm.value = emptyRecipeForm();
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function removeRecipe(recipe: RecipeDetail) {
  const confirmed = window.confirm(`Delete recipe ${recipe.recipe.name}?`);
  if (!confirmed) return;
  loading.value = true;
  try {
    await commands.deleteRecipe(recipe.recipe.id);
    setMessage('Recipe deleted.');
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function saveActivity() {
  loading.value = true;
  try {
    await commands.saveActivity(activityForm.value);
    setMessage(editingActivityId.value ? 'Activity updated.' : 'Activity created.');
    closeModal();
    activityForm.value = emptyActivityForm();
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function removeActivity(activity: ActivityDefinition) {
  const confirmed = window.confirm(`Delete activity ${activity.name}?`);
  if (!confirmed) return;
  loading.value = true;
  try {
    await commands.deleteActivity(activity.id);
    setMessage('Activity deleted.');
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

const filteredActivities = computed(() => {
  const q = activityQuery.value.trim().toLowerCase();
  if (!q) return activities.value;
  return activities.value.filter((activity) => [activity.name, activity.description ?? '', activity.activity_type, activity.code]
    .join(' ')
    .toLowerCase()
    .includes(q));
});


function recipeDetailAsCatalogItem(detail: RecipeDetail): RecipeCatalogItem {
  const totalWeight = detail.recipe.total_weight_g && detail.recipe.total_weight_g > 0 ? detail.recipe.total_weight_g : detail.nutrition.total_weight_g;
  const serving = detail.recipe.servings_count && detail.recipe.servings_count > 0 && totalWeight > 0 ? totalWeight / detail.recipe.servings_count : null;
  return {
    id: `recipe:${detail.recipe.id}`,
    source_id: detail.recipe.source_id,
    name: detail.recipe.name,
    brand: 'Recipe',
    catalog_kind: 'food',
    note: detail.recipe.note ?? detail.recipe.description ?? null,
    barcode: null,
    default_unit: serving ? 'serving' : 'g',
    serving_size_g: serving,
    kcal_per_100g: detail.nutrition.kcal_per_100g,
    carbs_per_100g: detail.nutrition.carbs_per_100g,
    fat_per_100g: detail.nutrition.fat_per_100g,
    protein_per_100g: detail.nutrition.protein_per_100g,
    sugars_per_100g: 0,
    fiber_per_100g: 0,
    salt_per_100g: 0,
    updated_at: detail.recipe.updated_at,
    deleted_at: detail.recipe.deleted_at,
    catalog_source: 'recipe',
  };
}

const recipeCatalogItems = computed<RecipeCatalogItem[]>(() => [
  ...foods.value.map((food) => ({ ...food, catalog_source: 'food' as const })),
  ...recipes.value
    .filter((detail) => detail.recipe.id !== editingRecipeId.value)
    .map(recipeDetailAsCatalogItem),
].sort((a, b) => a.name.localeCompare(b.name)));

function recipeIngredientOptions(index: number): RecipeCatalogItem[] {
  const q = String(recipeIngredientSearch.value[index] || '').trim().toLowerCase();
  if (!q) return recipeCatalogItems.value;
  return recipeCatalogItems.value.filter((item) => `${item.name} ${item.brand ?? ''} ${item.note ?? ''} ${item.id}`.toLowerCase().includes(q));
}

function recipeIngredientLabel(item: RecipeCatalogItem): string {
  if (item.catalog_source === 'recipe') return `Recipe · ${item.name}`;
  return `${foodKindLabel(item)} · ${item.name}${item.brand ? ` · ${item.brand}` : ''}`;
}

const groupedActivities = computed(() => {
  const groups = new Map<string, ActivityDefinition[]>();
  for (const activity of filteredActivities.value) {
    const key = activity.activity_type || 'custom';
    groups.set(key, [...(groups.get(key) ?? []), activity]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
});

async function exportRecipes() {
  try {
    const text = await commands.exportRecipesCsv();
    downloadCsv(`nutrino-recipes-${new Date().toISOString().slice(0, 10)}.csv`, text);
    setMessage('Recipes CSV exported.');
  } catch (error) { setMessage(String(error)); }
}


async function exportActivities() {
  try {
    const text = await commands.exportActivitiesCsv();
    downloadCsv(`nutrino-activities-${new Date().toISOString().slice(0, 10)}.csv`, text);
    setMessage('Activities CSV exported.');
  } catch (error) { setMessage(String(error)); }
}


async function toggleSetting(key: keyof DesktopSettings) {
  if (!settings.value || typeof settings.value[key] !== 'boolean') return;
  const next = { ...settings.value, [key]: !settings.value[key] } as DesktopSettings;
  try {
    settings.value = await commands.saveDesktopSettings(next);
    setMessage('Settings saved.');
  } catch (error) { setMessage(String(error)); }
}

async function rememberWindowNow() {
  try {
    settings.value = await commands.rememberCurrentWindow();
    setMessage('Current window position and size saved.');
  } catch (error) { setMessage(String(error)); }
}


function timestampForBackupName(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function desktopBackupFileName() {
  return `nutrino-desktop-server-v${appVersion}-${timestampForBackupName()}.zip`;
}

function normalizeZipBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('This is not a valid nutrino desktop server backup.');
}

function assertValidZipBytes(bytes: Uint8Array) {
  if (!bytes.length) throw new Error('The backup ZIP is empty (0 B).');
  if (bytes.length < 22) throw new Error('This is not a valid nutrino desktop server backup.');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('This is not a valid nutrino desktop server backup.');
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function collectDesktopLocalStorage(): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith('nutrino.desktop.')) continue;
    const value = localStorage.getItem(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

function restoreDesktopLocalStorage(values?: Record<string, string>) {
  if (!values) return;
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('nutrino.desktop.')) localStorage.setItem(key, String(value));
  }
}

async function buildDesktopBackupZip() {
  await refreshAll();
  const zip = new JSZip();
  const exportedAt = new Date().toISOString();
  zip.file('manifest.json', JSON.stringify({
    app: 'nutrino',
    formatVersion: 1,
    exportType: 'desktop-server',
    version: appVersion,
    exportedAt,
  }, null, 2));
  zip.file('desktop-server-data.json', JSON.stringify({
    settings: settings.value,
    server: status.value,
    serverPassword: serverPassword.value || status.value?.token || '',
    desktopLocalStorage: collectDesktopLocalStorage(),
    foods: foods.value,
    recipes: recipes.value,
    activities: activities.value,
  }, null, 2));
  zip.file('README.txt', `nutrino desktop server backup\nVersion: ${appVersion}\nExported at: ${exportedAt}\nThis ZIP was validated before export.\n`);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  assertValidZipBytes(bytes);
  return bytes;
}

function fallbackDownloadDataZip(bytes: Uint8Array) {
  const blob = new Blob([bytesToArrayBuffer(bytes)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = desktopBackupFileName();
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportAppDataZip() {
  loading.value = true;
  try {
    const bytes = await buildDesktopBackupZip();
    const path = await save({ defaultPath: desktopBackupFileName(), filters: [{ name: 'nutrino desktop server backup', extensions: ['zip'] }] });
    if (!path) return setMessage('Export canceled.');
    await writeFile(path, bytes);
    try {
      const savedBytes = normalizeZipBytes(await readFile(path));
      assertValidZipBytes(savedBytes);
      if (savedBytes.length !== bytes.length) throw new Error(`Export verification size mismatch: ${formatBytes(savedBytes.length)} / ${formatBytes(bytes.length)}`);
      setMessage(`Desktop server data exported. (${formatBytes(bytes.length)})`);
    } catch (verifyError) {
      fallbackDownloadDataZip(bytes);
      setMessage(`External ZIP export could not be verified; browser download fallback was attempted. ${String(verifyError)}`);
    }
  } catch (error) {
    try {
      const bytes = await buildDesktopBackupZip();
      fallbackDownloadDataZip(bytes);
      setMessage(`Desktop server data exported with browser fallback. (${formatBytes(bytes.length)})`);
    } catch (fallbackError) {
      setMessage(String(fallbackError));
    }
  } finally {
    loading.value = false;
  }
}


async function importAppDataZip() {
  loading.value = true;
  try {
    const selected = await open({ multiple: false, filters: [{ name: 'nutrino desktop server backup', extensions: ['zip'] }] });
    if (!selected || Array.isArray(selected)) return setMessage('Import canceled.');
    const bytes = normalizeZipBytes(await readFile(selected));
    assertValidZipBytes(bytes);
    const zip = await JSZip.loadAsync(bytes);
    const manifestText = await zip.file('manifest.json')?.async('string');
    const dataText = await zip.file('desktop-server-data.json')?.async('string');
    if (!manifestText || !dataText) throw new Error('This is not a valid nutrino desktop server backup.');
    const manifest = JSON.parse(manifestText) as { app?: string; formatVersion?: number; exportType?: string };
    if (manifest.app !== 'nutrino' || manifest.formatVersion !== 1 || manifest.exportType !== 'desktop-server') {
      throw new Error('This is not a valid nutrino desktop server backup.');
    }
    if (!window.confirm('This backup will overwrite the current desktop server catalog and settings. Continue?')) {
      return setMessage('Import canceled.');
    }
    const data = JSON.parse(dataText) as {
      settings?: DesktopSettings;
      serverPassword?: string;
      desktopLocalStorage?: Record<string, string>;
      foods?: Food[];
      recipes?: RecipeDetail[];
      activities?: ActivityDefinition[];
    };
    const currentRecipes = await commands.listRecipes();
    for (const recipe of currentRecipes) await commands.deleteRecipe(recipe.recipe.id);
    const currentActivities = await commands.listActivities();
    for (const activity of currentActivities) await commands.deleteActivity(activity.id);
    const currentFoods = await commands.listFoods();
    for (const food of currentFoods) await commands.deleteFood(food.id);
    restoreDesktopLocalStorage(data.desktopLocalStorage);
    if (typeof data.serverPassword === 'string') await commands.setServerPassword(data.serverPassword);
    if (data.settings) await commands.saveDesktopSettings(data.settings);
    for (const food of data.foods ?? []) {
      await commands.saveFood({
        id: food.id,
        name: food.name,
        brand: food.brand ?? '',
        note: food.note ?? '',
        default_unit: food.default_unit,
        serving_size_g: food.serving_size_g ?? null,
        kcal_per_100g: food.kcal_per_100g,
        carbs_per_100g: food.carbs_per_100g,
        fat_per_100g: food.fat_per_100g,
        protein_per_100g: food.protein_per_100g,
        sugars_per_100g: food.sugars_per_100g,
        fiber_per_100g: food.fiber_per_100g,
        salt_per_100g: food.salt_per_100g,
      });
    }
    for (const activity of data.activities ?? []) {
      await commands.saveActivity({
        id: activity.id,
        code: activity.code,
        name: activity.name,
        description: activity.description ?? '',
        activity_type: activity.activity_type,
        met: activity.met,
        kcal_per_min: activity.kcal_per_min,
      });
    }
    for (const detail of data.recipes ?? []) {
      await commands.saveRecipe({
        id: detail.recipe.id,
        name: detail.recipe.name,
        description: detail.recipe.description ?? '',
        note: detail.recipe.note ?? '',
        total_weight_g: detail.recipe.total_weight_g ?? null,
        servings_count: detail.recipe.servings_count ?? null,
        items: detail.items.map((item) => ({ food_id: item.food_id, amount_g: item.amount_g })),
      });
    }
    await refreshAll();
    if (onboardingOpen.value) {
      localStorage.setItem(desktopOnboardingKey, '1');
      onboardingOpen.value = false;
      onboardingStep.value = 0;
    }
    setMessage('Desktop server data imported.');
  } catch (error) {
    setMessage(`Import failed: ${String(error)}`);
  } finally {
    loading.value = false;
  }
}


async function initializeDesktop() {
  await refreshAll();
  onboardingPort.value = port.value;
  if (!localStorage.getItem(desktopOnboardingKey)) onboardingOpen.value = true;
}

async function finishDesktopOnboarding() {
  port.value = Number(onboardingPort.value) || 8090;
  serverPassword.value = onboardingPassword.value.trim();
  await commands.setServerPassword(serverPassword.value);
  localStorage.setItem(desktopOnboardingKey, '1');
  onboardingOpen.value = false;
  onboardingStep.value = 0;
  await refreshAll();
  setMessage('Desktop setup saved. Start the LAN API server when you are ready to pair mobile.');
}

async function factoryResetDesktop() {
  if (!window.confirm('Factory reset deletes the desktop food, recipe and activity catalog, settings and onboarding state. Continue?')) return;
  loading.value = true;
  try {
    const currentRecipes = await commands.listRecipes();
    for (const recipe of currentRecipes) await commands.deleteRecipe(recipe.recipe.id);
    const currentActivities = await commands.listActivities();
    for (const activity of currentActivities) await commands.deleteActivity(activity.id);
    const currentFoods = await commands.listFoods();
    for (const food of currentFoods) await commands.deleteFood(food.id);
    await commands.setServerPassword('');
    await commands.saveDesktopSettings({
      remember_window_state: false,
      launch_at_startup: false,
      run_in_background: false,
      auto_start_server: false,
      close_to_tray: false,
      start_hidden_to_tray: false,
      window_x: null,
      window_y: null,
      window_width: null,
      window_height: null,
    });
    localStorage.removeItem(desktopOnboardingKey);
    await refreshAll();
    onboardingOpen.value = true;
    onboardingStep.value = 0;
    setMessage('Factory reset complete.');
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

onMounted(initializeDesktop);

onBeforeUnmount(() => {
  if (messageTimer) window.clearTimeout(messageTimer);
});
</script>

<template>
  <main class="desktop-shell min-h-screen text-neutral-900">
    <header class="app-header px-4 py-4 md:px-8">
      <div class="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="flex items-center gap-3">
          <div class="app-logo" v-html="nutrinoLogoSvg"></div>
          <div>
            <p class="text-sm font-semibold uppercase tracking-[0.25em] text-nutri-700">nutrino · {{ appChannel }}</p>
            <h1 class="text-2xl font-bold md:text-3xl">{{ appName }}</h1>
          </div>
        </div>
        <div class="server-pill" :class="serverRunning ? 'server-pill-running' : 'server-pill-stopped'">
          <span class="server-dot" />
          <span class="font-semibold">Status:</span>
          <span>{{ serverRunning ? 'API running' : 'API stopped' }}</span>
        </div>
      </div>
    </header>

    <div class="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8">
      <aside class="card h-fit">
        <nav class="grid gap-2 sm:grid-cols-5 lg:grid-cols-1">
          <button v-for="item in navigation" :key="item.key" class="nav-button" :class="tab === item.key ? 'nav-button-active' : ''" @click="tab = item.key">
            <span class="nav-icon" v-html="icon(item.icon, tab === item.key)"></span>
            <span>{{ item.label }}</span>
          </button>
        </nav>
      </aside>

      <section class="min-w-0 space-y-6">
        <p v-if="message" class="message-card">{{ message }}</p>

        <div v-if="tab === 'dashboard'" class="space-y-5">
          <article class="desktop-home-card">
            <div class="desktop-home-copy">
              <p class="desktop-kicker">nutrino Desktop Server</p>
              <h2>{{ serverRunning ? 'LAN API running' : 'LAN API stopped' }}</h2>
              <p>{{ serverRunning ? 'Your mobile app can sync the catalog from this computer.' : 'Start the server to pair or refresh the mobile catalog.' }}</p>
              <code>{{ apiDisplay }}</code>
            </div>
            <div class="desktop-mobile-gauge" :class="serverRunning ? 'online' : 'offline'">
              <svg viewBox="0 0 220 180" aria-hidden="true">
                <path class="gauge-track" d="M36 128a76 76 0 1 1 148 0" />
                <path class="gauge-value" d="M36 128a76 76 0 1 1 148 0" />
              </svg>
              <div class="desktop-gauge-center"><b>{{ serverRunning ? 'Online' : 'Offline' }}</b><small>LAN API</small></div>
              <span class="port-chip">Port {{ port }}</span>
            </div>
          </article>
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article class="metric-card"><span class="inline-svg" v-html="icon('foods')"></span><p>Foods</p><strong>{{ totalPreparedFoods }}</strong></article>
            <article class="metric-card"><span class="inline-svg" v-html="icon('foods')"></span><p>Ingredients</p><strong>{{ totalIngredients }}</strong></article>
            <article class="metric-card"><span class="inline-svg" v-html="icon('recipes')"></span><p>Recipes</p><strong>{{ totalRecipes }}</strong></article>
            <article class="metric-card"><span class="inline-svg" v-html="icon('activities')"></span><p>Activities</p><strong>{{ totalActivities }}</strong></article>
            <article class="metric-card"><span class="inline-svg" v-html="icon('dashboard')"></span><p>Average kcal / 100g</p><strong>{{ avgKcal }}</strong></article>
          </div>
          <article class="card">
            <h2 class="text-xl font-bold">Offline-first local architecture</h2>
            <p class="mt-3 text-neutral-600">This desktop app owns the food catalog, recipe catalog, activity catalog and LAN API. Mobile syncs the catalog, then keeps working from its local cache whenever the desktop server is unavailable.</p><div class="catalog-freshness-row mt-3"><span>Foods: {{ formatFreshness(latestFoodUpdatedAt) }}</span><span>Recipes: {{ formatFreshness(latestRecipeUpdatedAt) }}</span><span>Activities: {{ formatFreshness(latestActivityUpdatedAt) }}</span></div>
          </article>
        </div>

        <div v-if="tab === 'foods'" class="space-y-4">
          <div class="section-toolbar">
            <div>
              <h2 class="section-title">Foods</h2>
              <p class="section-subtitle">Create, edit, delete, import and export your local food catalog.</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button class="btn-secondary icon-button" @click="refreshAll"><span class="inline-svg" v-html="icon('refresh')"></span>Refresh</button>
              <label class="btn-secondary icon-button file-action"><span class="inline-svg" v-html="icon('import')"></span>Import CSV<input type="file" accept=".csv,text/csv" @change="importFoodsFromFile" /></label><label class="csv-skip-toggle"><input v-model="skipCsvDuplicates" type="checkbox" /> Skip duplicates</label>
              <button class="btn-secondary icon-button" @click="exportFoods"><span class="inline-svg" v-html="icon('export')"></span>Export CSV</button>
              <button class="btn-primary icon-button" @click="openFoodModal()"><span class="inline-svg" v-html="icon('add')"></span>Add food</button>
            </div>
          </div>
          <article class="card catalog-controls">
            <input v-model="foodQuery" class="input" placeholder="Search foods by name, brand, barcode, note or ID..." />
            <select v-model="foodSort" class="input"><option value="name">Sort by name</option><option value="kcal">Sort by kcal</option><option value="protein">Sort by protein</option><option value="carbs">Sort by carbs</option><option value="fat">Sort by fat</option></select>
          </article>
          <article class="card csv-format-card">
            <div>
              <h3 class="text-lg font-bold">Food CSV structure</h3>
              <p class="muted">Import files must use this header row. Starter/sample foods are intentionally not bundled into the app.</p>
            </div>
            <code class="csv-header-code">{{ foodCsvHeader }}</code>
            <ul class="csv-note-list"><li v-for="note in csvImportNotes.slice(0, 3)" :key="note">{{ note }}</li></ul>
          </article>
          <article class="card min-w-0">
            <div class="overflow-auto table-wrap">
              <table class="min-w-[820px] w-full border-collapse">
                <thead>
                  <tr><th>Name</th><th>ID</th><th>kcal</th><th>Carbs</th><th>Fat</th><th>Protein</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  <tr v-for="food in sortedFoods" :key="food.id">
                    <td><strong>{{ food.name }}</strong><br /><span class="muted">{{ foodKindLabel(food) }} · {{ food.brand || 'No brand' }}</span><small v-if="food.note" class="block muted">{{ food.note }}</small></td>
                    <td class="font-mono text-xs">{{ food.id }}</td>
                    <td>{{ round(food.kcal_per_100g) }}</td>
                    <td>{{ round(food.carbs_per_100g) }}g</td>
                    <td>{{ round(food.fat_per_100g) }}g</td>
                    <td>{{ round(food.protein_per_100g) }}g</td>
                    <td>
                      <button class="link-button icon-only-label" @click="openFoodModal(food)"><span class="inline-svg" v-html="icon('edit')"></span>Edit</button>
                      <button class="link-button icon-only-label" @click="mergeCatalogInto('food', food.id, food.name)"><span class="inline-svg" v-html="icon('refresh')"></span>Merge into</button><button v-if="food.catalog_kind !== 'ingredient'" class="link-button icon-only-label" @click="moveFoodCatalogKind(food, 'ingredient')">Move to ingredients</button><button v-else class="link-button icon-only-label" @click="moveFoodCatalogKind(food, 'food')">Move to foods</button><button class="link-button icon-only-label" @click="showCatalogQr('food', food, food.name)"><span class="inline-svg" v-html="icon('qrCode')"></span>QR</button>
                      <button class="link-button danger icon-only-label" @click="removeFood(food)"><span class="inline-svg" v-html="icon('trash')"></span>Delete</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <div v-if="tab === 'recipes'" class="space-y-4">
          <div class="section-toolbar">
            <div>
              <h2 class="section-title">Recipes</h2>
              <p class="section-subtitle">Build reusable meals from foods. Nutrition is calculated from ingredients.</p>
            </div>
            <div class="flex flex-wrap gap-2"><label class="btn-secondary icon-button file-action"><span class="inline-svg" v-html="icon('import')"></span>Import CSV<input type="file" accept=".csv,text/csv" @change="importRecipesFromFile" /></label><label class="csv-skip-toggle"><input v-model="skipCsvDuplicates" type="checkbox" /> Skip duplicates</label><button class="btn-secondary icon-button" @click="exportRecipes"><span class="inline-svg" v-html="icon('export')"></span>Export CSV</button><button class="btn-primary icon-button" @click="openRecipeModal()"><span class="inline-svg" v-html="icon('add')"></span>Add recipe</button></div>
          </div>
          <article class="card catalog-controls">
            <input v-model="recipeQuery" class="input" placeholder="Search recipes by name, description, note or ID..." />
            <select v-model="recipeSort" class="input"><option value="name">Sort by name</option><option value="kcal">Sort by kcal</option><option value="protein">Sort by protein</option><option value="carbs">Sort by carbs</option><option value="fat">Sort by fat</option></select>
          </article>
          <article class="card csv-format-card">
            <div>
              <h3 class="text-lg font-bold">Recipe CSV structure</h3>
              <p class="muted">Recipes are imported from a header-only schema plus your own rows. Ingredients stay gram-based in storage.</p>
            </div>
            <code class="csv-header-code">{{ recipeCsvHeader }}</code>
            <ul class="csv-note-list"><li v-for="note in csvImportNotes" :key="note">{{ note }}</li></ul>
          </article>
          <div class="grid gap-4 xl:grid-cols-2">
            <article v-for="recipe in sortedRecipes" :key="recipe.recipe.id" class="card">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 class="text-lg font-bold">{{ recipe.recipe.name }}</h3>
                  <p class="muted">{{ recipe.recipe.description || 'No description' }}</p><small v-if="recipe.recipe.note" class="block muted">{{ recipe.recipe.note }}</small>
                </div>
                <div class="flex gap-2">
                  <button class="link-button icon-only-label" @click="openRecipeModal(recipe)"><span class="inline-svg" v-html="icon('edit')"></span>Edit</button>
                  <button class="link-button icon-only-label" @click="mergeCatalogInto('recipe', recipe.recipe.id, recipe.recipe.name)"><span class="inline-svg" v-html="icon('refresh')"></span>Merge into</button><button class="link-button icon-only-label" @click="showCatalogQr('recipe', recipe.recipe, recipe.recipe.name)"><span class="inline-svg" v-html="icon('qrCode')"></span>QR</button>
                  <button class="link-button danger icon-only-label" @click="removeRecipe(recipe)"><span class="inline-svg" v-html="icon('trash')"></span>Delete</button>
                </div>
              </div>
              <div class="mt-4 grid grid-cols-4 gap-2 text-center text-sm">
                <div class="mini-stat"><strong>{{ round(recipe.nutrition.kcal_per_100g) }}</strong><span>kcal</span></div>
                <div class="mini-stat"><strong>{{ round(recipe.nutrition.carbs_per_100g) }}g</strong><span>carbs</span></div>
                <div class="mini-stat"><strong>{{ round(recipe.nutrition.fat_per_100g) }}g</strong><span>fat</span></div>
                <div class="mini-stat"><strong>{{ round(recipe.nutrition.protein_per_100g) }}g</strong><span>protein</span></div>
              </div>
              <ul class="mt-4 space-y-2 text-sm">
                <li v-for="item in recipe.items" :key="item.id" class="flex justify-between gap-3 rounded-xl bg-soft px-3 py-2">
                  <span>{{ item.food_name }}</span><strong>{{ round(item.amount_g) }}g</strong>
                </li>
              </ul>
            </article>
          </div>
        </div>

        <div v-if="tab === 'activities'" class="space-y-4">
          <div class="section-toolbar">
            <div>
              <h2 class="section-title">Activities</h2>
              <p class="section-subtitle">OpenNutriTracker activity catalog with editable MET and kcal/min values.</p>
            </div>
            <div class="flex flex-wrap gap-2"><label class="btn-secondary icon-button file-action"><span class="inline-svg" v-html="icon('import')"></span>Import CSV<input type="file" accept=".csv,text/csv" @change="importActivitiesFromFile" /></label><label class="csv-skip-toggle"><input v-model="skipCsvDuplicates" type="checkbox" /> Skip duplicates</label><button class="btn-secondary icon-button" @click="exportActivities"><span class="inline-svg" v-html="icon('export')"></span>Export CSV</button><button class="btn-primary icon-button" @click="openActivityModal()"><span class="inline-svg" v-html="icon('add')"></span>Add activity</button></div>
          </div>
          <article class="card">
            <input v-model="activityQuery" class="input" placeholder="Search activity, type, code..." />
          </article>
          <article class="card csv-format-card">
            <div>
              <h3 class="text-lg font-bold">Activity CSV structure</h3>
              <p class="muted">Use this header row for activity imports. kcal/min is optional when MET is available.</p>
            </div>
            <code class="csv-header-code">{{ activityCsvHeader }}</code>
            <ul class="csv-note-list"><li v-for="note in csvImportNotes.slice(0, 3)" :key="note">{{ note }}</li></ul>
          </article>
          <section v-for="[group, items] in groupedActivities" :key="group" class="card">
            <div class="mb-4 flex items-center gap-3">
              <span class="activity-group-icon" v-html="activityIcon(group)"></span>
              <div><h3 class="text-lg font-bold">{{ typeLabel(group) }}</h3><p class="muted">{{ items.length }} activities</p></div>
            </div>
            <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <article v-for="activity in items" :key="activity.id" class="activity-card">
                <div class="flex items-start gap-3">
                  <span class="activity-icon" v-html="activityIcon(activity.activity_type)"></span>
                  <div class="min-w-0 flex-1">
                    <h4 class="font-bold">{{ activity.name }}</h4>
                    <p class="muted text-sm">{{ activity.description || 'No description' }}</p>
                    <p class="mt-2 text-xs font-bold uppercase tracking-wide text-nutri-700">Code {{ activity.code }} · MET {{ round(activity.met) }} · {{ round(activity.kcal_per_min) }} kcal/min</p>
                  </div>
                </div>
                <div class="mt-3 flex gap-2">
                  <button class="link-button icon-only-label" @click="openActivityModal(activity)"><span class="inline-svg" v-html="icon('edit')"></span>Edit</button>
                  <button class="link-button icon-only-label" @click="mergeCatalogInto('activity', activity.id, activity.name)"><span class="inline-svg" v-html="icon('refresh')"></span>Merge into</button><button class="link-button icon-only-label" @click="showCatalogQr('activity', activity, activity.name)"><span class="inline-svg" v-html="icon('qrCode')"></span>QR</button>
                  <button class="link-button danger icon-only-label" @click="removeActivity(activity)"><span class="inline-svg" v-html="icon('trash')"></span>Delete</button>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div v-if="tab === 'server'" class="grid gap-6 xl:grid-cols-2">
          <article class="card">
            <h2 class="text-xl font-bold">LAN API server</h2>
            <p class="mt-2 muted">Set an optional server password. If it is empty, mobile can sync on your LAN without auth; if set, mobile must use the same password.</p>
            <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end">
              <div><label class="field-label">Port</label><input v-model.number="port" class="input mt-1" type="number" min="1024" /></div>
              <div><label class="field-label">Server password</label><input v-model="serverPassword" class="input mt-1" type="password" autocomplete="new-password" placeholder="Leave empty for no password" /></div>
              <button class="btn-primary" :disabled="loading || serverRunning" @click="startServer">Start</button>
              <button class="btn-secondary" :disabled="loading || !serverRunning" @click="stopServer">Stop</button>
              <button class="btn-secondary" :disabled="loading" @click="saveServerPassword">Save password</button>
              <button class="btn-secondary" :disabled="loading || serverRunning" @click="importAppDataZip">Restore backup</button>
            </div>
          </article>
          <article class="card min-w-0">
            <h2 class="text-xl font-bold">Pairing details</h2>
            <dl class="mt-4 space-y-3 text-sm">
              <div><dt class="field-label">Base URL</dt><dd class="break-api-url font-mono font-bold">{{ apiDisplay }}</dd></div>
              <div><dt class="field-label">Source ID</dt><dd class="break-api-url font-mono">{{ status?.source_id }}</dd></div>
              <div><dt class="field-label">Auth</dt><dd>{{ status?.auth_required ? 'Password required' : 'No password required' }}</dd></div>
              <div><dt class="field-label">Channel</dt><dd>{{ status?.app_channel ?? appChannel }}</dd></div>
            </dl>
          </article>
        </div>


        <section v-if="tab === 'server'" class="card mt-6 duplicate-suggestions-panel">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-xl font-bold">Merge suggestions</h2>
              <p class="mt-2 muted">Nutrino can list likely duplicate foods, recipes and activities before any sync is involved. Choose which item should stay, then merge the rest into it, or open an item and rename it if it is only badly named.</p>
            </div>
            <button class="btn-secondary" :disabled="loading" @click="refreshAll">Refresh</button><button class="btn-primary" :disabled="loading || !duplicateSuggestions.length" @click="mergeAllDuplicateSuggestions">Merge all selected</button>
          </div>
          <div v-if="!duplicateSuggestions.length" class="empty-state mt-4">No likely duplicate catalog items found.</div>
          <div v-else class="duplicate-suggestion-grid mt-4">
            <article v-for="suggestion in duplicateSuggestions" :key="duplicateSuggestionKey(suggestion)" class="duplicate-suggestion-card">
              <div class="duplicate-suggestion-head">
                <div>
                  <p class="desktop-kicker">{{ suggestion.kind }} · {{ suggestion.confidence }} confidence · {{ suggestion.score }}%</p>
                  <h3>{{ suggestion.reason }}</h3>
                </div>
                <button class="btn-primary" :disabled="loading" @click="mergeDuplicateSuggestion(suggestion)">Merge selected</button>
              </div>
              <div class="duplicate-item-list">
                <label v-for="item in suggestion.items" :key="item.id" class="duplicate-item-row" :class="duplicateCanonicalId(suggestion) === item.id ? 'duplicate-item-kept' : ''">
                  <input type="radio" :name="duplicateSuggestionKey(suggestion)" :checked="duplicateCanonicalId(suggestion) === item.id" @change="setDuplicateCanonical(suggestion, item.id)" />
                  <span class="duplicate-item-copy">
                    <b>{{ item.name }}</b>
                    <small>{{ item.subtitle }}</small>
                    <code>{{ item.id }}</code>
                  </span>
                  <button type="button" class="link-button" @click.prevent="editDuplicateItem(suggestion.kind, item.id)">Edit</button>
                </label>
              </div>
            </article>
          </div>
        </section>

        <section v-if="tab === 'server'" class="card mt-6">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-xl font-bold">Mobile upload inbox</h2>
              <p class="mt-2 muted">Uploads sent from mobile are staged here first. Accept a batch to record it on the server. Exact duplicate foods, recipes and activities are merged as aliases, so old diary entries on mobile continue to resolve to the canonical server item.</p>
            </div>
            <button class="btn-secondary" :disabled="loading" @click="refreshAll">Refresh</button>
          </div>
          <div v-if="!syncInbox.length" class="empty-state mt-4">No pending mobile uploads.</div>
          <div v-else class="mt-4 grid gap-3">
            <article v-for="entry in syncInbox" :key="entry.id" class="sync-inbox-card">
              <div class="sync-inbox-head">
                <div>
                  <b>{{ entry.device_name || entry.source_id }}</b>
                  <small>{{ formatDateTime(entry.received_at) }} · {{ syncInboxSummary(entry) }}</small>
                </div>
                <div class="flex gap-2">
                  <button class="btn-secondary" :disabled="loading" @click="openInboxReview(entry)">Review/edit</button>
                  <button class="btn-primary" :disabled="loading" @click="acceptInboxEntry(entry)">Record</button>
                  <button class="btn-secondary" :disabled="loading" @click="rejectInboxEntry(entry)">Reject</button>
                </div>
              </div>
              <div class="sync-payload-preview">
                <span v-if="inboxPayloadCount(entry.payload, 'foods')">{{ inboxPayloadCount(entry.payload, 'foods') }} foods</span>
                <span v-if="inboxPayloadCount(entry.payload, 'recipes')">{{ inboxPayloadCount(entry.payload, 'recipes') }} recipes</span>
                <span v-if="inboxPayloadCount(entry.payload, 'activities')">{{ inboxPayloadCount(entry.payload, 'activities') }} activities</span>
                <span v-if="inboxPayloadCount(entry.payload, 'intakes')">{{ inboxPayloadCount(entry.payload, 'intakes') }} meal/note entries</span>
                <span v-if="inboxPayloadCount(entry.payload, 'activity_logs')">{{ inboxPayloadCount(entry.payload, 'activity_logs') }} activity logs</span>
              </div>
              <div v-if="entry.merge_candidates.length" class="merge-candidate-list">
                <p class="field-label">Exact duplicate merge suggestions</p>
                <div v-for="candidate in entry.merge_candidates" :key="`${candidate.kind}:${candidate.incoming_id}`" class="merge-candidate-row">
                  <span>{{ candidate.kind }} · <b>{{ candidate.incoming_name }}</b></span>
                  <small>{{ candidate.incoming_id }} → {{ candidate.canonical_name }} / {{ candidate.canonical_id }}</small>
                </div>
              </div>
            </article>
          </div>
        </section>


        <div v-if="tab === 'settings'" class="desktop-settings-page settings-page-v040">
          <div class="mobile-like-titlebar settings-hero">
            <div class="settings-hero-copy">
              <p class="desktop-kicker">desktop server</p>
              <h2 class="section-title">Settings</h2>
              <p class="section-subtitle">Runtime, tray, startup, backups, privacy and project links.</p>
            </div>
          </div>

          <div v-if="settings" class="settings-layout-v040">
            <section v-for="group in settingGroups" :key="group.title" class="settings-section-card">
              <div class="settings-section-head">
                <div>
                  <p class="desktop-kicker">{{ group.title }}</p>
                  <h3>{{ group.subtitle }}</h3>
                </div>
              </div>
              <article class="mobile-settings-list settings-group-list">
                <button v-for="row in group.rows" :key="row.key" class="mobile-setting-row settings-row-v040" @click="toggleSetting(row.key)">
                  <span class="mobile-setting-icon" v-html="icon(row.icon)"></span>
                  <span class="mobile-setting-copy"><b>{{ row.title }}</b><small>{{ row.body }}</small></span>
                  <span class="toggle compact" :class="{ enabled: settings[row.key] }"></span>
                </button>
              </article>
            </section>

            <section class="settings-section-card">
              <div class="settings-section-head">
                <div>
                  <p class="desktop-kicker">Data & recovery</p>
                  <h3>Backups, restore and reset.</h3>
                </div>
              </div>
              <article class="mobile-settings-list settings-group-list">
                <button class="mobile-setting-row settings-row-v040" @click="rememberWindowNow">
                  <span class="mobile-setting-icon" v-html="icon('settings')"></span>
                  <span class="mobile-setting-copy"><b>Save current window</b><small>Store the current position and size immediately.</small></span>
                  <span class="settings-row-chevron" v-html="icon('chevronRight')"></span>
                </button>
                <button class="mobile-setting-row settings-row-v040" :disabled="loading" @click="exportAppDataZip">
                  <span class="mobile-setting-icon" v-html="icon('export')"></span>
                  <span class="mobile-setting-copy"><b>Export data ZIP</b><small>Create a desktop catalog and settings backup.</small></span>
                  <span class="settings-row-chevron" v-html="icon('chevronRight')"></span>
                </button>
                <button class="mobile-setting-row settings-row-v040" :disabled="loading" @click="importAppDataZip">
                  <span class="mobile-setting-icon" v-html="icon('import')"></span>
                  <span class="mobile-setting-copy"><b>Import data ZIP</b><small>Restore foods, recipes, activities and desktop settings.</small></span>
                  <span class="settings-row-chevron" v-html="icon('chevronRight')"></span>
                </button>
                <button class="mobile-setting-row settings-row-v040 danger-row-v040" :disabled="loading" @click="factoryResetDesktop">
                  <span class="mobile-setting-icon" v-html="icon('refresh')"></span>
                  <span class="mobile-setting-copy"><b>Factory reset</b><small>Delete the local desktop catalog and start setup again.</small></span>
                  <span class="settings-row-chevron" v-html="icon('chevronRight')"></span>
                </button>
              </article>
            </section>

            <section class="settings-section-card licenses-section-card">
              <div class="settings-section-head">
                <div>
                  <p class="desktop-kicker">Licenses</p>
                  <h3>Third-party notices and acknowledgements.</h3>
                </div>
              </div>
              <article class="license-list">
                <a v-for="notice in thirdPartyNotices" :key="notice.name" class="license-card" :href="notice.url" target="_blank" rel="noreferrer">
                  <span class="mobile-setting-icon" v-html="icon('licenses')"></span>
                  <span class="mobile-setting-copy"><b>{{ notice.name }}</b><small>{{ notice.purpose }}</small><small v-if="notice.note">{{ notice.note }}</small></span>
                  <strong>{{ notice.license }}</strong>
                </a>
              </article>
              <ul class="acknowledgement-list"><li v-for="item in acknowledgements" :key="item">{{ item }}</li></ul>
            </section>
          </div>

          <section class="desktop-info-grid settings-info-grid-v040">
            <article class="mobile-info-card privacy-card">
              <div class="mobile-info-icon" v-html="icon('shield')"></div>
              <div>
                <p class="desktop-kicker">Privacy</p>
                <h3>Local-first by design</h3>
                <p>nutrino Desktop stores your food, recipe and activity catalog locally on this machine. The LAN API is used only by your paired mobile app on your own network. No analytics, no public food search, no account.</p>
              </div>
            </article>

            <article class="mobile-info-card about-card">
              <div class="mobile-info-icon logo-info-icon" v-html="nutrinoLogoSvg"></div>
              <div>
                <p class="desktop-kicker">About</p>
                <h3>{{ appName }}</h3>
                <p>Version {{ appVersion }} · {{ appChannel }} · AGPL-3.0-only</p>
                <p>Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.</p>
                <div class="mobile-info-actions">
                  <a :href="repositoryUrl" target="_blank" rel="noreferrer"><span class="inline-svg" v-html="icon('recipes')"></span>Repository</a>
                  <a :href="issueUrl" target="_blank" rel="noreferrer"><span class="inline-svg" v-html="icon('activities')"></span>Report issue</a>
                  <a :href="starUrl" target="_blank" rel="noreferrer"><span class="inline-svg" v-html="icon('star')"></span>Star</a>
                </div>
              </div>
            </article>
          </section>
        </div>
      </section>
    </div>


    <Teleport to="body">
      <div v-if="onboardingOpen" class="modal-backdrop">
        <section class="modal-card onboarding-desktop-card">
          <div class="modal-header"><div class="modal-brand-row"><span class="modal-logo" v-html="nutrinoLogoSvg"></span><div><p class="modal-kicker">nutrino</p><h2 class="text-2xl font-bold">Desktop setup</h2></div></div></div>
          <div v-if="onboardingStep === 0" class="grid gap-4">
            <p class="muted">Set the default LAN API port and review how nutrino Desktop works before pairing mobile.</p>
            <div><label class="field-label">LAN API port</label><input v-model.number="onboardingPort" class="input mt-1" type="number" min="1024" /></div>
            <div><label class="field-label">Server password</label><input v-model="onboardingPassword" class="input mt-1" type="password" autocomplete="new-password" placeholder="Optional; leave empty for no password" /></div>
            <button class="btn-secondary" :disabled="loading" @click="importAppDataZip">Restore server from backup ZIP</button>
            <ol class="desktop-tour-timeline" aria-label="Desktop setup steps">
              <li class="desktop-tour-step"><span class="desktop-tour-index">1</span><div><b>Import or create foods</b><small>Build your private food catalog.</small></div></li>
              <li class="desktop-tour-step"><span class="desktop-tour-index">2</span><div><b>Build recipes</b><small>Combine foods into reusable meals.</small></div></li>
              <li class="desktop-tour-step"><span class="desktop-tour-index">3</span><div><b>Edit activity catalog</b><small>Review MET and kcal/min values.</small></div></li>
              <li class="desktop-tour-step"><span class="desktop-tour-index">4</span><div><b>Start the LAN API</b><small>Pair mobile when you are ready.</small></div></li>
            </ol>
          </div>
          <div v-else class="grid gap-4">
            <p class="muted">Mobile pulls foods, recipes and activities from this server. Diary data stays on the phone. You can change startup, tray and backup settings later from Settings.</p>
            <article class="mobile-info-card"><div class="mobile-info-icon" v-html="icon('shield')"></div><div><h3>Local-first</h3><p>No public food database, no account, no analytics.</p></div></article>
          </div>
          <div class="dialog-actions"><button v-if="onboardingStep > 0" class="btn-secondary" @click="onboardingStep--">Back</button><button v-if="onboardingStep === 0" class="btn-primary" @click="onboardingStep++">Next</button><button v-else class="btn-primary" @click="finishDesktopOnboarding">Start using nutrino</button></div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="qrDialog" class="modal-backdrop" @click.self="qrDialog = null">
        <section class="modal-card qr-modal">
          <div class="modal-title-row"><div><p class="modal-kicker">catalog QR</p><h2>{{ qrDialog.title }}</h2><p class="muted">Scan this with the mobile app to review, edit and save the item locally. The phone will warn if it looks like a duplicate.</p></div></div>
          <div class="qr-preview" v-html="qrDialog.svg"></div>
          <textarea class="input textarea-input" rows="3" readonly :value="qrDialog.payload"></textarea>
          <div class="dialog-actions"><button class="btn-primary" @click="qrDialog = null">Done</button></div>
        </section>
      </div>

      <div v-if="mergePicker" class="modal-backdrop" @click.self="closeMergePicker">
        <section class="modal-card merge-picker-modal">
          <div class="modal-header">
            <div>
              <p class="modal-kicker">merge catalog item</p>
              <h2 class="text-2xl font-bold">Choose the item to keep</h2>
              <p class="muted">Merge <b>{{ mergePicker.aliasName }}</b> into an existing {{ mergePicker.kind }}. You can search by name or ID; no need to remember the target ID.</p>
            </div>
            <button class="btn-secondary" @click="closeMergePicker">Close</button>
          </div>
          <input v-model="mergePicker.query" class="input" autofocus placeholder="Search by name, ID, brand, code..." />
          <div class="merge-target-list mt-4">
            <button v-for="item in mergePickerOptions" :key="item.id" class="merge-target-row" :class="mergePicker.selectedId === item.id ? 'merge-target-selected' : ''" @click="mergePicker.selectedId = item.id">
              <span><b>{{ item.name }}</b><small>{{ item.subtitle }}</small><code>{{ item.id }}</code></span>
              <span class="inline-svg" v-html="icon('chevronRight')"></span>
            </button>
          </div>
          <div v-if="!mergePickerOptions.length" class="empty-state mt-4">No matching target item.</div>
          <div class="dialog-actions"><button class="btn-secondary" @click="closeMergePicker">Cancel</button><button class="btn-primary" :disabled="loading || !mergePicker.selectedId" @click="confirmMergePicker">Merge into selected</button></div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="reviewingInboxEntry" class="modal-backdrop" @click.self="closeInboxReview">
        <section class="modal-card sync-review-modal">
          <div class="modal-header">
            <div>
              <p class="modal-kicker">mobile upload inbox</p>
              <h2 class="text-2xl font-bold">Review and edit before recording</h2>
              <p class="muted">{{ reviewingInboxEntry.device_name || reviewingInboxEntry.source_id }} · {{ syncInboxSummary(reviewingInboxEntry) }}</p>
            </div>
            <button class="btn-secondary" @click="closeInboxReview">Close</button>
          </div>

          <div class="sync-review-summary-row">
            <span v-if="reviewFoods.length">{{ reviewFoods.length }} foods</span>
            <span v-if="reviewRecipes.length">{{ reviewRecipes.length }} recipes</span>
            <span v-if="reviewActivities.length">{{ reviewActivities.length }} activities</span>
            <span v-if="reviewIntakes.length">{{ reviewIntakes.length }} meals/notes</span>
            <span v-if="reviewActivityLogs.length">{{ reviewActivityLogs.length }} activity logs</span>
            <span v-if="reviewWeightLogs.length">{{ reviewWeightLogs.length }} weights</span>
          </div>

          <div v-if="reviewingInboxEntry.merge_candidates.length" class="merge-candidate-list sync-review-merge-list">
            <p class="field-label">Exact duplicate suggestions from this upload</p>
            <div v-for="candidate in reviewingInboxEntry.merge_candidates" :key="`${candidate.kind}:${candidate.incoming_id}`" class="merge-candidate-row">
              <span>{{ candidate.kind }} · <b>{{ candidate.incoming_name }}</b></span>
              <small>{{ candidate.incoming_id }} → {{ candidate.canonical_name }} / {{ candidate.canonical_id }}</small>
            </div>
          </div>

          <div class="sync-review-grid nice-sync-review-grid">
            <article class="sync-review-section">
              <div class="sync-review-section-head">
                <h3>Foods</h3>
                <small>{{ reviewFoods.length }} item(s)</small>
              </div>
              <div v-if="!reviewFoods.length" class="empty-state compact-empty">No foods in this upload.</div>
              <div v-else class="sync-edit-list">
                <div v-for="(food, index) in reviewFoods" :key="`review-food-${food.id}`" class="sync-edit-card">
                  <div class="sync-edit-card-head"><b>Food</b><button class="link-button danger" @click="removeReviewPayloadItem('foods', index)">Remove</button></div>
                  <input v-model="food.name" class="input" placeholder="Food name" />
                  <div class="sync-edit-grid-2"><input v-model="food.brand" class="input" placeholder="Brand" /><input v-model="food.default_unit" class="input" placeholder="Unit" /></div>
                  <textarea v-model="food.note" class="input textarea-input" rows="2" placeholder="Note"></textarea>
                  <div class="sync-edit-grid-4">
                    <input v-model.number="food.kcal_per_100g" class="input" type="number" step="0.1" placeholder="kcal / 100g" />
                    <input v-model.number="food.carbs_per_100g" class="input" type="number" step="0.1" placeholder="carbs" />
                    <input v-model.number="food.fat_per_100g" class="input" type="number" step="0.1" placeholder="fat" />
                    <input v-model.number="food.protein_per_100g" class="input" type="number" step="0.1" placeholder="protein" />
                  </div>
                  <code>{{ food.id }}</code>
                </div>
              </div>
            </article>

            <article class="sync-review-section">
              <div class="sync-review-section-head">
                <h3>Recipes</h3>
                <small>{{ reviewRecipes.length }} recipe(s)</small>
              </div>
              <div v-if="!reviewRecipes.length" class="empty-state compact-empty">No recipes in this upload.</div>
              <div v-else class="sync-edit-list">
                <div v-for="(recipe, index) in reviewRecipes" :key="`review-recipe-${recipe.id}`" class="sync-edit-card">
                  <div class="sync-edit-card-head"><b>Recipe</b><button class="link-button danger" @click="removeReviewPayloadItem('recipes', index)">Remove</button></div>
                  <input v-model="recipe.name" class="input" placeholder="Recipe name" />
                  <input v-model="recipe.description" class="input" placeholder="Description" />
                  <textarea v-model="recipe.note" class="input textarea-input" rows="2" placeholder="Note"></textarea>
                  <div class="sync-edit-grid-2"><input v-model.number="recipe.servings_count" class="input" type="number" step="0.1" placeholder="Servings" /><input v-model.number="recipe.total_weight_g" class="input" type="number" step="0.1" placeholder="Total grams" /></div>
                  <code>{{ recipe.id }}</code>
                </div>
              </div>
            </article>

            <article class="sync-review-section">
              <div class="sync-review-section-head">
                <h3>Activities</h3>
                <small>{{ reviewActivities.length }} item(s)</small>
              </div>
              <div v-if="!reviewActivities.length" class="empty-state compact-empty">No activities in this upload.</div>
              <div v-else class="sync-edit-list">
                <div v-for="(activity, index) in reviewActivities" :key="`review-activity-${activity.id}`" class="sync-edit-card">
                  <div class="sync-edit-card-head"><b>Activity</b><button class="link-button danger" @click="removeReviewPayloadItem('activities', index)">Remove</button></div>
                  <input v-model="activity.name" class="input" placeholder="Activity name" />
                  <div class="sync-edit-grid-2"><input v-model="activity.code" class="input" placeholder="Code" /><input v-model="activity.activity_type" class="input" placeholder="Type" /></div>
                  <textarea v-model="activity.description" class="input textarea-input" rows="2" placeholder="Description"></textarea>
                  <div class="sync-edit-grid-2"><input v-model.number="activity.met" class="input" type="number" step="0.1" placeholder="MET" /><input v-model.number="activity.kcal_per_min" class="input" type="number" step="0.1" placeholder="kcal/min" /></div>
                  <code>{{ activity.id }}</code>
                </div>
              </div>
            </article>

            <article class="sync-review-section">
              <div class="sync-review-section-head">
                <h3>Meal notes and logs</h3>
                <small>{{ reviewIntakes.length + reviewActivityLogs.length + reviewWeightLogs.length }} entry(s)</small>
              </div>
              <div class="sync-edit-list">
                <div v-for="(entry, index) in reviewIntakes" :key="`review-intake-${entry.id}`" class="sync-edit-card">
                  <div class="sync-edit-card-head"><b>Meal / note</b><button class="link-button danger" @click="removeReviewPayloadItem('intakes', index)">Remove</button></div>
                  <div class="sync-edit-grid-2"><input v-model="entry.meal_type" class="input" placeholder="meal type" /><input v-model="entry.food_id" class="input" placeholder="food/recipe id" /></div>
                  <input v-model="entry.note_title" class="input" placeholder="Note title" />
                  <textarea v-model="entry.note_description" class="input textarea-input" rows="2" placeholder="Note description"></textarea>
                  <input v-model.number="entry.amount_g" class="input" type="number" step="0.1" placeholder="grams / kcal note amount" />
                  <small>{{ formatDateTime(entry.consumed_at) }}</small>
                </div>
                <div v-for="(entry, index) in reviewActivityLogs" :key="`review-activity-log-${entry.id}`" class="sync-edit-card">
                  <div class="sync-edit-card-head"><b>Activity log</b><button class="link-button danger" @click="removeReviewPayloadItem('activity_logs', index)">Remove</button></div>
                  <div class="sync-edit-grid-2"><input v-model="entry.activity_name" class="input" placeholder="Activity name" /><input v-model="entry.activity_id" class="input" placeholder="activity id" /></div>
                  <div class="sync-edit-grid-2"><input v-model.number="entry.duration_min" class="input" type="number" step="0.1" placeholder="minutes" /><input v-model.number="entry.kcal" class="input" type="number" step="0.1" placeholder="kcal" /></div>
                  <small>{{ formatDateTime(entry.performed_at) }}</small>
                </div>
              </div>
            </article>
          </div>

          <details class="sync-json-details" :open="reviewAdvancedJson">
            <summary @click.prevent="toggleReviewAdvancedJson">Advanced JSON editor</summary>
            <p class="muted">Use this only when the visual editor does not expose a field you need.</p>
            <textarea v-model="reviewPayloadText" class="input sync-payload-editor" spellcheck="false"></textarea>
          </details>

          <div class="dialog-actions">
            <button class="btn-secondary" @click="closeInboxReview">Cancel</button>
            <button class="btn-primary" :disabled="loading" @click="saveInboxReview">Save draft</button>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="modal" class="modal-backdrop" @click.self="requestCloseModal">
        <section class="modal-card">
          <div class="modal-header">
            <div>
              <p class="modal-kicker">nutrino</p>
              <h2 v-if="modal === 'food'" class="text-2xl font-bold">{{ editingFoodId ? 'Edit food' : 'Add food' }}</h2>
              <h2 v-if="modal === 'recipe'" class="text-2xl font-bold">{{ editingRecipeId ? 'Edit recipe' : 'Add recipe' }}</h2>
              <h2 v-if="modal === 'activity'" class="text-2xl font-bold">{{ editingActivityId ? 'Edit activity' : 'Add activity' }}</h2>
            </div>
            <button class="btn-secondary" @click="requestCloseModal">Close</button>
          </div>

          <div v-if="modal === 'food'" class="modal-body grid gap-3">
            <label class="field-label">Name</label><input v-model="foodForm.name" class="input" placeholder="Food name" />
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">Catalog type</label><select v-model="foodForm.catalog_kind" class="input mt-1"><option value="food">Food / prepared item</option><option value="ingredient">Ingredient / raw material</option></select></div><div><label class="field-label">Brand / source label</label><input v-model="foodForm.brand" class="input mt-1" :disabled="foodForm.catalog_kind === 'ingredient'" placeholder="Optional for food" /></div></div>
            <label class="field-label">Barcode / EAN / UPC</label><input v-model="foodForm.barcode" class="input" placeholder="Optional" />
            <label class="field-label">Note</label><textarea v-model="foodForm.note" class="input textarea-input" rows="3" placeholder="Optional note, source, portion hint or cooking detail"></textarea>
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">Default unit</label><input v-model="foodForm.default_unit" class="input mt-1" /></div><div><label class="field-label">Serving size g</label><input v-model.number="foodForm.serving_size_g" class="input mt-1" type="number" min="0" step="0.1" /></div></div>
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">kcal / 100g</label><input v-model.number="foodForm.kcal_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">Carbs / 100g</label><input v-model.number="foodForm.carbs_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">Fat / 100g</label><input v-model.number="foodForm.fat_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">Protein / 100g</label><input v-model.number="foodForm.protein_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">Sugars / 100g</label><input v-model.number="foodForm.sugars_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">Fiber / 100g</label><input v-model.number="foodForm.fiber_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">Salt / 100g</label><input v-model.number="foodForm.salt_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div></div>
            <button class="btn-primary mt-2" :disabled="loading" @click="saveFood">{{ editingFoodId ? 'Save changes' : 'Create food' }}</button>
          </div>

          <div v-if="modal === 'recipe'" class="modal-body grid gap-3">
            <label class="field-label">Name</label><input v-model="recipeForm.name" class="input" placeholder="Recipe name" />
            <label class="field-label">Description</label><input v-model="recipeForm.description" class="input" placeholder="Optional" />
            <label class="field-label">Note</label><textarea v-model="recipeForm.note" class="input textarea-input" rows="3" placeholder="Optional note, source, portion hint or cooking detail"></textarea>
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">Finished weight g</label><input v-model.number="recipeForm.total_weight_g" class="input mt-1" type="number" min="0" step="0.1" placeholder="Optional; e.g. soup after cooking" /></div><div><label class="field-label">Servings</label><input v-model.number="recipeForm.servings_count" class="input mt-1" type="number" min="0" step="0.1" placeholder="Optional" /></div></div>
            <div class="rounded-2xl bg-soft p-3">
              <div v-for="(item, index) in recipeForm.items" :key="index" class="recipe-ingredient-editor mb-3 grid gap-2 sm:grid-cols-[1fr_120px_120px_auto]">
                <div class="recipe-ingredient-picker">
                  <input v-model="recipeIngredientSearch[index]" class="input mb-2" type="search" placeholder="Search food, ingredient or recipe..." />
                  <select v-model="item.food_id" class="input" @change="onRecipeItemFoodChange(item)">
                    <option value="">Choose food, ingredient or recipe</option>
                    <option v-for="food in recipeIngredientOptions(index)" :key="food.id" :value="food.id">{{ recipeIngredientLabel(food) }}</option>
                  </select>
                </div>
                <label class="compact-unit-field">
                  <span>g</span>
                  <input v-model.number="item.amount_g" class="input" type="number" min="0" step="0.1" placeholder="grams" />
                </label>
                <label class="compact-unit-field" :class="{ disabled: !recipeItemServingSize(item) }">
                  <span>db</span>
                  <input :value="recipeItemPieces(item)" class="input" type="number" min="0" step="0.25" :disabled="!recipeItemServingSize(item)" placeholder="pieces" @input="setRecipeItemPieces(item, $event)" />
                </label>
                <button class="btn-secondary" @click="removeRecipeItem(index)">Remove</button>
                <small class="recipe-ingredient-help sm:col-start-2 sm:col-span-2">{{ recipeItemServingLabel(item) }}</small>
              </div>
              <button class="btn-secondary" @click="addRecipeItem">Add ingredient</button>
            </div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-5"><div class="mini-stat"><strong>{{ round(recipeFormNutrition.totalWeight) }}g</strong><span>weight</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.kcalPer100g) }}</strong><span>kcal/100g</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.carbsPer100g) }}g</strong><span>carbs</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.fatPer100g) }}g</strong><span>fat</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.proteinPer100g) }}g</strong><span>protein</span></div></div>
            <button class="btn-primary mt-2" :disabled="loading" @click="saveRecipe">{{ editingRecipeId ? 'Save changes' : 'Create recipe' }}</button>
          </div>

          <div v-if="modal === 'activity'" class="modal-body grid gap-3">
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">Code</label><input v-model="activityForm.code" class="input mt-1" /></div><div><label class="field-label">Type</label><input v-model="activityForm.activity_type" class="input mt-1" /></div></div>
            <label class="field-label">Name</label><input v-model="activityForm.name" class="input" placeholder="running" />
            <label class="field-label">Description</label><input v-model="activityForm.description" class="input" placeholder="general" />
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">MET</label><input v-model.number="activityForm.met" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">kcal / min</label><input v-model.number="activityForm.kcal_per_min" class="input mt-1" type="number" min="0" step="0.1" /></div></div>
            <button class="btn-primary mt-2" :disabled="loading" @click="saveActivity">{{ editingActivityId ? 'Save changes' : 'Create activity' }}</button>
          </div>
        </section>
      </div>
    </Teleport>
  </main>
</template>
