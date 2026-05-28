<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { invoke, type PluginListener } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { cancel, createChannel, Importance, isPermissionGranted, onAction, registerActionTypes, requestPermission as requestNativeNotificationPermission, Schedule, sendNotification, Visibility, type Options as NotificationOptions } from '@tauri-apps/plugin-notification';
import { driver, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import JSZip from 'jszip';
import type { ActivityDefinition, ActivityLog, AppLanguage, AppState, CatalogSourceKind, Food, Ingredient, Intake, LocalizedNameMap, MealType, Recipe, RecipeItem, WeightLog, GitHubCsvSource } from './types';
import {
  ageFromBirthday,
  bmi,
  calculateKcal,
  catalogItems,
  dailyKcalGoal,
  dateKey,
  dayEndMs,
  dayStartMs,
  findCatalogItem,
  foodSnapshot,
  generateId,
  isDevMode,
  runtimeAppName,
  runtimeChannel,
  latestWeightForDay,
  loadState,
  defaultState,
  needsWeightPrompt,
  saveState,
} from './lib/storage';
import { APP_VERSION, checkServerHealth, normalizeApiBaseUrl, pingServer, pullFromServer, pushToServer, requestDesktopUpdateCheck, syncGitHubCsvSources } from './lib/api';
import { checkNutrinoUpdates, type UpdateCheckResult } from './lib/releases';
import { lucideSvg, type IconName } from './icons';

type Tab = 'home' | 'diary' | 'recipes' | 'profile';
type AddMode = 'food' | 'activity' | null;
type MealEntryMode = 'catalog' | 'note';
type CatalogSearchScope = 'title' | 'all' | 'brand' | 'category' | 'description';
type WeightTrendMode = 'daily' | 'weekly' | 'monthly';
type LocalEditorKind = 'ingredient' | 'food' | 'recipe' | 'activity';
type LocalRecipeDraftItem = { food_id: string; amount_g: number; unit: 'g' | 'serving'; query: string; pickerOpen: boolean };
type MealNoteSuggestion = { key: string; title: string; description: string; kcal: number; lastUsedAt: number; count: number };

type OptionalNutrientDefinition = {
  key: string;
  labelKey: string;
  unit: 'g' | 'mg' | 'mcg';
  dailyLimit: number;
  limitKind: 'max' | 'target';
  field?: 'sugars_per_100g' | 'fiber_per_100g' | 'salt_per_100g';
};

type NutrientInsightDialog = { kind: 'day' } | { kind: 'meal'; mealType: MealType };
type NutrientChartMode = 'important' | 'optional';
type NutrientChartSlice = { label: string; value: number; amount: string; note?: string; share: number; color: string };
type NutrinoNotificationKind = 'daily' | 'weight' | 'meal' | 'deficit';
type NutrinoNotificationAction = 'tap' | 'open-home' | 'log-weight' | 'log-breakfast' | 'log-lunch' | 'log-dinner' | 'open-analysis' | 'dismiss';
type NutrinoNotificationExtra = { nutrino: true; kind: NutrinoNotificationKind; mealType?: MealType; scheduledTime?: string };
type NutrinoNotificationEvent = {
  actionId?: string;
  action?: string;
  userAction?: string;
  notificationUserAction?: string;
  inputValue?: string | null;
  notificationId?: number | string;
  id?: number | string;
  notification?: (NotificationOptions & { id?: number | string; extra?: Record<string, unknown>; data?: Record<string, unknown>; sourceJson?: string }) | null;
  extra?: Record<string, unknown>;
  data?: Record<string, unknown>;
  sourceJson?: string;
};
type ReminderClockTime = { hour: number; minute: number };
type ScheduledReminderConfig = {
  id: number;
  key: string;
  time: string;
  title: string;
  body: string;
  kind: NutrinoNotificationKind;
  actionTypeId?: string;
  mealType?: MealType;
};

const NOTIFICATION_CHANNEL_ID = 'nutrino-reminders';
const NOTIFICATION_GROUP_ID = 'nutrino-reminders';
const NOTIFICATION_ICON = 'nutrino_notification';
const WEB_NOTIFICATION_ICON = '/nutrino-logo.svg';
const NOTIFICATION_ICON_COLOR = '#2f7d32';
const NOTIFICATION_ACTION_TYPES = {
  daily: 'nutrino-daily-actions',
  weight: 'nutrino-weight-actions',
  mealBreakfast: 'nutrino-meal-breakfast-actions',
  mealLunch: 'nutrino-meal-lunch-actions',
  mealDinner: 'nutrino-meal-dinner-actions',
  deficit: 'nutrino-deficit-actions',
} as const;
const REMINDER_NOTIFICATION_IDS = {
  daily: 130100,
  weight: 130200,
  mealMorning: 130301,
  mealNoon: 130302,
  mealAfternoon: 130303,
} as const;

const nutrientChartPalette = ['#31c96f', '#e7b341', '#ef5350', '#5f82ff', '#26a69a', '#ab47bc', '#ff8a65', '#7cb342', '#26c6da', '#ec407a', '#9ccc65'];

const optionalNutrientDefinitions: OptionalNutrientDefinition[] = [
  { key: 'sugars_per_100g', field: 'sugars_per_100g', labelKey: 'sugars', unit: 'g', dailyLimit: 50, limitKind: 'max' },
  { key: 'fiber_per_100g', field: 'fiber_per_100g', labelKey: 'fiber', unit: 'g', dailyLimit: 30, limitKind: 'target' },
  { key: 'salt_per_100g', field: 'salt_per_100g', labelKey: 'salt', unit: 'g', dailyLimit: 5, limitKind: 'max' },
  { key: 'saturated_fat_per_100g', labelKey: 'saturatedFat', unit: 'g', dailyLimit: 20, limitKind: 'max' },
  { key: 'sodium_mg_per_100g', labelKey: 'sodium', unit: 'mg', dailyLimit: 2300, limitKind: 'max' },
  { key: 'calcium_mg_per_100g', labelKey: 'calcium', unit: 'mg', dailyLimit: 1000, limitKind: 'target' },
  { key: 'iron_mg_per_100g', labelKey: 'iron', unit: 'mg', dailyLimit: 18, limitKind: 'target' },
  { key: 'potassium_mg_per_100g', labelKey: 'potassium', unit: 'mg', dailyLimit: 3500, limitKind: 'target' },
  { key: 'vitamin_d_mcg_per_100g', labelKey: 'vitaminD', unit: 'mcg', dailyLimit: 20, limitKind: 'target' },
  { key: 'vitamin_b12_mcg_per_100g', labelKey: 'vitaminB12', unit: 'mcg', dailyLimit: 2.4, limitKind: 'target' },
  { key: 'magnesium_mg_per_100g', labelKey: 'magnesium', unit: 'mg', dailyLimit: 400, limitKind: 'target' },
];


type MealSection = {
  key: MealType | 'activity';
  label: string;
  icon: string;
  hint: string;
};

type NavItem = {
  key: Tab;
  label: string;
  icon: string;
  activeIcon: string;
};

const state = reactive<AppState>(loadState());
const githubDraft = ref({ owner: '', repo: '', branch: 'main', path: '', token: '' });
const githubSyncBusy = ref(false);
const scanDialogOpen = ref(false);
const scanDialogMode = ref<'catalog' | 'barcode'>('catalog');
const scanInput = ref('');
const scanVideo = ref<HTMLVideoElement | null>(null);
const scannerActive = ref(false);
type PendingCatalogQrSequence = { id: string; total: number; parts: Record<number, string> };
const pendingCatalogQrSequence = ref<PendingCatalogQrSequence | null>(null);
let scannerStream: MediaStream | null = null;
let lastScannerRawValue = '';
let lastScannerRawAt = 0;
const activeTab = ref<Tab>('home');
const selectedDate = ref(dateKey());
const todayKey = ref(dateKey());
const calendarMonth = ref(new Date(dayStartMs(selectedDate.value)));
const addMode = ref<AddMode>(null);
const quickAddOpen = ref(false);
const addMealType = ref<MealType>('breakfast');
const selectedCatalogId = ref('');
const catalogPickerOpen = ref(false);
const activityPickerOpen = ref(false);
const recipeIngredientAmounts = ref<Record<string, number>>({});
const recipeCustomExtraKcal = ref<number | null>(0);
const recipeCustomizeOpen = ref(false);
const foodUnit = ref<'g' | 'serving'>('g');
const foodAmount = ref<number | null>(null);
const activityId = ref('');
const activityMinutes = ref<number | null>(null);
const activityKcal = ref<number | null>(null);
const activitySource = ref<ActivityLog['source']>('activity_catalog');
const weightInput = ref<number | null>(null);
const search = ref('');
const mealEntryMode = ref<MealEntryMode>('catalog');
const noteTitle = ref('');
const noteDescription = ref('');
const noteKcal = ref<number | null>(null);
const catalogSearchScope = ref<CatalogSearchScope>('title');
const catalogMenuOpen = ref(false);
const localEditorOpen = ref(false);
const localEditorKind = ref<LocalEditorKind>('food');
const localEditorId = ref<string | null>(null);
const localEditorDuplicate = ref(false);
const localCatalogForm = reactive({
  name: '', name_i18n: {} as LocalizedNameMap, brand: '', note: '', barcode: '', default_unit: 'g', serving_size_g: null as number | null,
  kcal_per_100g: null as number | null, carbs_per_100g: 0, fat_per_100g: 0, protein_per_100g: 0,
  sugars_per_100g: null as number | null, fiber_per_100g: null as number | null, salt_per_100g: null as number | null,
  optional_nutrients: {} as Record<string, number | null>,
  description: '', total_weight_g: null as number | null, extra_kcal: 0 as number | null, servings_count: null as number | null,
  code: '', activity_type: 'custom', met: 0, kcal_per_min: null as number | null, inactive: false,
});
const localRecipeItems = ref<LocalRecipeDraftItem[]>([]);
const localRecipeCatalogOptions = computed(() => catalogItems(state).filter((item) => catalogItemVisible(item) && item.id !== `recipe:${localEditorId.value}`));
const contentScrolled = ref(false);
const syncBusy = ref(false);
const catalogSourceCheckBusyId = ref('');
const serverOnline = ref(false);
const githubCatalogAvailable = computed(() => state.settings.github_csv_enabled !== false && (state.githubSources || []).some((source) => source.enabled));
const serverChecking = ref(false);
let healthTimer: number | undefined;
let todayRolloverTimer: number | undefined;
const offlineToastShown = ref(false);
const toast = ref('');
const settingsOpen = ref(false);
const settingsDialog = ref<'permissions' | 'updates' | 'units' | 'calculations' | 'tracking' | 'micronutrients' | 'language' | 'privacy' | 'about' | 'licenses' | 'advanced' | null>(null);
const updateBusy = ref(false);
const updateDialogOpen = ref(false);
const updateCheckResult = ref<UpdateCheckResult | null>(null);
const updateAvailable = computed(() => updateCheckResult.value?.status === 'available' && Boolean(updateCheckResult.value.release));
const analysisOpen = ref(false);
const deficitInfoOpen = ref(false);
const micronutrientInfoOpen = ref(false);
const nutrientInsightsDialog = ref<NutrientInsightDialog | null>(null);
const nutrientChartMode = ref<NutrientChartMode>('important');
const weightTrendMode = ref<WeightTrendMode>('weekly');
const notificationPermission = ref('unknown');
const notificationPermissionGranted = computed(() => notificationPermission.value === 'granted');
const cameraPermission = ref('unknown');
const cameraPermissionGranted = computed(() => cameraPermission.value === 'granted');
const calorieLegendOpen = ref(false);
const weightLegendOpen = ref(false);
const selectedCalorieRowKey = ref<string | null>(null);
const selectedWeightRowKey = ref<string | null>(null);
type EntryActionSheetState = { kind: 'intake' | 'activity'; id: string };
const entryActionSheet = ref<EntryActionSheetState | null>(null);
const duplicateMealTargetOpen = ref(false);
const pendingDuplicateIntakeId = ref<string | null>(null);
let entryLongPressTimer: number | undefined;
let reminderTimer: number | undefined;
let reminderScheduleRefreshTimer: number | undefined;
let notificationActionListener: PluginListener | null = null;
let lastNotificationActionSignature = '';
let lastNotificationActionHandledAt = 0;
let onboardingDriver: Driver | null = null;
const nativeReminderSchedulesActive = ref(false);
const weightReminderModalOpen = ref(false);
const notificationHighlightedMealType = ref<MealType | null>(null);

const languageSearch = ref('');
const unlockedDiaryDate = ref<string | null>(null);
const futureConfirmedDates = ref<Record<string, boolean>>({});
const editingDayWeight = ref(false);
const editingIntakeId = ref<string | null>(null);
const editingActivityLogId = ref<string | null>(null);
const highlightedReviewIntakeId = ref<string | null>(null);
const mealNoteReviewOpen = ref(false);
let highlightedReviewTimer: number | undefined;
const lastBackPressAt = ref(0);
const androidBackExitWindowMs = 5000;
let backTrapRearmingTimer: number | undefined;
let lastBackRequestHandledAt = 0;
let confirmedMobileExit = false;
let unlistenWindowCloseRequested: (() => void) | undefined;
let lastNumericTapTarget: HTMLInputElement | null = null;
let lastNumericTapAt = 0;


type BackupProfileKind = 'factory_reset' | 'export' | 'manual' | 'daily';

type BackupProfileSummary = {
  id: string;
  kind: BackupProfileKind;
  name: string;
  createdAt: number;
  version: string;
  byteLength: number;
  counts: {
    foods: number;
    recipes: number;
    activities: number;
    intakes: number;
    activityLogs: number;
    weightLogs: number;
  };
};

type StoredBackupProfile = BackupProfileSummary & { state: AppState };

const backupProfilesOpen = ref(false);
const backupProfiles = ref<BackupProfileSummary[]>([]);

const nutrinoLogoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"> <rect width="64" height="64" rx="18" fill="#0D2514"/> <g fill="#33E36A"> <circle cx="18" cy="14" r="5"/> <circle cx="18" cy="26" r="5"/> <circle cx="18" cy="38" r="5"/> <circle cx="18" cy="50" r="5"/> <circle cx="29" cy="24" r="5"/> <circle cx="35" cy="34" r="5"/> <circle cx="46" cy="14" r="5"/> <circle cx="46" cy="26" r="5"/> <circle cx="46" cy="38" r="5"/> <circle cx="46" cy="50" r="5"/> </g> </svg>';

const onboardingOpen = ref(false);
const onboardingStep = ref(0);
const onboardingProfile = reactive({
  height_cm: state.profile.height_cm,
  current_weight_kg: state.profile.current_weight_kg,
  birthday: state.profile.birthday,
  gender: state.profile.gender,
  activity_level: state.profile.activity_level,
  weekly_goal_kg: state.profile.weekly_goal_kg,
});
const mobileStateKey = 'nutrino.mobile.v3.state';
const mobileOnboardingKey = 'nutrino.mobile.onboarded.v1';
const mobileCameraPermissionGrantedKey = 'nutrino.mobile.cameraPermissionGranted.v1';
const mobileBackupDbName = 'nutrino-mobile-backups';
const mobileBackupStoreName = 'profiles';
const mobileDailyBackupDateKey = 'nutrino.mobile.dailyBackupProfileDate.v1';
const mobileBackupProfileLimits: Record<BackupProfileKind, number> = {
  factory_reset: 1,
  export: 1,
  manual: 3,
  daily: 7,
};
const mobileFactoryResetConfirm = 'This deletes all local mobile diary, profile, cached catalog and settings data. Continue?';



type ThirdPartyNotice = {
  name: string;
  license: string;
  purpose: string;
  url: string;
  note?: string;
};

const thirdPartyNotices: ThirdPartyNotice[] = [
  { name: 'Nutrino', license: 'AGPL-3.0-only', purpose: 'Application source code and project license.', url: 'https://github.com/rozsazoltan/nutrino' },
  { name: 'Vue', license: 'MIT', purpose: 'Reactive user interface framework for the mobile and desktop apps.', url: 'https://vuejs.org/' },
  { name: 'Tauri', license: 'MIT OR Apache-2.0', purpose: 'Native desktop/mobile runtime, app shell and platform bridge.', url: 'https://tauri.app/' },
  { name: 'Rust', license: 'MIT OR Apache-2.0', purpose: 'Systems language and native backend ecosystem used by Tauri.', url: 'https://www.rust-lang.org/' },
  { name: 'JSZip', license: 'MIT OR GPL-3.0', purpose: 'Creation and validation of portable ZIP backups.', url: 'https://github.com/Stuk/jszip' },
  { name: 'tauri-plugin-share', license: 'MIT', purpose: 'Native mobile share sheet integration for validated ZIP backup files.', url: 'https://docs.rs/crate/tauri-plugin-share/latest' },
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


const settingsIconMap: Record<string, IconName> = {
  permissions: 'shield',
  updates: 'refreshCw',
  units: 'ruler',
  calculations: 'calculator',
  tracking: 'scale',
  activity: 'activity',
  macros: 'chartPie',
  micros: 'flaskConical',
  catalogProtect: 'shield',
  catalogInactive: 'archiveRestore',
  language: 'languages',
  reminder: 'bell',
  export: 'upload',
  import: 'download',
  refresh: 'refreshCw',
  issue: 'bug',
  repo: 'bookOpen',
  star: 'star',
  privacy: 'shield',
  about: 'info',
  licenses: 'badgeInfo',
  reset: 'rotateCcw',
  backup: 'archiveRestore',
  advanced: 'settings',
};

function settingsIcon(name: string) {
  return lucideSvg(settingsIconMap[name] ?? 'info');
}

function selectNumberInput(event: FocusEvent) {
  const input = event.currentTarget as HTMLInputElement | null;
  if (!input) return;
  window.setTimeout(() => input.select(), 0);
}

function clearNumberInputOnDoubleTap(event: PointerEvent) {
  const input = event.currentTarget as HTMLInputElement | null;
  if (!input) return;
  const now = Date.now();
  if (lastNumericTapTarget === input && now - lastNumericTapAt < 420) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    lastNumericTapTarget = null;
    lastNumericTapAt = 0;
    event.preventDefault();
    return;
  }
  lastNumericTapTarget = input;
  lastNumericTapAt = now;
}

const appChannel = runtimeChannel();
const devMode = isDevMode();
const appName = runtimeAppName('Nutrino');
document.title = appName;
const ringCircumference = 2 * Math.PI * 90;
const kcalArcLength = ringCircumference * 0.78;
const macroRing = 2 * Math.PI * 20;

const iconHome = lucideSvg('house');
const iconDiary = lucideSvg('book');
const iconRecipes = lucideSvg('bookOpenText');
const iconProfile = lucideSvg('userRound');

const navItems: NavItem[] = [
  { key: 'home', label: 'Home', icon: iconHome, activeIcon: iconHome },
  { key: 'diary', label: 'Diary', icon: iconDiary, activeIcon: iconDiary },
  { key: 'recipes', label: 'Recipes', icon: iconRecipes, activeIcon: iconRecipes },
  { key: 'profile', label: 'Profile', icon: iconProfile, activeIcon: iconProfile },
];

const sections: MealSection[] = [
  { key: 'activity', label: 'Activity', icon: 'directions_walk', hint: 'Add burned kcal' },
  { key: 'breakfast', label: 'Breakfast', icon: 'local_cafe', hint: 'Start the day' },
  { key: 'lunch', label: 'Lunch', icon: 'lunch_dining', hint: 'Midday meal' },
  { key: 'dinner', label: 'Dinner', icon: 'dinner_dining', hint: 'Evening meal' },
  { key: 'snack', label: 'Snack', icon: 'bakery_dining', hint: 'Small meals' },
];
const mealTargetSections = computed(() => sections.filter((section): section is MealSection & { key: MealType } => section.key !== 'activity'));

const mealIconSvg: Record<string, string> = {
  directions_walk: lucideSvg('personStanding'),
  local_cafe: lucideSvg('coffee'),
  lunch_dining: lucideSvg('sandwich'),
  dinner_dining: lucideSvg('utensils'),
  bakery_dining: lucideSvg('cookie'),
};

watch(state, () => saveState(JSON.parse(JSON.stringify(state)) as AppState), { deep: true });
watch(() => state.settings.show_micronutrients, (enabled) => {
  if (enabled) return;
  if (settingsDialog.value === 'micronutrients') settingsDialog.value = null;
  micronutrientInfoOpen.value = false;
  nutrientInsightsDialog.value = null;
});
watch(() => state.settings.desktop_api_enabled, (enabled) => {
  if (enabled) {
    void pollServerHealth({ syncOnChange: true, quiet: true });
    return;
  }
  serverOnline.value = false;
  state.pairing.lastSyncError = undefined;
});
watch(() => state.settings.github_csv_enabled, (enabled) => {
  if (enabled) void syncGitHubDailyIfDue();
});
watch(() => notificationPermissionSignature(), () => {
  void ensureNotificationPermissionForReminders();
  queueReminderScheduleRefresh();
});
watch(() => notificationScheduleSignature(), queueReminderScheduleRefresh);
watch(selectedDate, () => {
  editingDayWeight.value = false;
});
function updateKeyboardOffset() {
  const viewport = window.visualViewport;
  if (!viewport) {
    document.documentElement.style.setProperty('--keyboard-offset', '0px');
    return;
  }
  const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  document.documentElement.style.setProperty('--keyboard-offset', `${Math.round(keyboard)}px`);
  document.body.classList.toggle('keyboard-open', keyboard > 80);
}

function statusbarGuardPx(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--statusbar-guard').trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 40;
}

function scrollFocusedInputIntoView() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (!active.matches('input, textarea, select')) return;
  nextTick(() => {
    window.setTimeout(() => {
      const stickyCard = active.closest('.catalog-search-card');
      if (stickyCard instanceof HTMLElement) {
        const guard = statusbarGuardPx() + 14;
        const rect = stickyCard.getBoundingClientRect();
        const top = window.scrollY + rect.top - guard;
        if (rect.top < guard || rect.top > guard + 80) {
          window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'smooth' });
          return;
        }
      }
      active.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }, 120);
  });
}


function refreshTodayKey() {
  const next = dateKey();
  const changed = todayKey.value !== next;
  if (changed) todayKey.value = next;
  syncProfileWeightFromToday();
  if (!changed) return;
  if (activeTab.value === 'home') {
    editingDayWeight.value = false;
    weightInput.value = null;
  }
}

function scheduleTodayRollover() {
  if (todayRolloverTimer) window.clearTimeout(todayRolloverTimer);
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 1, 0);
  todayRolloverTimer = window.setTimeout(() => {
    refreshTodayKey();
    scheduleTodayRollover();
  }, Math.max(1000, nextMidnight.getTime() - Date.now()));
}

function handleVisibilityChange() {
  if (!document.hidden) refreshTodayKey();
}

function hideKeyboard(event?: Event) {
  const target = event?.currentTarget;
  if (target instanceof HTMLElement) {
    target.blur();
    return;
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}


function pushBackTrap() {
  history.pushState({ nutrinoBackTrap: true, createdAt: Date.now() }, '', location.href);
}

function armBackTrap() {
  // Android can close the WebView when hardware Back reaches the first history entry.
  // Keep two synthetic entries armed so the app always receives Back first and can
  // route it through the currently visible sheet/dialog/editor.
  pushBackTrap();
  pushBackTrap();
}

function resetBackTrap() {
  history.replaceState({ nutrinoRoot: true }, '', location.href);
  armBackTrap();
}

function keepBackInsideApp(options: { preserveExitWindow?: boolean } = {}) {
  if (!options.preserveExitWindow) lastBackPressAt.value = 0;
  armBackTrap();
}

function scrollToPageTop() {
  nextTick(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.querySelector('.app-shell')?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  });
}

function hasActiveMealSheetDraft(): boolean {
  if (!addMode.value) return false;
  if (editingIntakeId.value || editingActivityLogId.value) return true;

  if (addMode.value === 'food') {
    if (mealEntryMode.value === 'note') {
      return Boolean(noteTitle.value.trim() || noteDescription.value.trim() || Number(noteKcal.value || 0) > 0);
    }
    return Boolean(
      selectedCatalogId.value ||
      Number(foodAmount.value || 0) > 0 ||
      Object.values(recipeIngredientAmounts.value).some((value) => Number(value || 0) > 0),
    );
  }

  return Boolean(
    activitySource.value !== 'activity_catalog' ||
    activityId.value ||
    Number(activityMinutes.value || 0) > 0 ||
    Number(activityKcal.value || 0) > 0,
  );
}

function hasLocalEditorDraft(): boolean {
  if (!localEditorOpen.value) return false;
  if (localEditorId.value) return true;
  const textDirty = [
    localCatalogForm.name,
    localCatalogForm.brand,
    localCatalogForm.note,
    localCatalogForm.barcode,
    localCatalogForm.description,
    localCatalogForm.code,
  ].some((value) => String(value || '').trim().length > 0);
  const numberDirty = [
    localCatalogForm.serving_size_g,
    localCatalogForm.kcal_per_100g,
    localCatalogForm.carbs_per_100g,
    localCatalogForm.fat_per_100g,
    localCatalogForm.protein_per_100g,
    localCatalogForm.sugars_per_100g,
    localCatalogForm.fiber_per_100g,
    localCatalogForm.salt_per_100g,
    localCatalogForm.total_weight_g,
    localCatalogForm.extra_kcal,
    localCatalogForm.servings_count,
    localCatalogForm.met,
    localCatalogForm.kcal_per_min,
  ].some((value) => Math.abs(Number(value || 0)) > 0);
  const recipeDirty = localRecipeItems.value.some((row) => row.food_id || row.query.trim() || Number(row.amount_g || 0) > 0);
  return textDirty || numberDirty || recipeDirty || localCatalogForm.inactive === true;
}

function confirmDiscardDirty(isDirty: boolean): boolean {
  return !isDirty || window.confirm(t('discardCurrentEditConfirm'));
}

function uninstallWindowCloseGuard() {
  if (!unlistenWindowCloseRequested) return;
  unlistenWindowCloseRequested();
  unlistenWindowCloseRequested = undefined;
}

async function installWindowCloseGuard() {
  try {
    const appWindow = getCurrentWindow();
    unlistenWindowCloseRequested = await appWindow.onCloseRequested((event) => {
      if (confirmedMobileExit) return;
      event.preventDefault();
      handleBackNavigation();
    });
  } catch {
    // Browser preview and older shells do not expose the Tauri close-request API.
    // The history back trap below remains the fallback in those environments.
  }
}

function leaveAppAfterConfirmedBack() {
  confirmedMobileExit = true;
  window.removeEventListener('popstate', handleBackNavigation);
  window.removeEventListener('nutrino:android-back', handleNativeAndroidBack);
  uninstallWindowCloseGuard();
  if (backTrapRearmingTimer) window.clearTimeout(backTrapRearmingTimer);
  void invoke('exit_mobile_app').catch(() => {
    window.close();
    history.go(-3);
  });
}

function requestCloseRecipeCustomizerFromBack() {
  // Hardware Back should behave like a local Cancel/Back action, not like OK/save.
  // The current recipe customization inputs are live state, so guard against losing
  // accidental edits before closing this nested editor.
  const isDirty = selectedRecipeComponents.value.some((row) => {
    const current = Number(recipeIngredientAmounts.value[row.key] ?? row.baseAmount ?? 0);
    return Math.abs(current - Number(row.baseAmount || 0)) > 0.0001;
  });
  if (confirmDiscardDirty(isDirty)) {
    initializeRecipeIngredientAmounts(selectedCatalogId.value);
    recipeCustomizeOpen.value = false;
  }
}

function handleNativeAndroidBack(event?: Event) {
  event?.preventDefault?.();
  handleBackNavigation();
}

function handleBackNavigation(event?: PopStateEvent) {
  event?.preventDefault?.();
  const requestHandledAt = Date.now();
  if (requestHandledAt - lastBackRequestHandledAt < 220) return;
  lastBackRequestHandledAt = requestHandledAt;
  if (scanDialogOpen.value) {
    closeScanner();
    keepBackInsideApp();
    return;
  }

  if (localEditorOpen.value) {
    requestCloseLocalEditor();
    keepBackInsideApp();
    return;
  }

  if (nutrientInsightsDialog.value) {
    closeNutrientInsights();
    keepBackInsideApp();
    return;
  }

  if (addMode.value) {
    if (recipeCustomizeOpen.value) {
      requestCloseRecipeCustomizerFromBack();
      keepBackInsideApp();
      return;
    }
    if (catalogPickerOpen.value && selectedCatalog.value) {
      catalogPickerOpen.value = false;
      keepBackInsideApp();
      return;
    }
    if (activityPickerOpen.value && selectedActivity.value) {
      activityPickerOpen.value = false;
      keepBackInsideApp();
      return;
    }
    requestCloseSheet();
    keepBackInsideApp();
    return;
  }

  if (quickAddOpen.value) {
    quickAddOpen.value = false;
    keepBackInsideApp();
    return;
  }

  if (backupProfilesOpen.value) {
    backupProfilesOpen.value = false;
    keepBackInsideApp();
    return;
  }

  if (duplicateMealTargetOpen.value) {
    closeDuplicateMealTarget();
    keepBackInsideApp();
    return;
  }

  if (entryActionSheet.value) {
    entryActionSheet.value = null;
    keepBackInsideApp();
    return;
  }

  if (calorieLegendOpen.value || weightLegendOpen.value) {
    calorieLegendOpen.value = false;
    weightLegendOpen.value = false;
    keepBackInsideApp();
    return;
  }

  if (settingsDialog.value) {
    settingsDialog.value = null;
    keepBackInsideApp();
    return;
  }

  if (updateDialogOpen.value) {
    remindUpdateLater();
    keepBackInsideApp();
    return;
  }

  if (analysisOpen.value) {
    analysisOpen.value = false;
    keepBackInsideApp();
    return;
  }

  if (settingsOpen.value) {
    closeSettings();
    keepBackInsideApp();
    return;
  }

  if (onboardingDriver?.isActive()) {
    stopOnboardingTour();
    keepBackInsideApp();
    return;
  }

  if (catalogMenuOpen.value) {
    catalogMenuOpen.value = false;
    keepBackInsideApp();
    return;
  }

  if (onboardingOpen.value) {
    if (onboardingStep.value > 0) onboardingStep.value -= 1;
    else showToast(t('finishSetupBeforeExit'));
    keepBackInsideApp();
    return;
  }

  if (activeTab.value !== 'home') {
    if (activeTab.value === 'diary') {
      unlockedDiaryDate.value = null;
      editingDayWeight.value = false;
    }
    activeTab.value = 'home';
    scrollToPageTop();
    keepBackInsideApp();
    return;
  }

  const now = Date.now();
  if (now - lastBackPressAt.value < androidBackExitWindowMs) {
    leaveAppAfterConfirmedBack();
    return;
  }

  lastBackPressAt.value = now;
  showToast(t('pressBackAgain'));
  keepBackInsideApp({ preserveExitWindow: true });
}


function saveOnboardingProfile() {
  state.profile.height_cm = Number(onboardingProfile.height_cm) || state.profile.height_cm;
  state.profile.current_weight_kg = Number(onboardingProfile.current_weight_kg) || state.profile.current_weight_kg;
  state.profile.plan_start_weight_kg = state.profile.current_weight_kg;
  state.profile.birthday = String(onboardingProfile.birthday || state.profile.birthday);
  state.profile.gender = onboardingProfile.gender;
  state.profile.activity_level = onboardingProfile.activity_level;
  state.profile.weekly_goal_kg = Number(onboardingProfile.weekly_goal_kg) || 0;
}

function markOnboardingComplete() {
  localStorage.setItem(mobileOnboardingKey, '1');
}

async function openOnboardingPermissionsStep() {
  saveOnboardingProfile();
  state.settings.desktop_sync_prompted = true;
  onboardingStep.value = 2;
  await nextTick();
  await requestOnboardingPermissions();
}

function openOnboardingSyncStep() {
  saveOnboardingProfile();
  onboardingStep.value = 1;
}

async function finishOnboarding() {
  saveOnboardingProfile();
  state.settings.desktop_sync_prompted = true;
  onboardingOpen.value = false;
  onboardingStep.value = 0;
  saveState(JSON.parse(JSON.stringify(state)) as AppState);
  await nextTick();
  startOnboardingTour();
}

function maybeOpenOnboarding() {
  if (!localStorage.getItem(mobileOnboardingKey)) {
    onboardingOpen.value = true;
  }
}

function startDevFirstLaunchMode() {
  if (!devMode) return;
  const fresh = defaultState();
  onboardingProfile.height_cm = fresh.profile.height_cm;
  onboardingProfile.current_weight_kg = fresh.profile.current_weight_kg;
  onboardingProfile.birthday = fresh.profile.birthday;
  onboardingProfile.gender = fresh.profile.gender;
  onboardingProfile.activity_level = fresh.profile.activity_level;
  onboardingProfile.weekly_goal_kg = fresh.profile.weekly_goal_kg;
  localStorage.removeItem(mobileOnboardingKey);
  stopOnboardingTour(false);
  settingsOpen.value = false;
  settingsDialog.value = null;
  activeTab.value = 'home';
  onboardingStep.value = 0;
  onboardingOpen.value = true;
}

async function factoryResetMobile() {
  if (!window.confirm(t('factoryResetConfirm') || mobileFactoryResetConfirm)) return;
  try {
    await createBackupProfile(t('beforeFactoryResetBackupProfile'));
  } catch (error) {
    if (!window.confirm(`${t('backupProfileSaveFailed')}: ${String(error)}\n${t('continueFactoryResetWithoutBackup')}`)) return;
  }

  const fresh = defaultState();
  Object.assign(state, fresh);
  localStorage.removeItem(mobileStateKey);
  localStorage.removeItem(mobileOnboardingKey);
  onboardingProfile.height_cm = fresh.profile.height_cm;
  onboardingProfile.current_weight_kg = fresh.profile.current_weight_kg;
  onboardingProfile.birthday = fresh.profile.birthday;
  onboardingProfile.gender = fresh.profile.gender;
  onboardingProfile.activity_level = fresh.profile.activity_level;
  onboardingProfile.weekly_goal_kg = fresh.profile.weekly_goal_kg;
  settingsDialog.value = null;
  settingsOpen.value = false;
  activeTab.value = 'home';
  onboardingOpen.value = true;
  onboardingStep.value = 0;
  await refreshBackupProfiles();
  showToast(t('factoryReset'));
}


function updateContentScrolled() {
  contentScrolled.value = window.scrollY > 8;
}

onMounted(() => {
  void navigator.storage?.persist?.();
  void refreshBackupProfiles();
  void ensureDailyBackupProfile();
  void syncGitHubDailyIfDue();
  void checkForAppUpdates({ quiet: true });
  maybeOpenOnboarding();
  refreshTodayKey();
  scheduleTodayRollover();
  updateKeyboardOffset();
  updateContentScrolled();
  window.visualViewport?.addEventListener('resize', updateKeyboardOffset);
  window.visualViewport?.addEventListener('scroll', updateKeyboardOffset);
  window.addEventListener('scroll', updateContentScrolled, { passive: true });
  document.addEventListener('focusin', scrollFocusedInputIntoView);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  resetBackTrap();
  window.addEventListener('popstate', handleBackNavigation);
  window.addEventListener('nutrino:android-back', handleNativeAndroidBack);
  window.addEventListener('nutrino:android-update-installer', handleAndroidUpdateInstallerEvent);
  window.addEventListener('nutrino:notification-action', handleNativeNotificationActionEvent);
  (window as unknown as { __NUTRINO_NOTIFICATION_BRIDGE_READY__?: boolean }).__NUTRINO_NOTIFICATION_BRIDGE_READY__ = true;
  consumeNativePendingNotificationAction();
  void installWindowCloseGuard();
  void refreshAppPermissionStatuses();
  void initializeNotifications();
  if (state.settings.desktop_api_enabled !== false) void pollServerHealth({ syncOnChange: true, quiet: true });
  healthTimer = window.setInterval(() => void pollServerHealth({ syncOnChange: true, quiet: true }), 30000);
  reminderTimer = window.setInterval(checkReminderNotifications, 60000);
  checkReminderNotifications();
});

onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', updateKeyboardOffset);
  window.visualViewport?.removeEventListener('scroll', updateKeyboardOffset);
  window.removeEventListener('scroll', updateContentScrolled);
  document.removeEventListener('focusin', scrollFocusedInputIntoView);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('popstate', handleBackNavigation);
  window.removeEventListener('nutrino:android-back', handleNativeAndroidBack);
  window.removeEventListener('nutrino:android-update-installer', handleAndroidUpdateInstallerEvent);
  window.removeEventListener('nutrino:notification-action', handleNativeNotificationActionEvent);
  (window as unknown as { __NUTRINO_NOTIFICATION_BRIDGE_READY__?: boolean }).__NUTRINO_NOTIFICATION_BRIDGE_READY__ = false;
  uninstallWindowCloseGuard();
  if (healthTimer) window.clearInterval(healthTimer);
  if (reminderTimer) window.clearInterval(reminderTimer);
  if (reminderScheduleRefreshTimer) window.clearTimeout(reminderScheduleRefreshTimer);
  void notificationActionListener?.unregister();
  onboardingDriver?.destroy();
  onboardingDriver = null;
  if (todayRolloverTimer) window.clearTimeout(todayRolloverTimer);
  if (backTrapRearmingTimer) window.clearTimeout(backTrapRearmingTimer);
  if (highlightedReviewTimer) window.clearTimeout(highlightedReviewTimer);
  closeScanner();
});

const activeLogDateKey = computed(() => activeTab.value === 'home' ? todayKey.value : selectedDate.value);
const currentDayIntakes = computed(() => state.intakes.filter((entry) => inSelectedDay(entry.consumed_at)));
const currentDayActivities = computed(() => state.activityLogs.filter((entry) => inSelectedDay(entry.performed_at)));
const currentDayWeight = computed(() => latestWeightForDay(state.weightLogs, activeLogDateKey.value));
const currentDayWeightKg = computed(() => currentDayWeight.value?.weight_kg ?? state.profile.current_weight_kg);
const currentWeight = computed(() => currentDayWeightKg.value);
const profileForActiveDay = computed(() => ({ ...state.profile, current_weight_kg: currentWeight.value }));
const currentBmi = computed(() => bmi(currentWeight.value, state.profile.height_cm));
const bmiInfo = computed(() => bmiStatus(currentBmi.value));
const age = computed(() => ageFromBirthday(state.profile.birthday));
const burnedKcal = computed(() => Math.round(currentDayActivities.value.reduce((sum, entry) => sum + entry.kcal, 0)));
const exerciseEatbackRatio = computed(() => Math.max(0, Math.min(1, Number(state.settings.exercise_kcal_eatback_percent ?? 50) / 100)));
const creditedBurnedKcal = computed(() => Math.round(burnedKcal.value * exerciseEatbackRatio.value));
const baseDailyGoal = computed(() => dailyKcalGoal(profileForActiveDay.value, 0) + Number(state.settings.kcal_adjustment || 0));
const dailyGoal = computed(() => dailyKcalGoal(profileForActiveDay.value, burnedKcal.value) + Number(state.settings.kcal_adjustment || 0));
const consumedKcal = computed(() => Math.round(currentDayIntakes.value.reduce((sum, entry) => sum + intakeKcal(entry), 0)));
const calorieDeficitEnabled = computed(() => state.settings.calorie_deficit_enabled === true);
const targetDeficitKcal = computed(() => calorieDeficitEnabled.value ? Math.max(0, Math.round(Number(state.settings.target_deficit_kcal || 0))) : 0);
const effectiveDailyGoal = computed(() => calorieDeficitEnabled.value
  ? Math.max(0, baseDailyGoal.value + creditedBurnedKcal.value - targetDeficitKcal.value)
  : dailyGoal.value);
const kcalLeft = computed(() => dailyGoal.value - consumedKcal.value);
const deficitKcalLeft = computed(() => effectiveDailyGoal.value - consumedKcal.value);
const kcalGaugeValue = computed(() => clamp(consumedKcal.value / Math.max(1, dailyGoal.value)));
const deficitMarkerProgress = computed(() => calorieDeficitEnabled.value ? clamp(effectiveDailyGoal.value / Math.max(1, dailyGoal.value)) : 0);
const kcalDeficitMarkerStyle = computed(() => {
  const arcDegrees = 360 * 0.78;
  const markerAngle = 128 + deficitMarkerProgress.value * arcDegrees;
  const angle = markerAngle * Math.PI / 180;
  // Keep the marker centered inside the ring stroke so it does not protrude
  // outside or inward while still pointing at the exact deficit boundary.
  const markerRadiusPercent = 41;
  const x = Math.cos(angle) * markerRadiusPercent;
  const y = Math.sin(angle) * markerRadiusPercent;
  return {
    left: `calc(50% + ${x.toFixed(3)}%)`,
    top: `calc(50% + ${y.toFixed(3)}%)`,
    transform: `translate(-50%, -50%) rotate(${(markerAngle + 90).toFixed(1)}deg)`,
  };
});
const kcalCenterSource = computed(() => kcalLeft.value);
const kcalCenterValue = computed(() => Math.round(kcalCenterSource.value < 0 ? Math.abs(kcalCenterSource.value) : Math.min(kcalCenterSource.value, dailyGoal.value)));
const kcalCenterLabel = computed(() => kcalLeft.value < 0 ? 'tooMuch' : 'kcalLeft');
const kcalFullRemainingLabel = computed(() => kcalLeft.value < 0
  ? `${Math.abs(Math.round(kcalLeft.value))} kcal ${t('overDailyLimit')}`
  : `${Math.round(kcalLeft.value)} kcal ${t('kcalLeft')}`);
const kcalProgressDash = computed(() => `${kcalArcLength * kcalGaugeValue.value} ${ringCircumference}`);
const kcalRingToneClass = computed(() => kcalTone(consumedKcal.value, effectiveDailyGoal.value, dailyGoal.value));
const deficitStatusText = computed(() => {
  if (!calorieDeficitEnabled.value) return `${Math.round(kcalLeft.value)} kcal ${t('kcalLeft')}`;
  if (deficitKcalLeft.value >= 0) return `${Math.round(deficitKcalLeft.value)} kcal ${t('safeKcalLeft')}`;
  if (kcalLeft.value >= 0) return `${Math.abs(Math.round(deficitKcalLeft.value))} kcal ${t('overDeficitButWithinLimit')}`;
  return `${Math.abs(Math.round(kcalLeft.value))} kcal ${t('overDailyLimit')}`;
});
const deficitHelpTitle = computed(() => currentLocale().startsWith('hu') ? 'Mit jelent a deficit cél?' : 'What does the deficit target mean?');
const deficitHelpBody = computed(() => {
  const full = Math.round(dailyGoal.value);
  const effective = Math.round(effectiveDailyGoal.value);
  const consumed = Math.round(consumedKcal.value);
  const deficitLeft = Math.round(deficitKcalLeft.value);
  if (currentLocale().startsWith('hu')) {
    return calorieDeficitEnabled.value
      ? `A napi maximumod ${full} kcal a teljes mozgásjóváírással. A deficit cél ebből levonja a ${targetDeficitKcal.value} kcal biztonsági tartalékot, majd hozzáadja a beállított mozgásjóváírást (${creditedBurnedKcal.value}/${burnedKcal.value} kcal). Így a mai deficites cél ${effective} kcal. Eddig ${consumed} kcal-t vittél be, ezért ${deficitLeft >= 0 ? deficitLeft + ' kcal maradt a deficit cél előtt' : Math.abs(deficitLeft) + ' kcal-lal vagy a deficit cél felett'}. A nagy kör továbbra is a teljes napi maximumhoz viszonyít, és csak a teljes keret túllépése után megy pirosba.`
      : `A biztonsági deficit ki van kapcsolva, ezért a napi maximumod ${full} kcal, és ebből nem von le külön tartalékot az app.`;
  }
  return calorieDeficitEnabled.value
    ? `Your full daily maximum is ${full} kcal with the full exercise credit. The deficit target subtracts the ${targetDeficitKcal.value} kcal safety buffer, then adds the configured exercise credit (${creditedBurnedKcal.value}/${burnedKcal.value} kcal). Today's effective deficit target is ${effective} kcal. You have logged ${consumed} kcal, so you are ${deficitLeft >= 0 ? deficitLeft + ' kcal before the target deficit' : Math.abs(deficitLeft) + ' kcal over the target deficit'}. The large ring still follows the full daily maximum and turns red only after the full limit is exceeded.`
    : `Safety deficit tracking is off, so your daily maximum is ${full} kcal and no extra buffer is subtracted.`;
});
const protein = computed(() => Math.round(totalMacro('protein_per_100g')));
const carbs = computed(() => Math.round(totalMacro('carbs_per_100g')));
const fat = computed(() => Math.round(totalMacro('fat_per_100g')));
const macroGoals = computed(() => {
  const kcal = Math.max(1, calorieDeficitEnabled.value ? effectiveDailyGoal.value : dailyGoal.value);
  return {
    carbs: Math.max(1, Math.round((kcal * (state.settings.macro_carbs_percent || 60) / 100) / 4)),
    fat: Math.max(1, Math.round((kcal * (state.settings.macro_fat_percent || 25) / 100) / 9)),
    protein: Math.max(1, Math.round((kcal * (state.settings.macro_protein_percent || 15) / 100) / 4)),
  };
});
const macros = computed(() => [
  { label: 'carbs', value: carbs.value, goal: macroGoals.value.carbs, progress: clamp(carbs.value / macroGoals.value.carbs) },
  { label: 'fat', value: fat.value, goal: macroGoals.value.fat, progress: clamp(fat.value / macroGoals.value.fat) },
  { label: 'protein', value: protein.value, goal: macroGoals.value.protein, progress: clamp(protein.value / macroGoals.value.protein) },
]);
const pendingCount = computed(() => 0);
const weightPromptDue = computed(() => (state.settings.daily_weight_reminder_enabled || state.settings.weekly_weight_average_enabled) ? !latestWeightForDay(state.weightLogs, todayKey.value) : needsWeightPrompt(state.profile, state.weightLogs));
function catalogItemVisible(item: { inactive?: boolean | null }) {
  return state.settings.include_inactive_catalog_items || item.inactive !== true;
}

const allCatalogItems = computed(() => catalogItems(state).filter(catalogItemVisible));

const latestIngredientUpdatedAt = computed(() => latestUpdatedAt(state.ingredients));
const latestFoodUpdatedAt = computed(() => latestUpdatedAt(state.foods));
const latestRecipeUpdatedAt = computed(() => latestUpdatedAt(state.recipes));
const latestActivityUpdatedAt = computed(() => latestUpdatedAt(state.activities));

function latestUpdatedAt(items: Array<{ updated_at?: number | null; deleted_at?: number | null }>): number | null {
  const latest = items.filter((item) => !item.deleted_at).reduce((max, item) => Math.max(max, Number(item.updated_at || 0)), 0);
  return latest > 0 ? latest : null;
}

function formatFreshness(value: number | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

function catalogKindLabel(item: Food): string {
  if (item.id.startsWith('recipe:')) return t('recipe');
  return item.catalog_kind === 'ingredient' ? t('ingredient') : t('food');
}

function catalogItemKind(item: Food): LocalEditorKind {
  if (item.id.startsWith('recipe:')) return 'recipe';
  if (item.id.startsWith('ingredient:')) return 'ingredient';
  return 'food';
}

function catalogItemRawId(item: Food): string {
  if (item.id.startsWith('recipe:')) return item.id.slice('recipe:'.length);
  if (item.id.startsWith('ingredient:')) return item.id.slice('ingredient:'.length);
  return item.id;
}

function catalogSourceKind(item: { catalog_source_kind?: CatalogSourceKind | null; source_id?: string | null }): CatalogSourceKind {
  const kind = item.catalog_source_kind;
  if (kind === 'desktop' || kind === 'github' || kind === 'custom' || kind === 'qr') return kind;
  const sourceId = String(item.source_id || '').trim();
  if (sourceId.startsWith('github:')) return 'github';
  if (sourceId.startsWith('mobile')) return 'custom';
  return sourceId ? 'desktop' : 'custom';
}

function catalogSourceTitle(item: { catalog_source_kind?: CatalogSourceKind | null; source_id?: string | null; source_label?: string | null }) {
  const label = String(item.source_label || '').trim();
  const sourceId = String(item.source_id || '').trim();
  const kind = catalogSourceKind(item);
  if (kind === 'github') return `${t('sourceGithub')}: ${label || sourceId.replace(/^github:/, '')}`;
  if (kind === 'desktop') return `${t('sourceDesktop')}: ${label || sourceId || t('sourceDesktop')}`;
  if (kind === 'qr') return t('sourceQr');
  return label || t('sourceCustom');
}

function catalogSourceBadgeClass(item: { catalog_source_kind?: CatalogSourceKind | null; source_id?: string | null }) {
  return `source-${catalogSourceKind(item)}`;
}

function catalogItemIsExternal(item: { catalog_source_kind?: CatalogSourceKind | null; source_id?: string | null }) {
  return catalogSourceKind(item) !== 'custom';
}

function catalogItemIsLocked(item: { locked?: boolean | null; catalog_source_kind?: CatalogSourceKind | null; source_id?: string | null }) {
  if (item.locked === true) return true;
  if (item.locked === false) return false;
  return state.settings.protect_external_catalog_items && catalogItemIsExternal(item);
}

function catalogItemRecord(item: Food | ActivityDefinition): { kind: LocalEditorKind; id: string; record: Food | Ingredient | Recipe | ActivityDefinition } | null {
  if ('kcal_per_100g' in item) {
    const kind = catalogItemKind(item);
    const id = catalogItemRawId(item);
    if (kind === 'ingredient') {
      const record = state.ingredients.find((entry) => entry.id === id);
      return record ? { kind, id, record } : null;
    }
    if (kind === 'recipe') {
      const record = state.recipes.find((entry) => entry.id === id);
      return record ? { kind, id, record } : null;
    }
    const record = state.foods.find((entry) => entry.id === id);
    return record ? { kind, id, record } : null;
  }
  const record = state.activities.find((entry) => entry.id === item.id);
  return record ? { kind: 'activity', id: item.id, record } : null;
}

function patchCatalogRecord(kind: LocalEditorKind, id: string, patch: Partial<Food & Ingredient & Recipe & ActivityDefinition>, options: { touch?: boolean } = {}) {
  const now = Date.now();
  const touch = options.touch !== false;
  const decorate = <T extends { id: string; updated_at: number; source_id?: string; catalog_source_kind?: CatalogSourceKind | null; pending_sync?: boolean }>(entry: T): T => ({
    ...entry,
    ...patch,
    updated_at: touch ? now : entry.updated_at,
    pending_sync: touch && catalogSourceKind(entry) === 'custom' ? true : entry.pending_sync,
  });
  if (kind === 'ingredient') state.ingredients = state.ingredients.map((entry) => entry.id === id ? decorate(entry) : entry);
  else if (kind === 'food') state.foods = state.foods.map((entry) => entry.id === id ? decorate(entry) : entry);
  else if (kind === 'recipe') state.recipes = state.recipes.map((entry) => entry.id === id ? decorate(entry) : entry);
  else state.activities = state.activities.map((entry) => entry.id === id ? decorate(entry) : entry);
}

function toggleCatalogItemLock(item: Food | ActivityDefinition) {
  const target = catalogItemRecord(item);
  if (!target) return;
  const locked = catalogItemIsLocked(target.record);
  patchCatalogRecord(target.kind, target.id, { locked: !locked });
  showToast(locked ? t('catalogItemUnlocked') : t('catalogItemLocked'));
}

function toggleCatalogItemInactive(item: Food | ActivityDefinition) {
  const target = catalogItemRecord(item);
  if (!target) return;
  const inactive = target.record.inactive === true;
  patchCatalogRecord(target.kind, target.id, { inactive: !inactive });
  showToast(inactive ? t('catalogItemActivated') : t('catalogItemInactive'));
}

function sourceCheckedText(item: { source_checked_at?: number | null }) {
  return item.source_checked_at ? `${t('checked')}: ${new Date(item.source_checked_at).toLocaleString()}` : '';
}

function catalogSourceFingerprint(value: unknown): string {
  const ignored = new Set(['updated_at', 'source_checked_at', 'pending_sync']);
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>)
        .filter(([key]) => !ignored.has(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, normalize(nested)]));
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

function selectedFirst(items: Food[]) {
  const selected = selectedCatalogId.value;
  return [...items].sort((a, b) => {
    if (a.id === selected) return -1;
    if (b.id === selected) return 1;
    return localizedName(a).localeCompare(localizedName(b), currentLocale());
  });
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizedSearchValue(value: unknown): string {
  return normalizeSearchText(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function compactSearchText(value: string): string {
  return normalizedSearchValue(value).replace(/\s+/g, '');
}

function searchTokens(query: string): string[] {
  return normalizedSearchValue(query)
    .split(/\s+/gu)
    .map((token) => token.trim())
    .filter(Boolean);
}

function looseFieldMatches(query: string, value: unknown): boolean {
  const normalizedQuery = normalizedSearchValue(query);
  if (!normalizedQuery) return true;

  const normalizedTarget = normalizedSearchValue(value);
  if (!normalizedTarget) return false;
  if (normalizedTarget.includes(normalizedQuery)) return true;

  const compactQuery = compactSearchText(normalizedQuery);
  const compactTarget = compactSearchText(normalizedTarget);
  if (compactQuery.length >= 3 && compactTarget.includes(compactQuery)) return true;

  const tokens = searchTokens(normalizedQuery);
  return tokens.length > 0 && tokens.every((token) => normalizedTarget.includes(token));
}

function matchesSearchQuery(query: string, ...parts: unknown[]): boolean {
  return parts.some((part) => looseFieldMatches(query, part));
}

type CatalogSearchField = {
  scope: CatalogSearchScope;
  value: string;
  rank: number;
  allowCompactContains: boolean;
};

type CatalogSearchMatch = {
  item: Food;
  score: number;
  exact: boolean;
};

const catalogSearchScopeOptions: CatalogSearchScope[] = ['title', 'all', 'brand', 'category', 'description'];

function catalogSearchKindLabel(item: Food): string {
  return catalogKindLabel(item);
}

function catalogSearchFields(item: Food): CatalogSearchField[] {
  return [
    { scope: 'title', value: searchableLocalizedName(item), rank: 0, allowCompactContains: true },
    { scope: 'brand', value: item.brand ?? '', rank: 8, allowCompactContains: true },
    { scope: 'category', value: catalogSearchKindLabel(item), rank: 12, allowCompactContains: true },
    { scope: 'description', value: item.note ?? '', rank: 24, allowCompactContains: false },
  ];
}

function fieldSearchScore(query: string, field: CatalogSearchField): { score: number; exact: boolean } | null {
  const normalizedQuery = normalizedSearchValue(query);
  const normalizedTarget = normalizedSearchValue(field.value);
  if (!normalizedQuery || !normalizedTarget) return null;

  const compactQuery = compactSearchText(normalizedQuery);
  const compactTarget = compactSearchText(normalizedTarget);

  if (normalizedTarget === normalizedQuery || (compactQuery && compactTarget === compactQuery)) {
    return { score: field.rank, exact: true };
  }

  if (normalizedTarget.startsWith(`${normalizedQuery} `) || normalizedTarget.startsWith(normalizedQuery)) {
    return { score: 100 + field.rank, exact: false };
  }

  if (normalizedTarget.includes(normalizedQuery)) {
    return { score: 200 + field.rank, exact: false };
  }

  if (field.allowCompactContains && compactQuery.length >= 3 && compactTarget.includes(compactQuery)) {
    return { score: 260 + field.rank, exact: false };
  }

  const tokens = searchTokens(normalizedQuery);
  if (tokens.length > 1 && tokens.every((token) => normalizedTarget.includes(token))) {
    return { score: 320 + field.rank, exact: false };
  }

  return null;
}

function rankCatalogItem(item: Food, query: string, scope: CatalogSearchScope): CatalogSearchMatch | null {
  const fields = catalogSearchFields(item).filter((field) => scope === 'all' || field.scope === scope);
  let best: CatalogSearchMatch | null = null;

  for (const field of fields) {
    const match = fieldSearchScore(query, field);
    if (!match) continue;

    const candidate: CatalogSearchMatch = { item, score: match.score, exact: match.exact };
    if (!best || candidate.score < best.score || (candidate.exact && !best.exact)) best = candidate;
  }

  return best;
}

function sortCatalogMatches(left: CatalogSearchMatch, right: CatalogSearchMatch): number {
  if (left.score !== right.score) return left.score - right.score;
  return localizedName(left.item).localeCompare(localizedName(right.item), currentLocale());
}

const catalogSearchActive = computed(() => Boolean(search.value.trim()));
const catalogSearchResults = computed(() => {
  const q = search.value.trim();
  if (!q) return { exact: [] as Food[], suggestions: [] as Food[] };

  const exact: CatalogSearchMatch[] = [];
  const suggestions: CatalogSearchMatch[] = [];

  for (const item of allCatalogItems.value) {
    const match = rankCatalogItem(item, q, catalogSearchScope.value);
    if (!match) continue;
    if (match.exact) exact.push(match);
    else suggestions.push(match);
  }

  return {
    exact: exact.sort(sortCatalogMatches).map((match) => match.item),
    suggestions: suggestions.sort(sortCatalogMatches).map((match) => match.item),
  };
});

const catalogExactItems = computed(() => catalogSearchResults.value.exact);
const catalogSuggestedItems = computed(() => catalogSearchResults.value.suggestions.filter((item) => !catalogExactItems.value.some((exact) => exact.id === item.id)));
const catalogExactPickerItems = computed(() => catalogExactItems.value.filter((item) => item.id !== selectedCatalogId.value));
const catalogSuggestedPickerItems = computed(() => catalogSuggestedItems.value.filter((item) => item.id !== selectedCatalogId.value));
const catalogHasSearchResults = computed(() => catalogExactItems.value.length > 0 || catalogSuggestedItems.value.length > 0);

function mealNoteSuggestionKey(entry: Intake): string {
  const title = String(entry.note_title || itemTitle(foodFromIntake(entry)) || '').trim().toLowerCase();
  const description = String(entry.note_description || foodFromIntake(entry)?.note || '').trim().toLowerCase();
  const kcal = Math.round(intakeKcal(entry));
  return `${title}|${description}|${kcal}`;
}

const reusableMealNoteSuggestions = computed<MealNoteSuggestion[]>(() => {
  const q = search.value.trim();
  const byKey = new Map<string, MealNoteSuggestion>();

  for (const entry of state.intakes) {
    if (entry.item_type !== 'note') continue;
    const title = String(entry.note_title || itemTitle(foodFromIntake(entry)) || '').trim();
    if (!title) continue;
    const description = String(entry.note_description || foodFromIntake(entry)?.note || '').trim();
    const kcal = Math.round(intakeKcal(entry));
    if (!kcal || kcal <= 0) continue;
    if (q && !matchesSearchQuery(q, title, description, `${kcal} kcal`)) continue;

    const key = mealNoteSuggestionKey(entry);
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, { key, title, description, kcal, lastUsedAt: entry.consumed_at, count: 1 });
    } else {
      previous.count += 1;
      previous.lastUsedAt = Math.max(previous.lastUsedAt, entry.consumed_at);
    }
  }

  return [...byKey.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 8);
});

const visibleCatalogItems = computed(() => {
  if (catalogSearchActive.value) return [...catalogExactItems.value, ...catalogSuggestedItems.value];
  return selectedFirst(allCatalogItems.value);
});
const visibleRecipeItems = computed(() => visibleCatalogItems.value.filter((item) => item.id.startsWith('recipe:') && item.id !== selectedCatalogId.value));
const visibleIngredientItems = computed(() => visibleCatalogItems.value.filter((item) => item.id.startsWith('ingredient:') && item.id !== selectedCatalogId.value));
const visibleFoodItems = computed(() => visibleCatalogItems.value.filter((item) => !item.id.startsWith('recipe:') && !item.id.startsWith('ingredient:') && item.id !== selectedCatalogId.value));
const visibleActivities = computed(() => {
  const q = search.value.trim();
  const source = state.activities.filter(catalogItemVisible);
  if (!q) return source;
  return source.filter((item) => matchesSearchQuery(q, searchableLocalizedName(item), item.description, item.code, item.type, item.activity_type, activityType(item)));
});
const selectedCatalog = computed(() => findCatalogItem(state, selectedCatalogId.value));
const selectedRecipeComponents = computed(() => recipeComponentRows(selectedCatalogId.value));
const selectedCatalogIsRecipe = computed(() => Boolean(selectedCatalog.value?.id.startsWith('recipe:')));
const recipeIsCustomized = computed(() => selectedRecipeComponents.value.some((row) => Math.abs(Number(recipeIngredientAmounts.value[row.key] ?? row.baseAmount) - Number(row.baseAmount)) > 0.05));
const selectedActivity = computed(() => state.activities.find((item) => item.id === activityId.value));
const foodSelectionInProgress = computed(() => addMode.value === 'food' && mealEntryMode.value === 'catalog' && (!selectedCatalog.value || catalogPickerOpen.value));
const foodFormVisible = computed(() => mealEntryMode.value === 'catalog' && Boolean(selectedCatalog.value) && !catalogPickerOpen.value && !recipeCustomizeOpen.value);
const activitySelectionInProgress = computed(() => addMode.value === 'activity' && activitySource.value === 'activity_catalog' && (!selectedActivity.value || activityPickerOpen.value));
const activityFormVisible = computed(() => activitySource.value !== 'activity_catalog' || (Boolean(selectedActivity.value) && !activityPickerOpen.value));
const calendarCells = computed(() => buildCalendar(calendarMonth.value));



type LanguageOption = { code: AppLanguage; englishName: string; nativeName: string; locale: string; aliases: string[] };
const languageOptions: LanguageOption[] = [
  { code: 'system', englishName: 'System default', nativeName: 'System default', locale: 'en', aliases: ['auto', 'system'] },
  { code: 'en', englishName: 'English', nativeName: 'English', locale: 'en-US', aliases: ['en', 'eng'] },
  { code: 'hu', englishName: 'Hungarian', nativeName: 'Magyar', locale: 'hu-HU', aliases: ['hu', 'hun', 'magyar'] },
  { code: 'de', englishName: 'German', nativeName: 'Deutsch', locale: 'de-DE', aliases: ['de', 'deu', 'ger'] },
  { code: 'fr', englishName: 'French', nativeName: 'Français', locale: 'fr-FR', aliases: ['fr', 'fra'] },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский', locale: 'ru-RU', aliases: ['ru', 'rus'] },
  { code: 'uk', englishName: 'Ukrainian', nativeName: 'Українська', locale: 'uk-UA', aliases: ['uk', 'ua', 'ukr'] },
  { code: 'zh', englishName: 'Chinese', nativeName: '中文', locale: 'zh-CN', aliases: ['zh', 'cn', 'zho'] },
  { code: 'sk', englishName: 'Slovak', nativeName: 'Slovenčina', locale: 'sk-SK', aliases: ['sk', 'slo'] },
  { code: 'ro', englishName: 'Romanian', nativeName: 'Română', locale: 'ro-RO', aliases: ['ro', 'ron'] },
  { code: 'cs', englishName: 'Czech', nativeName: 'Čeština', locale: 'cs-CZ', aliases: ['cs', 'cz', 'ces'] },
  { code: 'sl', englishName: 'Slovenian', nativeName: 'Slovenščina', locale: 'sl-SI', aliases: ['sl', 'slv'] },
  { code: 'hr', englishName: 'Croatian', nativeName: 'Hrvatski', locale: 'hr-HR', aliases: ['hr', 'hrv'] },
  { code: 'pl', englishName: 'Polish', nativeName: 'Polski', locale: 'pl-PL', aliases: ['pl', 'pol'] },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', locale: 'es-ES', aliases: ['es', 'spa'] },
  { code: 'pt', englishName: 'Portuguese', nativeName: 'Português', locale: 'pt-PT', aliases: ['pt', 'por'] },
];
const supportedLanguageCodes = languageOptions.filter((language) => language.code !== 'system').map((language) => language.code) as Exclude<AppLanguage, 'system'>[];
const filteredLanguageOptions = computed(() => {
  const query = languageSearch.value.trim().toLowerCase();
  if (!query) return languageOptions;
  return languageOptions.filter((language) => [language.code, language.englishName, language.nativeName, ...language.aliases].join(' ').toLowerCase().includes(query));
});

const activeLanguage = computed<Exclude<AppLanguage, 'system'>>(() => {
  if (state.settings.language !== 'system' && supportedLanguageCodes.includes(state.settings.language as Exclude<AppLanguage, 'system'>)) {
    return state.settings.language as Exclude<AppLanguage, 'system'>;
  }
  const detected = String(navigator.language || 'en').slice(0, 2).toLowerCase() as Exclude<AppLanguage, 'system'>;
  return supportedLanguageCodes.includes(detected) ? detected : 'en';
});
const appVersion = APP_VERSION;
const repositoryUrl = 'https://github.com/rozsazoltan/nutrino';
const issueUrl = 'https://github.com/rozsazoltan/nutrino/issues/new/choose';
const starUrl = 'https://github.com/rozsazoltan/nutrino/stargazers';
const SERVER_STALE_MS = 5 * 60 * 1000;
const updateRemindLaterKey = `nutrino.mobile.${appChannel}.update.remindLater.v1`;
const selectedDayUnlocked = computed(() => activeTab.value === 'diary' && unlockedDiaryDate.value === selectedDate.value);
const selectedDateIsFuture = computed(() => dayStartMs(activeLogDateKey.value) > dayStartMs(todayKey.value));
const currentBmiInfo = computed(() => bmiStatus(currentBmi.value));
const diaryKcalTone = computed(() => kcalTone(consumedKcal.value, dailyGoal.value, dailyGoal.value));
const homeShellToneClass = computed(() => activeTab.value === 'home' ? `home-${diaryKcalTone.value}` : '');
const selectedDayAnalysis = computed(() => buildDailyAnalysis(selectedDate.value));
const selectedDayMacroSummary = computed(() => dayMacroSummary(selectedDate.value));
const selectedDayNutrientRows = computed(() => state.settings.show_micronutrients ? buildDailyNutrientRows(currentDayIntakes.value) : []);
const exceededNutrientCount = computed(() => selectedDayNutrientRows.value.filter((row) => row.isOver).length);
const activeNutrientInsightEntries = computed(() => {
  const dialog = nutrientInsightsDialog.value;
  if (!dialog || !state.settings.show_micronutrients) return [];
  if (dialog.kind === 'day') return currentDayIntakes.value;
  return currentDayIntakes.value.filter((entry) => entry.meal_type === dialog.mealType);
});
const nutrientInsightRows = computed(() => state.settings.show_micronutrients && nutrientInsightsDialog.value
  ? buildDailyNutrientRows(activeNutrientInsightEntries.value, currentDayIntakes.value)
  : []);
const nutrientInsightExceededCount = computed(() => nutrientInsightRows.value.filter((row) => row.isOver).length);
const nutrientInsightTitle = computed(() => {
  if (!nutrientInsightsDialog.value) return '';
  return nutrientInsightsDialog.value.kind === 'day'
    ? `${t('todayNutrients')} · ${selectedDate.value}`
    : `${t('mealMicronutrients')} · ${t(nutrientInsightsDialog.value.mealType)}`;
});
const nutrientChartSlices = computed(() => {
  if (!nutrientInsightsDialog.value) return [];
  return nutrientChartMode.value === 'important'
    ? buildMacroChartSlices(activeNutrientInsightEntries.value)
    : buildOptionalChartSlices(nutrientInsightRows.value);
});
const selectedDiaryDateLabel = computed(() => new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(dayStartMs(selectedDate.value))));
const currentDeficitStreak = computed(() => calculateDeficitStreak(selectedDate.value));
const bestDeficitStreak = computed(() => calculateBestDeficitStreak(30));
const analysisDailyRows = computed(() => buildDailyAnalysisRows(14, selectedDate.value));
const analysisWeightRows = computed(() => buildWeightTrendRows(weightTrendMode.value, 12, selectedDate.value));
const weightChartPoints = computed(() => buildWeightChartPoints(analysisWeightRows.value));
const calorieChartMax = computed(() => Math.max(1, ...analysisDailyRows.value.map((row) => Math.max(row.consumedKcal, row.dailyLimitKcal, row.effectiveLimitKcal))));
const calorieSuccessRate = computed(() => {
  const tracked = analysisDailyRows.value.filter((row) => row.tracked);
  if (!tracked.length) return 0;
  return Math.round(tracked.filter((row) => row.success).length * 100 / tracked.length);
});
const selectedCalorieChartRow = computed(() => analysisDailyRows.value.find((row) => row.key === (selectedCalorieRowKey.value || selectedDate.value)) || selectedDayAnalysis.value);
const selectedWeightChartRow = computed(() => analysisWeightRows.value.find((row) => row.key === selectedWeightRowKey.value) || analysisWeightRows.value.find((row) => row.selected) || analysisWeightRows.value.at(-1) || null);
const weightChartScale = computed(() => buildWeightChartScale(analysisWeightRows.value));

function selectAnalysisRowsForSelectedDate() {
  selectedCalorieRowKey.value = analysisDailyRows.value.some((row) => row.key === selectedDate.value)
    ? selectedDate.value
    : null;
  selectedWeightRowKey.value = analysisWeightRows.value.find((row) => row.selected)?.key || null;
}

function openAnalysis() {
  selectAnalysisRowsForSelectedDate();
  analysisOpen.value = true;
}

watch(analysisOpen, (open) => {
  if (open) selectAnalysisRowsForSelectedDate();
});

watch(analysisDailyRows, (rows) => {
  if (!rows.some((row) => row.key === selectedCalorieRowKey.value)) selectedCalorieRowKey.value = selectedDate.value;
}, { immediate: true });
watch(analysisWeightRows, (rows) => {
  if (!rows.some((row) => row.key === selectedWeightRowKey.value)) selectedWeightRowKey.value = rows.find((row) => row.selected)?.key || rows.at(-1)?.key || null;
}, { immediate: true });

watch([consumedKcal, effectiveDailyGoal, dailyGoal], () => {
  if (!state.settings.calorie_limit_warning_enabled || !calorieDeficitEnabled.value) return;
  if (consumedKcal.value <= effectiveDailyGoal.value) return;
  const key = `${todayKey.value}.deficit-limit`;
  if (reminderAlreadySent(key)) return;
  markReminderSent(key);
  notifyUser(t('deficitWarningTitle'), `${Math.round(consumedKcal.value - effectiveDailyGoal.value)} kcal ${t('overDeficitButWithinLimit')}`, {
    kind: 'deficit',
    actionTypeId: NOTIFICATION_ACTION_TYPES.deficit,
  });
});


const normalizeTranslationValues = (values: Partial<Record<string, string>>): Record<string, string> => Object.fromEntries(
  Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

const translations: Record<string, Record<string, string>> = {
  en: {
    home: 'Home', diary: 'Diary', recipes: 'Recipes', profile: 'Profile', settings: 'Settings', synced: 'Synced', syncing: 'Syncing', pending: 'pending',
    supplied: 'supplied', burned: 'burned', kcalLeft: 'kcal left', tooMuch: 'too much', activity: 'Activity', breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
    carbs: 'carbs', fat: 'fat', protein: 'protein', addBurnedKcal: 'Add burned kcal', startTheDay: 'Start the day', middayMeal: 'Midday meal', eveningMeal: 'Evening meal', smallMeals: 'Small meals', addNewItem: 'Add new item',
    unlockEditConfirm: 'Enable editing for this day? This prevents accidental changes to older diary days.', discardCurrentEditConfirm: 'Discard the current edit without saving?', finishSetupBeforeExit: 'Finish setup before leaving the app.', pressBackAgain: 'Press Back again within 5 seconds to exit.', noActivity: 'No activity logged for this day.', noEntries: 'No entries yet.', edit: 'Edit', delete: 'Delete', duplicate: 'Duplicate', duplicateEntry: 'Duplicate entry', duplicateMealTargetHint: 'Choose which meal should receive the duplicate.', moveToMeal: 'Move to meal', entryActions: 'Entry actions', entryDuplicated: 'Entry duplicated.', entryMoved: 'Entry moved.',
    units: 'Units', calculations: 'Calculations', language: 'Language', privacy: 'Privacy Settings', about: 'About', licenses: 'Licenses', thirdPartyNotices: 'Third-party notices', acknowledgements: 'Acknowledgements', exportImport: 'Export / Import App Data', clearCache: 'Clear cached items',
    dailyReminder: 'Daily Reminder', trackingReminders: 'Tracking & reminders', weeklyWeightAverage: 'Weekly weight average', weeklyWeightAverageHint: 'Calculate weekly average weight for each Sunday.', dailyWeightReminder: 'Daily weight reminder', dailyWeightReminderTime: 'Daily weight reminder time', mealReminders: 'Meal logging reminders', mealReminderMorning: 'Log breakfast or your morning meal.', mealReminderNoon: 'Log lunch or your midday meal.', mealReminderAfternoon: 'Log dinner, snack or your afternoon meal.', mealReminderTitle: 'Meal reminder', weightReminderTitle: 'Weight reminder', weightReminderBody: 'Add today’s body weight so the weekly average stays useful.', calorieDeficitTracking: 'Safety deficit tracking', targetDeficit: 'Target safety deficit', calorieLimitWarning: 'Warn when target deficit is exceeded', exerciseKcalEatback: 'Exercise calories to eat back', eatbackNone: 'Do not eat back exercise kcal', eatbackHalf: 'Eat back half', eatbackFull: 'Eat back all', requestNotifications: 'Enable notifications', notificationsUnsupported: 'Notifications are not supported here.', notificationsEnabled: 'Notifications enabled.', notificationsNotEnabled: 'Notifications were not enabled.', deficitWarningTitle: 'Deficit limit exceeded', deficitKcalLeft: 'deficit kcal left', safeKcalLeft: 'left before target deficit', overDeficit: 'over deficit', overDeficitButWithinLimit: 'over the target deficit, still within daily limit', overDailyLimit: 'over the daily limit', deficitOffHint: 'Safety deficit is off.', analysis: 'Analysis', openAnalysis: 'Open analysis', closeAnalysis: 'Close analysis', weightTrend: 'Weight trend', calorieTrend: 'Calorie trend', deficitStreak: 'Deficit streak', currentStreak: 'Current streak', bestStreak: 'Best streak', successRate: 'Success rate', days: 'days', weeklyAverage: 'Weekly average', limitedData: 'limited data', noWeightTrend: 'Add weight entries to see the selected weight trend.', fullLimit: 'full limit', effectiveLimit: 'deficit target', exerciseCredit: 'exercise credit', legend: 'Legend', consumedLegend: 'Consumed kcal', weightLegendValue: 'Weight value', theme: 'Theme', showActivity: 'Show Activity Tracking', showMacros: 'Show Meal Macros', showMicros: 'Show Micronutrients',
    metric: 'Metric (kg, cm, ml)', imperial: 'Imperial (lbs, ft, oz)', systemDefault: 'System default', english: 'English', hungarian: 'Hungarian', scan: 'Scan', languageSearch: 'Search language by English name, native name or code…', translations: 'Translations', noTranslations: 'No translations yet.', addTranslation: 'Add translation', cancel: 'Cancel', ok: 'OK', reset: 'Reset',
    unlockDay: 'Unlock day editing', lockedNote: 'Unlock editing before changing entries on this day.', editingEnabled: 'Editing enabled', selectedDayEntriesNote: 'Food and activity entries for the selected calendar day are shown below.', mealNotesToReview: 'Meal notes to review', mealNotesToReviewHint: 'These notes stay on this phone. Open the day to replace them with real foods later, or keep them as final notes.', openDay: 'Open day', keepAsNote: 'Keep as note', noMealNotesToReview: 'No meal notes need review.', previousMealNotes: 'Previous notes', useNote: 'Use note', convertToCatalogItem: 'Convert to food', convertNoteToCatalogHint: 'Replace this note with an ingredient, food or recipe.', localOnlyDiaryHint: 'Diary entries and activity logs stay local on mobile.', target: 'target', weight: 'weight', saveWeight: 'Save weight', weightForThisDay: 'Weight for this day in kg', editWeight: 'Edit weight', futureDateWarning: 'This date is in the future. Logging future diary data can make your diary inaccurate. Continue anyway?', weeklyWeightCheck: 'Weekly weight check', weeklyWeightCheckBody: 'Update your weight once a week. If it does not change, nutrino keeps using the latest known value.', save: 'Save', addTo: 'Add to', add: 'Add', update: 'Update', addActivity: 'Add activity', updateActivity: 'Update activity', customRecipe: 'Customize recipe', customRecipeHint: 'Changes are saved only for this diary entry.', customizedRecipe: 'custom recipe', editRecipeLocally: 'Edit recipe for this entry', changeSelection: 'Change food/recipe', selected: 'Selected', baseAmount: 'base', onePiece: '1 pc', selectFoodFirst: 'Select a food or recipe first.', amountGreaterThanZero: 'Amount must be greater than zero.', enterValidWeight: 'Enter a valid weight in kg.', weightSaved: 'Weight saved.', activityUpdated: 'Activity updated.', activityAdded: 'Activity added.', activities: 'activities', entries: 'entries', foodAndRecipeSearch: 'Search foods and recipes', searchIn: 'Search in', searchScopeTitle: 'Title', searchScopeAll: 'All', searchScopeBrand: 'Brand', searchScopeCategory: 'Category', searchScopeDescription: 'Description', exactMatches: 'Exact matches', maybeYouMean: 'Maybe you meant', activitySearch: 'Search activities', recipe: 'Recipe', food: 'Food', ingredient: 'Ingredient', grams: 'grams', pieces: 'pieces', catalog: 'Catalog', watch: 'Watch', manual: 'Manual', minutes: 'minutes', kcalFromWatchManual: 'kcal from watch/manual', exportAppData: 'Export app data', exportAppDataBody: 'Save a full local ZIP backup.', importAppData: 'Import app data', importAppDataBody: 'Select a nutrino mobile app ZIP backup.', channelDataTransfer: 'Dev / stable data transfer', channelDataTransferBody: 'Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.', updateDevFromStable: 'Update dev from stable backup', updateStableFromDev: 'Update stable from dev backup', exportDevForStable: 'Create package for stable', exportStableForDev: 'Create package for dev', confirmChannelTransferImport: 'This will overwrite the current app data with a backup from the other installed channel. Continue?', channelTransferExportProfile: 'Channel transfer export', beforeChannelTransferImportBackupProfile: 'Before channel transfer import', channelTransferImportProfile: 'Channel transfer import', channelTransferExportCreated: 'Channel transfer package created.', channelTransferImported: 'Data imported from the other channel.', activityLevel: 'Activity', activityLevelHint: 'Used for daily kcal target', weeklyGoal: 'Weekly goal', perWeek: 'kg / week', height: 'Height', age: 'Age', years: 'years', gender: 'Gender', apiSettings: 'API settings', appChannel: 'Channel', devApiHint: 'Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop server requires one.', apiUrl: 'API URL', pairingPassword: 'Server password', pairingToken: 'Pairing token', addKcalNote: 'Note', existingItem: 'Existing', noteEntry: 'Note', kcalNoteTitle: 'Note title', kcalNoteDescription: 'Description', kcalNoteValue: 'kcal', localCatalogActions: 'Local catalog actions', addLocalIngredient: 'Add local ingredient', addLocalFood: 'Add local food', addLocalRecipe: 'Add local recipe', addLocalActivity: 'Add local activity', localItemCreated: 'Local item saved. Sync when the desktop server is reachable.', genderHint: 'Used for kcal estimate', male: 'Male', female: 'Female', nonBinary: 'Non-binary', test: 'Test', syncNow: 'Load data from server', pushNow: 'Send data to server', pullFailedOffline: 'Download failed. Local data remains available.', pushFailedOffline: 'Upload failed. Local data stays pending until the server is reachable.', dailyBackupProfile: 'Daily automatic backup profile', online: 'Online', available: 'Available', offline: 'Offline', serverOffline: 'Desktop server is offline.', serverOfflineUsingCache: 'Desktop server is offline. Using local cached catalog.', deleteEntryConfirm: 'Delete this entry?', deleteActivityConfirm: 'Delete this activity?', exportCanceled: 'Export canceled.', importCanceled: 'Import canceled.', foods: 'Foods', noSyncedItems: 'No synced foods or recipes yet. Start the desktop server or add a GitHub CSV source and sync.', appDataExportCreated: 'App data export created.', appDataImported: 'App data imported.', importFailed: 'Import failed', confirmImportOverwrite: 'This backup will overwrite all current local app data. Continue?', invalidBackupFile: 'This is not a valid nutrino mobile app backup.', clearCachedConfirm: 'Clear synced foods, recipes, activities and merge aliases from the mobile cache? Diary logs remain on the device. The next server download will reload a full catalog snapshot.', cachedCatalogCleared: 'Cached catalog cleared. The next server download will fully reload the catalog.', privacyBody: 'nutrino stores your profile, diary, food cache and activity data locally on your device. The app only talks to your paired desktop server on your network. We do not collect, sell or upload your data to third-party services.', reportIssue: 'Report an issue', reportIssueBody: 'Open GitHub Issues to report bugs or request features.', openRepository: 'Open GitHub repository', openRepositoryBody: 'View the source code, README and releases.', starProject: 'Star nutrino on GitHub', starProjectBody: 'If nutrino is useful, a star helps the project.', license: 'License', sourceCode: 'Source code', factoryReset: 'Factory reset', factoryResetBody: 'Delete all local app data and restart onboarding.', factoryResetConfirm: 'This deletes all local mobile diary, profile, cached catalog and settings data. Continue?', onboardingTitle: 'Set up nutrino', onboardingIntro: 'Add your basic profile so kcal, BMI and goals can be calculated.', onboardingProfile: 'Profile basics', onboardingTour: 'Quick tour', onboardingTourBody: 'Home shows calories and macros. Diary shows your calendar. Recipes lists synced catalog items. Profile stores your body and goal settings.', finishSetup: 'Finish setup', next: 'Next', back: 'Back', startUsingNutrino: 'Start using nutrino', restoreBackup: 'Restore backup', restore: 'Restore', backupProfiles: 'Backup profiles', backupProfilesBody: 'Local restore points are stored separately from your normal profile and survive in-app factory reset.', noBackupProfiles: 'No local backup profiles yet.', createBackupProfile: 'Create backup profile', manualBackupProfile: 'Manual backup profile', exportBackupProfile: 'Export restore point', beforeFactoryResetBackupProfile: 'Before factory reset', beforeImportBackupProfile: 'Before import', importBackupProfile: 'Imported backup', beforeBackupProfileRestore: 'Before backup profile restore', restoreBackupProfile: 'Restore local profile', backupProfileCreated: 'Backup profile saved.', backupProfileDeleted: 'Backup profile deleted.', backupProfileRestored: 'Backup profile restored.', backupProfileMissing: 'Backup profile is no longer available.', confirmRestoreBackupProfile: 'Restore this local backup profile? Current app data will be saved as a safety restore point first.', backupProfileSaveFailed: 'Could not save a local backup profile', backupProfilesUnavailable: 'Backup profile storage is unavailable on this device.', continueFactoryResetWithoutBackup: 'Continue factory reset without a safety restore point?', continueExternalExport: 'Continue external ZIP export anyway?', emptyBackupFile: 'The selected backup file is empty (0 B).', backupVerifySizeMismatch: 'Export verification size mismatch:', backupVerifyFailed: 'External ZIP export could not be verified; a browser download fallback was attempted.', backupProfileStillAvailable: 'A local backup profile is still available in the app.', exportFailed: 'Export failed', backupWriteFailed: 'Backup file write failed', mobileShareUnavailable: 'This device does not support safe mobile ZIP sharing. The unstable mobile save/download export was not used, so no 0 B ZIP was created.', mobileShareSheetHint: 'Choose Files, Drive or another storage app in the system share sheet.',
  },
  hu: {
    home: 'Kezdőlap', diary: 'Napló', recipes: 'Receptek', profile: 'Profil', settings: 'Beállítások', synced: 'Szinkronban', syncing: 'Szinkronizálás', pending: 'függő',
    supplied: 'bevitt', burned: 'elégetett', kcalLeft: 'kcal maradt', tooMuch: 'túllépve', activity: 'Aktivitás', breakfast: 'Reggeli', lunch: 'Ebéd', dinner: 'Vacsora', snack: 'Snack',
    carbs: 'szénhidrát', fat: 'zsír', protein: 'fehérje', addBurnedKcal: 'Elégetett kcal hozzáadása', startTheDay: 'Napindító étkezés', middayMeal: 'Déli étkezés', eveningMeal: 'Esti étkezés', smallMeals: 'Kisebb étkezések', addNewItem: 'Új tétel hozzáadása',
    unlockEditConfirm: 'Feloldod ennek a napnak a szerkesztését? Ez segít elkerülni a véletlen módosításokat régebbi napokon.', discardCurrentEditConfirm: 'Bezárod az aktuális szerkesztést mentés nélkül?', finishSetupBeforeExit: 'Fejezd be a beállítást, mielőtt kilépsz az appból.', pressBackAgain: 'Nyomd meg újra a vissza gombot 5 másodpercen belül a kilépéshez.', noActivity: 'Nincs aktivitás erre a napra.', noEntries: 'Még nincs bejegyzés.', edit: 'Szerkesztés', delete: 'Törlés',
    units: 'Mértékegységek', calculations: 'Számítások', language: 'Nyelv', privacy: 'Adatvédelem', about: 'Névjegy', licenses: 'Licencek', thirdPartyNotices: 'Third-party notices', acknowledgements: 'Köszönetnyilvánítás', exportImport: 'Appadat export / import', clearCache: 'Gyorsítótár törlése',
    dailyReminder: 'Napi emlékeztető', theme: 'Téma', showActivity: 'Aktivitás követése', showMacros: 'Makrók megjelenítése', showMicros: 'Mikrotápanyagok megjelenítése',
    metric: 'Metrikus (kg, cm, ml)', imperial: 'Angolszász (lbs, ft, oz)', systemDefault: 'Rendszer alapértelmezett', english: 'Angol', hungarian: 'Magyar', scan: 'Scan', languageSearch: 'Keress angol névvel, saját névvel vagy kóddal…', translations: 'Fordítások', noTranslations: 'Még nincs fordítás.', addTranslation: 'Fordítás hozzáadása', cancel: 'Mégse', ok: 'OK', reset: 'Visszaállítás',
    unlockDay: 'Nap szerkesztésének feloldása', lockedNote: 'A nap módosításához előbb oldd fel a szerkesztést.', editingEnabled: 'Szerkesztés engedélyezve', selectedDayEntriesNote: 'A kiválasztott nap étkezései és aktivitásai lent láthatók.', mealNotesToReview: 'Átnézendő étkezési jegyzetek', mealNotesToReviewHint: 'Ezek a jegyzetek a telefonon maradnak. Nyisd meg a napot, ha később valódi ételre cserélnéd, vagy jelöld végleges jegyzetként.', openDay: 'Nap megnyitása', keepAsNote: 'Maradjon jegyzet', noMealNotesToReview: 'Nincs átnézendő étkezési jegyzet.', localOnlyDiaryHint: 'A naplóbejegyzések és aktivitásnaplók mobilon maradnak.', target: 'cél', weight: 'súly', saveWeight: 'Súly mentése', weightForThisDay: 'Súly erre a napra kg-ban', editWeight: 'Súly szerkesztése', futureDateWarning: 'Ez a nap még a jövőben van. A jövőbeli naplózás pontatlanná teheti a naplódat. Biztosan folytatod?', weeklyWeightCheck: 'Heti súlyellenőrzés', weeklyWeightCheckBody: 'Hetente egyszer frissítsd a súlyod. Ha nem változik, a nutrino az utolsó ismert értékkel számol.', save: 'Mentés', addTo: 'Hozzáadás ehhez:', add: 'Hozzáadás', update: 'Frissítés', addActivity: 'Aktivitás hozzáadása', updateActivity: 'Aktivitás frissítése', customRecipe: 'Recept testreszabása', customRecipeHint: 'A módosítás csak ehhez a naplóbejegyzéshez mentődik.', customizedRecipe: 'egyedi recept', editRecipeLocally: 'Recept módosítása ehhez a bejegyzéshez', changeSelection: 'Étel/recept módosítása', selected: 'Kiválasztva', baseAmount: 'alap', onePiece: '1 db', selectFoodFirst: 'Előbb válassz ételt vagy receptet.', amountGreaterThanZero: 'A mennyiségnek nullánál nagyobbnak kell lennie.', enterValidWeight: 'Adj meg érvényes súlyt kg-ban.', weightSaved: 'Súly mentve.', activityUpdated: 'Aktivitás frissítve.', activityAdded: 'Aktivitás hozzáadva.', activities: 'aktivitás', entries: 'bejegyzés', foodAndRecipeSearch: 'Ételek és receptek keresése', searchIn: 'Keresés helye', searchScopeTitle: 'Cím', searchScopeAll: 'Minden', searchScopeBrand: 'Márka', searchScopeCategory: 'Típus', searchScopeDescription: 'Leírás', exactMatches: 'Pontos találatok', maybeYouMean: 'Talán erre gondoltál', activitySearch: 'Aktivitások keresése', recipe: 'Recept', food: 'Étel', ingredient: 'Alapanyag', grams: 'gramm', pieces: 'db', catalog: 'Katalógus', watch: 'Okosóra', manual: 'Kézi', minutes: 'perc', kcalFromWatchManual: 'kcal okosórából/kézzel', exportAppData: 'Appadatok exportálása', exportAppDataBody: 'Teljes helyi ZIP mentés készítése.', importAppData: 'Appadatok importálása', importAppDataBody: 'Válassz nutrino mobilapp ZIP mentést.', channelDataTransfer: 'Dev / stable adatátadás', channelDataTransferBody: 'Androidon a dev és stable két külön app. Közvetlenül nem olvashatják egymás privát tárhelyét, ezért az átadás explicit ZIP csomagon keresztül történik.', updateDevFromStable: 'Dev frissítése stable mentésből', updateStableFromDev: 'Stable frissítése dev mentésből', exportDevForStable: 'Csomag készítése stable-nek', exportStableForDev: 'Csomag készítése devnek', confirmChannelTransferImport: 'Ez felülírja a jelenlegi appadatokat a másik telepített csatorna mentésével. Folytatod?', channelTransferExportProfile: 'Csatornaátadás export', beforeChannelTransferImportBackupProfile: 'Csatornaátadás import előtt', channelTransferImportProfile: 'Csatornaátadás import', channelTransferExportCreated: 'Csatornaátadási csomag elkészült.', channelTransferImported: 'Adatok importálva a másik csatornából.', activityLevel: 'Aktivitás', activityLevelHint: 'A napi kcal cél számításához', weeklyGoal: 'Heti cél', perWeek: 'kg / hét', height: 'Magasság', age: 'Életkor', years: 'év', gender: 'Nem', apiSettings: 'API beállítások', appChannel: 'Csatorna', devApiHint: 'Fejlesztői módban az asztali LAN URL automatikus. Jelszó csak akkor kell, ha a desktop szerver kér.', apiUrl: 'API URL', pairingPassword: 'Szerver jelszó', pairingToken: 'Párosítási token', addKcalNote: 'Jegyzet', existingItem: 'Meglévő', noteEntry: 'Jegyzet', kcalNoteTitle: 'Jegyzet címe', kcalNoteDescription: 'Leírás', kcalNoteValue: 'kcal', localCatalogActions: 'Helyi katalógus műveletek', addLocalIngredient: 'Helyi alapanyag', addLocalFood: 'Helyi étel', addLocalRecipe: 'Helyi recept', addLocalActivity: 'Helyi aktivitás', localItemCreated: 'Helyi tétel mentve. Szinkronizáld, ha elérhető a desktop szerver.', genderHint: 'A kcal becsléshez', male: 'Férfi', female: 'Nő', nonBinary: 'Nem bináris', test: 'Teszt', syncNow: 'Adatok betöltése a szerverről', pushNow: 'Adatok küldése a szervernek', pullFailedOffline: 'Letöltés sikertelen. A helyi adatok továbbra is elérhetők.', pushFailedOffline: 'Küldés sikertelen. A helyi adatok függőben maradnak, amíg elérhető lesz a szerver.', dailyBackupProfile: 'Napi automatikus backup profil', online: 'Online', available: 'Elérhető', offline: 'Offline', serverOffline: 'Az asztali szerver offline.', serverOfflineUsingCache: 'Az asztali szerver offline. A helyi gyorsítótárat használom.', deleteEntryConfirm: 'Törlöd ezt a bejegyzést?', deleteActivityConfirm: 'Törlöd ezt az aktivitást?', exportCanceled: 'Export megszakítva.', importCanceled: 'Import megszakítva.', foods: 'Ételek', noSyncedItems: 'Még nincs szinkronizált étel vagy recept. Indítsd el az asztali szervert, vagy adj hozzá GitHub CSV forrást és szinkronizálj.', appDataExportCreated: 'Appadat export elkészült.', appDataImported: 'Appadatok importálva.', importFailed: 'Import sikertelen', confirmImportOverwrite: 'Ez a mentés felülír minden jelenlegi helyi appadatot. Folytatod?', invalidBackupFile: 'Ez nem érvényes nutrino mobilapp mentés.', clearCachedConfirm: 'Törlöd a szinkronizált alapanyagokat, ételeket, recepteket, aktivitásokat és merge aliasokat a mobil cache-ből? A naplóbejegyzések az eszközön maradnak. A következő szerveres letöltés teljes katalógus snapshotot kér.', cachedCatalogCleared: 'Gyorsítótárban lévő katalógus törölve. A következő szerveres letöltés teljes újratöltés lesz.', privacyBody: 'A nutrino a profilodat, naplódat, étel cache-edet és aktivitásadataidat helyben tárolja az eszközödön. Az app csak a párosított asztali szervereddel kommunikál a saját hálózatodon. Nem gyűjtünk, nem adunk el és nem töltünk fel adatot külső szolgáltatásba.', reportIssue: 'Hiba jelentése', reportIssueBody: 'GitHub Issues megnyitása hibákhoz és ötletekhez.', openRepository: 'GitHub repository megnyitása', openRepositoryBody: 'Forráskód, README és release-ek megtekintése.', starProject: 'Csillagozd meg GitHubon', starProjectBody: 'Ha hasznos a nutrino, egy csillag segíti a projektet.', license: 'Licenc', sourceCode: 'Forráskód', factoryReset: 'Gyári visszaállítás', factoryResetBody: 'Minden helyi appadat törlése és újrakezdés.', factoryResetConfirm: 'Ez törli az összes helyi mobil naplót, profilt, gyorsítótárat és beállítást. Folytatod?', onboardingTitle: 'nutrino beállítása', onboardingIntro: 'Add meg az alap profiladatokat, hogy a kcal, BMI és cél számítható legyen.', onboardingProfile: 'Profil alapadatok', onboardingTour: 'Gyors bemutató', onboardingTourBody: 'A Home mutatja a kalóriát és makrókat. A Napló a naptárad. A Receptek a szinkronizált katalógus. A Profilban vannak a testadatok és célok.', finishSetup: 'Beállítás mentése', next: 'Tovább', back: 'Vissza', startUsingNutrino: 'nutrino indítása', restoreBackup: 'Biztonsági mentés visszaállítása', restore: 'Visszaállítás', backupProfiles: 'Backup profilok', backupProfilesBody: 'A helyi visszaállítási pontok külön vannak a normál profiltól, és túlélik az appon belüli gyári visszaállítást.', noBackupProfiles: 'Még nincs helyi backup profil.', createBackupProfile: 'Backup profil létrehozása', manualBackupProfile: 'Kézi backup profil', exportBackupProfile: 'Export visszaállítási pont', beforeFactoryResetBackupProfile: 'Gyári visszaállítás előtt', beforeImportBackupProfile: 'Import előtt', importBackupProfile: 'Importált mentés', beforeBackupProfileRestore: 'Backup profil visszaállítása előtt', restoreBackupProfile: 'Helyi profil visszaállítása', backupProfileCreated: 'Backup profil mentve.', backupProfileDeleted: 'Backup profil törölve.', backupProfileRestored: 'Backup profil visszaállítva.', backupProfileMissing: 'A backup profil már nem érhető el.', confirmRestoreBackupProfile: 'Visszaállítod ezt a helyi backup profilt? A jelenlegi appadat előtte biztonsági visszaállítási pontként mentésre kerül.', backupProfileSaveFailed: 'Nem sikerült helyi backup profilt menteni', backupProfilesUnavailable: 'A backup profil tárhely nem érhető el ezen az eszközön.', continueFactoryResetWithoutBackup: 'Folytatod a gyári visszaállítást biztonsági visszaállítási pont nélkül?', continueExternalExport: 'Folytatod a külső ZIP exportot így is?', emptyBackupFile: 'A kiválasztott mentés üres (0 B).', backupVerifySizeMismatch: 'Az export ellenőrzött mérete eltér:', backupVerifyFailed: 'A külső ZIP export nem ellenőrizhető; böngészős letöltési fallback indult.', backupProfileStillAvailable: 'A helyi backup profil továbbra is elérhető az appban.', exportFailed: 'Export sikertelen', backupWriteFailed: 'A mentés fájlba írása sikertelen', mobileShareUnavailable: 'Ez a készülék nem támogatja a biztonságos mobil ZIP megosztást. Az instabil mobil mentés/letöltés exportot nem használjuk, így nem készül 0 B ZIP.', mobileShareSheetHint: 'A rendszer megosztási ablakában válaszd a Fájlok, Drive vagy más tárhely appot.',
  },
};

const fallbackTranslations: Record<string, Partial<Record<string, string>>> = {
  de: { language: 'Sprache', systemDefault: 'Systemstandard', english: 'Englisch', hungarian: 'Ungarisch', scan: 'Scannen', languageSearch: 'Sprache nach englischem Namen, Eigenname oder Code suchen…' },
  fr: { language: 'Langue', systemDefault: 'Valeur système', english: 'Anglais', hungarian: 'Hongrois', scan: 'Scanner', languageSearch: 'Rechercher par nom anglais, nom natif ou code…' },
  ru: { language: 'Язык', systemDefault: 'Системный язык', english: 'Английский', hungarian: 'Венгерский', scan: 'Сканировать', languageSearch: 'Поиск по английскому названию, родному названию или коду…' },
  uk: { language: 'Мова', systemDefault: 'Системна', english: 'Англійська', hungarian: 'Угорська', scan: 'Сканувати', languageSearch: 'Пошук за англійською назвою, рідною назвою або кодом…' },
  zh: { language: '语言', systemDefault: '系统默认', english: '英语', hungarian: '匈牙利语', scan: '扫描', languageSearch: '按英文名、本地名或代码搜索语言…' },
  sk: { language: 'Jazyk', systemDefault: 'Systémový jazyk', english: 'Angličtina', hungarian: 'Maďarčina', scan: 'Skenovať', languageSearch: 'Hľadať podľa anglického názvu, vlastného názvu alebo kódu…' },
  ro: { language: 'Limbă', systemDefault: 'Implicit sistem', english: 'Engleză', hungarian: 'Maghiară', scan: 'Scanează', languageSearch: 'Caută după nume englezesc, nume nativ sau cod…' },
  cs: { language: 'Jazyk', systemDefault: 'Systémový jazyk', english: 'Angličtina', hungarian: 'Maďarština', scan: 'Skenovat', languageSearch: 'Hledat podle anglického názvu, vlastního názvu nebo kódu…' },
  sl: { language: 'Jezik', systemDefault: 'Sistemsko privzeto', english: 'Angleščina', hungarian: 'Madžarščina', scan: 'Skeniraj', languageSearch: 'Išči po angleškem imenu, domačem imenu ali kodi…' },
  hr: { language: 'Jezik', systemDefault: 'Zadano sustavom', english: 'Engleski', hungarian: 'Mađarski', scan: 'Skeniraj', languageSearch: 'Traži po engleskom nazivu, izvornom nazivu ili kodu…' },
  pl: { language: 'Język', systemDefault: 'Domyślny systemu', english: 'Angielski', hungarian: 'Węgierski', scan: 'Skanuj', languageSearch: 'Szukaj po nazwie angielskiej, własnej lub kodzie…' },
  es: { language: 'Idioma', systemDefault: 'Predeterminado del sistema', english: 'Inglés', hungarian: 'Húngaro', scan: 'Escanear', languageSearch: 'Buscar por nombre inglés, nombre nativo o código…' },
  pt: { language: 'Idioma', systemDefault: 'Padrão do sistema', english: 'Inglês', hungarian: 'Húngaro', scan: 'Digitalizar', languageSearch: 'Pesquisar por nome em inglês, nome nativo ou código…' },
};
for (const [code, values] of Object.entries(fallbackTranslations)) {
  translations[code] = { ...translations.en, ...normalizeTranslationValues(values) };
}

const supplementalTranslations: Record<string, Partial<Record<string, string>>> = {
  en: {
    kgUnit: 'kg', cmUnit: 'cm', sources: 'Sources', githubCsvSources: 'GitHub CSV sources', githubCsvSourcesBody: 'Desktop server is optional. Add one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.', addRepo: 'Add repo', syncGithubNow: 'Sync GitHub now', remove: 'Remove', notSyncedYet: 'not synced yet', githubOwnerPlaceholder: 'owner / organization', githubRepoPlaceholder: 'repository', githubBranchPlaceholder: 'branch, e.g. main', githubPathPlaceholder: 'optional path, e.g. nutrino/csv', githubTokenPlaceholder: 'optional GitHub token',
    sedentary: 'Sedentary', lowActive: 'Low active', active: 'Active', veryActive: 'Very active', birthday: 'Birthday', name: 'Name', brandSource: 'Brand / source', barcodeQr: 'Barcode / QR', note: 'Note', optional: 'optional', kcalPer100g: 'kcal / 100g', servingSizeG: 'Serving size g', salt: 'Salt', description: 'Description', extraKcal: 'Extra kcal', extraKcalForThisEntry: 'Extra kcal for this entry', recipeExtraKcalHelp: 'Adds to or subtracts from the ingredient kcal total. Macros still come from ingredients.', servings: 'Servings', servingsEmptyHelp: 'Leave empty to make the whole recipe one serving.', localRecipeItemsTitle: 'Ingredients / foods / recipes', selectItem: 'Select item', localRecipeSearchHint: 'No long dropdown — search by food, ingredient or recipe name.', searchItem: 'Search item', find: 'Find', noMatchingItem: 'No matching item.', mobileRecipeSyncHint: 'Mobile recipe changes are uploaded with the same ID, so the desktop inbox sees them as replacements.', code: 'Code', type: 'Type', kcalPerMin: 'kcal / min', tdeeEquation: 'TDEE equation', iomEquation: 'Institute of Medicine Equation (2005)', iomEquationMacro: 'Institute of Medicine Equation (2005), macro distribution', dailyKcalAdjustment: 'Daily kcal adjustment', macronutrientDistribution: 'Macronutrient Distribution', total: 'total', aboutBody: 'Offline-first nutrition diary for your own desktop food database.', aboutThanks: 'Thanks to OpenNutriTracker for privacy-first open-source nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.', scanBarcodeQr: 'Scan barcode / QR', scanNutrinoQr: 'Scan Nutrino QR', scanHelper: 'If a recipe has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the code below.', scanPlaceholder: 'barcode, QR payload or Nutrino code', catalogMenu: 'Catalog menu', syncedCatalogSearch: 'Search synced catalog', scanBarcodeQrAria: 'Scan barcode or QR', scanQrAria: 'Scan QR', searchAria: 'Search', translationsHint: 'Add only the languages you need. The base name remains the fallback.', translationLanguage: 'Language', translationValue: 'Translated name', translationAddPlaceholder: 'Add another language…',
  },
  hu: {
    kgUnit: 'kg', cmUnit: 'cm', sources: 'Források', githubCsvSources: 'GitHub CSV források', githubCsvSourcesBody: 'A desktop szerver opcionális. Adj hozzá egy vagy több GitHub repositoryt Nutrino CSV fájlokkal; az app legfeljebb naponta egyszer automatikusan, vagy kérésre szinkronizálja őket.', addRepo: 'Repo hozzáadása', syncGithubNow: 'GitHub szinkronizálás most', remove: 'Eltávolítás', notSyncedYet: 'még nincs szinkronizálva', githubOwnerPlaceholder: 'tulajdonos / szervezet', githubRepoPlaceholder: 'repository', githubBranchPlaceholder: 'branch, pl. main', githubPathPlaceholder: 'opcionális útvonal, pl. nutrino/csv', githubTokenPlaceholder: 'opcionális GitHub token',
    sedentary: 'Ülő életmód', lowActive: 'Kissé aktív', active: 'Aktív', veryActive: 'Nagyon aktív', birthday: 'Születésnap', name: 'Név', brandSource: 'Márka / forrás', barcodeQr: 'Vonalkód / QR', note: 'Megjegyzés', optional: 'opcionális', kcalPer100g: 'kcal / 100g', servingSizeG: 'Adagméret g', salt: 'Só', description: 'Leírás', extraKcal: 'Extra kcal', extraKcalForThisEntry: 'Extra kcal ehhez a bejegyzéshez', recipeExtraKcalHelp: 'Hozzáadódik a hozzávalók kcal összegéhez, vagy levonódik belőle. A makrók továbbra is a hozzávalókból számolódnak.', servings: 'Adagok', servingsEmptyHelp: 'Üresen a teljes recept egy adag.', localRecipeItemsTitle: 'Alapanyagok / ételek / receptek', selectItem: 'Tétel kiválasztása', localRecipeSearchHint: 'Nincs hosszú legördülő — keress étel, alapanyag vagy receptnév alapján.', searchItem: 'Tétel keresése', find: 'Keresés', noMatchingItem: 'Nincs találat.', mobileRecipeSyncHint: 'A mobilos receptmódosítások ugyanazzal az ID-val kerülnek feltöltésre, ezért a desktop inbox cserének látja őket.', code: 'Kód', type: 'Típus', kcalPerMin: 'kcal / perc', tdeeEquation: 'TDEE képlet', iomEquation: 'Institute of Medicine képlet (2005)', iomEquationMacro: 'Institute of Medicine képlet (2005), makróeloszlás', dailyKcalAdjustment: 'Napi kcal korrekció', macronutrientDistribution: 'Makrotápanyag-eloszlás', total: 'összesen', aboutBody: 'Offline-first táplálkozási napló a saját desktopon futó ételadatbázisodhoz.', aboutThanks: 'Köszönet az OpenNutriTrackernek a privacy-first open-source táplálkozási inspirációért, valamint a Tauri, Rust, Vue, Vite, TypeScript, JSZip és Lucide projekteknek a nutrino alapjaiért.', scanBarcodeQr: 'Vonalkód / QR szkennelése', scanNutrinoQr: 'Nutrino QR szkennelése', scanHelper: 'Ha egy recept több QR részből áll, mindegyik számozott QR-t olvasd be egyszer. Ha a kamera nem elérhető, illeszd be vagy írd be a kódot lent.', scanPlaceholder: 'vonalkód, QR payload vagy Nutrino kód', catalogMenu: 'Katalógus menü', syncedCatalogSearch: 'Szinkronizált katalógus keresése', scanBarcodeQrAria: 'Vonalkód vagy QR szkennelése', scanQrAria: 'QR szkennelése', searchAria: 'Keresés', translationsHint: 'Csak a szükséges nyelveket add hozzá. Az alap név marad a fallback.', translationLanguage: 'Nyelv', translationValue: 'Fordított név', translationAddPlaceholder: 'Új nyelv hozzáadása…',
  },
  de: { scanBarcodeQr: 'Barcode / QR scannen', scanNutrinoQr: 'Nutrino-QR scannen', scanHelper: 'Wenn ein Rezept aus mehreren QR-Teilen besteht, scanne jeden nummerierten QR-Code einmal. Wenn die Kamera nicht verfügbar ist, füge den Code unten ein oder tippe ihn ein.', scanPlaceholder: 'Barcode, QR-Inhalt oder Nutrino-Code', translationsHint: 'Füge nur die benötigten Sprachen hinzu. Der Basisname bleibt der Fallback.', translationLanguage: 'Sprache', translationValue: 'Übersetzter Name', translationAddPlaceholder: 'Weitere Sprache hinzufügen…', name: 'Name', note: 'Notiz', description: 'Beschreibung', optional: 'optional', remove: 'Entfernen', find: 'Suchen', noMatchingItem: 'Kein passender Eintrag.' },
  fr: { scanBarcodeQr: 'Scanner le code-barres / QR', scanNutrinoQr: 'Scanner le QR Nutrino', scanHelper: 'Si une recette contient plusieurs QR, scanne chaque QR numéroté une seule fois. Si la caméra n’est pas disponible, colle ou saisis le code ci-dessous.', scanPlaceholder: 'code-barres, contenu QR ou code Nutrino', translationsHint: 'Ajoute uniquement les langues nécessaires. Le nom de base reste la valeur de secours.', translationLanguage: 'Langue', translationValue: 'Nom traduit', translationAddPlaceholder: 'Ajouter une langue…', name: 'Nom', note: 'Note', description: 'Description', optional: 'facultatif', remove: 'Supprimer', find: 'Rechercher', noMatchingItem: 'Aucun élément correspondant.' },
  ru: { scanBarcodeQr: 'Сканировать штрихкод / QR', scanNutrinoQr: 'Сканировать QR Nutrino', scanPlaceholder: 'штрихкод, данные QR или код Nutrino', translationsHint: 'Добавляйте только нужные языки. Базовое имя остаётся резервным.', translationLanguage: 'Язык', translationValue: 'Переведённое название', translationAddPlaceholder: 'Добавить язык…', name: 'Название', note: 'Заметка', description: 'Описание', optional: 'необязательно', remove: 'Удалить', find: 'Найти', noMatchingItem: 'Нет совпадений.' },
  uk: { scanBarcodeQr: 'Сканувати штрихкод / QR', scanNutrinoQr: 'Сканувати QR Nutrino', scanPlaceholder: 'штрихкод, QR-дані або код Nutrino', translationsHint: 'Додавайте лише потрібні мови. Базова назва лишається резервною.', translationLanguage: 'Мова', translationValue: 'Перекладена назва', translationAddPlaceholder: 'Додати мову…', name: 'Назва', note: 'Нотатка', description: 'Опис', optional: 'необов’язково', remove: 'Видалити', find: 'Знайти', noMatchingItem: 'Немає збігів.' },
  zh: { scanBarcodeQr: '扫描条码 / QR', scanNutrinoQr: '扫描 Nutrino QR', scanPlaceholder: '条码、QR 内容或 Nutrino 代码', translationsHint: '只添加需要的语言。基础名称仍作为备用。', translationLanguage: '语言', translationValue: '翻译名称', translationAddPlaceholder: '添加其他语言…', name: '名称', note: '备注', description: '描述', optional: '可选', remove: '移除', find: '查找', noMatchingItem: '没有匹配项。' },
  sk: { scanBarcodeQr: 'Skenovať čiarový kód / QR', scanNutrinoQr: 'Skenovať Nutrino QR', scanPlaceholder: 'čiarový kód, QR obsah alebo Nutrino kód', translationsHint: 'Pridaj iba potrebné jazyky. Základný názov ostáva záložný.', translationLanguage: 'Jazyk', translationValue: 'Preložený názov', translationAddPlaceholder: 'Pridať ďalší jazyk…', name: 'Názov', note: 'Poznámka', description: 'Popis', optional: 'voliteľné', remove: 'Odstrániť', find: 'Hľadať', noMatchingItem: 'Žiadna zhoda.' },
  ro: { scanBarcodeQr: 'Scanează cod de bare / QR', scanNutrinoQr: 'Scanează QR Nutrino', scanPlaceholder: 'cod de bare, conținut QR sau cod Nutrino', translationsHint: 'Adaugă doar limbile necesare. Numele de bază rămâne fallback.', translationLanguage: 'Limbă', translationValue: 'Nume tradus', translationAddPlaceholder: 'Adaugă o limbă…', name: 'Nume', note: 'Notă', description: 'Descriere', optional: 'opțional', remove: 'Elimină', find: 'Caută', noMatchingItem: 'Niciun rezultat.' },
  cs: { scanBarcodeQr: 'Skenovat čárový kód / QR', scanNutrinoQr: 'Skenovat Nutrino QR', scanPlaceholder: 'čárový kód, QR obsah nebo Nutrino kód', translationsHint: 'Přidej jen potřebné jazyky. Základní název zůstává záložní.', translationLanguage: 'Jazyk', translationValue: 'Přeložený název', translationAddPlaceholder: 'Přidat další jazyk…', name: 'Název', note: 'Poznámka', description: 'Popis', optional: 'volitelné', remove: 'Odebrat', find: 'Hledat', noMatchingItem: 'Žádná shoda.' },
  sl: { scanBarcodeQr: 'Skeniraj črtno kodo / QR', scanNutrinoQr: 'Skeniraj Nutrino QR', scanPlaceholder: 'črtna koda, QR vsebina ali Nutrino koda', translationsHint: 'Dodaj samo potrebne jezike. Osnovno ime ostane rezervna vrednost.', translationLanguage: 'Jezik', translationValue: 'Prevedeno ime', translationAddPlaceholder: 'Dodaj jezik…', name: 'Ime', note: 'Opomba', description: 'Opis', optional: 'neobvezno', remove: 'Odstrani', find: 'Najdi', noMatchingItem: 'Ni ujemanja.' },
  hr: { scanBarcodeQr: 'Skeniraj barkod / QR', scanNutrinoQr: 'Skeniraj Nutrino QR', scanPlaceholder: 'barkod, QR sadržaj ili Nutrino kod', translationsHint: 'Dodaj samo potrebne jezike. Osnovni naziv ostaje rezervna vrijednost.', translationLanguage: 'Jezik', translationValue: 'Prevedeni naziv', translationAddPlaceholder: 'Dodaj jezik…', name: 'Naziv', note: 'Bilješka', description: 'Opis', optional: 'opcionalno', remove: 'Ukloni', find: 'Pronađi', noMatchingItem: 'Nema podudaranja.' },
  pl: { scanBarcodeQr: 'Skanuj kod kreskowy / QR', scanNutrinoQr: 'Skanuj QR Nutrino', scanPlaceholder: 'kod kreskowy, dane QR lub kod Nutrino', translationsHint: 'Dodaj tylko potrzebne języki. Nazwa bazowa pozostaje awaryjna.', translationLanguage: 'Język', translationValue: 'Przetłumaczona nazwa', translationAddPlaceholder: 'Dodaj język…', name: 'Nazwa', note: 'Notatka', description: 'Opis', optional: 'opcjonalnie', remove: 'Usuń', find: 'Szukaj', noMatchingItem: 'Brak dopasowania.' },
  es: { scanBarcodeQr: 'Escanear código / QR', scanNutrinoQr: 'Escanear QR de Nutrino', scanPlaceholder: 'código de barras, contenido QR o código Nutrino', translationsHint: 'Añade solo los idiomas necesarios. El nombre base queda como respaldo.', translationLanguage: 'Idioma', translationValue: 'Nombre traducido', translationAddPlaceholder: 'Añadir idioma…', name: 'Nombre', note: 'Nota', description: 'Descripción', optional: 'opcional', remove: 'Eliminar', find: 'Buscar', noMatchingItem: 'No hay coincidencias.' },
  pt: { scanBarcodeQr: 'Digitalizar código / QR', scanNutrinoQr: 'Digitalizar QR Nutrino', scanPlaceholder: 'código de barras, conteúdo QR ou código Nutrino', translationsHint: 'Adiciona apenas os idiomas necessários. O nome base fica como fallback.', translationLanguage: 'Idioma', translationValue: 'Nome traduzido', translationAddPlaceholder: 'Adicionar idioma…', name: 'Nome', note: 'Nota', description: 'Descrição', optional: 'opcional', remove: 'Remover', find: 'Procurar', noMatchingItem: 'Sem correspondência.' },
};
for (const [code, values] of Object.entries(supplementalTranslations)) {
  translations[code] = { ...(translations[code] || translations.en), ...normalizeTranslationValues(values) };
}


const mobileCoreLanguageTranslations: Record<string, Partial<Record<string, string>>> = {
  de: { home: 'Start', diary: 'Tagebuch', recipes: 'Rezepte', profile: 'Profil', settings: 'Einstellungen', activity: 'Aktivität', breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snack', units: 'Einheiten', calculations: 'Berechnungen', privacy: 'Datenschutz', about: 'Über', licenses: 'Lizenzen', translations: 'Übersetzungen', noTranslations: 'Noch keine Übersetzungen.', addTranslation: 'Übersetzung hinzufügen', cancel: 'Abbrechen', ok: 'OK', save: 'Speichern', add: 'Hinzufügen', update: 'Aktualisieren', edit: 'Bearbeiten', delete: 'Löschen', food: 'Lebensmittel', foods: 'Lebensmittel', ingredient: 'Zutat', recipe: 'Rezept', activities: 'Aktivitäten' },
  fr: { home: 'Accueil', diary: 'Journal', recipes: 'Recettes', profile: 'Profil', settings: 'Paramètres', activity: 'Activité', breakfast: 'Petit-déjeuner', lunch: 'Déjeuner', dinner: 'Dîner', snack: 'Collation', units: 'Unités', calculations: 'Calculs', privacy: 'Confidentialité', about: 'À propos', licenses: 'Licences', translations: 'Traductions', noTranslations: 'Aucune traduction.', addTranslation: 'Ajouter une traduction', cancel: 'Annuler', ok: 'OK', save: 'Enregistrer', add: 'Ajouter', update: 'Mettre à jour', edit: 'Modifier', delete: 'Supprimer', food: 'Aliment', foods: 'Aliments', ingredient: 'Ingrédient', recipe: 'Recette', activities: 'Activités' },
  ru: { home: 'Главная', diary: 'Дневник', recipes: 'Рецепты', profile: 'Профиль', settings: 'Настройки', activity: 'Активность', breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус', units: 'Единицы', calculations: 'Расчёты', privacy: 'Конфиденциальность', about: 'О приложении', licenses: 'Лицензии', translations: 'Переводы', noTranslations: 'Переводов пока нет.', addTranslation: 'Добавить перевод', cancel: 'Отмена', ok: 'OK', save: 'Сохранить', add: 'Добавить', update: 'Обновить', edit: 'Изменить', delete: 'Удалить', food: 'Еда', foods: 'Еда', ingredient: 'Ингредиент', recipe: 'Рецепт', activities: 'Активности' },
  uk: { home: 'Головна', diary: 'Щоденник', recipes: 'Рецепти', profile: 'Профіль', settings: 'Налаштування', activity: 'Активність', breakfast: 'Сніданок', lunch: 'Обід', dinner: 'Вечеря', snack: 'Перекус', units: 'Одиниці', calculations: 'Розрахунки', privacy: 'Приватність', about: 'Про застосунок', licenses: 'Ліцензії', translations: 'Переклади', noTranslations: 'Перекладів ще немає.', addTranslation: 'Додати переклад', cancel: 'Скасувати', ok: 'OK', save: 'Зберегти', add: 'Додати', update: 'Оновити', edit: 'Редагувати', delete: 'Видалити', food: 'Їжа', foods: 'Їжа', ingredient: 'Інгредієнт', recipe: 'Рецепт', activities: 'Активності' },
  zh: { home: '首页', diary: '日记', recipes: '食谱', profile: '档案', settings: '设置', activity: '活动', breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐', units: '单位', calculations: '计算', privacy: '隐私', about: '关于', licenses: '许可证', translations: '翻译', noTranslations: '暂无翻译。', addTranslation: '添加翻译', cancel: '取消', ok: '确定', save: '保存', add: '添加', update: '更新', edit: '编辑', delete: '删除', food: '食物', foods: '食物', ingredient: '配料', recipe: '食谱', activities: '活动' },
  sk: { home: 'Domov', diary: 'Denník', recipes: 'Recepty', profile: 'Profil', settings: 'Nastavenia', activity: 'Aktivita', breakfast: 'Raňajky', lunch: 'Obed', dinner: 'Večera', snack: 'Desiata', units: 'Jednotky', calculations: 'Výpočty', privacy: 'Súkromie', about: 'O aplikácii', licenses: 'Licencie', translations: 'Preklady', noTranslations: 'Zatiaľ žiadne preklady.', addTranslation: 'Pridať preklad', cancel: 'Zrušiť', ok: 'OK', save: 'Uložiť', add: 'Pridať', update: 'Aktualizovať', edit: 'Upraviť', delete: 'Vymazať', food: 'Jedlo', foods: 'Jedlá', ingredient: 'Surovina', recipe: 'Recept', activities: 'Aktivity' },
  ro: { home: 'Acasă', diary: 'Jurnal', recipes: 'Rețete', profile: 'Profil', settings: 'Setări', activity: 'Activitate', breakfast: 'Mic dejun', lunch: 'Prânz', dinner: 'Cină', snack: 'Gustare', units: 'Unități', calculations: 'Calcule', privacy: 'Confidențialitate', about: 'Despre', licenses: 'Licențe', translations: 'Traduceri', noTranslations: 'Nu există traduceri încă.', addTranslation: 'Adaugă traducere', cancel: 'Anulează', ok: 'OK', save: 'Salvează', add: 'Adaugă', update: 'Actualizează', edit: 'Editează', delete: 'Șterge', food: 'Aliment', foods: 'Alimente', ingredient: 'Ingredient', recipe: 'Rețetă', activities: 'Activități' },
  cs: { home: 'Domů', diary: 'Deník', recipes: 'Recepty', profile: 'Profil', settings: 'Nastavení', activity: 'Aktivita', breakfast: 'Snídaně', lunch: 'Oběd', dinner: 'Večeře', snack: 'Svačina', units: 'Jednotky', calculations: 'Výpočty', privacy: 'Soukromí', about: 'O aplikaci', licenses: 'Licence', translations: 'Překlady', noTranslations: 'Zatím žádné překlady.', addTranslation: 'Přidat překlad', cancel: 'Zrušit', ok: 'OK', save: 'Uložit', add: 'Přidat', update: 'Aktualizovat', edit: 'Upravit', delete: 'Smazat', food: 'Jídlo', foods: 'Jídla', ingredient: 'Surovina', recipe: 'Recept', activities: 'Aktivity' },
  sl: { home: 'Domov', diary: 'Dnevnik', recipes: 'Recepti', profile: 'Profil', settings: 'Nastavitve', activity: 'Aktivnost', breakfast: 'Zajtrk', lunch: 'Kosilo', dinner: 'Večerja', snack: 'Prigrizek', units: 'Enote', calculations: 'Izračuni', privacy: 'Zasebnost', about: 'O aplikaciji', licenses: 'Licence', translations: 'Prevodi', noTranslations: 'Prevodi še niso dodani.', addTranslation: 'Dodaj prevod', cancel: 'Prekliči', ok: 'OK', save: 'Shrani', add: 'Dodaj', update: 'Posodobi', edit: 'Uredi', delete: 'Izbriši', food: 'Živilo', foods: 'Živila', ingredient: 'Sestavina', recipe: 'Recept', activities: 'Aktivnosti' },
  hr: { home: 'Početna', diary: 'Dnevnik', recipes: 'Recepti', profile: 'Profil', settings: 'Postavke', activity: 'Aktivnost', breakfast: 'Doručak', lunch: 'Ručak', dinner: 'Večera', snack: 'Užina', units: 'Jedinice', calculations: 'Izračuni', privacy: 'Privatnost', about: 'O aplikaciji', licenses: 'Licence', translations: 'Prijevodi', noTranslations: 'Još nema prijevoda.', addTranslation: 'Dodaj prijevod', cancel: 'Odustani', ok: 'OK', save: 'Spremi', add: 'Dodaj', update: 'Ažuriraj', edit: 'Uredi', delete: 'Izbriši', food: 'Hrana', foods: 'Hrana', ingredient: 'Sastojak', recipe: 'Recept', activities: 'Aktivnosti' },
  pl: { home: 'Start', diary: 'Dziennik', recipes: 'Przepisy', profile: 'Profil', settings: 'Ustawienia', activity: 'Aktywność', breakfast: 'Śniadanie', lunch: 'Obiad', dinner: 'Kolacja', snack: 'Przekąska', units: 'Jednostki', calculations: 'Obliczenia', privacy: 'Prywatność', about: 'O aplikacji', licenses: 'Licencje', translations: 'Tłumaczenia', noTranslations: 'Nie dodano jeszcze tłumaczeń.', addTranslation: 'Dodaj tłumaczenie', cancel: 'Anuluj', ok: 'OK', save: 'Zapisz', add: 'Dodaj', update: 'Aktualizuj', edit: 'Edytuj', delete: 'Usuń', food: 'Produkt', foods: 'Produkty', ingredient: 'Składnik', recipe: 'Przepis', activities: 'Aktywności' },
  es: { home: 'Inicio', diary: 'Diario', recipes: 'Recetas', profile: 'Perfil', settings: 'Ajustes', activity: 'Actividad', breakfast: 'Desayuno', lunch: 'Comida', dinner: 'Cena', snack: 'Snack', units: 'Unidades', calculations: 'Cálculos', privacy: 'Privacidad', about: 'Acerca de', licenses: 'Licencias', translations: 'Traducciones', noTranslations: 'Aún no hay traducciones.', addTranslation: 'Añadir traducción', cancel: 'Cancelar', ok: 'OK', save: 'Guardar', add: 'Añadir', update: 'Actualizar', edit: 'Editar', delete: 'Eliminar', food: 'Alimento', foods: 'Alimentos', ingredient: 'Ingrediente', recipe: 'Receta', activities: 'Actividades' },
  pt: { home: 'Início', diary: 'Diário', recipes: 'Receitas', profile: 'Perfil', settings: 'Definições', activity: 'Atividade', breakfast: 'Pequeno-almoço', lunch: 'Almoço', dinner: 'Jantar', snack: 'Lanche', units: 'Unidades', calculations: 'Cálculos', privacy: 'Privacidade', about: 'Sobre', licenses: 'Licenças', translations: 'Traduções', noTranslations: 'Ainda não há traduções.', addTranslation: 'Adicionar tradução', cancel: 'Cancelar', ok: 'OK', save: 'Guardar', add: 'Adicionar', update: 'Atualizar', edit: 'Editar', delete: 'Eliminar', food: 'Alimento', foods: 'Alimentos', ingredient: 'Ingrediente', recipe: 'Receita', activities: 'Atividades' },
};
for (const [language, values] of Object.entries(mobileCoreLanguageTranslations)) {
  translations[language] = { ...(translations[language] || translations.en), ...normalizeTranslationValues(values) };
}


const completeMobileLanguageTranslations: Record<string, Record<string, string>> = {
  "hu": {
    "home": "Kezdőlap",
    "diary": "Napló",
    "recipes": "Receptek",
    "profile": "Profil",
    "settings": "Beállítások",
    "synced": "Szinkronban",
    "syncing": "Szinkronizálás",
    "pending": "függő",
    "supplied": "bevitt",
    "burned": "elégetett",
    "kcalLeft": "kcal maradt",
    "tooMuch": "túllépve",
    "activity": "Aktivitás",
    "breakfast": "Reggeli",
    "lunch": "Ebéd",
    "dinner": "Vacsora",
    "snack": "Snack",
    "carbs": "szénhidrát",
    "fat": "zsír",
    "protein": "fehérje",
    "addBurnedKcal": "Elégetett kcal hozzáadása",
    "startTheDay": "Napindító étkezés",
    "middayMeal": "Déli étkezés",
    "eveningMeal": "Esti étkezés",
    "smallMeals": "Kisebb étkezések",
    "addNewItem": "Új tétel hozzáadása",
    "unlockEditConfirm": "Feloldod ennek a napnak a szerkesztését? Ez segít elkerülni a véletlen módosításokat régebbi napokon.",
    "discardCurrentEditConfirm": "Bezárod az aktuális szerkesztést mentés nélkül?",
    "finishSetupBeforeExit": "Fejezd be a beállítást, mielőtt kilépsz az appból.",
    "pressBackAgain": "Nyomd meg újra a vissza gombot 5 másodpercen belül a kilépéshez.",
    "noActivity": "Nincs aktivitás erre a napra.",
    "noEntries": "Még nincs bejegyzés.",
    "edit": "Szerkesztés",
    "delete": "Törlés",
    "duplicate": "Duplikálás",
    "duplicateEntry": "Tétel duplikálása",
    "duplicateMealTargetHint": "Válaszd ki, melyik étkezéshez kerüljön a duplikáció.",
    "moveToMeal": "Áthelyezés étkezéshez",
    "entryActions": "Tétel műveletei",
    "entryDuplicated": "Tétel duplikálva.",
    "entryMoved": "Tétel áthelyezve.",
    "units": "Mértékegységek",
    "calculations": "Számítások",
    "language": "Nyelv",
    "privacy": "Adatvédelem",
    "about": "Névjegy",
    "licenses": "Licencek",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Köszönetnyilvánítás",
    "exportImport": "Appadat export / import",
    "clearCache": "Gyorsítótár törlése",
    "dailyReminder": "Napi emlékeztető",
    "trackingReminders": "Követés és emlékeztetők",
    "weeklyWeightAverage": "Heti átlagsúly",
    "weeklyWeightAverageHint": "Minden vasárnapra heti átlagsúlyt számol a mérésekből.",
    "dailyWeightReminder": "Napi súlyemlékeztető",
    "dailyWeightReminderTime": "Súlyemlékeztető ideje",
    "mealReminders": "Étkezésnapló emlékeztetők",
    "mealReminderMorning": "Vidd fel a reggelit vagy a délelőtti étkezést.",
    "mealReminderNoon": "Vidd fel az ebédet vagy a déli étkezést.",
    "mealReminderAfternoon": "Vidd fel a vacsorát, nasit vagy délutáni étkezést.",
    "mealReminderTitle": "Étkezés emlékeztető",
    "weightReminderTitle": "Súlyemlékeztető",
    "weightReminderBody": "Add meg a mai testsúlyod, hogy a heti átlag hasznos maradjon.",
    "calorieDeficitTracking": "Biztonsági deficit követése",
    "targetDeficit": "Cél biztonsági deficit",
    "calorieLimitWarning": "Figyelmeztetés deficit túllépésnél",
    "exerciseKcalEatback": "Visszaehető mozgás kcal",
    "eatbackNone": "Ne add vissza a mozgás kcal-t",
    "eatbackHalf": "A felét add vissza",
    "eatbackFull": "Az egészet add vissza",
    "requestNotifications": "Értesítések engedélyezése",
    "notificationsUnsupported": "Az értesítés itt nem támogatott.",
    "notificationsEnabled": "Értesítések engedélyezve.",
    "notificationsNotEnabled": "Az értesítések nincsenek engedélyezve.",
    "deficitWarningTitle": "Deficit cél túllépve",
    "deficitKcalLeft": "deficites kcal maradt",
    "safeKcalLeft": "maradt a deficit cél előtt",
    "overDeficit": "deficit felett",
    "overDeficitButWithinLimit": "a deficit cél felett, még napi kereten belül",
    "overDailyLimit": "a napi keret felett",
    "deficitOffHint": "A biztonsági deficit ki van kapcsolva.",
    "analysis": "Analízis",
    "openAnalysis": "Analízis megnyitása",
    "closeAnalysis": "Analízis bezárása",
    "weightTrend": "Súlytrend",
    "calorieTrend": "Kalóriatrend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Aktuális streak",
    "bestStreak": "Legjobb streak",
    "successRate": "Sikerarány",
    "days": "nap",
    "weeklyAverage": "Heti átlag",
    "limitedData": "kevés adat",
    "noWeightTrend": "Adj meg súlyméréseket a kiválasztott súlytrend megjelenítéséhez.",
    "fullLimit": "teljes keret",
    "effectiveLimit": "deficit cél",
    "exerciseCredit": "mozgás jóváírás",
    "legend": "Jelmagyarázat",
    "consumedLegend": "Bevitt kcal",
    "weightLegendValue": "Súlyérték",
    "theme": "Téma",
    "showActivity": "Aktivitás követése",
    "showMacros": "Makrók megjelenítése",
    "showMicros": "Mikrotápanyagok megjelenítése",
    "metric": "Metrikus (kg, cm, ml)",
    "imperial": "Angolszász (lbs, ft, oz)",
    "systemDefault": "Rendszer alapértelmezett",
    "english": "Angol",
    "hungarian": "Magyar",
    "scan": "Scan",
    "languageSearch": "Keress angol névvel, saját névvel vagy kóddal…",
    "translations": "Fordítások",
    "noTranslations": "Még nincs fordítás.",
    "addTranslation": "Fordítás hozzáadása",
    "cancel": "Mégse",
    "ok": "OK",
    "reset": "Visszaállítás",
    "unlockDay": "Nap szerkesztésének feloldása",
    "lockedNote": "A nap módosításához előbb oldd fel a szerkesztést.",
    "editingEnabled": "Szerkesztés engedélyezve",
    "selectedDayEntriesNote": "A kiválasztott nap étkezései és aktivitásai lent láthatók.",
    "mealNotesToReview": "Átnézendő étkezési jegyzetek",
    "mealNotesToReviewHint": "Ezek a jegyzetek a telefonon maradnak. Nyisd meg a napot, ha később valódi ételre cserélnéd, vagy jelöld végleges jegyzetként.",
    "openDay": "Nap megnyitása",
    "keepAsNote": "Maradjon jegyzet",
    "noMealNotesToReview": "Nincs átnézendő étkezési jegyzet.",
    "previousMealNotes": "Korábbi jegyzetek",
    "useNote": "Jegyzet használata",
    "convertToCatalogItem": "Étellé alakítás",
    "convertNoteToCatalogHint": "A jegyzet cseréje alapanyagra, ételre vagy receptre.",
    "localOnlyDiaryHint": "A naplóbejegyzések és aktivitásnaplók mobilon maradnak.",
    "target": "cél",
    "weight": "súly",
    "saveWeight": "Súly mentése",
    "weightForThisDay": "Súly erre a napra kg-ban",
    "editWeight": "Súly szerkesztése",
    "futureDateWarning": "Ez a nap még a jövőben van. A jövőbeli naplózás pontatlanná teheti a naplódat. Biztosan folytatod?",
    "weeklyWeightCheck": "Heti súlyellenőrzés",
    "weeklyWeightCheckBody": "Hetente egyszer frissítsd a súlyod. Ha nem változik, a nutrino az utolsó ismert értékkel számol.",
    "save": "Mentés",
    "addTo": "Hozzáadás ehhez:",
    "add": "Hozzáadás",
    "update": "Frissítés",
    "addActivity": "Aktivitás hozzáadása",
    "updateActivity": "Aktivitás frissítése",
    "customRecipe": "Recept testreszabása",
    "customRecipeHint": "A módosítás csak ehhez a naplóbejegyzéshez mentődik.",
    "customizedRecipe": "egyedi recept",
    "editRecipeLocally": "Recept módosítása ehhez a bejegyzéshez",
    "changeSelection": "Étel/recept módosítása",
    "selected": "Kiválasztva",
    "baseAmount": "alap",
    "onePiece": "1 db",
    "selectFoodFirst": "Előbb válassz ételt vagy receptet.",
    "amountGreaterThanZero": "A mennyiségnek nullánál nagyobbnak kell lennie.",
    "enterValidWeight": "Adj meg érvényes súlyt kg-ban.",
    "weightSaved": "Súly mentve.",
    "activityUpdated": "Aktivitás frissítve.",
    "activityAdded": "Aktivitás hozzáadva.",
    "activities": "aktivitás",
    "entries": "bejegyzés",
    "foodAndRecipeSearch": "Ételek és receptek keresése",
    "searchIn": "Keresés helye",
    "searchScopeTitle": "Cím",
    "searchScopeAll": "Minden",
    "searchScopeBrand": "Márka",
    "searchScopeCategory": "Típus",
    "searchScopeDescription": "Leírás",
    "exactMatches": "Pontos találatok",
    "maybeYouMean": "Talán erre gondoltál",
    "activitySearch": "Aktivitások keresése",
    "recipe": "Recept",
    "food": "Étel",
    "ingredient": "Alapanyag",
    "grams": "gramm",
    "pieces": "db",
    "catalog": "Katalógus",
    "watch": "Okosóra",
    "manual": "Kézi",
    "minutes": "perc",
    "kcalFromWatchManual": "kcal okosórából/kézzel",
    "exportAppData": "Appadatok exportálása",
    "exportAppDataBody": "Teljes helyi ZIP mentés készítése.",
    "importAppData": "Appadatok importálása",
    "importAppDataBody": "Válassz nutrino mobilapp ZIP mentést.",
    "channelDataTransfer": "Dev / stable adatátadás",
    "channelDataTransferBody": "Androidon a dev és stable két külön app. Közvetlenül nem olvashatják egymás privát tárhelyét, ezért az átadás explicit ZIP csomagon keresztül történik.",
    "updateDevFromStable": "Dev frissítése stable mentésből",
    "updateStableFromDev": "Stable frissítése dev mentésből",
    "exportDevForStable": "Csomag készítése stable-nek",
    "exportStableForDev": "Csomag készítése devnek",
    "confirmChannelTransferImport": "Ez felülírja a jelenlegi appadatokat a másik telepített csatorna mentésével. Folytatod?",
    "channelTransferExportProfile": "Csatornaátadás export",
    "beforeChannelTransferImportBackupProfile": "Csatornaátadás import előtt",
    "channelTransferImportProfile": "Csatornaátadás import",
    "channelTransferExportCreated": "Csatornaátadási csomag elkészült.",
    "channelTransferImported": "Adatok importálva a másik csatornából.",
    "activityLevel": "Aktivitás",
    "activityLevelHint": "A napi kcal cél számításához",
    "weeklyGoal": "Heti cél",
    "perWeek": "kg / hét",
    "height": "Magasság",
    "age": "Életkor",
    "years": "év",
    "gender": "Nem",
    "apiSettings": "API beállítások",
    "appChannel": "Csatorna",
    "devApiHint": "Fejlesztői módban az asztali LAN URL automatikus. Jelszó csak akkor kell, ha a desktop szerver kér.",
    "apiUrl": "API URL",
    "pairingPassword": "Szerver jelszó",
    "pairingToken": "Párosítási token",
    "addKcalNote": "Jegyzet",
    "existingItem": "Meglévő",
    "noteEntry": "Jegyzet",
    "kcalNoteTitle": "Jegyzet címe",
    "kcalNoteDescription": "Leírás",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Helyi katalógus műveletek",
    "addLocalIngredient": "Helyi alapanyag",
    "addLocalFood": "Helyi étel",
    "addLocalRecipe": "Helyi recept",
    "addLocalActivity": "Helyi aktivitás",
    "localItemCreated": "Helyi tétel mentve. Szinkronizáld, ha elérhető a desktop szerver.",
    "genderHint": "A kcal becsléshez",
    "male": "Férfi",
    "female": "Nő",
    "nonBinary": "Nem bináris",
    "test": "Teszt",
    "syncNow": "Adatok betöltése a szerverről",
    "pushNow": "Adatok küldése a szervernek",
    "pullFailedOffline": "Letöltés sikertelen. A helyi adatok továbbra is elérhetők.",
    "pushFailedOffline": "Küldés sikertelen. A helyi adatok függőben maradnak, amíg elérhető lesz a szerver.",
    "dailyBackupProfile": "Napi automatikus backup profil",
    "online": "Online",
    "available": "Elérhető",
    "offline": "Offline",
    "serverOffline": "Az asztali szerver offline.",
    "serverOfflineUsingCache": "Az asztali szerver offline. A helyi gyorsítótárat használom.",
    "deleteEntryConfirm": "Törlöd ezt a bejegyzést?",
    "deleteActivityConfirm": "Törlöd ezt az aktivitást?",
    "exportCanceled": "Export megszakítva.",
    "importCanceled": "Import megszakítva.",
    "foods": "Ételek",
    "noSyncedItems": "Még nincs szinkronizált étel vagy recept. Indítsd el az asztali szervert, vagy adj hozzá GitHub CSV forrást és szinkronizálj.",
    "appDataExportCreated": "Appadat export elkészült.",
    "appDataImported": "Appadatok importálva.",
    "importFailed": "Import sikertelen",
    "confirmImportOverwrite": "Ez a mentés felülír minden jelenlegi helyi appadatot. Folytatod?",
    "invalidBackupFile": "Ez nem érvényes nutrino mobilapp mentés.",
    "clearCachedConfirm": "Törlöd a szinkronizált alapanyagokat, ételeket, recepteket, aktivitásokat és merge aliasokat a mobil cache-ből? A naplóbejegyzések az eszközön maradnak. A következő szerveres letöltés teljes katalógus snapshotot kér.",
    "cachedCatalogCleared": "Gyorsítótárban lévő katalógus törölve. A következő szerveres letöltés teljes újratöltés lesz.",
    "privacyBody": "A nutrino a profilodat, naplódat, étel cache-edet és aktivitásadataidat helyben tárolja az eszközödön. Az app csak a párosított asztali szervereddel kommunikál a saját hálózatodon. Nem gyűjtünk, nem adunk el és nem töltünk fel adatot külső szolgáltatásba.",
    "reportIssue": "Hiba jelentése",
    "reportIssueBody": "GitHub Issues megnyitása hibákhoz és ötletekhez.",
    "openRepository": "GitHub repository megnyitása",
    "openRepositoryBody": "Forráskód, README és release-ek megtekintése.",
    "starProject": "Csillagozd meg GitHubon",
    "starProjectBody": "Ha hasznos a nutrino, egy csillag segíti a projektet.",
    "license": "Licenc",
    "sourceCode": "Forráskód",
    "factoryReset": "Gyári visszaállítás",
    "factoryResetBody": "Minden helyi appadat törlése és újrakezdés.",
    "factoryResetConfirm": "Ez törli az összes helyi mobil naplót, profilt, gyorsítótárat és beállítást. Folytatod?",
    "onboardingTitle": "nutrino beállítása",
    "onboardingIntro": "Add meg az alap profiladatokat, hogy a kcal, BMI és cél számítható legyen.",
    "onboardingProfile": "Profil alapadatok",
    "onboardingTour": "Gyors bemutató",
    "onboardingTourBody": "A Home mutatja a kalóriát és makrókat. A Napló a naptárad. A Receptek a szinkronizált katalógus. A Profilban vannak a testadatok és célok.",
    "finishSetup": "Beállítás mentése",
    "next": "Tovább",
    "back": "Vissza",
    "startUsingNutrino": "nutrino indítása",
    "restoreBackup": "Biztonsági mentés visszaállítása",
    "restore": "Visszaállítás",
    "backupProfiles": "Backup profilok",
    "backupProfilesBody": "A helyi visszaállítási pontok külön vannak a normál profiltól, és túlélik az appon belüli gyári visszaállítást.",
    "noBackupProfiles": "Még nincs helyi backup profil.",
    "createBackupProfile": "Backup profil létrehozása",
    "manualBackupProfile": "Kézi backup profil",
    "exportBackupProfile": "Export visszaállítási pont",
    "beforeFactoryResetBackupProfile": "Gyári visszaállítás előtt",
    "beforeImportBackupProfile": "Import előtt",
    "importBackupProfile": "Importált mentés",
    "beforeBackupProfileRestore": "Backup profil visszaállítása előtt",
    "restoreBackupProfile": "Helyi profil visszaállítása",
    "backupProfileCreated": "Backup profil mentve.",
    "backupProfileDeleted": "Backup profil törölve.",
    "backupProfileRestored": "Backup profil visszaállítva.",
    "backupProfileMissing": "A backup profil már nem érhető el.",
    "confirmRestoreBackupProfile": "Visszaállítod ezt a helyi backup profilt? A jelenlegi appadat előtte biztonsági visszaállítási pontként mentésre kerül.",
    "backupProfileSaveFailed": "Nem sikerült helyi backup profilt menteni",
    "backupProfilesUnavailable": "A backup profil tárhely nem érhető el ezen az eszközön.",
    "continueFactoryResetWithoutBackup": "Folytatod a gyári visszaállítást biztonsági visszaállítási pont nélkül?",
    "continueExternalExport": "Folytatod a külső ZIP exportot így is?",
    "emptyBackupFile": "A kiválasztott mentés üres (0 B).",
    "backupVerifySizeMismatch": "Az export ellenőrzött mérete eltér:",
    "backupVerifyFailed": "A külső ZIP export nem ellenőrizhető; böngészős letöltési fallback indult.",
    "backupProfileStillAvailable": "A helyi backup profil továbbra is elérhető az appban.",
    "exportFailed": "Export sikertelen",
    "backupWriteFailed": "A mentés fájlba írása sikertelen",
    "mobileShareUnavailable": "Ez a készülék nem támogatja a biztonságos mobil ZIP megosztást. Az instabil mobil mentés/letöltés exportot nem használjuk, így nem készül 0 B ZIP.",
    "mobileShareSheetHint": "A rendszer megosztási ablakában válaszd a Fájlok, Drive vagy más tárhely appot.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Források",
    "githubCsvSources": "GitHub CSV források",
    "githubCsvSourcesBody": "A desktop szerver opcionális. Adj hozzá egy vagy több GitHub repositoryt Nutrino CSV fájlokkal; az app legfeljebb naponta egyszer automatikusan, vagy kérésre szinkronizálja őket.",
    "addRepo": "Repo hozzáadása",
    "syncGithubNow": "GitHub szinkronizálás most",
    "remove": "Eltávolítás",
    "notSyncedYet": "még nincs szinkronizálva",
    "githubOwnerPlaceholder": "tulajdonos / szervezet",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, pl. main",
    "githubPathPlaceholder": "opcionális útvonal, pl. nutrino/csv",
    "githubTokenPlaceholder": "opcionális GitHub token",
    "sedentary": "Ülő életmód",
    "lowActive": "Kissé aktív",
    "active": "Aktív",
    "veryActive": "Nagyon aktív",
    "birthday": "Születésnap",
    "name": "Név",
    "brandSource": "Márka / forrás",
    "barcodeQr": "Vonalkód / QR",
    "note": "Megjegyzés",
    "optional": "opcionális",
    "kcalPer100g": "kcal / 100g",
    "servingSizeG": "Adagméret g",
    "salt": "Só",
    "description": "Leírás",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal ehhez a bejegyzéshez",
    "recipeExtraKcalHelp": "Hozzáadódik a hozzávalók kcal összegéhez, vagy levonódik belőle. A makrók továbbra is a hozzávalókból számolódnak.",
    "servings": "Adagok",
    "servingsEmptyHelp": "Üresen a teljes recept egy adag.",
    "localRecipeItemsTitle": "Alapanyagok / ételek / receptek",
    "selectItem": "Tétel kiválasztása",
    "localRecipeSearchHint": "Nincs hosszú legördülő — keress étel, alapanyag vagy receptnév alapján.",
    "searchItem": "Tétel keresése",
    "find": "Keresés",
    "noMatchingItem": "Nincs találat.",
    "mobileRecipeSyncHint": "A mobilos receptmódosítások ugyanazzal az ID-val kerülnek feltöltésre, ezért a desktop inbox cserének látja őket.",
    "code": "Kód",
    "type": "Típus",
    "kcalPerMin": "kcal / perc",
    "tdeeEquation": "TDEE képlet",
    "iomEquation": "Institute of Medicine képlet (2005)",
    "iomEquationMacro": "Institute of Medicine képlet (2005), makróeloszlás",
    "dailyKcalAdjustment": "Napi kcal korrekció",
    "macronutrientDistribution": "Makrotápanyag-eloszlás",
    "total": "összesen",
    "aboutBody": "Offline-first táplálkozási napló a saját desktopon futó ételadatbázisodhoz.",
    "aboutThanks": "Köszönet az OpenNutriTrackernek a privacy-first open-source táplálkozási inspirációért, valamint a Tauri, Rust, Vue, Vite, TypeScript, JSZip és Lucide projekteknek a nutrino alapjaiért.",
    "scanBarcodeQr": "Vonalkód / QR szkennelése",
    "scanNutrinoQr": "Nutrino QR szkennelése",
    "scanHelper": "Ha egy recept több QR részből áll, mindegyik számozott QR-t olvasd be egyszer. Ha a kamera nem elérhető, illeszd be vagy írd be a kódot lent.",
    "scanPlaceholder": "vonalkód, QR payload vagy Nutrino kód",
    "catalogMenu": "Katalógus menü",
    "syncedCatalogSearch": "Szinkronizált katalógus keresése",
    "scanBarcodeQrAria": "Vonalkód vagy QR szkennelése",
    "scanQrAria": "QR szkennelése",
    "searchAria": "Keresés",
    "translationsHint": "Csak a szükséges nyelveket add hozzá. Az alap név marad a fallback.",
    "translationLanguage": "Nyelv",
    "translationValue": "Fordított név",
    "translationAddPlaceholder": "Új nyelv hozzáadása…"
  },
  "de": {
    "home": "Start",
    "diary": "Tagebuch",
    "recipes": "Rezepte",
    "profile": "Profil",
    "settings": "Einstellungen",
    "synced": "Synchronisiert",
    "syncing": "Synchronisierung",
    "pending": "ausstehend",
    "supplied": "aufgenommen",
    "burned": "verbrannt",
    "kcalLeft": "kcal übrig",
    "tooMuch": "zu viel",
    "activity": "Aktivität",
    "breakfast": "Frühstück",
    "lunch": "Mittagessen",
    "dinner": "Abendessen",
    "snack": "Snack",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Verbrannte kcal hinzufügen",
    "startTheDay": "Tagesstart",
    "middayMeal": "Mittagsmahlzeit",
    "eveningMeal": "Abendmahlzeit",
    "smallMeals": "Kleine Mahlzeiten",
    "addNewItem": "Neuen Eintrag hinzufügen",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Zurück again within 5 seconds to exit.",
    "noActivity": "No Aktivität logged for this day.",
    "noEntries": "No Einträge yet.",
    "edit": "Bearbeiten",
    "delete": "Löschen",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Einheiten",
    "calculations": "Berechnungen",
    "language": "Sprache",
    "privacy": "Datenschutz",
    "about": "Über",
    "licenses": "Lizenzen",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Danksagungen",
    "exportImport": "App-Daten exportieren / importieren",
    "clearCache": "Cache-Einträge löschen",
    "dailyReminder": "Tägliche Erinnerung",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Design",
    "showActivity": "Aktivitätstracking anzeigen",
    "showMacros": "Mahlzeiten-Makros anzeigen",
    "showMicros": "Mikronährstoffe anzeigen",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Systemstandard",
    "english": "Englisch",
    "hungarian": "Ungarisch",
    "scan": "Scannen",
    "languageSearch": "Sprache nach englischem Namen, Eigenname oder Code suchen…",
    "translations": "Übersetzungen",
    "noTranslations": "Noch keine Übersetzungen.",
    "addTranslation": "Übersetzung hinzufügen",
    "cancel": "Abbrechen",
    "ok": "OK",
    "reset": "Zurücksetzen",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing Einträge on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Lebensmittel and Aktivität Einträge for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real Lebensmittel later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as Notiz",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Tagebuch Einträge and Aktivität logs bleiben lokal auf dem Mobilgerät.",
    "target": "target",
    "weight": "Gewicht",
    "saveWeight": "Speichern Gewicht",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Bearbeiten Gewicht",
    "futureDateWarning": "This date is in the future. Logging future diary Daten can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly Gewicht check",
    "weeklyWeightCheckBody": "Aktualisieren your Gewicht once a week. If it does not change, nutrino keeps using the latest known Wert.",
    "save": "Speichern",
    "addTo": "Hinzufügen to",
    "add": "Hinzufügen",
    "update": "Aktualisieren",
    "addActivity": "Aktivität hinzufügen",
    "updateActivity": "Aktualisieren Aktivität",
    "customRecipe": "Customize Rezept",
    "customRecipeHint": "Changes are saved only for this diary Eintrag.",
    "customizedRecipe": "custom Rezept",
    "editRecipeLocally": "Bearbeiten Rezept for this Eintrag",
    "changeSelection": "Change Lebensmittel/Rezept",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a Lebensmittel or Rezept first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid Gewicht in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Aktivität updated.",
    "activityAdded": "Aktivität added.",
    "activities": "Aktivitäten",
    "entries": "Einträge",
    "foodAndRecipeSearch": "Lebensmittel und Rezepte suchen",
    "searchIn": "Suchen in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Marke",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Beschreibung",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Aktivitäten suchen",
    "recipe": "Rezept",
    "food": "Lebensmittel",
    "ingredient": "Zutat",
    "grams": "Gramm",
    "pieces": "Stück",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app Daten",
    "exportAppDataBody": "Speichern a full lokal ZIP Backup.",
    "importAppData": "Import app Daten",
    "importAppDataBody": "Select a nutrino mobil app ZIP Backup.",
    "channelDataTransfer": "Dev / stable Daten transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Aktualisieren dev from stable Backup",
    "updateStableFromDev": "Aktualisieren stable from dev Backup",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app Daten with a Backup from the other installed channel. Continue?",
    "channelTransferExportProfile": "Kanal transfer Export",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer Import",
    "channelTransferImportProfile": "Kanal transfer Import",
    "channelTransferExportCreated": "Kanal transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Aktivität",
    "activityLevelHint": "Used for täglich kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API Einstellungen",
    "appChannel": "Kanal",
    "devApiHint": "Development mode uses the Desktop LAN URL automatically. Password is only needed if the Desktop-Server requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Serverpasswort",
    "pairingToken": "Pairing token",
    "addKcalNote": "Notiz",
    "existingItem": "Existing",
    "noteEntry": "Notiz",
    "kcalNoteTitle": "Notiz title",
    "kcalNoteDescription": "Beschreibung",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local Katalog actions",
    "addLocalIngredient": "Hinzufügen lokal Zutat",
    "addLocalFood": "Hinzufügen lokal Lebensmittel",
    "addLocalRecipe": "Hinzufügen lokal Rezept",
    "addLocalActivity": "Hinzufügen lokal Aktivität",
    "localItemCreated": "Local Eintrag saved. Sync when the Desktop Server erreichbar ist.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Daten vom Server laden",
    "pushNow": "Daten an Server senden",
    "pullFailedOffline": "Download failed. Local Daten remains available.",
    "pushFailedOffline": "Upload failed. Local Daten stays ausstehend until the Server erreichbar ist.",
    "dailyBackupProfile": "Daily automatic Backup profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop Server is offline.",
    "serverOfflineUsingCache": "Desktop Server is offline. Using lokal zwischengespeicherter Katalog.",
    "deleteEntryConfirm": "Löschen this Eintrag?",
    "deleteActivityConfirm": "Löschen this Aktivität?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Lebensmittel",
    "noSyncedItems": "No synced Lebensmittel or Rezepte yet. Start the Desktop-Server or add a GitHub CSV Quelle and Synchronisierung.",
    "appDataExportCreated": "App Daten Export created.",
    "appDataImported": "App Daten imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This Backup will overwrite all current lokale App-Daten. Continue?",
    "invalidBackupFile": "This is not a valid nutrino mobil app Backup.",
    "clearCachedConfirm": "Clear synced Lebensmittel, Rezepte, Aktivitäten and merge aliases from the mobil cache? Tagebuch logs remain on the device. The next Server download will reload a full Katalog snapshot.",
    "cachedCatalogCleared": "Cached Katalog cleared. The next Server download will fully reload the Katalog.",
    "privacyBody": "nutrino stores your profile, diary, Lebensmittel cache and Aktivität Daten locally on your device. The app only talks to your paired Desktop-Server on your network. We do not collect, sell or upload your Daten to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the Quelle Code, README and releases.",
    "starProject": "Stern geben nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source Code",
    "factoryReset": "Werkseinstellungen",
    "factoryResetBody": "Löschen all lokale App-Daten and restart onboarding.",
    "factoryResetConfirm": "This deletes all lokal mobil diary, profile, zwischengespeicherter Katalog and Einstellungen Daten. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Hinzufügen your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Profil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Start shows calories and macros. Tagebuch shows your calendar. Rezepte lists synced Katalog Einträge. Profil stores your body and goal Einstellungen.",
    "finishSetup": "Finish setup",
    "next": "Weiter",
    "back": "Zurück",
    "startUsingNutrino": "nutrino starten",
    "restoreBackup": "Backup wiederherstellen",
    "restore": "Wiederherstellen",
    "backupProfiles": "Backup-Profils",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No lokal Backup profiles yet.",
    "createBackupProfile": "Create Backup profile",
    "manualBackupProfile": "Manual Backup profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before Import",
    "importBackupProfile": "Imported Backup",
    "beforeBackupProfileRestore": "Before Backup profile restore",
    "restoreBackupProfile": "Wiederherstellen lokal profile",
    "backupProfileCreated": "Backup-Profil saved.",
    "backupProfileDeleted": "Backup-Profil deleted.",
    "backupProfileRestored": "Backup-Profil restored.",
    "backupProfileMissing": "Backup-Profil is no longer available.",
    "confirmRestoreBackupProfile": "Wiederherstellen this lokal Backup profile? Current app Daten will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a lokal Backup profile",
    "backupProfilesUnavailable": "Backup-Profil storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP Export anyway?",
    "emptyBackupFile": "The selected Backup file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP Export could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A lokal Backup profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe mobil ZIP sharing. The unstable mobil save/download Export was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub-CSV-Quellen",
    "githubCsvSourcesBody": "Desktop Server is optional. Hinzufügen one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Hinzufügen repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Entfernen",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "optional path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "optional GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Name",
    "brandSource": "Marke / Quelle",
    "barcodeQr": "Barcode / QR",
    "note": "Notiz",
    "optional": "optional",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Portionsgröße g",
    "salt": "Salt",
    "description": "Beschreibung",
    "extraKcal": "Extra-kcal",
    "extraKcalForThisEntry": "Extra-kcal for this Eintrag",
    "recipeExtraKcalHelp": "Adds to or subtracts from the Zutat kcal gesamt. Macros still come from Zutaten.",
    "servings": "Portionen",
    "servingsEmptyHelp": "Leave empty to make the whole Rezept one serving.",
    "localRecipeItemsTitle": "Zutaten / Lebensmittel / Rezepte",
    "selectItem": "Select Eintrag",
    "localRecipeSearchHint": "No long dropdown — suchen by Lebensmittel, Zutat or Rezept Name.",
    "searchItem": "Suchen Eintrag",
    "find": "Suchen",
    "noMatchingItem": "Kein passender Eintrag.",
    "mobileRecipeSyncHint": "Mobile Rezept changes are uploaded with the dieselbe ID, so the Desktop-Inbox sees them as Ersetzungen.",
    "code": "Code",
    "type": "Typ",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first Ernährungstagebuch for your own Desktop-Lebensmitteldatenbank.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-Quelle nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Barcode / QR scannen",
    "scanNutrinoQr": "Nutrino-QR scannen",
    "scanHelper": "Wenn ein Rezept aus mehreren QR-Teilen besteht, scanne jeden nummerierten QR-Code einmal. Wenn die Kamera nicht verfügbar ist, füge den Code unten ein oder tippe ihn ein.",
    "scanPlaceholder": "Barcode, QR-Inhalt oder Nutrino-Code",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Suchen synced Katalog",
    "scanBarcodeQrAria": "Scannen Barcode or QR",
    "scanQrAria": "Scannen QR",
    "searchAria": "Suchen",
    "translationsHint": "Füge nur die benötigten Sprachen hinzu. Der Basisname bleibt der Fallback.",
    "translationLanguage": "Sprache",
    "translationValue": "Übersetzter Name",
    "translationAddPlaceholder": "Weitere Sprache hinzufügen…"
  },
  "fr": {
    "home": "Accueil",
    "diary": "Journal",
    "recipes": "Recettes",
    "profile": "Profil",
    "settings": "Paramètres",
    "synced": "Synchronisé",
    "syncing": "Synchronisation",
    "pending": "en attente",
    "supplied": "consommé",
    "burned": "brûlé",
    "kcalLeft": "kcal restantes",
    "tooMuch": "trop",
    "activity": "Activité",
    "breakfast": "Petit-déjeuner",
    "lunch": "Déjeuner",
    "dinner": "Dîner",
    "snack": "Collation",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Ajouter kcal brûlées",
    "startTheDay": "Commencer la journée",
    "middayMeal": "Repas de midi",
    "eveningMeal": "Repas du soir",
    "smallMeals": "Petits repas",
    "addNewItem": "Ajouter un élément",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Retour again within 5 seconds to exit.",
    "noActivity": "No activité logged for this day.",
    "noEntries": "No entrées yet.",
    "edit": "Modifier",
    "delete": "Supprimer",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Unités",
    "calculations": "Calculs",
    "language": "Langue",
    "privacy": "Confidentialité",
    "about": "À propos",
    "licenses": "Licences",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Remerciements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached éléments",
    "dailyReminder": "Rappel quotidien",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Thème",
    "showActivity": "Show Activité Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Valeur système",
    "english": "Anglais",
    "hungarian": "Hongrois",
    "scan": "Scanner",
    "languageSearch": "Rechercher par nom anglais, nom natif ou code…",
    "translations": "Traductions",
    "noTranslations": "Aucune traduction.",
    "addTranslation": "Ajouter une traduction",
    "cancel": "Annuler",
    "ok": "OK",
    "reset": "Réinitialiser",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing entrées on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Aliment and activité entrées for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real aliments later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as note",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Journal entrées and activité logs restent locaux sur mobile.",
    "target": "target",
    "weight": "poids",
    "saveWeight": "Enregistrer poids",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Modifier poids",
    "futureDateWarning": "This date is in the future. Logging future diary données can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly poids check",
    "weeklyWeightCheckBody": "Mettre à jour your poids once a week. If it does not change, nutrino keeps using the latest known valeur.",
    "save": "Enregistrer",
    "addTo": "Ajouter to",
    "add": "Ajouter",
    "update": "Mettre à jour",
    "addActivity": "Ajouter une activité",
    "updateActivity": "Mettre à jour activité",
    "customRecipe": "Customize recette",
    "customRecipeHint": "Changes are saved only for this diary entrée.",
    "customizedRecipe": "custom recette",
    "editRecipeLocally": "Modifier recette for this entrée",
    "changeSelection": "Change aliment/recette",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a aliment or recette first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid poids in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Activité updated.",
    "activityAdded": "Activité added.",
    "activities": "Activités",
    "entries": "entrées",
    "foodAndRecipeSearch": "Rechercher aliments et recettes",
    "searchIn": "Rechercher in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Marque",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Description",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Rechercher activités",
    "recipe": "Recette",
    "food": "Aliment",
    "ingredient": "Ingrédient",
    "grams": "grammes",
    "pieces": "pièces",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app données",
    "exportAppDataBody": "Enregistrer a full local ZIP sauvegarde.",
    "importAppData": "Import app données",
    "importAppDataBody": "Select a nutrino mobile app ZIP sauvegarde.",
    "channelDataTransfer": "Dev / stable données transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Mettre à jour dev from stable sauvegarde",
    "updateStableFromDev": "Mettre à jour stable from dev sauvegarde",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app données with a sauvegarde from the other installed channel. Continue?",
    "channelTransferExportProfile": "Canal transfer export",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer import",
    "channelTransferImportProfile": "Canal transfer import",
    "channelTransferExportCreated": "Canal transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Activité",
    "activityLevelHint": "Used for quotidien kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API paramètres",
    "appChannel": "Canal",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the serveur desktop requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Mot de passe serveur",
    "pairingToken": "Pairing token",
    "addKcalNote": "Note",
    "existingItem": "Existing",
    "noteEntry": "Note",
    "kcalNoteTitle": "Note title",
    "kcalNoteDescription": "Description",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local catalogue actions",
    "addLocalIngredient": "Ajouter local ingrédient",
    "addLocalFood": "Ajouter local aliment",
    "addLocalRecipe": "Ajouter local recette",
    "addLocalActivity": "Ajouter local activité",
    "localItemCreated": "Local élément saved. Sync when the desktop serveur est accessible.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Charger les données du serveur",
    "pushNow": "Envoyer les données au serveur",
    "pullFailedOffline": "Download failed. Local données remains available.",
    "pushFailedOffline": "Upload failed. Local données stays en attente until the serveur est accessible.",
    "dailyBackupProfile": "Daily automatic sauvegarde profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop serveur is offline.",
    "serverOfflineUsingCache": "Desktop serveur is offline. Using local catalogue en cache.",
    "deleteEntryConfirm": "Supprimer this entrée?",
    "deleteActivityConfirm": "Supprimer this activité?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Aliments",
    "noSyncedItems": "No synced aliments or recettes yet. Démarrer the serveur desktop or add a GitHub CSV source and synchronisation.",
    "appDataExportCreated": "App données export created.",
    "appDataImported": "App données imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This sauvegarde will overwrite all current données locales de l’app. Continue?",
    "invalidBackupFile": "This is not a valid nutrino mobile app sauvegarde.",
    "clearCachedConfirm": "Clear synced aliments, recettes, activités and merge aliases from the mobile cache? Journal logs remain on the device. The next serveur download will reload a full catalogue snapshot.",
    "cachedCatalogCleared": "Cached catalogue cleared. The next serveur download will fully reload the catalogue.",
    "privacyBody": "nutrino stores your profile, diary, aliment cache and activité données locally on your device. The app only talks to your paired serveur desktop on your network. We do not collect, sell or upload your données to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the source code, README and releases.",
    "starProject": "Étoile nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source code",
    "factoryReset": "Réinitialisation",
    "factoryResetBody": "Supprimer all données locales de l’app and restart onboarding.",
    "factoryResetConfirm": "This deletes all local mobile diary, profile, catalogue en cache and paramètres données. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Ajouter your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Profil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Accueil shows calories and macros. Journal shows your calendar. Recettes lists synced catalogue éléments. Profil stores your body and goal paramètres.",
    "finishSetup": "Finish setup",
    "next": "Suivant",
    "back": "Retour",
    "startUsingNutrino": "Commencer nutrino",
    "restoreBackup": "Restaurer une sauvegarde",
    "restore": "Restaurer",
    "backupProfiles": "Profil de sauvegardes",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No local sauvegarde profiles yet.",
    "createBackupProfile": "Create sauvegarde profile",
    "manualBackupProfile": "Manual sauvegarde profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before import",
    "importBackupProfile": "Imported sauvegarde",
    "beforeBackupProfileRestore": "Before sauvegarde profile restore",
    "restoreBackupProfile": "Restaurer local profile",
    "backupProfileCreated": "Profil de sauvegarde saved.",
    "backupProfileDeleted": "Profil de sauvegarde deleted.",
    "backupProfileRestored": "Profil de sauvegarde restored.",
    "backupProfileMissing": "Profil de sauvegarde is no longer available.",
    "confirmRestoreBackupProfile": "Restaurer this local sauvegarde profile? Current app données will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a local sauvegarde profile",
    "backupProfilesUnavailable": "Profil de sauvegarde storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP export anyway?",
    "emptyBackupFile": "The selected sauvegarde file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP export could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A local sauvegarde profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe mobile ZIP sharing. The unstable mobile save/download export was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "Sources CSV GitHub",
    "githubCsvSourcesBody": "Desktop serveur is facultatif. Ajouter one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Ajouter repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Supprimer",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "facultatif path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "facultatif GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Nom",
    "brandSource": "Marque / source",
    "barcodeQr": "Barcode / QR",
    "note": "Note",
    "optional": "facultatif",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Description",
    "extraKcal": "Kcal extra",
    "extraKcalForThisEntry": "Kcal extra for this entrée",
    "recipeExtraKcalHelp": "Adds to or subtracts from the ingrédient kcal totales. Macros still come from ingrédients.",
    "servings": "Portions",
    "servingsEmptyHelp": "Leave empty to make the whole recette one serving.",
    "localRecipeItemsTitle": "Ingrédients / aliments / recettes",
    "selectItem": "Select élément",
    "localRecipeSearchHint": "No long dropdown — rechercher by aliment, ingrédient or recette nom.",
    "searchItem": "Rechercher élément",
    "find": "Rechercher",
    "noMatchingItem": "Aucun élément correspondant.",
    "mobileRecipeSyncHint": "Mobile recette changes are uploaded with the même ID, so the boîte desktop sees them as remplacements.",
    "code": "Code",
    "type": "Type",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Journal nutrition offline-first for your own base alimentaire desktop.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-source nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Scanner le code-barres / QR",
    "scanNutrinoQr": "Scanner le QR Nutrino",
    "scanHelper": "Si une recette contient plusieurs QR, scanne chaque QR numéroté une seule fois. Si la caméra n’est pas disponible, colle ou saisis le code ci-dessous.",
    "scanPlaceholder": "code-barres, contenu QR ou code Nutrino",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Rechercher synced catalogue",
    "scanBarcodeQrAria": "Scanner code-barres or QR",
    "scanQrAria": "Scanner QR",
    "searchAria": "Rechercher",
    "translationsHint": "Ajoute uniquement les langues nécessaires. Le nom de base reste la valeur de secours.",
    "translationLanguage": "Langue",
    "translationValue": "Nom traduit",
    "translationAddPlaceholder": "Ajouter une langue…"
  },
  "ru": {
    "home": "Главная",
    "diary": "Дневник",
    "recipes": "Рецепты",
    "profile": "Профиль",
    "settings": "Настройки",
    "synced": "Синхронизировано",
    "syncing": "Синхронизация",
    "pending": "ожидает",
    "supplied": "получено",
    "burned": "сожжено",
    "kcalLeft": "ккал осталось",
    "tooMuch": "слишком много",
    "activity": "Активность",
    "breakfast": "Завтрак",
    "lunch": "Обед",
    "dinner": "Ужин",
    "snack": "Перекус",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Добавить сожжено kcal",
    "startTheDay": "Старт the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Добавить new элемент",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Назад again within 5 seconds to exit.",
    "noActivity": "No активность logged for this day.",
    "noEntries": "No записи yet.",
    "edit": "Изменить",
    "delete": "Удалить",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Единицы",
    "calculations": "Расчёты",
    "language": "Язык",
    "privacy": "Конфиденциальность",
    "about": "О приложении",
    "licenses": "Лицензии",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached элементы",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Активность Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Системный язык",
    "english": "Английский",
    "hungarian": "Венгерский",
    "scan": "Сканировать",
    "languageSearch": "Поиск по английскому названию, родному названию или коду…",
    "translations": "Переводы",
    "noTranslations": "Переводов пока нет.",
    "addTranslation": "Добавить перевод",
    "cancel": "Отмена",
    "ok": "OK",
    "reset": "Сброс",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing записи on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Еда and активность записи for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real еда later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as заметка",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Дневник записи and активность logs stay локальный on мобильный.",
    "target": "target",
    "weight": "вес",
    "saveWeight": "Сохранить вес",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Изменить вес",
    "futureDateWarning": "This date is in the future. Logging future diary данные can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly вес check",
    "weeklyWeightCheckBody": "Обновить your вес once a week. If it does not change, nutrino keeps using the latest known значение.",
    "save": "Сохранить",
    "addTo": "Добавить to",
    "add": "Добавить",
    "update": "Обновить",
    "addActivity": "Добавить активность",
    "updateActivity": "Обновить активность",
    "customRecipe": "Customize рецепт",
    "customRecipeHint": "Changes are saved only for this diary запись.",
    "customizedRecipe": "custom рецепт",
    "editRecipeLocally": "Изменить рецепт for this запись",
    "changeSelection": "Change еда/рецепт",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a еда or рецепт first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid вес in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Активность updated.",
    "activityAdded": "Активность added.",
    "activities": "Активности",
    "entries": "записи",
    "foodAndRecipeSearch": "Поиск еда and рецепты",
    "searchIn": "Поиск in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Бренд",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Описание",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Поиск активности",
    "recipe": "Рецепт",
    "food": "Еда",
    "ingredient": "Ингредиент",
    "grams": "граммы",
    "pieces": "штуки",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app данные",
    "exportAppDataBody": "Сохранить a full локальный ZIP резервная копия.",
    "importAppData": "Import app данные",
    "importAppDataBody": "Select a nutrino мобильный app ZIP резервная копия.",
    "channelDataTransfer": "Dev / stable данные transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Обновить dev from stable резервная копия",
    "updateStableFromDev": "Обновить stable from dev резервная копия",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app данные with a резервная копия from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer экспорт",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer импорт",
    "channelTransferImportProfile": "Channel transfer импорт",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Активность",
    "activityLevelHint": "Used for ежедневно kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API настройки",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop сервер requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Пароль сервера",
    "pairingToken": "Pairing token",
    "addKcalNote": "Заметка",
    "existingItem": "Existing",
    "noteEntry": "Заметка",
    "kcalNoteTitle": "Заметка title",
    "kcalNoteDescription": "Описание",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local каталог actions",
    "addLocalIngredient": "Добавить локальный ингредиент",
    "addLocalFood": "Добавить локальный еда",
    "addLocalRecipe": "Добавить локальный рецепт",
    "addLocalActivity": "Добавить локальный активность",
    "localItemCreated": "Local элемент saved. Sync when the desktop сервер is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load данные from сервер",
    "pushNow": "Send данные to сервер",
    "pullFailedOffline": "Download failed. Local данные remains available.",
    "pushFailedOffline": "Upload failed. Local данные stays ожидает until the сервер is reachable.",
    "dailyBackupProfile": "Daily automatic резервная копия profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop сервер is offline.",
    "serverOfflineUsingCache": "Desktop сервер is offline. Using локальный cached каталог.",
    "deleteEntryConfirm": "Удалить this запись?",
    "deleteActivityConfirm": "Удалить this активность?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Еда",
    "noSyncedItems": "No synced еда or рецепты yet. Старт the desktop сервер or add a GitHub CSV источник and синхронизация.",
    "appDataExportCreated": "App данные экспорт created.",
    "appDataImported": "App данные imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This резервная копия will overwrite all current локальный app данные. Continue?",
    "invalidBackupFile": "This is not a valid nutrino мобильный app резервная копия.",
    "clearCachedConfirm": "Clear synced еда, рецепты, активности and merge aliases from the мобильный cache? Дневник logs remain on the device. The next сервер download will reload a full каталог snapshot.",
    "cachedCatalogCleared": "Cached каталог cleared. The next сервер download will fully reload the каталог.",
    "privacyBody": "nutrino stores your profile, diary, еда cache and активность данные locally on your device. The app only talks to your paired desktop сервер on your network. We do not collect, sell or upload your данные to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the источник код, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source код",
    "factoryReset": "Сброс",
    "factoryResetBody": "Удалить all локальный app данные and restart onboarding.",
    "factoryResetConfirm": "This deletes all локальный мобильный diary, profile, cached каталог and настройки данные. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Добавить your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Профиль basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Главная shows calories and macros. Дневник shows your calendar. Рецепты lists synced каталог элементы. Профиль stores your body and goal настройки.",
    "finishSetup": "Finish setup",
    "next": "Далее",
    "back": "Назад",
    "startUsingNutrino": "Старт using nutrino",
    "restoreBackup": "Восстановить копию",
    "restore": "Восстановить",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No локальный резервная копия profiles yet.",
    "createBackupProfile": "Create резервная копия profile",
    "manualBackupProfile": "Manual резервная копия profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before импорт",
    "importBackupProfile": "Imported резервная копия",
    "beforeBackupProfileRestore": "Before резервная копия profile restore",
    "restoreBackupProfile": "Восстановить локальный profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Восстановить this локальный резервная копия profile? Current app данные will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a локальный резервная копия profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP экспорт anyway?",
    "emptyBackupFile": "The selected резервная копия file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP экспорт could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A локальный резервная копия profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe мобильный ZIP sharing. The unstable мобильный save/download экспорт was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV источники",
    "githubCsvSourcesBody": "Desktop сервер is необязательно. Добавить one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Добавить repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Удалить",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "необязательно path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "необязательно GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Название",
    "brandSource": "Бренд / источник",
    "barcodeQr": "Barcode / QR",
    "note": "Заметка",
    "optional": "необязательно",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Описание",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this запись",
    "recipeExtraKcalHelp": "Adds to or subtracts from the ингредиент kcal total. Macros still come from ингредиенты.",
    "servings": "Порции",
    "servingsEmptyHelp": "Leave empty to make the whole рецепт one serving.",
    "localRecipeItemsTitle": "Ингредиенты / еда / рецепты",
    "selectItem": "Select элемент",
    "localRecipeSearchHint": "No long dropdown — поиск by еда, ингредиент or рецепт название.",
    "searchItem": "Поиск элемент",
    "find": "Найти",
    "noMatchingItem": "Нет совпадений.",
    "mobileRecipeSyncHint": "Mobile рецепт changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Код",
    "type": "Тип",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop еда database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-источник nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Сканировать штрихкод / QR",
    "scanNutrinoQr": "Сканировать QR Nutrino",
    "scanHelper": "If a рецепт has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the код below.",
    "scanPlaceholder": "штрихкод, данные QR или код Nutrino",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Поиск synced каталог",
    "scanBarcodeQrAria": "Сканировать штрихкод or QR",
    "scanQrAria": "Сканировать QR",
    "searchAria": "Поиск",
    "translationsHint": "Добавляйте только нужные языки. Базовое имя остаётся резервным.",
    "translationLanguage": "Язык",
    "translationValue": "Переведённое название",
    "translationAddPlaceholder": "Добавить язык…"
  },
  "uk": {
    "home": "Головна",
    "diary": "Щоденник",
    "recipes": "Рецепти",
    "profile": "Профіль",
    "settings": "Налаштування",
    "synced": "Синхронізовано",
    "syncing": "Синхронізація",
    "pending": "очікує",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "Активність",
    "breakfast": "Сніданок",
    "lunch": "Обід",
    "dinner": "Вечеря",
    "snack": "Перекус",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Додати burned kcal",
    "startTheDay": "Старт the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Додати new елемент",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Назад again within 5 seconds to exit.",
    "noActivity": "No активність logged for this day.",
    "noEntries": "No записи yet.",
    "edit": "Редагувати",
    "delete": "Видалити",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Одиниці",
    "calculations": "Розрахунки",
    "language": "Мова",
    "privacy": "Приватність",
    "about": "Про застосунок",
    "licenses": "Ліцензії",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached елементи",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Активність Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Системна",
    "english": "Англійська",
    "hungarian": "Угорська",
    "scan": "Сканувати",
    "languageSearch": "Пошук за англійською назвою, рідною назвою або кодом…",
    "translations": "Переклади",
    "noTranslations": "Перекладів ще немає.",
    "addTranslation": "Додати переклад",
    "cancel": "Скасувати",
    "ok": "OK",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing записи on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Їжа and активність записи for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real їжа later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as нотатка",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Щоденник записи and активність logs stay локальний on мобільний.",
    "target": "target",
    "weight": "вага",
    "saveWeight": "Зберегти вага",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Редагувати вага",
    "futureDateWarning": "This date is in the future. Logging future diary дані can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly вага check",
    "weeklyWeightCheckBody": "Оновити your вага once a week. If it does not change, nutrino keeps using the latest known значення.",
    "save": "Зберегти",
    "addTo": "Додати to",
    "add": "Додати",
    "update": "Оновити",
    "addActivity": "Додати активність",
    "updateActivity": "Оновити активність",
    "customRecipe": "Customize рецепт",
    "customRecipeHint": "Changes are saved only for this diary запис.",
    "customizedRecipe": "custom рецепт",
    "editRecipeLocally": "Редагувати рецепт for this запис",
    "changeSelection": "Change їжа/рецепт",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a їжа or рецепт first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid вага in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Активність updated.",
    "activityAdded": "Активність added.",
    "activities": "Активності",
    "entries": "записи",
    "foodAndRecipeSearch": "Пошук їжа and рецепти",
    "searchIn": "Пошук in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Бренд",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Опис",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Пошук активності",
    "recipe": "Рецепт",
    "food": "Їжа",
    "ingredient": "Інгредієнт",
    "grams": "грами",
    "pieces": "штуки",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app дані",
    "exportAppDataBody": "Зберегти a full локальний ZIP резервна копія.",
    "importAppData": "Import app дані",
    "importAppDataBody": "Select a nutrino мобільний app ZIP резервна копія.",
    "channelDataTransfer": "Dev / stable дані transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Оновити dev from stable резервна копія",
    "updateStableFromDev": "Оновити stable from dev резервна копія",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app дані with a резервна копія from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer експорт",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer імпорт",
    "channelTransferImportProfile": "Channel transfer імпорт",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Активність",
    "activityLevelHint": "Used for щоденно kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API налаштування",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop сервер requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Пароль сервера",
    "pairingToken": "Pairing token",
    "addKcalNote": "Нотатка",
    "existingItem": "Existing",
    "noteEntry": "Нотатка",
    "kcalNoteTitle": "Нотатка title",
    "kcalNoteDescription": "Опис",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local каталог actions",
    "addLocalIngredient": "Додати локальний інгредієнт",
    "addLocalFood": "Додати локальний їжа",
    "addLocalRecipe": "Додати локальний рецепт",
    "addLocalActivity": "Додати локальний активність",
    "localItemCreated": "Local елемент saved. Sync when the desktop сервер is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load дані from сервер",
    "pushNow": "Send дані to сервер",
    "pullFailedOffline": "Download failed. Local дані remains available.",
    "pushFailedOffline": "Upload failed. Local дані stays очікує until the сервер is reachable.",
    "dailyBackupProfile": "Daily automatic резервна копія profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop сервер is offline.",
    "serverOfflineUsingCache": "Desktop сервер is offline. Using локальний cached каталог.",
    "deleteEntryConfirm": "Видалити this запис?",
    "deleteActivityConfirm": "Видалити this активність?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Їжа",
    "noSyncedItems": "No synced їжа or рецепти yet. Старт the desktop сервер or add a GitHub CSV джерело and синхронізація.",
    "appDataExportCreated": "App дані експорт created.",
    "appDataImported": "App дані imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This резервна копія will overwrite all current локальний app дані. Continue?",
    "invalidBackupFile": "This is not a valid nutrino мобільний app резервна копія.",
    "clearCachedConfirm": "Clear synced їжа, рецепти, активності and merge aliases from the мобільний cache? Щоденник logs remain on the device. The next сервер download will reload a full каталог snapshot.",
    "cachedCatalogCleared": "Cached каталог cleared. The next сервер download will fully reload the каталог.",
    "privacyBody": "nutrino stores your profile, diary, їжа cache and активність дані locally on your device. The app only talks to your paired desktop сервер on your network. We do not collect, sell or upload your дані to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the джерело код, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source код",
    "factoryReset": "Скидання",
    "factoryResetBody": "Видалити all локальний app дані and restart onboarding.",
    "factoryResetConfirm": "This deletes all локальний мобільний diary, profile, cached каталог and налаштування дані. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Додати your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Профіль basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Головна shows calories and macros. Щоденник shows your calendar. Рецепти lists synced каталог елементи. Профіль stores your body and goal налаштування.",
    "finishSetup": "Finish setup",
    "next": "Далі",
    "back": "Назад",
    "startUsingNutrino": "Старт using nutrino",
    "restoreBackup": "Відновити копію",
    "restore": "Відновити",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No локальний резервна копія profiles yet.",
    "createBackupProfile": "Create резервна копія profile",
    "manualBackupProfile": "Manual резервна копія profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before імпорт",
    "importBackupProfile": "Imported резервна копія",
    "beforeBackupProfileRestore": "Before резервна копія profile restore",
    "restoreBackupProfile": "Відновити локальний profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Відновити this локальний резервна копія profile? Current app дані will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a локальний резервна копія profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP експорт anyway?",
    "emptyBackupFile": "The selected резервна копія file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP експорт could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A локальний резервна копія profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe мобільний ZIP sharing. The unstable мобільний save/download експорт was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV джерела",
    "githubCsvSourcesBody": "Desktop сервер is необов’язково. Додати one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Додати repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Видалити",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "необов’язково path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "необов’язково GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Назва",
    "brandSource": "Бренд / джерело",
    "barcodeQr": "Barcode / QR",
    "note": "Нотатка",
    "optional": "необов’язково",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Опис",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this запис",
    "recipeExtraKcalHelp": "Adds to or subtracts from the інгредієнт kcal total. Macros still come from інгредієнти.",
    "servings": "Порції",
    "servingsEmptyHelp": "Leave empty to make the whole рецепт one serving.",
    "localRecipeItemsTitle": "Інгредієнти / їжа / рецепти",
    "selectItem": "Select елемент",
    "localRecipeSearchHint": "No long dropdown — пошук by їжа, інгредієнт or рецепт назва.",
    "searchItem": "Пошук елемент",
    "find": "Знайти",
    "noMatchingItem": "Немає збігів.",
    "mobileRecipeSyncHint": "Mobile рецепт changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Код",
    "type": "Тип",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop їжа database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-джерело nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Сканувати штрихкод / QR",
    "scanNutrinoQr": "Сканувати QR Nutrino",
    "scanHelper": "If a рецепт has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the код below.",
    "scanPlaceholder": "штрихкод, QR-дані або код Nutrino",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Пошук synced каталог",
    "scanBarcodeQrAria": "Сканувати штрихкод or QR",
    "scanQrAria": "Сканувати QR",
    "searchAria": "Пошук",
    "translationsHint": "Додавайте лише потрібні мови. Базова назва лишається резервною.",
    "translationLanguage": "Мова",
    "translationValue": "Перекладена назва",
    "translationAddPlaceholder": "Додати мову…"
  },
  "zh": {
    "home": "首页",
    "diary": "日记",
    "recipes": "食谱",
    "profile": "档案",
    "settings": "设置",
    "synced": "已同步",
    "syncing": "同步中",
    "pending": "待处理",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "活动",
    "breakfast": "早餐",
    "lunch": "午餐",
    "dinner": "晚餐",
    "snack": "加餐",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "添加 burned kcal",
    "startTheDay": "启动 the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "添加 new 项目",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press 返回 again within 5 seconds to exit.",
    "noActivity": "No 活动 logged for this day.",
    "noEntries": "No 记录 yet.",
    "edit": "编辑",
    "delete": "删除",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "单位",
    "calculations": "计算",
    "language": "语言",
    "privacy": "隐私",
    "about": "关于",
    "licenses": "许可证",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached 项目",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show 活动 Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "系统默认",
    "english": "英语",
    "hungarian": "匈牙利语",
    "scan": "扫描",
    "languageSearch": "按英文名、本地名或代码搜索语言…",
    "translations": "翻译",
    "noTranslations": "暂无翻译。",
    "addTranslation": "添加翻译",
    "cancel": "取消",
    "ok": "确定",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing 记录 on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "食物 and 活动 记录 for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real 食物 later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as 备注",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "日记 记录 and 活动 logs stay 本地 on 移动端.",
    "target": "target",
    "weight": "体重",
    "saveWeight": "保存 体重",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "编辑 体重",
    "futureDateWarning": "This date is in the future. Logging future diary 数据 can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly 体重 check",
    "weeklyWeightCheckBody": "更新 your 体重 once a week. If it does not change, nutrino keeps using the latest known 值.",
    "save": "保存",
    "addTo": "添加 to",
    "add": "添加",
    "update": "更新",
    "addActivity": "添加活动",
    "updateActivity": "更新 活动",
    "customRecipe": "Customize 食谱",
    "customRecipeHint": "Changes are saved only for this diary 记录.",
    "customizedRecipe": "custom 食谱",
    "editRecipeLocally": "编辑 食谱 for this 记录",
    "changeSelection": "Change 食物/食谱",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a 食物 or 食谱 first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid 体重 in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "活动 updated.",
    "activityAdded": "活动 added.",
    "activities": "活动",
    "entries": "记录",
    "foodAndRecipeSearch": "搜索 食物 and 食谱",
    "searchIn": "搜索 in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "品牌",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "描述",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "搜索 活动",
    "recipe": "食谱",
    "food": "食物",
    "ingredient": "配料",
    "grams": "克",
    "pieces": "件",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app 数据",
    "exportAppDataBody": "保存 a full 本地 ZIP 备份.",
    "importAppData": "Import app 数据",
    "importAppDataBody": "Select a nutrino 移动端 app ZIP 备份.",
    "channelDataTransfer": "Dev / stable 数据 transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "更新 dev from stable 备份",
    "updateStableFromDev": "更新 stable from dev 备份",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app 数据 with a 备份 from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer 导出",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer 导入",
    "channelTransferImportProfile": "Channel transfer 导入",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "活动",
    "activityLevelHint": "Used for 每日 kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API 设置",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the 桌面端 LAN URL automatically. Password is only needed if the 桌面端 服务器 requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "服务器密码",
    "pairingToken": "Pairing token",
    "addKcalNote": "备注",
    "existingItem": "Existing",
    "noteEntry": "备注",
    "kcalNoteTitle": "备注 title",
    "kcalNoteDescription": "描述",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local 目录 actions",
    "addLocalIngredient": "添加 本地 配料",
    "addLocalFood": "添加 本地 食物",
    "addLocalRecipe": "添加 本地 食谱",
    "addLocalActivity": "添加 本地 活动",
    "localItemCreated": "Local 项目 saved. Sync when the 桌面端 服务器 is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load 数据 from 服务器",
    "pushNow": "Send 数据 to 服务器",
    "pullFailedOffline": "Download failed. Local 数据 remains available.",
    "pushFailedOffline": "Upload failed. Local 数据 stays 待处理 until the 服务器 is reachable.",
    "dailyBackupProfile": "Daily automatic 备份 profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop 服务器 is offline.",
    "serverOfflineUsingCache": "Desktop 服务器 is offline. Using 本地 cached 目录.",
    "deleteEntryConfirm": "删除 this 记录?",
    "deleteActivityConfirm": "删除 this 活动?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "食物",
    "noSyncedItems": "No synced 食物 or 食谱 yet. 启动 the 桌面端 服务器 or add a GitHub CSV 来源 and 同步.",
    "appDataExportCreated": "App 数据 导出 created.",
    "appDataImported": "App 数据 imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This 备份 will overwrite all current 本地 app 数据. Continue?",
    "invalidBackupFile": "This is not a valid nutrino 移动端 app 备份.",
    "clearCachedConfirm": "Clear synced 食物, 食谱, 活动 and merge aliases from the 移动端 cache? 日记 logs remain on the device. The next 服务器 download will reload a full 目录 snapshot.",
    "cachedCatalogCleared": "Cached 目录 cleared. The next 服务器 download will fully reload the 目录.",
    "privacyBody": "nutrino stores your profile, diary, 食物 cache and 活动 数据 locally on your device. The app only talks to your paired 桌面端 服务器 on your network. We do not collect, sell or upload your 数据 to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the 来源 代码, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source 代码",
    "factoryReset": "恢复出厂",
    "factoryResetBody": "删除 all 本地 app 数据 and restart onboarding.",
    "factoryResetConfirm": "This deletes all 本地 移动端 diary, profile, cached 目录 and 设置 数据. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "添加 your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "档案 basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "首页 shows calories and macros. 日记 shows your calendar. 食谱 lists synced 目录 项目. 档案 stores your body and goal 设置.",
    "finishSetup": "Finish setup",
    "next": "下一步",
    "back": "返回",
    "startUsingNutrino": "启动 using nutrino",
    "restoreBackup": "恢复备份",
    "restore": "恢复",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No 本地 备份 profiles yet.",
    "createBackupProfile": "Create 备份 profile",
    "manualBackupProfile": "Manual 备份 profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before 导入",
    "importBackupProfile": "Imported 备份",
    "beforeBackupProfileRestore": "Before 备份 profile restore",
    "restoreBackupProfile": "恢复 本地 profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "恢复 this 本地 备份 profile? Current app 数据 will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a 本地 备份 profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP 导出 anyway?",
    "emptyBackupFile": "The selected 备份 file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP 导出 could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A 本地 备份 profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe 移动端 ZIP sharing. The unstable 移动端 save/download 导出 was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV 来源",
    "githubCsvSourcesBody": "Desktop 服务器 is 可选. 添加 one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "添加 repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "移除",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "可选 path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "可选 GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "名称",
    "brandSource": "品牌 / 来源",
    "barcodeQr": "Barcode / QR",
    "note": "备注",
    "optional": "可选",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "描述",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this 记录",
    "recipeExtraKcalHelp": "Adds to or subtracts from the 配料 kcal total. Macros still come from 配料.",
    "servings": "份数",
    "servingsEmptyHelp": "Leave empty to make the whole 食谱 one serving.",
    "localRecipeItemsTitle": "配料 / 食物 / 食谱",
    "selectItem": "Select 项目",
    "localRecipeSearchHint": "No long dropdown — 搜索 by 食物, 配料 or 食谱 名称.",
    "searchItem": "搜索 项目",
    "find": "查找",
    "noMatchingItem": "没有匹配项。",
    "mobileRecipeSyncHint": "Mobile 食谱 changes are uploaded with the same ID, so the 桌面端 inbox sees them as replacements.",
    "code": "代码",
    "type": "类型",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own 桌面端 食物 database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-来源 nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "扫描条码 / QR",
    "scanNutrinoQr": "扫描 Nutrino QR",
    "scanHelper": "If a 食谱 has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the 代码 below.",
    "scanPlaceholder": "条码、QR 内容或 Nutrino 代码",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "搜索 synced 目录",
    "scanBarcodeQrAria": "扫描 条码 or QR",
    "scanQrAria": "扫描 QR",
    "searchAria": "搜索",
    "translationsHint": "只添加需要的语言。基础名称仍作为备用。",
    "translationLanguage": "语言",
    "translationValue": "翻译名称",
    "translationAddPlaceholder": "添加其他语言…"
  },
  "sk": {
    "home": "Domov",
    "diary": "Denník",
    "recipes": "Recepty",
    "profile": "Profil",
    "settings": "Nastavenia",
    "synced": "Synchronizované",
    "syncing": "Synchronizácia",
    "pending": "čaká",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "Aktivita",
    "breakfast": "Raňajky",
    "lunch": "Obed",
    "dinner": "Večera",
    "snack": "Desiata",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Pridať burned kcal",
    "startTheDay": "Spustiť the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Pridať new položka",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Späť again within 5 seconds to exit.",
    "noActivity": "No aktivita logged for this day.",
    "noEntries": "No záznamy yet.",
    "edit": "Upraviť",
    "delete": "Vymazať",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Jednotky",
    "calculations": "Výpočty",
    "language": "Jazyk",
    "privacy": "Súkromie",
    "about": "O aplikácii",
    "licenses": "Licencie",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached položky",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Aktivita Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Systémový jazyk",
    "english": "Angličtina",
    "hungarian": "Maďarčina",
    "scan": "Skenovať",
    "languageSearch": "Hľadať podľa anglického názvu, vlastného názvu alebo kódu…",
    "translations": "Preklady",
    "noTranslations": "Zatiaľ žiadne preklady.",
    "addTranslation": "Pridať preklad",
    "cancel": "Zrušiť",
    "ok": "OK",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing záznamy on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Jedlo and aktivita záznamy for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real jedlá later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as poznámka",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Denník záznamy and aktivita logs stay lokálne on mobil.",
    "target": "target",
    "weight": "hmotnosť",
    "saveWeight": "Uložiť hmotnosť",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Upraviť hmotnosť",
    "futureDateWarning": "This date is in the future. Logging future diary údaje can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly hmotnosť check",
    "weeklyWeightCheckBody": "Aktualizovať your hmotnosť once a week. If it does not change, nutrino keeps using the latest known hodnota.",
    "save": "Uložiť",
    "addTo": "Pridať to",
    "add": "Pridať",
    "update": "Aktualizovať",
    "addActivity": "Pridať aktivitu",
    "updateActivity": "Aktualizovať aktivita",
    "customRecipe": "Customize recept",
    "customRecipeHint": "Changes are saved only for this diary záznam.",
    "customizedRecipe": "custom recept",
    "editRecipeLocally": "Upraviť recept for this záznam",
    "changeSelection": "Change jedlo/recept",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a jedlo or recept first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid hmotnosť in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Aktivita updated.",
    "activityAdded": "Aktivita added.",
    "activities": "Aktivity",
    "entries": "záznamy",
    "foodAndRecipeSearch": "Hľadať jedlá and recepty",
    "searchIn": "Hľadať in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Značka",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Popis",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Hľadať aktivity",
    "recipe": "Recept",
    "food": "Jedlo",
    "ingredient": "Surovina",
    "grams": "gramy",
    "pieces": "kusy",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app údaje",
    "exportAppDataBody": "Uložiť a full lokálne ZIP záloha.",
    "importAppData": "Import app údaje",
    "importAppDataBody": "Select a nutrino mobil app ZIP záloha.",
    "channelDataTransfer": "Dev / stable údaje transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Aktualizovať dev from stable záloha",
    "updateStableFromDev": "Aktualizovať stable from dev záloha",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app údaje with a záloha from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer export",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer import",
    "channelTransferImportProfile": "Channel transfer import",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Aktivita",
    "activityLevelHint": "Used for denne kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API nastavenia",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop server requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Heslo servera",
    "pairingToken": "Pairing token",
    "addKcalNote": "Poznámka",
    "existingItem": "Existing",
    "noteEntry": "Poznámka",
    "kcalNoteTitle": "Poznámka title",
    "kcalNoteDescription": "Popis",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local katalóg actions",
    "addLocalIngredient": "Pridať lokálne surovina",
    "addLocalFood": "Pridať lokálne jedlo",
    "addLocalRecipe": "Pridať lokálne recept",
    "addLocalActivity": "Pridať lokálne aktivita",
    "localItemCreated": "Local položka saved. Sync when the desktop server is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load údaje from server",
    "pushNow": "Send údaje to server",
    "pullFailedOffline": "Download failed. Local údaje remains available.",
    "pushFailedOffline": "Upload failed. Local údaje stays čaká until the server is reachable.",
    "dailyBackupProfile": "Daily automatic záloha profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop server is offline.",
    "serverOfflineUsingCache": "Desktop server is offline. Using lokálne cached katalóg.",
    "deleteEntryConfirm": "Vymazať this záznam?",
    "deleteActivityConfirm": "Vymazať this aktivita?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Jedlá",
    "noSyncedItems": "No synced jedlá or recepty yet. Spustiť the desktop server or add a GitHub CSV zdroj and synchronizácia.",
    "appDataExportCreated": "App údaje export created.",
    "appDataImported": "App údaje imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This záloha will overwrite all current lokálne app údaje. Continue?",
    "invalidBackupFile": "This is not a valid nutrino mobil app záloha.",
    "clearCachedConfirm": "Clear synced jedlá, recepty, aktivity and merge aliases from the mobil cache? Denník logs remain on the device. The next server download will reload a full katalóg snapshot.",
    "cachedCatalogCleared": "Cached katalóg cleared. The next server download will fully reload the katalóg.",
    "privacyBody": "nutrino stores your profile, diary, jedlo cache and aktivita údaje locally on your device. The app only talks to your paired desktop server on your network. We do not collect, sell or upload your údaje to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the zdroj kód, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source kód",
    "factoryReset": "Obnovenie nastavení",
    "factoryResetBody": "Vymazať all lokálne app údaje and restart onboarding.",
    "factoryResetConfirm": "This deletes all lokálne mobil diary, profile, cached katalóg and nastavenia údaje. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Pridať your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Profil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Domov shows calories and macros. Denník shows your calendar. Recepty lists synced katalóg položky. Profil stores your body and goal nastavenia.",
    "finishSetup": "Finish setup",
    "next": "Ďalej",
    "back": "Späť",
    "startUsingNutrino": "Spustiť using nutrino",
    "restoreBackup": "Obnoviť zálohu",
    "restore": "Obnoviť",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No lokálne záloha profiles yet.",
    "createBackupProfile": "Create záloha profile",
    "manualBackupProfile": "Manual záloha profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before import",
    "importBackupProfile": "Imported záloha",
    "beforeBackupProfileRestore": "Before záloha profile restore",
    "restoreBackupProfile": "Obnoviť lokálne profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Obnoviť this lokálne záloha profile? Current app údaje will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a lokálne záloha profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP export anyway?",
    "emptyBackupFile": "The selected záloha file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP export could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A lokálne záloha profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe mobil ZIP sharing. The unstable mobil save/download export was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV zdroje",
    "githubCsvSourcesBody": "Desktop server is voliteľné. Pridať one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Pridať repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Odstrániť",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "voliteľné path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "voliteľné GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Názov",
    "brandSource": "Značka / zdroj",
    "barcodeQr": "Barcode / QR",
    "note": "Poznámka",
    "optional": "voliteľné",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Popis",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this záznam",
    "recipeExtraKcalHelp": "Adds to or subtracts from the surovina kcal total. Macros still come from suroviny.",
    "servings": "Porcie",
    "servingsEmptyHelp": "Leave empty to make the whole recept one serving.",
    "localRecipeItemsTitle": "Suroviny / jedlá / recepty",
    "selectItem": "Select položka",
    "localRecipeSearchHint": "No long dropdown — hľadať by jedlo, surovina or recept názov.",
    "searchItem": "Hľadať položka",
    "find": "Hľadať",
    "noMatchingItem": "Žiadna zhoda.",
    "mobileRecipeSyncHint": "Mobile recept changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Kód",
    "type": "Typ",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop jedlo database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-zdroj nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Skenovať čiarový kód / QR",
    "scanNutrinoQr": "Skenovať Nutrino QR",
    "scanHelper": "If a recept has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the kód below.",
    "scanPlaceholder": "čiarový kód, QR obsah alebo Nutrino kód",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Hľadať synced katalóg",
    "scanBarcodeQrAria": "Skenovať čiarový kód or QR",
    "scanQrAria": "Skenovať QR",
    "searchAria": "Hľadať",
    "translationsHint": "Pridaj iba potrebné jazyky. Základný názov ostáva záložný.",
    "translationLanguage": "Jazyk",
    "translationValue": "Preložený názov",
    "translationAddPlaceholder": "Pridať ďalší jazyk…"
  },
  "ro": {
    "home": "Acasă",
    "diary": "Jurnal",
    "recipes": "Rețete",
    "profile": "Profil",
    "settings": "Setări",
    "synced": "Sincronizat",
    "syncing": "Sincronizare",
    "pending": "în așteptare",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "Activitate",
    "breakfast": "Mic dejun",
    "lunch": "Prânz",
    "dinner": "Cină",
    "snack": "Gustare",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Adaugă burned kcal",
    "startTheDay": "Pornește the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Adaugă new element",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Înapoi again within 5 seconds to exit.",
    "noActivity": "No activitate logged for this day.",
    "noEntries": "No înregistrări yet.",
    "edit": "Editează",
    "delete": "Șterge",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Unități",
    "calculations": "Calcule",
    "language": "Limbă",
    "privacy": "Confidențialitate",
    "about": "Despre",
    "licenses": "Licențe",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached elemente",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Activitate Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Implicit sistem",
    "english": "Engleză",
    "hungarian": "Maghiară",
    "scan": "Scanează",
    "languageSearch": "Caută după nume englezesc, nume nativ sau cod…",
    "translations": "Traduceri",
    "noTranslations": "Nu există traduceri încă.",
    "addTranslation": "Adaugă traducere",
    "cancel": "Anulează",
    "ok": "OK",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing înregistrări on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Aliment and activitate înregistrări for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real alimente later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as notă",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Jurnal înregistrări and activitate logs stay local on mobil.",
    "target": "target",
    "weight": "greutate",
    "saveWeight": "Salvează greutate",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Editează greutate",
    "futureDateWarning": "This date is in the future. Logging future diary date can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly greutate check",
    "weeklyWeightCheckBody": "Actualizează your greutate once a week. If it does not change, nutrino keeps using the latest known valoare.",
    "save": "Salvează",
    "addTo": "Adaugă to",
    "add": "Adaugă",
    "update": "Actualizează",
    "addActivity": "Adaugă activitate",
    "updateActivity": "Actualizează activitate",
    "customRecipe": "Customize rețetă",
    "customRecipeHint": "Changes are saved only for this diary înregistrare.",
    "customizedRecipe": "custom rețetă",
    "editRecipeLocally": "Editează rețetă for this înregistrare",
    "changeSelection": "Change aliment/rețetă",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a aliment or rețetă first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid greutate in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Activitate updated.",
    "activityAdded": "Activitate added.",
    "activities": "Activități",
    "entries": "înregistrări",
    "foodAndRecipeSearch": "Caută alimente and rețete",
    "searchIn": "Caută in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Marcă",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Descriere",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Caută activități",
    "recipe": "Rețetă",
    "food": "Aliment",
    "ingredient": "Ingredient",
    "grams": "grame",
    "pieces": "bucăți",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app date",
    "exportAppDataBody": "Salvează a full local ZIP backup.",
    "importAppData": "Import app date",
    "importAppDataBody": "Select a nutrino mobil app ZIP backup.",
    "channelDataTransfer": "Dev / stable date transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Actualizează dev from stable backup",
    "updateStableFromDev": "Actualizează stable from dev backup",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app date with a backup from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer export",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer import",
    "channelTransferImportProfile": "Channel transfer import",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Activitate",
    "activityLevelHint": "Used for zilnic kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API setări",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop server requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Parolă server",
    "pairingToken": "Pairing token",
    "addKcalNote": "Notă",
    "existingItem": "Existing",
    "noteEntry": "Notă",
    "kcalNoteTitle": "Notă title",
    "kcalNoteDescription": "Descriere",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local catalog actions",
    "addLocalIngredient": "Adaugă local ingredient",
    "addLocalFood": "Adaugă local aliment",
    "addLocalRecipe": "Adaugă local rețetă",
    "addLocalActivity": "Adaugă local activitate",
    "localItemCreated": "Local element saved. Sync when the desktop server is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load date from server",
    "pushNow": "Send date to server",
    "pullFailedOffline": "Download failed. Local date remains available.",
    "pushFailedOffline": "Upload failed. Local date stays în așteptare until the server is reachable.",
    "dailyBackupProfile": "Daily automatic backup profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop server is offline.",
    "serverOfflineUsingCache": "Desktop server is offline. Using local cached catalog.",
    "deleteEntryConfirm": "Șterge this înregistrare?",
    "deleteActivityConfirm": "Șterge this activitate?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Alimente",
    "noSyncedItems": "No synced alimente or rețete yet. Pornește the desktop server or add a GitHub CSV sursă and sincronizare.",
    "appDataExportCreated": "App date export created.",
    "appDataImported": "App date imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This backup will overwrite all current local app date. Continue?",
    "invalidBackupFile": "This is not a valid nutrino mobil app backup.",
    "clearCachedConfirm": "Clear synced alimente, rețete, activități and merge aliases from the mobil cache? Jurnal logs remain on the device. The next server download will reload a full catalog snapshot.",
    "cachedCatalogCleared": "Cached catalog cleared. The next server download will fully reload the catalog.",
    "privacyBody": "nutrino stores your profile, diary, aliment cache and activitate date locally on your device. The app only talks to your paired desktop server on your network. We do not collect, sell or upload your date to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the sursă cod, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source cod",
    "factoryReset": "Resetare completă",
    "factoryResetBody": "Șterge all local app date and restart onboarding.",
    "factoryResetConfirm": "This deletes all local mobil diary, profile, cached catalog and setări date. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Adaugă your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Profil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Acasă shows calories and macros. Jurnal shows your calendar. Rețete lists synced catalog elemente. Profil stores your body and goal setări.",
    "finishSetup": "Finish setup",
    "next": "Înainte",
    "back": "Înapoi",
    "startUsingNutrino": "Pornește using nutrino",
    "restoreBackup": "Restaurează backup",
    "restore": "Restaurează",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No local backup profiles yet.",
    "createBackupProfile": "Create backup profile",
    "manualBackupProfile": "Manual backup profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before import",
    "importBackupProfile": "Imported backup",
    "beforeBackupProfileRestore": "Before backup profile restore",
    "restoreBackupProfile": "Restaurează local profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Restaurează this local backup profile? Current app date will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a local backup profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP export anyway?",
    "emptyBackupFile": "The selected backup file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP export could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A local backup profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe mobil ZIP sharing. The unstable mobil save/download export was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV surse",
    "githubCsvSourcesBody": "Desktop server is opțional. Adaugă one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Adaugă repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Elimină",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "opțional path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "opțional GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Nume",
    "brandSource": "Marcă / sursă",
    "barcodeQr": "Barcode / QR",
    "note": "Notă",
    "optional": "opțional",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Descriere",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this înregistrare",
    "recipeExtraKcalHelp": "Adds to or subtracts from the ingredient kcal total. Macros still come from ingrediente.",
    "servings": "Porții",
    "servingsEmptyHelp": "Leave empty to make the whole rețetă one serving.",
    "localRecipeItemsTitle": "Ingrediente / alimente / rețete",
    "selectItem": "Select element",
    "localRecipeSearchHint": "No long dropdown — caută by aliment, ingredient or rețetă nume.",
    "searchItem": "Caută element",
    "find": "Caută",
    "noMatchingItem": "Niciun rezultat.",
    "mobileRecipeSyncHint": "Mobile rețetă changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Cod",
    "type": "Tip",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop aliment database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-sursă nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Scanează cod de bare / QR",
    "scanNutrinoQr": "Scanează QR Nutrino",
    "scanHelper": "If a rețetă has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the cod below.",
    "scanPlaceholder": "cod de bare, conținut QR sau cod Nutrino",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Caută synced catalog",
    "scanBarcodeQrAria": "Scanează cod de bare or QR",
    "scanQrAria": "Scanează QR",
    "searchAria": "Caută",
    "translationsHint": "Adaugă doar limbile necesare. Numele de bază rămâne fallback.",
    "translationLanguage": "Limbă",
    "translationValue": "Nume tradus",
    "translationAddPlaceholder": "Adaugă o limbă…"
  },
  "cs": {
    "home": "Domů",
    "diary": "Deník",
    "recipes": "Recepty",
    "profile": "Profil",
    "settings": "Nastavení",
    "synced": "Synchronizováno",
    "syncing": "Synchronizace",
    "pending": "čeká",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "Aktivita",
    "breakfast": "Snídaně",
    "lunch": "Oběd",
    "dinner": "Večeře",
    "snack": "Svačina",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Přidat burned kcal",
    "startTheDay": "Spustit the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Přidat new položka",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Zpět again within 5 seconds to exit.",
    "noActivity": "No aktivita logged for this day.",
    "noEntries": "No záznamy yet.",
    "edit": "Upravit",
    "delete": "Smazat",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Jednotky",
    "calculations": "Výpočty",
    "language": "Jazyk",
    "privacy": "Soukromí",
    "about": "O aplikaci",
    "licenses": "Licence",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached položky",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Aktivita Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Systémový jazyk",
    "english": "Angličtina",
    "hungarian": "Maďarština",
    "scan": "Skenovat",
    "languageSearch": "Hledat podle anglického názvu, vlastního názvu nebo kódu…",
    "translations": "Překlady",
    "noTranslations": "Zatím žádné překlady.",
    "addTranslation": "Přidat překlad",
    "cancel": "Zrušit",
    "ok": "OK",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing záznamy on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Jídlo and aktivita záznamy for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real jídla later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as poznámka",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Deník záznamy and aktivita logs stay místní on mobil.",
    "target": "target",
    "weight": "hmotnost",
    "saveWeight": "Uložit hmotnost",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Upravit hmotnost",
    "futureDateWarning": "This date is in the future. Logging future diary data can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly hmotnost check",
    "weeklyWeightCheckBody": "Aktualizovat your hmotnost once a week. If it does not change, nutrino keeps using the latest known hodnota.",
    "save": "Uložit",
    "addTo": "Přidat to",
    "add": "Přidat",
    "update": "Aktualizovat",
    "addActivity": "Přidat aktivitu",
    "updateActivity": "Aktualizovat aktivita",
    "customRecipe": "Customize recept",
    "customRecipeHint": "Changes are saved only for this diary záznam.",
    "customizedRecipe": "custom recept",
    "editRecipeLocally": "Upravit recept for this záznam",
    "changeSelection": "Change jídlo/recept",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a jídlo or recept first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid hmotnost in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Aktivita updated.",
    "activityAdded": "Aktivita added.",
    "activities": "Aktivity",
    "entries": "záznamy",
    "foodAndRecipeSearch": "Hledat jídla and recepty",
    "searchIn": "Hledat in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Značka",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Popis",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Hledat aktivity",
    "recipe": "Recept",
    "food": "Jídlo",
    "ingredient": "Surovina",
    "grams": "gramy",
    "pieces": "kusy",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app data",
    "exportAppDataBody": "Uložit a full místní ZIP záloha.",
    "importAppData": "Import app data",
    "importAppDataBody": "Select a nutrino mobil app ZIP záloha.",
    "channelDataTransfer": "Dev / stable data transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Aktualizovat dev from stable záloha",
    "updateStableFromDev": "Aktualizovat stable from dev záloha",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app data with a záloha from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer export",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer import",
    "channelTransferImportProfile": "Channel transfer import",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Aktivita",
    "activityLevelHint": "Used for denně kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API nastavení",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop server requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Heslo serveru",
    "pairingToken": "Pairing token",
    "addKcalNote": "Poznámka",
    "existingItem": "Existing",
    "noteEntry": "Poznámka",
    "kcalNoteTitle": "Poznámka title",
    "kcalNoteDescription": "Popis",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local katalog actions",
    "addLocalIngredient": "Přidat místní surovina",
    "addLocalFood": "Přidat místní jídlo",
    "addLocalRecipe": "Přidat místní recept",
    "addLocalActivity": "Přidat místní aktivita",
    "localItemCreated": "Local položka saved. Sync when the desktop server is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load data from server",
    "pushNow": "Send data to server",
    "pullFailedOffline": "Download failed. Local data remains available.",
    "pushFailedOffline": "Upload failed. Local data stays čeká until the server is reachable.",
    "dailyBackupProfile": "Daily automatic záloha profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop server is offline.",
    "serverOfflineUsingCache": "Desktop server is offline. Using místní cached katalog.",
    "deleteEntryConfirm": "Smazat this záznam?",
    "deleteActivityConfirm": "Smazat this aktivita?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Jídla",
    "noSyncedItems": "No synced jídla or recepty yet. Spustit the desktop server or add a GitHub CSV zdroj and synchronizace.",
    "appDataExportCreated": "App data export created.",
    "appDataImported": "App data imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This záloha will overwrite all current místní app data. Continue?",
    "invalidBackupFile": "This is not a valid nutrino mobil app záloha.",
    "clearCachedConfirm": "Clear synced jídla, recepty, aktivity and merge aliases from the mobil cache? Deník logs remain on the device. The next server download will reload a full katalog snapshot.",
    "cachedCatalogCleared": "Cached katalog cleared. The next server download will fully reload the katalog.",
    "privacyBody": "nutrino stores your profile, diary, jídlo cache and aktivita data locally on your device. The app only talks to your paired desktop server on your network. We do not collect, sell or upload your data to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the zdroj kód, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source kód",
    "factoryReset": "Obnovení továrního nastavení",
    "factoryResetBody": "Smazat all místní app data and restart onboarding.",
    "factoryResetConfirm": "This deletes all místní mobil diary, profile, cached katalog and nastavení data. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Přidat your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Profil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Domů shows calories and macros. Deník shows your calendar. Recepty lists synced katalog položky. Profil stores your body and goal nastavení.",
    "finishSetup": "Finish setup",
    "next": "Další",
    "back": "Zpět",
    "startUsingNutrino": "Spustit using nutrino",
    "restoreBackup": "Obnovit zálohu",
    "restore": "Obnovit",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No místní záloha profiles yet.",
    "createBackupProfile": "Create záloha profile",
    "manualBackupProfile": "Manual záloha profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before import",
    "importBackupProfile": "Imported záloha",
    "beforeBackupProfileRestore": "Before záloha profile restore",
    "restoreBackupProfile": "Obnovit místní profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Obnovit this místní záloha profile? Current app data will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a místní záloha profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP export anyway?",
    "emptyBackupFile": "The selected záloha file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP export could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A místní záloha profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe mobil ZIP sharing. The unstable mobil save/download export was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV zdroje",
    "githubCsvSourcesBody": "Desktop server is volitelné. Přidat one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Přidat repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Odebrat",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "volitelné path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "volitelné GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Název",
    "brandSource": "Značka / zdroj",
    "barcodeQr": "Barcode / QR",
    "note": "Poznámka",
    "optional": "volitelné",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Popis",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this záznam",
    "recipeExtraKcalHelp": "Adds to or subtracts from the surovina kcal total. Macros still come from suroviny.",
    "servings": "Porce",
    "servingsEmptyHelp": "Leave empty to make the whole recept one serving.",
    "localRecipeItemsTitle": "Suroviny / jídla / recepty",
    "selectItem": "Select položka",
    "localRecipeSearchHint": "No long dropdown — hledat by jídlo, surovina or recept název.",
    "searchItem": "Hledat položka",
    "find": "Hledat",
    "noMatchingItem": "Žádná shoda.",
    "mobileRecipeSyncHint": "Mobile recept changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Kód",
    "type": "Typ",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop jídlo database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-zdroj nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Skenovat čárový kód / QR",
    "scanNutrinoQr": "Skenovat Nutrino QR",
    "scanHelper": "If a recept has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the kód below.",
    "scanPlaceholder": "čárový kód, QR obsah nebo Nutrino kód",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Hledat synced katalog",
    "scanBarcodeQrAria": "Skenovat čárový kód or QR",
    "scanQrAria": "Skenovat QR",
    "searchAria": "Hledat",
    "translationsHint": "Přidej jen potřebné jazyky. Základní název zůstává záložní.",
    "translationLanguage": "Jazyk",
    "translationValue": "Přeložený název",
    "translationAddPlaceholder": "Přidat další jazyk…"
  },
  "sl": {
    "home": "Domov",
    "diary": "Dnevnik",
    "recipes": "Recepti",
    "profile": "Profil",
    "settings": "Nastavitve",
    "synced": "Sinhronizirano",
    "syncing": "Sinhronizacija",
    "pending": "v čakanju",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "Aktivnost",
    "breakfast": "Zajtrk",
    "lunch": "Kosilo",
    "dinner": "Večerja",
    "snack": "Prigrizek",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Dodaj burned kcal",
    "startTheDay": "Zaženi the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Dodaj new element",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Nazaj again within 5 seconds to exit.",
    "noActivity": "No aktivnost logged for this day.",
    "noEntries": "No vnosi yet.",
    "edit": "Uredi",
    "delete": "Izbriši",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Enote",
    "calculations": "Izračuni",
    "language": "Jezik",
    "privacy": "Zasebnost",
    "about": "O aplikaciji",
    "licenses": "Licence",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached elementi",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Aktivnost Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Sistemsko privzeto",
    "english": "Angleščina",
    "hungarian": "Madžarščina",
    "scan": "Skeniraj",
    "languageSearch": "Išči po angleškem imenu, domačem imenu ali kodi…",
    "translations": "Prevodi",
    "noTranslations": "Prevodi še niso dodani.",
    "addTranslation": "Dodaj prevod",
    "cancel": "Prekliči",
    "ok": "OK",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing vnosi on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Živilo and aktivnost vnosi for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real živila later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as opomba",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Dnevnik vnosi and aktivnost logs stay lokalno on mobilno.",
    "target": "target",
    "weight": "teža",
    "saveWeight": "Shrani teža",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Uredi teža",
    "futureDateWarning": "This date is in the future. Logging future diary podatki can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly teža check",
    "weeklyWeightCheckBody": "Posodobi your teža once a week. If it does not change, nutrino keeps using the latest known vrednost.",
    "save": "Shrani",
    "addTo": "Dodaj to",
    "add": "Dodaj",
    "update": "Posodobi",
    "addActivity": "Dodaj aktivnost",
    "updateActivity": "Posodobi aktivnost",
    "customRecipe": "Customize recept",
    "customRecipeHint": "Changes are saved only for this diary vnos.",
    "customizedRecipe": "custom recept",
    "editRecipeLocally": "Uredi recept for this vnos",
    "changeSelection": "Change živilo/recept",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a živilo or recept first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid teža in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Aktivnost updated.",
    "activityAdded": "Aktivnost added.",
    "activities": "Aktivnosti",
    "entries": "vnosi",
    "foodAndRecipeSearch": "Išči živila and recepti",
    "searchIn": "Išči in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Znamka",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Opis",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Išči aktivnosti",
    "recipe": "Recept",
    "food": "Živilo",
    "ingredient": "Sestavina",
    "grams": "grami",
    "pieces": "kosi",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app podatki",
    "exportAppDataBody": "Shrani a full lokalno ZIP varnostna kopija.",
    "importAppData": "Import app podatki",
    "importAppDataBody": "Select a nutrino mobilno app ZIP varnostna kopija.",
    "channelDataTransfer": "Dev / stable podatki transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Posodobi dev from stable varnostna kopija",
    "updateStableFromDev": "Posodobi stable from dev varnostna kopija",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app podatki with a varnostna kopija from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer izvoz",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer uvoz",
    "channelTransferImportProfile": "Channel transfer uvoz",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Aktivnost",
    "activityLevelHint": "Used for dnevno kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API nastavitve",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop strežnik requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Geslo strežnika",
    "pairingToken": "Pairing token",
    "addKcalNote": "Opomba",
    "existingItem": "Existing",
    "noteEntry": "Opomba",
    "kcalNoteTitle": "Opomba title",
    "kcalNoteDescription": "Opis",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local katalog actions",
    "addLocalIngredient": "Dodaj lokalno sestavina",
    "addLocalFood": "Dodaj lokalno živilo",
    "addLocalRecipe": "Dodaj lokalno recept",
    "addLocalActivity": "Dodaj lokalno aktivnost",
    "localItemCreated": "Local element saved. Sync when the desktop strežnik is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load podatki from strežnik",
    "pushNow": "Send podatki to strežnik",
    "pullFailedOffline": "Download failed. Local podatki remains available.",
    "pushFailedOffline": "Upload failed. Local podatki stays v čakanju until the strežnik is reachable.",
    "dailyBackupProfile": "Daily automatic varnostna kopija profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop strežnik is offline.",
    "serverOfflineUsingCache": "Desktop strežnik is offline. Using lokalno cached katalog.",
    "deleteEntryConfirm": "Izbriši this vnos?",
    "deleteActivityConfirm": "Izbriši this aktivnost?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Živila",
    "noSyncedItems": "No synced živila or recepti yet. Zaženi the desktop strežnik or add a GitHub CSV vir and sinhronizacija.",
    "appDataExportCreated": "App podatki izvoz created.",
    "appDataImported": "App podatki imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This varnostna kopija will overwrite all current lokalno app podatki. Continue?",
    "invalidBackupFile": "This is not a valid nutrino mobilno app varnostna kopija.",
    "clearCachedConfirm": "Clear synced živila, recepti, aktivnosti and merge aliases from the mobilno cache? Dnevnik logs remain on the device. The next strežnik download will reload a full katalog snapshot.",
    "cachedCatalogCleared": "Cached katalog cleared. The next strežnik download will fully reload the katalog.",
    "privacyBody": "nutrino stores your profile, diary, živilo cache and aktivnost podatki locally on your device. The app only talks to your paired desktop strežnik on your network. We do not collect, sell or upload your podatki to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the vir koda, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source koda",
    "factoryReset": "Ponastavitev",
    "factoryResetBody": "Izbriši all lokalno app podatki and restart onboarding.",
    "factoryResetConfirm": "This deletes all lokalno mobilno diary, profile, cached katalog and nastavitve podatki. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Dodaj your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Profil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Domov shows calories and macros. Dnevnik shows your calendar. Recepti lists synced katalog elementi. Profil stores your body and goal nastavitve.",
    "finishSetup": "Finish setup",
    "next": "Naprej",
    "back": "Nazaj",
    "startUsingNutrino": "Zaženi using nutrino",
    "restoreBackup": "Obnovi varnostno kopijo",
    "restore": "Obnovi",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No lokalno varnostna kopija profiles yet.",
    "createBackupProfile": "Create varnostna kopija profile",
    "manualBackupProfile": "Manual varnostna kopija profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before uvoz",
    "importBackupProfile": "Imported varnostna kopija",
    "beforeBackupProfileRestore": "Before varnostna kopija profile restore",
    "restoreBackupProfile": "Obnovi lokalno profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Obnovi this lokalno varnostna kopija profile? Current app podatki will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a lokalno varnostna kopija profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP izvoz anyway?",
    "emptyBackupFile": "The selected varnostna kopija file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP izvoz could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A lokalno varnostna kopija profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe mobilno ZIP sharing. The unstable mobilno save/download izvoz was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV viri",
    "githubCsvSourcesBody": "Desktop strežnik is neobvezno. Dodaj one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Dodaj repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Odstrani",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "neobvezno path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "neobvezno GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Ime",
    "brandSource": "Znamka / vir",
    "barcodeQr": "Barcode / QR",
    "note": "Opomba",
    "optional": "neobvezno",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Opis",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this vnos",
    "recipeExtraKcalHelp": "Adds to or subtracts from the sestavina kcal total. Macros still come from sestavine.",
    "servings": "Porcije",
    "servingsEmptyHelp": "Leave empty to make the whole recept one serving.",
    "localRecipeItemsTitle": "Sestavine / živila / recepti",
    "selectItem": "Select element",
    "localRecipeSearchHint": "No long dropdown — išči by živilo, sestavina or recept ime.",
    "searchItem": "Išči element",
    "find": "Najdi",
    "noMatchingItem": "Ni ujemanja.",
    "mobileRecipeSyncHint": "Mobile recept changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Koda",
    "type": "Tip",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop živilo database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-vir nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Skeniraj črtno kodo / QR",
    "scanNutrinoQr": "Skeniraj Nutrino QR",
    "scanHelper": "If a recept has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the koda below.",
    "scanPlaceholder": "črtna koda, QR vsebina ali Nutrino koda",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Išči synced katalog",
    "scanBarcodeQrAria": "Skeniraj črtna koda or QR",
    "scanQrAria": "Skeniraj QR",
    "searchAria": "Išči",
    "translationsHint": "Dodaj samo potrebne jezike. Osnovno ime ostane rezervna vrednost.",
    "translationLanguage": "Jezik",
    "translationValue": "Prevedeno ime",
    "translationAddPlaceholder": "Dodaj jezik…"
  },
  "hr": {
    "home": "Početna",
    "diary": "Dnevnik",
    "recipes": "Recepti",
    "profile": "Profil",
    "settings": "Postavke",
    "synced": "Sinkronizirano",
    "syncing": "Sinkronizacija",
    "pending": "na čekanju",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "Aktivnost",
    "breakfast": "Doručak",
    "lunch": "Ručak",
    "dinner": "Večera",
    "snack": "Užina",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Dodaj burned kcal",
    "startTheDay": "Pokreni the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Dodaj new stavka",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Natrag again within 5 seconds to exit.",
    "noActivity": "No aktivnost logged for this day.",
    "noEntries": "No unosi yet.",
    "edit": "Uredi",
    "delete": "Izbriši",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Jedinice",
    "calculations": "Izračuni",
    "language": "Jezik",
    "privacy": "Privatnost",
    "about": "O aplikaciji",
    "licenses": "Licence",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached stavke",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Aktivnost Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Zadano sustavom",
    "english": "Engleski",
    "hungarian": "Mađarski",
    "scan": "Skeniraj",
    "languageSearch": "Traži po engleskom nazivu, izvornom nazivu ili kodu…",
    "translations": "Prijevodi",
    "noTranslations": "Još nema prijevoda.",
    "addTranslation": "Dodaj prijevod",
    "cancel": "Odustani",
    "ok": "OK",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing unosi on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Hrana and aktivnost unosi for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real hrana later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as bilješka",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Dnevnik unosi and aktivnost logs stay lokalno on mobilno.",
    "target": "target",
    "weight": "težina",
    "saveWeight": "Spremi težina",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Uredi težina",
    "futureDateWarning": "This date is in the future. Logging future diary podaci can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly težina check",
    "weeklyWeightCheckBody": "Ažuriraj your težina once a week. If it does not change, nutrino keeps using the latest known vrijednost.",
    "save": "Spremi",
    "addTo": "Dodaj to",
    "add": "Dodaj",
    "update": "Ažuriraj",
    "addActivity": "Dodaj aktivnost",
    "updateActivity": "Ažuriraj aktivnost",
    "customRecipe": "Customize recept",
    "customRecipeHint": "Changes are saved only for this diary unos.",
    "customizedRecipe": "custom recept",
    "editRecipeLocally": "Uredi recept for this unos",
    "changeSelection": "Change hrana/recept",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a hrana or recept first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid težina in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Aktivnost updated.",
    "activityAdded": "Aktivnost added.",
    "activities": "Aktivnosti",
    "entries": "unosi",
    "foodAndRecipeSearch": "Traži hrana and recepti",
    "searchIn": "Traži in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Brend",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Opis",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Traži aktivnosti",
    "recipe": "Recept",
    "food": "Hrana",
    "ingredient": "Sastojak",
    "grams": "grami",
    "pieces": "komadi",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app podaci",
    "exportAppDataBody": "Spremi a full lokalno ZIP backup.",
    "importAppData": "Import app podaci",
    "importAppDataBody": "Select a nutrino mobilno app ZIP backup.",
    "channelDataTransfer": "Dev / stable podaci transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Ažuriraj dev from stable backup",
    "updateStableFromDev": "Ažuriraj stable from dev backup",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app podaci with a backup from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer izvoz",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer uvoz",
    "channelTransferImportProfile": "Channel transfer uvoz",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Aktivnost",
    "activityLevelHint": "Used for dnevno kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API postavke",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop server requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Lozinka servera",
    "pairingToken": "Pairing token",
    "addKcalNote": "Bilješka",
    "existingItem": "Existing",
    "noteEntry": "Bilješka",
    "kcalNoteTitle": "Bilješka title",
    "kcalNoteDescription": "Opis",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local katalog actions",
    "addLocalIngredient": "Dodaj lokalno sastojak",
    "addLocalFood": "Dodaj lokalno hrana",
    "addLocalRecipe": "Dodaj lokalno recept",
    "addLocalActivity": "Dodaj lokalno aktivnost",
    "localItemCreated": "Local stavka saved. Sync when the desktop server is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load podaci from server",
    "pushNow": "Send podaci to server",
    "pullFailedOffline": "Download failed. Local podaci remains available.",
    "pushFailedOffline": "Upload failed. Local podaci stays na čekanju until the server is reachable.",
    "dailyBackupProfile": "Daily automatic backup profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop server is offline.",
    "serverOfflineUsingCache": "Desktop server is offline. Using lokalno cached katalog.",
    "deleteEntryConfirm": "Izbriši this unos?",
    "deleteActivityConfirm": "Izbriši this aktivnost?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Hrana",
    "noSyncedItems": "No synced hrana or recepti yet. Pokreni the desktop server or add a GitHub CSV izvor and sinkronizacija.",
    "appDataExportCreated": "App podaci izvoz created.",
    "appDataImported": "App podaci imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This backup will overwrite all current lokalno app podaci. Continue?",
    "invalidBackupFile": "This is not a valid nutrino mobilno app backup.",
    "clearCachedConfirm": "Clear synced hrana, recepti, aktivnosti and merge aliases from the mobilno cache? Dnevnik logs remain on the device. The next server download will reload a full katalog snapshot.",
    "cachedCatalogCleared": "Cached katalog cleared. The next server download will fully reload the katalog.",
    "privacyBody": "nutrino stores your profile, diary, hrana cache and aktivnost podaci locally on your device. The app only talks to your paired desktop server on your network. We do not collect, sell or upload your podaci to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the izvor kod, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source kod",
    "factoryReset": "Vraćanje na tvorničke postavke",
    "factoryResetBody": "Izbriši all lokalno app podaci and restart onboarding.",
    "factoryResetConfirm": "This deletes all lokalno mobilno diary, profile, cached katalog and postavke podaci. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Dodaj your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Profil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Početna shows calories and macros. Dnevnik shows your calendar. Recepti lists synced katalog stavke. Profil stores your body and goal postavke.",
    "finishSetup": "Finish setup",
    "next": "Dalje",
    "back": "Natrag",
    "startUsingNutrino": "Pokreni using nutrino",
    "restoreBackup": "Vrati backup",
    "restore": "Vrati",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No lokalno backup profiles yet.",
    "createBackupProfile": "Create backup profile",
    "manualBackupProfile": "Manual backup profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before uvoz",
    "importBackupProfile": "Imported backup",
    "beforeBackupProfileRestore": "Before backup profile restore",
    "restoreBackupProfile": "Vrati lokalno profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Vrati this lokalno backup profile? Current app podaci will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a lokalno backup profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP izvoz anyway?",
    "emptyBackupFile": "The selected backup file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP izvoz could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A lokalno backup profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe mobilno ZIP sharing. The unstable mobilno save/download izvoz was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV izvori",
    "githubCsvSourcesBody": "Desktop server is neobavezno. Dodaj one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Dodaj repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Ukloni",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "neobavezno path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "neobavezno GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Naziv",
    "brandSource": "Brend / izvor",
    "barcodeQr": "Barcode / QR",
    "note": "Bilješka",
    "optional": "opcionalno",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Opis",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this unos",
    "recipeExtraKcalHelp": "Adds to or subtracts from the sastojak kcal total. Macros still come from sastojci.",
    "servings": "Porcije",
    "servingsEmptyHelp": "Leave empty to make the whole recept one serving.",
    "localRecipeItemsTitle": "Sastojci / hrana / recepti",
    "selectItem": "Select stavka",
    "localRecipeSearchHint": "No long dropdown — traži by hrana, sastojak or recept naziv.",
    "searchItem": "Traži stavka",
    "find": "Pronađi",
    "noMatchingItem": "Nema podudaranja.",
    "mobileRecipeSyncHint": "Mobile recept changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Kod",
    "type": "Tip",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop hrana database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-izvor nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Skeniraj barkod / QR",
    "scanNutrinoQr": "Skeniraj Nutrino QR",
    "scanHelper": "If a recept has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the kod below.",
    "scanPlaceholder": "barkod, QR sadržaj ili Nutrino kod",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Traži synced katalog",
    "scanBarcodeQrAria": "Skeniraj crtični kod or QR",
    "scanQrAria": "Skeniraj QR",
    "searchAria": "Traži",
    "translationsHint": "Dodaj samo potrebne jezike. Osnovni naziv ostaje rezervna vrijednost.",
    "translationLanguage": "Jezik",
    "translationValue": "Prevedeni naziv",
    "translationAddPlaceholder": "Dodaj jezik…"
  },
  "pl": {
    "home": "Start",
    "diary": "Dziennik",
    "recipes": "Przepisy",
    "profile": "Profil",
    "settings": "Ustawienia",
    "synced": "Zsynchronizowano",
    "syncing": "Synchronizacja",
    "pending": "oczekuje",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "Aktywność",
    "breakfast": "Śniadanie",
    "lunch": "Obiad",
    "dinner": "Kolacja",
    "snack": "Przekąska",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Dodaj burned kcal",
    "startTheDay": "Start the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Dodaj new pozycja",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Wstecz again within 5 seconds to exit.",
    "noActivity": "No aktywność logged for this day.",
    "noEntries": "No wpisy yet.",
    "edit": "Edytuj",
    "delete": "Usuń",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Jednostki",
    "calculations": "Obliczenia",
    "language": "Język",
    "privacy": "Prywatność",
    "about": "O aplikacji",
    "licenses": "Licencje",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached pozycje",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Aktywność Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Domyślny systemu",
    "english": "Angielski",
    "hungarian": "Węgierski",
    "scan": "Skanuj",
    "languageSearch": "Szukaj po nazwie angielskiej, własnej lub kodzie…",
    "translations": "Tłumaczenia",
    "noTranslations": "Nie dodano jeszcze tłumaczeń.",
    "addTranslation": "Dodaj tłumaczenie",
    "cancel": "Anuluj",
    "ok": "OK",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing wpisy on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Produkt and aktywność wpisy for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real produkty later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as notatka",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Dziennik wpisy and aktywność logs stay lokalne on mobilne.",
    "target": "target",
    "weight": "waga",
    "saveWeight": "Zapisz waga",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Edytuj waga",
    "futureDateWarning": "This date is in the future. Logging future diary dane can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly waga check",
    "weeklyWeightCheckBody": "Aktualizuj your waga once a week. If it does not change, nutrino keeps using the latest known wartość.",
    "save": "Zapisz",
    "addTo": "Dodaj to",
    "add": "Dodaj",
    "update": "Aktualizuj",
    "addActivity": "Dodaj aktywność",
    "updateActivity": "Aktualizuj aktywność",
    "customRecipe": "Customize przepis",
    "customRecipeHint": "Changes are saved only for this diary wpis.",
    "customizedRecipe": "custom przepis",
    "editRecipeLocally": "Edytuj przepis for this wpis",
    "changeSelection": "Change produkt/przepis",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a produkt or przepis first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid waga in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Aktywność updated.",
    "activityAdded": "Aktywność added.",
    "activities": "Aktywności",
    "entries": "wpisy",
    "foodAndRecipeSearch": "Szukaj produkty and przepisy",
    "searchIn": "Szukaj in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Marka",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Opis",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Szukaj aktywności",
    "recipe": "Przepis",
    "food": "Produkt",
    "ingredient": "Składnik",
    "grams": "gramy",
    "pieces": "sztuki",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app dane",
    "exportAppDataBody": "Zapisz a full lokalne ZIP kopia zapasowa.",
    "importAppData": "Import app dane",
    "importAppDataBody": "Select a nutrino mobilne app ZIP kopia zapasowa.",
    "channelDataTransfer": "Dev / stable dane transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Aktualizuj dev from stable kopia zapasowa",
    "updateStableFromDev": "Aktualizuj stable from dev kopia zapasowa",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app dane with a kopia zapasowa from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer eksport",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer import",
    "channelTransferImportProfile": "Channel transfer import",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Aktywność",
    "activityLevelHint": "Used for codziennie kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API ustawienia",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop serwer requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Hasło serwera",
    "pairingToken": "Pairing token",
    "addKcalNote": "Notatka",
    "existingItem": "Existing",
    "noteEntry": "Notatka",
    "kcalNoteTitle": "Notatka title",
    "kcalNoteDescription": "Opis",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local katalog actions",
    "addLocalIngredient": "Dodaj lokalne składnik",
    "addLocalFood": "Dodaj lokalne produkt",
    "addLocalRecipe": "Dodaj lokalne przepis",
    "addLocalActivity": "Dodaj lokalne aktywność",
    "localItemCreated": "Local pozycja saved. Sync when the desktop serwer is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load dane from serwer",
    "pushNow": "Send dane to serwer",
    "pullFailedOffline": "Download failed. Local dane remains available.",
    "pushFailedOffline": "Upload failed. Local dane stays oczekuje until the serwer is reachable.",
    "dailyBackupProfile": "Daily automatic kopia zapasowa profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop serwer is offline.",
    "serverOfflineUsingCache": "Desktop serwer is offline. Using lokalne cached katalog.",
    "deleteEntryConfirm": "Usuń this wpis?",
    "deleteActivityConfirm": "Usuń this aktywność?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Produkty",
    "noSyncedItems": "No synced produkty or przepisy yet. Start the desktop serwer or add a GitHub CSV źródło and synchronizacja.",
    "appDataExportCreated": "App dane eksport created.",
    "appDataImported": "App dane imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This kopia zapasowa will overwrite all current lokalne app dane. Continue?",
    "invalidBackupFile": "This is not a valid nutrino mobilne app kopia zapasowa.",
    "clearCachedConfirm": "Clear synced produkty, przepisy, aktywności and merge aliases from the mobilne cache? Dziennik logs remain on the device. The next serwer download will reload a full katalog snapshot.",
    "cachedCatalogCleared": "Cached katalog cleared. The next serwer download will fully reload the katalog.",
    "privacyBody": "nutrino stores your profile, diary, produkt cache and aktywność dane locally on your device. The app only talks to your paired desktop serwer on your network. We do not collect, sell or upload your dane to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the źródło kod, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source kod",
    "factoryReset": "Reset fabryczny",
    "factoryResetBody": "Usuń all lokalne app dane and restart onboarding.",
    "factoryResetConfirm": "This deletes all lokalne mobilne diary, profile, cached katalog and ustawienia dane. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Dodaj your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Profil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Start shows calories and macros. Dziennik shows your calendar. Przepisy lists synced katalog pozycje. Profil stores your body and goal ustawienia.",
    "finishSetup": "Finish setup",
    "next": "Dalej",
    "back": "Wstecz",
    "startUsingNutrino": "Start using nutrino",
    "restoreBackup": "Przywróć kopię",
    "restore": "Przywróć",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No lokalne kopia zapasowa profiles yet.",
    "createBackupProfile": "Create kopia zapasowa profile",
    "manualBackupProfile": "Manual kopia zapasowa profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before import",
    "importBackupProfile": "Imported kopia zapasowa",
    "beforeBackupProfileRestore": "Before kopia zapasowa profile restore",
    "restoreBackupProfile": "Przywróć lokalne profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Przywróć this lokalne kopia zapasowa profile? Current app dane will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a lokalne kopia zapasowa profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP eksport anyway?",
    "emptyBackupFile": "The selected kopia zapasowa file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP eksport could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A lokalne kopia zapasowa profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe mobilne ZIP sharing. The unstable mobilne save/download eksport was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV źródła",
    "githubCsvSourcesBody": "Desktop serwer is opcjonalne. Dodaj one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Dodaj repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Usuń",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "opcjonalne path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "opcjonalne GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Nazwa",
    "brandSource": "Marka / źródło",
    "barcodeQr": "Barcode / QR",
    "note": "Notatka",
    "optional": "opcjonalnie",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Opis",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this wpis",
    "recipeExtraKcalHelp": "Adds to or subtracts from the składnik kcal total. Macros still come from składniki.",
    "servings": "Porcje",
    "servingsEmptyHelp": "Leave empty to make the whole przepis one serving.",
    "localRecipeItemsTitle": "Składniki / produkty / przepisy",
    "selectItem": "Select pozycja",
    "localRecipeSearchHint": "No long dropdown — szukaj by produkt, składnik or przepis nazwa.",
    "searchItem": "Szukaj pozycja",
    "find": "Szukaj",
    "noMatchingItem": "Brak dopasowania.",
    "mobileRecipeSyncHint": "Mobile przepis changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Kod",
    "type": "Typ",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop produkt database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-źródło nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Skanuj kod kreskowy / QR",
    "scanNutrinoQr": "Skanuj QR Nutrino",
    "scanHelper": "If a przepis has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the kod below.",
    "scanPlaceholder": "kod kreskowy, dane QR lub kod Nutrino",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Szukaj synced katalog",
    "scanBarcodeQrAria": "Skanuj kod kreskowy or QR",
    "scanQrAria": "Skanuj QR",
    "searchAria": "Szukaj",
    "translationsHint": "Dodaj tylko potrzebne języki. Nazwa bazowa pozostaje awaryjna.",
    "translationLanguage": "Język",
    "translationValue": "Przetłumaczona nazwa",
    "translationAddPlaceholder": "Dodaj język…"
  },
  "es": {
    "home": "Inicio",
    "diary": "Diario",
    "recipes": "Recetas",
    "profile": "Perfil",
    "settings": "Ajustes",
    "synced": "Sincronizado",
    "syncing": "Sincronizando",
    "pending": "pendiente",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "Actividad",
    "breakfast": "Desayuno",
    "lunch": "Comida",
    "dinner": "Cena",
    "snack": "Snack",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Añadir burned kcal",
    "startTheDay": "Iniciar the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Añadir new elemento",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Atrás again within 5 seconds to exit.",
    "noActivity": "No actividad logged for this day.",
    "noEntries": "No entradas yet.",
    "edit": "Editar",
    "delete": "Eliminar",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Unidades",
    "calculations": "Cálculos",
    "language": "Idioma",
    "privacy": "Privacidad",
    "about": "Acerca de",
    "licenses": "Licencias",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached elementos",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Actividad Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Predeterminado del sistema",
    "english": "Inglés",
    "hungarian": "Húngaro",
    "scan": "Escanear",
    "languageSearch": "Buscar por nombre inglés, nombre nativo o código…",
    "translations": "Traducciones",
    "noTranslations": "Aún no hay traducciones.",
    "addTranslation": "Añadir traducción",
    "cancel": "Cancelar",
    "ok": "OK",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing entradas on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Alimento and actividad entradas for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real alimentos later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as nota",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Diario entradas and actividad logs stay local on móvil.",
    "target": "target",
    "weight": "peso",
    "saveWeight": "Guardar peso",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Editar peso",
    "futureDateWarning": "This date is in the future. Logging future diary datos can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly peso check",
    "weeklyWeightCheckBody": "Actualizar your peso once a week. If it does not change, nutrino keeps using the latest known valor.",
    "save": "Guardar",
    "addTo": "Añadir to",
    "add": "Añadir",
    "update": "Actualizar",
    "addActivity": "Añadir actividad",
    "updateActivity": "Actualizar actividad",
    "customRecipe": "Customize receta",
    "customRecipeHint": "Changes are saved only for this diary entrada.",
    "customizedRecipe": "custom receta",
    "editRecipeLocally": "Editar receta for this entrada",
    "changeSelection": "Change alimento/receta",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a alimento or receta first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid peso in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Actividad updated.",
    "activityAdded": "Actividad added.",
    "activities": "Actividades",
    "entries": "entradas",
    "foodAndRecipeSearch": "Buscar alimentos and recetas",
    "searchIn": "Buscar in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Marca",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Descripción",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Buscar actividades",
    "recipe": "Receta",
    "food": "Alimento",
    "ingredient": "Ingrediente",
    "grams": "gramos",
    "pieces": "piezas",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app datos",
    "exportAppDataBody": "Guardar a full local ZIP copia de seguridad.",
    "importAppData": "Import app datos",
    "importAppDataBody": "Select a nutrino móvil app ZIP copia de seguridad.",
    "channelDataTransfer": "Dev / stable datos transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Actualizar dev from stable copia de seguridad",
    "updateStableFromDev": "Actualizar stable from dev copia de seguridad",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app datos with a copia de seguridad from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer exportar",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer importar",
    "channelTransferImportProfile": "Channel transfer importar",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Actividad",
    "activityLevelHint": "Used for diario kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API ajustes",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop servidor requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Contraseña del servidor",
    "pairingToken": "Pairing token",
    "addKcalNote": "Nota",
    "existingItem": "Existing",
    "noteEntry": "Nota",
    "kcalNoteTitle": "Nota title",
    "kcalNoteDescription": "Descripción",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local catálogo actions",
    "addLocalIngredient": "Añadir local ingrediente",
    "addLocalFood": "Añadir local alimento",
    "addLocalRecipe": "Añadir local receta",
    "addLocalActivity": "Añadir local actividad",
    "localItemCreated": "Local elemento saved. Sync when the desktop servidor is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load datos from servidor",
    "pushNow": "Send datos to servidor",
    "pullFailedOffline": "Download failed. Local datos remains available.",
    "pushFailedOffline": "Upload failed. Local datos stays pendiente until the servidor is reachable.",
    "dailyBackupProfile": "Daily automatic copia de seguridad profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop servidor is offline.",
    "serverOfflineUsingCache": "Desktop servidor is offline. Using local cached catálogo.",
    "deleteEntryConfirm": "Eliminar this entrada?",
    "deleteActivityConfirm": "Eliminar this actividad?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Alimentos",
    "noSyncedItems": "No synced alimentos or recetas yet. Iniciar the desktop servidor or add a GitHub CSV fuente and sincronización.",
    "appDataExportCreated": "App datos exportar created.",
    "appDataImported": "App datos imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This copia de seguridad will overwrite all current local app datos. Continue?",
    "invalidBackupFile": "This is not a valid nutrino móvil app copia de seguridad.",
    "clearCachedConfirm": "Clear synced alimentos, recetas, actividades and merge aliases from the móvil cache? Diario logs remain on the device. The next servidor download will reload a full catálogo snapshot.",
    "cachedCatalogCleared": "Cached catálogo cleared. The next servidor download will fully reload the catálogo.",
    "privacyBody": "nutrino stores your profile, diary, alimento cache and actividad datos locally on your device. The app only talks to your paired desktop servidor on your network. We do not collect, sell or upload your datos to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the fuente código, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source código",
    "factoryReset": "Restablecer",
    "factoryResetBody": "Eliminar all local app datos and restart onboarding.",
    "factoryResetConfirm": "This deletes all local móvil diary, profile, cached catálogo and ajustes datos. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Añadir your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Perfil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Inicio shows calories and macros. Diario shows your calendar. Recetas lists synced catálogo elementos. Perfil stores your body and goal ajustes.",
    "finishSetup": "Finish setup",
    "next": "Siguiente",
    "back": "Atrás",
    "startUsingNutrino": "Iniciar using nutrino",
    "restoreBackup": "Restaurar copia",
    "restore": "Restaurar",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No local copia de seguridad profiles yet.",
    "createBackupProfile": "Create copia de seguridad profile",
    "manualBackupProfile": "Manual copia de seguridad profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before importar",
    "importBackupProfile": "Imported copia de seguridad",
    "beforeBackupProfileRestore": "Before copia de seguridad profile restore",
    "restoreBackupProfile": "Restaurar local profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Restaurar this local copia de seguridad profile? Current app datos will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a local copia de seguridad profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP exportar anyway?",
    "emptyBackupFile": "The selected copia de seguridad file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP exportar could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A local copia de seguridad profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe móvil ZIP sharing. The unstable móvil save/download exportar was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV fuentes",
    "githubCsvSourcesBody": "Desktop servidor is opcional. Añadir one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Añadir repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Eliminar",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "opcional path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "opcional GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Nombre",
    "brandSource": "Marca / fuente",
    "barcodeQr": "Barcode / QR",
    "note": "Nota",
    "optional": "opcional",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Descripción",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this entrada",
    "recipeExtraKcalHelp": "Adds to or subtracts from the ingrediente kcal total. Macros still come from ingredientes.",
    "servings": "Porciones",
    "servingsEmptyHelp": "Leave empty to make the whole receta one serving.",
    "localRecipeItemsTitle": "Ingredientes / alimentos / recetas",
    "selectItem": "Select elemento",
    "localRecipeSearchHint": "No long dropdown — buscar by alimento, ingrediente or receta nombre.",
    "searchItem": "Buscar elemento",
    "find": "Buscar",
    "noMatchingItem": "No hay coincidencias.",
    "mobileRecipeSyncHint": "Mobile receta changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Código",
    "type": "Tipo",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop alimento database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-fuente nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Escanear código / QR",
    "scanNutrinoQr": "Escanear QR de Nutrino",
    "scanHelper": "If a receta has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the código below.",
    "scanPlaceholder": "código de barras, contenido QR o código Nutrino",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Buscar synced catálogo",
    "scanBarcodeQrAria": "Escanear código de barras or QR",
    "scanQrAria": "Escanear QR",
    "searchAria": "Buscar",
    "translationsHint": "Añade solo los idiomas necesarios. El nombre base queda como respaldo.",
    "translationLanguage": "Idioma",
    "translationValue": "Nombre traducido",
    "translationAddPlaceholder": "Añadir idioma…"
  },
  "pt": {
    "home": "Início",
    "diary": "Diário",
    "recipes": "Receitas",
    "profile": "Perfil",
    "settings": "Definições",
    "synced": "Sincronizado",
    "syncing": "A sincronizar",
    "pending": "pendente",
    "supplied": "supplied",
    "burned": "burned",
    "kcalLeft": "kcal left",
    "tooMuch": "too much",
    "activity": "Atividade",
    "breakfast": "Pequeno-almoço",
    "lunch": "Almoço",
    "dinner": "Jantar",
    "snack": "Lanche",
    "carbs": "carbs",
    "fat": "fat",
    "protein": "protein",
    "addBurnedKcal": "Adicionar burned kcal",
    "startTheDay": "Iniciar the day",
    "middayMeal": "Midday meal",
    "eveningMeal": "Evening meal",
    "smallMeals": "Small meals",
    "addNewItem": "Adicionar new item",
    "unlockEditConfirm": "Enable editing for this day? This prevents accidental changes to older diary days.",
    "discardCurrentEditConfirm": "Discard the current edit without saving?",
    "finishSetupBeforeExit": "Finish setup before leaving the app.",
    "pressBackAgain": "Press Voltar again within 5 seconds to exit.",
    "noActivity": "No atividade logged for this day.",
    "noEntries": "No entradas yet.",
    "edit": "Editar",
    "delete": "Eliminar",
    "duplicate": "Duplicate",
    "duplicateEntry": "Duplicate entry",
    "duplicateMealTargetHint": "Choose which meal should receive the duplicate.",
    "moveToMeal": "Move to meal",
    "entryActions": "Entry actions",
    "entryDuplicated": "Entry duplicated.",
    "entryMoved": "Entry moved.",
    "units": "Unidades",
    "calculations": "Cálculos",
    "language": "Idioma",
    "privacy": "Privacidade",
    "about": "Sobre",
    "licenses": "Licenças",
    "thirdPartyNotices": "Third-party notices",
    "acknowledgements": "Acknowledgements",
    "exportImport": "Export / Import App Data",
    "clearCache": "Clear cached itens",
    "dailyReminder": "Daily Reminder",
    "trackingReminders": "Tracking & reminders",
    "weeklyWeightAverage": "Weekly weight average",
    "weeklyWeightAverageHint": "Calculate weekly average weight for each Sunday.",
    "dailyWeightReminder": "Daily weight reminder",
    "dailyWeightReminderTime": "Daily weight reminder time",
    "mealReminders": "Meal logging reminders",
    "mealReminderMorning": "Log breakfast or your morning meal.",
    "mealReminderNoon": "Log lunch or your midday meal.",
    "mealReminderAfternoon": "Log dinner, snack or your afternoon meal.",
    "mealReminderTitle": "Meal reminder",
    "weightReminderTitle": "Weight reminder",
    "weightReminderBody": "Add today’s body weight so the weekly average stays useful.",
    "calorieDeficitTracking": "Safety deficit tracking",
    "targetDeficit": "Target safety deficit",
    "calorieLimitWarning": "Warn when target deficit is exceeded",
    "exerciseKcalEatback": "Exercise calories to eat back",
    "eatbackNone": "Do not eat back exercise kcal",
    "eatbackHalf": "Eat back half",
    "eatbackFull": "Eat back all",
    "requestNotifications": "Enable notifications",
    "notificationsUnsupported": "Notifications are not supported here.",
    "notificationsEnabled": "Notifications enabled.",
    "notificationsNotEnabled": "Notifications were not enabled.",
    "deficitWarningTitle": "Deficit limit exceeded",
    "deficitKcalLeft": "deficit kcal left",
    "safeKcalLeft": "left before target deficit",
    "overDeficit": "over deficit",
    "overDeficitButWithinLimit": "over the target deficit, still within daily limit",
    "overDailyLimit": "over the daily limit",
    "deficitOffHint": "Safety deficit is off.",
    "analysis": "Analysis",
    "openAnalysis": "Open analysis",
    "closeAnalysis": "Close analysis",
    "weightTrend": "Weight trend",
    "calorieTrend": "Calorie trend",
    "deficitStreak": "Deficit streak",
    "currentStreak": "Current streak",
    "bestStreak": "Best streak",
    "successRate": "Success rate",
    "days": "days",
    "weeklyAverage": "Weekly average",
    "limitedData": "limited data",
    "noWeightTrend": "Add weight entries to see the selected weight trend.",
    "fullLimit": "full limit",
    "effectiveLimit": "deficit target",
    "exerciseCredit": "exercise credit",
    "legend": "Legend",
    "consumedLegend": "Consumed kcal",
    "weightLegendValue": "Weight value",
    "theme": "Theme",
    "showActivity": "Show Atividade Tracking",
    "showMacros": "Show Meal Macros",
    "showMicros": "Show Micronutrients",
    "metric": "Metric (kg, cm, ml)",
    "imperial": "Imperial (lbs, ft, oz)",
    "systemDefault": "Padrão do sistema",
    "english": "Inglês",
    "hungarian": "Húngaro",
    "scan": "Digitalizar",
    "languageSearch": "Pesquisar por nome em inglês, nome nativo ou código…",
    "translations": "Traduções",
    "noTranslations": "Ainda não há traduções.",
    "addTranslation": "Adicionar tradução",
    "cancel": "Cancelar",
    "ok": "OK",
    "reset": "Reset",
    "unlockDay": "Unlock day editing",
    "lockedNote": "Unlock editing before changing entradas on this day.",
    "editingEnabled": "Editing enabled",
    "selectedDayEntriesNote": "Alimento and atividade entradas for the selected calendar day are shown below.",
    "mealNotesToReview": "Meal notes to review",
    "mealNotesToReviewHint": "These notes stay on this phone. Open the day to replace them with real alimentos later, or keep them as final notes.",
    "openDay": "Open day",
    "keepAsNote": "Keep as nota",
    "noMealNotesToReview": "No meal notes need review.",
    "previousMealNotes": "Previous notes",
    "useNote": "Use note",
    "convertToCatalogItem": "Convert to food",
    "convertNoteToCatalogHint": "Replace this note with an ingredient, food or recipe.",
    "localOnlyDiaryHint": "Diário entradas and atividade logs stay local on móvel.",
    "target": "target",
    "weight": "peso",
    "saveWeight": "Guardar peso",
    "weightForThisDay": "Weight for this day in kg",
    "editWeight": "Editar peso",
    "futureDateWarning": "This date is in the future. Logging future diary dados can make your diary inaccurate. Continue anyway?",
    "weeklyWeightCheck": "Weekly peso check",
    "weeklyWeightCheckBody": "Atualizar your peso once a week. If it does not change, nutrino keeps using the latest known valor.",
    "save": "Guardar",
    "addTo": "Adicionar to",
    "add": "Adicionar",
    "update": "Atualizar",
    "addActivity": "Adicionar atividade",
    "updateActivity": "Atualizar atividade",
    "customRecipe": "Customize receita",
    "customRecipeHint": "Changes are saved only for this diary entrada.",
    "customizedRecipe": "custom receita",
    "editRecipeLocally": "Editar receita for this entrada",
    "changeSelection": "Change alimento/receita",
    "selected": "Selected",
    "baseAmount": "base",
    "onePiece": "1 pc",
    "selectFoodFirst": "Select a alimento or receita first.",
    "amountGreaterThanZero": "Amount must be greater than zero.",
    "enterValidWeight": "Enter a valid peso in kg.",
    "weightSaved": "Weight saved.",
    "activityUpdated": "Atividade updated.",
    "activityAdded": "Atividade added.",
    "activities": "Atividades",
    "entries": "entradas",
    "foodAndRecipeSearch": "Pesquisar alimentos and receitas",
    "searchIn": "Pesquisar in",
    "searchScopeTitle": "Title",
    "searchScopeAll": "All",
    "searchScopeBrand": "Marca",
    "searchScopeCategory": "Category",
    "searchScopeDescription": "Descrição",
    "exactMatches": "Exact matches",
    "maybeYouMean": "Maybe you meant",
    "activitySearch": "Pesquisar atividades",
    "recipe": "Receita",
    "food": "Alimento",
    "ingredient": "Ingrediente",
    "grams": "gramas",
    "pieces": "peças",
    "catalog": "Catalog",
    "watch": "Watch",
    "manual": "Manual",
    "minutes": "minutes",
    "kcalFromWatchManual": "kcal from watch/manual",
    "exportAppData": "Export app dados",
    "exportAppDataBody": "Guardar a full local ZIP cópia de segurança.",
    "importAppData": "Import app dados",
    "importAppDataBody": "Select a nutrino móvel app ZIP cópia de segurança.",
    "channelDataTransfer": "Dev / stable dados transfer",
    "channelDataTransferBody": "Android installs dev and stable as two separate apps. Transfer is explicit through a ZIP handoff because the apps cannot read each other’s private storage directly.",
    "updateDevFromStable": "Atualizar dev from stable cópia de segurança",
    "updateStableFromDev": "Atualizar stable from dev cópia de segurança",
    "exportDevForStable": "Create package for stable",
    "exportStableForDev": "Create package for dev",
    "confirmChannelTransferImport": "This will overwrite the current app dados with a cópia de segurança from the other installed channel. Continue?",
    "channelTransferExportProfile": "Channel transfer exportar",
    "beforeChannelTransferImportBackupProfile": "Before channel transfer importar",
    "channelTransferImportProfile": "Channel transfer importar",
    "channelTransferExportCreated": "Channel transfer package created.",
    "channelTransferImported": "Data imported from the other channel.",
    "activityLevel": "Atividade",
    "activityLevelHint": "Used for diário kcal target",
    "weeklyGoal": "Weekly goal",
    "perWeek": "kg / week",
    "height": "Height",
    "age": "Age",
    "years": "years",
    "gender": "Gender",
    "apiSettings": "API definições",
    "appChannel": "Channel",
    "devApiHint": "Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop servidor requires one.",
    "apiUrl": "API URL",
    "pairingPassword": "Palavra-passe do servidor",
    "pairingToken": "Pairing token",
    "addKcalNote": "Nota",
    "existingItem": "Existing",
    "noteEntry": "Nota",
    "kcalNoteTitle": "Nota title",
    "kcalNoteDescription": "Descrição",
    "kcalNoteValue": "kcal",
    "localCatalogActions": "Local catálogo actions",
    "addLocalIngredient": "Adicionar local ingrediente",
    "addLocalFood": "Adicionar local alimento",
    "addLocalRecipe": "Adicionar local receita",
    "addLocalActivity": "Adicionar local atividade",
    "localItemCreated": "Local item saved. Sync when the desktop servidor is reachable.",
    "genderHint": "Used for kcal estimate",
    "male": "Male",
    "female": "Female",
    "nonBinary": "Non-binary",
    "test": "Test",
    "syncNow": "Load dados from servidor",
    "pushNow": "Send dados to servidor",
    "pullFailedOffline": "Download failed. Local dados remains available.",
    "pushFailedOffline": "Upload failed. Local dados stays pendente until the servidor is reachable.",
    "dailyBackupProfile": "Daily automatic cópia de segurança profile",
    "online": "Online",
    "available": "Available",
    "offline": "Offline",
    "serverOffline": "Desktop servidor is offline.",
    "serverOfflineUsingCache": "Desktop servidor is offline. Using local cached catálogo.",
    "deleteEntryConfirm": "Eliminar this entrada?",
    "deleteActivityConfirm": "Eliminar this atividade?",
    "exportCanceled": "Export canceled.",
    "importCanceled": "Import canceled.",
    "foods": "Alimentos",
    "noSyncedItems": "No synced alimentos or receitas yet. Iniciar the desktop servidor or add a GitHub CSV fonte and sincronização.",
    "appDataExportCreated": "App dados exportar created.",
    "appDataImported": "App dados imported.",
    "importFailed": "Import failed",
    "confirmImportOverwrite": "This cópia de segurança will overwrite all current local app dados. Continue?",
    "invalidBackupFile": "This is not a valid nutrino móvel app cópia de segurança.",
    "clearCachedConfirm": "Clear synced alimentos, receitas, atividades and merge aliases from the móvel cache? Diário logs remain on the device. The next servidor download will reload a full catálogo snapshot.",
    "cachedCatalogCleared": "Cached catálogo cleared. The next servidor download will fully reload the catálogo.",
    "privacyBody": "nutrino stores your profile, diary, alimento cache and atividade dados locally on your device. The app only talks to your paired desktop servidor on your network. We do not collect, sell or upload your dados to third-party services.",
    "reportIssue": "Report an issue",
    "reportIssueBody": "Open GitHub Issues to report bugs or request features.",
    "openRepository": "Open GitHub repository",
    "openRepositoryBody": "View the fonte código, README and releases.",
    "starProject": "Star nutrino on GitHub",
    "starProjectBody": "If nutrino is useful, a star helps the project.",
    "license": "License",
    "sourceCode": "Source código",
    "factoryReset": "Reposição de fábrica",
    "factoryResetBody": "Eliminar all local app dados and restart onboarding.",
    "factoryResetConfirm": "This deletes all local móvel diary, profile, cached catálogo and definições dados. Continue?",
    "onboardingTitle": "Set up nutrino",
    "onboardingIntro": "Adicionar your basic profile so kcal, BMI and goals can be calculated.",
    "onboardingProfile": "Perfil basics",
    "onboardingTour": "Quick tour",
    "onboardingTourBody": "Início shows calories and macros. Diário shows your calendar. Receitas lists synced catálogo itens. Perfil stores your body and goal definições.",
    "finishSetup": "Finish setup",
    "next": "Seguinte",
    "back": "Voltar",
    "startUsingNutrino": "Iniciar using nutrino",
    "restoreBackup": "Restaurar cópia",
    "restore": "Restaurar",
    "backupProfiles": "Backup profiles",
    "backupProfilesBody": "Local restore points are stored separately from your normal profile and survive in-app factory reset.",
    "noBackupProfiles": "No local cópia de segurança profiles yet.",
    "createBackupProfile": "Create cópia de segurança profile",
    "manualBackupProfile": "Manual cópia de segurança profile",
    "exportBackupProfile": "Export restore point",
    "beforeFactoryResetBackupProfile": "Before factory reset",
    "beforeImportBackupProfile": "Before importar",
    "importBackupProfile": "Imported cópia de segurança",
    "beforeBackupProfileRestore": "Before cópia de segurança profile restore",
    "restoreBackupProfile": "Restaurar local profile",
    "backupProfileCreated": "Backup profile saved.",
    "backupProfileDeleted": "Backup profile deleted.",
    "backupProfileRestored": "Backup profile restored.",
    "backupProfileMissing": "Backup profile is no longer available.",
    "confirmRestoreBackupProfile": "Restaurar this local cópia de segurança profile? Current app dados will be saved as a safety restore point first.",
    "backupProfileSaveFailed": "Could not save a local cópia de segurança profile",
    "backupProfilesUnavailable": "Backup profile storage is unavailable on this device.",
    "continueFactoryResetWithoutBackup": "Continue factory reset without a safety restore point?",
    "continueExternalExport": "Continue external ZIP exportar anyway?",
    "emptyBackupFile": "The selected cópia de segurança file is empty (0 B).",
    "backupVerifySizeMismatch": "Export verification size mismatch:",
    "backupVerifyFailed": "External ZIP exportar could not be verified; a browser download fallback was attempted.",
    "backupProfileStillAvailable": "A local cópia de segurança profile is still available in the app.",
    "exportFailed": "Export failed",
    "backupWriteFailed": "Backup file write failed",
    "mobileShareUnavailable": "This device does not support safe móvel ZIP sharing. The unstable móvel save/download exportar was not used, so no 0 B ZIP was created.",
    "mobileShareSheetHint": "Choose Files, Drive or another storage app in the system share sheet.",
    "kgUnit": "kg",
    "cmUnit": "cm",
    "sources": "Sources",
    "githubCsvSources": "GitHub CSV fontes",
    "githubCsvSourcesBody": "Desktop servidor is opcional. Adicionar one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.",
    "addRepo": "Adicionar repo",
    "syncGithubNow": "Sync GitHub now",
    "remove": "Remover",
    "notSyncedYet": "not synced yet",
    "githubOwnerPlaceholder": "owner / organization",
    "githubRepoPlaceholder": "repository",
    "githubBranchPlaceholder": "branch, e.g. main",
    "githubPathPlaceholder": "opcional path, e.g. nutrino/csv",
    "githubTokenPlaceholder": "opcional GitHub token",
    "sedentary": "Sedentary",
    "lowActive": "Low active",
    "active": "Active",
    "veryActive": "Very active",
    "birthday": "Birthday",
    "name": "Nome",
    "brandSource": "Marca / fonte",
    "barcodeQr": "Barcode / QR",
    "note": "Nota",
    "optional": "opcional",
    "kcalPer100g": "kcal / 100 g",
    "servingSizeG": "Serving size g",
    "salt": "Salt",
    "description": "Descrição",
    "extraKcal": "Extra kcal",
    "extraKcalForThisEntry": "Extra kcal for this entrada",
    "recipeExtraKcalHelp": "Adds to or subtracts from the ingrediente kcal total. Macros still come from ingredientes.",
    "servings": "Porções",
    "servingsEmptyHelp": "Leave empty to make the whole receita one serving.",
    "localRecipeItemsTitle": "Ingredientes / alimentos / receitas",
    "selectItem": "Select item",
    "localRecipeSearchHint": "No long dropdown — pesquisar by alimento, ingrediente or receita nome.",
    "searchItem": "Pesquisar item",
    "find": "Procurar",
    "noMatchingItem": "Sem correspondência.",
    "mobileRecipeSyncHint": "Mobile receita changes are uploaded with the same ID, so the desktop inbox sees them as replacements.",
    "code": "Código",
    "type": "Tipo",
    "kcalPerMin": "kcal / min",
    "tdeeEquation": "TDEE equation",
    "iomEquation": "Institute of Medicine Equation (2005)",
    "iomEquationMacro": "Institute of Medicine Equation (2005), macro distribution",
    "dailyKcalAdjustment": "Daily kcal adjustment",
    "macronutrientDistribution": "Macronutrient Distribution",
    "total": "total",
    "aboutBody": "Offline-first nutrition diary for your own desktop alimento database.",
    "aboutThanks": "Thanks to OpenNutriTracker for privacy-first open-fonte nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundations of nutrino.",
    "scanBarcodeQr": "Digitalizar código / QR",
    "scanNutrinoQr": "Digitalizar QR Nutrino",
    "scanHelper": "If a receita has multiple QR parts, scan each numbered QR once. If the camera is unavailable, paste or type the código below.",
    "scanPlaceholder": "código de barras, conteúdo QR ou código Nutrino",
    "catalogMenu": "Catalog menu",
    "syncedCatalogSearch": "Pesquisar synced catálogo",
    "scanBarcodeQrAria": "Digitalizar código de barras or QR",
    "scanQrAria": "Digitalizar QR",
    "searchAria": "Pesquisar",
    "translationsHint": "Adiciona apenas os idiomas necessários. O nome base fica como fallback.",
    "translationLanguage": "Idioma",
    "translationValue": "Nome traduzido",
    "translationAddPlaceholder": "Adicionar idioma…"
  }
};
for (const [language, values] of Object.entries(completeMobileLanguageTranslations)) {
  translations[language] = { ...translations.en, ...(translations[language] || {}), ...values };
}
const mobileVisibleTextTranslations: Record<string, Record<string, string>> = {
  en: {
    version: 'Version', appPermissions: 'App permissions', advanced: 'Advanced', dailyReminderTime: 'Daily reminder time', dailyReminderBody: "Check today's diary and finish your logs.", notificationActionOpen: 'Open', notificationActionLogWeight: 'Weight', notificationActionLogMeal: 'Meal', notificationActionDismiss: 'Dismiss', todayNutrients: "Today's nutrients", mealMicronutrients: 'Meal micronutrients', dayMicronutrients: 'Day nutrients', noChartData: 'No chart data yet.', micronutrientLimits: 'Micronutrient limits', micronutrientLimitsHint: 'Daily thresholds used by the diary warnings.', micronutrientDefaultsInfo: 'Default values are practical adult reference values based on widely used nutrition labels and public health guidance: FDA-style Daily Values for vitamins and minerals, common upper-limit guidance for sodium, saturated fat and added/free sugars, and a 5 g salt reference. They are starting points only; adjust them to your personal plan when needed.', defaultValue: 'default', resetMicronutrients: 'Reset micronutrients', importantNutrients: 'Important nutrients', optionalNutrients: 'Optional nutrients', optionalNutrientsHint: 'Optional per-100g values can be left empty.', dailyLimit: 'daily limit', dailyTarget: 'daily target', exceeded: 'exceeded', noNutrientsLogged: 'No optional nutrients logged yet.', saturatedFat: 'Saturated fat', sodium: 'Sodium', calcium: 'Calcium', iron: 'Iron', potassium: 'Potassium', vitaminD: 'Vitamin D', vitaminB12: 'Vitamin B12', magnesium: 'Magnesium', sugars: 'Sugars', fiber: 'Fiber', copy: 'copy', sourceDesktop: 'Desktop server', sourceGithub: 'GitHub', sourceCustom: 'Custom item', sourceQr: 'QR import', checkSource: 'Check source', checked: 'checked', lock: 'Lock', unlock: 'Unlock', locked: 'locked', inactive: 'inactive', activate: 'Activate', markInactive: 'Mark inactive', inactiveCatalogItem: 'Inactive item', inactiveCatalogItemHint: 'Inactive items are hidden from normal catalog lists unless enabled in settings.', protectExternalCatalogItems: 'Protect imported catalog items', protectExternalCatalogItemsHint: 'Desktop, GitHub and QR items open as locked by default; duplicate them to edit safely.', includeInactiveCatalogItems: 'Show inactive catalog items', includeInactiveCatalogItemsHint: 'Include archived foods, ingredients, recipes and activities in pickers and lists.', catalogItemLocked: 'Catalog item locked.', catalogItemUnlocked: 'Catalog item unlocked.', catalogItemInactive: 'Catalog item marked inactive.', catalogItemActivated: 'Catalog item activated.', lockedCatalogDuplicateHint: 'Imported or locked items are duplicated before editing.', sourceCheckNoChange: 'Source check complete: no change found.', sourceCheckChanged: 'Source check complete: item was updated.', sourceCheckLocalOnly: 'This item is local, so there is no external source to check.'
  },
  hu: {
    version: 'Verzió', appPermissions: 'App engedélyek', advanced: 'Haladó', dailyReminderTime: 'Napi emlékeztető ideje', dailyReminderBody: 'Nézd át a mai naplót és fejezd be a rögzítéseket.', notificationActionOpen: 'Nyitás', notificationActionLogWeight: 'Súly', notificationActionLogMeal: 'Étkezés', notificationActionDismiss: 'Elvetés', todayNutrients: 'Mai tápanyagok', mealMicronutrients: 'Étkezés mikrotápanyagai', dayMicronutrients: 'Napi tápanyagok', noChartData: 'Még nincs diagram adat.', micronutrientLimits: 'Mikrotápanyag határértékek', micronutrientLimitsHint: 'A napi figyelmeztetésekhez használt határértékek.', micronutrientDefaultsInfo: 'Az alapértékek gyakorlati felnőtt referenciaértékek: vitaminoknál és ásványi anyagoknál elterjedt tápértékjelölési napi értékek, nátriumnál, telített zsírnál és cukornál közegészségügyi felső határ jellegű ajánlások, sónál 5 g-os referencia. Kiindulási értékek, szükség esetén igazítsd a saját tervedhez.', defaultValue: 'alap', resetMicronutrients: 'Mikrotápanyagok visszaállítása', importantNutrients: 'Fontos tápanyagok', optionalNutrients: 'Opcionális tápanyagok', optionalNutrientsHint: 'Az opcionális /100g értékek üresen hagyhatók.', dailyLimit: 'napi limit', dailyTarget: 'napi cél', exceeded: 'túllépve', noNutrientsLogged: 'Még nincs opcionális tápanyag rögzítve.', saturatedFat: 'Telített zsír', sodium: 'Nátrium', calcium: 'Kalcium', iron: 'Vas', potassium: 'Kálium', vitaminD: 'D-vitamin', vitaminB12: 'B12-vitamin', magnesium: 'Magnézium', sugars: 'Cukor', fiber: 'Rost', copy: 'másolat', sourceDesktop: 'Desktop szerver', sourceGithub: 'GitHub', sourceCustom: 'Saját tétel', sourceQr: 'QR import', checkSource: 'Forrás ellenőrzése', checked: 'ellenőrizve', lock: 'Zárolás', unlock: 'Feloldás', locked: 'zárolt', inactive: 'inaktív', activate: 'Aktiválás', markInactive: 'Inaktívvá tétel', inactiveCatalogItem: 'Inaktív tétel', inactiveCatalogItemHint: 'Az inaktív tételek eltűnnek a normál listákból, amíg a beállításban nem kéred őket.', protectExternalCatalogItems: 'Importált katalógustételek védelme', protectExternalCatalogItemsHint: 'Desktop, GitHub és QR tételek alapból zároltan nyílnak; szerkesztéshez készíts másolatot.', includeInactiveCatalogItems: 'Inaktív katalógustételek megjelenítése', includeInactiveCatalogItemsHint: 'Archív ételek, alapanyagok, receptek és aktivitások megjelenítése listákban és választókban.', catalogItemLocked: 'Katalógustétel zárolva.', catalogItemUnlocked: 'Katalógustétel feloldva.', catalogItemInactive: 'Katalógustétel inaktívvá téve.', catalogItemActivated: 'Katalógustétel aktiválva.', lockedCatalogDuplicateHint: 'Az importált vagy zárolt tételeket szerkesztés előtt lemásolom.', sourceCheckNoChange: 'Forrásellenőrzés kész: nincs változás.', sourceCheckChanged: 'Forrásellenőrzés kész: a tétel frissült.', sourceCheckLocalOnly: 'Ez helyi tétel, nincs külső forrása.'
  },
  de: { version: 'Version' }, fr: { version: 'Version' }, ru: { version: 'Версия' }, uk: { version: 'Версія' }, zh: { version: '版本' }, sk: { version: 'Verzia' }, ro: { version: 'Versiune' }, cs: { version: 'Verze' }, sl: { version: 'Različica' }, hr: { version: 'Verzija' }, pl: { version: 'Wersja' }, es: { version: 'Versión' }, pt: { version: 'Versão' }
};
for (const [language, values] of Object.entries(mobileVisibleTextTranslations)) {
  translations[language] = { ...translations.en, ...(translations[language] || {}), ...values };
}

const onboardingGuideTranslations: Record<string, Partial<Record<string, string>>> = {
  en: {
    permissionsReady: 'permissions ready',
    notificationPermission: 'Notifications',
    cameraPermission: 'Camera',
    cameraPermissionEnabled: 'Camera enabled.',
    cameraPermissionNotEnabled: 'Camera is not enabled.',
    cameraPermissionUnsupported: 'Camera is not supported here.',
    requestCameraPermission: 'Enable camera',
    requestAllPermissions: 'Enable all permissions',
    onboardingPermissions: 'App permissions',
    onboardingPermissionsBody: 'Set up notifications for reminders and camera access for barcode or QR scanning before you start using the app.',
    onboardingTourStart: 'Start guide',
    developerSettings: 'Developer settings',
    devFirstLaunchMode: 'Test first launch',
    devFirstLaunchModeBody: 'DEV only: reopen the app as a new user without deleting current data.',
    tourDashboardTitle: 'Daily dashboard',
    tourDashboardBody: 'Track consumed and burned kcal, macro progress and your current daily target from the Home screen.',
    tourMealsTitle: 'Meal logging',
    tourMealsBody: 'Tap a meal row to add foods, recipes, notes or activity for the current day.',
    tourQuickAddTitle: 'Quick add',
    tourQuickAddBody: 'Use the floating add button when you want to choose the target meal first.',
    tourSyncTitle: 'Sync status',
    tourSyncBody: 'This shows whether the desktop server or GitHub catalog source is available.',
    tourSettingsTitle: 'Settings',
    tourSettingsBody: 'Manage permissions, reminders, nutrients, backups, language and privacy settings from here.',
    tourDiaryTitle: 'Diary',
    tourDiaryBody: 'Open the calendar view to review past days, daily nutrients and historical entries.',
    tourRecipesTitle: 'Recipes and catalog',
    tourRecipesBody: 'Browse synced foods, recipes and local catalog items here.',
    tourProfileTitle: 'Profile',
    tourProfileBody: 'Adjust body data, goals, API pairing and catalog sources in Profile.',
  },
  hu: {
    permissionsReady: 'engedély kész',
    notificationPermission: 'Értesítések',
    cameraPermission: 'Kamera',
    cameraPermissionEnabled: 'Kamera engedélyezve.',
    cameraPermissionNotEnabled: 'A kamera nincs engedélyezve.',
    cameraPermissionUnsupported: 'A kamera itt nem támogatott.',
    requestCameraPermission: 'Kamera engedélyezése',
    requestAllPermissions: 'Minden engedély kérése',
    onboardingPermissions: 'App engedélyek',
    onboardingPermissionsBody: 'Állítsd be az értesítéseket az emlékeztetőkhöz és a kamerát a vonalkódok vagy QR-kódok beolvasásához, mielőtt használni kezded az appot.',
    onboardingTourStart: 'Bemutató indítása',
    developerSettings: 'Fejlesztői beállítások',
    devFirstLaunchMode: 'Első indítás tesztelése',
    devFirstLaunchModeBody: 'Csak DEV-ben: új belépőként indítja az appot a jelenlegi adatok törlése nélkül.',
    tourDashboardTitle: 'Napi áttekintő',
    tourDashboardBody: 'A Kezdőlapon látod a bevitt és elégetett kcal-t, a makrókat és az aktuális napi célodat.',
    tourMealsTitle: 'Étkezések rögzítése',
    tourMealsBody: 'Koppints egy étkezés sorára, ha ételt, receptet, jegyzetet vagy aktivitást adnál hozzá az aktuális naphoz.',
    tourQuickAddTitle: 'Gyors hozzáadás',
    tourQuickAddBody: 'A lebegő hozzáadás gombbal először kiválaszthatod, melyik étkezéshez szeretnél rögzíteni.',
    tourSyncTitle: 'Szinkron állapot',
    tourSyncBody: 'Itt látod, hogy a desktop szerver vagy a GitHub katalógusforrás elérhető-e.',
    tourSettingsTitle: 'Beállítások',
    tourSettingsBody: 'Itt kezelhetők az engedélyek, emlékeztetők, tápanyagok, backupok, nyelv és adatvédelmi beállítások.',
    tourDiaryTitle: 'Napló',
    tourDiaryBody: 'A naptárnézetben átnézheted a korábbi napokat, napi tápanyagokat és bejegyzéseket.',
    tourRecipesTitle: 'Receptek és katalógus',
    tourRecipesBody: 'Itt böngészhetők a szinkronizált ételek, receptek és helyi katalógustételek.',
    tourProfileTitle: 'Profil',
    tourProfileBody: 'A testadatok, célok, API párosítás és katalógusforrások a Profilban módosíthatók.',
  },
};
translations.en = { ...translations.en, ...normalizeTranslationValues(onboardingGuideTranslations.en || {}) };
for (const language of Object.keys(translations)) {
  translations[language] = {
    ...translations.en,
    ...(translations[language] || {}),
    ...normalizeTranslationValues(onboardingGuideTranslations[language] || {}),
  };
}

const mobileUpdateAndSourceTranslations: Record<string, Partial<Record<string, string>>> = {
  en: {
    appUpdates: 'App updates',
    appUpdatesBody: 'Check GitHub Releases for a newer Nutrino version.',
    checkUpdates: 'Check for updates',
    checkingUpdates: 'Checking…',
    includePrereleaseUpdates: 'Watch pre-releases',
    includePrereleaseUpdatesHint: 'Off by default; stable releases are checked unless enabled.',
    updateAvailable: 'Update available',
    updateAvailableBody: 'A newer Nutrino release is available.',
    installUpdate: 'Install update',
    remindLater: 'Remind me later',
    remindLaterSaved: 'Update reminder postponed.',
    latestInstalled: 'You are on the latest version.',
    updateCheckFailed: 'Update check failed',
    updateInstallerStarted: 'Opening the update installer.',
    androidUpdateInstallerStarted: 'Android opened the update installer. Confirm installation to finish.',
    androidInstallPermissionRequired: 'Allow app installs for Nutrino. The update will continue when you return.',
    updateInstallerFailed: 'Could not start update installation',
    desktopApiConnection: 'Desktop API connection',
    desktopApiConnectionBody: 'Sync catalog data with the desktop LAN server.',
    githubCsvConnection: 'GitHub CSV connection',
    githubCsvConnectionBody: 'Import catalog data from GitHub CSV sources.',
    desktopApiDisabled: 'Desktop API connection is disabled.',
    githubCsvDisabled: 'GitHub CSV connection is disabled.',
    sourceSettings: 'Source settings',
    syncPreferences: 'Sync preferences',
    syncPreferencesBody: 'Nutrino works as a mobile-only app too. Enable only the catalog sources you want to use.',
    serverVersionMismatch: 'Desktop communication is disabled because app versions differ.',
    desktopServerNewer: 'Desktop server is newer than mobile:',
    desktopServerOlder: 'Desktop server is older than mobile:',
    desktopNotifiedForUpdate: 'Desktop server was asked to check for updates.',
  },
  hu: {
    appUpdates: 'App frissítések',
    appUpdatesBody: 'Új Nutrino verzió keresése GitHub Releases alapján.',
    checkUpdates: 'Frissítés keresése',
    checkingUpdates: 'Ellenőrzés…',
    includePrereleaseUpdates: 'Pre-release figyelése',
    includePrereleaseUpdatesHint: 'Alapból kikapcsolva; bekapcsolás nélkül csak stabil kiadásokat néz.',
    updateAvailable: 'Frissítés érhető el',
    updateAvailableBody: 'Újabb Nutrino kiadás érhető el.',
    installUpdate: 'Frissítés telepítése',
    remindLater: 'Emlékeztess később',
    remindLaterSaved: 'Frissítési emlékeztető elhalasztva.',
    latestInstalled: 'A legfrissebb verzió van fent.',
    updateCheckFailed: 'A frissítés ellenőrzése sikertelen',
    updateInstallerStarted: 'Megnyitom a frissítés telepítőjét.',
    androidUpdateInstallerStarted: 'Az Android megnyitotta a frissítés telepítőjét. Erősítsd meg a telepítést.',
    androidInstallPermissionRequired: 'Engedélyezd a Nutrino apptelepítést. Visszatéréskor folytatódik a frissítés.',
    updateInstallerFailed: 'Nem sikerült elindítani a frissítés telepítését',
    desktopApiConnection: 'Desktop API kapcsolat',
    desktopApiConnectionBody: 'Katalógusadatok szinkronizálása a desktop LAN szerverrel.',
    githubCsvConnection: 'GitHub CSV kapcsolat',
    githubCsvConnectionBody: 'Katalógusadatok importálása GitHub CSV forrásokból.',
    desktopApiDisabled: 'A Desktop API kapcsolat ki van kapcsolva.',
    githubCsvDisabled: 'A GitHub CSV kapcsolat ki van kapcsolva.',
    sourceSettings: 'Forrásbeállítások',
    syncPreferences: 'Szinkron beállítások',
    syncPreferencesBody: 'A Nutrino csak mobilappként is működik. Csak azokat a katalógusforrásokat kapcsold be, amelyeket használni szeretnél.',
    serverVersionMismatch: 'Az adatkommunikáció letiltva, mert az appverziók eltérnek.',
    desktopServerNewer: 'A desktop szerver újabb, mint a mobil:',
    desktopServerOlder: 'A desktop szerver régebbi, mint a mobil:',
    desktopNotifiedForUpdate: 'A desktop szervert frissítéskeresésre kértem.',
  },
};
translations.en = { ...translations.en, ...normalizeTranslationValues(mobileUpdateAndSourceTranslations.en || {}) };
for (const language of Object.keys(translations)) {
  translations[language] = {
    ...translations.en,
    ...(translations[language] || {}),
    ...normalizeTranslationValues(mobileUpdateAndSourceTranslations[language] || {}),
  };
}
// end generated completeMobileLanguageTranslations

function t(key: string) {
  return translations[activeLanguage.value]?.[key] ?? translations.en[key] ?? key;
}

function currentLocale() {
  return languageOptions.find((language) => language.code === activeLanguage.value)?.locale || 'en-US';
}

function localizedName(item?: { name: string; name_i18n?: LocalizedNameMap | null }) {
  if (!item) return '';
  return item.name_i18n?.[activeLanguage.value] || item.name;
}

function searchableLocalizedName(item?: { name: string; name_i18n?: LocalizedNameMap | null }) {
  if (!item) return '';
  return [item.name, localizedName(item), ...Object.values(item.name_i18n || {})].join(' ');
}

function selectedLanguageLabel() {
  const option = languageOptions.find((language) => language.code === state.settings.language);
  if (!option) return String(state.settings.language || 'system');
  return option.code === 'system' ? t('systemDefault') : `${option.englishName} · ${option.nativeName} (${option.code})`;
}

function setLanguage(code: AppLanguage) {
  state.settings.language = code;
  saveState(state);
}

function ensureLocalNameI18n(): LocalizedNameMap {
  if (!localCatalogForm.name_i18n) localCatalogForm.name_i18n = {};
  return localCatalogForm.name_i18n;
}

function localNameI18nEntries() {
  return Object.entries(ensureLocalNameI18n()).sort(([a], [b]) => a.localeCompare(b));
}

function addLocalNameTranslation(event: Event) {
  const select = event.target as HTMLSelectElement;
  const code = select.value;
  if (code) ensureLocalNameI18n()[code] ||= '';
  select.value = '';
}

function removeLocalNameTranslation(code: string) {
  delete ensureLocalNameI18n()[code];
}

function availableLocalTranslationLanguages() {
  const existing = new Set(Object.keys(ensureLocalNameI18n()));
  return languageOptions.filter((language) => language.code !== 'system' && !existing.has(language.code));
}

function languageLabel(code: string) {
  const language = languageOptions.find((option) => option.code === code);
  return language ? `${language.englishName} · ${language.nativeName} (${language.code})` : code;
}

function pageTitle() {
  return activeTab.value === 'home' ? t('home') : activeTab.value === 'diary' ? t('diary') : activeTab.value === 'recipes' ? t('recipes') : t('profile');
}

function sectionHint(section: MealSection) {
  if (section.key === 'activity') return t('addBurnedKcal');
  if (section.key === 'breakfast') return t('startTheDay');
  if (section.key === 'lunch') return t('middayMeal');
  if (section.key === 'dinner') return t('eveningMeal');
  return t('smallMeals');
}

function sectionSummaryText(section: MealSection) {
  const summary = sectionSummary(section);
  if (section.key === 'activity') return `${summary.kcal} kcal`;
  if (!state.settings.show_meal_macros) return `${summary.kcal} kcal`;
  return `${summary.kcal} kcal
${summary.carbs} c  ${summary.fat} f  ${summary.protein} p`;
}

function macroForEntries(entries: Intake[]) {
  let kcal = 0, carbs = 0, fat = 0, protein = 0;
  for (const entry of entries) {
    const food = foodFromIntake(entry);
    kcal += food ? calculateKcal(food, entry.amount_g) : 0;
    carbs += ((food?.carbs_per_100g ?? 0) * entry.amount_g) / 100;
    fat += ((food?.fat_per_100g ?? 0) * entry.amount_g) / 100;
    protein += ((food?.protein_per_100g ?? 0) * entry.amount_g) / 100;
  }
  return { kcal: Math.round(kcal), carbs: Math.round(carbs), fat: Math.round(fat), protein: Math.round(protein) };
}


function optionalNutrientPer100g(item: Food | undefined, nutrient: OptionalNutrientDefinition): number {
  if (!item) return 0;
  if (nutrient.field) return Number(item[nutrient.field] || 0);
  return Number(item.optional_nutrients?.[nutrient.key] || 0);
}

function nullableNonNegativeNumber(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function setOptionalNutrientValue(nutrient: OptionalNutrientDefinition, value: unknown) {
  const numeric = nullableNonNegativeNumber(value);
  if (nutrient.field) {
    (localCatalogForm as any)[nutrient.field] = numeric;
    return;
  }
  if (numeric === null) delete localCatalogForm.optional_nutrients[nutrient.key];
  else localCatalogForm.optional_nutrients[nutrient.key] = numeric;
}

function localOptionalNutrientValue(nutrient: OptionalNutrientDefinition): number | null {
  if (nutrient.field) {
    const value = (localCatalogForm as any)[nutrient.field];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  const value = localCatalogForm.optional_nutrients[nutrient.key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function setOptionalNutrientValueFromEvent(nutrient: OptionalNutrientDefinition, event: Event) {
  setOptionalNutrientValue(nutrient, (event.target as HTMLInputElement | null)?.value);
}

function formatNutrientAmount(value: number, unit: string): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const rounded = safeValue >= 100 ? Math.round(safeValue) : Math.round(safeValue * 10) / 10;
  return `${rounded}${unit}`;
}

function micronutrientLimit(nutrient: OptionalNutrientDefinition): number {
  const value = Number(state.settings.micronutrient_limits?.[nutrient.key]);
  return Number.isFinite(value) && value > 0 ? value : nutrient.dailyLimit;
}

function setMicronutrientLimit(nutrient: OptionalNutrientDefinition, value: unknown) {
  const numeric = Number(value);
  state.settings.micronutrient_limits = {
    ...(state.settings.micronutrient_limits || {}),
    [nutrient.key]: Number.isFinite(numeric) && numeric > 0 ? numeric : nutrient.dailyLimit,
  };
}

function setMicronutrientLimitFromEvent(nutrient: OptionalNutrientDefinition, event: Event) {
  setMicronutrientLimit(nutrient, (event.target as HTMLInputElement | null)?.value);
}

function resetMicronutrientLimits() {
  state.settings.micronutrient_limits = Object.fromEntries(optionalNutrientDefinitions.map((nutrient) => [nutrient.key, nutrient.dailyLimit]));
}

function openMealMicronutrients(section: MealSection) {
  if (!state.settings.show_micronutrients || section.key === 'activity') return;
  nutrientChartMode.value = 'important';
  nutrientInsightsDialog.value = { kind: 'meal', mealType: section.key };
}

function openDayMicronutrients() {
  if (!state.settings.show_micronutrients) return;
  nutrientChartMode.value = 'important';
  nutrientInsightsDialog.value = { kind: 'day' };
}

function closeNutrientInsights() {
  nutrientInsightsDialog.value = null;
}

function nutrientStatusTone(limitKind: 'max' | 'target', progress: number): 'good' | 'warn' | 'danger' {
  if (limitKind === 'max') {
    if (progress >= 1) return 'danger';
    if (progress >= 0.7) return 'warn';
    return 'good';
  }
  if (progress >= 1) return 'good';
  if (progress >= 0.5) return 'warn';
  return 'danger';
}

function buildDailyNutrientRows(entries: Intake[], dailyEntries: Intake[] = entries) {
  return optionalNutrientDefinitions.map((nutrient) => {
    const value = entries.reduce((sum, entry) => {
      const food = foodFromIntake(entry);
      return sum + optionalNutrientPer100g(food, nutrient) * Math.max(0, Number(entry.amount_g || 0)) / 100;
    }, 0);
    const dailyValue = dailyEntries.reduce((sum, entry) => {
      const food = foodFromIntake(entry);
      return sum + optionalNutrientPer100g(food, nutrient) * Math.max(0, Number(entry.amount_g || 0)) / 100;
    }, 0);
    const limit = micronutrientLimit(nutrient);
    const progress = clamp(value / Math.max(1, limit));
    return {
      key: nutrient.key,
      label: t(nutrient.labelKey),
      value,
      dailyValue,
      limit,
      unit: nutrient.unit,
      progress,
      limitKind: nutrient.limitKind,
      isOver: value > limit,
      tone: nutrientStatusTone(nutrient.limitKind, progress),
    };
  });
}

function buildMacroChartSlices(entries: Intake[]): NutrientChartSlice[] {
  const summary = macroForEntries(entries);
  const items = [
    { label: t('carbs'), value: Math.max(0, summary.carbs), amount: `${Math.max(0, summary.carbs)}g` },
    { label: t('fat'), value: Math.max(0, summary.fat), amount: `${Math.max(0, summary.fat)}g` },
    { label: t('protein'), value: Math.max(0, summary.protein), amount: `${Math.max(0, summary.protein)}g` },
  ].filter((item) => item.value > 0);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return [];
  return items.map((item, index) => ({
    label: item.label,
    value: item.value,
    amount: item.amount,
    note: `${Math.round((item.value / total) * 100)}%`,
    share: item.value / total,
    color: nutrientChartPalette[index % nutrientChartPalette.length],
  }));
}

function buildOptionalChartSlices(rows: Array<{ label: string; value: number; unit: string; limit: number }>): NutrientChartSlice[] {
  const items = rows
    .filter((row) => row.value > 0)
    .map((row, index) => ({
      label: row.label,
      value: row.limit > 0 ? row.value / row.limit : 0,
      amount: formatNutrientAmount(row.value, row.unit),
      note: row.limit > 0 ? `${Math.round((row.value / row.limit) * 100)}%` : '',
      share: 0,
      color: nutrientChartPalette[index % nutrientChartPalette.length],
    }))
    .filter((item) => item.value > 0);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return [];
  return items.map((item) => ({ ...item, share: item.value / total }));
}

function nutrientChartBackground(slices: NutrientChartSlice[]): string {
  if (!slices.length) return 'conic-gradient(var(--surface-container-highest) 0 360deg)';
  let start = 0;
  const parts = slices.map((slice) => {
    const end = start + slice.share * 360;
    const part = `${slice.color} ${start}deg ${end}deg`;
    start = end;
    return part;
  });
  return `conic-gradient(${parts.join(', ')})`;
}

function sectionSummary(section: MealSection) {
  if (section.key === 'activity') {
    const kcal = currentDayActivities.value.reduce((sum, entry) => sum + entry.kcal, 0);
    return { kcal: Math.round(kcal), carbs: 0, fat: 0, protein: 0 };
  }
  return macroForEntries(entriesForSection(section));
}

function miniProgress(value: number, goal: number) {
  return clamp(value / Math.max(1, goal));
}

function miniRingOffset(value: number, goal: number) {
  return macroRing * (1 - miniProgress(value, goal));
}

function confirmFutureDateAccess(): boolean {
  if (!selectedDateIsFuture.value) return true;
  const key = activeLogDateKey.value;
  if (futureConfirmedDates.value[key]) return true;
  const confirmed = window.confirm(t('futureDateWarning'));
  if (confirmed) futureConfirmedDates.value[key] = true;
  return confirmed;
}

function ensureSelectedDayEditing(): boolean {
  if (activeTab.value !== 'diary') return confirmFutureDateAccess();
  if (!confirmFutureDateAccess()) return false;
  if (selectedDayUnlocked.value) return true;
  const confirmed = window.confirm(t('unlockEditConfirm'));
  if (confirmed) unlockedDiaryDate.value = selectedDate.value;
  return confirmed;
}

function unlockSelectedDay() {
  ensureSelectedDayEditing();
}


function authPassword(): string {
  const password = String(state.pairing.password ?? state.pairing.token ?? '').trim();
  state.pairing.token = password;
  state.pairing.password = password;
  state.pairing.channel = appChannel;
  return password;
}

function showOfflineToastOnce(message = t('serverOfflineUsingCache')) {
  if (offlineToastShown.value) return;
  offlineToastShown.value = true;
  showToast(message);
}

function clearOfflineToastMemory() {
  offlineToastShown.value = false;
}

function resetLocalCatalogForm() {
  Object.assign(localCatalogForm, {
    name: '', name_i18n: {}, brand: '', note: '', barcode: '', default_unit: 'g', serving_size_g: null,
    kcal_per_100g: null, carbs_per_100g: 0, fat_per_100g: 0, protein_per_100g: 0,
    sugars_per_100g: null, fiber_per_100g: null, salt_per_100g: null, optional_nutrients: {},
    description: '', total_weight_g: null, extra_kcal: 0, servings_count: null,
    code: '', activity_type: 'custom', met: 0, kcal_per_min: null, inactive: false,
  });
  localRecipeItems.value = [];
}

function openLocalCatalogEditor(kind: LocalEditorKind, item?: Food | Ingredient | Recipe | ActivityDefinition, options: { duplicate?: boolean } = {}) {
  catalogMenuOpen.value = false;
  const duplicate = options.duplicate === true;
  localEditorKind.value = kind;
  localEditorId.value = duplicate ? null : item?.id ? String(item.id).replace(/^ingredient:/, '').replace(/^recipe:/, '') : null;
  localEditorDuplicate.value = duplicate;
  resetLocalCatalogForm();
  if (kind === 'ingredient' || kind === 'food') {
    const entry = item as Food | Ingredient | undefined;
    Object.assign(localCatalogForm, {
      name: entry?.name ?? '',
      name_i18n: { ...(entry?.name_i18n ?? {}) },
      brand: kind === 'food' ? ((entry as Food | undefined)?.brand ?? '') : '',
      note: entry?.note ?? '',
      barcode: kind === 'food' ? ((entry as Food | undefined)?.barcode ?? '') : '',
      default_unit: entry?.default_unit || 'g',
      serving_size_g: entry?.serving_size_g ?? null,
      kcal_per_100g: entry?.kcal_per_100g ?? null,
      carbs_per_100g: entry?.carbs_per_100g ?? 0,
      fat_per_100g: entry?.fat_per_100g ?? 0,
      protein_per_100g: entry?.protein_per_100g ?? 0,
      sugars_per_100g: entry?.sugars_per_100g ?? null,
      fiber_per_100g: entry?.fiber_per_100g ?? null,
      salt_per_100g: entry?.salt_per_100g ?? null,
      optional_nutrients: { ...(entry?.optional_nutrients ?? {}) },
      inactive: duplicate ? false : entry?.inactive === true,
    });
  } else if (kind === 'recipe') {
    const recipe = item as Recipe | undefined;
    Object.assign(localCatalogForm, {
      name: recipe?.name ?? '',
      name_i18n: { ...(recipe?.name_i18n ?? {}) },
      description: recipe?.description ?? '',
      note: recipe?.note ?? '',
      total_weight_g: null,
      extra_kcal: recipe?.extra_kcal ?? 0,
      servings_count: recipe?.servings_count ?? null,
      inactive: duplicate ? false : recipe?.inactive === true,
    });
    localRecipeItems.value = recipe
      ? state.recipeItems.filter((entry) => entry.recipe_id === recipe.id && !entry.deleted_at).map((entry) => createLocalRecipeDraftItem(entry.food_id, Number(entry.amount_g || 0)))
      : [];
    if (!localRecipeItems.value.length) localRecipeItems.value = [createLocalRecipeDraftItem()];
    // Recipe finished weight is calculated from the current ingredient grams.
  } else {
    const activity = item as ActivityDefinition | undefined;
    Object.assign(localCatalogForm, {
      name: activity?.name ?? '',
      name_i18n: { ...(activity?.name_i18n ?? {}) },
      code: activity?.code ?? '',
      description: activity?.description ?? '',
      activity_type: activity?.activity_type || activity?.type || 'custom',
      met: activity?.met ?? 0,
      kcal_per_min: activity?.kcal_per_min ?? null,
      inactive: duplicate ? false : activity?.inactive === true,
    });
  }
  localEditorOpen.value = true;
  nextTick(() => scrollFocusedInputIntoView());
}



function createLocalRecipeDraftItem(foodId = '', amountG = 0): LocalRecipeDraftItem {
  const item = foodId ? localRecipeCatalogOptions.value.find((entry) => entry.id === foodId) : undefined;
  return {
    food_id: foodId,
    amount_g: Number.isFinite(amountG) ? amountG : 0,
    unit: 'g',
    query: item ? itemTitle(item) : '',
    pickerOpen: !foodId,
  };
}

function localRecipeRowItem(row: LocalRecipeDraftItem): Food | undefined {
  return row.food_id ? localRecipeCatalogOptions.value.find((entry) => entry.id === row.food_id) : undefined;
}

function localRecipeRowResults(row: LocalRecipeDraftItem): Food[] {
  const q = row.query.trim();
  const selected = localRecipeRowItem(row);
  const usedIds = new Set(localRecipeItems.value.filter((entry) => entry !== row).map((entry) => entry.food_id).filter(Boolean));
  const matches: Array<{ item: Food; score: number; exact: boolean }> = [];
  const source = localRecipeCatalogOptions.value.filter((item) => !usedIds.has(item.id));

  if (q) {
    for (const item of source) {
      const match = rankCatalogItem(item, q, catalogSearchScope.value);
      if (match) matches.push(match);
    }
    return matches.sort(sortCatalogMatches).map((match) => match.item).slice(0, 12);
  }

  return selectedFirst(source).filter((item) => item.id !== selected?.id).slice(0, 12);
}

function chooseLocalRecipeItem(row: LocalRecipeDraftItem, item: Food) {
  row.food_id = item.id;
  row.query = itemTitle(item);
  row.pickerOpen = false;
  if (!row.amount_g || row.amount_g <= 0) row.amount_g = Number(item.serving_size_g || 0) > 0 ? Number(item.serving_size_g) : 100;
  row.unit = Number(item.serving_size_g || 0) > 0 ? 'serving' : 'g';
}

function openLocalRecipeRowPicker(row: LocalRecipeDraftItem) {
  const item = localRecipeRowItem(row);
  row.query = item ? itemTitle(item) : row.query;
  row.pickerOpen = true;
}

function localRecipeInputValue(row: LocalRecipeDraftItem) {
  const item = localRecipeRowItem(row);
  const serving = Number(item?.serving_size_g || 0);
  if (row.unit === 'serving' && serving > 0) return Math.round((Number(row.amount_g || 0) / serving) * 100) / 100;
  return Number(row.amount_g || 0) || null;
}

function updateLocalRecipeRowAmount(row: LocalRecipeDraftItem, event: Event) {
  const value = Number((event.target as HTMLInputElement | null)?.value ?? 0);
  if (!Number.isFinite(value)) return;
  const item = localRecipeRowItem(row);
  const serving = Number(item?.serving_size_g || 0);
  row.amount_g = row.unit === 'serving' && serving > 0 ? Math.max(0, Math.round(value * serving * 10) / 10) : Math.max(0, value);
}

function setLocalRecipeRowUnit(row: LocalRecipeDraftItem, unit: 'g' | 'serving') {
  const item = localRecipeRowItem(row);
  if (unit === 'serving' && !Number(item?.serving_size_g || 0)) return;
  row.unit = unit;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function roundMaybe(value: number) {
  return Number.isFinite(value) ? roundOne(value) : 0;
}

function localRecipeRowNutrition(row: LocalRecipeDraftItem) {
  const item = localRecipeRowItem(row);
  const amount = Math.max(0, Number(row.amount_g || 0));
  if (!item || amount <= 0) return { weight: 0, kcal: 0, carbs: 0, fat: 0, protein: 0 };
  return {
    weight: roundOne(amount),
    kcal: Math.round(Number(item.kcal_per_100g || 0) * amount / 100),
    carbs: roundMaybe(Number(item.carbs_per_100g || 0) * amount / 100),
    fat: roundMaybe(Number(item.fat_per_100g || 0) * amount / 100),
    protein: roundMaybe(Number(item.protein_per_100g || 0) * amount / 100),
  };
}

function localRecipeRowHint(row: LocalRecipeDraftItem) {
  const item = localRecipeRowItem(row);
  if (!item) return 'Search and select an item first.';
  const nutrition = localRecipeRowNutrition(row);
  const serving = Number(item.serving_size_g || 0);
  if (row.unit === 'serving' && serving > 0) return `${nutrition.weight} g · ${nutrition.kcal} kcal`;
  const qty = servingQtyForAmount(Number(row.amount_g || 0), item);
  return `${nutrition.kcal} kcal${qty ? ` · kb. ${qty} db` : ''}`;
}

const localRecipeNutritionPreview = computed(() => {
  let weight = 0;
  let kcal = 0;
  let carbs = 0;
  let fat = 0;
  let protein = 0;
  let sugars = 0;
  let fiber = 0;
  let salt = 0;
  let hasSugars = false;
  let hasFiber = false;
  let hasSalt = false;
  const optionalNutrients: Record<string, number> = {};
  for (const row of localRecipeItems.value) {
    const item = localRecipeRowItem(row);
    const amount = Math.max(0, Number(row.amount_g || 0));
    if (!item || amount <= 0) continue;
    weight += amount;
    kcal += Number(item.kcal_per_100g || 0) * amount / 100;
    carbs += Number(item.carbs_per_100g || 0) * amount / 100;
    fat += Number(item.fat_per_100g || 0) * amount / 100;
    protein += Number(item.protein_per_100g || 0) * amount / 100;
    const sugarValue = nullableNonNegativeNumber(item.sugars_per_100g);
    if (sugarValue !== null) {
      sugars += sugarValue * amount / 100;
      hasSugars = true;
    }
    const fiberValue = nullableNonNegativeNumber(item.fiber_per_100g);
    if (fiberValue !== null) {
      fiber += fiberValue * amount / 100;
      hasFiber = true;
    }
    const saltValue = nullableNonNegativeNumber(item.salt_per_100g);
    if (saltValue !== null) {
      salt += saltValue * amount / 100;
      hasSalt = true;
    }
    for (const [key, rawValue] of Object.entries(item.optional_nutrients || {})) {
      const value = Number(rawValue || 0);
      if (Number.isFinite(value)) optionalNutrients[key] = (optionalNutrients[key] || 0) + value * amount / 100;
    }
  }
  const extraKcal = Number(localCatalogForm.extra_kcal || 0);
  const finalWeight = weight;
  kcal += Number.isFinite(extraKcal) ? extraKcal : 0;
  const servingsCount = Number(localCatalogForm.servings_count || 0) > 0 ? Number(localCatalogForm.servings_count) : null;
  const servingWeight = servingsCount && finalWeight > 0 ? finalWeight / servingsCount : null;
  const ratio = finalWeight > 0 ? 100 / finalWeight : 0;
  return {
    weight: roundOne(weight),
    finalWeight: roundOne(finalWeight),
    servingWeight: servingWeight ? roundOne(servingWeight) : null,
    kcal: Math.round(kcal),
    extraKcal: Math.round(Number.isFinite(extraKcal) ? extraKcal : 0),
    carbs: roundOne(carbs),
    fat: roundOne(fat),
    protein: roundOne(protein),
    kcalPer100g: Math.round(kcal * ratio),
    carbsPer100g: roundOne(carbs * ratio),
    fatPer100g: roundOne(fat * ratio),
    proteinPer100g: roundOne(protein * ratio),
    sugarsPer100g: hasSugars ? roundOne(sugars * ratio) : null,
    fiberPer100g: hasFiber ? roundOne(fiber * ratio) : null,
    saltPer100g: hasSalt ? roundOne(salt * ratio) : null,
    optionalNutrients: Object.fromEntries(Object.entries(optionalNutrients).map(([key, value]) => [key, roundOne(value * ratio)])),
  };
});


function addLocalRecipeItem() {
  localRecipeItems.value.push(createLocalRecipeDraftItem());
}

function removeLocalRecipeItem(index: number) {
  localRecipeItems.value.splice(index, 1);
  if (!localRecipeItems.value.length) addLocalRecipeItem();
}

function localRecipeItemLabel(foodId: string): string {
  const item = localRecipeCatalogOptions.value.find((entry) => entry.id === foodId);
  if (!item) return foodId || 'Select item';
  if (item.id.startsWith('recipe:')) return `${t('recipe')} · ${localizedName(item)}`;
  if (item.id.startsWith('ingredient:')) return `${t('ingredient')} · ${localizedName(item)}`;
  return `${t('food')} · ${localizedName(item)}${item.brand ? ` · ${item.brand}` : ''}`;
}

function requestCloseLocalEditor(confirmDirty: boolean | Event = true) {
  const shouldConfirm = typeof confirmDirty === 'boolean' ? confirmDirty : true;
  if (!shouldConfirm || confirmDiscardDirty(hasLocalEditorDraft())) {
    localEditorOpen.value = false;
    localEditorDuplicate.value = false;
  }
}

function saveLocalCatalogEditor() {
  const name = localCatalogForm.name.trim();
  if (!name) return showToast('Name is required.');
  const now = Date.now();
  const id = localEditorId.value || generateId(`${localEditorKind.value}-local`);
  const catalogMeta = {
    catalog_source_kind: 'custom' as const,
    source_label: 'Custom',
    source_url: null,
    source_checked_at: null,
    locked: false,
    inactive: localCatalogForm.inactive === true,
  };
  if (localEditorKind.value === 'ingredient') {
    const ingredient: Ingredient = {
      id, source_id: state.pairing.sourceId, name,
      ...catalogMeta,
      name_i18n: { ...ensureLocalNameI18n() },
      note: localCatalogForm.note.trim() || null,
      default_unit: localCatalogForm.default_unit || 'g',
      serving_size_g: Number(localCatalogForm.serving_size_g || 0) > 0 ? Number(localCatalogForm.serving_size_g) : null,
      kcal_per_100g: Number(localCatalogForm.kcal_per_100g || 0),
      carbs_per_100g: Number(localCatalogForm.carbs_per_100g || 0),
      fat_per_100g: Number(localCatalogForm.fat_per_100g || 0),
      protein_per_100g: Number(localCatalogForm.protein_per_100g || 0),
      sugars_per_100g: nullableNonNegativeNumber(localCatalogForm.sugars_per_100g),
      fiber_per_100g: nullableNonNegativeNumber(localCatalogForm.fiber_per_100g),
      salt_per_100g: nullableNonNegativeNumber(localCatalogForm.salt_per_100g),
      optional_nutrients: { ...localCatalogForm.optional_nutrients },
      updated_at: now, deleted_at: null, pending_sync: true,
    };
    state.ingredients = [...state.ingredients.filter((entry) => entry.id !== id), ingredient].sort((a, b) => localizedName(a).localeCompare(localizedName(b), currentLocale()));
  } else if (localEditorKind.value === 'food') {
    const food: Food = {
      id, source_id: state.pairing.sourceId, name,
      ...catalogMeta,
      name_i18n: { ...ensureLocalNameI18n() },
      brand: localCatalogForm.brand.trim() || null,
      catalog_kind: 'food',
      note: localCatalogForm.note.trim() || null,
      barcode: localCatalogForm.barcode.trim() || null,
      default_unit: localCatalogForm.default_unit || 'g',
      serving_size_g: Number(localCatalogForm.serving_size_g || 0) > 0 ? Number(localCatalogForm.serving_size_g) : null,
      kcal_per_100g: Number(localCatalogForm.kcal_per_100g || 0),
      carbs_per_100g: Number(localCatalogForm.carbs_per_100g || 0),
      fat_per_100g: Number(localCatalogForm.fat_per_100g || 0),
      protein_per_100g: Number(localCatalogForm.protein_per_100g || 0),
      sugars_per_100g: nullableNonNegativeNumber(localCatalogForm.sugars_per_100g),
      fiber_per_100g: nullableNonNegativeNumber(localCatalogForm.fiber_per_100g),
      salt_per_100g: nullableNonNegativeNumber(localCatalogForm.salt_per_100g),
      optional_nutrients: { ...localCatalogForm.optional_nutrients },
      updated_at: now, deleted_at: null, pending_sync: true,
    };
    state.foods = [...state.foods.filter((entry) => entry.id !== id), food].sort((a, b) => localizedName(a).localeCompare(localizedName(b), currentLocale()));
  } else if (localEditorKind.value === 'recipe') {
    const recipe: Recipe = {
      id, source_id: state.pairing.sourceId, name,
      ...catalogMeta,
      name_i18n: { ...ensureLocalNameI18n() },
      description: localCatalogForm.description.trim() || null,
      note: localCatalogForm.note.trim() || null,
      total_weight_g: null,
      extra_kcal: Number(localCatalogForm.extra_kcal || 0),
      servings_count: Number(localCatalogForm.servings_count || 0) > 0 ? Number(localCatalogForm.servings_count) : null,
      updated_at: now, deleted_at: null, pending_sync: true,
    };
    state.recipes = [...state.recipes.filter((entry) => entry.id !== id), recipe].sort((a, b) => localizedName(a).localeCompare(localizedName(b), currentLocale()));
    const previousItems = state.recipeItems.filter((entry) => entry.recipe_id === id);
    const nextItems: RecipeItem[] = localRecipeItems.value
      .filter((entry) => entry.food_id && Number(entry.amount_g || 0) > 0)
      .map((entry, index) => ({
        id: previousItems[index]?.id || generateId('recipe-item-local'),
        recipe_id: id,
        food_id: entry.food_id,
        amount_g: Number(entry.amount_g || 0),
        updated_at: now,
        deleted_at: null,
        pending_sync: true,
      }));
    const deletedItems: RecipeItem[] = previousItems.slice(nextItems.length).map((entry) => ({ ...entry, deleted_at: now, updated_at: now, pending_sync: true }));
    state.recipeItems = [...state.recipeItems.filter((entry) => entry.recipe_id !== id), ...nextItems, ...deletedItems];
  } else {
    const activity: ActivityDefinition = {
      id, source_id: state.pairing.sourceId,
      ...catalogMeta,
      code: localCatalogForm.code.trim() || id,
      name,
      name_i18n: { ...ensureLocalNameI18n() },
      description: localCatalogForm.description.trim() || null,
      type: localCatalogForm.activity_type || 'custom',
      activity_type: localCatalogForm.activity_type || 'custom',
      met: Number(localCatalogForm.met || 0),
      kcal_per_min: Number(localCatalogForm.kcal_per_min || 0),
      updated_at: now, deleted_at: null, pending_sync: true,
    };
    state.activities = [...state.activities.filter((entry) => entry.id !== id), activity].sort((a, b) => localizedName(a).localeCompare(localizedName(b), currentLocale()));
  }
  localEditorOpen.value = false;
  localEditorDuplicate.value = false;
  showToast(t('localItemCreated'));
}

function editCatalogItem(item: Food) {
  if (catalogItemIsLocked(item)) {
    showToast(t('lockedCatalogDuplicateHint'));
    duplicateCatalogItem(item);
    return;
  }
  if (item.id.startsWith('recipe:')) {
    const recipe = state.recipes.find((entry) => `recipe:${entry.id}` === item.id || entry.id === item.id.replace(/^recipe:/, ''));
    if (recipe) openLocalCatalogEditor('recipe', recipe);
    return;
  }
  if (item.id.startsWith('ingredient:')) {
    const ingredient = state.ingredients.find((entry) => `ingredient:${entry.id}` === item.id || entry.id === item.id.replace(/^ingredient:/, ''));
    if (ingredient) openLocalCatalogEditor('ingredient', ingredient);
    return;
  }
  const food = state.foods.find((entry) => entry.id === item.id);
  if (food) openLocalCatalogEditor('food', food);
}

function duplicateName(name: string) {
  return `${name} (${t('copy')})`;
}

function catalogDuplicateDraft<T extends { name: string; name_i18n?: LocalizedNameMap | null }>(item: T): T {
  return {
    ...item,
    name: duplicateName(localizedName(item) || item.name),
    name_i18n: {},
  };
}

function duplicateCatalogItem(item: Food) {
  if (item.id.startsWith('recipe:')) {
    const recipe = state.recipes.find((entry) => `recipe:${entry.id}` === item.id || entry.id === item.id.replace(/^recipe:/, ''));
    if (recipe) openLocalCatalogEditor('recipe', catalogDuplicateDraft(recipe), { duplicate: true });
    return;
  }
  if (item.id.startsWith('ingredient:')) {
    const ingredient = state.ingredients.find((entry) => `ingredient:${entry.id}` === item.id || entry.id === item.id.replace(/^ingredient:/, ''));
    if (ingredient) openLocalCatalogEditor('ingredient', catalogDuplicateDraft(ingredient), { duplicate: true });
    return;
  }
  const food = state.foods.find((entry) => entry.id === item.id);
  if (food) openLocalCatalogEditor('food', catalogDuplicateDraft(food), { duplicate: true });
}

function editActivityCatalogItem(activity: ActivityDefinition) {
  if (catalogItemIsLocked(activity)) {
    showToast(t('lockedCatalogDuplicateHint'));
    duplicateActivityCatalogItem(activity);
    return;
  }
  openLocalCatalogEditor('activity', activity);
}

function duplicateActivityCatalogItem(activity: ActivityDefinition) {
  openLocalCatalogEditor('activity', catalogDuplicateDraft(activity), { duplicate: true });
}

function resetMealNoteForm() {
  noteTitle.value = '';
  noteDescription.value = '';
  noteKcal.value = null;
}

function startCatalogMealEntry() {
  mealEntryMode.value = 'catalog';
  resetMealNoteForm();
  if (!selectedCatalog.value) catalogPickerOpen.value = true;
}

function startNoteMealEntry() {
  mealEntryMode.value = 'note';
  catalogPickerOpen.value = false;
  recipeCustomizeOpen.value = false;
  selectedCatalogId.value = '';
  recipeIngredientAmounts.value = {};
  recipeCustomExtraKcal.value = 0;
  foodAmount.value = null;
  search.value = '';
  nextTick(() => scrollFocusedInputIntoView());
}

function useMealNoteSuggestion(note: MealNoteSuggestion) {
  mealEntryMode.value = 'note';
  catalogPickerOpen.value = false;
  recipeCustomizeOpen.value = false;
  selectedCatalogId.value = '';
  recipeIngredientAmounts.value = {};
  recipeCustomExtraKcal.value = 0;
  foodAmount.value = null;
  noteTitle.value = note.title;
  noteDescription.value = note.description;
  noteKcal.value = note.kcal;
  search.value = '';
  void nextTick(() => scrollFocusedInputIntoView());
}

function openNoteConversion(entry: Intake) {
  const key = dateKey(new Date(entry.consumed_at));
  selectedDate.value = key;
  calendarMonth.value = new Date(dayStartMs(key));
  activeTab.value = 'diary';
  unlockedDiaryDate.value = key;
  editingIntakeId.value = entry.id;
  addMode.value = 'food';
  addMealType.value = entry.meal_type;
  mealEntryMode.value = 'catalog';
  selectedCatalogId.value = '';
  catalogPickerOpen.value = true;
  recipeCustomizeOpen.value = false;
  recipeIngredientAmounts.value = {};
  recipeCustomExtraKcal.value = 0;
  foodUnit.value = 'g';
  foodAmount.value = 100;
  search.value = String(entry.note_title || itemTitle(foodFromIntake(entry)) || '').trim();
  entryActionSheet.value = null;
  void nextTick(() => scrollFocusedInputIntoView());
}

function addMealNoteFromForm() {
  const title = noteTitle.value.trim();
  if (!title) return showToast(t('kcalNoteTitle'));
  const kcal = Number(noteKcal.value || 0);
  if (!kcal || kcal <= 0) return showToast(t('amountGreaterThanZero'));
  const description = noteDescription.value.trim();
  const now = Date.now();
  const existingNote = editingIntakeId.value ? state.intakes.find((entry) => entry.id === editingIntakeId.value) : null;
  const noteId = existingNote?.food_id || editingIntakeId.value || generateId('note');
  const snapshot: Food = {
    id: noteId,
    source_id: state.pairing.sourceId,
    name: title,
    brand: t('addKcalNote'),
    note: description || null,
    default_unit: 'g',
    serving_size_g: null,
    kcal_per_100g: kcal,
    carbs_per_100g: 0,
    fat_per_100g: 0,
    protein_per_100g: 0,
    sugars_per_100g: null,
    fiber_per_100g: null,
    salt_per_100g: null,
    optional_nutrients: {},
    updated_at: now,
  };
  const payload = {
    source_id: state.pairing.sourceId,
    item_type: 'note' as const,
    food_id: noteId,
    consumed_at: timestampForActiveLogDay(now),
    meal_type: addMealType.value,
    amount_g: 100,
    unit: 'g' as const,
    serving_qty: null,
    food_snapshot_json: foodSnapshot(snapshot),
    note_title: title,
    note_description: description || null,
    note_final: false,
    pending_sync: false,
    updated_at: now,
  };
  if (editingIntakeId.value) {
    state.intakes = state.intakes.map((entry) => entry.id === editingIntakeId.value ? { ...entry, ...payload, note_final: false } : entry);
  } else {
    state.intakes.push({ id: noteId, created_at: now, ...payload });
  }
  closeSheet();
  showToast(t('localItemCreated'));
}

function editSelectedDayWeight() {
  if (!ensureSelectedDayEditing()) return;
  weightInput.value = currentDayWeightKg.value ? Number(currentDayWeightKg.value) : null;
  editingDayWeight.value = true;
  nextTick(() => scrollFocusedInputIntoView());
}

function openWeightReminderModal() {
  activeTab.value = 'home';
  weightInput.value = currentDayWeightKg.value ? Number(currentDayWeightKg.value) : null;
  editingDayWeight.value = false;
  weightReminderModalOpen.value = true;
  nextTick(() => scrollFocusedInputIntoView());
}

function closeWeightReminderModal() {
  weightReminderModalOpen.value = false;
  weightInput.value = null;
}

function saveWeightReminderModal() {
  recordWeight('mobile_prompt');
}

function inSelectedDay(ms: number) {
  return ms >= dayStartMs(activeLogDateKey.value) && ms < dayEndMs(activeLogDateKey.value);
}

function timestampForLogDay(key: string, now = Date.now()) {
  refreshTodayKey();
  const todayStart = dayStartMs(todayKey.value);
  const todayEnd = dayEndMs(todayKey.value);
  const offset = Math.min(Math.max(0, now - todayStart), Math.max(0, todayEnd - todayStart - 1));
  return dayStartMs(key) + offset;
}

function timestampForActiveLogDay(now = Date.now()) {
  return timestampForLogDay(activeLogDateKey.value, now);
}

function clamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function ringOffset(progress: number) {
  return macroRing * (1 - clamp(progress));
}

function showToast(message: string) {
  toast.value = message;
  window.setTimeout(() => {
    if (toast.value === message) toast.value = '';
  }, 4200);
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(currentLocale(), { month: 'short', day: '2-digit' }).format(new Date(value));
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat(currentLocale(), { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function updateReleaseTitle(result = updateCheckResult.value): string {
  if (!result?.release) return t('appUpdates');
  return `${t('updateAvailable')} ${result.release.version}`;
}

function updateReleaseBody(result = updateCheckResult.value): string {
  if (!result?.release) return t('latestInstalled');
  return `${t('updateAvailableBody')} ${t('version')} ${appVersion} → ${result.release.version}.`;
}

function updateReleaseAssetLabel(result = updateCheckResult.value): string {
  return result?.release?.assetName ? result.release.assetName : '';
}

function updateRemindLaterActive(result: UpdateCheckResult): boolean {
  if (!result.release) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(updateRemindLaterKey) || '{}') as { tag?: string; until?: number };
    return saved.tag === result.release.tag && Number(saved.until || 0) > Date.now();
  } catch {
    return false;
  }
}

function detectUpdateTarget() {
  if (isAndroidRuntime()) return 'android' as const;
  if (isIosRuntime()) return 'ios' as const;
  return 'mobile' as const;
}

async function checkForAppUpdates(options: { quiet?: boolean; manual?: boolean; ignoreRemindLater?: boolean } = {}) {
  if (updateBusy.value) return;
  updateBusy.value = true;
  try {
    const result = await checkNutrinoUpdates(appVersion, {
      includePrereleases: state.settings.check_prerelease_updates === true,
      target: detectUpdateTarget(),
    });
    updateCheckResult.value = result;
    if (result.status === 'available' && (options.ignoreRemindLater || options.manual || !updateRemindLaterActive(result))) {
      updateDialogOpen.value = true;
      return;
    }
    if (options.manual && !options.quiet) showToast(t('latestInstalled'));
  } catch (error) {
    if (!options.quiet || options.manual) showToast(`${t('updateCheckFailed')}: ${String(error)}`);
  } finally {
    updateBusy.value = false;
  }
}

async function openExternalUrl(url?: string) {
  const target = String(url || '').trim();
  if (!target) return;
  try {
    await openUrl(target);
  } catch {
    const opened = window.open(target, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = target;
  }
}

async function installAvailableUpdate() {
  const release = updateCheckResult.value?.release;
  if (!release || updateBusy.value) return;
  const url = release.downloadUrl || release.url;
  updateBusy.value = true;
  try {
    const androidInstaller = (window as any).NutrinoAndroidInstaller;
    if (isAndroidRuntime() && typeof androidInstaller?.installUpdateApk === 'function' && /\.apk(?:$|[?#])/i.test(url)) {
      androidInstaller.installUpdateApk(url, release.assetName || `nutrino-${release.version}.apk`);
      return;
    }
    await openExternalUrl(url);
    updateDialogOpen.value = false;
    showToast(t(isAndroidRuntime() ? 'androidUpdateInstallerStarted' : 'updateInstallerStarted'));
  } catch (error) {
    showToast(`${t('updateInstallerFailed')}: ${String(error)}`);
  } finally {
    updateBusy.value = false;
  }
}

function remindUpdateLater() {
  const release = updateCheckResult.value?.release;
  if (release) {
    localStorage.setItem(updateRemindLaterKey, JSON.stringify({
      tag: release.tag,
      until: Date.now() + 24 * 60 * 60 * 1000,
    }));
  }
  updateDialogOpen.value = false;
  showToast(t('remindLaterSaved'));
}

function openUpdateCenter() {
  if (updateAvailable.value) {
    updateDialogOpen.value = true;
    return;
  }
  void checkForAppUpdates({ manual: true, ignoreRemindLater: true });
}

function handleAndroidUpdateInstallerEvent(event: Event) {
  const detail = (event as CustomEvent<{ status?: string; error?: string }>).detail || {};
  if (detail.status === 'permission-required') {
    updateBusy.value = false;
    updateDialogOpen.value = true;
    showToast(t('androidInstallPermissionRequired'));
    return;
  }
  if (detail.status === 'started') {
    updateBusy.value = false;
    updateDialogOpen.value = false;
    showToast(t('androidUpdateInstallerStarted'));
    return;
  }
  if (detail.status === 'error') {
    updateBusy.value = false;
    updateDialogOpen.value = true;
    showToast(`${t('updateInstallerFailed')}: ${detail.error || ''}`.trim());
  }
}

function compareVersionStrings(left: string, right: string): number {
  const a = String(left || '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const b = String(right || '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const av = Number.isFinite(a[index]) ? a[index] : 0;
    const bv = Number.isFinite(b[index]) ? b[index] : 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function isServerNewerThanMobile(serverVersion?: string | null): boolean {
  const normalized = String(serverVersion || '').trim();
  return Boolean(normalized) && compareVersionStrings(normalized, appVersion) > 0;
}

function isServerOlderThanMobile(serverVersion?: string | null): boolean {
  const normalized = String(serverVersion || '').trim();
  return Boolean(normalized) && compareVersionStrings(normalized, appVersion) < 0;
}

function serverVersionMismatchMessage(serverVersion: string): string {
  if (isServerNewerThanMobile(serverVersion)) return `${t('desktopServerNewer')} ${serverVersion} / ${appVersion}`;
  if (isServerOlderThanMobile(serverVersion)) return `${t('desktopServerOlder')} ${serverVersion} / ${appVersion}`;
  return t('serverVersionMismatch');
}

async function ensureServerVersionSyncAllowed(existingHealth?: { version?: string }): Promise<{ allowed: boolean; message?: string }> {
  const health = existingHealth ?? await checkServerHealth(state.pairing.baseUrl, authPassword());
  const serverVersion = String(health.version || '').trim();
  if (!serverVersion || compareVersionStrings(serverVersion, appVersion) === 0) return { allowed: true };

  if (isServerNewerThanMobile(serverVersion)) {
    void checkForAppUpdates({ quiet: true, ignoreRemindLater: true });
  } else if (isServerOlderThanMobile(serverVersion)) {
    try {
      await requestDesktopUpdateCheck(state.pairing.baseUrl, authPassword(), 'mobile-newer');
    } catch {
      // The sync gate still blocks; failing to notify the desktop should not mask
      // the clearer version mismatch message.
    }
  }

  return { allowed: false, message: serverVersionMismatchMessage(serverVersion) };
}


function formatMonth(date: Date) {
  return new Intl.DateTimeFormat(currentLocale(), { month: 'long', year: 'numeric' }).format(date);
}

function itemTitle(food?: Food) {
  if (!food) return 'Unknown item';
  const name = localizedName(food);
  return food.brand ? `${name} · ${food.brand}` : name;
}

function foodFromIntake(intake: Intake): Food | undefined {
  try {
    const snapshot = JSON.parse(intake.food_snapshot_json) as Food;
    if (snapshot && snapshot.name) return snapshot;
  } catch {}
  return findCatalogItem(state, intake.food_id);
}

function intakeKcal(intake: Intake) {
  const food = foodFromIntake(intake);
  return food ? calculateKcal(food, intake.amount_g) : 0;
}

function servingQtyForAmount(amountG: number, food?: Food) {
  const serving = Number(food?.serving_size_g || 0);
  if (!serving || !Number.isFinite(amountG)) return null;
  const qty = amountG / serving;
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return Math.round(qty * 100) / 100;
}

function amountLabel(amountG: number, food?: Food) {
  const rounded = Math.round(amountG * 10) / 10;
  const qty = servingQtyForAmount(amountG, food);
  return qty ? `${rounded} g (${qty} db)` : `${rounded} g`;
}

const selectedCatalogAmountHint = computed(() => {
  const selected = selectedCatalog.value;
  const item = selected?.id.startsWith('recipe:') ? buildCustomRecipeSnapshot(selected) : selected;
  const amount = Number(foodAmount.value || 0);
  if (!item || !amount || amount <= 0) return '';
  const serving = Number(item.serving_size_g || 0);
  if (!serving) return '';
  if (foodUnit.value === 'serving') {
    const grams = Math.round(amount * serving * 10) / 10;
    return `kb. ${grams} g`;
  }
  const qty = servingQtyForAmount(amount, item);
  return qty ? `kb. ${qty} db` : '';
});

const selectedRecipeCustomPreview = computed(() => {
  if (!selectedCatalogIsRecipe.value) return null;
  const totals = calculateCustomRecipeTotals(selectedCatalogId.value);
  if (!totals || totals.recipeWeight <= 0) return null;
  return {
    ingredientWeight: Math.round(totals.ingredientWeight * 10) / 10,
    recipeWeight: Math.round(totals.recipeWeight * 10) / 10,
    servingWeight: totals.servingWeight ? Math.round(totals.servingWeight * 10) / 10 : null,
    kcal: Math.round(totals.kcal),
    extraKcal: Math.round(totals.extraKcal),
    carbs: roundOne(totals.carbs),
    fat: roundOne(totals.fat),
    protein: roundOne(totals.protein),
    kcalPer100g: Math.round(totals.kcal * 100 / totals.recipeWeight),
    carbsPer100g: roundOne(totals.carbs * 100 / totals.recipeWeight),
    fatPer100g: roundOne(totals.fat * 100 / totals.recipeWeight),
    proteinPer100g: roundOne(totals.protein * 100 / totals.recipeWeight),
  };
});

const selectedMealAmountPreview = computed(() => {
  let item = selectedCatalog.value;
  const rawAmount = Number(foodAmount.value || 0);
  if (!item || rawAmount <= 0) return null;
  item = item.id.startsWith('recipe:') ? buildCustomRecipeSnapshot(item) : item;
  const serving = Number(item.serving_size_g || 0);
  const amountG = foodUnit.value === 'serving' && serving > 0 ? rawAmount * serving : rawAmount;
  if (!Number.isFinite(amountG) || amountG <= 0) return null;
  return {
    amountG: Math.round(amountG * 10) / 10,
    kcal: calculateKcal(item, amountG),
    kcalPer100g: Math.round(Number(item.kcal_per_100g || 0)),
  };
});

function totalMacro(key: 'carbs_per_100g' | 'fat_per_100g' | 'protein_per_100g') {
  return currentDayIntakes.value.reduce((sum, intake) => {
    const food = foodFromIntake(intake);
    return sum + ((food?.[key] ?? 0) * intake.amount_g / 100);
  }, 0);
}

function entriesForSection(section: MealSection) {
  if (section.key === 'activity') return [];
  return currentDayIntakes.value.filter((entry) => entry.meal_type === section.key);
}

function activitiesForSection() {
  return currentDayActivities.value;
}

const mealNotesToReview = computed(() => state.intakes
  .filter((entry) => entry.item_type === 'note' && !entry.note_final)
  .sort((a, b) => b.consumed_at - a.consumed_at));

function mealNoteReviewSubtitle(entry: Intake) {
  const kcal = intakeKcal(entry);
  return `${formatDateTime(entry.consumed_at)} · ${Math.round(kcal)} kcal · ${entry.meal_type}`;
}

function openMealNoteDay(entry: Intake) {
  const key = dateKey(new Date(entry.consumed_at));
  selectedDate.value = key;
  calendarMonth.value = new Date(dayStartMs(key));
  unlockedDiaryDate.value = key;
  activeTab.value = 'diary';
  mealNoteReviewOpen.value = true;
  highlightedReviewIntakeId.value = entry.id;
  if (highlightedReviewTimer) window.clearTimeout(highlightedReviewTimer);
  highlightedReviewTimer = window.setTimeout(() => {
    if (highlightedReviewIntakeId.value === entry.id) highlightedReviewIntakeId.value = null;
  }, 6500);
  showToast(activeLanguage.value === 'hu' ? `${key} nap betöltve.` : `${key} loaded.`);
  void nextTick(() => {
    const target = document.getElementById(`intake-entry-${entry.id}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else scrollToPageTop();
  });
}

function keepMealNoteAsFinal(entry: Intake) {
  const now = Date.now();
  state.intakes = state.intakes.map((item) => item.id === entry.id ? { ...item, note_final: true, pending_sync: false, updated_at: now } : item);
}

function activityType(activity: ActivityDefinition) {
  return activity.type ?? activity.activity_type ?? 'custom';
}

function activityDisplayName(activity: ActivityDefinition) {
  const detail = activity.description?.trim();
  return detail ? `${activity.name} · ${detail}` : activity.name;
}

function chooseActivity(activity: ActivityDefinition) {
  const changed = activityId.value !== activity.id;
  activityId.value = activity.id;
  activitySource.value = 'activity_catalog';
  if (changed) {
    activityMinutes.value = null;
    activityKcal.value = null;
  }
  search.value = '';
  activityPickerOpen.value = false;
}

function clearSelectedActivityForChange() {
  activityPickerOpen.value = true;
  search.value = '';
}

function recipeIdFromCatalogId(id: string) {
  return id.startsWith('recipe:') ? id.slice('recipe:'.length) : '';
}

function recipeComponentRows(catalogId: string) {
  const recipeId = recipeIdFromCatalogId(catalogId);
  if (!recipeId) return [];
  return state.recipeItems
    .filter((item) => item.recipe_id === recipeId && !item.deleted_at)
    .map((item) => {
      const food = findCatalogItem(state, item.food_id);
      const key = item.id || `${item.recipe_id}:${item.food_id}`;
      const current = Number(recipeIngredientAmounts.value[key] ?? item.amount_g);
      return {
        key,
        item,
        food,
        name: food?.name ?? item.food_id,
        brand: food?.brand ?? '',
        baseAmount: Number(item.amount_g || 0),
        amount: Number.isFinite(current) ? current : Number(item.amount_g || 0),
        servingSize: Number(food?.serving_size_g || 0),
      };
    });
}

function initializeRecipeIngredientAmounts(catalogId: string, snapshot?: unknown) {
  const recipeId = recipeIdFromCatalogId(catalogId);
  recipeIngredientAmounts.value = {};
  if (!recipeId) return;

  const recipe = state.recipes.find((entry) => entry.id === recipeId && !entry.deleted_at);
  const restoredObject = snapshot && typeof snapshot === 'object' ? snapshot as { recipe_components?: Array<{ key?: string; food_id?: string; amount_g?: number }>; recipe_extra_kcal?: number; extra_kcal?: number } : undefined;
  recipeCustomExtraKcal.value = Number(restoredObject?.recipe_extra_kcal ?? restoredObject?.extra_kcal ?? recipe?.extra_kcal ?? 0);
  const restored = restoredObject?.recipe_components;
  const rows = state.recipeItems.filter((item) => item.recipe_id === recipeId && !item.deleted_at);
  const next: Record<string, number> = {};
  for (const item of rows) {
    const key = item.id || `${item.recipe_id}:${item.food_id}`;
    const fromSnapshot = restored?.find((component) => component.key === key || component.food_id === item.food_id);
    const amount = Number(fromSnapshot?.amount_g ?? item.amount_g ?? 0);
    next[key] = Number.isFinite(amount) ? amount : Number(item.amount_g || 0);
  }
  recipeIngredientAmounts.value = next;
}

function componentQty(row: { key: string; amount: number; servingSize: number }) {
  if (!row.servingSize) return '';
  return Math.round((Number(recipeIngredientAmounts.value[row.key] ?? row.amount) / row.servingSize) * 100) / 100;
}

function setComponentQty(row: { key: string; amount: number; servingSize: number }, event: Event) {
  const target = event.target as HTMLInputElement | null;
  const qty = Number(target?.value ?? 0);
  if (!row.servingSize || !Number.isFinite(qty)) return;
  recipeIngredientAmounts.value[row.key] = Math.max(0, Math.round(qty * row.servingSize * 10) / 10);
}

function recipeComponentNutrition(row: { key: string; amount: number; food?: Food | null }) {
  const item = row.food;
  const amount = Math.max(0, Number(recipeIngredientAmounts.value[row.key] ?? row.amount ?? 0));
  if (!item || amount <= 0) return { weight: 0, kcal: 0, carbs: 0, fat: 0, protein: 0 };
  return {
    weight: roundOne(amount),
    kcal: Math.round(Number(item.kcal_per_100g || 0) * amount / 100),
    carbs: roundMaybe(Number(item.carbs_per_100g || 0) * amount / 100),
    fat: roundMaybe(Number(item.fat_per_100g || 0) * amount / 100),
    protein: roundMaybe(Number(item.protein_per_100g || 0) * amount / 100),
  };
}

type CustomRecipeTotals = {
  ingredientWeight: number;
  recipeWeight: number;
  servingWeight: number | null;
  servingsCount: number | null;
  extraKcal: number;
  kcal: number;
  carbs: number;
  fat: number;
  protein: number;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
  optionalNutrients: Record<string, number>;
  components: Array<{ key: string; food_id: string; amount_g: number; base_amount_g: number }>;
};

function calculateCustomRecipeTotals(catalogId: string): CustomRecipeTotals | null {
  const recipeId = recipeIdFromCatalogId(catalogId);
  if (!recipeId) return null;
  const rows = recipeComponentRows(catalogId);
  const recipe = state.recipes.find((entry) => entry.id === recipeId && !entry.deleted_at);
  const extraKcal = Number(recipeCustomExtraKcal.value ?? recipe?.extra_kcal ?? 0);
  const servingsCount = Number(recipe?.servings_count || 0) > 0 ? Number(recipe?.servings_count) : null;

  let ingredientWeight = 0;
  let kcal = 0;
  let carbs = 0;
  let fat = 0;
  let protein = 0;
  let sugars = 0;
  let fiber = 0;
  let salt = 0;
  let hasSugars = false;
  let hasFiber = false;
  let hasSalt = false;
  const optionalNutrients: Record<string, number> = {};
  const components: Array<{ key: string; food_id: string; amount_g: number; base_amount_g: number }> = [];

  for (const row of rows) {
    const amount = Math.max(0, Number(recipeIngredientAmounts.value[row.key] ?? row.baseAmount ?? 0));
    if (!row.food || amount <= 0) continue;
    ingredientWeight += amount;
    kcal += Number(row.food.kcal_per_100g || 0) * amount / 100;
    carbs += Number(row.food.carbs_per_100g || 0) * amount / 100;
    fat += Number(row.food.fat_per_100g || 0) * amount / 100;
    protein += Number(row.food.protein_per_100g || 0) * amount / 100;
    const sugarValue = nullableNonNegativeNumber(row.food.sugars_per_100g);
    if (sugarValue !== null) {
      sugars += sugarValue * amount / 100;
      hasSugars = true;
    }
    const fiberValue = nullableNonNegativeNumber(row.food.fiber_per_100g);
    if (fiberValue !== null) {
      fiber += fiberValue * amount / 100;
      hasFiber = true;
    }
    const saltValue = nullableNonNegativeNumber(row.food.salt_per_100g);
    if (saltValue !== null) {
      salt += saltValue * amount / 100;
      hasSalt = true;
    }
    for (const [key, rawValue] of Object.entries(row.food.optional_nutrients || {})) {
      const value = Number(rawValue || 0);
      if (Number.isFinite(value)) optionalNutrients[key] = (optionalNutrients[key] || 0) + value * amount / 100;
    }
    components.push({ key: row.key, food_id: row.food.id, amount_g: amount, base_amount_g: row.baseAmount });
  }

  if (ingredientWeight <= 0) return null;
  const recipeWeight = Math.max(0, ingredientWeight);
  kcal += Number.isFinite(extraKcal) ? extraKcal : 0;
  return {
    ingredientWeight,
    recipeWeight,
    servingWeight: servingsCount && recipeWeight > 0 ? recipeWeight / servingsCount : null,
    servingsCount,
    extraKcal: Number.isFinite(extraKcal) ? extraKcal : 0,
    kcal,
    carbs,
    fat,
    protein,
    sugars: hasSugars ? sugars : null,
    fiber: hasFiber ? fiber : null,
    salt: hasSalt ? salt : null,
    optionalNutrients,
    components,
  };
}

function buildCustomRecipeSnapshot(base: Food): Food {
  const recipeId = recipeIdFromCatalogId(base.id);
  if (!recipeId) return base;
  const totals = calculateCustomRecipeTotals(base.id);
  if (!totals || totals.recipeWeight <= 0) return base;
  const ratio = 100 / totals.recipeWeight;
  return {
    ...base,
    brand: totals.components.some((component) => component.amount_g !== component.base_amount_g) ? 'Recipe · customized' : base.brand,
    serving_size_g: totals.servingWeight ?? base.serving_size_g ?? null,
    kcal_per_100g: totals.kcal * ratio,
    carbs_per_100g: totals.carbs * ratio,
    fat_per_100g: totals.fat * ratio,
    protein_per_100g: totals.protein * ratio,
    sugars_per_100g: totals.sugars === null ? null : totals.sugars * ratio,
    fiber_per_100g: totals.fiber === null ? null : totals.fiber * ratio,
    salt_per_100g: totals.salt === null ? null : totals.salt * ratio,
    optional_nutrients: Object.fromEntries(Object.entries(totals.optionalNutrients).map(([key, value]) => [key, value * ratio])),
    recipe_components: totals.components,
    recipe_extra_kcal: totals.extraKcal,
    recipe_ingredient_weight_g: totals.ingredientWeight,
    recipe_total_weight_g: totals.recipeWeight,
  } as Food;
}

function chooseCatalogItem(item: Food) {
  const changed = selectedCatalogId.value !== item.id;
  if (!changed) {
    catalogPickerOpen.value = false;
    search.value = '';
    return;
  }

  mealEntryMode.value = 'catalog';
  selectedCatalogId.value = item.id;
  initializeRecipeIngredientAmounts(item.id);
  recipeCustomizeOpen.value = false;
  foodUnit.value = item.serving_size_g ? 'serving' : 'g';
  foodAmount.value = item.serving_size_g ? 1 : null;
  search.value = '';
  catalogPickerOpen.value = false;
}

function openCatalogPickerForChange() {
  catalogPickerOpen.value = true;
  recipeCustomizeOpen.value = false;
  search.value = '';
}

function toggleRecipeCustomizer() {
  if (!selectedCatalogIsRecipe.value || !selectedRecipeComponents.value.length) return;
  recipeCustomizeOpen.value = !recipeCustomizeOpen.value;
  catalogPickerOpen.value = false;
}

function confirmRecipeCustomization(event?: Event) {
  hideKeyboard(event);
  recipeCustomizeOpen.value = false;
}

function clearSelectedCatalogForChange() {
  // Keep the previous selection visible under the Selected group while choosing a replacement.
  catalogPickerOpen.value = true;
  recipeCustomizeOpen.value = false;
  search.value = '';
}

function bmiStatus(value: number) {
  if (value < 18.5) return { key: 'under', name: 'Underweight', risk: 'Low risk', tone: 'bmi-under' };
  if (value < 25) return { key: 'normal', name: 'Normal weight', risk: 'Average risk', tone: 'bmi-normal' };
  if (value < 30) return { key: 'pre', name: 'Pre-obesity', risk: 'Increased risk', tone: 'bmi-pre' };
  if (value < 35) return { key: 'obese1', name: 'Obese class I', risk: 'Moderate risk', tone: 'bmi-obese-1' };
  if (value < 40) return { key: 'obese2', name: 'Obese class II', risk: 'Severe risk', tone: 'bmi-obese-2' };
  return { key: 'obese3', name: 'Obese class III', risk: 'Very severe risk', tone: 'bmi-obese-3' };
}

function kcalTone(kcal: number, effectiveGoal: number, fullGoal = effectiveGoal) {
  const effective = Math.max(1, effectiveGoal);
  const full = Math.max(effective, fullGoal, 1);
  const ratio = kcal / effective;
  if (kcal > full) return 'kcal-over';
  if (ratio <= 0.82) return 'kcal-low';
  if (ratio <= 1) return 'kcal-ok';
  if (kcal <= full) return 'kcal-warn';
  return 'kcal-over';
}

function dayIntakes(key: string) {
  return state.intakes.filter((entry) => dateKey(new Date(entry.consumed_at)) === key);
}

function dayActivities(key: string) {
  return state.activityLogs.filter((entry) => dateKey(new Date(entry.performed_at)) === key);
}

function profileForDay(key: string): AppState['profile'] {
  const weight = latestWeightForDay(state.weightLogs, key)?.weight_kg ?? state.profile.current_weight_kg;
  return { ...state.profile, current_weight_kg: weight };
}

function syncProfileWeightFromToday() {
  const todayWeight = latestWeightForDay(state.weightLogs, todayKey.value)?.weight_kg;
  if (todayWeight && Number.isFinite(todayWeight)) state.profile.current_weight_kg = todayWeight;
}

function dayFullKcalGoal(key: string) {
  const activities = dayActivities(key);
  const burned = Math.round(activities.reduce((sum, entry) => sum + entry.kcal, 0));
  return Math.max(1, dailyKcalGoal(profileForDay(key), burned) + Number(state.settings.kcal_adjustment || 0));
}

function dayEffectiveKcalGoal(key: string) {
  const activities = dayActivities(key);
  const burned = Math.round(activities.reduce((sum, entry) => sum + entry.kcal, 0));
  if (!calorieDeficitEnabled.value) return dayFullKcalGoal(key);
  const credited = Math.round(burned * Math.max(0, Math.min(1, Number(state.settings.exercise_kcal_eatback_percent ?? 50) / 100)));
  const deficit = Math.max(0, Math.round(Number(state.settings.target_deficit_kcal || 0)));
  return Math.max(0, dailyKcalGoal(profileForDay(key), 0) + Number(state.settings.kcal_adjustment || 0) + credited - deficit);
}

function dayMacroSummary(key: string) {
  const intakes = dayIntakes(key);
  const kcalGoal = dayFullKcalGoal(key);
  const macroKcalGoal = Math.max(1, calorieDeficitEnabled.value ? dayEffectiveKcalGoal(key) : kcalGoal);
  const summary = macroForEntries(intakes);
  return {
    kcal: summary.kcal,
    kcalGoal,
    effectiveKcalGoal: dayEffectiveKcalGoal(key),
    carbs: summary.carbs,
    carbsGoal: Math.max(1, Math.round((macroKcalGoal * (state.settings.macro_carbs_percent || 60) / 100) / 4)),
    fat: summary.fat,
    fatGoal: Math.max(1, Math.round((macroKcalGoal * (state.settings.macro_fat_percent || 25) / 100) / 9)),
    protein: summary.protein,
    proteinGoal: Math.max(1, Math.round((macroKcalGoal * (state.settings.macro_protein_percent || 15) / 100) / 4)),
  };
}

type DailyAnalysisRow = {
  key: string;
  label: string;
  consumedKcal: number;
  dailyLimitKcal: number;
  effectiveLimitKcal: number;
  deficitKcal: number;
  burnedKcal: number;
  creditedBurnedKcal: number;
  tracked: boolean;
  selected: boolean;
  success: boolean;
  tone: string;
};

type WeightTrendRow = {
  key: string;
  label: string;
  weightKg: number;
  entryCount: number;
  selected: boolean;
  limitedData: boolean;
};

function addDays(key: string, days: number): string {
  const date = new Date(dayStartMs(key));
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function buildCenteredDateKeys(centerKey: string, count: number, maxEndKey = todayKey.value): string[] {
  const safeCount = Math.max(1, count);
  const maxEndMs = dayStartMs(maxEndKey);
  const centerMs = Math.min(dayStartMs(centerKey), maxEndMs);
  const centerDateKey = dateKey(new Date(centerMs));
  const centerIndex = Math.floor((safeCount - 1) / 2);
  let startKey = addDays(centerDateKey, -centerIndex);
  let endKey = addDays(startKey, safeCount - 1);
  const overflow = Math.max(0, Math.round((dayStartMs(endKey) - maxEndMs) / 86400000));
  if (overflow > 0) {
    startKey = addDays(startKey, -overflow);
    endKey = addDays(endKey, -overflow);
  }

  return Array.from({ length: safeCount }, (_, index) => addDays(startKey, index));
}

function buildDailyAnalysis(key: string): DailyAnalysisRow {
  const intakes = dayIntakes(key);
  const activities = dayActivities(key);
  const consumed = macroForEntries(intakes).kcal;
  const burned = Math.round(activities.reduce((sum, entry) => sum + entry.kcal, 0));
  const credited = Math.round(burned * Math.max(0, Math.min(1, Number(state.settings.exercise_kcal_eatback_percent ?? 50) / 100)));
  const full = dayFullKcalGoal(key);
  const effective = dayEffectiveKcalGoal(key);
  const tracked = intakes.length > 0 || activities.length > 0;
  return {
    key,
    label: formatDate(dayStartMs(key)),
    consumedKcal: consumed,
    dailyLimitKcal: full,
    effectiveLimitKcal: effective,
    deficitKcal: Math.max(0, full - effective),
    burnedKcal: burned,
    creditedBurnedKcal: credited,
    tracked,
    selected: key === selectedDate.value,
    success: tracked && consumed <= effective,
    tone: kcalTone(consumed, effective, full),
  };
}

function buildDailyAnalysisRows(days: number, centerKey = selectedDate.value): DailyAnalysisRow[] {
  return buildCenteredDateKeys(centerKey, days).map((key) => buildDailyAnalysis(key));
}

function calculateDeficitStreak(endKey: string): number {
  let streak = 0;
  for (let offset = 0; offset < 365; offset += 1) {
    const row = buildDailyAnalysis(addDays(endKey, -offset));
    if (!row.success) break;
    streak += 1;
  }
  return streak;
}

function calculateBestDeficitStreak(days: number): number {
  let best = 0;
  let current = 0;
  for (const row of buildDailyAnalysisRows(days, selectedDate.value)) {
    if (row.success) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function mondayKeyFor(key: string): string {
  const date = new Date(dayStartMs(key));
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return dateKey(date);
}

function monthStartKeyFor(key: string): string {
  const date = new Date(dayStartMs(key));
  date.setDate(1);
  return dateKey(date);
}

function addMonths(key: string, months: number): string {
  const date = new Date(dayStartMs(monthStartKeyFor(key)));
  date.setMonth(date.getMonth() + months, 1);
  return dateKey(date);
}

function buildCenteredPeriodStartKeys(centerStartKey: string, count: number, addPeriod: (key: string, amount: number) => string, maxStartKey: string): string[] {
  const safeCount = Math.max(1, count);
  const centerIndex = Math.floor((safeCount - 1) / 2);
  let startKey = addPeriod(centerStartKey, -centerIndex);
  let endKey = addPeriod(startKey, safeCount - 1);
  let guard = 0;
  while (dayStartMs(endKey) > dayStartMs(maxStartKey) && guard < safeCount + 24) {
    startKey = addPeriod(startKey, -1);
    endKey = addPeriod(endKey, -1);
    guard += 1;
  }
  return Array.from({ length: safeCount }, (_, index) => addPeriod(startKey, index));
}

function weightEntriesBetween(startKey: string, endKeyExclusive: string): WeightLog[] {
  const start = dayStartMs(startKey);
  const end = dayStartMs(endKeyExclusive);
  return state.weightLogs.filter((entry) => entry.measured_at >= start && entry.measured_at < end);
}

function averageWeight(entries: WeightLog[]): number | null {
  if (!entries.length) return null;
  const avg = entries.reduce((sum, entry) => sum + entry.weight_kg, 0) / entries.length;
  return Math.round(avg * 10) / 10;
}

function formatMonthShort(key: string): string {
  const date = new Date(dayStartMs(key));
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

function buildWeightTrendRows(mode: WeightTrendMode, count: number, centerKey = selectedDate.value): WeightTrendRow[] {
  if (mode === 'daily') {
    return buildCenteredDateKeys(centerKey, count)
      .map((key): WeightTrendRow | null => {
        const entry = latestWeightForDay(state.weightLogs, key);
        if (!entry) return null;
        return {
          key,
          label: formatDate(dayStartMs(key)),
          weightKg: Math.round(entry.weight_kg * 10) / 10,
          entryCount: 1,
          selected: key === selectedDate.value,
          limitedData: false,
        } satisfies WeightTrendRow;
      })
      .filter((row): row is WeightTrendRow => Boolean(row));
  }

  if (mode === 'monthly') {
    const selectedMonth = monthStartKeyFor(centerKey);
    const currentMonth = monthStartKeyFor(todayKey.value);
    return buildCenteredPeriodStartKeys(selectedMonth, count, addMonths, currentMonth)
      .map((startKey): WeightTrendRow | null => {
        const endKey = addMonths(startKey, 1);
        const entries = weightEntriesBetween(startKey, endKey);
        const avg = averageWeight(entries);
        if (avg === null) return null;
        return {
          key: startKey,
          label: formatMonthShort(startKey),
          weightKg: avg,
          entryCount: entries.length,
          selected: monthStartKeyFor(selectedDate.value) === startKey,
          limitedData: entries.length < 3,
        } satisfies WeightTrendRow;
      })
      .filter((row): row is WeightTrendRow => Boolean(row));
  }

  const selectedMonday = mondayKeyFor(centerKey);
  const currentMonday = mondayKeyFor(todayKey.value);
  return buildCenteredPeriodStartKeys(selectedMonday, count, (key, amount) => addDays(key, amount * 7), currentMonday)
    .map((startKey): WeightTrendRow | null => {
      const endKey = addDays(startKey, 7);
      const entries = weightEntriesBetween(startKey, endKey);
      const avg = averageWeight(entries);
      if (avg === null) return null;
      const weekEndKey = addDays(startKey, 6);
      return {
        key: weekEndKey,
        label: weekEndKey,
        weightKg: avg,
        entryCount: entries.length,
        selected: mondayKeyFor(selectedDate.value) === startKey,
        limitedData: entries.length < 3,
      } satisfies WeightTrendRow;
    })
    .filter((row): row is WeightTrendRow => Boolean(row));
}

function buildWeightChartPoints(rows: WeightTrendRow[]): string {
  if (rows.length < 2) return '';
  const scale = buildWeightChartScale(rows);
  const range = Math.max(0.1, scale.max - scale.min);
  return rows.map((row, index) => {
    const x = rows.length === 1 ? 50 : 8 + (index * 84 / Math.max(1, rows.length - 1));
    const y = 82 - ((row.weightKg - scale.min) / range) * 64;
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  }).join(' ');
}

function buildWeightChartScale(rows: WeightTrendRow[]) {
  if (!rows.length) return { min: 0, max: 1, ticks: [] as number[] };
  const values = rows.map((row) => row.weightKg);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max(0.5, (rawMax - rawMin) * 0.18);
  const min = Math.floor((rawMin - pad) * 2) / 2;
  const max = Math.ceil((rawMax + pad) * 2) / 2;
  const step = Math.max(0.5, Math.round(((max - min) / 3) * 2) / 2);
  const ticks = [max, max - step, max - step * 2, min].map((value) => Math.round(value * 10) / 10);
  return { min, max: Math.max(max, min + 0.5), ticks };
}

function weightBarHeight(row: WeightTrendRow): number {
  const scale = weightChartScale.value;
  const range = Math.max(0.1, scale.max - scale.min);
  return Math.max(8, Math.min(100, ((row.weightKg - scale.min) / range) * 100));
}

function weightTrendModeLabel(mode: WeightTrendMode): string {
  const labels = currentLocale() === 'hu'
    ? { daily: 'Napi', weekly: 'Heti', monthly: 'Havi' }
    : { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
  return labels[mode];
}

async function refreshNotificationPermissionStatus() {
  try {
    notificationPermission.value = (await isPermissionGranted()) ? 'granted' : 'default';
    return;
  } catch {
    // Browser preview fallback below.
  }
  if (typeof Notification === 'undefined') {
    notificationPermission.value = 'unsupported';
    return;
  }
  notificationPermission.value = Notification.permission;
}

async function refreshCameraPermissionStatus() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraPermission.value = 'unsupported';
    return;
  }
  const rememberedGrant = localStorage.getItem(mobileCameraPermissionGrantedKey) === '1';
  try {
    const permissionStatus = await navigator.permissions?.query?.({ name: 'camera' as PermissionName });
    if (permissionStatus?.state) {
      if (permissionStatus.state === 'granted') {
        localStorage.setItem(mobileCameraPermissionGrantedKey, '1');
        cameraPermission.value = 'granted';
        return;
      }
      if (permissionStatus.state === 'denied') {
        localStorage.removeItem(mobileCameraPermissionGrantedKey);
        cameraPermission.value = 'denied';
        return;
      }
      cameraPermission.value = rememberedGrant ? 'granted' : permissionStatus.state;
      permissionStatus.onchange = () => {
        if (permissionStatus.state === 'granted') {
          localStorage.setItem(mobileCameraPermissionGrantedKey, '1');
          cameraPermission.value = 'granted';
          return;
        }
        if (permissionStatus.state === 'denied') {
          localStorage.removeItem(mobileCameraPermissionGrantedKey);
          cameraPermission.value = 'denied';
          return;
        }
        cameraPermission.value = localStorage.getItem(mobileCameraPermissionGrantedKey) === '1' ? 'granted' : permissionStatus.state;
      };
      return;
    }
  } catch {
    // Some WebViews expose camera access without the Permissions API.
  }
  cameraPermission.value = rememberedGrant ? 'granted' : 'prompt';
}

async function refreshAppPermissionStatuses() {
  await Promise.all([
    refreshNotificationPermissionStatus(),
    refreshCameraPermissionStatus(),
  ]);
}

async function requestReminderPermission() {
  try {
    if (await isPermissionGranted()) {
      notificationPermission.value = 'granted';
      showToast(t('notificationsEnabled'));
      queueReminderScheduleRefresh();
      return;
    }
    const permission = await requestNativeNotificationPermission();
    notificationPermission.value = permission;
    showToast(permission === 'granted' ? t('notificationsEnabled') : t('notificationsNotEnabled'));
    queueReminderScheduleRefresh();
  } catch {
    if (typeof Notification === 'undefined') {
      showToast(t('notificationsUnsupported'));
      notificationPermission.value = 'unsupported';
      return;
    }
    const permission = await Notification.requestPermission();
    notificationPermission.value = permission;
    showToast(permission === 'granted' ? t('notificationsEnabled') : t('notificationsNotEnabled'));
    queueReminderScheduleRefresh();
  }
}

async function requestCameraPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraPermission.value = 'unsupported';
    showToast(t('cameraPermissionUnsupported'));
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((track) => track.stop());
    localStorage.setItem(mobileCameraPermissionGrantedKey, '1');
    cameraPermission.value = 'granted';
    showToast(t('cameraPermissionEnabled'));
  } catch {
    localStorage.removeItem(mobileCameraPermissionGrantedKey);
    cameraPermission.value = 'denied';
    showToast(t('cameraPermissionNotEnabled'));
  }
}

async function requestOnboardingPermissions() {
  await requestReminderPermission();
  await requestCameraPermission();
  await refreshAppPermissionStatuses();
}

function cameraPermissionStatusLabel(): string {
  if (cameraPermissionGranted.value) return t('cameraPermissionEnabled');
  if (cameraPermission.value === 'unsupported') return t('cameraPermissionUnsupported');
  return t('cameraPermissionNotEnabled');
}

function cameraPermissionStatusBody(): string {
  if (cameraPermissionGranted.value) {
    return activeLanguage.value === 'hu'
      ? 'A vonalkód- és QR-szkenner használhatja a kamerát.'
      : 'The barcode and QR scanner can use the camera.';
  }
  if (cameraPermission.value === 'unsupported') {
    return activeLanguage.value === 'hu'
      ? 'Ez a környezet nem támogatja a kamerás szkennelést.'
      : 'This environment does not support camera scanning.';
  }
  return activeLanguage.value === 'hu'
    ? 'Engedélyezd a kamerát a vonalkódok és Nutrino QR-kódok beolvasásához.'
    : 'Enable camera access to scan barcodes and Nutrino QR codes.';
}

function appPermissionSummary(): string {
  const statuses = [notificationPermissionGranted.value, cameraPermissionGranted.value];
  return `${statuses.filter(Boolean).length}/${statuses.length} ${t('permissionsReady')}`;
}

function openPermissionsSettings() {
  settingsDialog.value = 'permissions';
  void refreshAppPermissionStatuses();
}

async function ensureNotificationPermissionForReminders() {
  if (!state.settings.daily_reminder
    && !state.settings.daily_weight_reminder_enabled
    && !state.settings.meal_reminders_enabled
    && !state.settings.calorie_limit_warning_enabled) {
    return;
  }

  try {
    if (await isPermissionGranted()) {
      notificationPermission.value = 'granted';
      return;
    }
  } catch {
    // Fall through to the shared permission request helper.
  }

  await requestReminderPermission();
  queueReminderScheduleRefresh();
}

function notificationScheduleSignature(): string {
  return [
    state.settings.language,
    state.settings.daily_reminder,
    state.settings.daily_reminder_time,
    state.settings.daily_weight_reminder_enabled,
    state.settings.daily_weight_reminder_time,
    state.settings.meal_reminders_enabled,
    state.settings.meal_reminder_morning_time,
    state.settings.meal_reminder_noon_time,
    state.settings.meal_reminder_afternoon_time,
    state.settings.calorie_limit_warning_enabled,
  ].join('|');
}

function notificationPermissionSignature(): string {
  return [
    state.settings.daily_reminder,
    state.settings.daily_weight_reminder_enabled,
    state.settings.meal_reminders_enabled,
    state.settings.calorie_limit_warning_enabled,
  ].join('|');
}

function parseReminderTime(timeValue: string): ReminderClockTime | null {
  const [hourValue, minuteValue] = String(timeValue || '').split(':');
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function currentTimeMatchesReminderMinute(timeValue: string, now = new Date()): boolean {
  const time = parseReminderTime(timeValue);
  return Boolean(time && now.getHours() === time.hour && now.getMinutes() === time.minute);
}

function dailyReminderSchedule(time: ReminderClockTime): Schedule {
  return Schedule.interval({ hour: time.hour, minute: time.minute, second: 0 }, true);
}

function notificationActionTitle(key: string, fallback: string): string {
  const value = String(t(key) || '').trim();
  return value || fallback;
}

function notificationPermissionStatusLabel(): string {
  if (notificationPermissionGranted.value) return t('notificationsEnabled');
  if (notificationPermission.value === 'unsupported') return t('notificationsUnsupported');
  return t('notificationsNotEnabled');
}

function notificationPermissionStatusBody(): string {
  if (notificationPermissionGranted.value) {
    return activeLanguage.value === 'hu'
      ? 'A beállított emlékeztetők értesítésként is megjelenhetnek.'
      : 'Configured reminders can be delivered as notifications.';
  }
  if (notificationPermission.value === 'unsupported') {
    return activeLanguage.value === 'hu'
      ? 'Ez a környezet nem támogatja a rendszerértesítéseket.'
      : 'This environment does not support system notifications.';
  }
  return activeLanguage.value === 'hu'
    ? 'Engedélyezd az értesítéseket, hogy az emlékeztetők a beállított időpontokban érkezzenek.'
    : 'Enable notifications so reminders can arrive at the configured times.';
}

function advancedTransferWarningText(): string {
  return activeLanguage.value === 'hu'
    ? 'A csatornák közötti adatmozgatás felülírhat meglévő adatokat. Exportálás vagy importálás előtt ellenőrizd, hogy a megfelelő csatornát választottad.'
    : 'Moving data between channels can overwrite existing data. Before importing or exporting, verify that you selected the correct channel.';
}

function advancedImportHintText(): string {
  return activeLanguage.value === 'hu'
    ? 'A másik csatorna mentéséből frissíti az aktuális csatorna adatait.'
    : 'Updates the current channel from the backup of the other channel.';
}

function advancedExportHintText(): string {
  return activeLanguage.value === 'hu'
    ? 'Előkészíti az aktuális csatorna adatait a másik csatornára történő átvitelhez.'
    : 'Prepares the current channel data so it can be transferred to the other channel.';
}

function shouldAttachNativeNotificationActions(): boolean {
  return isTauriRuntime() && isMobileRuntime();
}

function notificationVisualOptions(): Partial<NotificationOptions> {
  if (isTauriRuntime() && isAndroidRuntime()) {
    return {
      icon: NOTIFICATION_ICON,
      iconColor: NOTIFICATION_ICON_COLOR,
    };
  }
  return { icon: WEB_NOTIFICATION_ICON };
}

function buildNotificationOptions(options: {
  id?: number;
  title: string;
  body: string;
  kind?: NutrinoNotificationKind;
  actionTypeId?: string;
  mealType?: MealType;
  scheduledTime?: string;
  schedule?: Schedule;
}): NotificationOptions {
  const notification: NotificationOptions = {
    title: options.title,
    body: options.body,
    largeBody: options.body,
    group: NOTIFICATION_GROUP_ID,
    autoCancel: true,
    visibility: Visibility.Public,
    ...notificationVisualOptions(),
  };
  if (options.id !== undefined) notification.id = options.id;
  if (options.actionTypeId && shouldAttachNativeNotificationActions()) notification.actionTypeId = options.actionTypeId;
  if (options.schedule) notification.schedule = options.schedule;
  if (isTauriRuntime() && isAndroidRuntime()) notification.channelId = NOTIFICATION_CHANNEL_ID;
  if (options.kind) {
    const actionMetadata = notificationActionMetadata(options.kind, options.mealType);
    notification.extra = {
      nutrino: true,
      kind: options.kind,
      mealType: options.mealType,
      scheduledTime: options.scheduledTime,
      ...actionMetadata,
    } satisfies NutrinoNotificationExtra & { actionId?: NutrinoNotificationAction; actionTitle?: string };
  }
  if (isTauriRuntime() && isAndroidRuntime()) {
    (notification as NotificationOptions & { sourceJson?: string }).sourceJson = JSON.stringify(notification);
  }
  return notification;
}

async function notifyUser(title: string, body: string, options: {
  id?: number;
  kind?: NutrinoNotificationKind;
  actionTypeId?: string;
  mealType?: MealType;
  scheduledTime?: string;
} = {}) {
  try {
    if (await isPermissionGranted()) {
      if (options.actionTypeId && shouldAttachNativeNotificationActions()) {
        try {
          await registerNotificationActionTypes();
        } catch {
          // The notification can still be delivered; this only guards action labels.
        }
      }
      sendNotification(buildNotificationOptions({ title, body, ...options }));
      notificationPermission.value = 'granted';
      return;
    }
  } catch {
    // Fall through to Web Notification or toast fallback for preview/dev environments.
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body, icon: WEB_NOTIFICATION_ICON });
  } else {
    showToast(`${title}: ${body}`);
  }
}

function mealNotificationActionType(mealType: MealType): string {
  if (mealType === 'lunch') return NOTIFICATION_ACTION_TYPES.mealLunch;
  if (mealType === 'dinner') return NOTIFICATION_ACTION_TYPES.mealDinner;
  return NOTIFICATION_ACTION_TYPES.mealBreakfast;
}

function mealNotificationActionId(mealType: MealType): NutrinoNotificationAction {
  if (mealType === 'lunch') return 'log-lunch';
  if (mealType === 'dinner') return 'log-dinner';
  return 'log-breakfast';
}

function mealNotificationActionLabel(mealType: MealType): string {
  if (activeLanguage.value === 'hu') {
    if (mealType === 'lunch') return 'Ebéd felvitele';
    if (mealType === 'dinner') return 'Vacsora felvitele';
    return 'Reggeli felvitele';
  }
  if (mealType === 'lunch') return 'Log lunch';
  if (mealType === 'dinner') return 'Log dinner';
  return 'Log breakfast';
}

function weightNotificationActionLabel(): string {
  return activeLanguage.value === 'hu' ? 'Súly rögzítése' : 'Log weight';
}

function notificationActionMetadata(kind?: NutrinoNotificationKind, mealType?: MealType): { actionId?: NutrinoNotificationAction; actionTitle?: string } {
  if (kind === 'weight') return { actionId: 'log-weight', actionTitle: weightNotificationActionLabel() };
  if (kind === 'meal' && mealType) return { actionId: mealNotificationActionId(mealType), actionTitle: mealNotificationActionLabel(mealType) };
  if (kind === 'deficit') return { actionId: 'open-analysis', actionTitle: notificationActionTitle('openAnalysis', 'Open analysis') };
  return {};
}

async function registerNotificationActionTypes() {
  if (!shouldAttachNativeNotificationActions()) return;
  await registerActionTypes([
    {
      id: NOTIFICATION_ACTION_TYPES.weight,
      actions: [
        { id: 'log-weight', title: weightNotificationActionLabel(), requiresAuthentication: false, foreground: true },
      ],
    },
    {
      id: NOTIFICATION_ACTION_TYPES.mealBreakfast,
      actions: [
        { id: 'log-breakfast', title: mealNotificationActionLabel('breakfast'), requiresAuthentication: false, foreground: true },
      ],
    },
    {
      id: NOTIFICATION_ACTION_TYPES.mealLunch,
      actions: [
        { id: 'log-lunch', title: mealNotificationActionLabel('lunch'), requiresAuthentication: false, foreground: true },
      ],
    },
    {
      id: NOTIFICATION_ACTION_TYPES.mealDinner,
      actions: [
        { id: 'log-dinner', title: mealNotificationActionLabel('dinner'), requiresAuthentication: false, foreground: true },
      ],
    },
    {
      id: NOTIFICATION_ACTION_TYPES.deficit,
      actions: [
        { id: 'open-analysis', title: notificationActionTitle('openAnalysis', 'Open analysis'), requiresAuthentication: false, foreground: true },
      ],
    },
  ]);
}

async function createReminderNotificationChannel() {
  if (!isTauriRuntime() || !isAndroidRuntime()) return;
  await createChannel({
    id: NOTIFICATION_CHANNEL_ID,
    name: 'Nutrino reminders',
    description: t('trackingReminders'),
    importance: Importance.Default,
    visibility: Visibility.Public,
    vibration: true,
  });
}

function scheduledReminderDefinitions(): ScheduledReminderConfig[] {
  const reminders: ScheduledReminderConfig[] = [];
  if (state.settings.daily_reminder) {
    reminders.push({
      id: REMINDER_NOTIFICATION_IDS.daily,
      key: 'daily',
      time: state.settings.daily_reminder_time,
      title: t('dailyReminder'),
      body: t('dailyReminderBody'),
      kind: 'daily',
    });
  }
  if (state.settings.daily_weight_reminder_enabled) {
    reminders.push({
      id: REMINDER_NOTIFICATION_IDS.weight,
      key: 'weight',
      time: state.settings.daily_weight_reminder_time,
      title: t('weightReminderTitle'),
      body: t('weightReminderBody'),
      kind: 'weight',
      actionTypeId: NOTIFICATION_ACTION_TYPES.weight,
    });
  }
  if (state.settings.meal_reminders_enabled) {
    reminders.push(
      {
        id: REMINDER_NOTIFICATION_IDS.mealMorning,
        key: 'meal.morning',
        time: state.settings.meal_reminder_morning_time,
        title: t('mealReminderTitle'),
        body: t('mealReminderMorning'),
        kind: 'meal',
        mealType: 'breakfast',
        actionTypeId: mealNotificationActionType('breakfast'),
      },
      {
        id: REMINDER_NOTIFICATION_IDS.mealNoon,
        key: 'meal.noon',
        time: state.settings.meal_reminder_noon_time,
        title: t('mealReminderTitle'),
        body: t('mealReminderNoon'),
        kind: 'meal',
        mealType: 'lunch',
        actionTypeId: mealNotificationActionType('lunch'),
      },
      {
        id: REMINDER_NOTIFICATION_IDS.mealAfternoon,
        key: 'meal.afternoon',
        time: state.settings.meal_reminder_afternoon_time,
        title: t('mealReminderTitle'),
        body: t('mealReminderAfternoon'),
        kind: 'meal',
        mealType: 'dinner',
        actionTypeId: mealNotificationActionType('dinner'),
      },
    );
  }
  return reminders.filter((reminder) => parseReminderTime(reminder.time));
}

function nextDevNotificationId() {
  return 140000 + Math.floor(Date.now() % 100000);
}

async function sendDevReminderTest(kind: 'daily' | 'weight' | 'mealMorning' | 'mealNoon' | 'mealAfternoon') {
  if (!devMode) return;
  const mealReminder = (mealType: MealType, body: string): ScheduledReminderConfig => ({
    id: nextDevNotificationId(),
    key: `test.${mealType}`,
    time: '',
    title: t('mealReminderTitle'),
    body,
    kind: 'meal',
    mealType,
    actionTypeId: mealNotificationActionType(mealType),
  });
  const reminder = kind === 'daily'
    ? { id: nextDevNotificationId(), key: 'test.daily', time: '', title: t('dailyReminder'), body: t('dailyReminderBody'), kind: 'daily' } satisfies ScheduledReminderConfig
    : kind === 'weight'
      ? { id: nextDevNotificationId(), key: 'test.weight', time: '', title: t('weightReminderTitle'), body: t('weightReminderBody'), kind: 'weight', actionTypeId: NOTIFICATION_ACTION_TYPES.weight } satisfies ScheduledReminderConfig
      : kind === 'mealMorning'
        ? mealReminder('breakfast', t('mealReminderMorning'))
        : kind === 'mealNoon'
          ? mealReminder('lunch', t('mealReminderNoon'))
          : mealReminder('dinner', t('mealReminderAfternoon'));
  await requestReminderPermission();
  await notifyUser(`${t('test')} · ${reminder.title}`, reminder.body, {
    id: reminder.id,
    kind: reminder.kind,
    mealType: reminder.mealType,
    actionTypeId: reminder.actionTypeId,
  });
}

async function cancelScheduledReminderNotifications() {
  if (!isTauriRuntime() || !isMobileRuntime()) return;
  try {
    await cancel(Object.values(REMINDER_NOTIFICATION_IDS));
  } catch {
    // Best effort cleanup; the fallback poller still guards by exact minute and per-day keys.
  }
  nativeReminderSchedulesActive.value = false;
}

async function reconcileScheduledReminderNotifications() {
  if (!isTauriRuntime() || !isMobileRuntime()) {
    nativeReminderSchedulesActive.value = false;
    return;
  }

  const reminders = scheduledReminderDefinitions();
  try {
    if (!(await isPermissionGranted())) {
      await cancelScheduledReminderNotifications();
      return;
    }
    await createReminderNotificationChannel();
    await registerNotificationActionTypes();
    await cancel(Object.values(REMINDER_NOTIFICATION_IDS));
    for (const reminder of reminders) {
      const time = parseReminderTime(reminder.time);
      if (!time) continue;
      sendNotification(buildNotificationOptions({
        id: reminder.id,
        title: reminder.title,
        body: reminder.body,
        kind: reminder.kind,
        mealType: reminder.mealType,
        scheduledTime: reminder.time,
        actionTypeId: reminder.actionTypeId,
        schedule: dailyReminderSchedule(time),
      }));
    }
    nativeReminderSchedulesActive.value = reminders.length > 0;
  } catch {
    nativeReminderSchedulesActive.value = false;
  }
}

function queueReminderScheduleRefresh() {
  if (reminderScheduleRefreshTimer) window.clearTimeout(reminderScheduleRefreshTimer);
  reminderScheduleRefreshTimer = window.setTimeout(() => {
    reminderScheduleRefreshTimer = undefined;
    void reconcileScheduledReminderNotifications();
  }, 150);
}

async function initializeNotifications() {
  if (isTauriRuntime() && isMobileRuntime()) {
    try {
      await registerNotificationActionTypes();
      notificationActionListener = await onAction((payload) => {
        handleNotificationAction(payload as unknown);
      });
      consumeNativePendingNotificationAction();
    } catch {
      notificationActionListener = null;
    }
  }
  consumeNativePendingNotificationAction();
  queueReminderScheduleRefresh();
}

function normalizeNotificationAction(action: unknown): NutrinoNotificationAction {
  const value = String(action || 'tap');
  return ['tap', 'open-home', 'log-weight', 'log-breakfast', 'log-lunch', 'log-dinner', 'open-analysis', 'dismiss'].includes(value)
    ? value as NutrinoNotificationAction
    : 'tap';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function numberFromNotificationValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseNotificationJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeNotificationExtra(extra: unknown): Partial<NutrinoNotificationExtra> {
  const record = asRecord(extra);
  if (!record) return {};
  const nestedExtra = asRecord(record.extra) || asRecord(parseNotificationJson(record.extra));
  const sourceJson = parseNotificationJson(record.sourceJson);
  const sourceExtra = asRecord(sourceJson?.extra) || asRecord(parseNotificationJson(sourceJson?.extra));
  const merged = {
    ...sourceExtra,
    ...nestedExtra,
    ...record,
  };
  const result: Partial<NutrinoNotificationExtra> = {};
  if (merged.nutrino === true) result.nutrino = true;
  if (['daily', 'weight', 'meal', 'deficit'].includes(String(merged.kind))) result.kind = merged.kind as NutrinoNotificationKind;
  if (['breakfast', 'lunch', 'dinner', 'snack'].includes(String(merged.mealType))) result.mealType = merged.mealType as MealType;
  if (typeof merged.scheduledTime === 'string') result.scheduledTime = merged.scheduledTime;
  return result;
}

function mealTypeFromNotificationAction(action: NutrinoNotificationAction, extra: Partial<NutrinoNotificationExtra>): MealType | null {
  if (action === 'log-breakfast') return 'breakfast';
  if (action === 'log-lunch') return 'lunch';
  if (action === 'log-dinner') return 'dinner';
  return extra.mealType || null;
}

function notificationExtraFromId(notificationId: number | undefined): Partial<NutrinoNotificationExtra> {
  if (notificationId === REMINDER_NOTIFICATION_IDS.daily) return { nutrino: true, kind: 'daily' };
  if (notificationId === REMINDER_NOTIFICATION_IDS.weight) return { nutrino: true, kind: 'weight' };
  if (notificationId === REMINDER_NOTIFICATION_IDS.mealMorning) return { nutrino: true, kind: 'meal', mealType: 'breakfast' };
  if (notificationId === REMINDER_NOTIFICATION_IDS.mealNoon) return { nutrino: true, kind: 'meal', mealType: 'lunch' };
  if (notificationId === REMINDER_NOTIFICATION_IDS.mealAfternoon) return { nutrino: true, kind: 'meal', mealType: 'dinner' };
  return {};
}

function closeTransientSurfacesForNotificationAction() {
  if (scanDialogOpen.value) closeScanner();
  if (addMode.value) closeSheet();
  settingsOpen.value = false;
  settingsDialog.value = null;
  quickAddOpen.value = false;
  weightReminderModalOpen.value = false;
  notificationHighlightedMealType.value = null;
  backupProfilesOpen.value = false;
  duplicateMealTargetOpen.value = false;
  entryActionSheet.value = null;
  nutrientInsightsDialog.value = null;
  localEditorOpen.value = false;
  recipeCustomizeOpen.value = false;
  calorieLegendOpen.value = false;
  weightLegendOpen.value = false;
}

async function applyNotificationAction(action: NutrinoNotificationAction, extra: Partial<NutrinoNotificationExtra>) {
  if (action === 'dismiss') return;
  refreshTodayKey();
  selectedDate.value = todayKey.value;
  calendarMonth.value = new Date(dayStartMs(todayKey.value));
  closeTransientSurfacesForNotificationAction();
  activeTab.value = 'home';

  const effectiveAction = action === 'tap'
    ? (extra.kind === 'weight' ? 'log-weight' : extra.kind === 'deficit' ? 'open-analysis' : 'open-home')
    : action;

  if (effectiveAction === 'log-weight') {
    openWeightReminderModal();
    scrollToPageTop();
    return;
  }
  if (effectiveAction === 'open-analysis') {
    analysisOpen.value = true;
    scrollToPageTop();
    return;
  }

  const mealType = action === 'tap' && extra.kind === 'meal'
    ? extra.mealType || 'breakfast'
    : mealTypeFromNotificationAction(effectiveAction, extra);
  if (mealType) {
    openQuickAddMenu(mealType);
    scrollToPageTop();
    return;
  }

  scrollToPageTop();
}

function handleNotificationAction(payload: unknown) {
  const event = asRecord(payload) as NutrinoNotificationEvent | null;
  if (!event) return;
  const notification = asRecord(event.notification);
  const sourceJson = parseNotificationJson(event.sourceJson) || parseNotificationJson(notification?.sourceJson);
  const sourceExtraRecord = asRecord(sourceJson?.extra) || asRecord(parseNotificationJson(sourceJson?.extra));
  const rawAction = event.actionId
    ?? event.action
    ?? event.userAction
    ?? event.notificationUserAction
    ?? sourceJson?.actionId
    ?? sourceJson?.action;
  const extraAction = sourceExtraRecord?.actionId ?? sourceExtraRecord?.action;
  const action = normalizeNotificationAction(rawAction && rawAction !== 'tap' ? rawAction : extraAction ?? rawAction);
  const notificationId = numberFromNotificationValue(
    notification?.id
    ?? event.notificationId
    ?? event.id
    ?? sourceJson?.id,
  );
  const extra = {
    ...notificationExtraFromId(notificationId),
    ...normalizeNotificationExtra(sourceJson),
    ...normalizeNotificationExtra(notification),
    ...normalizeNotificationExtra(event.data),
    ...normalizeNotificationExtra(event.extra),
  };
  const signature = `${notificationId ?? 'unknown'}:${action}:${extra.kind ?? 'unknown'}:${extra.mealType ?? ''}`;
  const now = Date.now();
  if (signature === lastNotificationActionSignature && now - lastNotificationActionHandledAt < 10000) return;
  lastNotificationActionSignature = signature;
  lastNotificationActionHandledAt = now;
  void applyNotificationAction(action, extra);
}

function handleNativeNotificationActionEvent(event: Event) {
  handleNotificationAction((event as CustomEvent<unknown>).detail);
}

function consumeNativePendingNotificationAction() {
  const bridge = window as unknown as { __NUTRINO_PENDING_NOTIFICATION_ACTION__?: unknown };
  if (!bridge.__NUTRINO_PENDING_NOTIFICATION_ACTION__) return;
  const payload = bridge.__NUTRINO_PENDING_NOTIFICATION_ACTION__;
  bridge.__NUTRINO_PENDING_NOTIFICATION_ACTION__ = undefined;
  handleNotificationAction(payload);
}

function reminderAlreadySent(key: string): boolean {
  return localStorage.getItem(`nutrino.reminder.${key}`) === '1';
}

function markReminderSent(key: string) {
  localStorage.setItem(`nutrino.reminder.${key}`, '1');
}

function checkReminderNotifications() {
  if (nativeReminderSchedulesActive.value) return;
  const today = todayKey.value;
  const now = new Date();

  if (state.settings.daily_reminder && currentTimeMatchesReminderMinute(state.settings.daily_reminder_time, now)) {
    const key = `${today}.daily.${state.settings.daily_reminder_time}`;
    if (!reminderAlreadySent(key)) {
      markReminderSent(key);
      notifyUser(t('dailyReminder'), t('dailyReminderBody'), {
        kind: 'daily',
        scheduledTime: state.settings.daily_reminder_time,
      });
    }
  }

  if (state.settings.daily_weight_reminder_enabled && currentTimeMatchesReminderMinute(state.settings.daily_weight_reminder_time, now) && !latestWeightForDay(state.weightLogs, today)) {
    const key = `${today}.weight.${state.settings.daily_weight_reminder_time}`;
    if (!reminderAlreadySent(key)) {
      markReminderSent(key);
      notifyUser(t('weightReminderTitle'), t('weightReminderBody'), {
        kind: 'weight',
        actionTypeId: NOTIFICATION_ACTION_TYPES.weight,
        scheduledTime: state.settings.daily_weight_reminder_time,
      });
    }
  }

  if (state.settings.meal_reminders_enabled) {
    const reminders = [
      ['morning', state.settings.meal_reminder_morning_time, t('mealReminderMorning'), 'breakfast'],
      ['noon', state.settings.meal_reminder_noon_time, t('mealReminderNoon'), 'lunch'],
      ['afternoon', state.settings.meal_reminder_afternoon_time, t('mealReminderAfternoon'), 'dinner'],
    ] as const;
    for (const [slot, time, body, mealType] of reminders) {
      const key = `${today}.meal.${slot}.${time}`;
      if (currentTimeMatchesReminderMinute(time, now) && !reminderAlreadySent(key)) {
        markReminderSent(key);
        notifyUser(t('mealReminderTitle'), body, {
          kind: 'meal',
          mealType,
          actionTypeId: mealNotificationActionType(mealType),
          scheduledTime: time,
        });
      }
    }
  }
}

function buildCalendar(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    const isFuture = date.getTime() > dayStartMs(todayKey.value);
    const intakes = dayIntakes(key);
    const activities = dayActivities(key);
    const weight = latestWeightForDay(state.weightLogs, key);
    const stats = !isFuture ? dayMacroSummary(key) : null;
    return {
      key,
      day: date.getDate(),
      currentMonth: date.getMonth() === monthDate.getMonth(),
      today: key === todayKey.value,
      selected: key === selectedDate.value,
      future: isFuture,
      hasEntries: !isFuture && (intakes.length > 0 || activities.length > 0),
      bmi: !isFuture && weight ? bmi(weight.weight_kg, state.profile.height_cm) : 0,
      weightKg: !isFuture ? weight?.weight_kg ?? null : null,
    };
  });
}

function moveCalendar(delta: number) {
  const next = new Date(calendarMonth.value);
  next.setMonth(next.getMonth() + delta);
  calendarMonth.value = next;
}

function selectCalendarDate(key: string) {
  refreshTodayKey();
  if (dayStartMs(key) > dayStartMs(todayKey.value) && !futureConfirmedDates.value[key]) {
    if (!window.confirm(t('futureDateWarning'))) return;
    futureConfirmedDates.value[key] = true;
  }
  if (selectedDate.value !== key) {
    unlockedDiaryDate.value = null;
    editingDayWeight.value = false;
  }
  selectedDate.value = key;
  calendarMonth.value = new Date(dayStartMs(key));
}

function moveSelectedDate(delta: number) {
  const date = new Date(dayStartMs(selectedDate.value));
  date.setDate(date.getDate() + delta);
  selectCalendarDate(dateKey(date));
}

async function refreshServerIfCatalogStale() {
  if (!state.pairing.baseUrl.trim()) return;
  const lastCheck = Number(state.pairing.lastHealthCheckAt || 0);
  const recentlyChecked = Date.now() - lastCheck < SERVER_STALE_MS;

  if (!serverOnline.value && recentlyChecked) {
    if (!githubCatalogAvailable.value) showOfflineToastOnce(t('serverOfflineUsingCache'));
    return;
  }

  if (serverOnline.value && recentlyChecked) return;

  await pollServerHealth({ syncOnChange: true, quiet: true });
  if (!serverOnline.value && !githubCatalogAvailable.value) showOfflineToastOnce(t('serverOfflineUsingCache'));
}

async function openFoodAdd(mealType: MealType) {
  if (!confirmFutureDateAccess()) return;
  await refreshServerIfCatalogStale();
  addMode.value = 'food';
  addMealType.value = mealType;
  mealEntryMode.value = 'catalog';
  resetMealNoteForm();
  search.value = '';
  selectedCatalogId.value = '';
  catalogPickerOpen.value = true;
  recipeIngredientAmounts.value = {};
  recipeCustomExtraKcal.value = 0;
  recipeCustomizeOpen.value = false;
  foodUnit.value = 'g';
  foodAmount.value = null;
}

async function openActivityAdd() {
  if (!confirmFutureDateAccess()) return;
  await refreshServerIfCatalogStale();
  addMode.value = 'activity';
  search.value = '';
  activityId.value = '';
  activityMinutes.value = null;
  activityKcal.value = null;
  activitySource.value = 'activity_catalog';
  activityPickerOpen.value = true;
}

function closeQuickAddMenu() {
  quickAddOpen.value = false;
  notificationHighlightedMealType.value = null;
}

function openQuickAddMenu(highlightedMealType: MealType | null = null) {
  notificationHighlightedMealType.value = highlightedMealType;
  quickAddOpen.value = true;
}

function isNotificationHighlightedQuickAdd(section: MealSection): boolean {
  return section.key !== 'activity' && notificationHighlightedMealType.value === section.key;
}

async function chooseQuickAdd(section: MealSection) {
  closeQuickAddMenu();
  if (section.key === 'activity') {
    await openActivityAdd();
    return;
  }
  await openFoodAdd(section.key);
}

function requestCloseSheet(confirmDirty: boolean | Event = true) {
  const shouldConfirm = typeof confirmDirty === 'boolean' ? confirmDirty : true;
  if (!addMode.value) return;
  if (!shouldConfirm || confirmDiscardDirty(hasActiveMealSheetDraft())) closeSheet();
}

function closeSheet() {
  addMode.value = null;
  editingIntakeId.value = null;
  editingActivityLogId.value = null;
  selectedCatalogId.value = '';
  catalogPickerOpen.value = false;
  activityId.value = '';
  activityPickerOpen.value = false;
  search.value = '';
  foodAmount.value = null;
  activityMinutes.value = null;
  activityKcal.value = null;
  recipeCustomizeOpen.value = false;
  recipeIngredientAmounts.value = {};
  mealEntryMode.value = 'catalog';
  resetMealNoteForm();
}

function addFoodLog() {
  let item = selectedCatalog.value;
  if (!item) return showToast(t('selectFoodFirst'));
  const rawAmount = Number(foodAmount.value);
  if (!rawAmount || rawAmount <= 0) return showToast(t('amountGreaterThanZero'));

  item = item.id.startsWith('recipe:') ? buildCustomRecipeSnapshot(item) : item;
  const servingSize = item.serving_size_g || 0;
  const amountG = foodUnit.value === 'serving' && servingSize > 0 ? rawAmount * servingSize : rawAmount;
  const now = Date.now();
  const consumedAt = timestampForActiveLogDay(now);

  const payload = {
    source_id: item.source_id,
    item_type: item.id.startsWith('recipe:') ? 'recipe' as const : 'food' as const,
    food_id: item.id,
    consumed_at: consumedAt,
    meal_type: addMealType.value,
    amount_g: amountG,
    unit: foodUnit.value,
    serving_qty: foodUnit.value === 'serving' ? rawAmount : null,
    food_snapshot_json: foodSnapshot(item),
    pending_sync: false,
    updated_at: now,
  };
  if (editingIntakeId.value) {
    state.intakes = state.intakes.map((entry) => entry.id === editingIntakeId.value ? { ...entry, note_final: false, ...payload } : entry);
  } else {
    state.intakes.push({ id: generateId('intake'), created_at: now, ...payload });
  }
  closeSheet();
}

function addActivityLog() {
  const activity = selectedActivity.value;
  if (activitySource.value === 'activity_catalog' && !activity) return showToast(t('activitySearch'));
  const duration = Number(activityMinutes.value);
  if (!duration || duration <= 0) return showToast('Duration must be greater than zero.');
  let kcal = activitySource.value === 'activity_catalog' && activity ? activity.kcal_per_min * duration : Number(activityKcal.value || 0);
  if (!Number.isFinite(kcal) || kcal <= 0) return showToast('Enter burned kcal for watch/manual activity.');
  kcal = Math.round(kcal);
  const now = Date.now();
  const performedAt = timestampForActiveLogDay(now);
  const payload = {
    activity_id: activitySource.value === 'activity_catalog' ? activity?.id ?? null : null,
    activity_name: activitySource.value === 'activity_catalog' ? (activity ? activityDisplayName(activity) : 'Activity') : activitySource.value === 'watch' ? 'Watch activity' : 'Custom activity',
    performed_at: performedAt,
    duration_min: duration,
    kcal,
    source: activitySource.value,
    pending_sync: false,
    updated_at: now,
  };
  if (editingActivityLogId.value) {
    state.activityLogs = state.activityLogs.map((entry) => entry.id === editingActivityLogId.value ? { ...entry, ...payload } : entry);
    showToast(t('activityUpdated'));
  } else {
    state.activityLogs.push({ id: generateId('activity-log'), created_at: now, ...payload });
    showToast(t('activityAdded'));
  }
  closeSheet();
}

function removeIntake(id: string) {
  if (!ensureSelectedDayEditing()) return;
  if (!window.confirm(t('deleteEntryConfirm'))) return;
  state.intakes = state.intakes.filter((entry) => entry.id !== id);
}

function removeActivity(id: string) {
  if (!ensureSelectedDayEditing()) return;
  if (!window.confirm(t('deleteActivityConfirm'))) return;
  state.activityLogs = state.activityLogs.filter((entry) => entry.id !== id);
}

function cloneIntakeToMeal(id: string, mealType: MealType) {
  if (!ensureSelectedDayEditing()) return;
  const entry = state.intakes.find((item) => item.id === id);
  if (!entry) return;
  const now = Date.now();
  state.intakes.push({
    ...entry,
    id: generateId('intake'),
    meal_type: mealType,
    consumed_at: timestampForActiveLogDay(now),
    pending_sync: true,
    created_at: now,
    updated_at: now,
  });
  closeDuplicateMealTarget();
  entryActionSheet.value = null;
  showToast(t('entryDuplicated'));
}

function openDuplicateIntakeTarget(entry: Intake) {
  if (!ensureSelectedDayEditing()) return;
  pendingDuplicateIntakeId.value = entry.id;
  duplicateMealTargetOpen.value = true;
  entryActionSheet.value = null;
}

function closeDuplicateMealTarget() {
  duplicateMealTargetOpen.value = false;
  pendingDuplicateIntakeId.value = null;
}

function duplicatePendingIntake(mealType: MealType) {
  if (!pendingDuplicateIntakeId.value) return;
  cloneIntakeToMeal(pendingDuplicateIntakeId.value, mealType);
}

function moveIntakeToMeal(id: string, mealType: MealType) {
  if (!ensureSelectedDayEditing()) return;
  const now = Date.now();
  state.intakes = state.intakes.map((entry) => entry.id === id ? { ...entry, meal_type: mealType, pending_sync: true, updated_at: now } : entry);
  entryActionSheet.value = null;
  showToast(t('entryMoved'));
}

function duplicateActivity(id: string) {
  if (!ensureSelectedDayEditing()) return;
  const entry = state.activityLogs.find((item) => item.id === id);
  if (!entry) return;
  const now = Date.now();
  state.activityLogs.push({
    ...entry,
    id: generateId('activity-log'),
    performed_at: timestampForActiveLogDay(now),
    pending_sync: true,
    created_at: now,
    updated_at: now,
  });
  entryActionSheet.value = null;
  showToast(t('entryDuplicated'));
}

function startEntryLongPress(kind: EntryActionSheetState['kind'], id: string, event?: PointerEvent) {
  if (event?.pointerType === 'mouse' && event.button !== 0) return;
  clearEntryLongPress();
  entryLongPressTimer = window.setTimeout(() => {
    entryActionSheet.value = { kind, id };
    if (navigator.vibrate) navigator.vibrate(18);
  }, 520);
}

function clearEntryLongPress() {
  if (entryLongPressTimer) window.clearTimeout(entryLongPressTimer);
  entryLongPressTimer = undefined;
}

const actionSheetIntake = computed(() => entryActionSheet.value?.kind === 'intake' ? state.intakes.find((entry) => entry.id === entryActionSheet.value?.id) || null : null);
const actionSheetActivity = computed(() => entryActionSheet.value?.kind === 'activity' ? state.activityLogs.find((entry) => entry.id === entryActionSheet.value?.id) || null : null);

function upsertWeightForDay(value: number, source: WeightLog['source'], key = activeLogDateKey.value) {
  const now = Date.now();
  const measuredAt = timestampForLogDay(key, now);
  const existing = state.weightLogs
    .filter((entry) => dateKey(new Date(entry.measured_at)) === key)
    .sort((a, b) => b.measured_at - a.measured_at)[0];

  if (existing) {
    existing.measured_at = measuredAt;
    existing.weight_kg = value;
    existing.bmi = bmi(value, state.profile.height_cm);
    existing.source = source;
    existing.updated_at = now;
    existing.pending_sync = true;
  } else {
    state.weightLogs.push({
      id: generateId('weight'),
      measured_at: measuredAt,
      weight_kg: value,
      bmi: bmi(value, state.profile.height_cm),
      source,
      pending_sync: true,
      created_at: now,
      updated_at: now,
    });
  }

  if (!state.profile.plan_start_weight_kg) state.profile.plan_start_weight_kg = value;
  state.profile.last_weight_prompt_at = now;
  syncProfileWeightFromToday();
}

function recordWeight(source: WeightLog['source'] = 'manual') {
  if (!confirmFutureDateAccess()) return;
  const value = Number(weightInput.value ?? currentDayWeightKg.value ?? state.profile.current_weight_kg);
  if (!value || value <= 0) return showToast(t('enterValidWeight'));
  upsertWeightForDay(value, source);
  weightInput.value = null;
  editingDayWeight.value = false;
  weightReminderModalOpen.value = false;
  showToast(t('weightSaved'));
}

function updateProfileWeight(event: Event) {
  const input = event.currentTarget as HTMLInputElement | null;
  const value = Number(input?.value ?? state.profile.current_weight_kg);
  if (!value || value <= 0) {
    showToast(t('enterValidWeight'));
    syncProfileWeightFromToday();
    return;
  }
  refreshTodayKey();
  upsertWeightForDay(value, 'manual', todayKey.value);
  showToast(t('weightSaved'));
}


async function pollServerHealth(options: { syncOnChange?: boolean; quiet?: boolean } = {}) {
  if (state.settings.desktop_api_enabled === false) return;
  if (serverChecking.value || !state.pairing.baseUrl.trim()) return;
  serverChecking.value = true;
  try {
    const health = await checkServerHealth(state.pairing.baseUrl, authPassword());
    serverOnline.value = true;
    state.pairing.lastHealthCheckAt = Date.now();
    state.pairing.lastSyncError = undefined;
    clearOfflineToastMemory();
    const versionGate = await ensureServerVersionSyncAllowed(health);
    if (!versionGate.allowed) {
      if (!options.quiet && versionGate.message) showToast(versionGate.message);
      return;
    }
    const remoteRevision = Number(health.catalog_revision || 0);
    if (remoteRevision && remoteRevision !== Number(state.pairing.catalogRevision || 0) && options.syncOnChange !== false) {
      await syncNow({ quiet: true });
    }
  } catch (error) {
    serverOnline.value = false;
    state.pairing.lastSyncError = String(error);
    if (!options.quiet && !githubCatalogAvailable.value) showOfflineToastOnce(t('serverOffline'));
  } finally {
    serverChecking.value = false;
  }
}

async function testConnection() {
  if (state.settings.desktop_api_enabled === false) return showToast(t('desktopApiDisabled'));
  try {
    const normalizedBaseUrl = normalizeApiBaseUrl(state.pairing.baseUrl);
    if (normalizedBaseUrl) state.pairing.baseUrl = normalizedBaseUrl;
    const message = await pingServer(state.pairing.baseUrl, authPassword());
    state.pairing.lastSyncError = undefined;
    showToast(message);
  } catch (error) {
    state.pairing.lastSyncError = String(error);
    showToast(String(error));
  }
}

async function runServerTransfer(mode: 'pull' | 'push', options: { quiet?: boolean } = {}) {
  if (state.settings.desktop_api_enabled === false) {
    if (!options.quiet) showToast(t('desktopApiDisabled'));
    return;
  }
  syncBusy.value = true;
  try {
    const normalizedBaseUrl = normalizeApiBaseUrl(state.pairing.baseUrl);
    if (normalizedBaseUrl) state.pairing.baseUrl = normalizedBaseUrl;
    const versionGate = await ensureServerVersionSyncAllowed();
    if (!versionGate.allowed) {
      serverOnline.value = true;
      state.pairing.lastHealthCheckAt = Date.now();
      state.pairing.lastSyncError = undefined;
      clearOfflineToastMemory();
      if (!options.quiet && versionGate.message) showToast(versionGate.message);
      return;
    }
    const snapshot = { ...JSON.parse(JSON.stringify(state)), pairing: { ...state.pairing, token: authPassword(), password: authPassword(), channel: appChannel } } as AppState;
    const { state: nextState, result } = mode === 'push' ? await pushToServer(snapshot) : await pullFromServer(snapshot);
    Object.assign(state, nextState);
    serverOnline.value = true;
    clearOfflineToastMemory();
    if (!options.quiet) {
      if (mode === 'push') {
        showToast(`${result.message} Sent ${result.pushedIntakes} meals, ${result.pushedWeightLogs} weights, ${result.pushedActivityLogs} activities.`);
      } else {
        showToast(`${result.message} Added ${result.pulledFoods} foods, ${result.pulledRecipes} recipes, ${result.pulledActivities} activities.`);
      }
    }
  } catch (error) {
    serverOnline.value = false;
    state.pairing.lastSyncError = String(error);
    if (!options.quiet) showOfflineToastOnce(mode === 'push' ? t('pushFailedOffline') : t('pullFailedOffline'));
  } finally {
    syncBusy.value = false;
  }
}

async function syncNow(options: { quiet?: boolean } = {}) {
  await runServerTransfer('pull', options);
}

async function pushNow(options: { quiet?: boolean } = {}) {
  await runServerTransfer('push', options);
}

function addGitHubSource() {
  const owner = githubDraft.value.owner.trim();
  const repo = githubDraft.value.repo.trim();
  if (!owner || !repo) return showToast('Add GitHub owner and repo.');
  const source: GitHubCsvSource = {
    id: generateId('github-source'),
    owner,
    repo,
    branch: githubDraft.value.branch.trim() || 'main',
    path: githubDraft.value.path.trim(),
    token: githubDraft.value.token.trim(),
    enabled: true,
    lastSyncAt: 0,
  };
  state.githubSources = [...(state.githubSources || []), source];
  githubDraft.value = { owner: '', repo: '', branch: 'main', path: '', token: '' };
  showToast('GitHub CSV source saved.');
}

function removeGitHubSource(id: string) {
  state.githubSources = (state.githubSources || []).filter((source) => source.id !== id);
}

async function syncGitHubNow(force = true) {
  if (state.settings.github_csv_enabled === false) return showToast(t('githubCsvDisabled'));
  if (!state.githubSources?.some((source) => source.enabled)) return showToast('Add at least one GitHub CSV source first.');
  githubSyncBusy.value = true;
  try {
    const result = await syncGitHubCsvSources(JSON.parse(JSON.stringify(state)) as AppState, force);
    Object.assign(state, result.state);
    showToast(result.message);
  } catch (error) {
    showToast(String(error));
  } finally {
    githubSyncBusy.value = false;
  }
}

async function requestCatalogSourceCheck(item: Food | ActivityDefinition) {
  const target = catalogItemRecord(item);
  if (!target) return;
  const kind = catalogSourceKind(target.record);
  const beforeFingerprint = catalogSourceFingerprint(target.record);
  catalogSourceCheckBusyId.value = item.id;
  try {
    if (kind === 'github') {
      await syncGitHubNow(true);
    } else if (kind === 'desktop') {
      await syncNow({ quiet: true });
    } else {
      patchCatalogRecord(target.kind, target.id, { source_checked_at: Date.now() }, { touch: false });
      showToast(t('sourceCheckLocalOnly'));
      return;
    }

    const refreshed = catalogItemRecord(item)?.record;
    const changed = refreshed ? catalogSourceFingerprint(refreshed) !== beforeFingerprint : false;
    const refreshedTarget = catalogItemRecord(item);
    if (refreshedTarget) patchCatalogRecord(refreshedTarget.kind, refreshedTarget.id, { source_checked_at: Date.now() }, { touch: false });
    showToast(changed ? t('sourceCheckChanged') : t('sourceCheckNoChange'));
  } catch (error) {
    showToast(String(error));
  } finally {
    catalogSourceCheckBusyId.value = '';
  }
}

async function syncGitHubDailyIfDue() {
  if (state.settings.github_csv_enabled === false) return;
  if (!state.githubSources?.some((source) => source.enabled)) return;
  await syncGitHubNow(false);
}

function normalizeScanValue(value: string): string {
  return String(value || '').trim();
}

function findCatalogByBarcodeOrPayload(value: string): Food | null {
  const normalized = normalizeScanValue(value);
  if (!normalized) return null;
  const direct = allCatalogItems.value.find((item) => item.id === normalized || item.barcode === normalized);
  if (direct) return direct;
  return allCatalogItems.value.find((item) => item.barcode && item.barcode.replace(/\D/g, '') === normalized.replace(/\D/g, '')) ?? null;
}

function importedCatalogDuplicate(kind: 'ingredient' | 'food' | 'recipe' | 'activity', id: string, name: string): boolean {
  const normalized = normalizeSearchText(name);
  const sameName = (item: { id: string; name: string; name_i18n?: LocalizedNameMap | null }) => {
    const names = [item.name, ...Object.values(item.name_i18n || {})].map(normalizeSearchText).filter(Boolean);
    return item.id === id || names.includes(normalized);
  };
  if (kind === 'ingredient') return state.ingredients.some(sameName);
  if (kind === 'activity') return state.activities.some(sameName);
  if (kind === 'recipe') return state.recipes.some(sameName);
  return state.foods.some(sameName);
}

function qrCatalogMetadata(now = Date.now()) {
  return {
    catalog_source_kind: 'qr' as const,
    source_label: 'QR code',
    source_url: null,
    source_checked_at: now,
    locked: null,
    inactive: false,
  };
}

function upsertScannedIngredient(item: any, now = Date.now()) {
  if (!item?.name) return;
  const ingredient: Ingredient = {
    id: String(item.id || generateId('ingredient')),
    source_id: state.pairing.sourceId,
    ...qrCatalogMetadata(now),
    name: String(item.name),
    name_i18n: { ...(item.name_i18n ?? {}) },
    note: item.note ?? null,
    default_unit: item.default_unit || 'g',
    serving_size_g: item.serving_size_g ?? null,
    kcal_per_100g: Number(item.kcal_per_100g || 0),
    carbs_per_100g: Number(item.carbs_per_100g || 0),
    fat_per_100g: Number(item.fat_per_100g || 0),
    protein_per_100g: Number(item.protein_per_100g || 0),
    sugars_per_100g: nullableNonNegativeNumber(item.sugars_per_100g),
    fiber_per_100g: nullableNonNegativeNumber(item.fiber_per_100g),
    salt_per_100g: nullableNonNegativeNumber(item.salt_per_100g),
    optional_nutrients: { ...(item.optional_nutrients ?? {}) },
    updated_at: now,
    deleted_at: null,
    pending_sync: true,
  };
  state.ingredients = [...state.ingredients.filter((entry) => entry.id !== ingredient.id), ingredient].sort((a, b) => localizedName(a).localeCompare(localizedName(b), currentLocale()));
}

function upsertScannedFood(item: any, now = Date.now()) {
  if (!item?.name) return;
  const food: Food = {
    id: String(item.id || generateId('food')),
    source_id: state.pairing.sourceId,
    ...qrCatalogMetadata(now),
    name: String(item.name),
    name_i18n: { ...(item.name_i18n ?? {}) },
    brand: item.brand ?? null,
    note: item.note ?? null,
    default_unit: item.default_unit || 'g',
    serving_size_g: item.serving_size_g ?? null,
    kcal_per_100g: Number(item.kcal_per_100g || 0),
    carbs_per_100g: Number(item.carbs_per_100g || 0),
    fat_per_100g: Number(item.fat_per_100g || 0),
    protein_per_100g: Number(item.protein_per_100g || 0),
    sugars_per_100g: nullableNonNegativeNumber(item.sugars_per_100g),
    fiber_per_100g: nullableNonNegativeNumber(item.fiber_per_100g),
    salt_per_100g: nullableNonNegativeNumber(item.salt_per_100g),
    optional_nutrients: { ...(item.optional_nutrients ?? {}) },
    barcode: item.barcode ?? null,
    updated_at: now,
    deleted_at: null,
    pending_sync: true,
  };
  state.foods = [...state.foods.filter((entry) => entry.id !== food.id), food].sort((a, b) => localizedName(a).localeCompare(localizedName(b), currentLocale()));
}

function upsertScannedRecipe(item: any, now = Date.now()) {
  if (!item?.name) return null;
  const recipe: Recipe = {
    id: String(item.id || generateId('recipe')),
    source_id: state.pairing.sourceId,
    ...qrCatalogMetadata(now),
    name: String(item.name),
    name_i18n: { ...(item.name_i18n ?? {}) },
    description: item.description ?? null,
    note: item.note ?? null,
    total_weight_g: null,
    extra_kcal: item.extra_kcal ?? 0,
    servings_count: item.servings_count ?? null,
    updated_at: now,
    deleted_at: null,
    pending_sync: true,
  };
  state.recipes = [...state.recipes.filter((entry) => entry.id !== recipe.id), recipe].sort((a, b) => localizedName(a).localeCompare(localizedName(b), currentLocale()));
  return recipe;
}

function upsertScannedActivity(item: any, now = Date.now()) {
  if (!item?.name) return;
  const activity: ActivityDefinition = {
    id: String(item.id || generateId('activity')),
    source_id: state.pairing.sourceId,
    ...qrCatalogMetadata(now),
    code: item.code || String(item.id || generateId('activity')),
    name: String(item.name),
    name_i18n: { ...(item.name_i18n ?? {}) },
    description: item.description ?? null,
    activity_type: item.activity_type || item.type || 'custom',
    met: Number(item.met || 1),
    kcal_per_min: Number(item.kcal_per_min || 0),
    updated_at: now,
    deleted_at: null,
    pending_sync: true,
  };
  state.activities = [...state.activities.filter((entry) => entry.id !== activity.id), activity].sort((a, b) => localizedName(a).localeCompare(localizedName(b), currentLocale()));
}

function upsertScannedRecipeItems(recipeId: string, rows: any[] | undefined, now = Date.now()) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const items: RecipeItem[] = rows
    .filter((row) => row?.food_id && Number(row.amount_g || 0) > 0)
    .map((row) => ({
      id: String(row.id || generateId('recipe-item')),
      recipe_id: recipeId,
      food_id: String(row.food_id),
      amount_g: Number(row.amount_g || 0),
      updated_at: now,
      deleted_at: row.deleted_at ?? null,
      pending_sync: true,
    }));
  if (!items.length) return 0;
  state.recipeItems = [...state.recipeItems.filter((entry) => entry.recipe_id !== recipeId), ...items];
  return items.length;
}

function importScannedDependencies(payload: any, now = Date.now()) {
  const dependencies = payload?.dependencies || {};
  if (Array.isArray(dependencies.ingredients)) dependencies.ingredients.forEach((item: any) => upsertScannedIngredient(item, now));
  if (Array.isArray(dependencies.foods)) dependencies.foods.forEach((item: any) => upsertScannedFood(item, now));
  if (Array.isArray(dependencies.recipes)) dependencies.recipes.forEach((item: any) => upsertScannedRecipe(item, now));
  if (Array.isArray(dependencies.activities)) dependencies.activities.forEach((item: any) => upsertScannedActivity(item, now));
}

function recordCatalogPayload(payload: any) {
  const now = Date.now();
  const kind = payload?.kind;
  const item = payload?.item;
  if (!kind || !item?.name) return showToast('This QR code is not a Nutrino catalog item.');
  const id = String(item.id || generateId(kind));
  const duplicate = importedCatalogDuplicate(kind, id, String(item.name));
  const itemCount = Array.isArray(payload?.recipe_items) ? payload.recipe_items.length : 0;
  const proceed = window.confirm(`${duplicate ? 'Possible duplicate found. ' : ''}Add/edit "${localizedName(item)}" in your local catalog${kind === 'recipe' && itemCount ? ` with ${itemCount} ingredient row(s)` : ''}?`);
  if (!proceed) return;

  if (kind === 'ingredient') {
    upsertScannedIngredient({ ...item, id }, now);
  } else if (kind === 'food') {
    upsertScannedFood({ ...item, id }, now);
  } else if (kind === 'recipe') {
    importScannedDependencies(payload, now);
    const recipe = upsertScannedRecipe({ ...item, id }, now);
    if (recipe) upsertScannedRecipeItems(recipe.id, payload.recipe_items || payload.items, now);
  } else if (kind === 'activity') {
    upsertScannedActivity({ ...item, id }, now);
  }
  showToast(kind === 'recipe' && itemCount ? `Recipe saved locally with ${itemCount} ingredient row(s).` : 'Catalog item saved locally. Send it to the server when ready.');
}

function parseCatalogPayloadBase64(encoded: string) {
  const json = decodeURIComponent(escape(atob(encoded)));
  return JSON.parse(json);
}

function recordCatalogQrPart(value: string): boolean {
  const prefix = 'nutrino-catalog-part-v1:';
  const raw = value.slice(prefix.length);
  const first = raw.indexOf(':');
  const second = first >= 0 ? raw.indexOf(':', first + 1) : -1;
  const third = second >= 0 ? raw.indexOf(':', second + 1) : -1;
  if (first < 1 || second < 0 || third < 0) {
    showToast('This QR part is not valid.');
    return false;
  }
  const id = raw.slice(0, first);
  const index = Number(raw.slice(first + 1, second));
  const total = Number(raw.slice(second + 1, third));
  const chunk = raw.slice(third + 1);
  if (!id || !Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1 || index > total || !chunk) {
    showToast('This QR part is not valid.');
    return false;
  }
  if (!pendingCatalogQrSequence.value || pendingCatalogQrSequence.value.id !== id) {
    pendingCatalogQrSequence.value = { id, total, parts: {} };
  }
  if (pendingCatalogQrSequence.value.total !== total) {
    pendingCatalogQrSequence.value = { id, total, parts: {} };
  }
  pendingCatalogQrSequence.value.parts[index] = chunk;
  const received = Object.keys(pendingCatalogQrSequence.value.parts).length;
  if (received < total) {
    showToast(`QR part ${index}/${total} scanned. ${total - received} remaining.`);
    scanInput.value = '';
    return false;
  }

  try {
    const sequence = pendingCatalogQrSequence.value;
    const chunks: string[] = [];
    for (let partIndex = 1; partIndex <= total; partIndex += 1) {
      const chunk = sequence?.parts[partIndex];
      if (!chunk) throw new Error('Missing QR part.');
      chunks.push(chunk);
    }
    const payload = parseCatalogPayloadBase64(chunks.join(''));
    pendingCatalogQrSequence.value = null;
    recordCatalogPayload(payload);
    closeScanner();
    return true;
  } catch {
    showToast('Could not assemble this QR sequence. Scan the parts again.');
    pendingCatalogQrSequence.value = null;
    return false;
  }
}

function applyScannedValue(rawValue = scanInput.value): boolean {
  const value = normalizeScanValue(rawValue);
  if (!value) return false;
  try {
    const partPrefix = 'nutrino-catalog-part-v1:';
    if (value.startsWith(partPrefix)) return recordCatalogQrPart(value);

    const prefix = 'nutrino-catalog-v1:';
    if (value.startsWith(prefix)) {
      recordCatalogPayload(parseCatalogPayloadBase64(value.slice(prefix.length)));
      closeScanner();
      return true;
    }
  } catch { /* fall through to barcode */ }

  const item = findCatalogByBarcodeOrPayload(value);
  if (item) {
    chooseCatalogItem(item);
    closeScanner();
    showToast(`Selected ${localizedName(item)}.`);
    return true;
  }
  showToast('No matching food or recipe found for this code.');
  return false;
}

async function openScanner(mode: 'catalog' | 'barcode' = 'catalog') {
  scanDialogMode.value = mode;
  scanInput.value = '';
  pendingCatalogQrSequence.value = null;
  lastScannerRawValue = '';
  lastScannerRawAt = 0;
  scanDialogOpen.value = true;
  await nextTick();
  await startCameraScanner();
}

async function bestCameraConstraints(): Promise<MediaStreamConstraints> {
  const baseVideo = {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
  } as MediaTrackConstraints;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const backCamera = [...cameras].reverse().find((device) => /back|rear|environment|wide|camera 0/i.test(device.label)) || cameras[cameras.length - 1];
    if (backCamera?.deviceId) return { video: { ...baseVideo, deviceId: { ideal: backCamera.deviceId } } };
  } catch { /* fall back to environment camera */ }
  return { video: baseVideo };
}

async function startCameraScanner() {
  const video = scanVideo.value;
  const Detector = (window as any).BarcodeDetector;
  if (!video || !Detector || !navigator.mediaDevices?.getUserMedia) return;
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia(await bestCameraConstraints());
    localStorage.setItem(mobileCameraPermissionGrantedKey, '1');
    cameraPermission.value = 'granted';
    video.srcObject = scannerStream;
    await video.play();
    scannerActive.value = true;
    const detector = new Detector({ formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
    const tick = async () => {
      if (!scannerActive.value || !scanDialogOpen.value) return;
      try {
        const codes = await detector.detect(video);
        if (codes?.[0]?.rawValue) {
          const rawValue = String(codes[0].rawValue);
          const now = Date.now();
          if (rawValue === lastScannerRawValue && now - lastScannerRawAt < 1500) {
            window.setTimeout(tick, 300);
            return;
          }
          lastScannerRawValue = rawValue;
          lastScannerRawAt = now;
          const finished = applyScannedValue(rawValue);
          if (finished) return;
          window.setTimeout(tick, 850);
          return;
        }
      } catch { /* ignore camera frame errors */ }
      window.setTimeout(tick, 350);
    };
    tick();
  } catch {
    scannerActive.value = false;
  }
}

function closeScanner() {
  scannerActive.value = false;
  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }
  scanDialogOpen.value = false;
}


function openSettings() {
  settingsOpen.value = true;
  settingsDialog.value = null;
}

function closeSettings() {
  settingsOpen.value = false;
  settingsDialog.value = null;
}

function resetCalculations() {
  state.settings.kcal_adjustment = 0;
  state.settings.macro_carbs_percent = 60;
  state.settings.macro_protein_percent = 15;
  state.settings.macro_fat_percent = 25;
  state.settings.target_deficit_kcal = 300;
  state.settings.exercise_kcal_eatback_percent = 50;
}


function normalizeBackupBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(t('invalidBackupFile'));
}

function assertValidZipBytes(bytes: Uint8Array) {
  if (!bytes.length) throw new Error(t('emptyBackupFile'));
  if (bytes.length < 22) throw new Error(t('invalidBackupFile'));
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(t('invalidBackupFile'));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function backupCounts(snapshot: AppState): BackupProfileSummary['counts'] {
  return {
    foods: snapshot.foods.length,
    recipes: snapshot.recipes.length,
    activities: snapshot.activities.length,
    intakes: snapshot.intakes.length,
    activityLogs: snapshot.activityLogs.length,
    weightLogs: snapshot.weightLogs.length,
  };
}

function backupProfileSubtitle(profile: BackupProfileSummary) {
  return `${formatDate(profile.createdAt)} · ${profile.counts.intakes + profile.counts.activityLogs + profile.counts.weightLogs} ${t('entries')} · ${formatBytes(profile.byteLength)}`;
}

function openBackupDb(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) throw new Error(t('backupProfilesUnavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(mobileBackupDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(mobileBackupStoreName)) {
        db.createObjectStore(mobileBackupStoreName, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(t('backupProfilesUnavailable')));
  });
}

async function withBackupStore<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openBackupDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(mobileBackupStoreName, mode);
    const request = callback(tx.objectStore(mobileBackupStoreName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(t('backupProfilesUnavailable')));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error(t('backupProfilesUnavailable')));
    };
  });
}

function backupProfileKindFromReason(reason: string): BackupProfileKind {
  if (reason === t('beforeFactoryResetBackupProfile')) return 'factory_reset';
  if (reason === t('exportBackupProfile')) return 'export';
  if (reason === t('dailyBackupProfile')) return 'daily';
  return 'manual';
}

function backupProfileKindPriority(kind: BackupProfileKind) {
  if (kind === 'daily') return 0;
  if (kind === 'factory_reset') return 1;
  if (kind === 'export') return 2;
  return 3;
}

async function loadBackupProfileRecords(): Promise<StoredBackupProfile[]> {
  const records = await withBackupStore<StoredBackupProfile[]>('readonly', (store) => store.getAll() as IDBRequest<StoredBackupProfile[]>);
  return records
    .map((record) => ({ ...record, kind: record.kind ?? backupProfileKindFromReason(record.name) }))
    .sort((a, b) => backupProfileKindPriority(a.kind) - backupProfileKindPriority(b.kind) || b.createdAt - a.createdAt);
}

async function refreshBackupProfiles() {
  try {
    backupProfiles.value = (await loadBackupProfileRecords()).map(({ state: _state, ...summary }) => summary);
  } catch {
    backupProfiles.value = [];
  }
}

async function saveBackupProfileRecord(record: StoredBackupProfile) {
  await withBackupStore('readwrite', (store) => store.put(record));
}

async function deleteBackupProfile(id: string) {
  await withBackupStore('readwrite', (store) => store.delete(id));
  await refreshBackupProfiles();
  showToast(t('backupProfileDeleted'));
}

async function pruneBackupProfiles() {
  const records = await loadBackupProfileRecords();
  const grouped = records.reduce<Record<BackupProfileKind, StoredBackupProfile[]>>((acc, record) => {
    acc[record.kind].push(record);
    return acc;
  }, { factory_reset: [], export: [], manual: [], daily: [] });

  for (const kind of Object.keys(grouped) as BackupProfileKind[]) {
    const extra = grouped[kind].sort((a, b) => b.createdAt - a.createdAt).slice(mobileBackupProfileLimits[kind]);
    for (const record of extra) {
      await withBackupStore('readwrite', (store) => store.delete(record.id));
    }
  }
}

async function createBackupProfile(reason = t('manualBackupProfile'), forcedKind?: BackupProfileKind): Promise<BackupProfileSummary> {
  const snapshot = normalizeImportedState(JSON.parse(JSON.stringify(state)) as Partial<AppState>);
  const serialized = JSON.stringify(snapshot);
  const createdAt = Date.now();
  const kind = forcedKind ?? backupProfileKindFromReason(reason);
  const record: StoredBackupProfile = {
    id: generateId(`backup-profile-${kind}`),
    kind,
    name: reason,
    createdAt,
    version: appVersion,
    byteLength: new TextEncoder().encode(serialized).length,
    counts: backupCounts(snapshot),
    state: snapshot,
  };
  await saveBackupProfileRecord(record);
  await pruneBackupProfiles();
  await refreshBackupProfiles();
  return record;
}

async function ensureDailyBackupProfile() {
  const today = dateKey();
  if (localStorage.getItem(mobileDailyBackupDateKey) === today) return;
  try {
    const records = await loadBackupProfileRecords();
    const alreadySavedToday = records.some((record) => record.kind === 'daily' && dateKey(new Date(record.createdAt)) === today);
    if (!alreadySavedToday) await createBackupProfile(t('dailyBackupProfile'), 'daily');
    localStorage.setItem(mobileDailyBackupDateKey, today);
  } catch {
    // Daily safety backups must never block app startup.
  }
}

async function createManualBackupProfile() {
  try {
    await createBackupProfile(t('manualBackupProfile'));
    showToast(t('backupProfileCreated'));
  } catch (error) {
    showToast(`${t('backupProfileSaveFailed')}: ${String(error)}`);
  }
}

async function openBackupProfiles() {
  backupProfilesOpen.value = true;
  await refreshBackupProfiles();
}

async function restoreBackupProfile(id: string) {
  try {
    const records = await loadBackupProfileRecords();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error(t('backupProfileMissing'));
    if (!window.confirm(t('confirmRestoreBackupProfile'))) return;
    await createBackupProfile(t('beforeBackupProfileRestore'));
    applyImportedState(JSON.stringify(record.state));
    backupProfilesOpen.value = false;
    await refreshBackupProfiles();
    showToast(t('backupProfileRestored'));
  } catch (error) {
    showToast(`${t('importFailed')}: ${String(error)}`);
  }
}

function timestampForBackupName(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function mobileBackupFileName() {
  return `nutrino-mobile-app-v${appVersion}-${timestampForBackupName()}.zip`;
}

function otherAppChannel() {
  return appChannel === 'dev' ? 'stable' : 'dev';
}

function channelTransferBackupFileName() {
  return `nutrino-mobile-${appChannel}-to-${otherAppChannel()}-v${appVersion}-${timestampForBackupName()}.zip`;
}

function normalizeImportedState(parsed: Partial<AppState>): AppState {
  const defaults = defaultState();
  const profile = (parsed.profile ?? {}) as Partial<AppState['profile']>;
  const pairing = (parsed.pairing ?? {}) as Partial<AppState['pairing']>;
  const settings = (parsed.settings ?? {}) as Partial<AppState['settings']>;

  return {
    ...defaults,
    ...parsed,
    settings: { ...defaults.settings, ...settings },
    pairing: { ...defaults.pairing, ...pairing, channel: appChannel },
    profile: {
      ...defaults.profile,
      ...profile,
      plan_start_weight_kg: profile.plan_start_weight_kg || profile.current_weight_kg || defaults.profile.current_weight_kg,
    },
    foods: Array.isArray(parsed.foods) ? parsed.foods : [],
    ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
    recipes: Array.isArray(parsed.recipes) ? parsed.recipes.map((recipe: Recipe) => ({ ...recipe, extra_kcal: recipe.extra_kcal ?? 0, total_weight_g: null })) : [],
    recipeItems: Array.isArray(parsed.recipeItems) ? parsed.recipeItems : [],
    activities: Array.isArray(parsed.activities) && parsed.activities.length ? parsed.activities : defaults.activities,
    intakes: Array.isArray(parsed.intakes) ? parsed.intakes : [],
    activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
    weightLogs: Array.isArray(parsed.weightLogs) ? parsed.weightLogs : [],
    catalogAliases: Array.isArray(parsed.catalogAliases) ? parsed.catalogAliases : [],
    githubSources: Array.isArray(parsed.githubSources) ? parsed.githubSources : [],
  };
}

function applyImportedState(text: string) {
  const parsed = JSON.parse(text) as Partial<AppState>;
  if (!parsed || typeof parsed !== 'object') throw new Error(t('invalidBackupFile'));
  const knownKeys = ['profile', 'pairing', 'settings', 'foods', 'ingredients', 'recipes', 'recipeItems', 'activities', 'intakes', 'activityLogs', 'weightLogs', 'catalogAliases', 'githubSources'];
  if (!knownKeys.some((key) => key in parsed)) throw new Error(t('invalidBackupFile'));
  const imported = normalizeImportedState(parsed);
  imported.pairing.channel = appChannel;
  Object.assign(state, imported);
  syncProfileWeightFromToday();
  onboardingProfile.height_cm = state.profile.height_cm;
  onboardingProfile.current_weight_kg = state.profile.current_weight_kg;
  onboardingProfile.birthday = state.profile.birthday;
  onboardingProfile.gender = state.profile.gender;
  onboardingProfile.activity_level = state.profile.activity_level;
  onboardingProfile.weekly_goal_kg = state.profile.weekly_goal_kg;
  localStorage.setItem(mobileOnboardingKey, '1');
  onboardingOpen.value = false;
  onboardingStep.value = 0;
  settingsDialog.value = null;
  settingsOpen.value = false;
  saveState(JSON.parse(JSON.stringify(state)) as AppState);
}

async function buildMobileBackupZip() {
  const zip = new JSZip();
  const exportedAt = new Date().toISOString();
  zip.file('manifest.json', JSON.stringify({
    app: 'nutrino',
    formatVersion: 1,
    exportType: 'mobile-app',
    version: appVersion,
    channel: appChannel,
    exportedAt,
  }, null, 2));
  zip.file('mobile-app-data.json', JSON.stringify(state, null, 2));
  zip.file('README.txt', `nutrino mobile app backup\nVersion: ${appVersion}\nExported at: ${exportedAt}\nThis ZIP was validated before export. If the exported file is 0 B, restore from Settings > Backup profiles.\n`);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  assertValidZipBytes(bytes);
  return bytes;
}

function isMobileRuntime() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth <= 760);
}

function isAndroidRuntime() {
  return /Android/i.test(navigator.userAgent);
}

function isIosRuntime() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function fallbackDownloadAppData(bytes: Uint8Array, filename = mobileBackupFileName()) {
  assertValidZipBytes(bytes);
  const blob = new Blob([bytesToArrayBuffer(bytes)], { type: 'application/zip' });
  if (blob.size !== bytes.length) throw new Error(`${t('backupVerifySizeMismatch')} ${formatBytes(blob.size)} / ${formatBytes(bytes.length)}`);

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function createVerifiedBackupFile(bytes: Uint8Array, filename = mobileBackupFileName()) {
  assertValidZipBytes(bytes);
  const blob = new Blob([bytesToArrayBuffer(bytes)], { type: 'application/zip' });
  if (blob.size !== bytes.length) {
    throw new Error(`${t('backupVerifySizeMismatch')} ${formatBytes(blob.size)} / ${formatBytes(bytes.length)}`);
  }

  const file = new File([blob], filename, { type: 'application/zip', lastModified: Date.now() });
  if (file.size !== bytes.length) {
    throw new Error(`${t('backupVerifySizeMismatch')} ${formatBytes(file.size)} / ${formatBytes(bytes.length)}`);
  }

  const roundTripBytes = new Uint8Array(await file.arrayBuffer());
  assertValidZipBytes(roundTripBytes);
  if (roundTripBytes.length !== bytes.length) {
    throw new Error(`${t('backupVerifySizeMismatch')} ${formatBytes(roundTripBytes.length)} / ${formatBytes(bytes.length)}`);
  }

  return file;
}

async function shareMobileBackupZipStrict(bytes: Uint8Array, filename = mobileBackupFileName()) {
  const file = await createVerifiedBackupFile(bytes, filename);
  const sharePayload = {
    files: [file],
    title: 'nutrino mobile backup',
    text: `nutrino mobile backup (${formatBytes(file.size)}). ${t('mobileShareSheetHint')}`,
  };

  if (typeof navigator.share !== 'function') {
    throw new Error(t('mobileShareUnavailable'));
  }

  if (typeof navigator.canShare === 'function' && !navigator.canShare(sharePayload)) {
    throw new Error(t('mobileShareUnavailable'));
  }

  await navigator.share(sharePayload);
}

async function exportBackupZipWithAndroidDocumentPicker(bytes: Uint8Array, filename = mobileBackupFileName()) {
  assertValidZipBytes(bytes);
  const result = await invoke<string>('export_mobile_backup_via_android_picker', { filename, bytes: Array.from(bytes) });
  if (result === 'EXPORT_CANCELED') throw new DOMException(t('exportCanceled'), 'AbortError');
  return result;
}

async function importBackupZipWithAndroidDocumentPicker(): Promise<Uint8Array | null> {
  const result = await invoke<number[] | null>('import_mobile_backup_via_android_picker');
  if (!result) return null;
  const bytes = normalizeBackupBytes(result);
  assertValidZipBytes(bytes);
  return bytes;
}

async function writeBackupZipToNativeAppFile(bytes: Uint8Array, filename = mobileBackupFileName()) {
  assertValidZipBytes(bytes);
  const path = await invoke<string>('write_mobile_backup_file', { filename, bytes: Array.from(bytes) });
  const savedBytes = normalizeBackupBytes(await invoke<number[]>('read_mobile_backup_file', { path }));
  assertValidZipBytes(savedBytes);
  if (savedBytes.length !== bytes.length) {
    throw new Error(`${t('backupVerifySizeMismatch')} ${formatBytes(savedBytes.length)} / ${formatBytes(bytes.length)}`);
  }
  return path;
}

async function shareNativeMobileBackupZip(bytes: Uint8Array, filename = mobileBackupFileName()) {
  const path = await writeBackupZipToNativeAppFile(bytes, filename);
  await invoke('plugin:share|share_file', { path, mime: 'application/zip' });
}

async function writeBackupZipToSelectedLocation(bytes: Uint8Array, filename = mobileBackupFileName()) {
  assertValidZipBytes(bytes);
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'nutrino mobile app backup', extensions: ['zip'] }],
  });
  if (!path) return false;

  await writeFile(path, bytes);

  const savedBytes = normalizeBackupBytes(await readFile(path));
  assertValidZipBytes(savedBytes);
  if (savedBytes.length !== bytes.length) {
    throw new Error(`${t('backupVerifySizeMismatch')} ${formatBytes(savedBytes.length)} / ${formatBytes(bytes.length)}`);
  }
  return true;
}

function pickBackupBytesWithBrowserInput(): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip,application/x-zip-compressed';
    input.style.display = 'none';

    const cleanup = () => {
      input.remove();
    };

    input.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    }, { once: true });

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        assertValidZipBytes(bytes);
        resolve(bytes);
      } catch (error) {
        reject(error);
      }
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

async function pickBackupBytesWithNativeDialog(): Promise<Uint8Array | null> {
  const selected = await open({ multiple: false, filters: [{ name: 'nutrino mobile app backup', extensions: ['zip'] }] });
  if (!selected || Array.isArray(selected)) return null;
  const bytes = normalizeBackupBytes(await readFile(selected));
  assertValidZipBytes(bytes);
  return bytes;
}

async function pickBackupBytesForImport(): Promise<Uint8Array | null> {
  let nativeError: unknown = null;

  if (isTauriRuntime() && isAndroidRuntime()) {
    try {
      const androidBytes = await importBackupZipWithAndroidDocumentPicker();
      if (androidBytes) return androidBytes;
      return null;
    } catch (error) {
      nativeError = error;
    }
  }

  if (isTauriRuntime()) {
    try {
      const nativeBytes = await pickBackupBytesWithNativeDialog();
      if (nativeBytes) return nativeBytes;
    } catch (error) {
      nativeError = error;
    }
  }

  try {
    const browserBytes = await pickBackupBytesWithBrowserInput();
    if (browserBytes) return browserBytes;
  } catch (error) {
    if (!nativeError) nativeError = error;
  }

  if (nativeError) throw nativeError;
  return null;
}

async function exportAppDataWithOptions(filename = mobileBackupFileName(), backupReason = t('exportBackupProfile'), successMessage = t('appDataExportCreated')) {
  refreshTodayKey();
  let localProfileSaved = false;
  try {
    await createBackupProfile(backupReason);
    localProfileSaved = true;
  } catch (error) {
    if (!window.confirm(`${t('backupProfileSaveFailed')}: ${String(error)}
${t('continueExternalExport')}`)) return;
  }

  try {
    const bytes = await buildMobileBackupZip();
    assertValidZipBytes(bytes);

    if (isMobileRuntime()) {
      try {
        if (isTauriRuntime() && isAndroidRuntime()) {
          await exportBackupZipWithAndroidDocumentPicker(bytes, filename);
        } else if (isTauriRuntime()) {
          await shareNativeMobileBackupZip(bytes, filename);
        } else {
          await shareMobileBackupZipStrict(bytes, filename);
        }
        showToast(`${successMessage} (${formatBytes(bytes.length)})`);
      } catch (shareError) {
        const shareErrorName = typeof shareError === 'object' && shareError && 'name' in shareError
          ? String((shareError as { name?: unknown }).name)
          : '';
        const shareErrorMessage = String(shareError);
        if (shareErrorName === 'AbortError' || shareErrorMessage.includes('EXPORT_CANCELED')) {
          showToast(t('exportCanceled'));
          return;
        }
        throw shareError;
      }
      return;
    }

    try {
      const savedToSelectedLocation = await writeBackupZipToSelectedLocation(bytes, filename);
      if (!savedToSelectedLocation) return showToast(t('exportCanceled'));
      showToast(`${successMessage} (${formatBytes(bytes.length)})`);
      return;
    } catch (writeError) {
      fallbackDownloadAppData(bytes, filename);
      showToast(`${t('backupVerifyFailed')} ${localProfileSaved ? t('backupProfileStillAvailable') : ''}`.trim());
      return;
    }
  } catch (error) {
    showToast(`${t('exportFailed')}: ${String(error)}${localProfileSaved ? ` ${t('backupProfileStillAvailable')}` : ''}`);
  }
}

async function exportAppData() {
  await exportAppDataWithOptions();
}

async function exportDataForOtherChannel() {
  await exportAppDataWithOptions(channelTransferBackupFileName(), t('channelTransferExportProfile'), t('channelTransferExportCreated'));
}

async function importAppDataWithOptions(confirmMessage = t('confirmImportOverwrite'), beforeReason = t('beforeImportBackupProfile'), afterReason = t('importBackupProfile'), successMessage = t('appDataImported')) {
  try {
    const bytes = await pickBackupBytesForImport();
    if (!bytes) return showToast(t('importCanceled'));
    assertValidZipBytes(bytes);
    const zip = await JSZip.loadAsync(bytes);
    const manifestText = await zip.file('manifest.json')?.async('string');
    const dataText = await zip.file('mobile-app-data.json')?.async('string');
    if (!dataText) throw new Error(t('invalidBackupFile'));
    if (manifestText) {
      const manifest = JSON.parse(manifestText) as { app?: string; formatVersion?: number; exportType?: string; channel?: string };
      if (manifest.app !== 'nutrino' || manifest.formatVersion !== 1 || manifest.exportType !== 'mobile-app') {
        throw new Error(t('invalidBackupFile'));
      }
    }
    if (!window.confirm(confirmMessage)) return showToast(t('importCanceled'));
    await createBackupProfile(beforeReason);
    applyImportedState(dataText);
    await createBackupProfile(afterReason);
    showToast(successMessage);
  } catch (error) {
    showToast(`${t('importFailed')}: ${String(error)}`);
  }
}

async function importAppData() {
  await importAppDataWithOptions();
}

async function importDataFromOtherChannel() {
  await importAppDataWithOptions(t('confirmChannelTransferImport'), t('beforeChannelTransferImportBackupProfile'), t('channelTransferImportProfile'), t('channelTransferImported'));
}

function clearCachedItems() {
  if (!window.confirm(t('clearCachedConfirm'))) return;
  state.ingredients = [];
  state.foods = [];
  state.recipes = [];
  state.recipeItems = [];
  state.activities = [];
  state.catalogAliases = [];
  state.pairing.lastSyncAt = 0;
  state.pairing.catalogRevision = 0;
  state.pairing.lastSyncError = undefined;
  showToast(t('cachedCatalogCleared'));
}

function stopOnboardingTour(markComplete = true) {
  if (markComplete) markOnboardingComplete();
  if (onboardingDriver?.isActive()) onboardingDriver.destroy();
  onboardingDriver = null;
}

function tourStep(selector: string, titleKey: string, bodyKey: string): DriveStep | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  return {
    element,
    popover: {
      title: t(titleKey),
      description: t(bodyKey),
    },
  };
}

function buildOnboardingTourSteps(): DriveStep[] {
  const steps = [
    tourStep('[data-tour="dashboard"]', 'tourDashboardTitle', 'tourDashboardBody'),
    tourStep('[data-tour="meal-logging"]', 'tourMealsTitle', 'tourMealsBody'),
    tourStep('[data-tour="quick-add"]', 'tourQuickAddTitle', 'tourQuickAddBody'),
    tourStep('[data-tour="sync"]', 'tourSyncTitle', 'tourSyncBody'),
    tourStep('[data-tour="settings"]', 'tourSettingsTitle', 'tourSettingsBody'),
    tourStep('[data-tour="nav-diary"]', 'tourDiaryTitle', 'tourDiaryBody'),
    tourStep('[data-tour="nav-recipes"]', 'tourRecipesTitle', 'tourRecipesBody'),
    tourStep('[data-tour="nav-profile"]', 'tourProfileTitle', 'tourProfileBody'),
  ];
  return steps.filter((step): step is DriveStep => Boolean(step));
}

function startOnboardingTour() {
  activeTab.value = 'home';
  settingsOpen.value = false;
  settingsDialog.value = null;
  quickAddOpen.value = false;
  const steps = buildOnboardingTourSteps();
  if (!steps.length) {
    markOnboardingComplete();
    return;
  }
  onboardingDriver?.destroy();
  onboardingDriver = driver({
    steps,
    showProgress: true,
    allowClose: true,
    smoothScroll: true,
    overlayOpacity: 0.58,
    stagePadding: 8,
    stageRadius: 16,
    popoverClass: 'nutrino-driver-popover',
    nextBtnText: t('next'),
    prevBtnText: t('back'),
    doneBtnText: t('startUsingNutrino'),
    onDestroyed: () => {
      markOnboardingComplete();
      onboardingDriver = null;
    },
  });
  onboardingDriver.drive();
}

function editIntake(entry: Intake) {
  if (!ensureSelectedDayEditing()) return;
  editingIntakeId.value = entry.id;
  addMode.value = 'food';
  addMealType.value = entry.meal_type;
  search.value = '';
  recipeCustomizeOpen.value = false;
  if (entry.item_type === 'note') {
    mealEntryMode.value = 'note';
    selectedCatalogId.value = '';
    catalogPickerOpen.value = false;
    noteTitle.value = entry.note_title || itemTitle(foodFromIntake(entry)) || '';
    noteDescription.value = entry.note_description || foodFromIntake(entry)?.note || '';
    noteKcal.value = Math.round(intakeKcal(entry));
    foodAmount.value = null;
    return;
  }
  mealEntryMode.value = 'catalog';
  resetMealNoteForm();
  selectedCatalogId.value = entry.food_id;
  catalogPickerOpen.value = false;
  try { initializeRecipeIngredientAmounts(entry.food_id, JSON.parse(entry.food_snapshot_json)); } catch { initializeRecipeIngredientAmounts(entry.food_id); }
  foodUnit.value = entry.unit;
  foodAmount.value = entry.unit === 'serving' && entry.serving_qty ? entry.serving_qty : entry.amount_g;
}

function editActivityLog(entry: ActivityLog) {
  if (!ensureSelectedDayEditing()) return;
  editingActivityLogId.value = entry.id;
  addMode.value = 'activity';
  activitySource.value = entry.source;
  activityId.value = entry.activity_id ?? '';
  activityMinutes.value = entry.duration_min;
  activityKcal.value = entry.kcal;
  activityPickerOpen.value = false;
  search.value = '';
}

function setTab(tab: Tab) {
  if (activeTab.value === tab) {
    scrollToPageTop();
    return;
  }
  if (activeTab.value === 'diary' && tab !== 'diary') {
    unlockedDiaryDate.value = null;
    editingDayWeight.value = false;
  }
  activeTab.value = tab;
  if (tab === 'home') refreshTodayKey();
  scrollToPageTop();
}
</script>

<template>
  <main class="app-shell" :class="[homeShellToneClass, { 'page-scrolled': contentScrolled }]">
    <header class="top-appbar">
      <div class="brand-lockup">
        <button class="app-logo-mark app-logo-update-button" :class="{ 'update-available': updateAvailable }" type="button" :aria-label="t('checkUpdates')" :title="t('checkUpdates')" @click="openUpdateCenter" v-html="nutrinoLogoSvg"></button>
        <div>
          <small>nutrino<span v-if="appChannel === 'dev'" class="brand-channel-suffix"> · dev</span></small>
          <h1>{{ pageTitle() }}</h1>
        </div>
      </div>
      <div class="appbar-actions">
        <button class="sync-chip" data-tour="sync" :disabled="syncBusy" @click="syncNow()">
          <span class="sync-dot" :class="serverOnline ? '' : githubCatalogAvailable ? 'available' : 'offline'"></span>
          {{ syncBusy ? t('syncing') : serverOnline ? t('online') : githubCatalogAvailable ? t('available') : t('offline') }}
        </button>
        <button v-if="updateAvailable" class="appbar-update-chip" type="button" :aria-label="updateReleaseTitle()" :title="updateReleaseTitle()" @click="openUpdateCenter"><span></span>{{ updateCheckResult?.release?.version }}</button>
        <button class="settings-button" data-tour="settings" :aria-label="t('settings')" @click="openSettings">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.4 8.4 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A8.4 8.4 0 0 0 7 6L4.6 5 2.6 8.5l2 1.5a8.8 8.8 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8.4 8.4 0 0 0 2.6 1.5L10 22h4l.4-2.5A8.4 8.4 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/></svg>
        </button>
      </div>
    </header>

    <section v-if="activeTab === 'home'" class="page-stack home-page">
      <article v-if="weightPromptDue" class="card weight-prompt">
        <div>
          <b>{{ state.settings.daily_weight_reminder_enabled ? t('weightReminderTitle') : t('weeklyWeightCheck') }}</b>
          <p>{{ state.settings.daily_weight_reminder_enabled ? t('weightReminderBody') : t('weeklyWeightCheckBody') }}</p>
        </div>
        <div class="inline-form compact">
          <input v-model.number="weightInput" class="input" type="number" step="0.1" min="1" :placeholder="t('kgUnit')"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  inputmode="decimal" />
          <button class="filled-button" @click="recordWeight('mobile_prompt')">{{ t('save') }}</button>
        </div>
      </article>

      <article class="card dashboard-card" data-tour="dashboard">
        <div class="source-action"><button class="icon-button" :aria-label="t('sources')" v-html="lucideSvg('info')"></button></div>
        <div class="dashboard-row">
          <div class="side-stat">
            <span class="arrow" v-html="lucideSvg('chevronUp')"></span>
            <b>{{ consumedKcal }}</b>
            <small>{{ t('supplied') }}</small>
          </div>
          <div class="kcal-ring-wrap">
            <svg class="kcal-ring" viewBox="0 0 220 220" :class="kcalRingToneClass">
              <circle cx="110" cy="110" r="90" class="ring-bg" :stroke-dasharray="`${kcalArcLength} ${ringCircumference}`" />
              <circle cx="110" cy="110" r="90" class="ring-fg" :stroke-dasharray="kcalProgressDash" />
            </svg>
            <span v-if="calorieDeficitEnabled" class="kcal-deficit-pin" :style="kcalDeficitMarkerStyle"></span>
            <div class="kcal-center">
              <strong>{{ kcalCenterValue }}</strong>
              <span>{{ t(kcalCenterLabel) }}</span>
            </div>
          </div>
          <div class="side-stat">
            <span class="arrow" v-html="lucideSvg('chevronDown')"></span>
            <b>{{ burnedKcal }}</b>
            <small>{{ t('burned') }}</small>
          </div>
        </div>

        <div class="deficit-dashboard-note">
          <div class="deficit-status-row"><b>{{ deficitStatusText }}</b><button v-if="calorieDeficitEnabled" class="inline-help-button" type="button" :aria-label="deficitHelpTitle" @click="deficitInfoOpen = true" v-html="lucideSvg('circleQuestionMark')"></button></div>
          <small v-if="calorieDeficitEnabled">{{ t('fullLimit') }} {{ dailyGoal }} kcal · {{ t('effectiveLimit') }} {{ effectiveDailyGoal }} kcal · {{ t('exerciseCredit') }} {{ creditedBurnedKcal }}/{{ burnedKcal }} kcal</small>
        </div>

        <div class="macro-rail">
          <div v-for="macro in macros" :key="macro.label" class="macro-dot">
            <svg class="small-ring" viewBox="0 0 54 54">
              <circle cx="27" cy="27" r="20" class="small-bg" />
              <circle cx="27" cy="27" r="20" class="small-fg" :stroke-dasharray="macroRing" :stroke-dashoffset="ringOffset(macro.progress)" />
            </svg>
            <div class="macro-copy"><b>{{ macro.value }}/{{ macro.goal }} g</b>
              <span>{{ t(macro.label) }}</span></div>
          </div>
        </div>
      </article>

      <article v-for="section in sections" :key="section.key" class="card meal-card" :data-tour="section.key === 'breakfast' ? 'meal-logging' : undefined">
        <button class="meal-header" @click="section.key === 'activity' ? openActivityAdd() : openFoodAdd(section.key)">
          <span class="material-icon" v-html="mealIconSvg[section.icon]"></span>
          <span><b>{{ t(section.key) }}</b><small>{{ sectionHint(section) }}</small></span>
          <span class="section-summary-text">{{ sectionSummaryText(section) }}</span>
          <span v-if="state.settings.show_micronutrients && section.key !== 'activity'" class="meal-micro-button" role="button" :aria-label="t('mealMicronutrients')" :title="t('mealMicronutrients')" @click.stop.prevent="openMealMicronutrients(section)" v-html="lucideSvg('flaskConical')"></span>
          <span class="plus-button">+</span>
        </button>
        <div v-if="section.key === 'activity'" class="entry-list">
          <div v-for="activity in activitiesForSection()" :key="activity.id" class="entry-row" @pointerdown="startEntryLongPress('activity', activity.id, $event)" @pointerup="clearEntryLongPress" @pointercancel="clearEntryLongPress" @contextmenu.prevent="entryActionSheet = { kind: 'activity', id: activity.id }">
            <div><b>{{ activity.activity_name }}</b><small>{{ activity.duration_min }} min · {{ activity.kcal }} kcal · {{ activity.source }}</small></div>
            <div class="entry-actions"><button class="entry-icon-button" :aria-label="t('duplicate')" :title="t('duplicate')" @click.stop="duplicateActivity(activity.id)" v-html="lucideSvg('refreshCw')"></button><button class="entry-icon-button" :aria-label="t('edit')" :title="t('edit')" @click.stop="editActivityLog(activity)" v-html="lucideSvg('pencil')"></button><button class="entry-icon-button danger" :aria-label="t('delete')" :title="t('delete')" @click.stop="removeActivity(activity.id)" v-html="lucideSvg('trash2')"></button></div>
          </div>
          <p v-if="!activitiesForSection().length" class="empty-line">{{ t('noActivity') }}</p>
        </div>
        <div v-else class="entry-list">
          <div v-for="entry in entriesForSection(section)" :id="`intake-entry-${entry.id}`" :key="entry.id" class="entry-row" :class="{ 'review-highlight': highlightedReviewIntakeId === entry.id }" @pointerdown="startEntryLongPress('intake', entry.id, $event)" @pointerup="clearEntryLongPress" @pointercancel="clearEntryLongPress" @contextmenu.prevent="entryActionSheet = { kind: 'intake', id: entry.id }">
            <div><b>{{ itemTitle(foodFromIntake(entry)) }}</b><small>{{ amountLabel(entry.amount_g, foodFromIntake(entry)) }} · {{ intakeKcal(entry) }} kcal</small></div>
            <div class="entry-actions"><button class="entry-icon-button" :aria-label="t('duplicate')" :title="t('duplicate')" @click.stop="openDuplicateIntakeTarget(entry)" v-html="lucideSvg('refreshCw')"></button><button class="entry-icon-button" :aria-label="t('edit')" :title="t('edit')" @click.stop="editIntake(entry)" v-html="lucideSvg('pencil')"></button><button class="entry-icon-button danger" :aria-label="t('delete')" :title="t('delete')" @click.stop="removeIntake(entry.id)" v-html="lucideSvg('trash2')"></button></div>
          </div>
          <p v-if="!entriesForSection(section).length" class="empty-line">{{ t('noEntries') }}</p>
        </div>
      </article>
    </section>

    <section v-if="activeTab === 'diary'" class="page-stack">
      <article class="card meal-note-review-card" :class="{ collapsed: !mealNoteReviewOpen }">
        <button class="meal-note-review-head" type="button" :aria-expanded="mealNoteReviewOpen" @click="mealNoteReviewOpen = !mealNoteReviewOpen">
          <span class="meal-note-review-copy">
            <h2>{{ t('mealNotesToReview') }}</h2>
            <small>{{ t('mealNotesToReviewHint') }}</small>
          </span>
          <span class="meal-note-review-actions">
            <span class="meal-note-review-count">{{ mealNotesToReview.length }}</span>
            <span class="meal-note-review-chevron" :class="{ open: mealNoteReviewOpen }" v-html="lucideSvg('chevronDown')"></span>
          </span>
        </button>
        <div v-if="mealNoteReviewOpen" class="meal-note-review-body">
          <div v-if="mealNotesToReview.length" class="meal-note-review-list">
            <div v-for="entry in mealNotesToReview" :key="`meal-note-review-${entry.id}`" class="meal-note-review-row">
              <div>
                <b>{{ entry.note_title || itemTitle(foodFromIntake(entry)) }}</b>
                <small>{{ mealNoteReviewSubtitle(entry) }}</small>
                <small v-if="entry.note_description">{{ entry.note_description }}</small>
              </div>
              <div class="entry-actions">
                <button class="text-button" @click="openMealNoteDay(entry)">{{ t('openDay') }}</button>
                <button class="text-button note-convert-button" @click="openNoteConversion(entry)"><span v-html="lucideSvg('utensils')"></span>{{ t('convertToCatalogItem') }}</button>
                <button class="text-button" @click="keepMealNoteAsFinal(entry)">{{ t('keepAsNote') }}</button>
              </div>
            </div>
          </div>
          <p v-else class="empty-line">{{ t('noMealNotesToReview') }}</p>
        </div>
      </article>

      <article class="card calendar-card">
        <div class="calendar-header">
          <button class="icon-button" @click="moveCalendar(-1)" v-html="lucideSvg('chevronLeft')"></button>
          <h2>{{ formatMonth(calendarMonth) }}</h2>
          <button class="icon-button" @click="moveCalendar(1)" v-html="lucideSvg('chevronRight')"></button>
        </div>
        <div class="weekday-grid"><span v-for="day in ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']" :key="day">{{ day }}</span></div>
        <div class="calendar-grid">
          <button
            v-for="cell in calendarCells"
            :key="cell.key"
            class="calendar-day"
            :class="{ selected: cell.selected, today: cell.today, muted: !cell.currentMonth }"
            @click="selectCalendarDate(cell.key)"
          >
            <span class="calendar-date-number">{{ cell.day }}</span>
            <em v-if="cell.weightKg || cell.bmi" class="calendar-day-weight"><span v-if="cell.weightKg">{{ Number(cell.weightKg).toFixed(1) }} kg</span><span v-if="cell.bmi">BMI {{ cell.bmi }}</span></em>
            <i v-if="cell.hasEntries"></i>
          </button>
        </div>
      </article>

      <div class="diary-date-sticky-bar">
        <button class="icon-button diary-date-nav-button" type="button" :aria-label="t('back')" :title="t('back')" @click="moveSelectedDate(-1)" v-html="lucideSvg('chevronLeft')"></button>
        <div class="diary-date-sticky-copy">
          <small>{{ selectedDate }}</small>
          <b>{{ selectedDiaryDateLabel }}</b>
        </div>
        <div class="diary-date-sticky-actions">
          <button v-if="state.settings.show_micronutrients" class="icon-button analysis-open-button" type="button" :aria-label="t('dayMicronutrients')" :title="t('dayMicronutrients')" @click="openDayMicronutrients" v-html="lucideSvg('flaskConical')"></button>
          <button class="icon-button analysis-open-button" type="button" :aria-label="t('openAnalysis')" :title="t('openAnalysis')" @click="openAnalysis" v-html="lucideSvg('chartPie')"></button>
          <button class="icon-button diary-date-nav-button" type="button" :aria-label="t('next')" :title="t('next')" @click="moveSelectedDate(1)" v-html="lucideSvg('chevronRight')"></button>
        </div>
      </div>

      <article class="card">
        <div class="diary-stats">
          <div :class="['kcal-stat', diaryKcalTone]"><span>{{ t('supplied') }}</span><b>{{ consumedKcal }} / {{ dailyGoal }} kcal</b><small v-if="calorieDeficitEnabled">{{ t('effectiveLimit') }} {{ effectiveDailyGoal }} kcal</small></div>
          <div><span>{{ t('burned') }}</span><b>{{ burnedKcal }} kcal</b></div>
          <div class="weight-stat"><span>{{ t('weight') }}</span><b>{{ currentDayWeightKg ? `${Number(currentDayWeightKg).toFixed(1)} kg` : '—' }}</b><button class="mini-edit-button" @click="editSelectedDayWeight">{{ t('edit') }}</button></div>
          <div :class="['bmi-stat', currentBmiInfo.tone]"><span>BMI</span><b>{{ currentBmi || '—' }}</b></div>
        </div>
        <div class="selected-day-nutrition">
          <span><b>{{ selectedDayMacroSummary.carbs }}</b>/<em>{{ selectedDayMacroSummary.carbsGoal }}</em> {{ t('carbs') }}</span>
          <span><b>{{ selectedDayMacroSummary.fat }}</b>/<em>{{ selectedDayMacroSummary.fatGoal }}</em> {{ t('fat') }}</span>
          <span><b>{{ selectedDayMacroSummary.protein }}</b>/<em>{{ selectedDayMacroSummary.proteinGoal }}</em> {{ t('protein') }}</span>
        </div>
        <details v-if="state.settings.show_micronutrients" class="today-nutrients-dropdown">
          <summary>
            <span class="today-nutrients-summary-main">
              <span>{{ t('todayNutrients') }}</span>
              <span v-if="exceededNutrientCount" class="nutrient-warning-badge">! {{ exceededNutrientCount }}</span>
            </span>
            <span class="today-nutrients-summary-meta">
              <span class="today-nutrients-chevron" v-html="lucideSvg('chevronDown')"></span>
            </span>
          </summary>
          <div v-if="selectedDayNutrientRows.length" class="today-nutrient-list">
            <div v-for="row in selectedDayNutrientRows" :key="row.key" class="today-nutrient-row">
              <span class="today-nutrient-row-label">{{ row.label }}</span>
              <span class="today-nutrient-row-value" :class="`nutrient-tone-${row.tone}`">{{ formatNutrientAmount(row.value, row.unit) }}</span>
              <small>{{ formatNutrientAmount(row.limit, row.unit) }}</small>
              <span v-if="row.isOver" class="nutrient-row-alert">!</span>
            </div>
          </div>
          <p v-else class="today-nutrient-empty">{{ t('noNutrientsLogged') }}</p>
        </details>
        <div v-if="editingDayWeight" class="inline-form day-weight-form">
          <input v-model.number="weightInput" class="input" type="number" min="1" step="0.1" :placeholder="t('weightForThisDay')"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  inputmode="decimal" />
          <button class="filled-button" @click="recordWeight('manual')">{{ t('saveWeight') }}</button>
        </div>
      </article>

      <article v-if="!selectedDayUnlocked" class="card day-edit-card">
        <div>
          <b>{{ t('lockedNote') }}</b>
          <small>{{ t('selectedDayEntriesNote') }}</small>
        </div>
        <button class="outlined-button unlock-button" @click="unlockSelectedDay"><span v-html="lucideSvg('lockOpen')"></span>{{ t('unlockDay') }}</button>
      </article>

      <article v-for="section in sections" :key="`diary-${section.key}`" class="card meal-card">
        <button
          class="meal-header"
          :class="{ locked: !selectedDayUnlocked }"
          @click="selectedDayUnlocked && (section.key === 'activity' ? openActivityAdd() : openFoodAdd(section.key))"
        >
          <span class="material-icon" v-html="mealIconSvg[section.icon]"></span>
          <span><b>{{ t(section.key) }}</b><small>{{ section.key === 'activity' ? `${activitiesForSection().length} ${t('activities')}` : `${entriesForSection(section).length} ${t('entries')}` }}</small></span>
          <span class="section-summary-text">{{ sectionSummaryText(section) }}</span>
          <span v-if="state.settings.show_micronutrients && section.key !== 'activity'" class="meal-micro-button" role="button" :aria-label="t('mealMicronutrients')" :title="t('mealMicronutrients')" @click.stop.prevent="openMealMicronutrients(section)" v-html="lucideSvg('flaskConical')"></span>
          <span v-if="selectedDayUnlocked" class="plus-button">+</span>
        </button>
        <div v-if="section.key === 'activity'" class="entry-list">
          <div v-for="activity in activitiesForSection()" :key="activity.id" class="entry-row" @pointerdown="selectedDayUnlocked && startEntryLongPress('activity', activity.id, $event)" @pointerup="clearEntryLongPress" @pointercancel="clearEntryLongPress" @contextmenu.prevent="selectedDayUnlocked && (entryActionSheet = { kind: 'activity', id: activity.id })">
            <div><b>{{ activity.activity_name }}</b><small>{{ activity.duration_min }} min · {{ activity.kcal }} kcal</small></div>
            <div v-if="selectedDayUnlocked" class="entry-actions"><button class="entry-icon-button" :aria-label="t('duplicate')" :title="t('duplicate')" @click.stop="duplicateActivity(activity.id)" v-html="lucideSvg('refreshCw')"></button><button class="entry-icon-button" :aria-label="t('edit')" :title="t('edit')" @click.stop="editActivityLog(activity)" v-html="lucideSvg('pencil')"></button><button class="entry-icon-button danger" :aria-label="t('delete')" :title="t('delete')" @click.stop="removeActivity(activity.id)" v-html="lucideSvg('trash2')"></button></div>
          </div>
          <p v-if="!activitiesForSection().length" class="empty-line">{{ t('noActivity') }}</p>
        </div>
        <div v-else class="entry-list">
          <div v-for="entry in entriesForSection(section)" :id="`intake-entry-${entry.id}`" :key="entry.id" class="entry-row" :class="{ 'review-highlight': highlightedReviewIntakeId === entry.id }" @pointerdown="selectedDayUnlocked && startEntryLongPress('intake', entry.id, $event)" @pointerup="clearEntryLongPress" @pointercancel="clearEntryLongPress" @contextmenu.prevent="selectedDayUnlocked && (entryActionSheet = { kind: 'intake', id: entry.id })">
            <div><b>{{ itemTitle(foodFromIntake(entry)) }}</b><small>{{ amountLabel(entry.amount_g, foodFromIntake(entry)) }} · {{ intakeKcal(entry) }} kcal</small></div>
            <div v-if="selectedDayUnlocked" class="entry-actions"><button class="entry-icon-button" :aria-label="t('duplicate')" :title="t('duplicate')" @click.stop="openDuplicateIntakeTarget(entry)" v-html="lucideSvg('refreshCw')"></button><button class="entry-icon-button" :aria-label="t('edit')" :title="t('edit')" @click.stop="editIntake(entry)" v-html="lucideSvg('pencil')"></button><button class="entry-icon-button danger" :aria-label="t('delete')" :title="t('delete')" @click.stop="removeIntake(entry.id)" v-html="lucideSvg('trash2')"></button></div>
          </div>
          <p v-if="!entriesForSection(section).length" class="empty-line">{{ t('noEntries') }}</p>
        </div>
      </article>
    </section>

    <section v-if="activeTab === 'recipes'" class="page-stack">
      <article class="card catalog-search-card">
        <div class="catalog-search-header">
          <h2>{{ t('catalog') }}</h2>
          <div class="catalog-header-actions">
            <button class="scan-button" type="button" :aria-label="t('scanBarcodeQrAria')" @click="openScanner('catalog')" v-html="lucideSvg('scanLine')"></button>
            <div class="catalog-menu-wrap">
              <button class="icon-button" type="button" :aria-label="t('catalogMenu')" @click="catalogMenuOpen = !catalogMenuOpen">⋯</button>
              <div v-if="catalogMenuOpen" class="catalog-menu-popover">
                <button @click="openLocalCatalogEditor('ingredient')">{{ t('addLocalIngredient') }}</button>
                <button @click="openLocalCatalogEditor('food')">{{ t('addLocalFood') }}</button>
                <button @click="openLocalCatalogEditor('recipe')">{{ t('addLocalRecipe') }}</button>
                <button @click="openLocalCatalogEditor('activity')">{{ t('addLocalActivity') }}</button>
              </div>
            </div>
          </div>
        </div>
        <input v-model="search" class="input search-input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" spellcheck="false" :placeholder="t('syncedCatalogSearch')" @keydown.enter.prevent="hideKeyboard" />
        <label class="search-scope-control">
          <span>{{ t('searchIn') }}</span>
          <select v-model="catalogSearchScope" class="search-scope-select">
            <option v-for="scope in catalogSearchScopeOptions" :key="`catalog-scope-${scope}`" :value="scope">{{ t(`searchScope${scope.charAt(0).toUpperCase()}${scope.slice(1)}`) }}</option>
          </select>
        </label>
        <div class="catalog-freshness-row">
          <span>{{ t('ingredients') }}: {{ formatFreshness(latestIngredientUpdatedAt) }}</span>
          <span>{{ t('foods') }}: {{ formatFreshness(latestFoodUpdatedAt) }}</span>
          <span>{{ t('recipes') }}: {{ formatFreshness(latestRecipeUpdatedAt) }}</span>
          <span>{{ t('activities') }}: {{ formatFreshness(latestActivityUpdatedAt) }}</span>
        </div>
      </article>
      <template v-if="catalogSearchActive">
        <div v-if="catalogExactItems.length" class="search-result-heading">{{ t('exactMatches') }}</div>
        <article v-for="item in catalogExactItems" :key="`exact-${item.id}`" class="card catalog-card" :class="{ inactive: item.inactive === true, locked: catalogItemIsLocked(item) }">
          <div class="catalog-card-main"><div class="catalog-title-line"><b>{{ itemTitle(item) }}</b><span v-if="item.inactive" class="catalog-status-chip inactive">{{ t('inactive') }}</span><span v-if="catalogItemIsLocked(item)" class="catalog-status-chip locked">{{ t('locked') }}</span></div><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small><div class="catalog-meta-row"><span class="catalog-source-chip" :class="catalogSourceBadgeClass(item)">{{ catalogSourceTitle(item) }}</span><small v-if="sourceCheckedText(item)">{{ sourceCheckedText(item) }}</small></div></div>
          <div class="catalog-card-actions"><span>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)} g / db` : 'g' }}</span><div class="catalog-icon-actions"><button class="entry-icon-button" type="button" :aria-label="t('duplicate')" :title="t('duplicate')" @click="duplicateCatalogItem(item)" v-html="lucideSvg('copy')"></button><button class="entry-icon-button" type="button" :disabled="catalogSourceCheckBusyId === item.id" :aria-label="t('checkSource')" :title="t('checkSource')" @click="requestCatalogSourceCheck(item)" v-html="lucideSvg('refreshCw')"></button><button class="entry-icon-button" type="button" :aria-label="catalogItemIsLocked(item) ? t('unlock') : t('lock')" :title="catalogItemIsLocked(item) ? t('unlock') : t('lock')" @click="toggleCatalogItemLock(item)" v-html="lucideSvg(catalogItemIsLocked(item) ? 'lock' : 'lockOpen')"></button><button class="entry-icon-button" type="button" :aria-label="item.inactive ? t('activate') : t('markInactive')" :title="item.inactive ? t('activate') : t('markInactive')" @click="toggleCatalogItemInactive(item)" v-html="lucideSvg(item.inactive ? 'eye' : 'eyeOff')"></button></div><button class="text-button" @click="editCatalogItem(item)">{{ t('edit') }}</button></div>
        </article>
        <div v-if="catalogSuggestedItems.length" class="search-result-heading suggested">{{ t('maybeYouMean') }}</div>
        <article v-for="item in catalogSuggestedItems" :key="`suggested-${item.id}`" class="card catalog-card" :class="{ inactive: item.inactive === true, locked: catalogItemIsLocked(item) }">
          <div class="catalog-card-main"><div class="catalog-title-line"><b>{{ itemTitle(item) }}</b><span v-if="item.inactive" class="catalog-status-chip inactive">{{ t('inactive') }}</span><span v-if="catalogItemIsLocked(item)" class="catalog-status-chip locked">{{ t('locked') }}</span></div><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small><div class="catalog-meta-row"><span class="catalog-source-chip" :class="catalogSourceBadgeClass(item)">{{ catalogSourceTitle(item) }}</span><small v-if="sourceCheckedText(item)">{{ sourceCheckedText(item) }}</small></div></div>
          <div class="catalog-card-actions"><span>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)} g / db` : 'g' }}</span><div class="catalog-icon-actions"><button class="entry-icon-button" type="button" :aria-label="t('duplicate')" :title="t('duplicate')" @click="duplicateCatalogItem(item)" v-html="lucideSvg('copy')"></button><button class="entry-icon-button" type="button" :disabled="catalogSourceCheckBusyId === item.id" :aria-label="t('checkSource')" :title="t('checkSource')" @click="requestCatalogSourceCheck(item)" v-html="lucideSvg('refreshCw')"></button><button class="entry-icon-button" type="button" :aria-label="catalogItemIsLocked(item) ? t('unlock') : t('lock')" :title="catalogItemIsLocked(item) ? t('unlock') : t('lock')" @click="toggleCatalogItemLock(item)" v-html="lucideSvg(catalogItemIsLocked(item) ? 'lock' : 'lockOpen')"></button><button class="entry-icon-button" type="button" :aria-label="item.inactive ? t('activate') : t('markInactive')" :title="item.inactive ? t('activate') : t('markInactive')" @click="toggleCatalogItemInactive(item)" v-html="lucideSvg(item.inactive ? 'eye' : 'eyeOff')"></button></div><button class="text-button" @click="editCatalogItem(item)">{{ t('edit') }}</button></div>
        </article>
        <p v-if="!catalogHasSearchResults" class="empty-card">{{ t('noSyncedItems') }}</p>
      </template>
      <template v-else>
        <article v-for="item in visibleCatalogItems" :key="item.id" class="card catalog-card" :class="{ inactive: item.inactive === true, locked: catalogItemIsLocked(item) }">
          <div class="catalog-card-main"><div class="catalog-title-line"><b>{{ itemTitle(item) }}</b><span v-if="item.inactive" class="catalog-status-chip inactive">{{ t('inactive') }}</span><span v-if="catalogItemIsLocked(item)" class="catalog-status-chip locked">{{ t('locked') }}</span></div><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small><div class="catalog-meta-row"><span class="catalog-source-chip" :class="catalogSourceBadgeClass(item)">{{ catalogSourceTitle(item) }}</span><small v-if="sourceCheckedText(item)">{{ sourceCheckedText(item) }}</small></div></div>
          <div class="catalog-card-actions"><span>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)} g / db` : 'g' }}</span><div class="catalog-icon-actions"><button class="entry-icon-button" type="button" :aria-label="t('duplicate')" :title="t('duplicate')" @click="duplicateCatalogItem(item)" v-html="lucideSvg('copy')"></button><button class="entry-icon-button" type="button" :disabled="catalogSourceCheckBusyId === item.id" :aria-label="t('checkSource')" :title="t('checkSource')" @click="requestCatalogSourceCheck(item)" v-html="lucideSvg('refreshCw')"></button><button class="entry-icon-button" type="button" :aria-label="catalogItemIsLocked(item) ? t('unlock') : t('lock')" :title="catalogItemIsLocked(item) ? t('unlock') : t('lock')" @click="toggleCatalogItemLock(item)" v-html="lucideSvg(catalogItemIsLocked(item) ? 'lock' : 'lockOpen')"></button><button class="entry-icon-button" type="button" :aria-label="item.inactive ? t('activate') : t('markInactive')" :title="item.inactive ? t('activate') : t('markInactive')" @click="toggleCatalogItemInactive(item)" v-html="lucideSvg(item.inactive ? 'eye' : 'eyeOff')"></button></div><button class="text-button" @click="editCatalogItem(item)">{{ t('edit') }}</button></div>
        </article>
        <p v-if="!visibleCatalogItems.length" class="empty-card">{{ t('noSyncedItems') }}</p>
      </template>
    </section>

    <section v-if="activeTab === 'profile'" class="page-stack">
      <article class="profile-bmi-card">
        <div class="bmi-circle" :class="bmiInfo.tone">
          <strong>{{ currentBmi }}</strong>
          <span>BMI</span>
        </div>
        <h2>{{ bmiInfo.name }}</h2>
        <p>{{ bmiInfo.risk }}</p>
      </article>

      <article class="card profile-list">
        <label class="profile-tile">
          <span class="profile-tile-icon" v-html="lucideSvg('activity')"></span>
          <span><b>{{ t('activityLevel') }}</b><small>{{ t('activityLevelHint') }}</small></span>
          <select v-model="state.profile.activity_level" class="tile-input">
            <option value="sedentary">{{ t('sedentary') }}</option>
            <option value="low_active">{{ t('lowActive') }}</option>
            <option value="active">{{ t('active') }}</option>
            <option value="very_active">{{ t('veryActive') }}</option>
          </select>
        </label>
        <label class="profile-tile">
          <span class="profile-tile-icon" v-html="lucideSvg('star')"></span>
          <span><b>{{ t('weeklyGoal') }}</b><small>{{ state.profile.weekly_goal_kg > 0 ? '+' : '' }}{{ Number(state.profile.weekly_goal_kg).toFixed(2) }} {{ t('perWeek') }}</small></span>
          <input v-model.number="state.profile.weekly_goal_kg" class="tile-range" type="range" min="-1" max="1" step="0.25" />
        </label>
        <label class="profile-tile">
          <span class="profile-tile-icon" v-html="lucideSvg('scale')"></span>
          <span><b>{{ t('weight') }}</b><small>{{ t('kgUnit') }}</small></span>
          <input :value="state.profile.current_weight_kg" class="tile-input" type="number" min="2" max="640" step="0.1"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  @change="updateProfileWeight"  @keydown.enter="updateProfileWeight($event); hideKeyboard($event)" inputmode="decimal" />
        </label>
        <label class="profile-tile">
          <span class="profile-tile-icon" v-html="lucideSvg('ruler')"></span>
          <span><b>{{ t('height') }}</b><small>{{ t('cmUnit') }}</small></span>
          <input v-model.number="state.profile.height_cm" class="tile-input" type="number" min="30" max="300" step="1"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  inputmode="decimal" />
        </label>
        <label class="profile-tile">
          <span class="profile-tile-icon" v-html="lucideSvg('cakeSlice')"></span>
          <span><b>{{ t('age') }}</b><small>{{ age }} {{ t('years') }}</small></span>
          <input v-model="state.profile.birthday" class="tile-input" type="date" />
        </label>
        <label class="profile-tile">
          <span class="profile-tile-icon" v-html="lucideSvg('userRound')"></span>
          <span><b>{{ t('gender') }}</b><small>{{ t('genderHint') }}</small></span>
          <select v-model="state.profile.gender" class="tile-input">
            <option value="male">{{ t('male') }}</option>
            <option value="female">{{ t('female') }}</option>
            <option value="non_binary">{{ t('nonBinary') }}</option>
          </select>
        </label>
      </article>

      <article class="card pairing-card source-settings-card">
        <label class="tracking-toggle-card"><span><b>{{ t('desktopApiConnection') }}</b><small>{{ t('desktopApiConnectionBody') }}</small></span><input v-model="state.settings.desktop_api_enabled" type="checkbox" /></label>
        <details v-if="state.settings.desktop_api_enabled" class="source-details">
          <summary><span>{{ t('apiSettings') }}</span><small>{{ t('sourceSettings') }}</small></summary>
          <p class="helper" v-if="devMode">{{ t('devApiHint') }}</p>
          <p class="channel-chip">{{ t('appChannel') }}: {{ appChannel }}</p>
          <label class="field-label">{{ t('apiUrl') }}</label>
          <input v-model="state.pairing.baseUrl" class="input" placeholder="http://192.168.1.202:8090/api/v1" />
          <label class="field-label">{{ t('pairingPassword') }}</label>
          <input v-model="state.pairing.password" class="input" type="password" autocomplete="current-password" />
          <div class="button-row">
            <button class="outlined-button" @click="testConnection">{{ t('test') }}</button>
            <button class="filled-button" :disabled="syncBusy" @click="syncNow()">{{ t('syncNow') }}</button>
            <button class="outlined-button" :disabled="syncBusy" @click="pushNow()">{{ t('pushNow') }}</button>
          </div>
          <p class="helper">{{ t('localOnlyDiaryHint') }}</p>
          <p v-if="state.pairing.lastSyncError" class="error-text">{{ state.pairing.lastSyncError }}</p>
        </details>
      </article>

      <article class="card github-sync-card source-settings-card">
        <label class="tracking-toggle-card"><span><b>{{ t('githubCsvConnection') }}</b><small>{{ t('githubCsvConnectionBody') }}</small></span><input v-model="state.settings.github_csv_enabled" type="checkbox" /></label>
        <details v-if="state.settings.github_csv_enabled" class="source-details">
          <summary><span>{{ t('githubCsvSources') }}</span><small>{{ t('sourceSettings') }}</small></summary>
          <p class="helper">{{ t('githubCsvSourcesBody') }}</p>
          <div class="github-source-form">
            <input v-model="githubDraft.owner" class="input" :placeholder="t('githubOwnerPlaceholder')" autocomplete="off" autocapitalize="none" />
            <input v-model="githubDraft.repo" class="input" :placeholder="t('githubRepoPlaceholder')" autocomplete="off" autocapitalize="none" />
            <input v-model="githubDraft.branch" class="input" :placeholder="t('githubBranchPlaceholder')" autocomplete="off" autocapitalize="none" />
            <input v-model="githubDraft.path" class="input" :placeholder="t('githubPathPlaceholder')" autocomplete="off" autocapitalize="none" />
            <input v-model="githubDraft.token" class="input" type="password" :placeholder="t('githubTokenPlaceholder')" autocomplete="off" />
          </div>
          <div class="button-row">
            <button class="outlined-button" @click="addGitHubSource">{{ t('addRepo') }}</button>
            <button class="filled-button" :disabled="githubSyncBusy" @click="syncGitHubNow(true)">{{ t('syncGithubNow') }}</button>
          </div>
          <div v-if="(state.githubSources || []).length" class="github-source-list">
            <article v-for="source in (state.githubSources || [])" :key="source.id" class="github-source-row">
              <label><input v-model="source.enabled" type="checkbox" /> <b>{{ source.owner }}/{{ source.repo }}</b></label>
              <small>{{ source.branch || 'main' }}{{ source.path ? ` · ${source.path}` : '' }} · {{ source.lastStatus || t('notSyncedYet') }}</small>
              <button class="text-button danger-text" @click="removeGitHubSource(source.id)">{{ t('remove') }}</button>
            </article>
          </div>
        </details>
      </article>
    </section>

    <button v-if="activeTab === 'home' && !addMode && !settingsOpen" class="home-quick-fab" data-tour="quick-add" :aria-label="t('addNewItem')" @click="openQuickAddMenu()">+</button>

    <Teleport to="body">
      <div v-if="quickAddOpen" class="quick-add-backdrop app-overlay" @click.self="closeQuickAddMenu">
        <article class="quick-add-sheet">
          <h2>{{ t('addNewItem') }}:</h2>
          <button v-for="section in sections" :key="`quick-${section.key}`" class="quick-add-option" :class="{ 'notification-highlight': isNotificationHighlightedQuickAdd(section) }" @click="chooseQuickAdd(section)">
            <span class="material-icon" v-html="mealIconSvg[section.icon]"></span>
            <span><b>{{ t(section.key) }}</b><small>{{ sectionHint(section) }}</small></span>
          </button>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="addMode" class="sheet-backdrop app-overlay" @click.self="requestCloseSheet">
        <article class="bottom-sheet">
        <div class="sheet-handle"></div>
        <template v-if="addMode === 'food'">
          <h2>{{ editingIntakeId ? t('edit') : t('addTo') }} {{ t(addMealType) }}</h2>
          <div v-if="!editingIntakeId || mealEntryMode === 'note'" class="unit-toggle three meal-entry-toggle segmented-pill-toggle">
            <button type="button" :class="mealEntryMode === 'catalog' ? 'active' : ''" @click="startCatalogMealEntry">{{ t('existingItem') }}</button>
            <button type="button" class="note-toggle-button" :class="mealEntryMode === 'note' ? 'active' : ''" @click="startNoteMealEntry">{{ t('noteEntry') }}</button>
          </div>
          <div v-if="mealEntryMode === 'note'" class="note-entry-fields">
            <input v-model="noteTitle" class="input" type="text" autocomplete="off" :placeholder="t('kcalNoteTitle')" />
            <textarea v-model="noteDescription" class="input note-textarea" rows="3" :placeholder="t('kcalNoteDescription')"></textarea>
            <input v-model.number="noteKcal" class="input" type="number" min="1" step="1" :placeholder="t('kcalNoteValue')" @focus="selectNumberInput" @pointerdown="clearNumberInputOnDoubleTap" inputmode="decimal" />
            <button class="filled-button wide" type="button" @click="addMealNoteFromForm">{{ editingIntakeId ? t('update') : t('add') }}</button>
          </div>
          <template v-else>
          <article v-if="selectedCatalog" class="selected-item-card">
            <div class="selected-item-main">
              <b>{{ itemTitle(selectedCatalog) }}</b>
              <small>{{ catalogKindLabel(selectedCatalog) }} · {{ Math.round(selectedCatalog.kcal_per_100g) }} kcal / 100g</small><small v-if="selectedCatalog.note" class="catalog-note">{{ selectedCatalog.note }}</small>
            </div>
            <div class="selected-item-actions">
              <span v-if="selectedCatalogIsRecipe && recipeIsCustomized" class="custom-recipe-chip">✦ {{ t('customizedRecipe') }}</span>
              <button v-if="selectedCatalogIsRecipe && selectedRecipeComponents.length" class="selection-action-button recipe-action" :title="t('customRecipe')" :aria-label="t('editRecipeLocally')" @click="toggleRecipeCustomizer" v-html="lucideSvg('pencil')"></button>
              <button class="selection-action-button change-action" :title="t('changeSelection')" :aria-label="t('changeSelection')" @click="openCatalogPickerForChange" v-html="lucideSvg('refreshCw')"></button>
            </div>
          </article>
          <div v-if="foodSelectionInProgress" class="catalog-picker-zone meal-picker-zone">
            <div class="sticky-picker-search">
              <input v-model="search" class="input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" spellcheck="false" :placeholder="t('foodAndRecipeSearch')" @keydown.enter.prevent="hideKeyboard" />
              <button class="scan-button" type="button" :aria-label="t('scanBarcodeQrAria')" @click="openScanner('barcode')" v-html="lucideSvg('scanLine')"></button>
            </div>
            <label class="search-scope-control compact">
              <span>{{ t('searchIn') }}</span>
              <select v-model="catalogSearchScope" class="search-scope-select">
                <option v-for="scope in catalogSearchScopeOptions" :key="`picker-catalog-scope-${scope}`" :value="scope">{{ t(`searchScope${scope.charAt(0).toUpperCase()}${scope.slice(1)}`) }}</option>
              </select>
            </label>
            <div class="picker-list grouped-picker">
              <div v-if="selectedCatalog" class="picker-group selected-picker-group">
                <div class="picker-group-title">{{ t('selected') }}</div>
                <button class="picker-row selected" @click="chooseCatalogItem(selectedCatalog)">
                  <span><b>{{ itemTitle(selectedCatalog) }}</b><small>{{ catalogKindLabel(selectedCatalog) }} · {{ Math.round(selectedCatalog.kcal_per_100g) }} kcal / 100g</small><small v-if="selectedCatalog.note" class="catalog-note">{{ selectedCatalog.note }}</small></span>
                  <strong>{{ selectedCatalog.serving_size_g ? `${Math.round(selectedCatalog.serving_size_g)}g/db` : 'g' }}</strong>
                </button>
              </div>
              <template v-if="catalogSearchActive">
                <div v-if="catalogExactPickerItems.length" class="picker-group">
                  <div class="picker-group-title">{{ t('exactMatches') }}</div>
                  <button v-for="item in catalogExactPickerItems" :key="`picker-exact-${item.id}`" class="picker-row" :class="selectedCatalogId === item.id ? 'selected' : ''" @click="chooseCatalogItem(item)">
                    <span><b>{{ itemTitle(item) }}</b><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
                <div v-if="catalogSuggestedPickerItems.length" class="picker-group suggested-picker-group">
                  <div class="picker-group-title">{{ t('maybeYouMean') }}</div>
                  <button v-for="item in catalogSuggestedPickerItems" :key="`picker-suggested-${item.id}`" class="picker-row" :class="selectedCatalogId === item.id ? 'selected' : ''" @click="chooseCatalogItem(item)">
                    <span><b>{{ itemTitle(item) }}</b><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
                <div v-if="reusableMealNoteSuggestions.length" class="picker-group note-suggestion-group">
                  <div class="picker-group-title">{{ t('previousMealNotes') }}</div>
                  <button v-for="note in reusableMealNoteSuggestions" :key="`picker-note-${note.key}`" class="picker-row note-suggestion-row" @click="useMealNoteSuggestion(note)">
                    <span><b>{{ note.title }}</b><small>{{ note.kcal }} kcal · {{ t('noteEntry') }}<template v-if="note.count > 1"> · ×{{ note.count }}</template></small><small v-if="note.description" class="catalog-note">{{ note.description }}</small></span>
                    <strong>{{ t('useNote') }}</strong>
                  </button>
                </div>
              </template>
              <template v-else>
                <div v-if="visibleRecipeItems.length" class="picker-group">
                  <div class="picker-group-title">{{ t('recipes') }}</div>
                  <button v-for="item in visibleRecipeItems" :key="item.id" class="picker-row" :class="selectedCatalogId === item.id ? 'selected' : ''" @click="chooseCatalogItem(item)">
                    <span><b>{{ itemTitle(item) }}</b><small>{{ item.brand || t('recipe') }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
                <div v-if="visibleIngredientItems.length" class="picker-group">
                  <div class="picker-group-title">{{ t('ingredient') }}</div>
                  <button v-for="item in visibleIngredientItems" :key="item.id" class="picker-row" :class="selectedCatalogId === item.id ? 'selected' : ''" @click="chooseCatalogItem(item)">
                    <span><b>{{ itemTitle(item) }}</b><small>{{ t('ingredient') }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
                <div v-if="visibleFoodItems.length" class="picker-group">
                  <div class="picker-group-title">{{ t('foods') }}</div>
                  <button v-for="item in visibleFoodItems" :key="item.id" class="picker-row" :class="selectedCatalogId === item.id ? 'selected' : ''" @click="chooseCatalogItem(item)">
                    <span><b>{{ itemTitle(item) }}</b><small>{{ item.brand || t('food') }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
              </template>
            </div>
          </div>
          <div v-if="recipeCustomizeOpen && selectedRecipeComponents.length" class="recipe-customizer">
            <div class="recipe-customizer-title"><b>{{ t('customRecipe') }}</b><small>{{ t('customRecipeHint') }}</small></div>
            <div v-if="selectedRecipeCustomPreview" class="live-nutrition-preview recipe-live-preview">
              <b>{{ selectedRecipeCustomPreview.kcal }} kcal</b>
              <span v-if="selectedRecipeCustomPreview.servingWeight">{{ selectedRecipeCustomPreview.servingWeight }} g / 1 db</span>
              <span v-else>{{ selectedRecipeCustomPreview.recipeWeight }} g total</span>
              <small>Total: C {{ selectedRecipeCustomPreview.carbs }}g · F {{ selectedRecipeCustomPreview.fat }}g · P {{ selectedRecipeCustomPreview.protein }}g</small>
              <small>{{ selectedRecipeCustomPreview.kcalPer100g }} kcal / 100g · C {{ selectedRecipeCustomPreview.carbsPer100g }}g · F {{ selectedRecipeCustomPreview.fatPer100g }}g · P {{ selectedRecipeCustomPreview.proteinPer100g }}g<span v-if="selectedRecipeCustomPreview.extraKcal"> · {{ selectedRecipeCustomPreview.extraKcal }} extra kcal</span></small>
              <label class="field-label recipe-extra-kcal-field">{{ t('extraKcalForThisEntry') }}<input v-model.number="recipeCustomExtraKcal" class="input" type="number" step="any" inputmode="decimal" @focus="selectNumberInput" @pointerdown="clearNumberInputOnDoubleTap" /></label>
            </div>
            <div v-for="row in selectedRecipeComponents" :key="row.key" class="recipe-ingredient-row">
              <div><b>{{ row.name }}</b><small>{{ t('baseAmount') }} {{ row.baseAmount }} g<span v-if="row.servingSize"> · {{ Math.round(row.servingSize) }} g/{{ t('onePiece') }}</span></small><small class="ingredient-nutrition-line">{{ recipeComponentNutrition(row).kcal }} kcal · {{ recipeComponentNutrition(row).weight }} g · C {{ recipeComponentNutrition(row).carbs }}g · F {{ recipeComponentNutrition(row).fat }}g · P {{ recipeComponentNutrition(row).protein }}g</small></div>
              <div class="ingredient-inputs">
                <label v-if="row.servingSize"><input :value="componentQty(row)" type="number" min="0" step="0.5" @input="setComponentQty(row, $event)"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  inputmode="decimal" /> <span>db</span></label>
                <label><input v-model.number="recipeIngredientAmounts[row.key]" type="number" min="0" step="0.1"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  inputmode="decimal" /> <span>g</span></label>
              </div>
            </div>
            <div class="recipe-customizer-actions">
              <button class="filled-button wide recipe-customizer-ok" type="button" @click="confirmRecipeCustomization">{{ t('ok') }}</button>
            </div>
          </div>
          <div v-if="foodFormVisible" class="selected-entry-fields">
            <div class="unit-toggle" :class="{ disabled: !selectedCatalog?.serving_size_g }">
              <button type="button" :class="foodUnit === 'g' ? 'active' : ''" @click="foodUnit = 'g'">g</button>
              <button type="button" :disabled="!selectedCatalog?.serving_size_g" :class="foodUnit === 'serving' ? 'active' : ''" @click="foodUnit = 'serving'">db</button>
            </div>
            <input v-model.number="foodAmount" class="input" type="number" min="0" step="0.1" :placeholder="foodUnit === 'g' ? t('grams') : t('pieces')"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  inputmode="decimal" />
            <small v-if="selectedCatalogAmountHint" class="input-help">{{ selectedCatalogAmountHint }}</small>
            <div v-if="selectedMealAmountPreview" class="live-nutrition-preview meal-live-preview">
              <b>{{ selectedMealAmountPreview.kcal }} kcal</b>
              <span>{{ selectedMealAmountPreview.amountG }} g</span>
              <small>{{ selectedMealAmountPreview.kcalPer100g }} kcal / 100g will be saved</small>
            </div>
            <button class="filled-button wide" @click="addFoodLog">{{ editingIntakeId ? t('update') : t('add') }}</button>
          </div>
          </template>
        </template>
        <template v-else>
          <h2>{{ editingActivityLogId ? t('edit') : t('addActivity') }}</h2>
          <div class="unit-toggle three meal-entry-toggle segmented-pill-toggle activity-source-toggle">
            <button type="button" :class="activitySource === 'activity_catalog' ? 'active' : ''" @click="activitySource = 'activity_catalog'; clearSelectedActivityForChange()">{{ t('catalog') }}</button>
            <button type="button" :class="activitySource === 'watch' ? 'active' : ''" @click="activitySource = 'watch'; clearSelectedActivityForChange()">{{ t('watch') }}</button>
            <button type="button" :class="activitySource === 'manual' ? 'active' : ''" @click="activitySource = 'manual'; clearSelectedActivityForChange()">{{ t('manual') }}</button>
          </div>
          <article v-if="activitySource === 'activity_catalog' && selectedActivity" class="selected-item-card">
            <div class="selected-item-main">
              <div class="catalog-title-line"><b>{{ activityDisplayName(selectedActivity) }}</b><span v-if="selectedActivity.inactive" class="catalog-status-chip inactive">{{ t('inactive') }}</span><span v-if="catalogItemIsLocked(selectedActivity)" class="catalog-status-chip locked">{{ t('locked') }}</span></div>
              <small>{{ activityType(selectedActivity) }} · {{ selectedActivity.kcal_per_min }} kcal/min</small>
              <div class="catalog-meta-row compact"><span class="catalog-source-chip" :class="catalogSourceBadgeClass(selectedActivity)">{{ catalogSourceTitle(selectedActivity) }}</span><small v-if="sourceCheckedText(selectedActivity)">{{ sourceCheckedText(selectedActivity) }}</small></div>
            </div>
            <div class="selected-item-actions selected-activity-actions">
              <button class="entry-icon-button" type="button" :title="t('changeSelection')" :aria-label="t('changeSelection')" @click="clearSelectedActivityForChange" v-html="lucideSvg('refreshCw')"></button>
              <button class="entry-icon-button" type="button" :title="t('duplicate')" :aria-label="t('duplicate')" @click="duplicateActivityCatalogItem(selectedActivity)" v-html="lucideSvg('copy')"></button>
              <button class="entry-icon-button" type="button" :disabled="catalogSourceCheckBusyId === selectedActivity.id" :title="t('checkSource')" :aria-label="t('checkSource')" @click="requestCatalogSourceCheck(selectedActivity)" v-html="lucideSvg('refreshCw')"></button>
              <button class="entry-icon-button" type="button" :title="catalogItemIsLocked(selectedActivity) ? t('unlock') : t('lock')" :aria-label="catalogItemIsLocked(selectedActivity) ? t('unlock') : t('lock')" @click="toggleCatalogItemLock(selectedActivity)" v-html="lucideSvg(catalogItemIsLocked(selectedActivity) ? 'lock' : 'lockOpen')"></button>
              <button class="entry-icon-button" type="button" :title="selectedActivity.inactive ? t('activate') : t('markInactive')" :aria-label="selectedActivity.inactive ? t('activate') : t('markInactive')" @click="toggleCatalogItemInactive(selectedActivity)" v-html="lucideSvg(selectedActivity.inactive ? 'eye' : 'eyeOff')"></button>
              <button class="entry-icon-button" type="button" :title="t('edit')" :aria-label="t('edit')" @click="editActivityCatalogItem(selectedActivity)" v-html="lucideSvg('pencil')"></button>
            </div>
          </article>
          <div v-if="activitySelectionInProgress" class="sticky-picker-search">
            <input v-model="search" class="input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" spellcheck="false" :placeholder="t('activitySearch')" @keydown.enter.prevent="hideKeyboard" />
            <button class="scan-button" type="button" :aria-label="t('scanQrAria')" @click="openScanner('catalog')" v-html="lucideSvg('scanLine')"></button>
          </div>
          <div v-if="activitySelectionInProgress" class="picker-list">
            <button v-for="activity in visibleActivities" :key="activity.id" class="picker-row" :class="activityId === activity.id ? 'selected' : ''" @click="chooseActivity(activity)">
              <span class="picker-row-main"><span class="catalog-title-line"><b>{{ activityDisplayName(activity) }}</b><span v-if="activity.inactive" class="catalog-status-chip inactive">{{ t('inactive') }}</span><span v-if="catalogItemIsLocked(activity)" class="catalog-status-chip locked">{{ t('locked') }}</span></span><small>{{ activityType(activity) }} · MET {{ activity.met }}</small><span class="catalog-meta-row compact"><span class="catalog-source-chip" :class="catalogSourceBadgeClass(activity)">{{ catalogSourceTitle(activity) }}</span><small v-if="sourceCheckedText(activity)">{{ sourceCheckedText(activity) }}</small></span></span>
              <strong>{{ activity.kcal_per_min }} kcal/min</strong>
            </button>
          </div>
          <div v-if="activityFormVisible" class="selected-entry-fields">
            <input v-model.number="activityMinutes" class="input" type="number" min="1" step="1" :placeholder="t('minutes')"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  inputmode="decimal" />
            <input v-if="activitySource !== 'activity_catalog'" v-model.number="activityKcal" class="input" type="number" min="1" step="1" :placeholder="t('kcalFromWatchManual')"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  inputmode="decimal" />
            <button class="filled-button wide" @click="addActivityLog">{{ editingActivityLogId ? t('updateActivity') : t('addActivity') }}</button>
          </div>
        </template>
        </article>
      </div>
    </Teleport>


    <Teleport to="body">
      <div v-if="weightReminderModalOpen" class="dialog-backdrop" @click.self="closeWeightReminderModal">
        <article class="settings-dialog weight-reminder-dialog">
          <div class="dialog-title-row">
            <h2>{{ t('weightReminderTitle') }}</h2>
            <button class="text-button" type="button" @click="closeWeightReminderModal">{{ t('cancel') }}</button>
          </div>
          <p class="helper big">{{ t('weightReminderBody') }}</p>
          <label class="field-label">{{ t('weightForThisDay') }}</label>
          <div class="inline-form compact weight-reminder-form">
            <input v-model.number="weightInput" class="input" type="number" min="1" step="0.1" :placeholder="t('kgUnit')" @focus="selectNumberInput" @pointerdown="clearNumberInputOnDoubleTap" inputmode="decimal" />
            <button class="filled-button" type="button" @click="saveWeightReminderModal">{{ t('saveWeight') }}</button>
          </div>
        </article>
      </div>
    </Teleport>


    <Teleport to="body">
      <div v-if="localEditorOpen" class="dialog-backdrop" @click.self="requestCloseLocalEditor">
        <article class="settings-dialog local-editor-dialog">
          <div class="dialog-title-row">
            <h2>{{ localEditorDuplicate ? t('duplicate') : localEditorId ? t('edit') : t('add') }} {{ localEditorKind === 'ingredient' ? t('ingredient') : localEditorKind === 'food' ? t('food') : localEditorKind === 'recipe' ? t('recipe') : t('addActivity') }}</h2>
            <button class="text-button" @click="requestCloseLocalEditor">{{ t('cancel') }}</button>
          </div>
          <label class="field-label">{{ t('name') }}</label>
          <input v-model="localCatalogForm.name" class="input" autocomplete="off" />
          <details class="local-i18n-panel">
            <summary><span>{{ t('translations') }}</span><small>{{ t('translationsHint') }}</small></summary>
            <div class="local-i18n-head" v-if="localNameI18nEntries().length"><span>{{ t('translationLanguage') }}</span><span>{{ t('translationValue') }}</span></div>
            <div v-if="!localNameI18nEntries().length" class="empty-card compact">{{ t('noTranslations') }}</div>
            <div v-for="[code] in localNameI18nEntries()" :key="code" class="local-i18n-row">
              <span>{{ languageLabel(code) }}</span>
              <input v-model="ensureLocalNameI18n()[code]" class="input" />
              <button type="button" class="text-button danger" @click="removeLocalNameTranslation(code)">{{ t('delete') }}</button>
            </div>
            <select class="input local-i18n-add-select" @change="addLocalNameTranslation($event)">
              <option value="">{{ t('translationAddPlaceholder') }}</option>
              <option v-for="language in availableLocalTranslationLanguages()" :key="language.code" :value="language.code">{{ language.englishName }} · {{ language.nativeName }} ({{ language.code }})</option>
            </select>
          </details>
          <label class="tracking-toggle-card local-editor-toggle">
            <span><b>{{ t('inactiveCatalogItem') }}</b><small>{{ t('inactiveCatalogItemHint') }}</small></span>
            <input v-model="localCatalogForm.inactive" type="checkbox" />
          </label>

          <template v-if="localEditorKind === 'ingredient' || localEditorKind === 'food'">
            <label v-if="localEditorKind === 'food'" class="field-label">{{ t('brandSource') }}</label>
            <input v-if="localEditorKind === 'food'" v-model="localCatalogForm.brand" class="input" :placeholder="t('optional')" />
            <label v-if="localEditorKind === 'food'" class="field-label">{{ t('barcodeQr') }}</label>
            <div v-if="localEditorKind === 'food'" class="inline-field-action">
              <input v-model="localCatalogForm.barcode" class="input" :placeholder="t('optional')" />
              <button class="scan-button" type="button" :aria-label="t('scanBarcodeQrAria')" @click="openScanner('barcode')" v-html="lucideSvg('scanLine')"></button>
            </div>
            <label class="field-label">{{ t('note') }}</label>
            <input v-model="localCatalogForm.note" class="input" :placeholder="t('optional')" />
            <div class="nutrient-form-section">
              <b>{{ t('importantNutrients') }}</b>
              <div class="form-grid-two">
                <label class="field-label">{{ t('kcalPer100g') }}<input v-model.number="localCatalogForm.kcal_per_100g" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
                <label class="field-label">{{ t('servingSizeG') }}<input v-model.number="localCatalogForm.serving_size_g" class="input" type="number" min="0" step="0.1" inputmode="decimal" :placeholder="t('optional')" /></label>
                <label class="field-label">{{ t('carbs') }}<input v-model.number="localCatalogForm.carbs_per_100g" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
                <label class="field-label">{{ t('fat') }}<input v-model.number="localCatalogForm.fat_per_100g" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
                <label class="field-label">{{ t('protein') }}<input v-model.number="localCatalogForm.protein_per_100g" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
              </div>
            </div>
            <details v-if="state.settings.show_micronutrients" class="optional-nutrients-panel" open>
              <summary><span>{{ t('optionalNutrients') }}</span><small>{{ t('optionalNutrientsHint') }}</small></summary>
              <div class="form-grid-two">
                <label v-for="nutrient in optionalNutrientDefinitions" :key="nutrient.key" class="field-label">{{ t(nutrient.labelKey) }} / 100g
                  <input :value="localOptionalNutrientValue(nutrient)" class="input" type="number" min="0" step="0.01" inputmode="decimal" :placeholder="t('optional')" @input="setOptionalNutrientValueFromEvent(nutrient, $event)" />
                </label>
              </div>
            </details>
          </template>

          <template v-else-if="localEditorKind === 'recipe'">
            <label class="field-label">{{ t('description') }}</label>
            <textarea v-model="localCatalogForm.description" class="input textarea-input" rows="2"></textarea>
            <label class="field-label">{{ t('note') }}</label>
            <input v-model="localCatalogForm.note" class="input" :placeholder="t('optional')" />
            <div class="form-grid-two">
              <label class="field-label">{{ t('extraKcal') }}<input v-model.number="localCatalogForm.extra_kcal" class="input" type="number" step="any" inputmode="decimal" @focus="selectNumberInput" @pointerdown="clearNumberInputOnDoubleTap" /><small class="input-help">{{ t('recipeExtraKcalHelp') }}</small></label>
              <label class="field-label">{{ t('servings') }}<input v-model.number="localCatalogForm.servings_count" class="input" type="number" min="0" step="0.1" inputmode="decimal" :placeholder="t('optional')" /><small class="input-help">{{ t('servingsEmptyHelp') }}</small></label>
            </div>
            <div class="local-recipe-items">
              <div class="dialog-title-row compact-title"><b>{{ t('localRecipeItemsTitle') }}</b><button class="text-button" type="button" @click="addLocalRecipeItem">{{ t('add') }}</button></div>
              <div v-for="(row, index) in localRecipeItems" :key="`local-recipe-row-${index}`" class="local-recipe-builder-card">
                <div class="local-recipe-row-head">
                  <div>
                    <b>{{ localRecipeRowItem(row) ? localRecipeItemLabel(row.food_id) : t('selectItem') }}</b>
                    <small>{{ localRecipeRowItem(row) ? localRecipeRowHint(row) : t('localRecipeSearchHint') }}</small>
                  </div>
                  <button class="text-button danger" type="button" @click="removeLocalRecipeItem(index)">{{ t('delete') }}</button>
                </div>
                <div class="inline-field-action local-recipe-search-action">
                  <input v-model="row.query" class="input" type="search" autocomplete="off" autocapitalize="none" spellcheck="false" :placeholder="t('searchItem')" @focus="openLocalRecipeRowPicker(row)" />
                  <button class="compact-action-button" type="button" :aria-label="t('searchAria')" @click="openLocalRecipeRowPicker(row)">{{ t('find') }}</button>
                </div>
                <div v-if="row.pickerOpen" class="local-recipe-search-results">
                  <button v-for="item in localRecipeRowResults(row)" :key="`recipe-builder-${index}-${item.id}`" class="picker-row compact-picker-row" type="button" :class="row.food_id === item.id ? 'selected' : ''" @click="chooseLocalRecipeItem(row, item)">
                    <span><b>{{ itemTitle(item) }}</b><small>{{ catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                  <p v-if="!localRecipeRowResults(row).length" class="empty-card compact-empty">{{ t('noMatchingItem') }}</p>
                </div>
                <div class="recipe-row-amount-editor">
                  <div class="unit-toggle" :class="{ disabled: !localRecipeRowItem(row)?.serving_size_g }">
                    <button type="button" :class="row.unit === 'g' ? 'active' : ''" @click="setLocalRecipeRowUnit(row, 'g')">g</button>
                    <button type="button" :disabled="!localRecipeRowItem(row)?.serving_size_g" :class="row.unit === 'serving' ? 'active' : ''" @click="setLocalRecipeRowUnit(row, 'serving')">db</button>
                  </div>
                  <input :value="localRecipeInputValue(row)" class="input" type="number" min="0" step="0.1" inputmode="decimal" :placeholder="row.unit === 'g' ? t('grams') : t('pieces')" @input="updateLocalRecipeRowAmount(row, $event)" @focus="selectNumberInput" @pointerdown="clearNumberInputOnDoubleTap" />
                </div>
                <div v-if="localRecipeRowItem(row)" class="recipe-row-nutrition">
                  <b>{{ localRecipeRowNutrition(row).kcal }} kcal</b>
                  <span>{{ localRecipeRowNutrition(row).weight }} g</span>
                  <small>C {{ localRecipeRowNutrition(row).carbs }}g · F {{ localRecipeRowNutrition(row).fat }}g · P {{ localRecipeRowNutrition(row).protein }}g</small>
                </div>
              </div>
              <div class="live-nutrition-preview recipe-editor-preview">
                <b>{{ localRecipeNutritionPreview.kcal }} kcal</b>
                <span>{{ localRecipeNutritionPreview.weight }} g total<span v-if="localRecipeNutritionPreview.servingWeight"> · {{ localRecipeNutritionPreview.servingWeight }} g / serving</span><span v-if="localRecipeNutritionPreview.extraKcal"> · {{ localRecipeNutritionPreview.extraKcal }} extra kcal</span></span>
                <small>Total: C {{ localRecipeNutritionPreview.carbs }}g · F {{ localRecipeNutritionPreview.fat }}g · P {{ localRecipeNutritionPreview.protein }}g</small>
                <small>{{ localRecipeNutritionPreview.kcalPer100g }} kcal / 100g · C {{ localRecipeNutritionPreview.carbsPer100g }}g · F {{ localRecipeNutritionPreview.fatPer100g }}g · P {{ localRecipeNutritionPreview.proteinPer100g }}g</small>
              </div>
            </div>
            <p class="helper">{{ t('mobileRecipeSyncHint') }}</p>
          </template>

          <template v-else>
            <label class="field-label">{{ t('code') }}</label>
            <input v-model="localCatalogForm.code" class="input" :placeholder="t('optional')" />
            <label class="field-label">{{ t('description') }}</label>
            <textarea v-model="localCatalogForm.description" class="input textarea-input" rows="2"></textarea>
            <div class="form-grid-two">
              <label class="field-label">{{ t('type') }}<input v-model="localCatalogForm.activity_type" class="input" /></label>
              <label class="field-label">{{ t('kcalPerMin') }}<input v-model.number="localCatalogForm.kcal_per_min" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
              <label class="field-label">MET<input v-model.number="localCatalogForm.met" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
            </div>
          </template>

          <div class="dialog-actions">
            <button class="text-button" @click="requestCloseLocalEditor">{{ t('cancel') }}</button>
            <button class="filled-button" @click="saveLocalCatalogEditor">{{ t('save') }}</button>
          </div>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <section v-if="analysisOpen" class="analysis-screen app-overlay">
        <header class="settings-header"><button class="back-button" @click="analysisOpen = false" v-html="lucideSvg('chevronLeft')"></button><h2>{{ t('analysis') }}</h2></header>
        <div class="analysis-content">
          <article class="card analysis-summary-card">
            <div><span>{{ t('currentStreak') }}</span><b>{{ currentDeficitStreak }} {{ t('days') }}</b></div>
            <div><span>{{ t('bestStreak') }}</span><b>{{ bestDeficitStreak }} {{ t('days') }}</b></div>
            <div><span>{{ t('successRate') }}</span><b>{{ calorieSuccessRate }}%</b></div>
          </article>

          <article class="card analysis-card">
            <div class="analysis-card-header compact">
              <h2>{{ t('calorieTrend') }}</h2>
              <button class="info-button" type="button" :aria-label="t('legend')" @click="calorieLegendOpen = !calorieLegendOpen" v-html="lucideSvg('info')"></button>
            </div>
            <div v-if="calorieLegendOpen" class="chart-legend">
              <span><i class="legend-box consumed"></i>{{ t('consumedLegend') }}</span>
              <span><i class="legend-line full"></i>{{ t('fullLimit') }}</span>
              <span v-if="calorieDeficitEnabled"><i class="legend-line effective"></i>{{ t('effectiveLimit') }}</span>
            </div>
            <div class="calorie-chart">
              <button v-for="row in analysisDailyRows" :key="`calorie-${row.key}`" type="button" class="calorie-bar-wrap" :class="{ selected: row.key === selectedCalorieChartRow.key }" @click="selectedCalorieRowKey = row.key">
                <span class="calorie-bar-track">
                  <span class="calorie-limit-line full" :style="{ bottom: `${Math.min(96, row.dailyLimitKcal / calorieChartMax * 100)}%` }"></span>
                  <span v-if="calorieDeficitEnabled && row.deficitKcal > 0" class="calorie-limit-line effective" :style="{ bottom: `${Math.min(96, row.effectiveLimitKcal / calorieChartMax * 100)}%` }"></span>
                  <span :class="['calorie-bar', row.tone]" :style="{ height: `${Math.min(100, row.consumedKcal / calorieChartMax * 100)}%` }"></span>
                </span>
                <small>{{ row.label }}</small>
              </button>
            </div>
            <p class="helper big">
              <b>{{ selectedCalorieChartRow.label }}</b> ·
              {{ selectedCalorieChartRow.consumedKcal }} / {{ calorieDeficitEnabled ? selectedCalorieChartRow.effectiveLimitKcal : selectedCalorieChartRow.dailyLimitKcal }} kcal
              <span v-if="calorieDeficitEnabled">({{ selectedCalorieChartRow.dailyLimitKcal }} kcal {{ t('fullLimit') }})</span>
              · {{ t('burned') }}: {{ selectedCalorieChartRow.burnedKcal }} kcal
            </p>
          </article>

          <article class="card analysis-card">
            <div class="analysis-card-header">
              <h2>{{ t('weightTrend') }}</h2>
              <button class="info-button" type="button" :aria-label="t('legend')" @click="weightLegendOpen = !weightLegendOpen" v-html="lucideSvg('info')"></button>
            </div>
            <div class="trend-mode-toggle weight-mode-row" role="tablist" :aria-label="t('weightTrend')">
              <button type="button" :class="{ active: weightTrendMode === 'daily' }" @click="weightTrendMode = 'daily'">{{ weightTrendModeLabel('daily') }}</button>
              <button type="button" :class="{ active: weightTrendMode === 'weekly' }" @click="weightTrendMode = 'weekly'">{{ weightTrendModeLabel('weekly') }}</button>
              <button type="button" :class="{ active: weightTrendMode === 'monthly' }" @click="weightTrendMode = 'monthly'">{{ weightTrendModeLabel('monthly') }}</button>
            </div>
            <div v-if="weightLegendOpen" class="chart-legend">
              <span><i class="legend-box weight"></i>{{ t('weightLegendValue') }}</span>
              <span><i class="legend-dot selected"></i>{{ t('selected') }}</span>
            </div>
            <template v-if="analysisWeightRows.length">
              <div class="weight-axis-chart">
                <div class="weight-y-axis"><span v-for="tick in weightChartScale.ticks" :key="`tick-${tick}`">{{ tick }} kg</span></div>
                <div class="weight-bar-chart">
                  <button v-for="row in analysisWeightRows" :key="row.key" type="button" class="weight-bar-wrap" :class="{ selected: row.key === selectedWeightChartRow?.key }" @click="selectedWeightRowKey = row.key">
                    <span class="weight-bar-track"><span class="weight-bar" :style="{ height: `${weightBarHeight(row)}%` }"></span></span>
                    <small>{{ row.label }}</small>
                  </button>
                </div>
              </div>
              <p v-if="selectedWeightChartRow" class="helper big"><b>{{ selectedWeightChartRow.label }}</b> · {{ selectedWeightChartRow.weightKg.toFixed(1) }} kg <span v-if="selectedWeightChartRow.limitedData">· {{ t('limitedData') }}</span></p>
            </template>
            <p v-else class="helper big">{{ t('noWeightTrend') }}</p>
          </article>
        </div>
      </section>
    </Teleport>

    <Teleport to="body">
      <div v-if="nutrientInsightsDialog && state.settings.show_micronutrients" class="dialog-backdrop" @click.self="closeNutrientInsights">
        <article class="settings-dialog meal-micronutrients-dialog nutrient-insights-dialog">
          <div class="dialog-title-row">
            <h2>{{ nutrientInsightTitle }}</h2>
            <button class="icon-button dialog-close-icon" type="button" :aria-label="t('close')" :title="t('close')" @click="closeNutrientInsights" v-html="lucideSvg('x')"></button>
          </div>
          <div class="trend-mode-toggle nutrient-chart-toggle">
            <button :class="{ active: nutrientChartMode === 'important' }" type="button" @click="nutrientChartMode = 'important'">{{ t('importantNutrients') }}</button>
            <button :class="{ active: nutrientChartMode === 'optional' }" type="button" @click="nutrientChartMode = 'optional'">{{ t('optionalNutrients') }}</button>
          </div>
          <div v-if="nutrientChartSlices.length" class="nutrient-pie-card">
            <div class="nutrient-pie-chart" :style="{ background: nutrientChartBackground(nutrientChartSlices) }"></div>
            <div class="nutrient-pie-legend">
              <div v-for="slice in nutrientChartSlices" :key="`slice-${slice.label}`" class="nutrient-pie-legend-row">
                <span class="nutrient-pie-legend-dot" :style="{ background: slice.color }"></span>
                <span class="nutrient-pie-legend-label">{{ slice.label }}</span>
                <span class="nutrient-pie-legend-value">{{ slice.amount }}</span>
                <small>{{ slice.note }}</small>
              </div>
            </div>
          </div>
          <p v-else class="today-nutrient-empty">{{ t('noChartData') }}</p>
          <div v-if="nutrientInsightRows.length" class="today-nutrient-list meal-micronutrient-list nutrient-insight-list">
            <div v-for="row in nutrientInsightRows" :key="`insight-nutrient-${row.key}`" class="today-nutrient-row nutrient-insight-row">
              <span class="today-nutrient-row-label">{{ row.label }}</span>
              <template v-if="nutrientInsightsDialog.kind === 'meal'">
                <span class="today-nutrient-row-value" :class="`nutrient-tone-${row.tone}`">{{ formatNutrientAmount(row.value, row.unit) }}</span>
                <small>({{ formatNutrientAmount(row.dailyValue, row.unit) }})</small>
              </template>
              <template v-else>
                <span class="today-nutrient-row-value" :class="`nutrient-tone-${row.tone}`">{{ formatNutrientAmount(row.value, row.unit) }}</span>
                <small>{{ formatNutrientAmount(row.limit, row.unit) }}</small>
              </template>
              <span v-if="row.isOver" class="nutrient-row-alert">!</span>
            </div>
          </div>
          <p v-else class="today-nutrient-empty">{{ t('noNutrientsLogged') }}</p>
          <p v-if="nutrientInsightExceededCount" class="helper big">! {{ nutrientInsightExceededCount }} {{ t('exceeded') }}</p>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="updateDialogOpen && updateCheckResult?.release" class="dialog-backdrop app-overlay" @click.self="remindUpdateLater">
        <article class="settings-dialog update-dialog">
          <div class="dialog-title-row">
            <h2>{{ updateReleaseTitle() }}</h2>
            <button class="icon-button dialog-close-icon" type="button" :aria-label="t('close')" :title="t('close')" @click="remindUpdateLater" v-html="lucideSvg('x')"></button>
          </div>
          <p class="helper big update-release-copy">{{ updateReleaseBody() }}<small v-if="updateReleaseAssetLabel()">{{ updateReleaseAssetLabel() }}</small></p>
          <div class="dialog-actions">
            <button class="text-button" type="button" @click="remindUpdateLater">{{ t('remindLater') }}</button>
            <button class="filled-button" type="button" :disabled="updateBusy" @click="installAvailableUpdate">{{ updateBusy ? t('checkingUpdates') : t('installUpdate') }}</button>
          </div>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <section v-if="settingsOpen" class="settings-screen app-overlay">
      <header class="settings-header"><button class="back-button" @click="closeSettings" v-html="lucideSvg('chevronLeft')"></button><h2>{{ t('settings') }}</h2></header>
      <div class="settings-list">
        <button class="settings-row" @click="openPermissionsSettings"><span class="settings-row-icon" v-html="settingsIcon('permissions')"></span><b>{{ t('appPermissions') }}</b><small>{{ appPermissionSummary() }}</small></button>
        <button class="settings-row update-settings-entry" :class="{ attention: updateAvailable }" @click="settingsDialog = 'updates'"><span class="settings-row-icon" v-html="settingsIcon('updates')"></span><b>{{ t('appUpdates') }}</b><small>{{ updateCheckResult?.release ? `${t('updateAvailable')} ${updateCheckResult.release.version}` : t('appUpdatesBody') }}</small></button>
        <button class="settings-row" @click="settingsDialog = 'units'"><span class="settings-row-icon" v-html="settingsIcon('units')"></span><b>{{ t('units') }}</b><small>{{ state.settings.units === 'metric' ? t('metric') : t('imperial') }}</small></button>
        <button class="settings-row" @click="settingsDialog = 'calculations'"><span class="settings-row-icon" v-html="settingsIcon('calculations')"></span><b>{{ t('calculations') }}</b><small>{{ t('iomEquationMacro') }}</small></button>
        <button class="settings-row" @click="settingsDialog = 'tracking'"><span class="settings-row-icon" v-html="settingsIcon('tracking')"></span><b>{{ t('trackingReminders') }}</b><small>{{ calorieDeficitEnabled ? `${state.settings.target_deficit_kcal} kcal ${t('targetDeficit')}` : t('deficitOffHint') }}</small></button>
        <label class="settings-row switch-row"><span class="settings-row-icon" v-html="settingsIcon('activity')"></span><b>{{ t('showActivity') }}</b><input v-model="state.settings.show_activity_tracking" type="checkbox" /></label>
        <label class="settings-row switch-row"><span class="settings-row-icon" v-html="settingsIcon('macros')"></span><b>{{ t('showMacros') }}</b><input v-model="state.settings.show_meal_macros" type="checkbox" /></label>
        <label class="settings-row switch-row"><span class="settings-row-icon" v-html="settingsIcon('micros')"></span><b>{{ t('showMicros') }}</b><input v-model="state.settings.show_micronutrients" type="checkbox" /></label>
        <button v-if="state.settings.show_micronutrients" class="settings-row micronutrient-settings-row" @click="settingsDialog = 'micronutrients'"><span class="settings-row-icon" v-html="settingsIcon('micros')"></span><b>{{ t('micronutrientLimits') }}</b><small>{{ t('micronutrientLimitsHint') }}</small></button>
        <label class="settings-row switch-row"><span class="settings-row-icon" v-html="settingsIcon('catalogProtect')"></span><b>{{ t('protectExternalCatalogItems') }}</b><input v-model="state.settings.protect_external_catalog_items" type="checkbox" /><small>{{ t('protectExternalCatalogItemsHint') }}</small></label>
        <label class="settings-row switch-row"><span class="settings-row-icon" v-html="settingsIcon('catalogInactive')"></span><b>{{ t('includeInactiveCatalogItems') }}</b><input v-model="state.settings.include_inactive_catalog_items" type="checkbox" /><small>{{ t('includeInactiveCatalogItemsHint') }}</small></label>
        <button class="settings-row" @click="settingsDialog = 'language'"><span class="settings-row-icon" v-html="settingsIcon('language')"></span><b>{{ t('language') }}</b><small>{{ selectedLanguageLabel() }}</small></button>
        <div class="settings-divider"></div>
        <button class="settings-row" @click="exportAppData"><span class="settings-row-icon" v-html="settingsIcon('export')"></span><b>{{ t('exportAppData') }}</b><small>{{ t('exportAppDataBody') }}</small></button>
        <button class="settings-row" @click="importAppData"><span class="settings-row-icon" v-html="settingsIcon('import')"></span><b>{{ t('importAppData') }}</b><small>{{ t('importAppDataBody') }}</small></button>
        <button class="settings-row" @click="openBackupProfiles"><span class="settings-row-icon" v-html="settingsIcon('backup')"></span><b>{{ t('backupProfiles') }}</b><small>{{ backupProfiles.length }} · {{ t('backupProfilesBody') }}</small></button>
        <button class="settings-row" @click="settingsDialog = 'advanced'"><span class="settings-row-icon" v-html="settingsIcon('advanced')"></span><b>{{ t('advanced') }}</b><small>{{ t('channelDataTransfer') }}</small></button>
        <button class="settings-row" @click="clearCachedItems"><span class="settings-row-icon" v-html="settingsIcon('refresh')"></span><b>{{ t('clearCache') }}</b><small>{{ state.ingredients.length + state.foods.length + state.recipes.length + state.activities.length }} item(s)</small></button>
        <button class="settings-row danger-row" @click="factoryResetMobile"><span class="settings-row-icon" v-html="settingsIcon('reset')"></span><b>{{ t('factoryReset') }}</b><small>{{ t('factoryResetBody') }}</small></button>
        <div class="settings-divider"></div>
        <a class="settings-row settings-link-row" :href="issueUrl" target="_blank" rel="noreferrer"><span class="settings-row-icon" v-html="settingsIcon('issue')"></span><b>{{ t('reportIssue') }}</b><small>{{ t('reportIssueBody') }}</small></a>
        <a class="settings-row settings-link-row" :href="repositoryUrl" target="_blank" rel="noreferrer"><span class="settings-row-icon" v-html="settingsIcon('repo')"></span><b>{{ t('openRepository') }}</b><small>{{ t('openRepositoryBody') }}</small></a>
        <a class="settings-row settings-link-row" :href="starUrl" target="_blank" rel="noreferrer"><span class="settings-row-icon" v-html="settingsIcon('star')"></span><b>{{ t('starProject') }}</b><small>{{ t('starProjectBody') }}</small></a>
        <button class="settings-row" @click="settingsDialog = 'privacy'"><span class="settings-row-icon" v-html="settingsIcon('privacy')"></span><b>{{ t('privacy') }}</b></button>
        <button class="settings-row" @click="settingsDialog = 'licenses'"><span class="settings-row-icon" v-html="settingsIcon('licenses')"></span><b>{{ t('licenses') }}</b></button>
        <button class="settings-row" @click="settingsDialog = 'about'"><span class="settings-row-icon" v-html="settingsIcon('about')"></span><b>{{ t('about') }}</b></button>
        <template v-if="devMode">
          <div class="settings-divider"></div>
          <div class="settings-section-label">{{ t('developerSettings') }}</div>
          <button class="settings-row dev-only-settings-row" @click="startDevFirstLaunchMode"><span class="settings-row-icon" v-html="settingsIcon('reset')"></span><b>{{ t('devFirstLaunchMode') }}</b><small>{{ t('devFirstLaunchModeBody') }}</small></button>
        </template>
        <footer class="settings-brand"><div class="brand-logo" v-html="nutrinoLogoSvg"></div><strong>nutrino</strong><small>{{ t('version') }} {{ appVersion }}</small></footer>
      </div>

      <div v-if="settingsDialog" class="dialog-backdrop" @click.self="settingsDialog = null">
        <article class="settings-dialog">
          <template v-if="settingsDialog === 'permissions'">
            <div class="dialog-title-row"><h2>{{ t('appPermissions') }}</h2><button class="icon-button dialog-close-icon" type="button" :aria-label="t('close')" :title="t('close')" @click="settingsDialog = null" v-html="lucideSvg('x')"></button></div>
            <div class="permission-list">
              <article class="permission-status-card" :class="{ granted: notificationPermissionGranted }">
                <span class="permission-status" :class="{ granted: notificationPermissionGranted }">{{ notificationPermissionGranted ? '✓' : '×' }}</span>
                <span class="permission-copy"><b>{{ t('notificationPermission') }}</b><small>{{ notificationPermissionStatusBody() }}</small></span>
                <button v-if="!notificationPermissionGranted && notificationPermission !== 'unsupported'" class="text-button" type="button" @click="requestReminderPermission">{{ t('requestNotifications') }}</button>
              </article>
              <article class="permission-status-card" :class="{ granted: cameraPermissionGranted }">
                <span class="permission-status" :class="{ granted: cameraPermissionGranted }">{{ cameraPermissionGranted ? '✓' : '×' }}</span>
                <span class="permission-copy"><b>{{ t('cameraPermission') }}</b><small>{{ cameraPermissionStatusBody() }}</small></span>
                <button v-if="!cameraPermissionGranted && cameraPermission !== 'unsupported'" class="text-button" type="button" @click="requestCameraPermission">{{ t('requestCameraPermission') }}</button>
              </article>
            </div>
            <div class="dialog-actions"><button class="text-button" @click="settingsDialog = null">{{ t('ok') }}</button><button class="filled-button" type="button" @click="requestOnboardingPermissions">{{ t('requestAllPermissions') }}</button></div>
          </template>
          <template v-else-if="settingsDialog === 'updates'">
            <div class="dialog-title-row"><h2>{{ t('appUpdates') }}</h2><button class="icon-button dialog-close-icon" type="button" :aria-label="t('close')" :title="t('close')" @click="settingsDialog = null" v-html="lucideSvg('x')"></button></div>
            <section class="app-update-settings-panel">
              <article class="app-update-status-card" :class="{ attention: updateAvailable, latest: updateCheckResult?.status === 'latest' }">
                <span class="app-update-status-orb"></span>
                <div>
                  <b>{{ updateAvailable ? updateReleaseTitle(updateCheckResult) : updateCheckResult?.status === 'latest' ? t('latestInstalled') : t('appUpdates') }}</b>
                  <small>{{ updateAvailable ? updateReleaseBody(updateCheckResult) : `${t('version')} ${appVersion}` }}</small>
                  <small v-if="updateReleaseAssetLabel()">{{ updateReleaseAssetLabel() }}</small>
                </div>
              </article>
              <label class="tracking-toggle-card"><span><b>{{ t('includePrereleaseUpdates') }}</b><small>{{ t('includePrereleaseUpdatesHint') }}</small></span><input v-model="state.settings.check_prerelease_updates" type="checkbox" /></label>
            </section>
            <div class="dialog-actions"><button v-if="updateAvailable" class="text-button" type="button" @click="remindUpdateLater">{{ t('remindLater') }}</button><button class="text-button" @click="settingsDialog = null">{{ t('ok') }}</button><button v-if="updateAvailable" class="filled-button" type="button" :disabled="updateBusy" @click="installAvailableUpdate">{{ updateBusy ? t('checkingUpdates') : t('installUpdate') }}</button><button v-else class="filled-button" type="button" :disabled="updateBusy" @click="checkForAppUpdates({ manual: true, ignoreRemindLater: true })">{{ updateBusy ? t('checkingUpdates') : t('checkUpdates') }}</button></div>
          </template>
          <template v-else-if="settingsDialog === 'units'"><h2>{{ t('units') }}</h2><button class="dialog-option" @click="state.settings.units = 'metric'; settingsDialog = null">{{ t('metric') }}</button><button class="dialog-option" @click="state.settings.units = 'imperial'; settingsDialog = null">{{ t('imperial') }}</button></template>
          <template v-else-if="settingsDialog === 'language'"><h2>{{ t('language') }}</h2><input v-model="languageSearch" class="input" type="search" :placeholder="t('languageSearch')" /><button v-for="language in filteredLanguageOptions" :key="language.code" class="dialog-option language-dialog-option" @click="setLanguage(language.code); settingsDialog = null"><span>{{ language.englishName }}</span><small>{{ language.nativeName }} · {{ language.code }}</small></button></template>
          <template v-else-if="settingsDialog === 'calculations'">
            <div class="dialog-title-row"><h2>{{ t('calculations') }}</h2><button class="text-button" @click="resetCalculations">{{ t('reset') }}</button></div>
            <label class="field-label">{{ t('tdeeEquation') }}</label><select v-model="state.settings.tdee_equation" class="input"><option value="iom_2005">{{ t('iomEquation') }}</option></select>
            <label class="field-label">{{ t('dailyKcalAdjustment') }}: {{ state.settings.kcal_adjustment }} kcal</label><input v-model.number="state.settings.kcal_adjustment" type="range" min="-1000" max="1000" step="25" class="tile-range" />
            <h3>{{ t('macronutrientDistribution') }}</h3><p class="helper">{{ state.settings.macro_carbs_percent + state.settings.macro_protein_percent + state.settings.macro_fat_percent }}% {{ t('total') }}</p>
            <label class="field-label">carbs {{ state.settings.macro_carbs_percent }}%</label><input v-model.number="state.settings.macro_carbs_percent" type="range" min="0" max="100" step="5" class="tile-range carbs-range" />
            <label class="field-label">protein {{ state.settings.macro_protein_percent }}%</label><input v-model.number="state.settings.macro_protein_percent" type="range" min="0" max="100" step="5" class="tile-range protein-range" />
            <label class="field-label">fat {{ state.settings.macro_fat_percent }}%</label><input v-model.number="state.settings.macro_fat_percent" type="range" min="0" max="100" step="5" class="tile-range fat-range" />
            <div class="dialog-actions"><button class="text-button" @click="settingsDialog = null">{{ t('cancel') }}</button><button class="text-button" @click="settingsDialog = null">{{ t('ok') }}</button></div>
          </template>
          <template v-else-if="settingsDialog === 'tracking'">
            <div class="dialog-title-row tracking-dialog-title"><h2>{{ t('trackingReminders') }}</h2></div>
            <div class="tracking-settings-panel">
              <section class="tracking-settings-group">
                <label class="tracking-toggle-card"><span><b>{{ t('dailyReminder') }}</b><small>{{ t('dailyReminderTime') }} · {{ state.settings.daily_reminder_time }}</small></span><input v-model="state.settings.daily_reminder" type="checkbox" @change="ensureNotificationPermissionForReminders" /></label>
                <div class="tracking-input-card" :class="{ disabled: !state.settings.daily_reminder }">
                  <span>{{ t('dailyReminderTime') }}</span>
                  <div class="notification-time-control">
                    <input v-model="state.settings.daily_reminder_time" class="input" type="time" :disabled="!state.settings.daily_reminder" />
                    <button v-if="devMode" class="text-button reminder-test-button" type="button" @click="sendDevReminderTest('daily')">{{ t('test') }}</button>
                  </div>
                </div>
                <label class="tracking-toggle-card"><span><b>{{ t('weeklyWeightAverage') }}</b><small>{{ t('weeklyWeightAverageHint') }}</small></span><input v-model="state.settings.weekly_weight_average_enabled" type="checkbox" /></label>
                <label class="tracking-toggle-card"><span><b>{{ t('dailyWeightReminder') }}</b><small>{{ t('dailyWeightReminderTime') }} · {{ state.settings.daily_weight_reminder_time }}</small></span><input v-model="state.settings.daily_weight_reminder_enabled" type="checkbox" @change="ensureNotificationPermissionForReminders" /></label>
                <div class="tracking-input-card" :class="{ disabled: !state.settings.daily_weight_reminder_enabled }">
                  <span>{{ t('dailyWeightReminderTime') }}</span>
                  <div class="notification-time-control">
                    <input v-model="state.settings.daily_weight_reminder_time" class="input" type="time" :disabled="!state.settings.daily_weight_reminder_enabled" />
                    <button v-if="devMode" class="text-button reminder-test-button" type="button" @click="sendDevReminderTest('weight')">{{ t('test') }}</button>
                  </div>
                </div>
              </section>

              <section class="tracking-settings-group">
                <label class="tracking-toggle-card"><span><b>{{ t('mealReminders') }}</b><small>{{ t('breakfast') }} · {{ t('lunch') }} · {{ t('dinner') }}</small></span><input v-model="state.settings.meal_reminders_enabled" type="checkbox" @change="ensureNotificationPermissionForReminders" /></label>
                <div class="time-grid tracking-time-grid" :class="{ disabled: !state.settings.meal_reminders_enabled }">
                  <div class="notification-time-card"><span>{{ t('breakfast') }}</span><input v-model="state.settings.meal_reminder_morning_time" class="input" type="time" :disabled="!state.settings.meal_reminders_enabled" /><button v-if="devMode" class="text-button reminder-test-button" type="button" @click="sendDevReminderTest('mealMorning')">{{ t('test') }}</button></div>
                  <div class="notification-time-card"><span>{{ t('lunch') }}</span><input v-model="state.settings.meal_reminder_noon_time" class="input" type="time" :disabled="!state.settings.meal_reminders_enabled" /><button v-if="devMode" class="text-button reminder-test-button" type="button" @click="sendDevReminderTest('mealNoon')">{{ t('test') }}</button></div>
                  <div class="notification-time-card"><span>{{ t('dinner') }}</span><input v-model="state.settings.meal_reminder_afternoon_time" class="input" type="time" :disabled="!state.settings.meal_reminders_enabled" /><button v-if="devMode" class="text-button reminder-test-button" type="button" @click="sendDevReminderTest('mealAfternoon')">{{ t('test') }}</button></div>
                </div>
              </section>

              <section class="tracking-settings-group">
                <label class="tracking-toggle-card"><span><b>{{ t('calorieDeficitTracking') }}</b><small>{{ state.settings.target_deficit_kcal }} kcal · {{ t('targetDeficit') }}</small></span><input v-model="state.settings.calorie_deficit_enabled" type="checkbox" /></label>
                <label class="tracking-range-card" :class="{ disabled: !calorieDeficitEnabled }"><span>{{ t('targetDeficit') }}</span><b>{{ state.settings.target_deficit_kcal }} kcal</b><input v-model.number="state.settings.target_deficit_kcal" class="tile-range" type="range" min="0" max="600" step="25" :disabled="!calorieDeficitEnabled" /></label>
                <label class="tracking-input-card" :class="{ disabled: !calorieDeficitEnabled }"><span>{{ t('exerciseKcalEatback') }}</span><select v-model.number="state.settings.exercise_kcal_eatback_percent" class="input" :disabled="!calorieDeficitEnabled"><option :value="0">{{ t('eatbackNone') }}</option><option :value="25">25%</option><option :value="50">{{ t('eatbackHalf') }}</option><option :value="100">{{ t('eatbackFull') }}</option></select></label>
                <label class="tracking-toggle-card"><span><b>{{ t('calorieLimitWarning') }}</b><small>{{ t('deficitWarningTitle') }}</small></span><input v-model="state.settings.calorie_limit_warning_enabled" type="checkbox" @change="ensureNotificationPermissionForReminders" /></label>
              </section>
            </div>
            <div class="dialog-actions"><button class="filled-button wide" @click="settingsDialog = null">{{ t('ok') }}</button></div>
          </template>
          <template v-else-if="settingsDialog === 'micronutrients'">
            <div class="dialog-title-row micronutrient-dialog-title"><h2>{{ t('micronutrientLimits') }}</h2><button class="info-button" type="button" :aria-label="t('micronutrientLimits')" @click="micronutrientInfoOpen = !micronutrientInfoOpen" v-html="lucideSvg('circleQuestionMark')"></button></div>
            <p v-if="micronutrientInfoOpen" class="helper big micronutrient-info-copy">{{ t('micronutrientDefaultsInfo') }}</p>
            <div class="micronutrient-limit-list">
              <label v-for="nutrient in optionalNutrientDefinitions" :key="`limit-${nutrient.key}`" class="micronutrient-limit-row">
                <span><b>{{ t(nutrient.labelKey) }}</b><small>{{ t(nutrient.limitKind === 'max' ? 'dailyLimit' : 'dailyTarget') }} · {{ t('defaultValue') }} {{ formatNutrientAmount(nutrient.dailyLimit, nutrient.unit) }}</small></span>
                <input :value="micronutrientLimit(nutrient)" class="input" type="number" min="0" step="0.1" inputmode="decimal" @input="setMicronutrientLimitFromEvent(nutrient, $event)" />
              </label>
            </div>
            <div class="dialog-actions"><button class="text-button" @click="resetMicronutrientLimits">{{ t('resetMicronutrients') }}</button><button class="filled-button" @click="settingsDialog = null">{{ t('ok') }}</button></div>
          </template>
          <template v-else-if="settingsDialog === 'advanced'">
            <div class="dialog-title-row"><h2>{{ t('advanced') }}</h2><button class="icon-button dialog-close-icon" type="button" :aria-label="t('close')" :title="t('close')" @click="settingsDialog = null" v-html="lucideSvg('x')"></button></div>
            <p class="warning-callout"><span class="warning-callout-icon">!</span><span>{{ advancedTransferWarningText() }}</span></p>
            <div class="advanced-transfer-list">
              <button class="dialog-option advanced-transfer-option" type="button" @click="importDataFromOtherChannel">
                <span><b>{{ appChannel === 'dev' ? t('updateDevFromStable') : t('updateStableFromDev') }}</b><small>{{ advancedImportHintText() }}</small></span>
              </button>
              <button class="dialog-option advanced-transfer-option" type="button" @click="exportDataForOtherChannel">
                <span><b>{{ appChannel === 'dev' ? t('exportDevForStable') : t('exportStableForDev') }}</b><small>{{ advancedExportHintText() }}</small></span>
              </button>
            </div>
            <div class="dialog-actions"><button class="filled-button wide" @click="settingsDialog = null">{{ t('ok') }}</button></div>
          </template>
          <template v-else-if="settingsDialog === 'privacy'"><h2>{{ t('privacy') }}</h2><p class="helper big">{{ t('privacyBody') }}</p><button class="filled-button wide" @click="settingsDialog = null">{{ t('ok') }}</button></template>
          <template v-else-if="settingsDialog === 'licenses'">
            <h2>{{ t('licenses') }}</h2>
            <p class="helper big">{{ t('thirdPartyNotices') }}</p>
            <div class="license-list">
              <article v-for="notice in thirdPartyNotices" :key="notice.name" class="license-card">
                <div><b>{{ notice.name }}</b><small>{{ notice.purpose }}</small><small v-if="notice.note">{{ notice.note }}</small></div>
                <a :href="notice.url" target="_blank" rel="noreferrer">{{ notice.license }}</a>
              </article>
            </div>
            <h3>{{ t('acknowledgements') }}</h3>
            <ul class="acknowledgement-list"><li v-for="item in acknowledgements" :key="item">{{ item }}</li></ul>
            <button class="filled-button wide" @click="settingsDialog = null">{{ t('ok') }}</button>
          </template>
          <template v-else><h2>{{ t('about') }}</h2><div class="about-logo" v-html="nutrinoLogoSvg"></div><h3>{{ appName }}</h3><p class="helper">{{ t('version') }} {{ appVersion }} · {{ appChannel }} · AGPL-3.0-only</p><p class="helper big">{{ t('aboutBody') }}</p><p class="helper big">{{ t('aboutThanks') }}</p><div class="about-links"><a :href="repositoryUrl" target="_blank" rel="noreferrer">{{ t('sourceCode') }}</a><a :href="issueUrl" target="_blank" rel="noreferrer">{{ t('reportIssue') }}</a><a :href="starUrl" target="_blank" rel="noreferrer">{{ t('starProject') }}</a></div><button class="filled-button wide" @click="settingsDialog = null">{{ t('ok') }}</button></template>
        </article>
      </div>
      </section>
    </Teleport>


    <Teleport to="body">
      <div v-if="deficitInfoOpen" class="dialog-backdrop app-overlay" @click.self="deficitInfoOpen = false">
        <article class="settings-dialog deficit-info-dialog">
          <div class="dialog-title-row"><h2>{{ deficitHelpTitle }}</h2><button class="text-button" @click="deficitInfoOpen = false">{{ t('ok') }}</button></div>
          <div class="deficit-info-grid">
            <div><span>{{ t('fullLimit') }}</span><b>{{ dailyGoal }} kcal</b></div>
            <div><span>{{ t('effectiveLimit') }}</span><b>{{ effectiveDailyGoal }} kcal</b></div>
            <div><span>{{ t('supplied') }}</span><b>{{ consumedKcal }} kcal</b></div>
            <div><span>{{ t('exerciseCredit') }}</span><b>{{ creditedBurnedKcal }}/{{ burnedKcal }} kcal</b></div>
          </div>
          <p class="helper big">{{ deficitHelpBody }}</p>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="duplicateMealTargetOpen" class="dialog-backdrop app-overlay" @click.self="closeDuplicateMealTarget">
        <article class="settings-dialog entry-action-dialog">
          <div class="dialog-title-row"><h2>{{ t('duplicateEntry') }}</h2><button class="text-button" @click="closeDuplicateMealTarget">{{ t('cancel') }}</button></div>
          <p class="helper big">{{ t('duplicateMealTargetHint') }}</p>
          <div class="meal-target-grid">
            <button v-for="section in mealTargetSections" :key="`duplicate-${section.key}`" class="dialog-option meal-target-option" @click="duplicatePendingIntake(section.key)">
              <span class="material-icon" v-html="mealIconSvg[section.icon]"></span>
              <b>{{ t(section.key) }}</b>
            </button>
          </div>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="entryActionSheet" class="dialog-backdrop app-overlay" @click.self="entryActionSheet = null">
        <article class="settings-dialog entry-action-dialog">
          <div class="dialog-title-row"><h2>{{ t('entryActions') }}</h2><button class="text-button" @click="entryActionSheet = null">{{ t('cancel') }}</button></div>
          <template v-if="actionSheetIntake">
            <p class="helper big">{{ itemTitle(foodFromIntake(actionSheetIntake)) }}</p>
            <button class="dialog-option" @click="openDuplicateIntakeTarget(actionSheetIntake)"><span>{{ t('duplicate') }}</span><small>{{ t('duplicateMealTargetHint') }}</small></button>
            <button v-if="actionSheetIntake.item_type === 'note'" class="dialog-option catalog-convert-option" @click="openNoteConversion(actionSheetIntake)"><span><span class="dialog-option-icon" v-html="lucideSvg('utensils')"></span>{{ t('convertToCatalogItem') }}</span><small>{{ t('convertNoteToCatalogHint') }}</small></button>
            <h3>{{ t('moveToMeal') }}</h3>
            <div class="meal-target-grid">
              <button v-for="section in mealTargetSections" :key="`move-${section.key}`" class="dialog-option meal-target-option" :disabled="actionSheetIntake.meal_type === section.key" @click="moveIntakeToMeal(actionSheetIntake.id, section.key)">
                <span class="material-icon" v-html="mealIconSvg[section.icon]"></span>
                <b>{{ t(section.key) }}</b>
              </button>
            </div>
            <div class="dialog-actions"><button class="text-button" @click="editIntake(actionSheetIntake); entryActionSheet = null">{{ t('edit') }}</button><button class="delete-button" @click="removeIntake(actionSheetIntake.id); entryActionSheet = null">{{ t('delete') }}</button></div>
          </template>
          <template v-else-if="actionSheetActivity">
            <p class="helper big">{{ actionSheetActivity.activity_name }}</p>
            <button class="dialog-option" @click="duplicateActivity(actionSheetActivity.id)"><span>{{ t('duplicate') }}</span><small>{{ actionSheetActivity.kcal }} kcal</small></button>
            <div class="dialog-actions"><button class="text-button" @click="editActivityLog(actionSheetActivity); entryActionSheet = null">{{ t('edit') }}</button><button class="delete-button" @click="removeActivity(actionSheetActivity.id); entryActionSheet = null">{{ t('delete') }}</button></div>
          </template>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="backupProfilesOpen" class="dialog-backdrop app-overlay" @click.self="backupProfilesOpen = false">
      <article class="settings-dialog backup-profiles-dialog">
        <div class="dialog-title-row"><h2>{{ t('backupProfiles') }}</h2><button class="text-button" @click="backupProfilesOpen = false">{{ t('ok') }}</button></div>
        <p class="helper big">{{ t('backupProfilesBody') }}</p>
        <div class="backup-profile-list">
          <article v-if="!backupProfiles.length" class="backup-profile-empty">{{ t('noBackupProfiles') }}</article>
          <article v-for="profile in backupProfiles" :key="profile.id" class="backup-profile-card">
            <div>
              <b>{{ profile.name }}</b>
              <small>{{ backupProfileSubtitle(profile) }}</small>
            </div>
            <div class="backup-profile-actions">
              <button class="text-button" @click="restoreBackupProfile(profile.id)">{{ t('restore') }}</button>
              <button class="text-button danger-text" @click="deleteBackupProfile(profile.id)">{{ t('delete') }}</button>
            </div>
          </article>
        </div>
        <button class="filled-button wide" @click="createManualBackupProfile">{{ t('createBackupProfile') }}</button>
      </article>
      </div>
    </Teleport>


    <Teleport to="body">
      <section v-if="onboardingOpen" class="onboarding-screen app-overlay">
      <article class="onboarding-card">
        <div class="onboarding-logo" v-html="nutrinoLogoSvg"></div>
        <p class="eyebrow">nutrino</p>
        <h2>{{ t('onboardingTitle') }}</h2>
        <p class="helper big" v-if="onboardingStep === 0">{{ t('onboardingIntro') }}</p>
        <div v-if="onboardingStep === 0" class="onboarding-form">
          <label><span>{{ t('height') }}</span><input v-model.number="onboardingProfile.height_cm" class="input" type="number" inputmode="decimal" /></label>
          <label><span>{{ t('weight') }}</span><input v-model.number="onboardingProfile.current_weight_kg" class="input" type="number" inputmode="decimal" /></label>
          <label><span>{{ t('birthday') }}</span><input v-model="onboardingProfile.birthday" class="input" type="date" /></label>
          <label><span>{{ t('gender') }}</span><select v-model="onboardingProfile.gender" class="input"><option value="male">{{ t('male') }}</option><option value="female">{{ t('female') }}</option><option value="non_binary">{{ t('nonBinary') }}</option></select></label>
          <label><span>{{ t('activityLevel') }}</span><select v-model="onboardingProfile.activity_level" class="input"><option value="sedentary">{{ t('sedentary') }}</option><option value="low_active">{{ t('lowActive') }}</option><option value="active">{{ t('active') }}</option><option value="very_active">{{ t('veryActive') }}</option></select></label>
          <label><span>{{ t('weeklyGoal') }}: {{ onboardingProfile.weekly_goal_kg }} {{ t('perWeek') }}</span><input v-model.number="onboardingProfile.weekly_goal_kg" class="tile-range" type="range" min="-1" max="1" step="0.25" /></label>
        </div>
        <div v-else-if="onboardingStep === 1" class="onboarding-permissions">
          <h3>{{ t('syncPreferences') }}</h3>
          <p class="helper big">{{ t('syncPreferencesBody') }}</p>
          <div class="permission-list compact">
            <label class="tracking-toggle-card"><span><b>{{ t('desktopApiConnection') }}</b><small>{{ t('desktopApiConnectionBody') }}</small></span><input v-model="state.settings.desktop_api_enabled" type="checkbox" /></label>
            <label class="tracking-toggle-card"><span><b>{{ t('githubCsvConnection') }}</b><small>{{ t('githubCsvConnectionBody') }}</small></span><input v-model="state.settings.github_csv_enabled" type="checkbox" /></label>
          </div>
        </div>
        <div v-else class="onboarding-permissions">
          <h3>{{ t('onboardingPermissions') }}</h3>
          <p class="helper big">{{ t('onboardingPermissionsBody') }}</p>
          <div class="permission-list compact">
            <article class="permission-status-card" :class="{ granted: notificationPermissionGranted }">
              <span class="permission-status" :class="{ granted: notificationPermissionGranted }">{{ notificationPermissionGranted ? '✓' : '×' }}</span>
              <span class="permission-copy"><b>{{ t('notificationPermission') }}</b><small>{{ notificationPermissionStatusLabel() }}</small></span>
            </article>
            <article class="permission-status-card" :class="{ granted: cameraPermissionGranted }">
              <span class="permission-status" :class="{ granted: cameraPermissionGranted }">{{ cameraPermissionGranted ? '✓' : '×' }}</span>
              <span class="permission-copy"><b>{{ t('cameraPermission') }}</b><small>{{ cameraPermissionStatusLabel() }}</small></span>
            </article>
          </div>
          <p class="helper big">{{ t('onboardingTourBody') }}</p>
        </div>
        <div class="dialog-actions onboarding-actions"><button v-if="onboardingStep === 0" class="text-button" @click="importAppData">{{ t('restoreBackup') }}</button><button v-if="onboardingStep === 0 && backupProfiles.length" class="text-button" @click="openBackupProfiles">{{ t('restoreBackupProfile') }}</button><button v-if="onboardingStep > 0" class="text-button" @click="onboardingStep--">{{ t('back') }}</button><button v-if="onboardingStep === 2" class="text-button" @click="requestOnboardingPermissions">{{ t('requestAllPermissions') }}</button><button v-if="onboardingStep === 0" class="filled-button" @click="openOnboardingSyncStep">{{ t('next') }}</button><button v-else-if="onboardingStep === 1" class="filled-button" @click="openOnboardingPermissionsStep">{{ t('next') }}</button><button v-else class="filled-button" @click="finishOnboarding">{{ t('onboardingTourStart') }}</button></div>
      </article>
      </section>
    </Teleport>

    <Teleport to="body">
      <div v-if="scanDialogOpen" class="dialog-backdrop app-overlay" @click.self="closeScanner">
        <article class="settings-dialog scanner-dialog">
          <div class="dialog-title-row"><h2>{{ scanDialogMode === 'barcode' ? t('scanBarcodeQr') : t('scanNutrinoQr') }}</h2><button class="text-button" @click="closeScanner">{{ t('cancel') }}</button></div>
          <video ref="scanVideo" class="scanner-video" playsinline muted></video>
          <p class="helper big">{{ t('scanHelper') }}</p>
          <input v-model="scanInput" class="input" :placeholder="t('scanPlaceholder')" @keydown.enter.prevent="applyScannedValue()" autocomplete="off" autocapitalize="none" />
          <button class="filled-button wide" @click="applyScannedValue()">{{ t('scan') }}</button>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <p v-if="toast" class="toast">{{ toast }}</p>
    </Teleport>

    <nav class="bottom-nav">
      <button v-for="item in navItems" :key="item.key" :data-tour="`nav-${item.key}`" :class="activeTab === item.key ? 'active' : ''" @click="setTab(item.key)">
        <span class="nav-svg" v-html="activeTab === item.key ? item.activeIcon : item.icon"></span>
        <span>{{ t(item.key) }}</span>
      </button>
    </nav>
  </main>
</template>
