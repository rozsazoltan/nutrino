<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import type { ActivityDefinition, ActivityLog, AppState, Food, Ingredient, Intake, MealType, Recipe, RecipeItem, WeightLog, GitHubCsvSource } from './types';
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
import { checkServerHealth, pingServer, pullFromServer, pushToServer, syncGitHubCsvSources } from './lib/api';
import { lucideSvg, type IconName } from './icons';

type Tab = 'home' | 'diary' | 'recipes' | 'profile';
type AddMode = 'food' | 'activity' | null;
type MealEntryMode = 'catalog' | 'note';
type CatalogSearchScope = 'title' | 'all' | 'brand' | 'category' | 'description';
type LocalEditorKind = 'ingredient' | 'food' | 'recipe' | 'activity';

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
let scannerStream: MediaStream | null = null;
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
const localCatalogForm = reactive({
  name: '', brand: '', note: '', barcode: '', default_unit: 'g', serving_size_g: null as number | null,
  kcal_per_100g: null as number | null, carbs_per_100g: 0, fat_per_100g: 0, protein_per_100g: 0,
  sugars_per_100g: 0, fiber_per_100g: 0, salt_per_100g: 0,
  description: '', total_weight_g: null as number | null, servings_count: null as number | null,
  code: '', activity_type: 'custom', met: 0, kcal_per_min: null as number | null,
});
const localRecipeItems = ref<Array<{ food_id: string; amount_g: number }>>([]);
const localRecipeCatalogOptions = computed(() => catalogItems(state).filter((item) => item.id !== `recipe:${localEditorId.value}`));
const contentScrolled = ref(false);
const syncBusy = ref(false);
const serverOnline = ref(false);
const githubCatalogAvailable = computed(() => (state.githubSources || []).some((source) => source.enabled));
const serverChecking = ref(false);
let healthTimer: number | undefined;
let todayRolloverTimer: number | undefined;
const offlineToastShown = ref(false);
const toast = ref('');
const settingsOpen = ref(false);
const settingsDialog = ref<'units' | 'calculations' | 'language' | 'privacy' | 'about' | 'licenses' | null>(null);
const unlockedDiaryDate = ref<string | null>(null);
const futureConfirmedDates = ref<Record<string, boolean>>({});
const editingDayWeight = ref(false);
const editingIntakeId = ref<string | null>(null);
const editingActivityLogId = ref<string | null>(null);
const lastBackPressAt = ref(0);
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
  units: 'ruler',
  calculations: 'calculator',
  activity: 'activity',
  macros: 'chartPie',
  micros: 'flaskConical',
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

const mealIconSvg: Record<string, string> = {
  directions_walk: lucideSvg('personStanding'),
  local_cafe: lucideSvg('coffee'),
  lunch_dining: lucideSvg('sandwich'),
  dinner_dining: lucideSvg('utensils'),
  bakery_dining: lucideSvg('cookie'),
};

watch(state, () => saveState(JSON.parse(JSON.stringify(state)) as AppState), { deep: true });
watch(selectedDate, () => {
  editingDayWeight.value = false;
});
watch(activeTab, (next, previous) => {
  if (previous === 'diary' && next !== 'diary') {
    unlockedDiaryDate.value = null;
    editingDayWeight.value = false;
  }
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
  history.pushState({ nutrinoBackTrap: Date.now() }, '', location.href);
}

function resetBackTrap() {
  history.replaceState({ nutrinoRoot: true }, '', location.href);
  pushBackTrap();
}

function scrollToPageTop() {
  nextTick(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.querySelector('.app-shell')?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  });
}

function handleBackNavigation() {
  if (addMode.value) {
    requestCloseSheet();
    pushBackTrap();
    return;
  }
  if (quickAddOpen.value) {
    quickAddOpen.value = false;
    pushBackTrap();
    return;
  }
  if (backupProfilesOpen.value) {
    backupProfilesOpen.value = false;
    pushBackTrap();
    return;
  }
  if (settingsDialog.value) {
    settingsDialog.value = null;
    pushBackTrap();
    return;
  }
  if (settingsOpen.value) {
    closeSettings();
    pushBackTrap();
    return;
  }
  if (activeTab.value !== 'home') {
    if (activeTab.value === 'diary') {
      unlockedDiaryDate.value = null;
      editingDayWeight.value = false;
    }
    activeTab.value = 'home';
    scrollToPageTop();
    pushBackTrap();
    return;
  }

  const now = Date.now();
  if (now - lastBackPressAt.value < 1800) {
    history.back();
    return;
  }

  lastBackPressAt.value = now;
  showToast(t('pressBackAgain'));
  pushBackTrap();
}


function finishOnboarding() {
  state.profile.height_cm = Number(onboardingProfile.height_cm) || state.profile.height_cm;
  state.profile.current_weight_kg = Number(onboardingProfile.current_weight_kg) || state.profile.current_weight_kg;
  state.profile.plan_start_weight_kg = state.profile.current_weight_kg;
  state.profile.birthday = String(onboardingProfile.birthday || state.profile.birthday);
  state.profile.gender = onboardingProfile.gender;
  state.profile.activity_level = onboardingProfile.activity_level;
  state.profile.weekly_goal_kg = Number(onboardingProfile.weekly_goal_kg) || 0;
  localStorage.setItem(mobileOnboardingKey, '1');
  onboardingOpen.value = false;
  onboardingStep.value = 0;
  saveState(JSON.parse(JSON.stringify(state)) as AppState);
}

function maybeOpenOnboarding() {
  if (!localStorage.getItem(mobileOnboardingKey)) {
    onboardingOpen.value = true;
  }
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
  void pollServerHealth({ syncOnChange: true, quiet: true });
  healthTimer = window.setInterval(() => void pollServerHealth({ syncOnChange: true, quiet: true }), 30000);
});

onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', updateKeyboardOffset);
  window.visualViewport?.removeEventListener('scroll', updateKeyboardOffset);
  window.removeEventListener('scroll', updateContentScrolled);
  document.removeEventListener('focusin', scrollFocusedInputIntoView);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('popstate', handleBackNavigation);
  if (healthTimer) window.clearInterval(healthTimer);
  if (todayRolloverTimer) window.clearTimeout(todayRolloverTimer);
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
const dailyGoal = computed(() => dailyKcalGoal(profileForActiveDay.value, burnedKcal.value) + Number(state.settings.kcal_adjustment || 0));
const consumedKcal = computed(() => Math.round(currentDayIntakes.value.reduce((sum, entry) => sum + intakeKcal(entry), 0)));
const kcalLeft = computed(() => dailyGoal.value - consumedKcal.value);
const kcalGaugeValue = computed(() => {
  if (kcalLeft.value > dailyGoal.value) return 0;
  if (kcalLeft.value < 0) return 1;
  return clamp((dailyGoal.value - kcalLeft.value) / Math.max(1, dailyGoal.value));
});
const kcalCenterValue = computed(() => Math.round(kcalLeft.value < 0 ? Math.abs(kcalLeft.value) : Math.min(kcalLeft.value, dailyGoal.value)));
const kcalCenterLabel = computed(() => kcalLeft.value < 0 ? 'too much' : 'kcal left');
const kcalProgressDash = computed(() => `${kcalArcLength * kcalGaugeValue.value} ${ringCircumference}`);
const protein = computed(() => Math.round(totalMacro('protein_per_100g')));
const carbs = computed(() => Math.round(totalMacro('carbs_per_100g')));
const fat = computed(() => Math.round(totalMacro('fat_per_100g')));
const macroGoals = computed(() => {
  const kcal = Math.max(1, dailyGoal.value);
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
const weightPromptDue = computed(() => needsWeightPrompt(state.profile, state.weightLogs));
const allCatalogItems = computed(() => catalogItems(state));

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
function selectedFirst(items: Food[]) {
  const selected = selectedCatalogId.value;
  return [...items].sort((a, b) => {
    if (a.id === selected) return -1;
    if (b.id === selected) return 1;
    return a.name.localeCompare(b.name);
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

function catalogItemKind(item: Food): string {
  return catalogKindLabel(item);
}

function catalogSearchFields(item: Food): CatalogSearchField[] {
  return [
    { scope: 'title', value: item.name, rank: 0, allowCompactContains: true },
    { scope: 'brand', value: item.brand ?? '', rank: 8, allowCompactContains: true },
    { scope: 'category', value: catalogItemKind(item), rank: 12, allowCompactContains: true },
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
  return left.item.name.localeCompare(right.item.name);
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

const visibleCatalogItems = computed(() => {
  if (catalogSearchActive.value) return [...catalogExactItems.value, ...catalogSuggestedItems.value];
  return selectedFirst(allCatalogItems.value);
});
const visibleRecipeItems = computed(() => visibleCatalogItems.value.filter((item) => item.id.startsWith('recipe:') && item.id !== selectedCatalogId.value));
const visibleIngredientItems = computed(() => visibleCatalogItems.value.filter((item) => item.id.startsWith('ingredient:') && item.id !== selectedCatalogId.value));
const visibleFoodItems = computed(() => visibleCatalogItems.value.filter((item) => !item.id.startsWith('recipe:') && !item.id.startsWith('ingredient:') && item.id !== selectedCatalogId.value));
const visibleActivities = computed(() => {
  const q = search.value.trim();
  if (!q) return state.activities;
  return state.activities.filter((item) => matchesSearchQuery(q, item.name, item.description, item.code, item.type, item.activity_type, activityType(item)));
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


const activeLanguage = computed(() => {
  if (state.settings.language === 'hu') return 'hu';
  if (state.settings.language === 'en') return 'en';
  return navigator.language.toLowerCase().startsWith('hu') ? 'hu' : 'en';
});
const appVersion = '0.10.3';
const repositoryUrl = 'https://github.com/rozsazoltan/nutrino';
const issueUrl = 'https://github.com/rozsazoltan/nutrino/issues/new/choose';
const starUrl = 'https://github.com/rozsazoltan/nutrino/stargazers';
const SERVER_STALE_MS = 5 * 60 * 1000;
const selectedDayUnlocked = computed(() => activeTab.value === 'diary' && unlockedDiaryDate.value === selectedDate.value);
const selectedDateIsFuture = computed(() => dayStartMs(activeLogDateKey.value) > dayStartMs(todayKey.value));
const currentBmiInfo = computed(() => bmiStatus(currentBmi.value));
const diaryKcalTone = computed(() => kcalTone(consumedKcal.value, dailyGoal.value));
const homeShellToneClass = computed(() => activeTab.value === 'home' ? `home-${diaryKcalTone.value}` : '');
const selectedDayMacroSummary = computed(() => dayMacroSummary(selectedDate.value));

const translations: Record<string, Record<string, string>> = {
  en: {
    home: 'Home', diary: 'Diary', recipes: 'Recipes', profile: 'Profile', settings: 'Settings', synced: 'Synced', syncing: 'Syncing', pending: 'pending',
    supplied: 'supplied', burned: 'burned', kcalLeft: 'kcal left', tooMuch: 'too much', activity: 'Activity', breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
    carbs: 'carbs', fat: 'fat', protein: 'protein', addBurnedKcal: 'Add burned kcal', startTheDay: 'Start the day', middayMeal: 'Midday meal', eveningMeal: 'Evening meal', smallMeals: 'Small meals', addNewItem: 'Add new item',
    unlockEditConfirm: 'Enable editing for this day? This prevents accidental changes to older diary days.', pressBackAgain: 'Press back again to exit.', noActivity: 'No activity logged for this day.', noEntries: 'No entries yet.', edit: 'Edit', delete: 'Delete',
    units: 'Units', calculations: 'Calculations', language: 'Language', privacy: 'Privacy Settings', about: 'About', licenses: 'Licenses', thirdPartyNotices: 'Third-party notices', acknowledgements: 'Acknowledgements', exportImport: 'Export / Import App Data', clearCache: 'Clear cached items',
    dailyReminder: 'Daily Reminder', theme: 'Theme', showActivity: 'Show Activity Tracking', showMacros: 'Show Meal Macros', showMicros: 'Show Micronutrients',
    metric: 'Metric (kg, cm, ml)', imperial: 'Imperial (lbs, ft, oz)', systemDefault: 'System default', english: 'English', hungarian: 'Hungarian', cancel: 'Cancel', ok: 'OK', reset: 'Reset',
    unlockDay: 'Unlock day editing', lockedNote: 'Unlock editing before changing entries on this day.', editingEnabled: 'Editing enabled', selectedDayEntriesNote: 'Food and activity entries for the selected calendar day are shown below.', target: 'target', weight: 'weight', saveWeight: 'Save weight', weightForThisDay: 'Weight for this day in kg', editWeight: 'Edit weight', futureDateWarning: 'This date is in the future. Logging future diary data can make your diary inaccurate. Continue anyway?', weeklyWeightCheck: 'Weekly weight check', weeklyWeightCheckBody: 'Update your weight once a week. If it does not change, nutrino keeps using the latest known value.', save: 'Save', addTo: 'Add to', add: 'Add', update: 'Update', addActivity: 'Add activity', updateActivity: 'Update activity', customRecipe: 'Customize recipe', customRecipeHint: 'Changes are saved only for this diary entry.', customizedRecipe: 'custom recipe', editRecipeLocally: 'Edit recipe for this entry', changeSelection: 'Change food/recipe', selected: 'Selected', baseAmount: 'base', onePiece: '1 pc', selectFoodFirst: 'Select a food or recipe first.', amountGreaterThanZero: 'Amount must be greater than zero.', enterValidWeight: 'Enter a valid weight in kg.', weightSaved: 'Weight saved.', activityUpdated: 'Activity updated.', activityAdded: 'Activity added.', activities: 'activities', entries: 'entries', foodAndRecipeSearch: 'Search foods and recipes', searchIn: 'Search in', searchScopeTitle: 'Title', searchScopeAll: 'All', searchScopeBrand: 'Brand', searchScopeCategory: 'Category', searchScopeDescription: 'Description', exactMatches: 'Exact matches', maybeYouMean: 'Maybe you meant', activitySearch: 'Search activities', recipe: 'Recipe', food: 'Food', ingredient: 'Ingredient', grams: 'grams', pieces: 'pieces', catalog: 'Catalog', watch: 'Watch', manual: 'Manual', minutes: 'minutes', kcalFromWatchManual: 'kcal from watch/manual', exportAppData: 'Export app data', exportAppDataBody: 'Save a full local ZIP backup.', importAppData: 'Import app data', importAppDataBody: 'Select a nutrino mobile app ZIP backup.', activityLevel: 'Activity', activityLevelHint: 'Used for daily kcal target', weeklyGoal: 'Weekly goal', perWeek: 'kg / week', height: 'Height', age: 'Age', years: 'years', gender: 'Gender', apiSettings: 'API settings', appChannel: 'Channel', devApiHint: 'Development mode uses the desktop LAN URL automatically. Password is only needed if the desktop server requires one.', apiUrl: 'API URL', pairingPassword: 'Server password', pairingToken: 'Pairing token', addKcalNote: 'Note', existingItem: 'Existing', noteEntry: 'Note', kcalNoteTitle: 'Note title', kcalNoteDescription: 'Description', kcalNoteValue: 'kcal', localCatalogActions: 'Local catalog actions', addLocalIngredient: 'Add local ingredient', addLocalFood: 'Add local food', addLocalRecipe: 'Add local recipe', addLocalActivity: 'Add local activity', localItemCreated: 'Local item saved. Sync when the desktop server is reachable.', genderHint: 'Used for kcal estimate', male: 'Male', female: 'Female', nonBinary: 'Non-binary', test: 'Test', syncNow: 'Load data from server', pushNow: 'Send data to server', pullFailedOffline: 'Download failed. Local data remains available.', pushFailedOffline: 'Upload failed. Local data stays pending until the server is reachable.', dailyBackupProfile: 'Daily automatic backup profile', online: 'Online', available: 'Available', offline: 'Offline', serverOffline: 'Desktop server is offline.', serverOfflineUsingCache: 'Desktop server is offline. Using local cached catalog.', deleteEntryConfirm: 'Delete this entry?', deleteActivityConfirm: 'Delete this activity?', exportCanceled: 'Export canceled.', importCanceled: 'Import canceled.', foods: 'Foods', noSyncedItems: 'No synced foods or recipes yet. Start the desktop server or add a GitHub CSV source and sync.', appDataExportCreated: 'App data export created.', appDataImported: 'App data imported.', importFailed: 'Import failed', confirmImportOverwrite: 'This backup will overwrite all current local app data. Continue?', invalidBackupFile: 'This is not a valid nutrino mobile app backup.', clearCachedConfirm: 'Clear synced foods, recipes, activities and merge aliases from the mobile cache? Diary logs remain on the device. The next server download will reload a full catalog snapshot.', cachedCatalogCleared: 'Cached catalog cleared. The next server download will fully reload the catalog.', privacyBody: 'nutrino stores your profile, diary, food cache and activity data locally on your device. The app only talks to your paired desktop server on your network. We do not collect, sell or upload your data to third-party services.', reportIssue: 'Report an issue', reportIssueBody: 'Open GitHub Issues to report bugs or request features.', openRepository: 'Open GitHub repository', openRepositoryBody: 'View the source code, README and releases.', starProject: 'Star nutrino on GitHub', starProjectBody: 'If nutrino is useful, a star helps the project.', license: 'License', sourceCode: 'Source code', factoryReset: 'Factory reset', factoryResetBody: 'Delete all local app data and restart onboarding.', factoryResetConfirm: 'This deletes all local mobile diary, profile, cached catalog and settings data. Continue?', onboardingTitle: 'Set up nutrino', onboardingIntro: 'Add your basic profile so kcal, BMI and goals can be calculated.', onboardingProfile: 'Profile basics', onboardingTour: 'Quick tour', onboardingTourBody: 'Home shows calories and macros. Diary shows your calendar. Recipes lists synced catalog items. Profile stores your body and goal settings.', finishSetup: 'Finish setup', next: 'Next', back: 'Back', startUsingNutrino: 'Start using nutrino', restoreBackup: 'Restore backup', restore: 'Restore', backupProfiles: 'Backup profiles', backupProfilesBody: 'Local restore points are stored separately from your normal profile and survive in-app factory reset.', noBackupProfiles: 'No local backup profiles yet.', createBackupProfile: 'Create backup profile', manualBackupProfile: 'Manual backup profile', exportBackupProfile: 'Export restore point', beforeFactoryResetBackupProfile: 'Before factory reset', beforeImportBackupProfile: 'Before import', importBackupProfile: 'Imported backup', beforeBackupProfileRestore: 'Before backup profile restore', restoreBackupProfile: 'Restore local profile', backupProfileCreated: 'Backup profile saved.', backupProfileDeleted: 'Backup profile deleted.', backupProfileRestored: 'Backup profile restored.', backupProfileMissing: 'Backup profile is no longer available.', confirmRestoreBackupProfile: 'Restore this local backup profile? Current app data will be saved as a safety restore point first.', backupProfileSaveFailed: 'Could not save a local backup profile', backupProfilesUnavailable: 'Backup profile storage is unavailable on this device.', continueFactoryResetWithoutBackup: 'Continue factory reset without a safety restore point?', continueExternalExport: 'Continue external ZIP export anyway?', emptyBackupFile: 'The selected backup file is empty (0 B).', backupVerifySizeMismatch: 'Export verification size mismatch:', backupVerifyFailed: 'External ZIP export could not be verified; a browser download fallback was attempted.', backupProfileStillAvailable: 'A local backup profile is still available in the app.', exportFailed: 'Export failed', backupWriteFailed: 'Backup file write failed', mobileShareUnavailable: 'This device does not support safe mobile ZIP sharing. The unstable mobile save/download export was not used, so no 0 B ZIP was created.', mobileShareSheetHint: 'Choose Files, Drive or another storage app in the system share sheet.',
  },
  hu: {
    home: 'Kezdőlap', diary: 'Napló', recipes: 'Receptek', profile: 'Profil', settings: 'Beállítások', synced: 'Szinkronban', syncing: 'Szinkronizálás', pending: 'függő',
    supplied: 'bevitt', burned: 'elégetett', kcalLeft: 'kcal maradt', tooMuch: 'túllépve', activity: 'Aktivitás', breakfast: 'Reggeli', lunch: 'Ebéd', dinner: 'Vacsora', snack: 'Snack',
    carbs: 'szénhidrát', fat: 'zsír', protein: 'fehérje', addBurnedKcal: 'Elégetett kcal hozzáadása', startTheDay: 'Napindító étkezés', middayMeal: 'Déli étkezés', eveningMeal: 'Esti étkezés', smallMeals: 'Kisebb étkezések', addNewItem: 'Új tétel hozzáadása',
    unlockEditConfirm: 'Feloldod ennek a napnak a szerkesztését? Ez segít elkerülni a véletlen módosításokat régebbi napokon.', pressBackAgain: 'Nyomd meg újra a vissza gombot a kilépéshez.', noActivity: 'Nincs aktivitás erre a napra.', noEntries: 'Még nincs bejegyzés.', edit: 'Szerkesztés', delete: 'Törlés',
    units: 'Mértékegységek', calculations: 'Számítások', language: 'Nyelv', privacy: 'Adatvédelem', about: 'Névjegy', licenses: 'Licencek', thirdPartyNotices: 'Third-party notices', acknowledgements: 'Köszönetnyilvánítás', exportImport: 'Appadat export / import', clearCache: 'Gyorsítótár törlése',
    dailyReminder: 'Napi emlékeztető', theme: 'Téma', showActivity: 'Aktivitás követése', showMacros: 'Makrók megjelenítése', showMicros: 'Mikrotápanyagok megjelenítése',
    metric: 'Metrikus (kg, cm, ml)', imperial: 'Angolszász (lbs, ft, oz)', systemDefault: 'Rendszer alapértelmezett', english: 'Angol', hungarian: 'Magyar', cancel: 'Mégse', ok: 'OK', reset: 'Visszaállítás',
    unlockDay: 'Nap szerkesztésének feloldása', lockedNote: 'A nap módosításához előbb oldd fel a szerkesztést.', editingEnabled: 'Szerkesztés engedélyezve', selectedDayEntriesNote: 'A kiválasztott nap étkezései és aktivitásai lent láthatók.', target: 'cél', weight: 'súly', saveWeight: 'Súly mentése', weightForThisDay: 'Súly erre a napra kg-ban', editWeight: 'Súly szerkesztése', futureDateWarning: 'Ez a nap még a jövőben van. A jövőbeli naplózás pontatlanná teheti a naplódat. Biztosan folytatod?', weeklyWeightCheck: 'Heti súlyellenőrzés', weeklyWeightCheckBody: 'Hetente egyszer frissítsd a súlyod. Ha nem változik, a nutrino az utolsó ismert értékkel számol.', save: 'Mentés', addTo: 'Hozzáadás ehhez:', add: 'Hozzáadás', update: 'Frissítés', addActivity: 'Aktivitás hozzáadása', updateActivity: 'Aktivitás frissítése', customRecipe: 'Recept testreszabása', customRecipeHint: 'A módosítás csak ehhez a naplóbejegyzéshez mentődik.', customizedRecipe: 'egyedi recept', editRecipeLocally: 'Recept módosítása ehhez a bejegyzéshez', changeSelection: 'Étel/recept módosítása', selected: 'Kiválasztva', baseAmount: 'alap', onePiece: '1 db', selectFoodFirst: 'Előbb válassz ételt vagy receptet.', amountGreaterThanZero: 'A mennyiségnek nullánál nagyobbnak kell lennie.', enterValidWeight: 'Adj meg érvényes súlyt kg-ban.', weightSaved: 'Súly mentve.', activityUpdated: 'Aktivitás frissítve.', activityAdded: 'Aktivitás hozzáadva.', activities: 'aktivitás', entries: 'bejegyzés', foodAndRecipeSearch: 'Ételek és receptek keresése', searchIn: 'Keresés helye', searchScopeTitle: 'Cím', searchScopeAll: 'Minden', searchScopeBrand: 'Márka', searchScopeCategory: 'Típus', searchScopeDescription: 'Leírás', exactMatches: 'Pontos találatok', maybeYouMean: 'Talán erre gondoltál', activitySearch: 'Aktivitások keresése', recipe: 'Recept', food: 'Étel', ingredient: 'Alapanyag', grams: 'gramm', pieces: 'db', catalog: 'Katalógus', watch: 'Okosóra', manual: 'Kézi', minutes: 'perc', kcalFromWatchManual: 'kcal okosórából/kézzel', exportAppData: 'Appadatok exportálása', exportAppDataBody: 'Teljes helyi ZIP mentés készítése.', importAppData: 'Appadatok importálása', importAppDataBody: 'Válassz nutrino mobilapp ZIP mentést.', activityLevel: 'Aktivitás', activityLevelHint: 'A napi kcal cél számításához', weeklyGoal: 'Heti cél', perWeek: 'kg / hét', height: 'Magasság', age: 'Életkor', years: 'év', gender: 'Nem', apiSettings: 'API beállítások', appChannel: 'Csatorna', devApiHint: 'Fejlesztői módban az asztali LAN URL automatikus. Jelszó csak akkor kell, ha a desktop szerver kér.', apiUrl: 'API URL', pairingPassword: 'Szerver jelszó', pairingToken: 'Párosítási token', addKcalNote: 'Jegyzet', existingItem: 'Meglévő', noteEntry: 'Jegyzet', kcalNoteTitle: 'Jegyzet címe', kcalNoteDescription: 'Leírás', kcalNoteValue: 'kcal', localCatalogActions: 'Helyi katalógus műveletek', addLocalIngredient: 'Helyi alapanyag', addLocalFood: 'Helyi étel', addLocalRecipe: 'Helyi recept', addLocalActivity: 'Helyi aktivitás', localItemCreated: 'Helyi tétel mentve. Szinkronizáld, ha elérhető a desktop szerver.', genderHint: 'A kcal becsléshez', male: 'Férfi', female: 'Nő', nonBinary: 'Nem bináris', test: 'Teszt', syncNow: 'Adatok betöltése a szerverről', pushNow: 'Adatok küldése a szervernek', pullFailedOffline: 'Letöltés sikertelen. A helyi adatok továbbra is elérhetők.', pushFailedOffline: 'Küldés sikertelen. A helyi adatok függőben maradnak, amíg elérhető lesz a szerver.', dailyBackupProfile: 'Napi automatikus backup profil', online: 'Online', available: 'Elérhető', offline: 'Offline', serverOffline: 'Az asztali szerver offline.', serverOfflineUsingCache: 'Az asztali szerver offline. A helyi gyorsítótárat használom.', deleteEntryConfirm: 'Törlöd ezt a bejegyzést?', deleteActivityConfirm: 'Törlöd ezt az aktivitást?', exportCanceled: 'Export megszakítva.', importCanceled: 'Import megszakítva.', foods: 'Ételek', noSyncedItems: 'Még nincs szinkronizált étel vagy recept. Indítsd el az asztali szervert, vagy adj hozzá GitHub CSV forrást és szinkronizálj.', appDataExportCreated: 'Appadat export elkészült.', appDataImported: 'Appadatok importálva.', importFailed: 'Import sikertelen', confirmImportOverwrite: 'Ez a mentés felülír minden jelenlegi helyi appadatot. Folytatod?', invalidBackupFile: 'Ez nem érvényes nutrino mobilapp mentés.', clearCachedConfirm: 'Törlöd a szinkronizált alapanyagokat, ételeket, recepteket, aktivitásokat és merge aliasokat a mobil cache-ből? A naplóbejegyzések az eszközön maradnak. A következő szerveres letöltés teljes katalógus snapshotot kér.', cachedCatalogCleared: 'Gyorsítótárban lévő katalógus törölve. A következő szerveres letöltés teljes újratöltés lesz.', privacyBody: 'A nutrino a profilodat, naplódat, étel cache-edet és aktivitásadataidat helyben tárolja az eszközödön. Az app csak a párosított asztali szervereddel kommunikál a saját hálózatodon. Nem gyűjtünk, nem adunk el és nem töltünk fel adatot külső szolgáltatásba.', reportIssue: 'Hiba jelentése', reportIssueBody: 'GitHub Issues megnyitása hibákhoz és ötletekhez.', openRepository: 'GitHub repository megnyitása', openRepositoryBody: 'Forráskód, README és release-ek megtekintése.', starProject: 'Csillagozd meg GitHubon', starProjectBody: 'Ha hasznos a nutrino, egy csillag segíti a projektet.', license: 'Licenc', sourceCode: 'Forráskód', factoryReset: 'Gyári visszaállítás', factoryResetBody: 'Minden helyi appadat törlése és újrakezdés.', factoryResetConfirm: 'Ez törli az összes helyi mobil naplót, profilt, gyorsítótárat és beállítást. Folytatod?', onboardingTitle: 'nutrino beállítása', onboardingIntro: 'Add meg az alap profiladatokat, hogy a kcal, BMI és cél számítható legyen.', onboardingProfile: 'Profil alapadatok', onboardingTour: 'Gyors bemutató', onboardingTourBody: 'A Home mutatja a kalóriát és makrókat. A Napló a naptárad. A Receptek a szinkronizált katalógus. A Profilban vannak a testadatok és célok.', finishSetup: 'Beállítás mentése', next: 'Tovább', back: 'Vissza', startUsingNutrino: 'nutrino indítása', restoreBackup: 'Biztonsági mentés visszaállítása', restore: 'Visszaállítás', backupProfiles: 'Backup profilok', backupProfilesBody: 'A helyi visszaállítási pontok külön vannak a normál profiltól, és túlélik az appon belüli gyári visszaállítást.', noBackupProfiles: 'Még nincs helyi backup profil.', createBackupProfile: 'Backup profil létrehozása', manualBackupProfile: 'Kézi backup profil', exportBackupProfile: 'Export visszaállítási pont', beforeFactoryResetBackupProfile: 'Gyári visszaállítás előtt', beforeImportBackupProfile: 'Import előtt', importBackupProfile: 'Importált mentés', beforeBackupProfileRestore: 'Backup profil visszaállítása előtt', restoreBackupProfile: 'Helyi profil visszaállítása', backupProfileCreated: 'Backup profil mentve.', backupProfileDeleted: 'Backup profil törölve.', backupProfileRestored: 'Backup profil visszaállítva.', backupProfileMissing: 'A backup profil már nem érhető el.', confirmRestoreBackupProfile: 'Visszaállítod ezt a helyi backup profilt? A jelenlegi appadat előtte biztonsági visszaállítási pontként mentésre kerül.', backupProfileSaveFailed: 'Nem sikerült helyi backup profilt menteni', backupProfilesUnavailable: 'A backup profil tárhely nem érhető el ezen az eszközön.', continueFactoryResetWithoutBackup: 'Folytatod a gyári visszaállítást biztonsági visszaállítási pont nélkül?', continueExternalExport: 'Folytatod a külső ZIP exportot így is?', emptyBackupFile: 'A kiválasztott mentés üres (0 B).', backupVerifySizeMismatch: 'Az export ellenőrzött mérete eltér:', backupVerifyFailed: 'A külső ZIP export nem ellenőrizhető; böngészős letöltési fallback indult.', backupProfileStillAvailable: 'A helyi backup profil továbbra is elérhető az appban.', exportFailed: 'Export sikertelen', backupWriteFailed: 'A mentés fájlba írása sikertelen', mobileShareUnavailable: 'Ez a készülék nem támogatja a biztonságos mobil ZIP megosztást. Az instabil mobil mentés/letöltés exportot nem használjuk, így nem készül 0 B ZIP.', mobileShareSheetHint: 'A rendszer megosztási ablakában válaszd a Fájlok, Drive vagy más tárhely appot.',
  },
};

function t(key: string) {
  return translations[activeLanguage.value]?.[key] ?? translations.en[key] ?? key;
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
    name: '', brand: '', note: '', barcode: '', default_unit: 'g', serving_size_g: null,
    kcal_per_100g: null, carbs_per_100g: 0, fat_per_100g: 0, protein_per_100g: 0,
    sugars_per_100g: 0, fiber_per_100g: 0, salt_per_100g: 0,
    description: '', total_weight_g: null, servings_count: null,
    code: '', activity_type: 'custom', met: 0, kcal_per_min: null,
  });
  localRecipeItems.value = [];
}

function openLocalCatalogEditor(kind: LocalEditorKind, item?: Food | Ingredient | Recipe | ActivityDefinition) {
  catalogMenuOpen.value = false;
  localEditorKind.value = kind;
  localEditorId.value = item?.id ? String(item.id).replace(/^ingredient:/, '').replace(/^recipe:/, '') : null;
  resetLocalCatalogForm();
  if (kind === 'ingredient' || kind === 'food') {
    const entry = item as Food | Ingredient | undefined;
    Object.assign(localCatalogForm, {
      name: entry?.name ?? '',
      brand: kind === 'food' ? ((entry as Food | undefined)?.brand ?? '') : '',
      note: entry?.note ?? '',
      barcode: kind === 'food' ? ((entry as Food | undefined)?.barcode ?? '') : '',
      default_unit: entry?.default_unit || 'g',
      serving_size_g: entry?.serving_size_g ?? null,
      kcal_per_100g: entry?.kcal_per_100g ?? null,
      carbs_per_100g: entry?.carbs_per_100g ?? 0,
      fat_per_100g: entry?.fat_per_100g ?? 0,
      protein_per_100g: entry?.protein_per_100g ?? 0,
      sugars_per_100g: entry?.sugars_per_100g ?? 0,
      fiber_per_100g: entry?.fiber_per_100g ?? 0,
      salt_per_100g: entry?.salt_per_100g ?? 0,
    });
  } else if (kind === 'recipe') {
    const recipe = item as Recipe | undefined;
    Object.assign(localCatalogForm, {
      name: recipe?.name ?? '',
      description: recipe?.description ?? '',
      note: recipe?.note ?? '',
      total_weight_g: recipe?.total_weight_g ?? null,
      servings_count: recipe?.servings_count ?? null,
    });
    localRecipeItems.value = recipe
      ? state.recipeItems.filter((entry) => entry.recipe_id === recipe.id && !entry.deleted_at).map((entry) => ({ food_id: entry.food_id, amount_g: Number(entry.amount_g || 0) }))
      : [];
    if (!localRecipeItems.value.length) localRecipeItems.value = [{ food_id: localRecipeCatalogOptions.value[0]?.id ?? '', amount_g: 100 }];
  } else {
    const activity = item as ActivityDefinition | undefined;
    Object.assign(localCatalogForm, {
      name: activity?.name ?? '',
      code: activity?.code ?? '',
      description: activity?.description ?? '',
      activity_type: activity?.activity_type || activity?.type || 'custom',
      met: activity?.met ?? 0,
      kcal_per_min: activity?.kcal_per_min ?? null,
    });
  }
  localEditorOpen.value = true;
  nextTick(() => scrollFocusedInputIntoView());
}


function addLocalRecipeItem() {
  localRecipeItems.value.push({ food_id: localRecipeCatalogOptions.value[0]?.id ?? '', amount_g: 100 });
}

function removeLocalRecipeItem(index: number) {
  localRecipeItems.value.splice(index, 1);
  if (!localRecipeItems.value.length) addLocalRecipeItem();
}

function localRecipeItemLabel(foodId: string): string {
  const item = localRecipeCatalogOptions.value.find((entry) => entry.id === foodId);
  if (!item) return foodId || 'Select item';
  if (item.id.startsWith('recipe:')) return `${t('recipe')} · ${item.name}`;
  if (item.id.startsWith('ingredient:')) return `${t('ingredient')} · ${item.name}`;
  return `${t('food')} · ${item.name}${item.brand ? ` · ${item.brand}` : ''}`;
}

function requestCloseLocalEditor() {
  if (window.confirm('Close this editor without saving?')) localEditorOpen.value = false;
}

function saveLocalCatalogEditor() {
  const name = localCatalogForm.name.trim();
  if (!name) return showToast('Name is required.');
  const now = Date.now();
  const id = localEditorId.value || generateId(`${localEditorKind.value}-local`);
  if (localEditorKind.value === 'ingredient') {
    const ingredient: Ingredient = {
      id, source_id: state.pairing.sourceId, name,
      note: localCatalogForm.note.trim() || null,
      default_unit: localCatalogForm.default_unit || 'g',
      serving_size_g: Number(localCatalogForm.serving_size_g || 0) > 0 ? Number(localCatalogForm.serving_size_g) : null,
      kcal_per_100g: Number(localCatalogForm.kcal_per_100g || 0),
      carbs_per_100g: Number(localCatalogForm.carbs_per_100g || 0),
      fat_per_100g: Number(localCatalogForm.fat_per_100g || 0),
      protein_per_100g: Number(localCatalogForm.protein_per_100g || 0),
      sugars_per_100g: Number(localCatalogForm.sugars_per_100g || 0),
      fiber_per_100g: Number(localCatalogForm.fiber_per_100g || 0),
      salt_per_100g: Number(localCatalogForm.salt_per_100g || 0),
      updated_at: now, deleted_at: null, pending_sync: true,
    };
    state.ingredients = [...state.ingredients.filter((entry) => entry.id !== id), ingredient].sort((a, b) => a.name.localeCompare(b.name));
  } else if (localEditorKind.value === 'food') {
    const food: Food = {
      id, source_id: state.pairing.sourceId, name,
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
      sugars_per_100g: Number(localCatalogForm.sugars_per_100g || 0),
      fiber_per_100g: Number(localCatalogForm.fiber_per_100g || 0),
      salt_per_100g: Number(localCatalogForm.salt_per_100g || 0),
      updated_at: now, deleted_at: null, pending_sync: true,
    };
    state.foods = [...state.foods.filter((entry) => entry.id !== id), food].sort((a, b) => a.name.localeCompare(b.name));
  } else if (localEditorKind.value === 'recipe') {
    const recipe: Recipe = {
      id, source_id: state.pairing.sourceId, name,
      description: localCatalogForm.description.trim() || null,
      note: localCatalogForm.note.trim() || null,
      total_weight_g: Number(localCatalogForm.total_weight_g || 0) > 0 ? Number(localCatalogForm.total_weight_g) : null,
      servings_count: Number(localCatalogForm.servings_count || 0) > 0 ? Number(localCatalogForm.servings_count) : null,
      updated_at: now, deleted_at: null, pending_sync: true,
    };
    state.recipes = [...state.recipes.filter((entry) => entry.id !== id), recipe].sort((a, b) => a.name.localeCompare(b.name));
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
      code: localCatalogForm.code.trim() || id,
      name,
      description: localCatalogForm.description.trim() || null,
      type: localCatalogForm.activity_type || 'custom',
      activity_type: localCatalogForm.activity_type || 'custom',
      met: Number(localCatalogForm.met || 0),
      kcal_per_min: Number(localCatalogForm.kcal_per_min || 0),
      updated_at: now, deleted_at: null, pending_sync: true,
    };
    state.activities = [...state.activities.filter((entry) => entry.id !== id), activity].sort((a, b) => a.name.localeCompare(b.name));
  }
  localEditorOpen.value = false;
  showToast(t('localItemCreated'));
}

function editCatalogItem(item: Food) {
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
  foodAmount.value = null;
  search.value = '';
  nextTick(() => scrollFocusedInputIntoView());
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
    sugars_per_100g: 0,
    fiber_per_100g: 0,
    salt_per_100g: 0,
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
    pending_sync: true,
    updated_at: now,
  };
  if (editingIntakeId.value) {
    state.intakes = state.intakes.map((entry) => entry.id === editingIntakeId.value ? { ...entry, ...payload } : entry);
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
  return new Intl.DateTimeFormat(activeLanguage.value === 'hu' ? 'hu-HU' : 'en', { month: 'short', day: '2-digit' }).format(new Date(value));
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat(activeLanguage.value === 'hu' ? 'hu-HU' : 'en', { month: 'long', year: 'numeric' }).format(date);
}

function itemTitle(food?: Food) {
  if (!food) return 'Unknown item';
  return food.brand ? `${food.name} · ${food.brand}` : food.name;
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
  const item = selectedCatalog.value;
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

  const restored = snapshot && typeof snapshot === 'object' ? (snapshot as { recipe_components?: Array<{ key?: string; food_id?: string; amount_g?: number }> }).recipe_components : undefined;
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

function buildCustomRecipeSnapshot(base: Food): Food {
  const recipeId = recipeIdFromCatalogId(base.id);
  if (!recipeId) return base;
  const rows = recipeComponentRows(base.id);
  let totalWeight = 0;
  let kcal = 0;
  let carbs = 0;
  let fat = 0;
  let protein = 0;
  const components: Array<{ key: string; food_id: string; amount_g: number; base_amount_g: number }> = [];

  for (const row of rows) {
    const amount = Math.max(0, Number(recipeIngredientAmounts.value[row.key] ?? row.baseAmount ?? 0));
    if (!row.food || amount <= 0) continue;
    totalWeight += amount;
    kcal += row.food.kcal_per_100g * amount / 100;
    carbs += row.food.carbs_per_100g * amount / 100;
    fat += row.food.fat_per_100g * amount / 100;
    protein += row.food.protein_per_100g * amount / 100;
    components.push({ key: row.key, food_id: row.food.id, amount_g: amount, base_amount_g: row.baseAmount });
  }

  if (totalWeight <= 0) return base;
  const ratio = 100 / totalWeight;
  return {
    ...base,
    brand: components.some((component) => component.amount_g !== component.base_amount_g) ? 'Recipe · customized' : base.brand,
    serving_size_g: totalWeight,
    kcal_per_100g: kcal * ratio,
    carbs_per_100g: carbs * ratio,
    fat_per_100g: fat * ratio,
    protein_per_100g: protein * ratio,
    recipe_components: components,
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

function kcalTone(kcal: number, goal: number) {
  const ratio = goal > 0 ? kcal / goal : 0;
  if (ratio <= 0.9) return 'kcal-low';
  if (ratio <= 1.05) return 'kcal-ok';
  if (ratio <= 1.2) return 'kcal-warn';
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

function dayMacroSummary(key: string) {
  const intakes = dayIntakes(key);
  const activities = dayActivities(key);
  const burned = Math.round(activities.reduce((sum, entry) => sum + entry.kcal, 0));
  const kcalGoal = Math.max(1, dailyKcalGoal(profileForDay(key), burned) + Number(state.settings.kcal_adjustment || 0));
  const summary = macroForEntries(intakes);
  return {
    kcal: summary.kcal,
    kcalGoal,
    carbs: summary.carbs,
    carbsGoal: Math.max(1, Math.round((kcalGoal * (state.settings.macro_carbs_percent || 60) / 100) / 4)),
    fat: summary.fat,
    fatGoal: Math.max(1, Math.round((kcalGoal * (state.settings.macro_fat_percent || 25) / 100) / 9)),
    protein: summary.protein,
    proteinGoal: Math.max(1, Math.round((kcalGoal * (state.settings.macro_protein_percent || 15) / 100) / 4)),
  };
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

function openQuickAddMenu() {
  quickAddOpen.value = true;
}

async function chooseQuickAdd(section: MealSection) {
  quickAddOpen.value = false;
  if (section.key === 'activity') {
    await openActivityAdd();
    return;
  }
  await openFoodAdd(section.key);
}

function requestCloseSheet() {
  if (!addMode.value || window.confirm('Bezárod az adatfelviteli panelt mentés nélkül?')) {
    closeSheet();
  }
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
    pending_sync: true,
    updated_at: now,
  };
  if (editingIntakeId.value) {
    state.intakes = state.intakes.map((entry) => entry.id === editingIntakeId.value ? { ...entry, ...payload } : entry);
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
    pending_sync: true,
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
  if (serverChecking.value || !state.pairing.baseUrl.trim()) return;
  serverChecking.value = true;
  try {
    const health = await checkServerHealth(state.pairing.baseUrl, authPassword());
    serverOnline.value = true;
    state.pairing.lastHealthCheckAt = Date.now();
    state.pairing.lastSyncError = undefined;
    clearOfflineToastMemory();
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
  try {
    const message = await pingServer(state.pairing.baseUrl, authPassword());
    state.pairing.lastSyncError = undefined;
    showToast(message);
  } catch (error) {
    state.pairing.lastSyncError = String(error);
    showToast(String(error));
  }
}

async function runServerTransfer(mode: 'pull' | 'push', options: { quiet?: boolean } = {}) {
  syncBusy.value = true;
  try {
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

async function syncGitHubDailyIfDue() {
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
  const normalized = name.trim().toLowerCase();
  if (kind === 'ingredient') return state.ingredients.some((item) => item.id === id || item.name.trim().toLowerCase() === normalized);
  if (kind === 'activity') return state.activities.some((item) => item.id === id || item.name.trim().toLowerCase() === normalized);
  if (kind === 'recipe') return state.recipes.some((item) => item.id === id || item.name.trim().toLowerCase() === normalized);
  return state.foods.some((item) => item.id === id || item.name.trim().toLowerCase() === normalized);
}

function recordCatalogPayload(payload: any) {
  const now = Date.now();
  const kind = payload?.kind;
  const item = payload?.item;
  if (!kind || !item?.name) return showToast('This QR code is not a Nutrino catalog item.');
  const id = String(item.id || generateId(kind));
  const duplicate = importedCatalogDuplicate(kind, id, String(item.name));
  const proceed = window.confirm(`${duplicate ? 'Possible duplicate found. ' : ''}Add/edit "${item.name}" in your local catalog?`);
  if (!proceed) return;

  if (kind === 'ingredient') {
    const ingredient: Ingredient = {
      id,
      source_id: state.pairing.sourceId,
      name: String(item.name),
      note: item.note ?? null,
      default_unit: item.default_unit || 'g',
      serving_size_g: item.serving_size_g ?? null,
      kcal_per_100g: Number(item.kcal_per_100g || 0),
      carbs_per_100g: Number(item.carbs_per_100g || 0),
      fat_per_100g: Number(item.fat_per_100g || 0),
      protein_per_100g: Number(item.protein_per_100g || 0),
      sugars_per_100g: Number(item.sugars_per_100g || 0),
      fiber_per_100g: Number(item.fiber_per_100g || 0),
      salt_per_100g: Number(item.salt_per_100g || 0),
      updated_at: now,
      deleted_at: null,
      pending_sync: true,
    };
    state.ingredients = [...state.ingredients.filter((entry) => entry.id !== id), ingredient].sort((a, b) => a.name.localeCompare(b.name));
  } else if (kind === 'food') {
    const food: Food = {
      id,
      source_id: state.pairing.sourceId,
      name: String(item.name),
      brand: item.brand ?? null,
      note: item.note ?? null,
      default_unit: item.default_unit || 'g',
      serving_size_g: item.serving_size_g ?? null,
      kcal_per_100g: Number(item.kcal_per_100g || 0),
      carbs_per_100g: Number(item.carbs_per_100g || 0),
      fat_per_100g: Number(item.fat_per_100g || 0),
      protein_per_100g: Number(item.protein_per_100g || 0),
      sugars_per_100g: Number(item.sugars_per_100g || 0),
      fiber_per_100g: Number(item.fiber_per_100g || 0),
      salt_per_100g: Number(item.salt_per_100g || 0),
      barcode: item.barcode ?? null,
      updated_at: now,
      deleted_at: null,
      pending_sync: true,
    };
    state.foods = [...state.foods.filter((entry) => entry.id !== id), food].sort((a, b) => a.name.localeCompare(b.name));
  } else if (kind === 'recipe') {
    const recipe: Recipe = { id, source_id: state.pairing.sourceId, name: String(item.name), description: item.description ?? null, note: item.note ?? null, total_weight_g: item.total_weight_g ?? null, servings_count: item.servings_count ?? null, updated_at: now, deleted_at: null, pending_sync: true };
    state.recipes = [...state.recipes.filter((entry) => entry.id !== id), recipe].sort((a, b) => a.name.localeCompare(b.name));
  } else if (kind === 'activity') {
    const activity: ActivityDefinition = { id, source_id: state.pairing.sourceId, code: item.code || id, name: String(item.name), description: item.description ?? null, activity_type: item.activity_type || item.type || 'custom', met: Number(item.met || 1), kcal_per_min: Number(item.kcal_per_min || 0), updated_at: now, deleted_at: null, pending_sync: true };
    state.activities = [...state.activities.filter((entry) => entry.id !== id), activity].sort((a, b) => a.name.localeCompare(b.name));
  }
  showToast('Catalog item saved locally. Send it to the server when ready.');
}

function applyScannedValue(rawValue = scanInput.value) {
  const value = normalizeScanValue(rawValue);
  if (!value) return;
  try {
    const prefix = 'nutrino-catalog-v1:';
    if (value.startsWith(prefix)) {
      const json = decodeURIComponent(escape(atob(value.slice(prefix.length))));
      recordCatalogPayload(JSON.parse(json));
      closeScanner();
      return;
    }
  } catch { /* fall through to barcode */ }

  const item = findCatalogByBarcodeOrPayload(value);
  if (item) {
    chooseCatalogItem(item);
    closeScanner();
    showToast(`Selected ${item.name}.`);
    return;
  }
  showToast('No matching food or recipe found for this code.');
}

async function openScanner(mode: 'catalog' | 'barcode' = 'catalog') {
  scanDialogMode.value = mode;
  scanInput.value = '';
  scanDialogOpen.value = true;
  await nextTick();
  await startCameraScanner();
}

async function startCameraScanner() {
  const video = scanVideo.value;
  const Detector = (window as any).BarcodeDetector;
  if (!video || !Detector || !navigator.mediaDevices?.getUserMedia) return;
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scannerStream;
    await video.play();
    scannerActive.value = true;
    const detector = new Detector({ formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
    const tick = async () => {
      if (!scannerActive.value || !scanDialogOpen.value) return;
      try {
        const codes = await detector.detect(video);
        if (codes?.[0]?.rawValue) { applyScannedValue(codes[0].rawValue); return; }
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

function normalizeImportedState(parsed: Partial<AppState>): AppState {
  const defaults = defaultState();
  const profile = (parsed.profile ?? {}) as Partial<AppState['profile']>;
  const pairing = (parsed.pairing ?? {}) as Partial<AppState['pairing']>;
  const settings = (parsed.settings ?? {}) as Partial<AppState['settings']>;

  return {
    ...defaults,
    ...parsed,
    settings: { ...defaults.settings, ...settings },
    pairing: { ...defaults.pairing, ...pairing },
    profile: {
      ...defaults.profile,
      ...profile,
      plan_start_weight_kg: profile.plan_start_weight_kg || profile.current_weight_kg || defaults.profile.current_weight_kg,
    },
    foods: Array.isArray(parsed.foods) ? parsed.foods : [],
    recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
    recipeItems: Array.isArray(parsed.recipeItems) ? parsed.recipeItems : [],
    activities: Array.isArray(parsed.activities) && parsed.activities.length ? parsed.activities : defaults.activities,
    intakes: Array.isArray(parsed.intakes) ? parsed.intakes : [],
    activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
    weightLogs: Array.isArray(parsed.weightLogs) ? parsed.weightLogs : [],
  };
}

function applyImportedState(text: string) {
  const parsed = JSON.parse(text) as Partial<AppState>;
  if (!parsed || typeof parsed !== 'object') throw new Error(t('invalidBackupFile'));
  const knownKeys = ['profile', 'pairing', 'settings', 'foods', 'recipes', 'activities', 'intakes', 'activityLogs', 'weightLogs'];
  if (!knownKeys.some((key) => key in parsed)) throw new Error(t('invalidBackupFile'));
  const imported = normalizeImportedState(parsed);
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

async function exportAppData() {
  refreshTodayKey();
  let localProfileSaved = false;
  try {
    await createBackupProfile(t('exportBackupProfile'));
    localProfileSaved = true;
  } catch (error) {
    if (!window.confirm(`${t('backupProfileSaveFailed')}: ${String(error)}\n${t('continueExternalExport')}`)) return;
  }

  try {
    const filename = mobileBackupFileName();
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
        showToast(`${t('appDataExportCreated')} (${formatBytes(bytes.length)})`);
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
      showToast(`${t('appDataExportCreated')} (${formatBytes(bytes.length)})`);
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

async function importAppData() {
  try {
    const bytes = await pickBackupBytesForImport();
    if (!bytes) return showToast(t('importCanceled'));
    assertValidZipBytes(bytes);
    const zip = await JSZip.loadAsync(bytes);
    const manifestText = await zip.file('manifest.json')?.async('string');
    const dataText = await zip.file('mobile-app-data.json')?.async('string');
    if (!dataText) throw new Error(t('invalidBackupFile'));
    if (manifestText) {
      const manifest = JSON.parse(manifestText) as { app?: string; formatVersion?: number; exportType?: string };
      if (manifest.app !== 'nutrino' || manifest.formatVersion !== 1 || manifest.exportType !== 'mobile-app') {
        throw new Error(t('invalidBackupFile'));
      }
    }
    if (!window.confirm(t('confirmImportOverwrite'))) return showToast(t('importCanceled'));
    await createBackupProfile(t('beforeImportBackupProfile'));
    applyImportedState(dataText);
    await createBackupProfile(t('importBackupProfile'));
    showToast(t('appDataImported'));
  } catch (error) {
    showToast(`${t('importFailed')}: ${String(error)}`);
  }
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
        <span class="app-logo-mark" v-html="nutrinoLogoSvg"></span>
        <div>
          <small>nutrino</small>
          <h1>{{ pageTitle() }}</h1>
        </div>
      </div>
      <div class="appbar-actions">
        <button class="sync-chip" :disabled="syncBusy" @click="syncNow()">
          <span class="sync-dot" :class="serverOnline ? '' : githubCatalogAvailable ? 'available' : 'offline'"></span>
          {{ syncBusy ? t('syncing') : serverOnline ? t('online') : githubCatalogAvailable ? t('available') : t('offline') }}
        </button>
        <button class="settings-button" :aria-label="t('settings')" @click="openSettings">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.4 8.4 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A8.4 8.4 0 0 0 7 6L4.6 5 2.6 8.5l2 1.5a8.8 8.8 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8.4 8.4 0 0 0 2.6 1.5L10 22h4l.4-2.5A8.4 8.4 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/></svg>
        </button>
      </div>
    </header>

    <section v-if="activeTab === 'home'" class="page-stack home-page">
      <article v-if="weightPromptDue" class="card weight-prompt">
        <div>
          <b>{{ t('weeklyWeightCheck') }}</b>
          <p>{{ t('weeklyWeightCheckBody') }}</p>
        </div>
        <div class="inline-form compact">
          <input v-model.number="weightInput" class="input" type="number" step="0.1" min="1" placeholder="kg"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  inputmode="decimal" />
          <button class="filled-button" @click="recordWeight('mobile_prompt')">{{ t('save') }}</button>
        </div>
      </article>

      <article class="card dashboard-card">
        <div class="source-action"><button class="icon-button" aria-label="Sources" v-html="lucideSvg('info')"></button></div>
        <div class="dashboard-row">
          <div class="side-stat">
            <span class="arrow" v-html="lucideSvg('chevronUp')"></span>
            <b>{{ consumedKcal }}</b>
            <small>{{ t('supplied') }}</small>
          </div>
          <div class="kcal-ring-wrap">
            <svg class="kcal-ring" viewBox="0 0 220 220">
              <circle cx="110" cy="110" r="90" class="ring-bg" :stroke-dasharray="`${kcalArcLength} ${ringCircumference}`" />
              <circle cx="110" cy="110" r="90" class="ring-fg" :stroke-dasharray="kcalProgressDash" />
            </svg>
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

      <article v-for="section in sections" :key="section.key" class="card meal-card">
        <button class="meal-header" @click="section.key === 'activity' ? openActivityAdd() : openFoodAdd(section.key)">
          <span class="material-icon" v-html="mealIconSvg[section.icon]"></span>
          <span><b>{{ t(section.key) }}</b><small>{{ sectionHint(section) }}</small></span>
          <span class="section-summary-text">{{ sectionSummaryText(section) }}</span>
          <span class="plus-button">+</span>
        </button>
        <div v-if="section.key === 'activity'" class="entry-list">
          <div v-for="activity in activitiesForSection()" :key="activity.id" class="entry-row">
            <div><b>{{ activity.activity_name }}</b><small>{{ activity.duration_min }} min · {{ activity.kcal }} kcal · {{ activity.source }}</small></div>
            <div class="entry-actions"><button class="text-button" @click="editActivityLog(activity)">{{ t('edit') }}</button><button class="delete-button" @click="removeActivity(activity.id)">{{ t('delete') }}</button></div>
          </div>
          <p v-if="!activitiesForSection().length" class="empty-line">{{ t('noActivity') }}</p>
        </div>
        <div v-else class="entry-list">
          <div v-for="entry in entriesForSection(section)" :key="entry.id" class="entry-row">
            <div><b>{{ itemTitle(foodFromIntake(entry)) }}</b><small>{{ amountLabel(entry.amount_g, foodFromIntake(entry)) }} · {{ intakeKcal(entry) }} kcal</small></div>
            <div class="entry-actions"><button class="text-button" @click="editIntake(entry)">{{ t('edit') }}</button><button class="delete-button" @click="removeIntake(entry.id)">{{ t('delete') }}</button></div>
          </div>
          <p v-if="!entriesForSection(section).length" class="empty-line">{{ t('noEntries') }}</p>
        </div>
      </article>
    </section>

    <section v-if="activeTab === 'diary'" class="page-stack">
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

      <article class="card">
        <h2>{{ selectedDate }}</h2>
        <div class="diary-stats">
          <div :class="['kcal-stat', diaryKcalTone]"><span>{{ t('supplied') }}</span><b>{{ consumedKcal }} / {{ dailyGoal }} kcal</b></div>
          <div><span>{{ t('burned') }}</span><b>{{ burnedKcal }} kcal</b></div>
          <div class="weight-stat"><span>{{ t('weight') }}</span><b>{{ currentDayWeightKg ? `${Number(currentDayWeightKg).toFixed(1)} kg` : '—' }}</b><button class="mini-edit-button" @click="editSelectedDayWeight">{{ t('edit') }}</button></div>
          <div :class="['bmi-stat', currentBmiInfo.tone]"><span>BMI</span><b>{{ currentBmi || '—' }}</b></div>
        </div>
        <div class="selected-day-nutrition">
          <span><b>{{ selectedDayMacroSummary.carbs }}</b>/<em>{{ selectedDayMacroSummary.carbsGoal }}</em> {{ t('carbs') }}</span>
          <span><b>{{ selectedDayMacroSummary.fat }}</b>/<em>{{ selectedDayMacroSummary.fatGoal }}</em> {{ t('fat') }}</span>
          <span><b>{{ selectedDayMacroSummary.protein }}</b>/<em>{{ selectedDayMacroSummary.proteinGoal }}</em> {{ t('protein') }}</span>
        </div>
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
          <span v-if="selectedDayUnlocked" class="plus-button">+</span>
        </button>
        <div v-if="section.key === 'activity'" class="entry-list">
          <div v-for="activity in activitiesForSection()" :key="activity.id" class="entry-row">
            <div><b>{{ activity.activity_name }}</b><small>{{ activity.duration_min }} min · {{ activity.kcal }} kcal</small></div>
            <div v-if="selectedDayUnlocked" class="entry-actions"><button class="text-button" @click="editActivityLog(activity)">{{ t('edit') }}</button><button class="delete-button" @click="removeActivity(activity.id)">{{ t('delete') }}</button></div>
          </div>
          <p v-if="!activitiesForSection().length" class="empty-line">{{ t('noActivity') }}</p>
        </div>
        <div v-else class="entry-list">
          <div v-for="entry in entriesForSection(section)" :key="entry.id" class="entry-row">
            <div><b>{{ itemTitle(foodFromIntake(entry)) }}</b><small>{{ amountLabel(entry.amount_g, foodFromIntake(entry)) }} · {{ intakeKcal(entry) }} kcal</small></div>
            <div v-if="selectedDayUnlocked" class="entry-actions"><button class="text-button" @click="editIntake(entry)">{{ t('edit') }}</button><button class="delete-button" @click="removeIntake(entry.id)">{{ t('delete') }}</button></div>
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
            <button class="scan-button" type="button" aria-label="Scan barcode or QR" @click="openScanner('barcode')" v-html="lucideSvg('scanLine')"></button>
            <div class="catalog-menu-wrap">
              <button class="icon-button" type="button" aria-label="Catalog menu" @click="catalogMenuOpen = !catalogMenuOpen">⋯</button>
              <div v-if="catalogMenuOpen" class="catalog-menu-popover">
                <button @click="openLocalCatalogEditor('ingredient')">{{ t('addLocalIngredient') }}</button>
                <button @click="openLocalCatalogEditor('food')">{{ t('addLocalFood') }}</button>
                <button @click="openLocalCatalogEditor('recipe')">{{ t('addLocalRecipe') }}</button>
                <button @click="openLocalCatalogEditor('activity')">{{ t('addLocalActivity') }}</button>
              </div>
            </div>
          </div>
        </div>
        <input v-model="search" class="input search-input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Search synced catalog" @keydown.enter.prevent="hideKeyboard" />
        <label class="search-scope-control">
          <span>{{ t('searchIn') }}</span>
          <select v-model="catalogSearchScope" class="search-scope-select">
            <option v-for="scope in catalogSearchScopeOptions" :key="`catalog-scope-${scope}`" :value="scope">{{ t(`searchScope${scope.charAt(0).toUpperCase()}${scope.slice(1)}`) }}</option>
          </select>
        </label>
        <div class="catalog-freshness-row">
          <span>Ingredients: {{ formatFreshness(latestIngredientUpdatedAt) }}</span>
          <span>Foods: {{ formatFreshness(latestFoodUpdatedAt) }}</span>
          <span>Recipes: {{ formatFreshness(latestRecipeUpdatedAt) }}</span>
          <span>Activities: {{ formatFreshness(latestActivityUpdatedAt) }}</span>
        </div>
      </article>
      <template v-if="catalogSearchActive">
        <div v-if="catalogExactItems.length" class="search-result-heading">{{ t('exactMatches') }}</div>
        <article v-for="item in catalogExactItems" :key="`exact-${item.id}`" class="card catalog-card">
          <div><b>{{ item.name }}</b><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></div>
          <div class="catalog-card-actions"><span>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)} g / db` : 'g' }}</span><button class="text-button" @click="editCatalogItem(item)">{{ t('edit') }}</button></div>
        </article>
        <div v-if="catalogSuggestedItems.length" class="search-result-heading suggested">{{ t('maybeYouMean') }}</div>
        <article v-for="item in catalogSuggestedItems" :key="`suggested-${item.id}`" class="card catalog-card">
          <div><b>{{ item.name }}</b><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></div>
          <div class="catalog-card-actions"><span>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)} g / db` : 'g' }}</span><button class="text-button" @click="editCatalogItem(item)">{{ t('edit') }}</button></div>
        </article>
        <p v-if="!catalogHasSearchResults" class="empty-card">{{ t('noSyncedItems') }}</p>
      </template>
      <template v-else>
        <article v-for="item in visibleCatalogItems" :key="item.id" class="card catalog-card">
          <div><b>{{ item.name }}</b><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></div>
          <div class="catalog-card-actions"><span>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)} g / db` : 'g' }}</span><button class="text-button" @click="editCatalogItem(item)">{{ t('edit') }}</button></div>
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
            <option value="sedentary">Sedentary</option>
            <option value="low_active">Low active</option>
            <option value="active">Active</option>
            <option value="very_active">Very active</option>
          </select>
        </label>
        <label class="profile-tile">
          <span class="profile-tile-icon" v-html="lucideSvg('star')"></span>
          <span><b>{{ t('weeklyGoal') }}</b><small>{{ state.profile.weekly_goal_kg > 0 ? '+' : '' }}{{ Number(state.profile.weekly_goal_kg).toFixed(2) }} {{ t('perWeek') }}</small></span>
          <input v-model.number="state.profile.weekly_goal_kg" class="tile-range" type="range" min="-1" max="1" step="0.25" />
        </label>
        <label class="profile-tile">
          <span class="profile-tile-icon" v-html="lucideSvg('scale')"></span>
          <span><b>{{ t('weight') }}</b><small>kg</small></span>
          <input :value="state.profile.current_weight_kg" class="tile-input" type="number" min="2" max="640" step="0.1"  @focus="selectNumberInput"  @pointerdown="clearNumberInputOnDoubleTap"  @change="updateProfileWeight"  @keydown.enter="updateProfileWeight($event); hideKeyboard($event)" inputmode="decimal" />
        </label>
        <label class="profile-tile">
          <span class="profile-tile-icon" v-html="lucideSvg('ruler')"></span>
          <span><b>{{ t('height') }}</b><small>cm</small></span>
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

      <article class="card pairing-card">
        <h2>{{ t('apiSettings') }}</h2>
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
        <p v-if="state.pairing.lastSyncError" class="error-text">{{ state.pairing.lastSyncError }}</p>
      </article>

      <article class="card github-sync-card">
        <h2>GitHub CSV sources</h2>
        <p class="helper">Desktop server is optional. Add one or more GitHub repositories that contain Nutrino CSV files; the app syncs them at most once per day automatically, or on demand.</p>
        <div class="github-source-form">
          <input v-model="githubDraft.owner" class="input" placeholder="owner / organization" autocomplete="off" autocapitalize="none" />
          <input v-model="githubDraft.repo" class="input" placeholder="repository" autocomplete="off" autocapitalize="none" />
          <input v-model="githubDraft.branch" class="input" placeholder="branch, e.g. main" autocomplete="off" autocapitalize="none" />
          <input v-model="githubDraft.path" class="input" placeholder="optional path, e.g. nutrino/csv" autocomplete="off" autocapitalize="none" />
          <input v-model="githubDraft.token" class="input" type="password" placeholder="optional GitHub token" autocomplete="off" />
        </div>
        <div class="button-row">
          <button class="outlined-button" @click="addGitHubSource">Add repo</button>
          <button class="filled-button" :disabled="githubSyncBusy" @click="syncGitHubNow(true)">Sync GitHub now</button>
        </div>
        <div v-if="(state.githubSources || []).length" class="github-source-list">
          <article v-for="source in (state.githubSources || [])" :key="source.id" class="github-source-row">
            <label><input v-model="source.enabled" type="checkbox" /> <b>{{ source.owner }}/{{ source.repo }}</b></label>
            <small>{{ source.branch || 'main' }}{{ source.path ? ` · ${source.path}` : '' }} · {{ source.lastStatus || 'not synced yet' }}</small>
            <button class="text-button danger-text" @click="removeGitHubSource(source.id)">Remove</button>
          </article>
        </div>
      </article>
    </section>

    <button v-if="activeTab === 'home' && !addMode && !settingsOpen" class="home-quick-fab" :aria-label="t('addNewItem')" @click="openQuickAddMenu">+</button>

    <Teleport to="body">
      <div v-if="quickAddOpen" class="quick-add-backdrop app-overlay" @click.self="quickAddOpen = false">
        <article class="quick-add-sheet">
          <h2>{{ t('addNewItem') }}:</h2>
          <button v-for="section in sections" :key="`quick-${section.key}`" class="quick-add-option" @click="chooseQuickAdd(section)">
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
          <div v-if="foodSelectionInProgress" class="catalog-picker-zone">
            <div class="sticky-picker-search">
              <input v-model="search" class="input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" spellcheck="false" :placeholder="t('foodAndRecipeSearch')" @keydown.enter.prevent="hideKeyboard" />
              <button class="scan-button" type="button" aria-label="Scan barcode or QR" @click="openScanner('barcode')" v-html="lucideSvg('scanLine')"></button>
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
                    <span><b>{{ item.name }}</b><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
                <div v-if="catalogSuggestedPickerItems.length" class="picker-group suggested-picker-group">
                  <div class="picker-group-title">{{ t('maybeYouMean') }}</div>
                  <button v-for="item in catalogSuggestedPickerItems" :key="`picker-suggested-${item.id}`" class="picker-row" :class="selectedCatalogId === item.id ? 'selected' : ''" @click="chooseCatalogItem(item)">
                    <span><b>{{ item.name }}</b><small>{{ item.brand || catalogKindLabel(item) }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
              </template>
              <template v-else>
                <div v-if="visibleRecipeItems.length" class="picker-group">
                  <div class="picker-group-title">{{ t('recipes') }}</div>
                  <button v-for="item in visibleRecipeItems" :key="item.id" class="picker-row" :class="selectedCatalogId === item.id ? 'selected' : ''" @click="chooseCatalogItem(item)">
                    <span><b>{{ item.name }}</b><small>{{ item.brand || t('recipe') }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
                <div v-if="visibleIngredientItems.length" class="picker-group">
                  <div class="picker-group-title">{{ t('ingredient') }}</div>
                  <button v-for="item in visibleIngredientItems" :key="item.id" class="picker-row" :class="selectedCatalogId === item.id ? 'selected' : ''" @click="chooseCatalogItem(item)">
                    <span><b>{{ item.name }}</b><small>{{ t('ingredient') }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
                <div v-if="visibleFoodItems.length" class="picker-group">
                  <div class="picker-group-title">{{ t('foods') }}</div>
                  <button v-for="item in visibleFoodItems" :key="item.id" class="picker-row" :class="selectedCatalogId === item.id ? 'selected' : ''" @click="chooseCatalogItem(item)">
                    <span><b>{{ item.name }}</b><small>{{ item.brand || t('food') }} · {{ Math.round(item.kcal_per_100g) }} kcal / 100g</small><small v-if="item.note" class="catalog-note">{{ item.note }}</small></span>
                    <strong>{{ item.serving_size_g ? `${Math.round(item.serving_size_g)}g/db` : 'g' }}</strong>
                  </button>
                </div>
              </template>
            </div>
          </div>
          <div v-if="recipeCustomizeOpen && selectedRecipeComponents.length" class="recipe-customizer">
            <div class="recipe-customizer-title"><b>{{ t('customRecipe') }}</b><small>{{ t('customRecipeHint') }}</small></div>
            <div v-for="row in selectedRecipeComponents" :key="row.key" class="recipe-ingredient-row">
              <div><b>{{ row.name }}</b><small>{{ t('baseAmount') }} {{ row.baseAmount }} g<span v-if="row.servingSize"> · {{ Math.round(row.servingSize) }} g/{{ t('onePiece') }}</span></small></div>
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
            <button class="filled-button wide" @click="addFoodLog">{{ editingIntakeId ? t('update') : t('add') }}</button>
          </div>
          </template>
        </template>
        <template v-else>
          <h2>{{ editingActivityLogId ? t('edit') : t('addActivity') }}</h2>
          <div class="unit-toggle three">
            <button :class="activitySource === 'activity_catalog' ? 'active' : ''" @click="activitySource = 'activity_catalog'; clearSelectedActivityForChange()">{{ t('catalog') }}</button>
            <button :class="activitySource === 'watch' ? 'active' : ''" @click="activitySource = 'watch'; clearSelectedActivityForChange()">{{ t('watch') }}</button>
            <button :class="activitySource === 'manual' ? 'active' : ''" @click="activitySource = 'manual'; clearSelectedActivityForChange()">{{ t('manual') }}</button>
          </div>
          <article v-if="activitySource === 'activity_catalog' && selectedActivity" class="selected-item-card">
            <div class="selected-item-main">
              <b>{{ activityDisplayName(selectedActivity) }}</b>
              <small>{{ activityType(selectedActivity) }} · {{ selectedActivity.kcal_per_min }} kcal/min</small>
            </div>
            <div class="selected-item-actions"><button class="selection-action-button change-action" :title="t('changeSelection')" :aria-label="t('changeSelection')" @click="clearSelectedActivityForChange" v-html="lucideSvg('refreshCw')"></button></div>
          </article>
          <div v-if="activitySelectionInProgress" class="sticky-picker-search">
            <input v-model="search" class="input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" spellcheck="false" :placeholder="t('activitySearch')" @keydown.enter.prevent="hideKeyboard" />
            <button class="scan-button" type="button" aria-label="Scan QR" @click="openScanner('catalog')" v-html="lucideSvg('scanLine')"></button>
          </div>
          <div v-if="activitySelectionInProgress" class="picker-list">
            <button v-for="activity in visibleActivities" :key="activity.id" class="picker-row" :class="activityId === activity.id ? 'selected' : ''" @click="chooseActivity(activity)">
              <span><b>{{ activityDisplayName(activity) }}</b><small>{{ activityType(activity) }} · MET {{ activity.met }}</small></span>
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
      <div v-if="localEditorOpen" class="dialog-backdrop" @click.self="requestCloseLocalEditor">
        <article class="settings-dialog local-editor-dialog">
          <div class="dialog-title-row">
            <h2>{{ localEditorId ? t('edit') : t('add') }} {{ localEditorKind === 'ingredient' ? t('ingredient') : localEditorKind === 'food' ? t('food') : localEditorKind === 'recipe' ? t('recipe') : t('addActivity') }}</h2>
            <button class="text-button" @click="requestCloseLocalEditor">{{ t('cancel') }}</button>
          </div>
          <label class="field-label">Name</label>
          <input v-model="localCatalogForm.name" class="input" autocomplete="off" />

          <template v-if="localEditorKind === 'ingredient' || localEditorKind === 'food'">
            <label v-if="localEditorKind === 'food'" class="field-label">Brand / source</label>
            <input v-if="localEditorKind === 'food'" v-model="localCatalogForm.brand" class="input" placeholder="optional" />
            <label v-if="localEditorKind === 'food'" class="field-label">Barcode / QR</label>
            <div v-if="localEditorKind === 'food'" class="inline-field-action">
              <input v-model="localCatalogForm.barcode" class="input" placeholder="optional" />
              <button class="scan-button" type="button" aria-label="Scan barcode or QR" @click="openScanner('barcode')" v-html="lucideSvg('scanLine')"></button>
            </div>
            <label class="field-label">Note</label>
            <input v-model="localCatalogForm.note" class="input" placeholder="optional" />
            <div class="form-grid-two">
              <label class="field-label">kcal / 100g<input v-model.number="localCatalogForm.kcal_per_100g" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
              <label class="field-label">Serving size g<input v-model.number="localCatalogForm.serving_size_g" class="input" type="number" min="0" step="0.1" inputmode="decimal" placeholder="optional" /></label>
              <label class="field-label">Carbs<input v-model.number="localCatalogForm.carbs_per_100g" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
              <label class="field-label">Fat<input v-model.number="localCatalogForm.fat_per_100g" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
              <label class="field-label">Protein<input v-model.number="localCatalogForm.protein_per_100g" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
              <label class="field-label">Salt<input v-model.number="localCatalogForm.salt_per_100g" class="input" type="number" min="0" step="0.01" inputmode="decimal" /></label>
            </div>
          </template>

          <template v-else-if="localEditorKind === 'recipe'">
            <label class="field-label">Description</label>
            <textarea v-model="localCatalogForm.description" class="input textarea-input" rows="2"></textarea>
            <label class="field-label">Note</label>
            <input v-model="localCatalogForm.note" class="input" placeholder="optional" />
            <div class="form-grid-two">
              <label class="field-label">Total cooked weight g<input v-model.number="localCatalogForm.total_weight_g" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
              <label class="field-label">Servings<input v-model.number="localCatalogForm.servings_count" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
            </div>
            <div class="local-recipe-items">
              <div class="dialog-title-row compact-title"><b>Ingredients / foods / recipes</b><button class="text-button" type="button" @click="addLocalRecipeItem">{{ t('add') }}</button></div>
              <div v-for="(row, index) in localRecipeItems" :key="`local-recipe-row-${index}`" class="local-recipe-item-row">
                <select v-model="row.food_id" class="input">
                  <option value="">Select item</option>
                  <option v-for="item in localRecipeCatalogOptions" :key="item.id" :value="item.id">{{ localRecipeItemLabel(item.id) }}</option>
                </select>
                <input v-model.number="row.amount_g" class="input" type="number" min="0" step="0.1" inputmode="decimal" placeholder="g" />
                <button class="text-button danger" type="button" @click="removeLocalRecipeItem(index)">{{ t('delete') }}</button>
              </div>
            </div>
            <p class="helper">Mobile recipe edits are uploaded with the same ID, so the desktop inbox shows them as replacements.</p>
          </template>

          <template v-else>
            <label class="field-label">Code</label>
            <input v-model="localCatalogForm.code" class="input" placeholder="optional" />
            <label class="field-label">Description</label>
            <textarea v-model="localCatalogForm.description" class="input textarea-input" rows="2"></textarea>
            <div class="form-grid-two">
              <label class="field-label">Type<input v-model="localCatalogForm.activity_type" class="input" /></label>
              <label class="field-label">kcal / min<input v-model.number="localCatalogForm.kcal_per_min" class="input" type="number" min="0" step="0.1" inputmode="decimal" /></label>
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
      <section v-if="settingsOpen" class="settings-screen app-overlay">
      <header class="settings-header"><button class="back-button" @click="closeSettings" v-html="lucideSvg('chevronLeft')"></button><h2>{{ t('settings') }}</h2></header>
      <div class="settings-list">
        <button class="settings-row" @click="settingsDialog = 'units'"><span class="settings-row-icon" v-html="settingsIcon('units')"></span><b>{{ t('units') }}</b><small>{{ state.settings.units === 'metric' ? t('metric') : t('imperial') }}</small></button>
        <button class="settings-row" @click="settingsDialog = 'calculations'"><span class="settings-row-icon" v-html="settingsIcon('calculations')"></span><b>{{ t('calculations') }}</b><small>Institute of Medicine Equation (2005), macro distribution</small></button>
        <label class="settings-row switch-row"><span class="settings-row-icon" v-html="settingsIcon('activity')"></span><b>{{ t('showActivity') }}</b><input v-model="state.settings.show_activity_tracking" type="checkbox" /></label>
        <label class="settings-row switch-row"><span class="settings-row-icon" v-html="settingsIcon('macros')"></span><b>{{ t('showMacros') }}</b><input v-model="state.settings.show_meal_macros" type="checkbox" /></label>
        <label class="settings-row switch-row"><span class="settings-row-icon" v-html="settingsIcon('micros')"></span><b>{{ t('showMicros') }}</b><input v-model="state.settings.show_micronutrients" type="checkbox" /></label>
        <button class="settings-row" @click="settingsDialog = 'language'"><span class="settings-row-icon" v-html="settingsIcon('language')"></span><b>{{ t('language') }}</b><small>{{ state.settings.language === 'system' ? t('systemDefault') : state.settings.language === 'hu' ? t('hungarian') : t('english') }}</small></button>
        <label class="settings-row switch-row"><span class="settings-row-icon" v-html="settingsIcon('reminder')"></span><b>{{ t('dailyReminder') }}</b><input v-model="state.settings.daily_reminder" type="checkbox" /></label>
        <div class="settings-divider"></div>
        <button class="settings-row" @click="exportAppData"><span class="settings-row-icon" v-html="settingsIcon('export')"></span><b>{{ t('exportAppData') }}</b><small>{{ t('exportAppDataBody') }}</small></button>
        <button class="settings-row" @click="importAppData"><span class="settings-row-icon" v-html="settingsIcon('import')"></span><b>{{ t('importAppData') }}</b><small>{{ t('importAppDataBody') }}</small></button>
        <button class="settings-row" @click="openBackupProfiles"><span class="settings-row-icon" v-html="settingsIcon('backup')"></span><b>{{ t('backupProfiles') }}</b><small>{{ backupProfiles.length }} · {{ t('backupProfilesBody') }}</small></button>
        <button class="settings-row" @click="clearCachedItems"><span class="settings-row-icon" v-html="settingsIcon('refresh')"></span><b>{{ t('clearCache') }}</b><small>{{ state.ingredients.length + state.foods.length + state.recipes.length + state.activities.length }} item(s)</small></button>
        <button class="settings-row danger-row" @click="factoryResetMobile"><span class="settings-row-icon" v-html="settingsIcon('reset')"></span><b>{{ t('factoryReset') }}</b><small>{{ t('factoryResetBody') }}</small></button>
        <div class="settings-divider"></div>
        <a class="settings-row settings-link-row" :href="issueUrl" target="_blank" rel="noreferrer"><span class="settings-row-icon" v-html="settingsIcon('issue')"></span><b>{{ t('reportIssue') }}</b><small>{{ t('reportIssueBody') }}</small></a>
        <a class="settings-row settings-link-row" :href="repositoryUrl" target="_blank" rel="noreferrer"><span class="settings-row-icon" v-html="settingsIcon('repo')"></span><b>{{ t('openRepository') }}</b><small>{{ t('openRepositoryBody') }}</small></a>
        <a class="settings-row settings-link-row" :href="starUrl" target="_blank" rel="noreferrer"><span class="settings-row-icon" v-html="settingsIcon('star')"></span><b>{{ t('starProject') }}</b><small>{{ t('starProjectBody') }}</small></a>
        <button class="settings-row" @click="settingsDialog = 'privacy'"><span class="settings-row-icon" v-html="settingsIcon('privacy')"></span><b>{{ t('privacy') }}</b></button>
        <button class="settings-row" @click="settingsDialog = 'licenses'"><span class="settings-row-icon" v-html="settingsIcon('licenses')"></span><b>{{ t('licenses') }}</b></button>
        <button class="settings-row" @click="settingsDialog = 'about'"><span class="settings-row-icon" v-html="settingsIcon('about')"></span><b>{{ t('about') }}</b></button>
        <footer class="settings-brand"><div class="brand-logo" v-html="nutrinoLogoSvg"></div><strong>nutrino</strong><small>Version {{ appVersion }}</small></footer>
      </div>

      <div v-if="settingsDialog" class="dialog-backdrop" @click.self="settingsDialog = null">
        <article class="settings-dialog">
          <template v-if="settingsDialog === 'units'"><h2>{{ t('units') }}</h2><button class="dialog-option" @click="state.settings.units = 'metric'; settingsDialog = null">{{ t('metric') }}</button><button class="dialog-option" @click="state.settings.units = 'imperial'; settingsDialog = null">{{ t('imperial') }}</button></template>
          <template v-else-if="settingsDialog === 'language'"><h2>{{ t('language') }}</h2><button class="dialog-option" @click="state.settings.language = 'system'; settingsDialog = null">{{ t('systemDefault') }}</button><button class="dialog-option" @click="state.settings.language = 'en'; settingsDialog = null">{{ t('english') }}</button><button class="dialog-option" @click="state.settings.language = 'hu'; settingsDialog = null">{{ t('hungarian') }}</button></template>
          <template v-else-if="settingsDialog === 'calculations'">
            <div class="dialog-title-row"><h2>{{ t('calculations') }}</h2><button class="text-button" @click="resetCalculations">{{ t('reset') }}</button></div>
            <label class="field-label">TDEE equation</label><select v-model="state.settings.tdee_equation" class="input"><option value="iom_2005">Institute of Medicine Equation (2005)</option></select>
            <label class="field-label">Daily Kcal adjustment: {{ state.settings.kcal_adjustment }} kcal</label><input v-model.number="state.settings.kcal_adjustment" type="range" min="-1000" max="1000" step="25" class="tile-range" />
            <h3>Macronutrient Distribution</h3><p class="helper">{{ state.settings.macro_carbs_percent + state.settings.macro_protein_percent + state.settings.macro_fat_percent }}% total</p>
            <label class="field-label">carbs {{ state.settings.macro_carbs_percent }}%</label><input v-model.number="state.settings.macro_carbs_percent" type="range" min="0" max="100" step="5" class="tile-range carbs-range" />
            <label class="field-label">protein {{ state.settings.macro_protein_percent }}%</label><input v-model.number="state.settings.macro_protein_percent" type="range" min="0" max="100" step="5" class="tile-range protein-range" />
            <label class="field-label">fat {{ state.settings.macro_fat_percent }}%</label><input v-model.number="state.settings.macro_fat_percent" type="range" min="0" max="100" step="5" class="tile-range fat-range" />
            <div class="dialog-actions"><button class="text-button" @click="settingsDialog = null">{{ t('cancel') }}</button><button class="text-button" @click="settingsDialog = null">{{ t('ok') }}</button></div>
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
          <template v-else><h2>{{ t('about') }}</h2><div class="about-logo" v-html="nutrinoLogoSvg"></div><h3>{{ appName }}</h3><p class="helper">Version {{ appVersion }} · {{ appChannel }} · AGPL-3.0-only</p><p class="helper big">Offline-first nutrition diary for your own desktop-hosted food database.</p><p class="helper big">Thank you to OpenNutriTracker for the privacy-first open-source nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.</p><div class="about-links"><a :href="repositoryUrl" target="_blank" rel="noreferrer">{{ t('sourceCode') }}</a><a :href="issueUrl" target="_blank" rel="noreferrer">{{ t('reportIssue') }}</a><a :href="starUrl" target="_blank" rel="noreferrer">{{ t('starProject') }}</a></div><button class="filled-button wide" @click="settingsDialog = null">{{ t('ok') }}</button></template>
        </article>
      </div>
      </section>
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
          <label><span>Birthday</span><input v-model="onboardingProfile.birthday" class="input" type="date" /></label>
          <label><span>{{ t('gender') }}</span><select v-model="onboardingProfile.gender" class="input"><option value="male">{{ t('male') }}</option><option value="female">{{ t('female') }}</option><option value="non_binary">{{ t('nonBinary') }}</option></select></label>
          <label><span>{{ t('activityLevel') }}</span><select v-model="onboardingProfile.activity_level" class="input"><option value="sedentary">Sedentary</option><option value="low_active">Low active</option><option value="active">Active</option><option value="very_active">Very active</option></select></label>
          <label><span>{{ t('weeklyGoal') }}: {{ onboardingProfile.weekly_goal_kg }} {{ t('perWeek') }}</span><input v-model.number="onboardingProfile.weekly_goal_kg" class="tile-range" type="range" min="-1" max="1" step="0.25" /></label>
        </div>
        <div v-else class="onboarding-tour">
          <h3>{{ t('onboardingTour') }}</h3>
          <p class="helper big">{{ t('onboardingTourBody') }}</p>
          <div class="tour-pills"><span>Home</span><span>Diary</span><span>Recipes</span><span>Profile</span></div>
        </div>
        <div class="dialog-actions onboarding-actions"><button v-if="onboardingStep === 0" class="text-button" @click="importAppData">{{ t('restoreBackup') }}</button><button v-if="onboardingStep === 0 && backupProfiles.length" class="text-button" @click="openBackupProfiles">{{ t('restoreBackupProfile') }}</button><button v-if="onboardingStep > 0" class="text-button" @click="onboardingStep--">{{ t('back') }}</button><button v-if="onboardingStep === 0" class="filled-button" @click="onboardingStep++">{{ t('next') }}</button><button v-else class="filled-button" @click="finishOnboarding">{{ t('startUsingNutrino') }}</button></div>
      </article>
      </section>
    </Teleport>

    <Teleport to="body">
      <div v-if="scanDialogOpen" class="dialog-backdrop app-overlay" @click.self="closeScanner">
        <article class="settings-dialog scanner-dialog">
          <div class="dialog-title-row"><h2>{{ scanDialogMode === 'barcode' ? 'Scan barcode / QR' : 'Scan Nutrino QR' }}</h2><button class="text-button" @click="closeScanner">{{ t('cancel') }}</button></div>
          <video ref="scanVideo" class="scanner-video" playsinline muted></video>
          <p class="helper big">If camera scanning is not available on this device, paste or type the code below.</p>
          <input v-model="scanInput" class="input" placeholder="barcode, QR payload or Nutrino code" autocomplete="off" autocapitalize="none" />
          <button class="filled-button wide" @click="applyScannedValue()">Use code</button>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <p v-if="toast" class="toast">{{ toast }}</p>
    </Teleport>

    <nav class="bottom-nav">
      <button v-for="item in navItems" :key="item.key" :class="activeTab === item.key ? 'active' : ''" @click="setTab(item.key)">
        <span class="nav-svg" v-html="activeTab === item.key ? item.activeIcon : item.icon"></span>
        <span>{{ t(item.key) }}</span>
      </button>
    </nav>
  </main>
</template>
