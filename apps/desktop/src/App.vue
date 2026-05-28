<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { lucideSvg, type IconName } from './icons';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import * as QRCode from 'qrcode';
import { commands } from './lib/commands';
import { checkNutrinoUpdates, type UpdateCheckResult } from './lib/releases';
import type { ActivityDefinition, ActivityInput, CatalogDuplicateSuggestion, ConnectedDevice, DesktopSettings, Food, FoodInput, Ingredient, IngredientInput, LocalizedNameMap, Recipe, RecipeDetail, RecipeInput, RecipeInputItem, ServerStatus, SkippedSyncItem, SyncInboxEntry, SyncPushPayload } from './types';

type Tab = 'dashboard' | 'ingredients' | 'foods' | 'recipes' | 'activities' | 'server' | 'settings';
type CatalogKind = 'ingredient' | 'food' | 'recipe' | 'activity';
type RecipeCatalogItem = Food & { catalog_source: 'ingredient' | 'food' | 'recipe' };
type ModalKind = CatalogKind | null;

type OptionalNutrientDefinition = {
  key: string;
  labelKey: string;
  unit: 'g' | 'mg' | 'mcg';
  field?: 'sugars_per_100g' | 'fiber_per_100g' | 'salt_per_100g';
};

const optionalNutrientDefinitions: OptionalNutrientDefinition[] = [
  { key: 'sugars_per_100g', field: 'sugars_per_100g', labelKey: 'ui.sugars' , unit: 'g' },
  { key: 'fiber_per_100g', field: 'fiber_per_100g', labelKey: 'ui.fiber', unit: 'g' },
  { key: 'salt_per_100g', field: 'salt_per_100g', labelKey: 'ui.salt_99834', unit: 'g' },
  { key: 'saturated_fat_per_100g', labelKey: 'ui.saturatedFat', unit: 'g' },
  { key: 'sodium_mg_per_100g', labelKey: 'ui.sodium', unit: 'mg' },
  { key: 'calcium_mg_per_100g', labelKey: 'ui.calcium', unit: 'mg' },
  { key: 'iron_mg_per_100g', labelKey: 'ui.iron', unit: 'mg' },
  { key: 'potassium_mg_per_100g', labelKey: 'ui.potassium', unit: 'mg' },
  { key: 'vitamin_d_mcg_per_100g', labelKey: 'ui.vitaminD', unit: 'mcg' },
  { key: 'vitamin_b12_mcg_per_100g', labelKey: 'ui.vitaminB12', unit: 'mcg' },
  { key: 'magnesium_mg_per_100g', labelKey: 'ui.magnesium', unit: 'mg' },
];


const tab = ref<Tab>('dashboard');
const modal = ref<ModalKind>(null);
const status = ref<ServerStatus | null>(null);
const connectedDevices = ref<ConnectedDevice[]>([]);
const ingredients = ref<Ingredient[]>([]);
const foods = ref<Food[]>([]);
const recipes = ref<RecipeDetail[]>([]);
const activities = ref<ActivityDefinition[]>([]);
const syncInbox = ref<SyncInboxEntry[]>([]);
const duplicateSuggestions = ref<CatalogDuplicateSuggestion[]>([]);
const duplicateCanonicalSelections = ref<Record<string, string>>({});
const mergePicker = ref<{ kind: CatalogKind; aliasId: string; aliasName: string; query: string; selectedId: string } | null>(null);
type QrDialogPart = { index: number; total: number; svg: string; payload: string };
const qrDialog = ref<{ title: string; parts: QrDialogPart[]; activeIndex: number; payload: string } | null>(null);
const skipCsvDuplicates = ref(true);
const hideUnchangedInboxItems = ref(true);
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
const appChannel = import.meta.env.DEV ? 'dev' : String(import.meta.env.VITE_NUTRINO_CHANNEL || 'stable');
const appVersion = appChannel === 'dev' ? __NUTRINO_DEV_VERSION__ : __NUTRINO_RELEASE_VERSION__;
const appName = appChannel === 'dev' ? 'Nutrino Dev' : 'Nutrino';
document.title = appName;
const updateBusy = ref(false);
const updateDialogOpen = ref(false);
const updateCheckResult = ref<UpdateCheckResult | null>(null);
const updateAvailable = computed(() => updateCheckResult.value?.status === 'available' && Boolean(updateCheckResult.value.release));
const updateRemindLaterKey = `nutrino.desktop.${appChannel}.update.remindLater.v1`;
let updateCheckUnlisten: UnlistenFn | null = null;

type AppLanguage = 'system' | 'en' | 'hu' | 'de' | 'fr' | 'ru' | 'uk' | 'zh' | 'sk' | 'ro' | 'cs' | 'sl' | 'hr' | 'pl' | 'es' | 'pt';
type LanguageOption = { code: AppLanguage; englishName: string; nativeName: string; locale: string; aliases: string[] };

const desktopLanguageKey = 'nutrino.desktop.language.v1';
const languageOptions: LanguageOption[] = [
  { code: 'system', englishName: 'System default', nativeName: 'System default', locale: 'en', aliases: ['auto', 'system'] },
  { code: 'en', englishName: 'English', nativeName: 'English', locale: 'en-US', aliases: ['en', 'eng'] },
  { code: 'hu', englishName: 'Hungarian', nativeName: 'Magyar', locale: 'hu-HU', aliases: ['hu', 'hun', 'magyar'] },
  { code: 'de', englishName: 'German', nativeName: 'Deutsch', locale: 'de-DE', aliases: ['de', 'ger', 'deu'] },
  { code: 'fr', englishName: 'French', nativeName: 'Français', locale: 'fr-FR', aliases: ['fr', 'fra'] },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский', locale: 'ru-RU', aliases: ['ru', 'rus'] },
  { code: 'uk', englishName: 'Ukrainian', nativeName: 'Українська', locale: 'uk-UA', aliases: ['uk', 'ua', 'ukr'] },
  { code: 'zh', englishName: 'Chinese', nativeName: '中文', locale: 'zh-CN', aliases: ['zh', 'cn', 'chi', 'zho'] },
  { code: 'sk', englishName: 'Slovak', nativeName: 'Slovenčina', locale: 'sk-SK', aliases: ['sk', 'slo'] },
  { code: 'ro', englishName: 'Romanian', nativeName: 'Română', locale: 'ro-RO', aliases: ['ro', 'rum', 'ron'] },
  { code: 'cs', englishName: 'Czech', nativeName: 'Čeština', locale: 'cs-CZ', aliases: ['cs', 'cz', 'ces'] },
  { code: 'sl', englishName: 'Slovenian', nativeName: 'Slovenščina', locale: 'sl-SI', aliases: ['sl', 'slv'] },
  { code: 'hr', englishName: 'Croatian', nativeName: 'Hrvatski', locale: 'hr-HR', aliases: ['hr', 'hrv'] },
  { code: 'pl', englishName: 'Polish', nativeName: 'Polski', locale: 'pl-PL', aliases: ['pl', 'pol'] },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', locale: 'es-ES', aliases: ['es', 'spa'] },
  { code: 'pt', englishName: 'Portuguese', nativeName: 'Português', locale: 'pt-PT', aliases: ['pt', 'por'] },
];

const supportedLanguageCodes = languageOptions.filter((language) => language.code !== 'system').map((language) => language.code);
const normalizeTranslationValues = (values: Partial<Record<string, string>>): Record<string, string> => Object.fromEntries(
  Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
const desktopLanguage = ref<AppLanguage>((localStorage.getItem(desktopLanguageKey) as AppLanguage | null) || 'system');
const languageSearch = ref('');

const translations: Record<string, Record<string, string>> = {
  en: { 'nav.dashboard': 'Dashboard', 'nav.ingredients': 'Ingredients', 'nav.foods': 'Foods', 'nav.recipes': 'Recipes', 'nav.activities': 'Activities', 'nav.server': 'Server', 'nav.settings': 'Settings', language: 'Language', languageSearch: 'Search language by English name, native name or code…', translations: 'Translations', addTranslation: 'Add translation', translationHint: 'Keep the base name required. Add optional localized names only when needed.', noTranslation: 'No translations added yet.', selectLanguage: 'Select language', nameInLanguage: 'Localized name', remove: 'Remove' },
  hu: {
    "ui.mergeDialogPrefix": "Összevonás:",
    "ui.mergeDialogMiddle": "egy meglévő célba:",
    "ui.mergeDialogSuffix": "Kereshetsz név vagy ID alapján; nem kell fejből tudni a cél ID-t.", 'nav.dashboard': 'Áttekintés', 'nav.ingredients': 'Alapanyagok', 'nav.foods': 'Ételek', 'nav.recipes': 'Receptek', 'nav.activities': 'Aktivitások', 'nav.server': 'Szerver', 'nav.settings': 'Beállítások', language: 'Nyelv', languageSearch: 'Keress angol névvel, saját névvel vagy kóddal…', translations: 'Fordítások', addTranslation: 'Fordítás hozzáadása', translationHint: 'Az alap név kötelező. Lokalizált nevet csak extra mezőként adj hozzá.', noTranslation: 'Még nincs fordítás.', selectLanguage: 'Nyelv kiválasztása', nameInLanguage: 'Lokalizált név', remove: 'Törlés' },
};
for (const language of supportedLanguageCodes) {
  if (!translations[language]) translations[language] = { ...translations.en };
}

const desktopSupplementalTranslations: Record<string, Record<string, string>> = {
  en: {
    "ui.mergeDialogPrefix": "Merge",
    "ui.mergeDialogMiddle": "into an existing",
    "ui.mergeDialogSuffix": "You can search by name or ID; no need to remember the target ID.",
    "ui.status_24a23": "Status:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Server",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Ingredients",
    "ui.avg100g_5f553": "Avg / 100g",
    "ui.updated_ff0a3": "Updated",
    "ui.foods_9428a": "Foods",
    "ui.recipes_0153a": "Recipes",
    "ui.activities_d78ed": "Activities",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first local architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the ingredient, food, recipe and activity catalogs plus the LAN API. Mobile syncs the catalog, then keeps working from its local cache whenever the desktop server is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base items without brand or barcode, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Refresh",
    "ui.importCsv_28ec2": "Import CSV",
    "ui.skipDuplicates_6d417": "Skip duplicates",
    "ui.exportCsv_c04f1": "Export CSV",
    "ui.addIngredient_590a4": "Add ingredient",
    "ui.sortByName_deb7e": "Sort by name",
    "ui.sortByKcal_a0e33": "Sort by kcal",
    "ui.sortByProtein_30969": "Sort by protein",
    "ui.sortByCarbs_8895f": "Sort by carbs",
    "ui.sortByFat_e8cb8": "Sort by fat",
    "ui.ingredientCsvStructure_bbae0": "Ingredient CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Ingredients are non-branded base materials. They do not have barcode or brand columns.",
    "ui.name_49ee3": "Name",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Carbs",
    "ui.fat_4d09c": "Fat",
    "ui.protein_7e667": "Protein",
    "ui.actions_06df3": "Actions",
    "ui.ingredientNoBrandBarcode_b87ef": "Ingredient · no brand/barcode",
    "ui.edit_7dce1": "Edit",
    "ui.mergeInto_f7c29": "Merge into",
    "ui.moveToFoods_e1a6b": "Move to foods",
    "ui.delete_f2a6c": "Delete",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, import and export concrete branded or source-specific foods.",
    "ui.addFood_2e2e1": "Add food",
    "ui.foodCsvStructure_f4bb5": "Food CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample foods are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to ingredients",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from foods. Nutrition is calculated from ingredients.",
    "ui.addRecipe_39767": "Add recipe",
    "ui.recipeCsvStructure_a4db3": "Recipe CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Recipes are imported from a header-only schema plus your own rows. Ingredients stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "weight",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker activity catalog with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Add activity",
    "ui.activityCsvStructure_c2cbe": "Activity CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for activity imports. kcal/min is optional when MET is available.",
    "ui.lanApiServer_2738b": "LAN API server",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an optional server password. If it is empty, mobile can sync on your LAN without auth; if set, mobile must use the same password.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Server password",
    "ui.start_a6122": "Start",
    "ui.stop_11a75": "Stop",
    "ui.savePassword_49284": "Save password",
    "ui.restoreBackup_dd06b": "Restore backup",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Connected devices",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The mobile app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Start the LAN API server to see connected mobile devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No mobile device has contacted the server recently.",
    "ui.mergeSuggestions_3f578": "Merge suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate foods, recipes and activities before any sync is involved. Choose which item should stay, then merge the rest into it, or open an item and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Merge all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate catalog items found.",
    "ui.mergeSelected_1f978": "Merge selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobile are staged here first. Accept a batch to record it on the server. Matching IDs are highlighted as replacements, not duplicates, so mobile edits update the server item instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide items already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload items.",
    "ui.noPendingMobileUploads_7e5ca": "No pending mobile uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Reject",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop items are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Skip",
    "ui.restore_2bd33": "Restore",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop server",
    "ui.settings_f4f70": "Settings",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Save current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export data ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop catalog and settings backup.",
    "ui.importDataZip_04e73": "Import data ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Restore ingredients, foods, recipes, activities and desktop settings.",
    "ui.factoryReset_5dcd7": "Factory reset",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Delete the local desktop catalog and start setup again.",
    "ui.licenses_f6aca": "Licenses",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Privacy",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your ingredient, food, recipe and activity catalog locally on this machine. The LAN API is used only by your paired mobile app on your own network. No analytics, no public food search, no account.",
    "ui.about_8f7f4": "About",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing mobile.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Restore server from backup ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create ingredients and foods",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private ingredient and food catalogs.",
    "ui.buildRecipes_f4672": "Build recipes",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine foods into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Edit activity catalog",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Start the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair mobile when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls ingredients, foods, recipes and activities from this server. Diary data stays on the phone. You can change startup, tray and backup settings later from Settings.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public food database, no account, no analytics.",
    "ui.back_0557f": "Back",
    "ui.next_10ac3": "Next",
    "ui.startUsingNutrino_b763a": "Start using nutrino",
    "ui.catalogQr_0d8f3": "catalog QR",
    "ui.scanThisWithTheMobileApp_231a6": "Scan this with the mobile app to review, edit and save the item locally. Large recipes are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the recipe was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Done",
    "ui.mergeCatalogItem_db2c1": "merge catalog item",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the item to keep",
    "ui.merge_68be4": "Merge",
    "ui.close_d3d2e": "Close",
    "ui.noMatchingTargetItem_6e9d3": "No matching target item.",
    "ui.cancel_ea478": "Cancel",
    "ui.mergeIntoSelected_1a212": "Merge into selected",
    "ui.mobileUploadInbox_5ea98": "mobile upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No ingredients in this upload.",
    "ui.ingredient_59198": "Ingredient",
    "ui.noFoodsInThisUpload_d06f6": "No foods in this upload.",
    "ui.food_0a38e": "Food",
    "ui.noRecipesInThisUpload_f370c": "No recipes in this upload.",
    "ui.recipe_aef6e": "Recipe",
    "ui.noActivitiesInThisUpload_ded76": "No activities in this upload.",
    "ui.activity_ecfc2": "Activity",
    "ui.privateMobileDiaryData_f455b": "Private mobile diary data",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, activity logs and weight logs are not imported to desktop. They stay local on mobile.",
    "ui.skippedItems_66bcb": "Skipped items",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Save draft",
    "ui.note_3b064": "Note",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100g",
    "ui.carbs100g_77af9": "Carbs / 100g",
    "ui.fat100g_6709a": "Fat / 100g",
    "ui.protein100g_bf529": "Protein / 100g",
    "ui.sugars100g_7ebdd": "Sugars / 100g",
    "ui.fiber100g_31731": "Fiber / 100g",
    "ui.salt100g_1473d": "Salt / 100g",
    "ui.brandSourceLabel_07afa": "Brand / source label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Description",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the ingredient kcal total. Macros stay calculated from ingredients.",
    "ui.servings_4349e": "Servings",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total recipe grams / servings.",
    "ui.noMatchingItem_12f96": "No matching item.",
    "ui.remove_1063e": "Remove",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Code",
    "ui.type_a1fa2": "Type",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Search ingredients by name, note or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Search foods by name, brand, barcode, note or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Search recipes by name, description, note or ID...",
    "ui.searchActivityTypeCode_9bb39": "Search activity, type, code...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no password",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Optional; leave empty for no password",
    "ui.searchByNameIdBrandCode_0c5a3": "Search by name, ID, brand, code...",
    "ui.ingredientName_cbdf8": "Ingredient name",
    "ui.unit_19c56": "Unit",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Food name",
    "ui.brand_1be6f": "Brand",
    "ui.recipeName_23955": "Recipe name",
    "ui.servingsOptional_9fcb2": "Servings (optional)",
    "ui.activityName_75c4c": "Activity name",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Optional note, source or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Brand, restaurant, shop or source",
    "ui.optional_ebb06": "Optional",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Optional note, source, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Optional; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Optional; empty means the whole recipe is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Search food, ingredient or recipe...",
    "ui.grams_ca820": "grams",
    "ui.pieces_6b7e9": "pieces",
    "ui.running_75101": "running",
    "ui.general_95815": "general",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps",
  },
  hu: {
    "ui.mergeDialogPrefix": "Összevonás:",
    "ui.mergeDialogMiddle": "egy meglévő célba:",
    "ui.mergeDialogSuffix": "Kereshetsz név vagy ID alapján; nem kell fejből tudni a cél ID-t.",
    "ui.status_24a23": "Állapot:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino desktop szerver",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Alapanyagok",
    "ui.avg100g_5f553": "Átlag / 100g",
    "ui.updated_ff0a3": "Frissítve",
    "ui.foods_9428a": "Ételek",
    "ui.recipes_0153a": "Receptek",
    "ui.activities_d78ed": "Aktivitások",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first helyi architektúra",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "Ez a desktop app kezeli az alapanyag-, étel-, recept- és aktivitáskatalógust, valamint a LAN API-t. A mobil szinkronizálja a katalógust, majd a helyi cache-ből működik tovább, ha a desktop szerver nem elérhető.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Márka és vonalkód nélküli általános alapanyagok, például cukor, gyümölcs, zöldség vagy burgonya.",
    "ui.refresh_63a6a": "Frissítés",
    "ui.importCsv_28ec2": "CSV import",
    "ui.skipDuplicates_6d417": "Duplikátumok kihagyása",
    "ui.exportCsv_c04f1": "CSV export",
    "ui.addIngredient_590a4": "Alapanyag hozzáadása",
    "ui.sortByName_deb7e": "Rendezés név szerint",
    "ui.sortByKcal_a0e33": "Rendezés kcal szerint",
    "ui.sortByProtein_30969": "Rendezés fehérje szerint",
    "ui.sortByCarbs_8895f": "Rendezés szénhidrát szerint",
    "ui.sortByFat_e8cb8": "Rendezés zsír szerint",
    "ui.ingredientCsvStructure_bbae0": "Alapanyag CSV struktúra",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Az alapanyagok márka nélküli nyers/alap tételek. Nincs vonalkód vagy márka oszlopuk.",
    "ui.name_49ee3": "Név",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Szénhidrát",
    "ui.fat_4d09c": "Zsír",
    "ui.protein_7e667": "Fehérje",
    "ui.actions_06df3": "Műveletek",
    "ui.ingredientNoBrandBarcode_b87ef": "Alapanyag · nincs márka/vonalkód",
    "ui.edit_7dce1": "Szerkesztés",
    "ui.mergeInto_f7c29": "Összevonás ide",
    "ui.moveToFoods_e1a6b": "Áthelyezés ételekhez",
    "ui.delete_f2a6c": "Törlés",
    "ui.createEditDeleteImportAndExport_14d0a": "Konkrét márkás vagy forrás-specifikus ételek létrehozása, szerkesztése, törlése, importja és exportja.",
    "ui.addFood_2e2e1": "Étel hozzáadása",
    "ui.foodCsvStructure_f4bb5": "Étel CSV struktúra",
    "ui.importFilesMustUseThisHeader_fb913": "Az importfájloknak ezt a fejlécsort kell használniuk. Kezdő/minta ételek szándékosan nincsenek az appba csomagolva.",
    "ui.moveToIngredients_39253": "Áthelyezés alapanyagokhoz",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Újrahasználható ételek összeállítása ételekből. A tápérték a hozzávalókból számolódik.",
    "ui.addRecipe_39767": "Recept hozzáadása",
    "ui.recipeCsvStructure_a4db3": "Recept CSV struktúra",
    "ui.recipesAreImportedFromAHeader_3c31f": "A receptek fejlécsémából és saját sorokból importálhatók. A hozzávalók tárolása grammban történik.",
    "ui.kcalTotal_0c895": "kcal összesen",
    "ui.carbsTotal_d2ae4": "szénhidrát összesen",
    "ui.fatTotal_41615": "zsír összesen",
    "ui.proteinTotal_67f44": "fehérje összesen",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "súly",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker aktivitáskatalógus szerkeszthető MET és kcal/perc értékekkel.",
    "ui.addActivity_a263a": "Aktivitás hozzáadása",
    "ui.activityCsvStructure_c2cbe": "Aktivitás CSV struktúra",
    "ui.useThisHeaderRowForActivity_4eb62": "Aktivitás importhoz ezt a fejlécsort használd. A kcal/perc opcionális, ha MET rendelkezésre áll.",
    "ui.lanApiServer_2738b": "LAN API szerver",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Opcionális szerverjelszó beállítása. Ha üres, a mobil hitelesítés nélkül szinkronizálhat a LAN-on; ha meg van adva, a mobilnak ugyanazt a jelszót kell használnia.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Szerverjelszó",
    "ui.start_a6122": "Indítás",
    "ui.stop_11a75": "Leállítás",
    "ui.savePassword_49284": "Jelszó mentése",
    "ui.restoreBackup_dd06b": "Mentés visszaállítása",
    "ui.pairingDetails_d8479": "Párosítási adatok",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Forrás ID",
    "ui.auth_632c9": "Hitelesítés",
    "ui.channel_781dc": "Csatorna",
    "ui.connectedDevices_1aee3": "Csatlakozott eszközök",
    "ui.devicesSeenByTheLanApi_7cc05": "A LAN API által az elmúlt 5 percben látott eszközök. A mobil app olvasható Android eszközazonosítót küld a nyers Linux/WebView user agent helyett.",
    "ui.startTheLanApiServerTo_231bf": "Indítsd el a LAN API szervert a csatlakozott mobil eszközök megjelenítéséhez.",
    "ui.noMobileDeviceHasContactedThe_a557c": "Nem jelentkezett be mobil eszköz mostanában.",
    "ui.mergeSuggestions_3f578": "Összevonási javaslatok",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate foods, recipes and activities before any sync is involved. Choose which item should stay, then merge the rest into it, or open an item and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Összes kijelölt összevonása",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "Nem található valószínű duplikált katalógustétel.",
    "ui.mergeSelected_1f978": "Kijelöltek összevonása",
    "ui.mobileUploadInbox_3476a": "Mobil feltöltési inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobile are staged here first. Accept a batch to record it on the server. Matching IDs are highlighted as replacements, not duplicates, so mobile edits update the server item instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Desktopon már meglévők elrejtése",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Az alap nézet csak az új, módosított és kihagyott feltöltési tételeket mutatja.",
    "ui.noPendingMobileUploads_7e5ca": "Nincs függő mobil feltöltés.",
    "ui.reviewEdit_77e3a": "Átnézés/szerkesztés",
    "ui.recordDraft_685b4": "Vázlat rögzítése",
    "ui.reject_d98ac": "Elutasítás",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop items are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Kihagyás",
    "ui.restore_2bd33": "Visszaállítás",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Pontos duplikátum összevonási javaslatok",
    "ui.desktopServer_ee8af": "desktop szerver",
    "ui.settings_f4f70": "Beállítások",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Futásidő, tray, indítás, mentések, adatvédelem és projektlinkek.",
    "ui.dataAndRecovery_677d1": "Adatok és visszaállítás",
    "ui.backupsRestoreAndReset_6433e": "Mentések, visszaállítás és reset.",
    "ui.saveCurrentWindow_1b2b6": "Jelenlegi ablak mentése",
    "ui.storeTheCurrentPositionAndSize_161c9": "Az aktuális pozíció és méret azonnali mentése.",
    "ui.exportDataZip_d39bb": "Adatok exportálása ZIP-be",
    "ui.createADesktopCatalogAndSettings_5ec25": "Desktop katalógus és beállításmentés készítése.",
    "ui.importDataZip_04e73": "Adatok importálása ZIP-ből",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Alapanyagok, ételek, receptek, aktivitások és desktop beállítások visszaállítása.",
    "ui.factoryReset_5dcd7": "Gyári visszaállítás",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Helyi desktop katalógus törlése és beállítás újrakezdése.",
    "ui.licenses_f6aca": "Licencek",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Külső licencek és köszönetnyilvánítások.",
    "ui.privacy_c5f29": "Adatvédelem",
    "ui.localFirstByDesign_50f82": "Local-first tervezés",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your ingredient, food, recipe and activity catalog locally on this machine. The LAN API is used only by your paired mobile app on your own network. No analytics, no public food search, no account.",
    "ui.about_8f7f4": "Névjegy",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Hiba jelentése",
    "ui.star_26f93": "Csillag",
    "ui.desktopSetup_8dda1": "Desktop beállítás",
    "ui.setTheDefaultLanApiPort_c998b": "Állítsd be az alap LAN API portot, és nézd át a nutrino Desktop működését mobil párosítás előtt.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Szerver visszaállítása ZIP mentésből",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Alapanyagok és ételek importja vagy létrehozása",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Építsd fel a privát alapanyag- és ételkatalógusodat.",
    "ui.buildRecipes_f4672": "Receptek építése",
    "ui.combineFoodsIntoReusableMeals_a2483": "Ételek kombinálása újrahasználható receptekké.",
    "ui.editActivityCatalog_5a8f3": "Aktivitáskatalógus szerkesztése",
    "ui.reviewMetAndKcalMinValues_c297b": "MET és kcal/perc értékek átnézése.",
    "ui.startTheLanApi_61b1e": "LAN API indítása",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Párosítsd a mobilt, amikor készen állsz.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls ingredients, foods, recipes and activities from this server. Diary data stays on the phone. You can change startup, tray and backup settings later from Settings.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "Nincs nyilvános ételadatbázis, nincs fiók, nincs analitika.",
    "ui.back_0557f": "Vissza",
    "ui.next_10ac3": "Tovább",
    "ui.startUsingNutrino_b763a": "nutrino indítása",
    "ui.catalogQr_0d8f3": "katalógus QR",
    "ui.scanThisWithTheMobileApp_231a6": "Scan this with the mobile app to review, edit and save the item locally. Large recipes are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the recipe was imported.",
    "ui.previous_dd1f7": "Előző",
    "ui.done_f9296": "Kész",
    "ui.mergeCatalogItem_db2c1": "katalógustétel összevonása",
    "ui.chooseTheItemToKeep_9e3c5": "Válaszd ki, melyik tétel maradjon",
    "ui.merge_68be4": "Összevonás",
    "ui.close_d3d2e": "Bezárás",
    "ui.noMatchingTargetItem_6e9d3": "Nincs megfelelő céltétel.",
    "ui.cancel_ea478": "Mégse",
    "ui.mergeIntoSelected_1a212": "Összevonás a kijelölttel",
    "ui.mobileUploadInbox_5ea98": "mobil feltöltési inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Átnézés és szerkesztés rögzítés előtt",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Azonos ID-jú cserék ebből a feltöltésből",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Pontos duplikátum javaslatok ebből a feltöltésből",
    "ui.noIngredientsInThisUpload_dfd36": "Nincs alapanyag ebben a feltöltésben.",
    "ui.ingredient_59198": "Alapanyag",
    "ui.noFoodsInThisUpload_d06f6": "Nincs étel ebben a feltöltésben.",
    "ui.food_0a38e": "Étel",
    "ui.noRecipesInThisUpload_f370c": "Nincs recept ebben a feltöltésben.",
    "ui.recipe_aef6e": "Recept",
    "ui.noActivitiesInThisUpload_ded76": "Nincs aktivitás ebben a feltöltésben.",
    "ui.activity_ecfc2": "Aktivitás",
    "ui.privateMobileDiaryData_f455b": "Privát mobil naplóadatok",
    "ui.keptOnPhoneOnly_f22ee": "Csak telefonon marad",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Az étkezési jegyzetek, aktivitásnaplók és súlynaplók nem importálódnak desktopra. Mobilon helyben maradnak.",
    "ui.skippedItems_66bcb": "Kihagyott tételek",
    "ui.skipped_d9c8f": "Kihagyva",
    "ui.advancedJsonEditor_19192": "Haladó JSON szerkesztő",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Csak akkor használd, ha a vizuális szerkesztő nem ad hozzáférést egy szükséges mezőhöz.",
    "ui.saveDraft_48ca5": "Vázlat mentése",
    "ui.note_3b064": "Megjegyzés",
    "ui.defaultUnit_81471": "Alap mértékegység",
    "ui.servingSizeG_8fd02": "Adagméret g",
    "ui.kcal100g_bb877": "kcal / 100g",
    "ui.carbs100g_77af9": "Szénhidrát / 100g",
    "ui.fat100g_6709a": "Zsír / 100g",
    "ui.protein100g_bf529": "Fehérje / 100g",
    "ui.sugars100g_7ebdd": "Cukrok / 100g",
    "ui.fiber100g_31731": "Rost / 100g",
    "ui.salt100g_1473d": "Só / 100g",
    "ui.brandSourceLabel_07afa": "Márka / forrás címke",
    "ui.barcodeEanUpc_1335e": "Vonalkód / EAN / UPC",
    "ui.description_b5a7a": "Leírás",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Hozzáadódik a hozzávalók kcal összegéhez, vagy levonódik belőle. A makrók továbbra is a hozzávalókból számolódnak.",
    "ui.servings_4349e": "Adagok",
    "ui.whenSet1DbEqualsTotal_3140a": "Ha meg van adva, 1 db = recept teljes grammja / adagok.",
    "ui.noMatchingItem_12f96": "Nincs találat.",
    "ui.remove_1063e": "Eltávolítás",
    "ui.carbs100g_ed4c3": "szénhidrát/100g",
    "ui.fat100g_a84e1": "zsír/100g",
    "ui.protein100g_cdbf5": "fehérje/100g",
    "ui.code_ca0db": "Kód",
    "ui.type_a1fa2": "Típus",
    "ui.kcalMin_22677": "kcal / perc",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Alapanyag keresése név, megjegyzés vagy ID alapján...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Étel keresése név, márka, vonalkód, megjegyzés vagy ID alapján...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Recept keresése név, leírás, megjegyzés vagy ID alapján...",
    "ui.searchActivityTypeCode_9bb39": "Aktivitás, típus vagy kód keresése...",
    "ui.leaveEmptyForNoPassword_c6e10": "Hagyd üresen, ha nincs jelszó",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Opcionális; hagyd üresen, ha nincs jelszó",
    "ui.searchByNameIdBrandCode_0c5a3": "Keresés név, ID, márka vagy kód alapján...",
    "ui.ingredientName_cbdf8": "Alapanyag neve",
    "ui.unit_19c56": "Mértékegység",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Étel neve",
    "ui.brand_1be6f": "Márka",
    "ui.recipeName_23955": "Recept neve",
    "ui.servingsOptional_9fcb2": "Adagok (opcionális)",
    "ui.activityName_75c4c": "Aktivitás neve",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Opcionális megjegyzés, forrás vagy mérési segítség",
    "ui.brandRestaurantShopOrSource_21f1e": "Márka, étterem, bolt vagy forrás",
    "ui.optional_ebb06": "Opcionális",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Opcionális megjegyzés, forrás, adag vagy elkészítési részlet",
    "ui.optionalNegativeIsAllowed_cb1cb": "Opcionális; negatív érték megengedett",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Opcionális; üresen a teljes recept 1 adag",
    "ui.searchFoodIngredientOrRecipe_1f688": "Étel, alapanyag vagy recept keresése...",
    "ui.grams_ca820": "gramm",
    "ui.pieces_6b7e9": "db",
    "ui.running_75101": "futás",
    "ui.general_95815": "általános",
    "ui.desktopSetupSteps_ae24e": "Desktop beállítás lépései",
  },
};
for (const language of supportedLanguageCodes) {
  translations[language] = { ...translations[language], ...desktopSupplementalTranslations.en, ...(desktopSupplementalTranslations[language] || {}) };
}

const desktopCoreLanguageTranslations: Record<string, Partial<Record<string, string>>> = {
  de: { 'nav.dashboard': 'Übersicht', 'nav.ingredients': 'Zutaten', 'nav.foods': 'Lebensmittel', 'nav.recipes': 'Rezepte', 'nav.activities': 'Aktivitäten', 'nav.server': 'Server', 'nav.settings': 'Einstellungen', language: 'Sprache', languageSearch: 'Sprache nach englischem Namen, Eigenname oder Code suchen…', translations: 'Übersetzungen', addTranslation: 'Übersetzung hinzufügen', translationHint: 'Der Basisname bleibt erforderlich. Lokalisierte Namen nur bei Bedarf hinzufügen.', noTranslation: 'Noch keine Übersetzungen.', selectLanguage: 'Sprache auswählen', nameInLanguage: 'Lokalisierter Name', remove: 'Entfernen' },
  fr: { 'nav.dashboard': 'Tableau de bord', 'nav.ingredients': 'Ingrédients', 'nav.foods': 'Aliments', 'nav.recipes': 'Recettes', 'nav.activities': 'Activités', 'nav.server': 'Serveur', 'nav.settings': 'Paramètres', language: 'Langue', languageSearch: 'Rechercher par nom anglais, nom natif ou code…', translations: 'Traductions', addTranslation: 'Ajouter une traduction', translationHint: 'Le nom de base reste obligatoire. Ajoute des noms localisés seulement si nécessaire.', noTranslation: 'Aucune traduction ajoutée.', selectLanguage: 'Choisir une langue', nameInLanguage: 'Nom localisé', remove: 'Supprimer' },
  ru: { 'nav.dashboard': 'Панель', 'nav.ingredients': 'Ингредиенты', 'nav.foods': 'Еда', 'nav.recipes': 'Рецепты', 'nav.activities': 'Активности', 'nav.server': 'Сервер', 'nav.settings': 'Настройки', language: 'Язык', languageSearch: 'Поиск по английскому названию, родному названию или коду…', translations: 'Переводы', addTranslation: 'Добавить перевод', translationHint: 'Базовое имя обязательно. Локализованные имена добавляются только при необходимости.', noTranslation: 'Переводов пока нет.', selectLanguage: 'Выбрать язык', nameInLanguage: 'Локализованное имя', remove: 'Удалить' },
  uk: { 'nav.dashboard': 'Панель', 'nav.ingredients': 'Інгредієнти', 'nav.foods': 'Їжа', 'nav.recipes': 'Рецепти', 'nav.activities': 'Активності', 'nav.server': 'Сервер', 'nav.settings': 'Налаштування', language: 'Мова', languageSearch: 'Пошук за англійською назвою, рідною назвою або кодом…', translations: 'Переклади', addTranslation: 'Додати переклад', translationHint: 'Базова назва обов’язкова. Локалізовані назви додаються лише за потреби.', noTranslation: 'Перекладів ще немає.', selectLanguage: 'Вибрати мову', nameInLanguage: 'Локалізована назва', remove: 'Видалити' },
  zh: { 'nav.dashboard': '概览', 'nav.ingredients': '配料', 'nav.foods': '食物', 'nav.recipes': '食谱', 'nav.activities': '活动', 'nav.server': '服务器', 'nav.settings': '设置', language: '语言', languageSearch: '按英文名、本地名或代码搜索语言…', translations: '翻译', addTranslation: '添加翻译', translationHint: '基础名称仍为必填。仅在需要时添加本地化名称。', noTranslation: '尚未添加翻译。', selectLanguage: '选择语言', nameInLanguage: '本地化名称', remove: '移除' },
  sk: { 'nav.dashboard': 'Prehľad', 'nav.ingredients': 'Suroviny', 'nav.foods': 'Jedlá', 'nav.recipes': 'Recepty', 'nav.activities': 'Aktivity', 'nav.server': 'Server', 'nav.settings': 'Nastavenia', language: 'Jazyk', languageSearch: 'Hľadať podľa anglického názvu, vlastného názvu alebo kódu…', translations: 'Preklady', addTranslation: 'Pridať preklad', translationHint: 'Základný názov je povinný. Lokalizované názvy pridaj iba podľa potreby.', noTranslation: 'Zatiaľ žiadne preklady.', selectLanguage: 'Vybrať jazyk', nameInLanguage: 'Lokalizovaný názov', remove: 'Odstrániť' },
  ro: { 'nav.dashboard': 'Panou', 'nav.ingredients': 'Ingrediente', 'nav.foods': 'Alimente', 'nav.recipes': 'Rețete', 'nav.activities': 'Activități', 'nav.server': 'Server', 'nav.settings': 'Setări', language: 'Limbă', languageSearch: 'Caută după nume englezesc, nume nativ sau cod…', translations: 'Traduceri', addTranslation: 'Adaugă traducere', translationHint: 'Numele de bază rămâne obligatoriu. Adaugă nume localizate doar când este necesar.', noTranslation: 'Nu există traduceri încă.', selectLanguage: 'Selectează limba', nameInLanguage: 'Nume localizat', remove: 'Elimină' },
  cs: { 'nav.dashboard': 'Přehled', 'nav.ingredients': 'Suroviny', 'nav.foods': 'Jídla', 'nav.recipes': 'Recepty', 'nav.activities': 'Aktivity', 'nav.server': 'Server', 'nav.settings': 'Nastavení', language: 'Jazyk', languageSearch: 'Hledat podle anglického názvu, vlastního názvu nebo kódu…', translations: 'Překlady', addTranslation: 'Přidat překlad', translationHint: 'Základní název je povinný. Lokalizované názvy přidávej jen podle potřeby.', noTranslation: 'Zatím nejsou přidány překlady.', selectLanguage: 'Vybrat jazyk', nameInLanguage: 'Lokalizovaný název', remove: 'Odebrat' },
  sl: { 'nav.dashboard': 'Pregled', 'nav.ingredients': 'Sestavine', 'nav.foods': 'Živila', 'nav.recipes': 'Recepti', 'nav.activities': 'Aktivnosti', 'nav.server': 'Strežnik', 'nav.settings': 'Nastavitve', language: 'Jezik', languageSearch: 'Išči po angleškem imenu, domačem imenu ali kodi…', translations: 'Prevodi', addTranslation: 'Dodaj prevod', translationHint: 'Osnovno ime je obvezno. Lokalizirana imena dodaj samo po potrebi.', noTranslation: 'Prevodi še niso dodani.', selectLanguage: 'Izberi jezik', nameInLanguage: 'Lokalizirano ime', remove: 'Odstrani' },
  hr: { 'nav.dashboard': 'Pregled', 'nav.ingredients': 'Sastojci', 'nav.foods': 'Hrana', 'nav.recipes': 'Recepti', 'nav.activities': 'Aktivnosti', 'nav.server': 'Server', 'nav.settings': 'Postavke', language: 'Jezik', languageSearch: 'Traži po engleskom nazivu, izvornom nazivu ili kodu…', translations: 'Prijevodi', addTranslation: 'Dodaj prijevod', translationHint: 'Osnovni naziv je obavezan. Lokalizirane nazive dodaj samo po potrebi.', noTranslation: 'Još nema prijevoda.', selectLanguage: 'Odaberi jezik', nameInLanguage: 'Lokalizirani naziv', remove: 'Ukloni' },
  pl: { 'nav.dashboard': 'Panel', 'nav.ingredients': 'Składniki', 'nav.foods': 'Produkty', 'nav.recipes': 'Przepisy', 'nav.activities': 'Aktywności', 'nav.server': 'Serwer', 'nav.settings': 'Ustawienia', language: 'Język', languageSearch: 'Szukaj po nazwie angielskiej, własnej lub kodzie…', translations: 'Tłumaczenia', addTranslation: 'Dodaj tłumaczenie', translationHint: 'Nazwa bazowa jest wymagana. Nazwy lokalizowane dodawaj tylko w razie potrzeby.', noTranslation: 'Nie dodano jeszcze tłumaczeń.', selectLanguage: 'Wybierz język', nameInLanguage: 'Nazwa lokalizowana', remove: 'Usuń' },
  es: { 'nav.dashboard': 'Panel', 'nav.ingredients': 'Ingredientes', 'nav.foods': 'Alimentos', 'nav.recipes': 'Recetas', 'nav.activities': 'Actividades', 'nav.server': 'Servidor', 'nav.settings': 'Ajustes', language: 'Idioma', languageSearch: 'Buscar por nombre inglés, nombre nativo o código…', translations: 'Traducciones', addTranslation: 'Añadir traducción', translationHint: 'El nombre base sigue siendo obligatorio. Añade nombres localizados solo cuando sea necesario.', noTranslation: 'Aún no hay traducciones.', selectLanguage: 'Seleccionar idioma', nameInLanguage: 'Nombre localizado', remove: 'Eliminar' },
  pt: { 'nav.dashboard': 'Painel', 'nav.ingredients': 'Ingredientes', 'nav.foods': 'Alimentos', 'nav.recipes': 'Receitas', 'nav.activities': 'Atividades', 'nav.server': 'Servidor', 'nav.settings': 'Definições', language: 'Idioma', languageSearch: 'Pesquisar por nome em inglês, nome nativo ou código…', translations: 'Traduções', addTranslation: 'Adicionar tradução', translationHint: 'O nome base continua obrigatório. Adiciona nomes localizados apenas quando necessário.', noTranslation: 'Ainda não há traduções.', selectLanguage: 'Selecionar idioma', nameInLanguage: 'Nome localizado', remove: 'Remover' },
};
for (const [language, values] of Object.entries(desktopCoreLanguageTranslations)) {
  translations[language] = { ...translations[language], ...normalizeTranslationValues(values) };
}


const completeDesktopLanguageTranslations: Record<string, Record<string, string>> = {
  "hu": {
    "nav.dashboard": "Áttekintés",
    "nav.ingredients": "Alapanyagok",
    "nav.foods": "Ételek",
    "nav.recipes": "Receptek",
    "nav.activities": "Aktivitások",
    "nav.server": "Szerver",
    "nav.settings": "Beállítások",
    "language": "Nyelv",
    "languageSearch": "Keress angol névvel, saját névvel vagy kóddal…",
    "translations": "Fordítások",
    "addTranslation": "Fordítás hozzáadása",
    "translationHint": "Az alap név kötelező. Lokalizált nevet csak extra mezőként adj hozzá.",
    "noTranslation": "Még nincs fordítás.",
    "selectLanguage": "Nyelv kiválasztása",
    "nameInLanguage": "Lokalizált név",
    "remove": "Törlés",
    "ui.mergeDialogPrefix": "Összevonás:",
    "ui.mergeDialogMiddle": "egy meglévő célba:",
    "ui.mergeDialogSuffix": "Kereshetsz név vagy ID alapján; nem kell fejből tudni a cél ID-t.",
    "ui.status_24a23": "Állapot:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino desktop szerver",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Alapanyagok",
    "ui.avg100g_5f553": "Átlag / 100g",
    "ui.updated_ff0a3": "Frissítve",
    "ui.foods_9428a": "Ételek",
    "ui.recipes_0153a": "Receptek",
    "ui.activities_d78ed": "Aktivitások",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first helyi architektúra",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "Ez a desktop app kezeli az alapanyag-, étel-, recept- és aktivitáskatalógust, valamint a LAN API-t. A mobil szinkronizálja a katalógust, majd a helyi cache-ből működik tovább, ha a desktop szerver nem elérhető.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Márka és vonalkód nélküli általános alapanyagok, például cukor, gyümölcs, zöldség vagy burgonya.",
    "ui.refresh_63a6a": "Frissítés",
    "ui.importCsv_28ec2": "CSV import",
    "ui.skipDuplicates_6d417": "Duplikátumok kihagyása",
    "ui.exportCsv_c04f1": "CSV export",
    "ui.addIngredient_590a4": "Alapanyag hozzáadása",
    "ui.sortByName_deb7e": "Rendezés név szerint",
    "ui.sortByKcal_a0e33": "Rendezés kcal szerint",
    "ui.sortByProtein_30969": "Rendezés fehérje szerint",
    "ui.sortByCarbs_8895f": "Rendezés szénhidrát szerint",
    "ui.sortByFat_e8cb8": "Rendezés zsír szerint",
    "ui.ingredientCsvStructure_bbae0": "Alapanyag CSV struktúra",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Az alapanyagok márka nélküli nyers/alap tételek. Nincs vonalkód vagy márka oszlopuk.",
    "ui.name_49ee3": "Név",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Szénhidrát",
    "ui.fat_4d09c": "Zsír",
    "ui.protein_7e667": "Fehérje",
    "ui.actions_06df3": "Műveletek",
    "ui.ingredientNoBrandBarcode_b87ef": "Alapanyag · nincs márka/vonalkód",
    "ui.edit_7dce1": "Szerkesztés",
    "ui.mergeInto_f7c29": "Összevonás ide",
    "ui.moveToFoods_e1a6b": "Áthelyezés ételekhez",
    "ui.delete_f2a6c": "Törlés",
    "ui.createEditDeleteImportAndExport_14d0a": "Konkrét márkás vagy forrás-specifikus ételek létrehozása, szerkesztése, törlése, importja és exportja.",
    "ui.addFood_2e2e1": "Étel hozzáadása",
    "ui.foodCsvStructure_f4bb5": "Étel CSV struktúra",
    "ui.importFilesMustUseThisHeader_fb913": "Az importfájloknak ezt a fejlécsort kell használniuk. Kezdő/minta ételek szándékosan nincsenek az appba csomagolva.",
    "ui.moveToIngredients_39253": "Áthelyezés alapanyagokhoz",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Újrahasználható ételek összeállítása ételekből. A tápérték a hozzávalókból számolódik.",
    "ui.addRecipe_39767": "Recept hozzáadása",
    "ui.recipeCsvStructure_a4db3": "Recept CSV struktúra",
    "ui.recipesAreImportedFromAHeader_3c31f": "A receptek fejlécsémából és saját sorokból importálhatók. A hozzávalók tárolása grammban történik.",
    "ui.kcalTotal_0c895": "kcal összesen",
    "ui.carbsTotal_d2ae4": "szénhidrát összesen",
    "ui.fatTotal_41615": "zsír összesen",
    "ui.proteinTotal_67f44": "fehérje összesen",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "súly",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker aktivitáskatalógus szerkeszthető MET és kcal/perc értékekkel.",
    "ui.addActivity_a263a": "Aktivitás hozzáadása",
    "ui.activityCsvStructure_c2cbe": "Aktivitás CSV struktúra",
    "ui.useThisHeaderRowForActivity_4eb62": "Aktivitás importhoz ezt a fejlécsort használd. A kcal/perc opcionális, ha MET rendelkezésre áll.",
    "ui.lanApiServer_2738b": "LAN API szerver",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Opcionális szerverjelszó beállítása. Ha üres, a mobil hitelesítés nélkül szinkronizálhat a LAN-on; ha meg van adva, a mobilnak ugyanazt a jelszót kell használnia.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Szerverjelszó",
    "ui.start_a6122": "Indítás",
    "ui.stop_11a75": "Leállítás",
    "ui.savePassword_49284": "Jelszó mentése",
    "ui.restoreBackup_dd06b": "Mentés visszaállítása",
    "ui.pairingDetails_d8479": "Párosítási adatok",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Forrás ID",
    "ui.auth_632c9": "Hitelesítés",
    "ui.channel_781dc": "Csatorna",
    "ui.connectedDevices_1aee3": "Csatlakozott eszközök",
    "ui.devicesSeenByTheLanApi_7cc05": "A LAN API által az elmúlt 5 percben látott eszközök. A mobil app olvasható Android eszközazonosítót küld a nyers Linux/WebView user agent helyett.",
    "ui.startTheLanApiServerTo_231bf": "Indítsd el a LAN API szervert a csatlakozott mobil eszközök megjelenítéséhez.",
    "ui.noMobileDeviceHasContactedThe_a557c": "Nem jelentkezett be mobil eszköz mostanában.",
    "ui.mergeSuggestions_3f578": "Összevonási javaslatok",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate foods, recipes and activities before any sync is involved. Choose which item should stay, then merge the rest into it, or open an item and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Összes kijelölt összevonása",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "Nem található valószínű duplikált katalógustétel.",
    "ui.mergeSelected_1f978": "Kijelöltek összevonása",
    "ui.mobileUploadInbox_3476a": "Mobil feltöltési inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobile are staged here first. Accept a batch to record it on the server. Matching IDs are highlighted as replacements, not duplicates, so mobile edits update the server item instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Desktopon már meglévők elrejtése",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Az alap nézet csak az új, módosított és kihagyott feltöltési tételeket mutatja.",
    "ui.noPendingMobileUploads_7e5ca": "Nincs függő mobil feltöltés.",
    "ui.reviewEdit_77e3a": "Átnézés/szerkesztés",
    "ui.recordDraft_685b4": "Vázlat rögzítése",
    "ui.reject_d98ac": "Elutasítás",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop items are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Kihagyás",
    "ui.restore_2bd33": "Visszaállítás",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Pontos duplikátum összevonási javaslatok",
    "ui.desktopServer_ee8af": "desktop szerver",
    "ui.settings_f4f70": "Beállítások",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Futásidő, tray, indítás, mentések, adatvédelem és projektlinkek.",
    "ui.dataAndRecovery_677d1": "Adatok és visszaállítás",
    "ui.backupsRestoreAndReset_6433e": "Mentések, visszaállítás és reset.",
    "ui.saveCurrentWindow_1b2b6": "Jelenlegi ablak mentése",
    "ui.storeTheCurrentPositionAndSize_161c9": "Az aktuális pozíció és méret azonnali mentése.",
    "ui.exportDataZip_d39bb": "Adatok exportálása ZIP-be",
    "ui.createADesktopCatalogAndSettings_5ec25": "Desktop katalógus és beállításmentés készítése.",
    "ui.importDataZip_04e73": "Adatok importálása ZIP-ből",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Alapanyagok, ételek, receptek, aktivitások és desktop beállítások visszaállítása.",
    "ui.factoryReset_5dcd7": "Gyári visszaállítás",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Helyi desktop katalógus törlése és beállítás újrakezdése.",
    "ui.licenses_f6aca": "Licencek",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Külső licencek és köszönetnyilvánítások.",
    "ui.privacy_c5f29": "Adatvédelem",
    "ui.localFirstByDesign_50f82": "Local-first tervezés",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your ingredient, food, recipe and activity catalog locally on this machine. The LAN API is used only by your paired mobile app on your own network. No analytics, no public food search, no account.",
    "ui.about_8f7f4": "Névjegy",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Hiba jelentése",
    "ui.star_26f93": "Csillag",
    "ui.desktopSetup_8dda1": "Desktop beállítás",
    "ui.setTheDefaultLanApiPort_c998b": "Állítsd be az alap LAN API portot, és nézd át a nutrino Desktop működését mobil párosítás előtt.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Szerver visszaállítása ZIP mentésből",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Alapanyagok és ételek importja vagy létrehozása",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Építsd fel a privát alapanyag- és ételkatalógusodat.",
    "ui.buildRecipes_f4672": "Receptek építése",
    "ui.combineFoodsIntoReusableMeals_a2483": "Ételek kombinálása újrahasználható receptekké.",
    "ui.editActivityCatalog_5a8f3": "Aktivitáskatalógus szerkesztése",
    "ui.reviewMetAndKcalMinValues_c297b": "MET és kcal/perc értékek átnézése.",
    "ui.startTheLanApi_61b1e": "LAN API indítása",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Párosítsd a mobilt, amikor készen állsz.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls ingredients, foods, recipes and activities from this server. Diary data stays on the phone. You can change startup, tray and backup settings later from Settings.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "Nincs nyilvános ételadatbázis, nincs fiók, nincs analitika.",
    "ui.back_0557f": "Vissza",
    "ui.next_10ac3": "Tovább",
    "ui.startUsingNutrino_b763a": "nutrino indítása",
    "ui.catalogQr_0d8f3": "katalógus QR",
    "ui.scanThisWithTheMobileApp_231a6": "Scan this with the mobile app to review, edit and save the item locally. Large recipes are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the recipe was imported.",
    "ui.previous_dd1f7": "Előző",
    "ui.done_f9296": "Kész",
    "ui.mergeCatalogItem_db2c1": "katalógustétel összevonása",
    "ui.chooseTheItemToKeep_9e3c5": "Válaszd ki, melyik tétel maradjon",
    "ui.merge_68be4": "Összevonás",
    "ui.close_d3d2e": "Bezárás",
    "ui.noMatchingTargetItem_6e9d3": "Nincs megfelelő céltétel.",
    "ui.cancel_ea478": "Mégse",
    "ui.mergeIntoSelected_1a212": "Összevonás a kijelölttel",
    "ui.mobileUploadInbox_5ea98": "mobil feltöltési inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Átnézés és szerkesztés rögzítés előtt",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Azonos ID-jú cserék ebből a feltöltésből",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Pontos duplikátum javaslatok ebből a feltöltésből",
    "ui.noIngredientsInThisUpload_dfd36": "Nincs alapanyag ebben a feltöltésben.",
    "ui.ingredient_59198": "Alapanyag",
    "ui.noFoodsInThisUpload_d06f6": "Nincs étel ebben a feltöltésben.",
    "ui.food_0a38e": "Étel",
    "ui.noRecipesInThisUpload_f370c": "Nincs recept ebben a feltöltésben.",
    "ui.recipe_aef6e": "Recept",
    "ui.noActivitiesInThisUpload_ded76": "Nincs aktivitás ebben a feltöltésben.",
    "ui.activity_ecfc2": "Aktivitás",
    "ui.privateMobileDiaryData_f455b": "Privát mobil naplóadatok",
    "ui.keptOnPhoneOnly_f22ee": "Csak telefonon marad",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Az étkezési jegyzetek, aktivitásnaplók és súlynaplók nem importálódnak desktopra. Mobilon helyben maradnak.",
    "ui.skippedItems_66bcb": "Kihagyott tételek",
    "ui.skipped_d9c8f": "Kihagyva",
    "ui.advancedJsonEditor_19192": "Haladó JSON szerkesztő",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Csak akkor használd, ha a vizuális szerkesztő nem ad hozzáférést egy szükséges mezőhöz.",
    "ui.saveDraft_48ca5": "Vázlat mentése",
    "ui.note_3b064": "Megjegyzés",
    "ui.defaultUnit_81471": "Alap mértékegység",
    "ui.servingSizeG_8fd02": "Adagméret g",
    "ui.kcal100g_bb877": "kcal / 100g",
    "ui.carbs100g_77af9": "Szénhidrát / 100g",
    "ui.fat100g_6709a": "Zsír / 100g",
    "ui.protein100g_bf529": "Fehérje / 100g",
    "ui.sugars100g_7ebdd": "Cukrok / 100g",
    "ui.fiber100g_31731": "Rost / 100g",
    "ui.salt100g_1473d": "Só / 100g",
    "ui.brandSourceLabel_07afa": "Márka / forrás címke",
    "ui.barcodeEanUpc_1335e": "Vonalkód / EAN / UPC",
    "ui.description_b5a7a": "Leírás",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Hozzáadódik a hozzávalók kcal összegéhez, vagy levonódik belőle. A makrók továbbra is a hozzávalókból számolódnak.",
    "ui.servings_4349e": "Adagok",
    "ui.whenSet1DbEqualsTotal_3140a": "Ha meg van adva, 1 db = recept teljes grammja / adagok.",
    "ui.noMatchingItem_12f96": "Nincs találat.",
    "ui.remove_1063e": "Eltávolítás",
    "ui.carbs100g_ed4c3": "szénhidrát/100g",
    "ui.fat100g_a84e1": "zsír/100g",
    "ui.protein100g_cdbf5": "fehérje/100g",
    "ui.code_ca0db": "Kód",
    "ui.type_a1fa2": "Típus",
    "ui.kcalMin_22677": "kcal / perc",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Alapanyag keresése név, megjegyzés vagy ID alapján...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Étel keresése név, márka, vonalkód, megjegyzés vagy ID alapján...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Recept keresése név, leírás, megjegyzés vagy ID alapján...",
    "ui.searchActivityTypeCode_9bb39": "Aktivitás, típus vagy kód keresése...",
    "ui.leaveEmptyForNoPassword_c6e10": "Hagyd üresen, ha nincs jelszó",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Opcionális; hagyd üresen, ha nincs jelszó",
    "ui.searchByNameIdBrandCode_0c5a3": "Keresés név, ID, márka vagy kód alapján...",
    "ui.ingredientName_cbdf8": "Alapanyag neve",
    "ui.unit_19c56": "Mértékegység",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Étel neve",
    "ui.brand_1be6f": "Márka",
    "ui.recipeName_23955": "Recept neve",
    "ui.servingsOptional_9fcb2": "Adagok (opcionális)",
    "ui.activityName_75c4c": "Aktivitás neve",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Opcionális megjegyzés, forrás vagy mérési segítség",
    "ui.brandRestaurantShopOrSource_21f1e": "Márka, étterem, bolt vagy forrás",
    "ui.optional_ebb06": "Opcionális",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Opcionális megjegyzés, forrás, adag vagy elkészítési részlet",
    "ui.optionalNegativeIsAllowed_cb1cb": "Opcionális; negatív érték megengedett",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Opcionális; üresen a teljes recept 1 adag",
    "ui.searchFoodIngredientOrRecipe_1f688": "Étel, alapanyag vagy recept keresése...",
    "ui.grams_ca820": "gramm",
    "ui.pieces_6b7e9": "db",
    "ui.running_75101": "futás",
    "ui.general_95815": "általános",
    "ui.desktopSetupSteps_ae24e": "Desktop beállítás lépései"
  },
  "de": {
    "nav.dashboard": "Übersicht",
    "nav.ingredients": "Zutaten",
    "nav.foods": "Lebensmittel",
    "nav.recipes": "Rezepte",
    "nav.activities": "Aktivitäten",
    "nav.server": "Server",
    "nav.settings": "Einstellungen",
    "language": "Sprache",
    "languageSearch": "Sprache nach englischem Namen, Eigenname oder Code suchen…",
    "translations": "Übersetzungen",
    "addTranslation": "Übersetzung hinzufügen",
    "translationHint": "Der Basisname bleibt erforderlich. Lokalisierte Namen nur bei Bedarf hinzufügen.",
    "noTranslation": "Noch keine Übersetzungen.",
    "selectLanguage": "Sprache auswählen",
    "nameInLanguage": "Lokalisierter Name",
    "remove": "Entfernen",
    "ui.mergeDialogPrefix": "Zusammenführen",
    "ui.mergeDialogMiddle": "in vorhandenes",
    "ui.mergeDialogSuffix": "Du kannst nach Name oder ID suchen; die Ziel-ID muss nicht auswendig bekannt sein.",
    "ui.status_24a23": "Status:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop-Server",
    "ui.lanApi_0ee00": "LAN-API",
    "ui.ingredients_210c9": "Zutaten",
    "ui.avg100g_5f553": "Ø / 100 g",
    "ui.updated_ff0a3": "Aktualisiert",
    "ui.foods_9428a": "Lebensmittel",
    "ui.recipes_0153a": "Rezepte",
    "ui.activities_d78ed": "Aktivitäten",
    "ui.offlineFirstLocalArchitecture_127b5": "Lokale Offline-first-Architektur",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "Diese Desktop-App verwaltet the Zutaten-, Lebensmittel-, Rezept- und Aktivitätskataloge plus the LAN-API. Mobil synchronisiert den Katalog, then keeps working from its lokaler Cache whenever the Desktop-Server nicht verfügbar ist.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generische Roh-/Basisartikel ohne Marke oder Barcode, such as Zucker, Obst, Gemüse oder Kartoffeln.",
    "ui.refresh_63a6a": "Aktualisieren",
    "ui.importCsv_28ec2": "CSV importieren",
    "ui.skipDuplicates_6d417": "Duplikate überspringen",
    "ui.exportCsv_c04f1": "CSV exportieren",
    "ui.addIngredient_590a4": "Zutat hinzufügen",
    "ui.sortByName_deb7e": "Nach Name sortieren",
    "ui.sortByKcal_a0e33": "Nach kcal sortieren",
    "ui.sortByProtein_30969": "Nach Protein sortieren",
    "ui.sortByCarbs_8895f": "Nach Kohlenhydraten sortieren",
    "ui.sortByFat_e8cb8": "Nach Fett sortieren",
    "ui.ingredientCsvStructure_bbae0": "Zutaten-CSV-Struktur",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Zutaten are markenlose Grundmaterialien. They do not have Barcode- oder Markenspalten.",
    "ui.name_49ee3": "Name",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Kohlenhydrate",
    "ui.fat_4d09c": "Fett",
    "ui.protein_7e667": "Protein",
    "ui.actions_06df3": "Aktionen",
    "ui.ingredientNoBrandBarcode_b87ef": "Zutat · keine Marke/kein Barcode",
    "ui.edit_7dce1": "Bearbeiten",
    "ui.mergeInto_f7c29": "Zusammenführen in",
    "ui.moveToFoods_e1a6b": "Zu Lebensmitteln verschieben",
    "ui.delete_f2a6c": "Löschen",
    "ui.createEditDeleteImportAndExport_14d0a": "Erstellen, bearbeiten, löschen, importieren und exportieren concrete marken- oder quellenspezifische Lebensmittel.",
    "ui.addFood_2e2e1": "Lebensmittel hinzufügen",
    "ui.foodCsvStructure_f4bb5": "Lebensmittel-CSV-Struktur",
    "ui.importFilesMustUseThisHeader_fb913": "Importdateien müssen diese Kopfzeile verwenden. Starter-/Beispiellebensmittel sind absichtlich nicht in der App enthalten.",
    "ui.moveToIngredients_39253": "Zu Zutaten verschieben",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from Lebensmittel. Nährwerte werden aus Zutaten berechnet.",
    "ui.addRecipe_39767": "Rezept hinzufügen",
    "ui.recipeCsvStructure_a4db3": "Rezept-CSV-Struktur",
    "ui.recipesAreImportedFromAHeader_3c31f": "Rezepte are imported from a Header-Schema plus deine eigenen Zeilen. Zutaten bleiben gramm-basiert gespeichert.",
    "ui.kcalTotal_0c895": "kcal gesamt",
    "ui.carbsTotal_d2ae4": "Kohlenhydrate gesamt",
    "ui.fatTotal_41615": "Fett gesamt",
    "ui.proteinTotal_67f44": "Protein gesamt",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "Gewicht",
    "ui.extraKcal_65a05": "Extra-kcal",
    "ui.1Db_42565": "1 Stk.",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker Aktivität Katalog with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Aktivität hinzufügen",
    "ui.activityCsvStructure_c2cbe": "Aktivitäts-CSV-Struktur",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for Aktivität imports. kcal/min is optional when MET is available.",
    "ui.lanApiServer_2738b": "LAN-API-Server",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Optionales Serverpasswort festlegen. If it is empty, mobil can Synchronisierung on your LAN ohne Authentifizierung; if set, mobil muss dasselbe Passwort verwenden.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Serverpasswort",
    "ui.start_a6122": "Start",
    "ui.stop_11a75": "Stopp",
    "ui.savePassword_49284": "Passwort speichern",
    "ui.restoreBackup_dd06b": "Backup wiederherstellen",
    "ui.pairingDetails_d8479": "Kopplungsdetails",
    "ui.baseUrl_ade86": "Basis-URL",
    "ui.sourceId_33735": "Quell-ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Kanal",
    "ui.connectedDevices_1aee3": "Verbundene Geräte",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN-API in the letzten 5 Minuten. The mobil app sends a lesbare Android-Geräteidentität instead of the roher Linux/WebView-User-Agent.",
    "ui.startTheLanApiServerTo_231bf": "LAN-API starten Server to see connected mobil devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No mobil device has contacted the Server recently.",
    "ui.mergeSuggestions_3f578": "Zusammenführungsvorschläge",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list wahrscheinliche Duplikate von Lebensmitteln, Rezepten und Aktivitäten before any Synchronisierung is involved. Wähle, welcher Eintrag bleiben soll, then führe den Rest darin zusammen, or open an Eintrag and rename it if it is only schlecht benannt.",
    "ui.mergeAllSelected_07c3e": "Alle ausgewählten zusammenführen",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate Katalog Einträge found.",
    "ui.mergeSelected_1f978": "Ausgewählte zusammenführen",
    "ui.mobileUploadInbox_3476a": "Mobile Upload-Inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobil are werden hier zuerst zwischengespeichert. Akzeptiere einen Stapel to speichere ihn auf dem Server. Gleiche IDs werden als Ersetzungen markiert, not duplicates, so mobil edits update the Server Eintrag instead of einen weiteren zu erstellen.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Bereits auf dem Desktop vorhandene ausblenden",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Die Standardansicht zeigt nur neue, geänderte und übersprungene Upload-Einträge.",
    "ui.noPendingMobileUploads_7e5ca": "Keine ausstehenden mobilen Uploads.",
    "ui.reviewEdit_77e3a": "Prüfen/bearbeiten",
    "ui.recordDraft_685b4": "Entwurf speichern",
    "ui.reject_d98ac": "Ablehnen",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "Alle unveränderten Desktop-Einträge sind ausgeblendet. Deaktiviere den Filter oben, um sie zu prüfen.",
    "ui.skip_72ef2": "Überspringen",
    "ui.restore_2bd33": "Wiederherstellen",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "Desktop-Server",
    "ui.settings_f4f70": "Einstellungen",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Laufzeit, Tray, Autostart, Backups, Datenschutz und Projektlinks.",
    "ui.dataAndRecovery_677d1": "Daten & Wiederherstellung",
    "ui.backupsRestoreAndReset_6433e": "Backups, Wiederherstellung und Zurücksetzen.",
    "ui.saveCurrentWindow_1b2b6": "Aktuelles Fenster speichern",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Daten-ZIP exportieren",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a Desktop Katalog and Einstellungen Backup.",
    "ui.importDataZip_04e73": "Daten-ZIP importieren",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Wiederherstellen Zutaten, Lebensmittel, Rezepte, Aktivitäten and Desktop Einstellungen.",
    "ui.factoryReset_5dcd7": "Werkseinstellungen",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Löschen the lokal Desktop Katalog and start setup again.",
    "ui.licenses_f6aca": "Lizenzen",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Drittanbieter-Hinweise und Danksagungen.",
    "ui.privacy_c5f29": "Datenschutz",
    "ui.localFirstByDesign_50f82": "Local-first by Design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your Zutat, Lebensmittel, Rezept and Aktivität Katalog locally on this machine. The LAN-API is used only by your gekoppelte mobil App on your own network. Keine Analyse, keine öffentliche Lebensmittelsuche, kein Konto.",
    "ui.about_8f7f4": "Über",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the datenschutzorientierte Ernährungsidee, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the Grundlage, auf der nutrino basiert.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Problem melden",
    "ui.star_26f93": "Stern geben",
    "ui.desktopSetup_8dda1": "Desktop-Einrichtung",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN-API-Port and review how nutrino Desktop works before pairing mobil.",
    "ui.lanApiPort_509d9": "LAN-API-Port",
    "ui.restoreServerFromBackupZip_aafd4": "Wiederherstellen Server from Backup ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create Zutaten and Lebensmittel",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private Zutat and Lebensmittel catalogs.",
    "ui.buildRecipes_f4672": "Rezepte erstellen",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine Lebensmittel into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Aktivitätskatalog bearbeiten",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "LAN-API starten",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair mobil when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls Zutaten, Lebensmittel, Rezepte and Aktivitäten from this Server. Tagebuchdaten bleiben auf dem Telefon. You can change startup, tray and Backup Einstellungen later from Einstellungen.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public Lebensmittel database, no account, no analytics.",
    "ui.back_0557f": "Zurück",
    "ui.next_10ac3": "Weiter",
    "ui.startUsingNutrino_b763a": "nutrino starten",
    "ui.catalogQr_0d8f3": "Katalog-QR",
    "ui.scanThisWithTheMobileApp_231a6": "Scannen this with the mobil app to review, edit and save the Eintrag locally. Große Rezepte werden in nummerierte QR-Teile aufgeteilt; jeden Teil einmal scannen.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The Der erste QR enthält die Gesamtanzahl. Continue until the phone says the Rezept was imported.",
    "ui.previous_dd1f7": "Zurück",
    "ui.done_f9296": "Fertig",
    "ui.mergeCatalogItem_db2c1": "Katalogeintrag zusammenführen",
    "ui.chooseTheItemToKeep_9e3c5": "Eintrag auswählen, der bleiben soll",
    "ui.merge_68be4": "Zusammenführen",
    "ui.close_d3d2e": "Schließen",
    "ui.noMatchingTargetItem_6e9d3": "Kein passender Zieleintrag.",
    "ui.cancel_ea478": "Abbrechen",
    "ui.mergeIntoSelected_1a212": "In ausgewählten zusammenführen",
    "ui.mobileUploadInbox_5ea98": "Mobile Upload-Inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Vor dem Speichern prüfen und bearbeiten",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID Ersetzungen from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No Zutaten in this upload.",
    "ui.ingredient_59198": "Zutat",
    "ui.noFoodsInThisUpload_d06f6": "No Lebensmittel in this upload.",
    "ui.food_0a38e": "Lebensmittel",
    "ui.noRecipesInThisUpload_f370c": "No Rezepte in this upload.",
    "ui.recipe_aef6e": "Rezept",
    "ui.noActivitiesInThisUpload_ded76": "No Aktivitäten in this upload.",
    "ui.activity_ecfc2": "Aktivität",
    "ui.privateMobileDiaryData_f455b": "Private mobile Tagebuchdaten",
    "ui.keptOnPhoneOnly_f22ee": "Nur auf dem Telefon gespeichert",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, Aktivität logs and Gewicht logs are werden nicht auf den Desktop importiert. They bleiben lokal auf dem Mobilgerät.",
    "ui.skippedItems_66bcb": "Übersprungene Einträge",
    "ui.skipped_d9c8f": "Übersprungen",
    "ui.advancedJsonEditor_19192": "Erweiterter JSON-Editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visueller Editor does not expose a benötigtes Feld.",
    "ui.saveDraft_48ca5": "Entwurf speichern",
    "ui.note_3b064": "Notiz",
    "ui.defaultUnit_81471": "Standardeinheit",
    "ui.servingSizeG_8fd02": "Portionsgröße g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Kohlenhydrate / 100 g",
    "ui.fat100g_6709a": "Fett / 100 g",
    "ui.protein100g_bf529": "Protein / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Marke / Quelle",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Beschreibung",
    "ui.extraKcal_70d7d": "Extra-kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the Zutat kcal gesamt. Makros bleiben aus Zutaten berechnet.",
    "ui.servings_4349e": "Portionen",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 Stk. equals total Rezept Gramm / servings.",
    "ui.noMatchingItem_12f96": "Kein passender Eintrag.",
    "ui.remove_1063e": "Entfernen",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Code",
    "ui.type_a1fa2": "Typ",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Suchen Zutaten by Name, Notiz or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Suchen Lebensmittel by Name, brand, Barcode, Notiz or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Suchen Rezepte by Name, Beschreibung, Notiz or ID...",
    "ui.searchActivityTypeCode_9bb39": "Suchen Aktivität, type, Code...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no Passwort",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Optional; leave empty for no Passwort",
    "ui.searchByNameIdBrandCode_0c5a3": "Suchen by Name, ID, brand, Code...",
    "ui.ingredientName_cbdf8": "Zutat Name",
    "ui.unit_19c56": "Einheit",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Lebensmittel Name",
    "ui.brand_1be6f": "Marke",
    "ui.recipeName_23955": "Rezept Name",
    "ui.servingsOptional_9fcb2": "Portionen (optional)",
    "ui.activityName_75c4c": "Aktivitätsname",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Optional Notiz, Quelle or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Marke, restaurant, shop or Quelle",
    "ui.optional_ebb06": "Optional",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Optional Notiz, Quelle, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Optional; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Optional; empty means the whole Rezept is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Suchen Lebensmittel, Zutat or Rezept...",
    "ui.grams_ca820": "Gramm",
    "ui.pieces_6b7e9": "Stück",
    "ui.running_75101": "Laufen",
    "ui.general_95815": "Allgemein",
    "ui.desktopSetupSteps_ae24e": "Desktop-Einrichtungsschritte"
  },
  "fr": {
    "nav.dashboard": "Tableau de bord",
    "nav.ingredients": "Ingrédients",
    "nav.foods": "Aliments",
    "nav.recipes": "Recettes",
    "nav.activities": "Activités",
    "nav.server": "Serveur",
    "nav.settings": "Paramètres",
    "language": "Langue",
    "languageSearch": "Rechercher par nom anglais, nom natif ou code…",
    "translations": "Traductions",
    "addTranslation": "Ajouter une traduction",
    "translationHint": "Le nom de base reste obligatoire. Ajoute des noms localisés seulement si nécessaire.",
    "noTranslation": "Aucune traduction ajoutée.",
    "selectLanguage": "Choisir une langue",
    "nameInLanguage": "Nom localisé",
    "remove": "Supprimer",
    "ui.mergeDialogPrefix": "Fusionner",
    "ui.mergeDialogMiddle": "dans un élément existant",
    "ui.mergeDialogSuffix": "Tu peux rechercher par nom ou ID ; inutile de mémoriser l’ID cible.",
    "ui.status_24a23": "Statut :",
    "ui.nutrinoDesktopServer_a80f2": "Serveur Desktop nutrino",
    "ui.lanApi_0ee00": "API LAN",
    "ui.ingredients_210c9": "Ingrédients",
    "ui.avg100g_5f553": "Moy. / 100 g",
    "ui.updated_ff0a3": "Mis à jour",
    "ui.foods_9428a": "Aliments",
    "ui.recipes_0153a": "Recettes",
    "ui.activities_d78ed": "Activités",
    "ui.offlineFirstLocalArchitecture_127b5": "Architecture locale offline-first",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "Cette app desktop gère the les catalogues d’ingrédients, aliments, recettes et activités plus the API LAN. Le mobile synchronise le catalogue, then keeps working from its cache local whenever the serveur desktop indisponible.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Éléments bruts/génériques sans marque ni code-barres, such as sucre, fruits, légumes ou pommes de terre.",
    "ui.refresh_63a6a": "Actualiser",
    "ui.importCsv_28ec2": "Importer CSV",
    "ui.skipDuplicates_6d417": "Ignorer les doublons",
    "ui.exportCsv_c04f1": "Exporter CSV",
    "ui.addIngredient_590a4": "Ajouter un ingrédient",
    "ui.sortByName_deb7e": "Trier par nom",
    "ui.sortByKcal_a0e33": "Trier par kcal",
    "ui.sortByProtein_30969": "Trier par protéines",
    "ui.sortByCarbs_8895f": "Trier par glucides",
    "ui.sortByFat_e8cb8": "Trier par lipides",
    "ui.ingredientCsvStructure_bbae0": "Structure CSV des ingrédients",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Ingrédients are matières de base sans marque. They do not have colonnes code-barres ou marque.",
    "ui.name_49ee3": "Nom",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Glucides",
    "ui.fat_4d09c": "Lipides",
    "ui.protein_7e667": "Protéines",
    "ui.actions_06df3": "Actions",
    "ui.ingredientNoBrandBarcode_b87ef": "Ingrédient · sans marque/code-barres",
    "ui.edit_7dce1": "Modifier",
    "ui.mergeInto_f7c29": "Fusionner dans",
    "ui.moveToFoods_e1a6b": "Déplacer vers aliments",
    "ui.delete_f2a6c": "Supprimer",
    "ui.createEditDeleteImportAndExport_14d0a": "Créer, modifier, supprimer, importer et exporter concrete aliments de marque ou liés à une source.",
    "ui.addFood_2e2e1": "Ajouter un aliment",
    "ui.foodCsvStructure_f4bb5": "Structure CSV des aliments",
    "ui.importFilesMustUseThisHeader_fb913": "Les fichiers importés doivent utiliser cette ligne d’en-tête. Les aliments d’exemple ne sont volontairement pas inclus dans l’app.",
    "ui.moveToIngredients_39253": "Déplacer vers ingrédients",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from aliments. La nutrition est calculée à partir des ingrédients.",
    "ui.addRecipe_39767": "Ajouter une recette",
    "ui.recipeCsvStructure_a4db3": "Structure CSV des recettes",
    "ui.recipesAreImportedFromAHeader_3c31f": "Recettes are imported from a schéma avec en-tête plus tes propres lignes. Les ingrédients restent stockés en grammes.",
    "ui.kcalTotal_0c895": "kcal totales",
    "ui.carbsTotal_d2ae4": "glucides totaux",
    "ui.fatTotal_41615": "lipides totaux",
    "ui.proteinTotal_67f44": "protéines totales",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "poids",
    "ui.extraKcal_65a05": "kcal extra",
    "ui.1Db_42565": "1 pc",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker activité catalogue with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Ajouter une activité",
    "ui.activityCsvStructure_c2cbe": "Structure CSV des activités",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for activité imports. kcal/min is facultatif when MET is available.",
    "ui.lanApiServer_2738b": "Serveur API LAN",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Définir un mot de passe serveur facultatif. If it is empty, mobile can synchronisation on your LAN sans authentification; if set, mobile doit utiliser le même mot de passe.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Mot de passe serveur",
    "ui.start_a6122": "Démarrer",
    "ui.stop_11a75": "Arrêter",
    "ui.savePassword_49284": "Enregistrer le mot de passe",
    "ui.restoreBackup_dd06b": "Restaurer une sauvegarde",
    "ui.pairingDetails_d8479": "Détails d’appairage",
    "ui.baseUrl_ade86": "URL de base",
    "ui.sourceId_33735": "ID source",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Canal",
    "ui.connectedDevices_1aee3": "Appareils connectés",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the API LAN in the 5 dernières minutes. The mobile app sends a identité Android lisible instead of the user agent Linux/WebView brut.",
    "ui.startTheLanApiServerTo_231bf": "Démarrer l’API LAN serveur to see connected mobile devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No mobile device has contacted the serveur recently.",
    "ui.mergeSuggestions_3f578": "Suggestions de fusion",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list doublons probables d’aliments, recettes et activités before any synchronisation is involved. Choisis l’élément à conserver, then fusionne le reste dedans, or open an élément and rename it if it is only mal nommé.",
    "ui.mergeAllSelected_07c3e": "Fusionner la sélection",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate catalogue éléments found.",
    "ui.mergeSelected_1f978": "Fusionner sélection",
    "ui.mobileUploadInbox_3476a": "Boîte d’envoi mobile",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobile are sont d’abord préparés ici. Accepte un lot to l’enregistrer sur le serveur. Les ID identiques sont marqués comme remplacements, not duplicates, so mobile edits update the serveur élément instead of en créer un autre.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Masquer les éléments déjà sur desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "La vue par défaut affiche seulement les éléments nouveaux, modifiés et ignorés.",
    "ui.noPendingMobileUploads_7e5ca": "Aucun envoi mobile en attente.",
    "ui.reviewEdit_77e3a": "Vérifier/modifier",
    "ui.recordDraft_685b4": "Enregistrer le brouillon",
    "ui.reject_d98ac": "Rejeter",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "Tous les éléments desktop inchangés sont masqués. Désactive le filtre ci-dessus pour les inspecter.",
    "ui.skip_72ef2": "Ignorer",
    "ui.restore_2bd33": "Restaurer",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "serveur desktop",
    "ui.settings_f4f70": "Paramètres",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Données et récupération",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Enregistrer la fenêtre actuelle",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Exporter ZIP de données",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop catalogue and paramètres sauvegarde.",
    "ui.importDataZip_04e73": "Importer ZIP de données",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Restaurer ingrédients, aliments, recettes, activités and desktop paramètres.",
    "ui.factoryReset_5dcd7": "Réinitialisation",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Supprimer the local desktop catalogue and start setup again.",
    "ui.licenses_f6aca": "Licences",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Confidentialité",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your ingrédient, aliment, recette and activité catalogue locally on this machine. The API LAN is used only by your app mobile appairée on your own network. Aucune analyse, aucune recherche alimentaire publique, aucun compte.",
    "ui.about_8f7f4": "À propos",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the inspiration nutrition open-source axée confidentialité, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the base sur laquelle nutrino est construit.",
    "ui.repository_33fcf": "Dépôt",
    "ui.reportIssue_92fd0": "Signaler un problème",
    "ui.star_26f93": "Étoile",
    "ui.desktopSetup_8dda1": "Configuration desktop",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default Port API LAN and review how nutrino Desktop works before pairing mobile.",
    "ui.lanApiPort_509d9": "Port API LAN",
    "ui.restoreServerFromBackupZip_aafd4": "Restaurer serveur from sauvegarde ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create ingrédients and aliments",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private ingrédient and aliment catalogs.",
    "ui.buildRecipes_f4672": "Créer des recettes",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine aliments into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Modifier le catalogue d’activités",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Démarrer l’API LAN",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair mobile when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls ingrédients, aliments, recettes and activités from this serveur. Les données du journal restent sur le téléphone. You can change startup, tray and sauvegarde paramètres later from Paramètres.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public aliment database, no account, no analytics.",
    "ui.back_0557f": "Retour",
    "ui.next_10ac3": "Suivant",
    "ui.startUsingNutrino_b763a": "Commencer nutrino",
    "ui.catalogQr_0d8f3": "QR catalogue",
    "ui.scanThisWithTheMobileApp_231a6": "Scanner this with the mobile app to review, edit and save the élément locally. Les grandes recettes sont découpées en parties QR numérotées; scanne chaque partie une fois.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The Le premier QR contient le total. Continue until the phone says the recette was imported.",
    "ui.previous_dd1f7": "Précédent",
    "ui.done_f9296": "Terminé",
    "ui.mergeCatalogItem_db2c1": "merge catalogue élément",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the élément to keep",
    "ui.merge_68be4": "Fusionner",
    "ui.close_d3d2e": "Fermer",
    "ui.noMatchingTargetItem_6e9d3": "Aucune cible correspondante.",
    "ui.cancel_ea478": "Annuler",
    "ui.mergeIntoSelected_1a212": "Fusionner dans selected",
    "ui.mobileUploadInbox_5ea98": "mobile upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID remplacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No ingrédients in this upload.",
    "ui.ingredient_59198": "Ingrédient",
    "ui.noFoodsInThisUpload_d06f6": "No aliments in this upload.",
    "ui.food_0a38e": "Aliment",
    "ui.noRecipesInThisUpload_f370c": "No recettes in this upload.",
    "ui.recipe_aef6e": "Recette",
    "ui.noActivitiesInThisUpload_ded76": "No activités in this upload.",
    "ui.activity_ecfc2": "Activité",
    "ui.privateMobileDiaryData_f455b": "Private mobile diary données",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, activité logs and poids logs are ne sont pas importés sur desktop. They restent locaux sur mobile.",
    "ui.skippedItems_66bcb": "Skipped éléments",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the éditeur visuel does not expose a champ nécessaire.",
    "ui.saveDraft_48ca5": "Enregistrer le brouillon",
    "ui.note_3b064": "Note",
    "ui.defaultUnit_81471": "Unité par défaut",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Glucides / 100 g",
    "ui.fat100g_6709a": "Lipides / 100 g",
    "ui.protein100g_bf529": "Protéines / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Marque / source label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Description",
    "ui.extraKcal_70d7d": "Kcal extra",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the ingrédient kcal totales. Les macros restent calculées à partir des ingrédients.",
    "ui.servings_4349e": "Portions",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 pc equals total recette grammes / servings.",
    "ui.noMatchingItem_12f96": "Aucun élément correspondant.",
    "ui.remove_1063e": "Supprimer",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Code",
    "ui.type_a1fa2": "Type",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Rechercher ingrédients by nom, note or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Rechercher aliments by nom, brand, code-barres, note or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Rechercher recettes by nom, description, note or ID...",
    "ui.searchActivityTypeCode_9bb39": "Rechercher activité, type, code...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no mot de passe",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Facultatif; leave empty for no mot de passe",
    "ui.searchByNameIdBrandCode_0c5a3": "Rechercher by nom, ID, brand, code...",
    "ui.ingredientName_cbdf8": "Ingrédient nom",
    "ui.unit_19c56": "Unité",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Aliment nom",
    "ui.brand_1be6f": "Marque",
    "ui.recipeName_23955": "Recette nom",
    "ui.servingsOptional_9fcb2": "Portions (facultatif)",
    "ui.activityName_75c4c": "Activité nom",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Facultatif note, source or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Marque, restaurant, shop or source",
    "ui.optional_ebb06": "Facultatif",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Facultatif note, source, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Facultatif; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Facultatif; empty means the whole recette is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Rechercher aliment, ingrédient or recette...",
    "ui.grams_ca820": "grammes",
    "ui.pieces_6b7e9": "pièces",
    "ui.running_75101": "course",
    "ui.general_95815": "général",
    "ui.desktopSetupSteps_ae24e": "Configuration desktop steps"
  },
  "ru": {
    "nav.dashboard": "Панель",
    "nav.ingredients": "Ингредиенты",
    "nav.foods": "Еда",
    "nav.recipes": "Рецепты",
    "nav.activities": "Активности",
    "nav.server": "Сервер",
    "nav.settings": "Настройки",
    "language": "Язык",
    "languageSearch": "Поиск по английскому названию, родному названию или коду…",
    "translations": "Переводы",
    "addTranslation": "Добавить перевод",
    "translationHint": "Базовое имя обязательно. Локализованные имена добавляются только при необходимости.",
    "noTranslation": "Переводов пока нет.",
    "selectLanguage": "Выбрать язык",
    "nameInLanguage": "Локализованное имя",
    "remove": "Удалить",
    "ui.mergeDialogPrefix": "Объединить",
    "ui.mergeDialogMiddle": "в существующий",
    "ui.mergeDialogSuffix": "You can поиск by название or ID; no need to remember the target ID.",
    "ui.status_24a23": "Статус:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Сервер",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Ингредиенты",
    "ui.avg100g_5f553": "Среднее / 100 г",
    "ui.updated_ff0a3": "Обновлено",
    "ui.foods_9428a": "Еда",
    "ui.recipes_0153a": "Рецепты",
    "ui.activities_d78ed": "Активности",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first локальный architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the ингредиент, еда, рецепт and активность catalogs plus the LAN API. Mobile syncs the каталог, then keeps working from its локальный cache whenever the desktop сервер is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base элементы without brand or штрихкод, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Обновить",
    "ui.importCsv_28ec2": "Импорт CSV",
    "ui.skipDuplicates_6d417": "Пропускать дубликаты",
    "ui.exportCsv_c04f1": "Экспорт CSV",
    "ui.addIngredient_590a4": "Добавить ингредиент",
    "ui.sortByName_deb7e": "Сортировать по названию",
    "ui.sortByKcal_a0e33": "Сортировать по ккал",
    "ui.sortByProtein_30969": "Сортировать по белкам",
    "ui.sortByCarbs_8895f": "Сортировать по углеводам",
    "ui.sortByFat_e8cb8": "Сортировать по жирам",
    "ui.ingredientCsvStructure_bbae0": "Ингредиент CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Ингредиенты are non-branded base materials. They do not have штрихкод or brand columns.",
    "ui.name_49ee3": "Название",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Углеводы",
    "ui.fat_4d09c": "Жиры",
    "ui.protein_7e667": "Белки",
    "ui.actions_06df3": "Действия",
    "ui.ingredientNoBrandBarcode_b87ef": "Ингредиент · no brand/штрихкод",
    "ui.edit_7dce1": "Изменить",
    "ui.mergeInto_f7c29": "Объединить into",
    "ui.moveToFoods_e1a6b": "Move to еда",
    "ui.delete_f2a6c": "Удалить",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, импорт and экспорт concrete branded or источник-specific еда.",
    "ui.addFood_2e2e1": "Добавить еду",
    "ui.foodCsvStructure_f4bb5": "Еда CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample еда are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to ингредиенты",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from еда. Nutrition is calculated from ингредиенты.",
    "ui.addRecipe_39767": "Добавить рецепт",
    "ui.recipeCsvStructure_a4db3": "Рецепт CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Рецепты are imported from a header-only schema plus your own rows. Ингредиенты stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "вес",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker активность каталог with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Добавить активность",
    "ui.activityCsvStructure_c2cbe": "Активность CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for активность imports. kcal/min is необязательно when MET is available.",
    "ui.lanApiServer_2738b": "LAN API сервер",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an необязательно сервер пароль. If it is empty, мобильный can синхронизация on your LAN without auth; if set, мобильный must use the same пароль.",
    "ui.port_60aaf": "Порт",
    "ui.serverPassword_7dfb3": "Пароль сервера",
    "ui.start_a6122": "Старт",
    "ui.stop_11a75": "Стоп",
    "ui.savePassword_49284": "Сохранить пароль",
    "ui.restoreBackup_dd06b": "Восстановить копию",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Подключённые устройства",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The мобильный app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Старт the LAN API сервер to see connected мобильный devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No мобильный device has contacted the сервер recently.",
    "ui.mergeSuggestions_3f578": "Предложения объединения",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate еда, рецепты and активности before any синхронизация is involved. Choose which элемент should stay, then merge the rest into it, or open an элемент and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Объединить all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate каталог элементы found.",
    "ui.mergeSelected_1f978": "Объединить selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from мобильный are staged here first. Accept a batch to record it on the сервер. Matching IDs are highlighted as replacements, not duplicates, so мобильный edits update the сервер элемент instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide элементы already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload элементы.",
    "ui.noPendingMobileUploads_7e5ca": "No ожидает мобильный uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Отклонить",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop элементы are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Пропустить",
    "ui.restore_2bd33": "Восстановить",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop сервер",
    "ui.settings_f4f70": "Настройки",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Данные и восстановление",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Сохранить current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export данные ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop каталог and настройки резервная копия.",
    "ui.importDataZip_04e73": "Import данные ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Восстановить ингредиенты, еда, рецепты, активности and desktop настройки.",
    "ui.factoryReset_5dcd7": "Сброс",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Удалить the локальный desktop каталог and start setup again.",
    "ui.licenses_f6aca": "Лицензии",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Конфиденциальность",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your ингредиент, еда, рецепт and активность каталог locally on this machine. The LAN API is used only by your paired мобильный app on your own network. No analytics, no public еда поиск, no account.",
    "ui.about_8f7f4": "О приложении",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Репозиторий",
    "ui.reportIssue_92fd0": "Сообщить о проблеме",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing мобильный.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Восстановить сервер from резервная копия ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create ингредиенты and еда",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private ингредиент and еда catalogs.",
    "ui.buildRecipes_f4672": "Build рецепты",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine еда into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Изменить активность каталог",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Старт the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair мобильный when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls ингредиенты, еда, рецепты and активности from this сервер. Дневник данные stays on the phone. You can change startup, tray and резервная копия настройки later from Настройки.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public еда database, no account, no analytics.",
    "ui.back_0557f": "Назад",
    "ui.next_10ac3": "Далее",
    "ui.startUsingNutrino_b763a": "Старт using nutrino",
    "ui.catalogQr_0d8f3": "каталог QR",
    "ui.scanThisWithTheMobileApp_231a6": "Сканировать this with the мобильный app to review, edit and save the элемент locally. Large рецепты are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the рецепт was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Готово",
    "ui.mergeCatalogItem_db2c1": "merge каталог элемент",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the элемент to keep",
    "ui.merge_68be4": "Объединить",
    "ui.close_d3d2e": "Закрыть",
    "ui.noMatchingTargetItem_6e9d3": "No matching target элемент.",
    "ui.cancel_ea478": "Отмена",
    "ui.mergeIntoSelected_1a212": "Объединить into selected",
    "ui.mobileUploadInbox_5ea98": "мобильный upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No ингредиенты in this upload.",
    "ui.ingredient_59198": "Ингредиент",
    "ui.noFoodsInThisUpload_d06f6": "No еда in this upload.",
    "ui.food_0a38e": "Еда",
    "ui.noRecipesInThisUpload_f370c": "No рецепты in this upload.",
    "ui.recipe_aef6e": "Рецепт",
    "ui.noActivitiesInThisUpload_ded76": "No активности in this upload.",
    "ui.activity_ecfc2": "Активность",
    "ui.privateMobileDiaryData_f455b": "Private мобильный diary данные",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, активность logs and вес logs are not imported to desktop. They stay локальный on мобильный.",
    "ui.skippedItems_66bcb": "Skipped элементы",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Сохранить черновик",
    "ui.note_3b064": "Заметка",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Углеводы / 100 g",
    "ui.fat100g_6709a": "Жиры / 100 g",
    "ui.protein100g_bf529": "Белки / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Бренд / источник label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Описание",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the ингредиент kcal total. Macros stay calculated from ингредиенты.",
    "ui.servings_4349e": "Порции",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total рецепт граммы / servings.",
    "ui.noMatchingItem_12f96": "Нет совпадений.",
    "ui.remove_1063e": "Удалить",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Код",
    "ui.type_a1fa2": "Тип",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Поиск ингредиенты by название, заметка or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Поиск еда by название, brand, штрихкод, заметка or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Поиск рецепты by название, описание, заметка or ID...",
    "ui.searchActivityTypeCode_9bb39": "Поиск активность, type, код...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no пароль",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Необязательно; leave empty for no пароль",
    "ui.searchByNameIdBrandCode_0c5a3": "Поиск by название, ID, brand, код...",
    "ui.ingredientName_cbdf8": "Ингредиент название",
    "ui.unit_19c56": "Единица",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Еда название",
    "ui.brand_1be6f": "Бренд",
    "ui.recipeName_23955": "Рецепт название",
    "ui.servingsOptional_9fcb2": "Порции (необязательно)",
    "ui.activityName_75c4c": "Активность название",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Необязательно заметка, источник or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Бренд, restaurant, shop or источник",
    "ui.optional_ebb06": "Необязательно",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Необязательно заметка, источник, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Необязательно; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Необязательно; empty means the whole рецепт is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Поиск еда, ингредиент or рецепт...",
    "ui.grams_ca820": "граммы",
    "ui.pieces_6b7e9": "штуки",
    "ui.running_75101": "бег",
    "ui.general_95815": "общее",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "uk": {
    "nav.dashboard": "Панель",
    "nav.ingredients": "Інгредієнти",
    "nav.foods": "Їжа",
    "nav.recipes": "Рецепти",
    "nav.activities": "Активності",
    "nav.server": "Сервер",
    "nav.settings": "Налаштування",
    "language": "Мова",
    "languageSearch": "Пошук за англійською назвою, рідною назвою або кодом…",
    "translations": "Переклади",
    "addTranslation": "Додати переклад",
    "translationHint": "Базова назва обов’язкова. Локалізовані назви додаються лише за потреби.",
    "noTranslation": "Перекладів ще немає.",
    "selectLanguage": "Вибрати мову",
    "nameInLanguage": "Локалізована назва",
    "remove": "Видалити",
    "ui.mergeDialogPrefix": "Об’єднати",
    "ui.mergeDialogMiddle": "в наявний",
    "ui.mergeDialogSuffix": "You can пошук by назва or ID; no need to remember the target ID.",
    "ui.status_24a23": "Статус:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Сервер",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Інгредієнти",
    "ui.avg100g_5f553": "Середнє / 100 г",
    "ui.updated_ff0a3": "Оновлено",
    "ui.foods_9428a": "Їжа",
    "ui.recipes_0153a": "Рецепти",
    "ui.activities_d78ed": "Активності",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first локальний architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the інгредієнт, їжа, рецепт and активність catalogs plus the LAN API. Mobile syncs the каталог, then keeps working from its локальний cache whenever the desktop сервер is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base елементи without brand or штрихкод, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Оновити",
    "ui.importCsv_28ec2": "Імпорт CSV",
    "ui.skipDuplicates_6d417": "Пропускати дублікати",
    "ui.exportCsv_c04f1": "Експорт CSV",
    "ui.addIngredient_590a4": "Додати інгредієнт",
    "ui.sortByName_deb7e": "Сортувати за назвою",
    "ui.sortByKcal_a0e33": "Сортувати за ккал",
    "ui.sortByProtein_30969": "Сортувати за білками",
    "ui.sortByCarbs_8895f": "Сортувати за вуглеводами",
    "ui.sortByFat_e8cb8": "Сортувати за жирами",
    "ui.ingredientCsvStructure_bbae0": "Інгредієнт CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Інгредієнти are non-branded base materials. They do not have штрихкод or brand columns.",
    "ui.name_49ee3": "Назва",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Вуглеводи",
    "ui.fat_4d09c": "Жири",
    "ui.protein_7e667": "Білки",
    "ui.actions_06df3": "Дії",
    "ui.ingredientNoBrandBarcode_b87ef": "Інгредієнт · no brand/штрихкод",
    "ui.edit_7dce1": "Редагувати",
    "ui.mergeInto_f7c29": "Об’єднати into",
    "ui.moveToFoods_e1a6b": "Move to їжа",
    "ui.delete_f2a6c": "Видалити",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, імпорт and експорт concrete branded or джерело-specific їжа.",
    "ui.addFood_2e2e1": "Додати їжу",
    "ui.foodCsvStructure_f4bb5": "Їжа CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample їжа are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to інгредієнти",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from їжа. Nutrition is calculated from інгредієнти.",
    "ui.addRecipe_39767": "Додати рецепт",
    "ui.recipeCsvStructure_a4db3": "Рецепт CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Рецепти are imported from a header-only schema plus your own rows. Інгредієнти stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "вага",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker активність каталог with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Додати активність",
    "ui.activityCsvStructure_c2cbe": "Активність CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for активність imports. kcal/min is необов’язково when MET is available.",
    "ui.lanApiServer_2738b": "LAN API сервер",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an необов’язково сервер пароль. If it is empty, мобільний can синхронізація on your LAN without auth; if set, мобільний must use the same пароль.",
    "ui.port_60aaf": "Порт",
    "ui.serverPassword_7dfb3": "Пароль сервера",
    "ui.start_a6122": "Старт",
    "ui.stop_11a75": "Стоп",
    "ui.savePassword_49284": "Зберегти пароль",
    "ui.restoreBackup_dd06b": "Відновити копію",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Підключені пристрої",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The мобільний app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Старт the LAN API сервер to see connected мобільний devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No мобільний device has contacted the сервер recently.",
    "ui.mergeSuggestions_3f578": "Об’єднати suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate їжа, рецепти and активності before any синхронізація is involved. Choose which елемент should stay, then merge the rest into it, or open an елемент and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Об’єднати all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate каталог елементи found.",
    "ui.mergeSelected_1f978": "Об’єднати selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from мобільний are staged here first. Accept a batch to record it on the сервер. Matching IDs are highlighted as replacements, not duplicates, so мобільний edits update the сервер елемент instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide елементи already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload елементи.",
    "ui.noPendingMobileUploads_7e5ca": "No очікує мобільний uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Відхилити",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop елементи are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Пропустити",
    "ui.restore_2bd33": "Відновити",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop сервер",
    "ui.settings_f4f70": "Налаштування",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Зберегти current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export дані ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop каталог and налаштування резервна копія.",
    "ui.importDataZip_04e73": "Import дані ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Відновити інгредієнти, їжа, рецепти, активності and desktop налаштування.",
    "ui.factoryReset_5dcd7": "Скидання",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Видалити the локальний desktop каталог and start setup again.",
    "ui.licenses_f6aca": "Ліцензії",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Приватність",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your інгредієнт, їжа, рецепт and активність каталог locally on this machine. The LAN API is used only by your paired мобільний app on your own network. No analytics, no public їжа пошук, no account.",
    "ui.about_8f7f4": "Про застосунок",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing мобільний.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Відновити сервер from резервна копія ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create інгредієнти and їжа",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private інгредієнт and їжа catalogs.",
    "ui.buildRecipes_f4672": "Build рецепти",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine їжа into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Редагувати активність каталог",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Старт the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair мобільний when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls інгредієнти, їжа, рецепти and активності from this сервер. Щоденник дані stays on the phone. You can change startup, tray and резервна копія налаштування later from Налаштування.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public їжа database, no account, no analytics.",
    "ui.back_0557f": "Назад",
    "ui.next_10ac3": "Далі",
    "ui.startUsingNutrino_b763a": "Старт using nutrino",
    "ui.catalogQr_0d8f3": "каталог QR",
    "ui.scanThisWithTheMobileApp_231a6": "Сканувати this with the мобільний app to review, edit and save the елемент locally. Large рецепти are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the рецепт was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Готово",
    "ui.mergeCatalogItem_db2c1": "merge каталог елемент",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the елемент to keep",
    "ui.merge_68be4": "Об’єднати",
    "ui.close_d3d2e": "Закрити",
    "ui.noMatchingTargetItem_6e9d3": "No matching target елемент.",
    "ui.cancel_ea478": "Скасувати",
    "ui.mergeIntoSelected_1a212": "Об’єднати into selected",
    "ui.mobileUploadInbox_5ea98": "мобільний upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No інгредієнти in this upload.",
    "ui.ingredient_59198": "Інгредієнт",
    "ui.noFoodsInThisUpload_d06f6": "No їжа in this upload.",
    "ui.food_0a38e": "Їжа",
    "ui.noRecipesInThisUpload_f370c": "No рецепти in this upload.",
    "ui.recipe_aef6e": "Рецепт",
    "ui.noActivitiesInThisUpload_ded76": "No активності in this upload.",
    "ui.activity_ecfc2": "Активність",
    "ui.privateMobileDiaryData_f455b": "Private мобільний diary дані",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, активність logs and вага logs are not imported to desktop. They stay локальний on мобільний.",
    "ui.skippedItems_66bcb": "Skipped елементи",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Зберегти draft",
    "ui.note_3b064": "Нотатка",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Вуглеводи / 100 g",
    "ui.fat100g_6709a": "Жири / 100 g",
    "ui.protein100g_bf529": "Білки / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Бренд / джерело label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Опис",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the інгредієнт kcal total. Macros stay calculated from інгредієнти.",
    "ui.servings_4349e": "Порції",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total рецепт грами / servings.",
    "ui.noMatchingItem_12f96": "Немає збігів.",
    "ui.remove_1063e": "Видалити",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Код",
    "ui.type_a1fa2": "Тип",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Пошук інгредієнти by назва, нотатка or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Пошук їжа by назва, brand, штрихкод, нотатка or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Пошук рецепти by назва, опис, нотатка or ID...",
    "ui.searchActivityTypeCode_9bb39": "Пошук активність, type, код...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no пароль",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Необов’язково; leave empty for no пароль",
    "ui.searchByNameIdBrandCode_0c5a3": "Пошук by назва, ID, brand, код...",
    "ui.ingredientName_cbdf8": "Інгредієнт назва",
    "ui.unit_19c56": "Одиниця",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Їжа назва",
    "ui.brand_1be6f": "Бренд",
    "ui.recipeName_23955": "Рецепт назва",
    "ui.servingsOptional_9fcb2": "Порції (необов’язково)",
    "ui.activityName_75c4c": "Активність назва",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Необов’язково нотатка, джерело or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Бренд, restaurant, shop or джерело",
    "ui.optional_ebb06": "Необов’язково",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Необов’язково нотатка, джерело, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Необов’язково; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Необов’язково; empty means the whole рецепт is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Пошук їжа, інгредієнт or рецепт...",
    "ui.grams_ca820": "грами",
    "ui.pieces_6b7e9": "штуки",
    "ui.running_75101": "біг",
    "ui.general_95815": "загальне",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "zh": {
    "nav.dashboard": "概览",
    "nav.ingredients": "配料",
    "nav.foods": "食物",
    "nav.recipes": "食谱",
    "nav.activities": "活动",
    "nav.server": "服务器",
    "nav.settings": "设置",
    "language": "语言",
    "languageSearch": "按英文名、本地名或代码搜索语言…",
    "translations": "翻译",
    "addTranslation": "添加翻译",
    "translationHint": "基础名称仍为必填。仅在需要时添加本地化名称。",
    "noTranslation": "尚未添加翻译。",
    "selectLanguage": "选择语言",
    "nameInLanguage": "本地化名称",
    "remove": "移除",
    "ui.mergeDialogPrefix": "合并",
    "ui.mergeDialogMiddle": "到现有项",
    "ui.mergeDialogSuffix": "You can 搜索 by 名称 or ID; no need to remember the target ID.",
    "ui.status_24a23": "状态：",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop 服务器",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "配料",
    "ui.avg100g_5f553": "平均 / 100克",
    "ui.updated_ff0a3": "已更新",
    "ui.foods_9428a": "食物",
    "ui.recipes_0153a": "食谱",
    "ui.activities_d78ed": "活动",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first 本地 architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This 桌面端 app owns the 配料, 食物, 食谱 and 活动 catalogs plus the LAN API. Mobile syncs the 目录, then keeps working from its 本地 cache whenever the 桌面端 服务器 is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base 项目 without brand or 条码, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "刷新",
    "ui.importCsv_28ec2": "导入 CSV",
    "ui.skipDuplicates_6d417": "跳过重复项",
    "ui.exportCsv_c04f1": "导出 CSV",
    "ui.addIngredient_590a4": "添加配料",
    "ui.sortByName_deb7e": "按名称排序",
    "ui.sortByKcal_a0e33": "按 kcal 排序",
    "ui.sortByProtein_30969": "按蛋白质排序",
    "ui.sortByCarbs_8895f": "按碳水排序",
    "ui.sortByFat_e8cb8": "按脂肪排序",
    "ui.ingredientCsvStructure_bbae0": "配料 CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "配料 are non-branded base materials. They do not have 条码 or brand columns.",
    "ui.name_49ee3": "名称",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "碳水",
    "ui.fat_4d09c": "脂肪",
    "ui.protein_7e667": "蛋白质",
    "ui.actions_06df3": "操作",
    "ui.ingredientNoBrandBarcode_b87ef": "配料 · no brand/条码",
    "ui.edit_7dce1": "编辑",
    "ui.mergeInto_f7c29": "合并 into",
    "ui.moveToFoods_e1a6b": "Move to 食物",
    "ui.delete_f2a6c": "删除",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, 导入 and 导出 concrete branded or 来源-specific 食物.",
    "ui.addFood_2e2e1": "添加食物",
    "ui.foodCsvStructure_f4bb5": "食物 CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample 食物 are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to 配料",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from 食物. Nutrition is calculated from 配料.",
    "ui.addRecipe_39767": "添加食谱",
    "ui.recipeCsvStructure_a4db3": "食谱 CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "食谱 are imported from a header-only schema plus your own rows. 配料 stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "体重",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker 活动 目录 with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "添加活动",
    "ui.activityCsvStructure_c2cbe": "活动 CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for 活动 imports. kcal/min is 可选 when MET is available.",
    "ui.lanApiServer_2738b": "LAN API 服务器",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an 可选 服务器 密码. If it is empty, 移动端 can 同步 on your LAN without auth; if set, 移动端 must use the same 密码.",
    "ui.port_60aaf": "端口",
    "ui.serverPassword_7dfb3": "服务器密码",
    "ui.start_a6122": "启动",
    "ui.stop_11a75": "停止",
    "ui.savePassword_49284": "保存密码",
    "ui.restoreBackup_dd06b": "恢复备份",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "已连接设备",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The 移动端 app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "启动 the LAN API 服务器 to see connected 移动端 devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No 移动端 device has contacted the 服务器 recently.",
    "ui.mergeSuggestions_3f578": "合并 suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate 食物, 食谱 and 活动 before any 同步 is involved. Choose which 项目 should stay, then merge the rest into it, or open an 项目 and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "合并 all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate 目录 项目 found.",
    "ui.mergeSelected_1f978": "合并 selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from 移动端 are staged here first. Accept a batch to record it on the 服务器. Matching IDs are highlighted as replacements, not duplicates, so 移动端 edits update the 服务器 项目 instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide 项目 already on 桌面端",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload 项目.",
    "ui.noPendingMobileUploads_7e5ca": "No 待处理 移动端 uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "拒绝",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged 桌面端 项目 are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "跳过",
    "ui.restore_2bd33": "恢复",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "桌面端 服务器",
    "ui.settings_f4f70": "设置",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "保存 current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export 数据 ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a 桌面端 目录 and 设置 备份.",
    "ui.importDataZip_04e73": "Import 数据 ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "恢复 配料, 食物, 食谱, 活动 and 桌面端 设置.",
    "ui.factoryReset_5dcd7": "恢复出厂",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "删除 the 本地 桌面端 目录 and start setup again.",
    "ui.licenses_f6aca": "许可证",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "隐私",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your 配料, 食物, 食谱 and 活动 目录 locally on this machine. The LAN API is used only by your paired 移动端 app on your own network. No analytics, no public 食物 搜索, no account.",
    "ui.about_8f7f4": "关于",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing 移动端.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "恢复 服务器 from 备份 ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create 配料 and 食物",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private 配料 and 食物 catalogs.",
    "ui.buildRecipes_f4672": "Build 食谱",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine 食物 into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "编辑 活动 目录",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "启动 the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair 移动端 when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls 配料, 食物, 食谱 and 活动 from this 服务器. 日记 数据 stays on the phone. You can change startup, tray and 备份 设置 later from 设置.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public 食物 database, no account, no analytics.",
    "ui.back_0557f": "返回",
    "ui.next_10ac3": "下一步",
    "ui.startUsingNutrino_b763a": "启动 using nutrino",
    "ui.catalogQr_0d8f3": "目录 QR",
    "ui.scanThisWithTheMobileApp_231a6": "扫描 this with the 移动端 app to review, edit and save the 项目 locally. Large 食谱 are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the 食谱 was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "完成",
    "ui.mergeCatalogItem_db2c1": "merge 目录 项目",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the 项目 to keep",
    "ui.merge_68be4": "合并",
    "ui.close_d3d2e": "关闭",
    "ui.noMatchingTargetItem_6e9d3": "No matching target 项目.",
    "ui.cancel_ea478": "取消",
    "ui.mergeIntoSelected_1a212": "合并 into selected",
    "ui.mobileUploadInbox_5ea98": "移动端 upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No 配料 in this upload.",
    "ui.ingredient_59198": "配料",
    "ui.noFoodsInThisUpload_d06f6": "No 食物 in this upload.",
    "ui.food_0a38e": "食物",
    "ui.noRecipesInThisUpload_f370c": "No 食谱 in this upload.",
    "ui.recipe_aef6e": "食谱",
    "ui.noActivitiesInThisUpload_ded76": "No 活动 in this upload.",
    "ui.activity_ecfc2": "活动",
    "ui.privateMobileDiaryData_f455b": "Private 移动端 diary 数据",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, 活动 logs and 体重 logs are not imported to 桌面端. They stay 本地 on 移动端.",
    "ui.skippedItems_66bcb": "Skipped 项目",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "保存 draft",
    "ui.note_3b064": "备注",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "碳水 / 100 g",
    "ui.fat100g_6709a": "脂肪 / 100 g",
    "ui.protein100g_bf529": "蛋白质 / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "品牌 / 来源 label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "描述",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the 配料 kcal total. Macros stay calculated from 配料.",
    "ui.servings_4349e": "份数",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total 食谱 克 / servings.",
    "ui.noMatchingItem_12f96": "没有匹配项。",
    "ui.remove_1063e": "移除",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "代码",
    "ui.type_a1fa2": "类型",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "搜索 配料 by 名称, 备注 or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "搜索 食物 by 名称, brand, 条码, 备注 or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "搜索 食谱 by 名称, 描述, 备注 or ID...",
    "ui.searchActivityTypeCode_9bb39": "搜索 活动, type, 代码...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no 密码",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "可选; leave empty for no 密码",
    "ui.searchByNameIdBrandCode_0c5a3": "搜索 by 名称, ID, brand, 代码...",
    "ui.ingredientName_cbdf8": "配料 名称",
    "ui.unit_19c56": "单位",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "食物 名称",
    "ui.brand_1be6f": "品牌",
    "ui.recipeName_23955": "食谱 名称",
    "ui.servingsOptional_9fcb2": "份数 (可选)",
    "ui.activityName_75c4c": "活动 名称",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "可选 备注, 来源 or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "品牌, restaurant, shop or 来源",
    "ui.optional_ebb06": "可选",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "可选 备注, 来源, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "可选; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "可选; empty means the whole 食谱 is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "搜索 食物, 配料 or 食谱...",
    "ui.grams_ca820": "克",
    "ui.pieces_6b7e9": "件",
    "ui.running_75101": "跑步",
    "ui.general_95815": "通用",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "sk": {
    "nav.dashboard": "Prehľad",
    "nav.ingredients": "Suroviny",
    "nav.foods": "Jedlá",
    "nav.recipes": "Recepty",
    "nav.activities": "Aktivity",
    "nav.server": "Server",
    "nav.settings": "Nastavenia",
    "language": "Jazyk",
    "languageSearch": "Hľadať podľa anglického názvu, vlastného názvu alebo kódu…",
    "translations": "Preklady",
    "addTranslation": "Pridať preklad",
    "translationHint": "Základný názov je povinný. Lokalizované názvy pridaj iba podľa potreby.",
    "noTranslation": "Zatiaľ žiadne preklady.",
    "selectLanguage": "Vybrať jazyk",
    "nameInLanguage": "Lokalizovaný názov",
    "remove": "Odstrániť",
    "ui.mergeDialogPrefix": "Zlúčiť",
    "ui.mergeDialogMiddle": "do existujúceho",
    "ui.mergeDialogSuffix": "You can hľadať by názov or ID; no need to remember the target ID.",
    "ui.status_24a23": "Stav:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Server",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Suroviny",
    "ui.avg100g_5f553": "Priemer / 100 g",
    "ui.updated_ff0a3": "Aktualizované",
    "ui.foods_9428a": "Jedlá",
    "ui.recipes_0153a": "Recepty",
    "ui.activities_d78ed": "Aktivity",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first lokálne architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the surovina, jedlo, recept and aktivita catalogs plus the LAN API. Mobile syncs the katalóg, then keeps working from its lokálne cache whenever the desktop server is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base položky without brand or čiarový kód, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Obnoviť",
    "ui.importCsv_28ec2": "Import CSV",
    "ui.skipDuplicates_6d417": "Preskočiť duplicity",
    "ui.exportCsv_c04f1": "Export CSV",
    "ui.addIngredient_590a4": "Pridať surovinu",
    "ui.sortByName_deb7e": "Zoradiť podľa názvu",
    "ui.sortByKcal_a0e33": "Zoradiť podľa kcal",
    "ui.sortByProtein_30969": "Zoradiť podľa bielkovín",
    "ui.sortByCarbs_8895f": "Zoradiť podľa sacharidov",
    "ui.sortByFat_e8cb8": "Zoradiť podľa tuku",
    "ui.ingredientCsvStructure_bbae0": "Surovina CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Suroviny are non-branded base materials. They do not have čiarový kód or brand columns.",
    "ui.name_49ee3": "Názov",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Sacharidy",
    "ui.fat_4d09c": "Tuk",
    "ui.protein_7e667": "Bielkoviny",
    "ui.actions_06df3": "Akcie",
    "ui.ingredientNoBrandBarcode_b87ef": "Surovina · no brand/čiarový kód",
    "ui.edit_7dce1": "Upraviť",
    "ui.mergeInto_f7c29": "Zlúčiť into",
    "ui.moveToFoods_e1a6b": "Move to jedlá",
    "ui.delete_f2a6c": "Vymazať",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, import and export concrete branded or zdroj-specific jedlá.",
    "ui.addFood_2e2e1": "Pridať jedlo",
    "ui.foodCsvStructure_f4bb5": "Jedlo CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample jedlá are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to suroviny",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from jedlá. Nutrition is calculated from suroviny.",
    "ui.addRecipe_39767": "Pridať recept",
    "ui.recipeCsvStructure_a4db3": "Recept CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Recepty are imported from a header-only schema plus your own rows. Suroviny stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "hmotnosť",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker aktivita katalóg with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Pridať aktivitu",
    "ui.activityCsvStructure_c2cbe": "Aktivita CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for aktivita imports. kcal/min is voliteľné when MET is available.",
    "ui.lanApiServer_2738b": "LAN API server",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an voliteľné server heslo. If it is empty, mobil can synchronizácia on your LAN without auth; if set, mobil must use the same heslo.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Heslo servera",
    "ui.start_a6122": "Spustiť",
    "ui.stop_11a75": "Zastaviť",
    "ui.savePassword_49284": "Uložiť heslo",
    "ui.restoreBackup_dd06b": "Obnoviť zálohu",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Pripojené zariadenia",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The mobil app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Spustiť the LAN API server to see connected mobil devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No mobil device has contacted the server recently.",
    "ui.mergeSuggestions_3f578": "Zlúčiť suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate jedlá, recepty and aktivity before any synchronizácia is involved. Choose which položka should stay, then merge the rest into it, or open an položka and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Zlúčiť all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate katalóg položky found.",
    "ui.mergeSelected_1f978": "Zlúčiť selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobil are staged here first. Accept a batch to record it on the server. Matching IDs are highlighted as replacements, not duplicates, so mobil edits update the server položka instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide položky already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload položky.",
    "ui.noPendingMobileUploads_7e5ca": "No čaká mobil uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Odmietnuť",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop položky are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Preskočiť",
    "ui.restore_2bd33": "Obnoviť",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop server",
    "ui.settings_f4f70": "Nastavenia",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Uložiť current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export údaje ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop katalóg and nastavenia záloha.",
    "ui.importDataZip_04e73": "Import údaje ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Obnoviť suroviny, jedlá, recepty, aktivity and desktop nastavenia.",
    "ui.factoryReset_5dcd7": "Obnovenie nastavení",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Vymazať the lokálne desktop katalóg and start setup again.",
    "ui.licenses_f6aca": "Licencie",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Súkromie",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your surovina, jedlo, recept and aktivita katalóg locally on this machine. The LAN API is used only by your paired mobil app on your own network. No analytics, no public jedlo hľadať, no account.",
    "ui.about_8f7f4": "O aplikácii",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing mobil.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Obnoviť server from záloha ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create suroviny and jedlá",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private surovina and jedlo catalogs.",
    "ui.buildRecipes_f4672": "Build recepty",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine jedlá into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Upraviť aktivita katalóg",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Spustiť the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair mobil when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls suroviny, jedlá, recepty and aktivity from this server. Denník údaje stays on the phone. You can change startup, tray and záloha nastavenia later from Nastavenia.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public jedlo database, no account, no analytics.",
    "ui.back_0557f": "Späť",
    "ui.next_10ac3": "Ďalej",
    "ui.startUsingNutrino_b763a": "Spustiť using nutrino",
    "ui.catalogQr_0d8f3": "katalóg QR",
    "ui.scanThisWithTheMobileApp_231a6": "Skenovať this with the mobil app to review, edit and save the položka locally. Large recepty are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the recept was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Hotovo",
    "ui.mergeCatalogItem_db2c1": "merge katalóg položka",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the položka to keep",
    "ui.merge_68be4": "Zlúčiť",
    "ui.close_d3d2e": "Zavrieť",
    "ui.noMatchingTargetItem_6e9d3": "No matching target položka.",
    "ui.cancel_ea478": "Zrušiť",
    "ui.mergeIntoSelected_1a212": "Zlúčiť into selected",
    "ui.mobileUploadInbox_5ea98": "mobil upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No suroviny in this upload.",
    "ui.ingredient_59198": "Surovina",
    "ui.noFoodsInThisUpload_d06f6": "No jedlá in this upload.",
    "ui.food_0a38e": "Jedlo",
    "ui.noRecipesInThisUpload_f370c": "No recepty in this upload.",
    "ui.recipe_aef6e": "Recept",
    "ui.noActivitiesInThisUpload_ded76": "No aktivity in this upload.",
    "ui.activity_ecfc2": "Aktivita",
    "ui.privateMobileDiaryData_f455b": "Private mobil diary údaje",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, aktivita logs and hmotnosť logs are not imported to desktop. They stay lokálne on mobil.",
    "ui.skippedItems_66bcb": "Skipped položky",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Uložiť draft",
    "ui.note_3b064": "Poznámka",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Sacharidy / 100 g",
    "ui.fat100g_6709a": "Tuk / 100 g",
    "ui.protein100g_bf529": "Bielkoviny / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Značka / zdroj label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Popis",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the surovina kcal total. Macros stay calculated from suroviny.",
    "ui.servings_4349e": "Porcie",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total recept gramy / servings.",
    "ui.noMatchingItem_12f96": "Žiadna zhoda.",
    "ui.remove_1063e": "Odstrániť",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Kód",
    "ui.type_a1fa2": "Typ",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Hľadať suroviny by názov, poznámka or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Hľadať jedlá by názov, brand, čiarový kód, poznámka or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Hľadať recepty by názov, popis, poznámka or ID...",
    "ui.searchActivityTypeCode_9bb39": "Hľadať aktivita, type, kód...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no heslo",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Voliteľné; leave empty for no heslo",
    "ui.searchByNameIdBrandCode_0c5a3": "Hľadať by názov, ID, brand, kód...",
    "ui.ingredientName_cbdf8": "Surovina názov",
    "ui.unit_19c56": "Jednotka",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Jedlo názov",
    "ui.brand_1be6f": "Značka",
    "ui.recipeName_23955": "Recept názov",
    "ui.servingsOptional_9fcb2": "Porcie (voliteľné)",
    "ui.activityName_75c4c": "Aktivita názov",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Voliteľné poznámka, zdroj or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Značka, restaurant, shop or zdroj",
    "ui.optional_ebb06": "Voliteľné",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Voliteľné poznámka, zdroj, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Voliteľné; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Voliteľné; empty means the whole recept is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Hľadať jedlo, surovina or recept...",
    "ui.grams_ca820": "gramy",
    "ui.pieces_6b7e9": "kusy",
    "ui.running_75101": "beh",
    "ui.general_95815": "všeobecné",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "ro": {
    "nav.dashboard": "Panou",
    "nav.ingredients": "Ingrediente",
    "nav.foods": "Alimente",
    "nav.recipes": "Rețete",
    "nav.activities": "Activități",
    "nav.server": "Server",
    "nav.settings": "Setări",
    "language": "Limbă",
    "languageSearch": "Caută după nume englezesc, nume nativ sau cod…",
    "translations": "Traduceri",
    "addTranslation": "Adaugă traducere",
    "translationHint": "Numele de bază rămâne obligatoriu. Adaugă nume localizate doar când este necesar.",
    "noTranslation": "Nu există traduceri încă.",
    "selectLanguage": "Selectează limba",
    "nameInLanguage": "Nume localizat",
    "remove": "Elimină",
    "ui.mergeDialogPrefix": "Îmbină",
    "ui.mergeDialogMiddle": "într-un element existent",
    "ui.mergeDialogSuffix": "You can caută by nume or ID; no need to remember the target ID.",
    "ui.status_24a23": "Stare:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Server",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Ingrediente",
    "ui.avg100g_5f553": "Medie / 100 g",
    "ui.updated_ff0a3": "Actualizat",
    "ui.foods_9428a": "Alimente",
    "ui.recipes_0153a": "Rețete",
    "ui.activities_d78ed": "Activități",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first local architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the ingredient, aliment, rețetă and activitate catalogs plus the LAN API. Mobile syncs the catalog, then keeps working from its local cache whenever the desktop server is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base elemente without brand or cod de bare, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Reîmprospătează",
    "ui.importCsv_28ec2": "Importă CSV",
    "ui.skipDuplicates_6d417": "Omite duplicatele",
    "ui.exportCsv_c04f1": "Exportă CSV",
    "ui.addIngredient_590a4": "Adaugă ingredient",
    "ui.sortByName_deb7e": "Sortează după nume",
    "ui.sortByKcal_a0e33": "Sortează după kcal",
    "ui.sortByProtein_30969": "Sortează după proteine",
    "ui.sortByCarbs_8895f": "Sortează după carbohidrați",
    "ui.sortByFat_e8cb8": "Sortează după grăsimi",
    "ui.ingredientCsvStructure_bbae0": "Ingredient CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Ingrediente are non-branded base materials. They do not have cod de bare or brand columns.",
    "ui.name_49ee3": "Nume",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Carbohidrați",
    "ui.fat_4d09c": "Grăsimi",
    "ui.protein_7e667": "Proteine",
    "ui.actions_06df3": "Acțiuni",
    "ui.ingredientNoBrandBarcode_b87ef": "Ingredient · no brand/cod de bare",
    "ui.edit_7dce1": "Editează",
    "ui.mergeInto_f7c29": "Îmbină into",
    "ui.moveToFoods_e1a6b": "Move to alimente",
    "ui.delete_f2a6c": "Șterge",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, import and export concrete branded or sursă-specific alimente.",
    "ui.addFood_2e2e1": "Adaugă aliment",
    "ui.foodCsvStructure_f4bb5": "Aliment CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample alimente are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to ingrediente",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from alimente. Nutrition is calculated from ingrediente.",
    "ui.addRecipe_39767": "Adaugă rețetă",
    "ui.recipeCsvStructure_a4db3": "Rețetă CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Rețete are imported from a header-only schema plus your own rows. Ingrediente stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "greutate",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker activitate catalog with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Adaugă activitate",
    "ui.activityCsvStructure_c2cbe": "Activitate CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for activitate imports. kcal/min is opțional when MET is available.",
    "ui.lanApiServer_2738b": "LAN API server",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an opțional server parolă. If it is empty, mobil can sincronizare on your LAN without auth; if set, mobil must use the same parolă.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Parolă server",
    "ui.start_a6122": "Pornește",
    "ui.stop_11a75": "Oprește",
    "ui.savePassword_49284": "Salvează parola",
    "ui.restoreBackup_dd06b": "Restaurează backup",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Dispozitive conectate",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The mobil app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Pornește the LAN API server to see connected mobil devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No mobil device has contacted the server recently.",
    "ui.mergeSuggestions_3f578": "Îmbină suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate alimente, rețete and activități before any sincronizare is involved. Choose which element should stay, then merge the rest into it, or open an element and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Îmbină all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate catalog elemente found.",
    "ui.mergeSelected_1f978": "Îmbină selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobil are staged here first. Accept a batch to record it on the server. Matching IDs are highlighted as replacements, not duplicates, so mobil edits update the server element instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide elemente already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload elemente.",
    "ui.noPendingMobileUploads_7e5ca": "No în așteptare mobil uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Respinge",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop elemente are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Omite",
    "ui.restore_2bd33": "Restaurează",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop server",
    "ui.settings_f4f70": "Setări",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Salvează current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export date ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop catalog and setări backup.",
    "ui.importDataZip_04e73": "Import date ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Restaurează ingrediente, alimente, rețete, activități and desktop setări.",
    "ui.factoryReset_5dcd7": "Resetare completă",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Șterge the local desktop catalog and start setup again.",
    "ui.licenses_f6aca": "Licențe",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Confidențialitate",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your ingredient, aliment, rețetă and activitate catalog locally on this machine. The LAN API is used only by your paired mobil app on your own network. No analytics, no public aliment caută, no account.",
    "ui.about_8f7f4": "Despre",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing mobil.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Restaurează server from backup ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create ingrediente and alimente",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private ingredient and aliment catalogs.",
    "ui.buildRecipes_f4672": "Build rețete",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine alimente into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Editează activitate catalog",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Pornește the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair mobil when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls ingrediente, alimente, rețete and activități from this server. Jurnal date stays on the phone. You can change startup, tray and backup setări later from Setări.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public aliment database, no account, no analytics.",
    "ui.back_0557f": "Înapoi",
    "ui.next_10ac3": "Înainte",
    "ui.startUsingNutrino_b763a": "Pornește using nutrino",
    "ui.catalogQr_0d8f3": "catalog QR",
    "ui.scanThisWithTheMobileApp_231a6": "Scanează this with the mobil app to review, edit and save the element locally. Large rețete are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the rețetă was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Gata",
    "ui.mergeCatalogItem_db2c1": "merge catalog element",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the element to keep",
    "ui.merge_68be4": "Îmbină",
    "ui.close_d3d2e": "Închide",
    "ui.noMatchingTargetItem_6e9d3": "No matching target element.",
    "ui.cancel_ea478": "Anulează",
    "ui.mergeIntoSelected_1a212": "Îmbină into selected",
    "ui.mobileUploadInbox_5ea98": "mobil upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No ingrediente in this upload.",
    "ui.ingredient_59198": "Ingredient",
    "ui.noFoodsInThisUpload_d06f6": "No alimente in this upload.",
    "ui.food_0a38e": "Aliment",
    "ui.noRecipesInThisUpload_f370c": "No rețete in this upload.",
    "ui.recipe_aef6e": "Rețetă",
    "ui.noActivitiesInThisUpload_ded76": "No activități in this upload.",
    "ui.activity_ecfc2": "Activitate",
    "ui.privateMobileDiaryData_f455b": "Private mobil diary date",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, activitate logs and greutate logs are not imported to desktop. They stay local on mobil.",
    "ui.skippedItems_66bcb": "Skipped elemente",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Salvează draft",
    "ui.note_3b064": "Notă",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Carbohidrați / 100 g",
    "ui.fat100g_6709a": "Grăsimi / 100 g",
    "ui.protein100g_bf529": "Proteine / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Marcă / sursă label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Descriere",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the ingredient kcal total. Macros stay calculated from ingrediente.",
    "ui.servings_4349e": "Porții",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total rețetă grame / servings.",
    "ui.noMatchingItem_12f96": "Niciun element potrivit.",
    "ui.remove_1063e": "Elimină",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Cod",
    "ui.type_a1fa2": "Tip",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Caută ingrediente by nume, notă or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Caută alimente by nume, brand, cod de bare, notă or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Caută rețete by nume, descriere, notă or ID...",
    "ui.searchActivityTypeCode_9bb39": "Caută activitate, type, cod...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no parolă",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Opțional; leave empty for no parolă",
    "ui.searchByNameIdBrandCode_0c5a3": "Caută by nume, ID, brand, cod...",
    "ui.ingredientName_cbdf8": "Ingredient nume",
    "ui.unit_19c56": "Unitate",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Aliment nume",
    "ui.brand_1be6f": "Marcă",
    "ui.recipeName_23955": "Rețetă nume",
    "ui.servingsOptional_9fcb2": "Porții (opțional)",
    "ui.activityName_75c4c": "Activitate nume",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Opțional notă, sursă or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Marcă, restaurant, shop or sursă",
    "ui.optional_ebb06": "Opțional",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Opțional notă, sursă, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Opțional; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Opțional; empty means the whole rețetă is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Caută aliment, ingredient or rețetă...",
    "ui.grams_ca820": "grame",
    "ui.pieces_6b7e9": "bucăți",
    "ui.running_75101": "alergare",
    "ui.general_95815": "general",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "cs": {
    "nav.dashboard": "Přehled",
    "nav.ingredients": "Suroviny",
    "nav.foods": "Jídla",
    "nav.recipes": "Recepty",
    "nav.activities": "Aktivity",
    "nav.server": "Server",
    "nav.settings": "Nastavení",
    "language": "Jazyk",
    "languageSearch": "Hledat podle anglického názvu, vlastního názvu nebo kódu…",
    "translations": "Překlady",
    "addTranslation": "Přidat překlad",
    "translationHint": "Základní název je povinný. Lokalizované názvy přidávej jen podle potřeby.",
    "noTranslation": "Zatím nejsou přidány překlady.",
    "selectLanguage": "Vybrat jazyk",
    "nameInLanguage": "Lokalizovaný název",
    "remove": "Odebrat",
    "ui.mergeDialogPrefix": "Sloučit",
    "ui.mergeDialogMiddle": "do existujícího",
    "ui.mergeDialogSuffix": "You can hledat by název or ID; no need to remember the target ID.",
    "ui.status_24a23": "Stav:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Server",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Suroviny",
    "ui.avg100g_5f553": "Průměr / 100 g",
    "ui.updated_ff0a3": "Aktualizováno",
    "ui.foods_9428a": "Jídla",
    "ui.recipes_0153a": "Recepty",
    "ui.activities_d78ed": "Aktivity",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first místní architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the surovina, jídlo, recept and aktivita catalogs plus the LAN API. Mobile syncs the katalog, then keeps working from its místní cache whenever the desktop server is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base položky without brand or čárový kód, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Obnovit",
    "ui.importCsv_28ec2": "Import CSV",
    "ui.skipDuplicates_6d417": "Přeskočit duplicity",
    "ui.exportCsv_c04f1": "Export CSV",
    "ui.addIngredient_590a4": "Přidat surovinu",
    "ui.sortByName_deb7e": "Seřadit podle názvu",
    "ui.sortByKcal_a0e33": "Seřadit podle kcal",
    "ui.sortByProtein_30969": "Seřadit podle bílkovin",
    "ui.sortByCarbs_8895f": "Seřadit podle sacharidů",
    "ui.sortByFat_e8cb8": "Seřadit podle tuku",
    "ui.ingredientCsvStructure_bbae0": "Surovina CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Suroviny are non-branded base materials. They do not have čárový kód or brand columns.",
    "ui.name_49ee3": "Název",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Sacharidy",
    "ui.fat_4d09c": "Tuk",
    "ui.protein_7e667": "Bílkoviny",
    "ui.actions_06df3": "Akce",
    "ui.ingredientNoBrandBarcode_b87ef": "Surovina · no brand/čárový kód",
    "ui.edit_7dce1": "Upravit",
    "ui.mergeInto_f7c29": "Sloučit into",
    "ui.moveToFoods_e1a6b": "Move to jídla",
    "ui.delete_f2a6c": "Smazat",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, import and export concrete branded or zdroj-specific jídla.",
    "ui.addFood_2e2e1": "Přidat jídlo",
    "ui.foodCsvStructure_f4bb5": "Jídlo CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample jídla are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to suroviny",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from jídla. Nutrition is calculated from suroviny.",
    "ui.addRecipe_39767": "Přidat recept",
    "ui.recipeCsvStructure_a4db3": "Recept CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Recepty are imported from a header-only schema plus your own rows. Suroviny stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "hmotnost",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker aktivita katalog with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Přidat aktivitu",
    "ui.activityCsvStructure_c2cbe": "Aktivita CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for aktivita imports. kcal/min is volitelné when MET is available.",
    "ui.lanApiServer_2738b": "LAN API server",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an volitelné server heslo. If it is empty, mobil can synchronizace on your LAN without auth; if set, mobil must use the same heslo.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Heslo serveru",
    "ui.start_a6122": "Spustit",
    "ui.stop_11a75": "Zastavit",
    "ui.savePassword_49284": "Uložit heslo",
    "ui.restoreBackup_dd06b": "Obnovit zálohu",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Připojená zařízení",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The mobil app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Spustit the LAN API server to see connected mobil devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No mobil device has contacted the server recently.",
    "ui.mergeSuggestions_3f578": "Sloučit suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate jídla, recepty and aktivity before any synchronizace is involved. Choose which položka should stay, then merge the rest into it, or open an položka and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Sloučit all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate katalog položky found.",
    "ui.mergeSelected_1f978": "Sloučit selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobil are staged here first. Accept a batch to record it on the server. Matching IDs are highlighted as replacements, not duplicates, so mobil edits update the server položka instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide položky already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload položky.",
    "ui.noPendingMobileUploads_7e5ca": "No čeká mobil uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Odmítnout",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop položky are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Přeskočit",
    "ui.restore_2bd33": "Obnovit",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop server",
    "ui.settings_f4f70": "Nastavení",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Uložit current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export data ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop katalog and nastavení záloha.",
    "ui.importDataZip_04e73": "Import data ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Obnovit suroviny, jídla, recepty, aktivity and desktop nastavení.",
    "ui.factoryReset_5dcd7": "Obnovení továrního nastavení",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Smazat the místní desktop katalog and start setup again.",
    "ui.licenses_f6aca": "Licence",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Soukromí",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your surovina, jídlo, recept and aktivita katalog locally on this machine. The LAN API is used only by your paired mobil app on your own network. No analytics, no public jídlo hledat, no account.",
    "ui.about_8f7f4": "O aplikaci",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing mobil.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Obnovit server from záloha ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create suroviny and jídla",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private surovina and jídlo catalogs.",
    "ui.buildRecipes_f4672": "Build recepty",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine jídla into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Upravit aktivita katalog",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Spustit the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair mobil when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls suroviny, jídla, recepty and aktivity from this server. Deník data stays on the phone. You can change startup, tray and záloha nastavení later from Nastavení.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public jídlo database, no account, no analytics.",
    "ui.back_0557f": "Zpět",
    "ui.next_10ac3": "Další",
    "ui.startUsingNutrino_b763a": "Spustit using nutrino",
    "ui.catalogQr_0d8f3": "katalog QR",
    "ui.scanThisWithTheMobileApp_231a6": "Skenovat this with the mobil app to review, edit and save the položka locally. Large recepty are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the recept was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Hotovo",
    "ui.mergeCatalogItem_db2c1": "merge katalog položka",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the položka to keep",
    "ui.merge_68be4": "Sloučit",
    "ui.close_d3d2e": "Zavřít",
    "ui.noMatchingTargetItem_6e9d3": "No matching target položka.",
    "ui.cancel_ea478": "Zrušit",
    "ui.mergeIntoSelected_1a212": "Sloučit into selected",
    "ui.mobileUploadInbox_5ea98": "mobil upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No suroviny in this upload.",
    "ui.ingredient_59198": "Surovina",
    "ui.noFoodsInThisUpload_d06f6": "No jídla in this upload.",
    "ui.food_0a38e": "Jídlo",
    "ui.noRecipesInThisUpload_f370c": "No recepty in this upload.",
    "ui.recipe_aef6e": "Recept",
    "ui.noActivitiesInThisUpload_ded76": "No aktivity in this upload.",
    "ui.activity_ecfc2": "Aktivita",
    "ui.privateMobileDiaryData_f455b": "Private mobil diary data",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, aktivita logs and hmotnost logs are not imported to desktop. They stay místní on mobil.",
    "ui.skippedItems_66bcb": "Skipped položky",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Uložit draft",
    "ui.note_3b064": "Poznámka",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Sacharidy / 100 g",
    "ui.fat100g_6709a": "Tuk / 100 g",
    "ui.protein100g_bf529": "Bílkoviny / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Značka / zdroj label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Popis",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the surovina kcal total. Macros stay calculated from suroviny.",
    "ui.servings_4349e": "Porce",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total recept gramy / servings.",
    "ui.noMatchingItem_12f96": "Žádná shoda.",
    "ui.remove_1063e": "Odebrat",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Kód",
    "ui.type_a1fa2": "Typ",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Hledat suroviny by název, poznámka or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Hledat jídla by název, brand, čárový kód, poznámka or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Hledat recepty by název, popis, poznámka or ID...",
    "ui.searchActivityTypeCode_9bb39": "Hledat aktivita, type, kód...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no heslo",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Volitelné; leave empty for no heslo",
    "ui.searchByNameIdBrandCode_0c5a3": "Hledat by název, ID, brand, kód...",
    "ui.ingredientName_cbdf8": "Surovina název",
    "ui.unit_19c56": "Jednotka",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Jídlo název",
    "ui.brand_1be6f": "Značka",
    "ui.recipeName_23955": "Recept název",
    "ui.servingsOptional_9fcb2": "Porce (volitelné)",
    "ui.activityName_75c4c": "Aktivita název",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Volitelné poznámka, zdroj or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Značka, restaurant, shop or zdroj",
    "ui.optional_ebb06": "Volitelné",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Volitelné poznámka, zdroj, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Volitelné; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Volitelné; empty means the whole recept is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Hledat jídlo, surovina or recept...",
    "ui.grams_ca820": "gramy",
    "ui.pieces_6b7e9": "kusy",
    "ui.running_75101": "běh",
    "ui.general_95815": "obecné",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "sl": {
    "nav.dashboard": "Pregled",
    "nav.ingredients": "Sestavine",
    "nav.foods": "Živila",
    "nav.recipes": "Recepti",
    "nav.activities": "Aktivnosti",
    "nav.server": "Strežnik",
    "nav.settings": "Nastavitve",
    "language": "Jezik",
    "languageSearch": "Išči po angleškem imenu, domačem imenu ali kodi…",
    "translations": "Prevodi",
    "addTranslation": "Dodaj prevod",
    "translationHint": "Osnovno ime je obvezno. Lokalizirana imena dodaj samo po potrebi.",
    "noTranslation": "Prevodi še niso dodani.",
    "selectLanguage": "Izberi jezik",
    "nameInLanguage": "Lokalizirano ime",
    "remove": "Odstrani",
    "ui.mergeDialogPrefix": "Združi",
    "ui.mergeDialogMiddle": "v obstoječega",
    "ui.mergeDialogSuffix": "You can išči by ime or ID; no need to remember the target ID.",
    "ui.status_24a23": "Stanje:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Strežnik",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Sestavine",
    "ui.avg100g_5f553": "Povprečje / 100 g",
    "ui.updated_ff0a3": "Posodobljeno",
    "ui.foods_9428a": "Živila",
    "ui.recipes_0153a": "Recepti",
    "ui.activities_d78ed": "Aktivnosti",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first lokalno architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the sestavina, živilo, recept and aktivnost catalogs plus the LAN API. Mobile syncs the katalog, then keeps working from its lokalno cache whenever the desktop strežnik is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base elementi without brand or črtna koda, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Osveži",
    "ui.importCsv_28ec2": "Uvozi CSV",
    "ui.skipDuplicates_6d417": "Preskoči dvojnike",
    "ui.exportCsv_c04f1": "Izvozi CSV",
    "ui.addIngredient_590a4": "Dodaj sestavino",
    "ui.sortByName_deb7e": "Razvrsti po imenu",
    "ui.sortByKcal_a0e33": "Razvrsti po kcal",
    "ui.sortByProtein_30969": "Razvrsti po beljakovinah",
    "ui.sortByCarbs_8895f": "Razvrsti po ogljikovih hidratih",
    "ui.sortByFat_e8cb8": "Razvrsti po maščobi",
    "ui.ingredientCsvStructure_bbae0": "Sestavina CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Sestavine are non-branded base materials. They do not have črtna koda or brand columns.",
    "ui.name_49ee3": "Ime",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Ogljikovi hidrati",
    "ui.fat_4d09c": "Maščobe",
    "ui.protein_7e667": "Beljakovine",
    "ui.actions_06df3": "Dejanja",
    "ui.ingredientNoBrandBarcode_b87ef": "Sestavina · no brand/črtna koda",
    "ui.edit_7dce1": "Uredi",
    "ui.mergeInto_f7c29": "Združi into",
    "ui.moveToFoods_e1a6b": "Move to živila",
    "ui.delete_f2a6c": "Izbriši",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, uvoz and izvoz concrete branded or vir-specific živila.",
    "ui.addFood_2e2e1": "Dodaj živilo",
    "ui.foodCsvStructure_f4bb5": "Živilo CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample živila are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to sestavine",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from živila. Nutrition is calculated from sestavine.",
    "ui.addRecipe_39767": "Dodaj recept",
    "ui.recipeCsvStructure_a4db3": "Recept CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Recepti are imported from a header-only schema plus your own rows. Sestavine stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "teža",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker aktivnost katalog with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Dodaj aktivnost",
    "ui.activityCsvStructure_c2cbe": "Aktivnost CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for aktivnost imports. kcal/min is neobvezno when MET is available.",
    "ui.lanApiServer_2738b": "LAN API strežnik",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an neobvezno strežnik geslo. If it is empty, mobilno can sinhronizacija on your LAN without auth; if set, mobilno must use the same geslo.",
    "ui.port_60aaf": "Vrata",
    "ui.serverPassword_7dfb3": "Geslo strežnika",
    "ui.start_a6122": "Zaženi",
    "ui.stop_11a75": "Ustavi",
    "ui.savePassword_49284": "Shrani geslo",
    "ui.restoreBackup_dd06b": "Obnovi varnostno kopijo",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Povezane naprave",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The mobilno app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Zaženi the LAN API strežnik to see connected mobilno devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No mobilno device has contacted the strežnik recently.",
    "ui.mergeSuggestions_3f578": "Združi suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate živila, recepti and aktivnosti before any sinhronizacija is involved. Choose which element should stay, then merge the rest into it, or open an element and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Združi all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate katalog elementi found.",
    "ui.mergeSelected_1f978": "Združi selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobilno are staged here first. Accept a batch to record it on the strežnik. Matching IDs are highlighted as replacements, not duplicates, so mobilno edits update the strežnik element instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide elementi already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload elementi.",
    "ui.noPendingMobileUploads_7e5ca": "No v čakanju mobilno uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Zavrni",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop elementi are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Preskoči",
    "ui.restore_2bd33": "Obnovi",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop strežnik",
    "ui.settings_f4f70": "Nastavitve",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Shrani current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export podatki ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop katalog and nastavitve varnostna kopija.",
    "ui.importDataZip_04e73": "Import podatki ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Obnovi sestavine, živila, recepti, aktivnosti and desktop nastavitve.",
    "ui.factoryReset_5dcd7": "Ponastavitev",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Izbriši the lokalno desktop katalog and start setup again.",
    "ui.licenses_f6aca": "Licence",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Zasebnost",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your sestavina, živilo, recept and aktivnost katalog locally on this machine. The LAN API is used only by your paired mobilno app on your own network. No analytics, no public živilo išči, no account.",
    "ui.about_8f7f4": "O aplikaciji",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing mobilno.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Obnovi strežnik from varnostna kopija ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create sestavine and živila",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private sestavina and živilo catalogs.",
    "ui.buildRecipes_f4672": "Build recepti",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine živila into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Uredi aktivnost katalog",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Zaženi the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair mobilno when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls sestavine, živila, recepti and aktivnosti from this strežnik. Dnevnik podatki stays on the phone. You can change startup, tray and varnostna kopija nastavitve later from Nastavitve.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public živilo database, no account, no analytics.",
    "ui.back_0557f": "Nazaj",
    "ui.next_10ac3": "Naprej",
    "ui.startUsingNutrino_b763a": "Zaženi using nutrino",
    "ui.catalogQr_0d8f3": "katalog QR",
    "ui.scanThisWithTheMobileApp_231a6": "Skeniraj this with the mobilno app to review, edit and save the element locally. Large recepti are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the recept was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Končano",
    "ui.mergeCatalogItem_db2c1": "merge katalog element",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the element to keep",
    "ui.merge_68be4": "Združi",
    "ui.close_d3d2e": "Zapri",
    "ui.noMatchingTargetItem_6e9d3": "No matching target element.",
    "ui.cancel_ea478": "Prekliči",
    "ui.mergeIntoSelected_1a212": "Združi into selected",
    "ui.mobileUploadInbox_5ea98": "mobilno upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No sestavine in this upload.",
    "ui.ingredient_59198": "Sestavina",
    "ui.noFoodsInThisUpload_d06f6": "No živila in this upload.",
    "ui.food_0a38e": "Živilo",
    "ui.noRecipesInThisUpload_f370c": "No recepti in this upload.",
    "ui.recipe_aef6e": "Recept",
    "ui.noActivitiesInThisUpload_ded76": "No aktivnosti in this upload.",
    "ui.activity_ecfc2": "Aktivnost",
    "ui.privateMobileDiaryData_f455b": "Private mobilno diary podatki",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, aktivnost logs and teža logs are not imported to desktop. They stay lokalno on mobilno.",
    "ui.skippedItems_66bcb": "Skipped elementi",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Shrani draft",
    "ui.note_3b064": "Opomba",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Ogljikovi hidrati / 100 g",
    "ui.fat100g_6709a": "Maščobe / 100 g",
    "ui.protein100g_bf529": "Beljakovine / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Znamka / vir label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Opis",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the sestavina kcal total. Macros stay calculated from sestavine.",
    "ui.servings_4349e": "Porcije",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total recept grami / servings.",
    "ui.noMatchingItem_12f96": "Ni ujemanja.",
    "ui.remove_1063e": "Odstrani",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Koda",
    "ui.type_a1fa2": "Tip",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Išči sestavine by ime, opomba or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Išči živila by ime, brand, črtna koda, opomba or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Išči recepti by ime, opis, opomba or ID...",
    "ui.searchActivityTypeCode_9bb39": "Išči aktivnost, type, koda...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no geslo",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Neobvezno; leave empty for no geslo",
    "ui.searchByNameIdBrandCode_0c5a3": "Išči by ime, ID, brand, koda...",
    "ui.ingredientName_cbdf8": "Sestavina ime",
    "ui.unit_19c56": "Enota",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Živilo ime",
    "ui.brand_1be6f": "Znamka",
    "ui.recipeName_23955": "Recept ime",
    "ui.servingsOptional_9fcb2": "Porcije (neobvezno)",
    "ui.activityName_75c4c": "Aktivnost ime",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Neobvezno opomba, vir or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Znamka, restaurant, shop or vir",
    "ui.optional_ebb06": "Neobvezno",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Neobvezno opomba, vir, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Neobvezno; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Neobvezno; empty means the whole recept is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Išči živilo, sestavina or recept...",
    "ui.grams_ca820": "grami",
    "ui.pieces_6b7e9": "kosi",
    "ui.running_75101": "tek",
    "ui.general_95815": "splošno",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "hr": {
    "nav.dashboard": "Pregled",
    "nav.ingredients": "Sastojci",
    "nav.foods": "Hrana",
    "nav.recipes": "Recepti",
    "nav.activities": "Aktivnosti",
    "nav.server": "Server",
    "nav.settings": "Postavke",
    "language": "Jezik",
    "languageSearch": "Traži po engleskom nazivu, izvornom nazivu ili kodu…",
    "translations": "Prijevodi",
    "addTranslation": "Dodaj prijevod",
    "translationHint": "Osnovni naziv je obavezan. Lokalizirane nazive dodaj samo po potrebi.",
    "noTranslation": "Još nema prijevoda.",
    "selectLanguage": "Odaberi jezik",
    "nameInLanguage": "Lokalizirani naziv",
    "remove": "Ukloni",
    "ui.mergeDialogPrefix": "Spoji",
    "ui.mergeDialogMiddle": "u postojeće",
    "ui.mergeDialogSuffix": "You can traži by naziv or ID; no need to remember the target ID.",
    "ui.status_24a23": "Status:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Server",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Sastojci",
    "ui.avg100g_5f553": "Prosjek / 100 g",
    "ui.updated_ff0a3": "Ažurirano",
    "ui.foods_9428a": "Hrana",
    "ui.recipes_0153a": "Recepti",
    "ui.activities_d78ed": "Aktivnosti",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first lokalno architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the sastojak, hrana, recept and aktivnost catalogs plus the LAN API. Mobile syncs the katalog, then keeps working from its lokalno cache whenever the desktop server is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base stavke without brand or crtični kod, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Osvježi",
    "ui.importCsv_28ec2": "Uvezi CSV",
    "ui.skipDuplicates_6d417": "Preskoči duplikate",
    "ui.exportCsv_c04f1": "Izvezi CSV",
    "ui.addIngredient_590a4": "Dodaj sastojak",
    "ui.sortByName_deb7e": "Sortiraj po nazivu",
    "ui.sortByKcal_a0e33": "Sortiraj po kcal",
    "ui.sortByProtein_30969": "Sortiraj po proteinima",
    "ui.sortByCarbs_8895f": "Sortiraj po ugljikohidratima",
    "ui.sortByFat_e8cb8": "Sortiraj po mastima",
    "ui.ingredientCsvStructure_bbae0": "Sastojak CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Sastojci are non-branded base materials. They do not have crtični kod or brand columns.",
    "ui.name_49ee3": "Naziv",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Ugljikohidrati",
    "ui.fat_4d09c": "Masti",
    "ui.protein_7e667": "Proteini",
    "ui.actions_06df3": "Radnje",
    "ui.ingredientNoBrandBarcode_b87ef": "Sastojak · no brand/crtični kod",
    "ui.edit_7dce1": "Uredi",
    "ui.mergeInto_f7c29": "Spoji into",
    "ui.moveToFoods_e1a6b": "Move to hrana",
    "ui.delete_f2a6c": "Izbriši",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, uvoz and izvoz concrete branded or izvor-specific hrana.",
    "ui.addFood_2e2e1": "Dodaj hranu",
    "ui.foodCsvStructure_f4bb5": "Hrana CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample hrana are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to sastojci",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from hrana. Nutrition is calculated from sastojci.",
    "ui.addRecipe_39767": "Dodaj recept",
    "ui.recipeCsvStructure_a4db3": "Recept CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Recepti are imported from a header-only schema plus your own rows. Sastojci stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "težina",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker aktivnost katalog with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Dodaj aktivnost",
    "ui.activityCsvStructure_c2cbe": "Aktivnost CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for aktivnost imports. kcal/min is neobavezno when MET is available.",
    "ui.lanApiServer_2738b": "LAN API server",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an neobavezno server lozinka. If it is empty, mobilno can sinkronizacija on your LAN without auth; if set, mobilno must use the same lozinka.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Lozinka servera",
    "ui.start_a6122": "Pokreni",
    "ui.stop_11a75": "Zaustavi",
    "ui.savePassword_49284": "Spremi lozinku",
    "ui.restoreBackup_dd06b": "Vrati backup",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Povezani uređaji",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The mobilno app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Pokreni the LAN API server to see connected mobilno devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No mobilno device has contacted the server recently.",
    "ui.mergeSuggestions_3f578": "Spoji suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate hrana, recepti and aktivnosti before any sinkronizacija is involved. Choose which stavka should stay, then merge the rest into it, or open an stavka and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Spoji all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate katalog stavke found.",
    "ui.mergeSelected_1f978": "Spoji selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobilno are staged here first. Accept a batch to record it on the server. Matching IDs are highlighted as replacements, not duplicates, so mobilno edits update the server stavka instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide stavke already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload stavke.",
    "ui.noPendingMobileUploads_7e5ca": "No na čekanju mobilno uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Odbij",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop stavke are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Preskoči",
    "ui.restore_2bd33": "Vrati",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop server",
    "ui.settings_f4f70": "Postavke",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Spremi current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export podaci ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop katalog and postavke backup.",
    "ui.importDataZip_04e73": "Import podaci ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Vrati sastojci, hrana, recepti, aktivnosti and desktop postavke.",
    "ui.factoryReset_5dcd7": "Vraćanje na tvorničke postavke",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Izbriši the lokalno desktop katalog and start setup again.",
    "ui.licenses_f6aca": "Licence",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Privatnost",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your sastojak, hrana, recept and aktivnost katalog locally on this machine. The LAN API is used only by your paired mobilno app on your own network. No analytics, no public hrana traži, no account.",
    "ui.about_8f7f4": "O aplikaciji",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing mobilno.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Vrati server from backup ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create sastojci and hrana",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private sastojak and hrana catalogs.",
    "ui.buildRecipes_f4672": "Build recepti",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine hrana into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Uredi aktivnost katalog",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Pokreni the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair mobilno when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls sastojci, hrana, recepti and aktivnosti from this server. Dnevnik podaci stays on the phone. You can change startup, tray and backup postavke later from Postavke.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public hrana database, no account, no analytics.",
    "ui.back_0557f": "Natrag",
    "ui.next_10ac3": "Dalje",
    "ui.startUsingNutrino_b763a": "Pokreni using nutrino",
    "ui.catalogQr_0d8f3": "katalog QR",
    "ui.scanThisWithTheMobileApp_231a6": "Skeniraj this with the mobilno app to review, edit and save the stavka locally. Large recepti are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the recept was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Gotovo",
    "ui.mergeCatalogItem_db2c1": "merge katalog stavka",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the stavka to keep",
    "ui.merge_68be4": "Spoji",
    "ui.close_d3d2e": "Zatvori",
    "ui.noMatchingTargetItem_6e9d3": "No matching target stavka.",
    "ui.cancel_ea478": "Odustani",
    "ui.mergeIntoSelected_1a212": "Spoji into selected",
    "ui.mobileUploadInbox_5ea98": "mobilno upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No sastojci in this upload.",
    "ui.ingredient_59198": "Sastojak",
    "ui.noFoodsInThisUpload_d06f6": "No hrana in this upload.",
    "ui.food_0a38e": "Hrana",
    "ui.noRecipesInThisUpload_f370c": "No recepti in this upload.",
    "ui.recipe_aef6e": "Recept",
    "ui.noActivitiesInThisUpload_ded76": "No aktivnosti in this upload.",
    "ui.activity_ecfc2": "Aktivnost",
    "ui.privateMobileDiaryData_f455b": "Private mobilno diary podaci",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, aktivnost logs and težina logs are not imported to desktop. They stay lokalno on mobilno.",
    "ui.skippedItems_66bcb": "Skipped stavke",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Spremi draft",
    "ui.note_3b064": "Bilješka",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Ugljikohidrati / 100 g",
    "ui.fat100g_6709a": "Masti / 100 g",
    "ui.protein100g_bf529": "Proteini / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Brend / izvor label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Opis",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the sastojak kcal total. Macros stay calculated from sastojci.",
    "ui.servings_4349e": "Porcije",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total recept grami / servings.",
    "ui.noMatchingItem_12f96": "Nema podudaranja.",
    "ui.remove_1063e": "Ukloni",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Kod",
    "ui.type_a1fa2": "Tip",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Traži sastojci by naziv, bilješka or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Traži hrana by naziv, brand, crtični kod, bilješka or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Traži recepti by naziv, opis, bilješka or ID...",
    "ui.searchActivityTypeCode_9bb39": "Traži aktivnost, type, kod...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no lozinka",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Neobavezno; leave empty for no lozinka",
    "ui.searchByNameIdBrandCode_0c5a3": "Traži by naziv, ID, brand, kod...",
    "ui.ingredientName_cbdf8": "Sastojak naziv",
    "ui.unit_19c56": "Jedinica",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Hrana naziv",
    "ui.brand_1be6f": "Brend",
    "ui.recipeName_23955": "Recept naziv",
    "ui.servingsOptional_9fcb2": "Porcije (neobavezno)",
    "ui.activityName_75c4c": "Aktivnost naziv",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Neobavezno bilješka, izvor or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Brend, restaurant, shop or izvor",
    "ui.optional_ebb06": "Neobavezno",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Neobavezno bilješka, izvor, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Neobavezno; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Neobavezno; empty means the whole recept is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Traži hrana, sastojak or recept...",
    "ui.grams_ca820": "grami",
    "ui.pieces_6b7e9": "komadi",
    "ui.running_75101": "trčanje",
    "ui.general_95815": "općenito",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "pl": {
    "nav.dashboard": "Panel",
    "nav.ingredients": "Składniki",
    "nav.foods": "Produkty",
    "nav.recipes": "Przepisy",
    "nav.activities": "Aktywności",
    "nav.server": "Serwer",
    "nav.settings": "Ustawienia",
    "language": "Język",
    "languageSearch": "Szukaj po nazwie angielskiej, własnej lub kodzie…",
    "translations": "Tłumaczenia",
    "addTranslation": "Dodaj tłumaczenie",
    "translationHint": "Nazwa bazowa jest wymagana. Nazwy lokalizowane dodawaj tylko w razie potrzeby.",
    "noTranslation": "Nie dodano jeszcze tłumaczeń.",
    "selectLanguage": "Wybierz język",
    "nameInLanguage": "Nazwa lokalizowana",
    "remove": "Usuń",
    "ui.mergeDialogPrefix": "Scal",
    "ui.mergeDialogMiddle": "do istniejącego",
    "ui.mergeDialogSuffix": "You can szukaj by nazwa or ID; no need to remember the target ID.",
    "ui.status_24a23": "Stan:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Serwer",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Składniki",
    "ui.avg100g_5f553": "Średnio / 100 g",
    "ui.updated_ff0a3": "Zaktualizowano",
    "ui.foods_9428a": "Produkty",
    "ui.recipes_0153a": "Przepisy",
    "ui.activities_d78ed": "Aktywności",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first lokalne architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the składnik, produkt, przepis and aktywność catalogs plus the LAN API. Mobile syncs the katalog, then keeps working from its lokalne cache whenever the desktop serwer is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base pozycje without brand or kod kreskowy, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Odśwież",
    "ui.importCsv_28ec2": "Importuj CSV",
    "ui.skipDuplicates_6d417": "Pomiń duplikaty",
    "ui.exportCsv_c04f1": "Eksportuj CSV",
    "ui.addIngredient_590a4": "Dodaj składnik",
    "ui.sortByName_deb7e": "Sortuj według nazwy",
    "ui.sortByKcal_a0e33": "Sortuj według kcal",
    "ui.sortByProtein_30969": "Sortuj według białka",
    "ui.sortByCarbs_8895f": "Sortuj według węglowodanów",
    "ui.sortByFat_e8cb8": "Sortuj według tłuszczu",
    "ui.ingredientCsvStructure_bbae0": "Składnik CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Składniki are non-branded base materials. They do not have kod kreskowy or brand columns.",
    "ui.name_49ee3": "Nazwa",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Węglowodany",
    "ui.fat_4d09c": "Tłuszcz",
    "ui.protein_7e667": "Białko",
    "ui.actions_06df3": "Akcje",
    "ui.ingredientNoBrandBarcode_b87ef": "Składnik · no brand/kod kreskowy",
    "ui.edit_7dce1": "Edytuj",
    "ui.mergeInto_f7c29": "Scal into",
    "ui.moveToFoods_e1a6b": "Move to produkty",
    "ui.delete_f2a6c": "Usuń",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, import and eksport concrete branded or źródło-specific produkty.",
    "ui.addFood_2e2e1": "Dodaj produkt",
    "ui.foodCsvStructure_f4bb5": "Produkt CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample produkty are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to składniki",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from produkty. Nutrition is calculated from składniki.",
    "ui.addRecipe_39767": "Dodaj przepis",
    "ui.recipeCsvStructure_a4db3": "Przepis CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Przepisy are imported from a header-only schema plus your own rows. Składniki stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "waga",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker aktywność katalog with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Dodaj aktywność",
    "ui.activityCsvStructure_c2cbe": "Aktywność CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for aktywność imports. kcal/min is opcjonalne when MET is available.",
    "ui.lanApiServer_2738b": "LAN API serwer",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an opcjonalne serwer hasło. If it is empty, mobilne can synchronizacja on your LAN without auth; if set, mobilne must use the same hasło.",
    "ui.port_60aaf": "Port",
    "ui.serverPassword_7dfb3": "Hasło serwera",
    "ui.start_a6122": "Start",
    "ui.stop_11a75": "Stop",
    "ui.savePassword_49284": "Zapisz hasło",
    "ui.restoreBackup_dd06b": "Przywróć kopię",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Połączone urządzenia",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The mobilne app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Start the LAN API serwer to see connected mobilne devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No mobilne device has contacted the serwer recently.",
    "ui.mergeSuggestions_3f578": "Scal suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate produkty, przepisy and aktywności before any synchronizacja is involved. Choose which pozycja should stay, then merge the rest into it, or open an pozycja and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Scal all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate katalog pozycje found.",
    "ui.mergeSelected_1f978": "Scal selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from mobilne are staged here first. Accept a batch to record it on the serwer. Matching IDs are highlighted as replacements, not duplicates, so mobilne edits update the serwer pozycja instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide pozycje already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload pozycje.",
    "ui.noPendingMobileUploads_7e5ca": "No oczekuje mobilne uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Odrzuć",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop pozycje are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Pomiń",
    "ui.restore_2bd33": "Przywróć",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop serwer",
    "ui.settings_f4f70": "Ustawienia",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Zapisz current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export dane ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop katalog and ustawienia kopia zapasowa.",
    "ui.importDataZip_04e73": "Import dane ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Przywróć składniki, produkty, przepisy, aktywności and desktop ustawienia.",
    "ui.factoryReset_5dcd7": "Reset fabryczny",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Usuń the lokalne desktop katalog and start setup again.",
    "ui.licenses_f6aca": "Licencje",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Prywatność",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your składnik, produkt, przepis and aktywność katalog locally on this machine. The LAN API is used only by your paired mobilne app on your own network. No analytics, no public produkt szukaj, no account.",
    "ui.about_8f7f4": "O aplikacji",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing mobilne.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Przywróć serwer from kopia zapasowa ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create składniki and produkty",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private składnik and produkt catalogs.",
    "ui.buildRecipes_f4672": "Build przepisy",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine produkty into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Edytuj aktywność katalog",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Start the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair mobilne when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls składniki, produkty, przepisy and aktywności from this serwer. Dziennik dane stays on the phone. You can change startup, tray and kopia zapasowa ustawienia later from Ustawienia.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public produkt database, no account, no analytics.",
    "ui.back_0557f": "Wstecz",
    "ui.next_10ac3": "Dalej",
    "ui.startUsingNutrino_b763a": "Start using nutrino",
    "ui.catalogQr_0d8f3": "katalog QR",
    "ui.scanThisWithTheMobileApp_231a6": "Skanuj this with the mobilne app to review, edit and save the pozycja locally. Large przepisy are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the przepis was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Gotowe",
    "ui.mergeCatalogItem_db2c1": "merge katalog pozycja",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the pozycja to keep",
    "ui.merge_68be4": "Scal",
    "ui.close_d3d2e": "Zamknij",
    "ui.noMatchingTargetItem_6e9d3": "No matching target pozycja.",
    "ui.cancel_ea478": "Anuluj",
    "ui.mergeIntoSelected_1a212": "Scal into selected",
    "ui.mobileUploadInbox_5ea98": "mobilne upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No składniki in this upload.",
    "ui.ingredient_59198": "Składnik",
    "ui.noFoodsInThisUpload_d06f6": "No produkty in this upload.",
    "ui.food_0a38e": "Produkt",
    "ui.noRecipesInThisUpload_f370c": "No przepisy in this upload.",
    "ui.recipe_aef6e": "Przepis",
    "ui.noActivitiesInThisUpload_ded76": "No aktywności in this upload.",
    "ui.activity_ecfc2": "Aktywność",
    "ui.privateMobileDiaryData_f455b": "Private mobilne diary dane",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, aktywność logs and waga logs are not imported to desktop. They stay lokalne on mobilne.",
    "ui.skippedItems_66bcb": "Skipped pozycje",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Zapisz draft",
    "ui.note_3b064": "Notatka",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Węglowodany / 100 g",
    "ui.fat100g_6709a": "Tłuszcz / 100 g",
    "ui.protein100g_bf529": "Białko / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Marka / źródło label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Opis",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the składnik kcal total. Macros stay calculated from składniki.",
    "ui.servings_4349e": "Porcje",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total przepis gramy / servings.",
    "ui.noMatchingItem_12f96": "Brak dopasowania.",
    "ui.remove_1063e": "Usuń",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Kod",
    "ui.type_a1fa2": "Typ",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Szukaj składniki by nazwa, notatka or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Szukaj produkty by nazwa, brand, kod kreskowy, notatka or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Szukaj przepisy by nazwa, opis, notatka or ID...",
    "ui.searchActivityTypeCode_9bb39": "Szukaj aktywność, type, kod...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no hasło",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Opcjonalne; leave empty for no hasło",
    "ui.searchByNameIdBrandCode_0c5a3": "Szukaj by nazwa, ID, brand, kod...",
    "ui.ingredientName_cbdf8": "Składnik nazwa",
    "ui.unit_19c56": "Jednostka",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Produkt nazwa",
    "ui.brand_1be6f": "Marka",
    "ui.recipeName_23955": "Przepis nazwa",
    "ui.servingsOptional_9fcb2": "Porcje (opcjonalne)",
    "ui.activityName_75c4c": "Aktywność nazwa",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Opcjonalne notatka, źródło or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Marka, restaurant, shop or źródło",
    "ui.optional_ebb06": "Opcjonalne",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Opcjonalne notatka, źródło, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Opcjonalne; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Opcjonalne; empty means the whole przepis is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Szukaj produkt, składnik or przepis...",
    "ui.grams_ca820": "gramy",
    "ui.pieces_6b7e9": "sztuki",
    "ui.running_75101": "bieganie",
    "ui.general_95815": "ogólne",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "es": {
    "nav.dashboard": "Panel",
    "nav.ingredients": "Ingredientes",
    "nav.foods": "Alimentos",
    "nav.recipes": "Recetas",
    "nav.activities": "Actividades",
    "nav.server": "Servidor",
    "nav.settings": "Ajustes",
    "language": "Idioma",
    "languageSearch": "Buscar por nombre inglés, nombre nativo o código…",
    "translations": "Traducciones",
    "addTranslation": "Añadir traducción",
    "translationHint": "El nombre base sigue siendo obligatorio. Añade nombres localizados solo cuando sea necesario.",
    "noTranslation": "Aún no hay traducciones.",
    "selectLanguage": "Seleccionar idioma",
    "nameInLanguage": "Nombre localizado",
    "remove": "Eliminar",
    "ui.mergeDialogPrefix": "Fusionar",
    "ui.mergeDialogMiddle": "en uno existente",
    "ui.mergeDialogSuffix": "You can buscar by nombre or ID; no need to remember the target ID.",
    "ui.status_24a23": "Estado:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Servidor",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Ingredientes",
    "ui.avg100g_5f553": "Media / 100 g",
    "ui.updated_ff0a3": "Actualizado",
    "ui.foods_9428a": "Alimentos",
    "ui.recipes_0153a": "Recetas",
    "ui.activities_d78ed": "Actividades",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first local architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the ingrediente, alimento, receta and actividad catalogs plus the LAN API. Mobile syncs the catálogo, then keeps working from its local cache whenever the desktop servidor is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base elementos without brand or código de barras, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Actualizar",
    "ui.importCsv_28ec2": "Importar CSV",
    "ui.skipDuplicates_6d417": "Omitir duplicados",
    "ui.exportCsv_c04f1": "Exportar CSV",
    "ui.addIngredient_590a4": "Añadir ingrediente",
    "ui.sortByName_deb7e": "Ordenar por nombre",
    "ui.sortByKcal_a0e33": "Ordenar por kcal",
    "ui.sortByProtein_30969": "Ordenar por proteína",
    "ui.sortByCarbs_8895f": "Ordenar por carbohidratos",
    "ui.sortByFat_e8cb8": "Ordenar por grasa",
    "ui.ingredientCsvStructure_bbae0": "Ingrediente CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Ingredientes are non-branded base materials. They do not have código de barras or brand columns.",
    "ui.name_49ee3": "Nombre",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Carbohidratos",
    "ui.fat_4d09c": "Grasa",
    "ui.protein_7e667": "Proteína",
    "ui.actions_06df3": "Acciones",
    "ui.ingredientNoBrandBarcode_b87ef": "Ingrediente · no brand/código de barras",
    "ui.edit_7dce1": "Editar",
    "ui.mergeInto_f7c29": "Fusionar into",
    "ui.moveToFoods_e1a6b": "Move to alimentos",
    "ui.delete_f2a6c": "Eliminar",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, importar and exportar concrete branded or fuente-specific alimentos.",
    "ui.addFood_2e2e1": "Añadir alimento",
    "ui.foodCsvStructure_f4bb5": "Alimento CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample alimentos are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to ingredientes",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from alimentos. Nutrition is calculated from ingredientes.",
    "ui.addRecipe_39767": "Añadir receta",
    "ui.recipeCsvStructure_a4db3": "Receta CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Recetas are imported from a header-only schema plus your own rows. Ingredientes stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "peso",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker actividad catálogo with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Añadir actividad",
    "ui.activityCsvStructure_c2cbe": "Actividad CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for actividad imports. kcal/min is opcional when MET is available.",
    "ui.lanApiServer_2738b": "LAN API servidor",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an opcional servidor contraseña. If it is empty, móvil can sincronización on your LAN without auth; if set, móvil must use the same contraseña.",
    "ui.port_60aaf": "Puerto",
    "ui.serverPassword_7dfb3": "Contraseña del servidor",
    "ui.start_a6122": "Iniciar",
    "ui.stop_11a75": "Detener",
    "ui.savePassword_49284": "Guardar contraseña",
    "ui.restoreBackup_dd06b": "Restaurar copia",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Dispositivos conectados",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The móvil app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Iniciar the LAN API servidor to see connected móvil devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No móvil device has contacted the servidor recently.",
    "ui.mergeSuggestions_3f578": "Fusionar suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate alimentos, recetas and actividades before any sincronización is involved. Choose which elemento should stay, then merge the rest into it, or open an elemento and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Fusionar all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate catálogo elementos found.",
    "ui.mergeSelected_1f978": "Fusionar selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from móvil are staged here first. Accept a batch to record it on the servidor. Matching IDs are highlighted as replacements, not duplicates, so móvil edits update the servidor elemento instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide elementos already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload elementos.",
    "ui.noPendingMobileUploads_7e5ca": "No pendiente móvil uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Rechazar",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop elementos are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Omitir",
    "ui.restore_2bd33": "Restaurar",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop servidor",
    "ui.settings_f4f70": "Ajustes",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Guardar current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export datos ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop catálogo and ajustes copia de seguridad.",
    "ui.importDataZip_04e73": "Import datos ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Restaurar ingredientes, alimentos, recetas, actividades and desktop ajustes.",
    "ui.factoryReset_5dcd7": "Restablecer",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Eliminar the local desktop catálogo and start setup again.",
    "ui.licenses_f6aca": "Licencias",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Privacidad",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your ingrediente, alimento, receta and actividad catálogo locally on this machine. The LAN API is used only by your paired móvil app on your own network. No analytics, no public alimento buscar, no account.",
    "ui.about_8f7f4": "Acerca de",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing móvil.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Restaurar servidor from copia de seguridad ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create ingredientes and alimentos",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private ingrediente and alimento catalogs.",
    "ui.buildRecipes_f4672": "Build recetas",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine alimentos into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Editar actividad catálogo",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Iniciar the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair móvil when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls ingredientes, alimentos, recetas and actividades from this servidor. Diario datos stays on the phone. You can change startup, tray and copia de seguridad ajustes later from Ajustes.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public alimento database, no account, no analytics.",
    "ui.back_0557f": "Atrás",
    "ui.next_10ac3": "Siguiente",
    "ui.startUsingNutrino_b763a": "Iniciar using nutrino",
    "ui.catalogQr_0d8f3": "catálogo QR",
    "ui.scanThisWithTheMobileApp_231a6": "Escanear this with the móvil app to review, edit and save the elemento locally. Large recetas are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the receta was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Listo",
    "ui.mergeCatalogItem_db2c1": "merge catálogo elemento",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the elemento to keep",
    "ui.merge_68be4": "Fusionar",
    "ui.close_d3d2e": "Cerrar",
    "ui.noMatchingTargetItem_6e9d3": "No matching target elemento.",
    "ui.cancel_ea478": "Cancelar",
    "ui.mergeIntoSelected_1a212": "Fusionar into selected",
    "ui.mobileUploadInbox_5ea98": "móvil upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No ingredientes in this upload.",
    "ui.ingredient_59198": "Ingrediente",
    "ui.noFoodsInThisUpload_d06f6": "No alimentos in this upload.",
    "ui.food_0a38e": "Alimento",
    "ui.noRecipesInThisUpload_f370c": "No recetas in this upload.",
    "ui.recipe_aef6e": "Receta",
    "ui.noActivitiesInThisUpload_ded76": "No actividades in this upload.",
    "ui.activity_ecfc2": "Actividad",
    "ui.privateMobileDiaryData_f455b": "Private móvil diary datos",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, actividad logs and peso logs are not imported to desktop. They stay local on móvil.",
    "ui.skippedItems_66bcb": "Skipped elementos",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Guardar draft",
    "ui.note_3b064": "Nota",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Carbohidratos / 100 g",
    "ui.fat100g_6709a": "Grasa / 100 g",
    "ui.protein100g_bf529": "Proteína / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Marca / fuente label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Descripción",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the ingrediente kcal total. Macros stay calculated from ingredientes.",
    "ui.servings_4349e": "Porciones",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total receta gramos / servings.",
    "ui.noMatchingItem_12f96": "No hay coincidencias.",
    "ui.remove_1063e": "Eliminar",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Código",
    "ui.type_a1fa2": "Tipo",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Buscar ingredientes by nombre, nota or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Buscar alimentos by nombre, brand, código de barras, nota or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Buscar recetas by nombre, descripción, nota or ID...",
    "ui.searchActivityTypeCode_9bb39": "Buscar actividad, type, código...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no contraseña",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Opcional; leave empty for no contraseña",
    "ui.searchByNameIdBrandCode_0c5a3": "Buscar by nombre, ID, brand, código...",
    "ui.ingredientName_cbdf8": "Ingrediente nombre",
    "ui.unit_19c56": "Unidad",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Alimento nombre",
    "ui.brand_1be6f": "Marca",
    "ui.recipeName_23955": "Receta nombre",
    "ui.servingsOptional_9fcb2": "Porciones (opcional)",
    "ui.activityName_75c4c": "Actividad nombre",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Opcional nota, fuente or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Marca, restaurant, shop or fuente",
    "ui.optional_ebb06": "Opcional",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Opcional nota, fuente, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Opcional; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Opcional; empty means the whole receta is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Buscar alimento, ingrediente or receta...",
    "ui.grams_ca820": "gramos",
    "ui.pieces_6b7e9": "piezas",
    "ui.running_75101": "correr",
    "ui.general_95815": "general",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  },
  "pt": {
    "nav.dashboard": "Painel",
    "nav.ingredients": "Ingredientes",
    "nav.foods": "Alimentos",
    "nav.recipes": "Receitas",
    "nav.activities": "Atividades",
    "nav.server": "Servidor",
    "nav.settings": "Definições",
    "language": "Idioma",
    "languageSearch": "Pesquisar por nome em inglês, nome nativo ou código…",
    "translations": "Traduções",
    "addTranslation": "Adicionar tradução",
    "translationHint": "O nome base continua obrigatório. Adiciona nomes localizados apenas quando necessário.",
    "noTranslation": "Ainda não há traduções.",
    "selectLanguage": "Selecionar idioma",
    "nameInLanguage": "Nome localizado",
    "remove": "Remover",
    "ui.mergeDialogPrefix": "Unir",
    "ui.mergeDialogMiddle": "num existente",
    "ui.mergeDialogSuffix": "You can pesquisar by nome or ID; no need to remember the target ID.",
    "ui.status_24a23": "Estado:",
    "ui.nutrinoDesktopServer_a80f2": "nutrino Desktop Servidor",
    "ui.lanApi_0ee00": "LAN API",
    "ui.ingredients_210c9": "Ingredientes",
    "ui.avg100g_5f553": "Média / 100 g",
    "ui.updated_ff0a3": "Atualizado",
    "ui.foods_9428a": "Alimentos",
    "ui.recipes_0153a": "Receitas",
    "ui.activities_d78ed": "Atividades",
    "ui.offlineFirstLocalArchitecture_127b5": "Offline-first local architecture",
    "ui.thisDesktopAppOwnsTheIngredient_dbe12": "This desktop app owns the ingrediente, alimento, receita and atividade catalogs plus the LAN API. Mobile syncs the catálogo, then keeps working from its local cache whenever the desktop servidor is unavailable.",
    "ui.genericRawBaseItemsWithoutBrand_92a0f": "Generic raw/base itens without brand or código de barras, such as sugar, fruit, vegetables or potatoes.",
    "ui.refresh_63a6a": "Atualizar",
    "ui.importCsv_28ec2": "Importar CSV",
    "ui.skipDuplicates_6d417": "Ignorar duplicados",
    "ui.exportCsv_c04f1": "Exportar CSV",
    "ui.addIngredient_590a4": "Adicionar ingrediente",
    "ui.sortByName_deb7e": "Ordenar por nome",
    "ui.sortByKcal_a0e33": "Ordenar por kcal",
    "ui.sortByProtein_30969": "Ordenar por proteína",
    "ui.sortByCarbs_8895f": "Ordenar por hidratos",
    "ui.sortByFat_e8cb8": "Ordenar por gordura",
    "ui.ingredientCsvStructure_bbae0": "Ingrediente CSV structure",
    "ui.ingredientsAreNonBrandedBaseMaterials_d41e1": "Ingredientes are non-branded base materials. They do not have código de barras or brand columns.",
    "ui.name_49ee3": "Nome",
    "ui.id_b718a": "ID",
    "ui.carbs_ee64f": "Hidratos",
    "ui.fat_4d09c": "Gordura",
    "ui.protein_7e667": "Proteína",
    "ui.actions_06df3": "Ações",
    "ui.ingredientNoBrandBarcode_b87ef": "Ingrediente · no brand/código de barras",
    "ui.edit_7dce1": "Editar",
    "ui.mergeInto_f7c29": "Unir into",
    "ui.moveToFoods_e1a6b": "Move to alimentos",
    "ui.delete_f2a6c": "Eliminar",
    "ui.createEditDeleteImportAndExport_14d0a": "Create, edit, delete, importar and exportar concrete branded or fonte-specific alimentos.",
    "ui.addFood_2e2e1": "Adicionar alimento",
    "ui.foodCsvStructure_f4bb5": "Alimento CSV structure",
    "ui.importFilesMustUseThisHeader_fb913": "Import files must use this header row. Starter/sample alimentos are intentionally not bundled into the app.",
    "ui.moveToIngredients_39253": "Move to ingredientes",
    "ui.buildReusableMealsFromFoodsNutrition_d435d": "Build reusable meals from alimentos. Nutrition is calculated from ingredientes.",
    "ui.addRecipe_39767": "Adicionar receita",
    "ui.recipeCsvStructure_a4db3": "Receita CSV structure",
    "ui.recipesAreImportedFromAHeader_3c31f": "Receitas are imported from a header-only schema plus your own rows. Ingredientes stay gram-based in storage.",
    "ui.kcalTotal_0c895": "kcal total",
    "ui.carbsTotal_d2ae4": "carbs total",
    "ui.fatTotal_41615": "fat total",
    "ui.proteinTotal_67f44": "protein total",
    "ui.kcal100g_40bdf": "kcal/100g",
    "ui.weight_7edab": "peso",
    "ui.extraKcal_65a05": "extra kcal",
    "ui.1Db_42565": "1 db",
    "ui.opennutritrackerActivityCatalogWithEditableMet_58263": "OpenNutriTracker atividade catálogo with editable MET and kcal/min values.",
    "ui.addActivity_a263a": "Adicionar atividade",
    "ui.activityCsvStructure_c2cbe": "Atividade CSV structure",
    "ui.useThisHeaderRowForActivity_4eb62": "Use this header row for atividade imports. kcal/min is opcional when MET is available.",
    "ui.lanApiServer_2738b": "LAN API servidor",
    "ui.setAnOptionalServerPasswordIf_5e0e9": "Set an opcional servidor palavra-passe. If it is empty, móvel can sincronização on your LAN without auth; if set, móvel must use the same palavra-passe.",
    "ui.port_60aaf": "Porta",
    "ui.serverPassword_7dfb3": "Palavra-passe do servidor",
    "ui.start_a6122": "Iniciar",
    "ui.stop_11a75": "Parar",
    "ui.savePassword_49284": "Guardar palavra-passe",
    "ui.restoreBackup_dd06b": "Restaurar cópia",
    "ui.pairingDetails_d8479": "Pairing details",
    "ui.baseUrl_ade86": "Base URL",
    "ui.sourceId_33735": "Source ID",
    "ui.auth_632c9": "Auth",
    "ui.channel_781dc": "Channel",
    "ui.connectedDevices_1aee3": "Dispositivos ligados",
    "ui.devicesSeenByTheLanApi_7cc05": "Devices seen by the LAN API in the last 5 minutes. The móvel app sends a friendly Android device identity instead of the raw Linux/WebView user agent.",
    "ui.startTheLanApiServerTo_231bf": "Iniciar the LAN API servidor to see connected móvel devices.",
    "ui.noMobileDeviceHasContactedThe_a557c": "No móvel device has contacted the servidor recently.",
    "ui.mergeSuggestions_3f578": "Unir suggestions",
    "ui.nutrinoCanListLikelyDuplicateFoods_06da2": "Nutrino can list likely duplicate alimentos, receitas and atividades before any sincronização is involved. Choose which item should stay, then merge the rest into it, or open an item and rename it if it is only badly named.",
    "ui.mergeAllSelected_07c3e": "Unir all selected",
    "ui.noLikelyDuplicateCatalogItemsFound_e496c": "No likely duplicate catálogo itens found.",
    "ui.mergeSelected_1f978": "Unir selected",
    "ui.mobileUploadInbox_3476a": "Mobile upload inbox",
    "ui.uploadsSentFromMobileAreStaged_beb6b": "Uploads sent from móvel are staged here first. Accept a batch to record it on the servidor. Matching IDs are highlighted as replacements, not duplicates, so móvel edits update the servidor item instead of creating another one.",
    "ui.hideItemsAlreadyOnDesktop_6efec": "Hide itens already on desktop",
    "ui.defaultViewShowsOnlyNewChanged_1b926": "Default view shows only new, changed and skipped upload itens.",
    "ui.noPendingMobileUploads_7e5ca": "No pendente móvel uploads.",
    "ui.reviewEdit_77e3a": "Review/edit",
    "ui.recordDraft_685b4": "Record draft",
    "ui.reject_d98ac": "Rejeitar",
    "ui.allUnchangedDesktopItemsAreHidden_df79b": "All unchanged desktop itens are hidden. Disable the filter above to inspect them.",
    "ui.skip_72ef2": "Ignorar",
    "ui.restore_2bd33": "Restaurar",
    "ui.exactDuplicateMergeSuggestions_d8d31": "Exact duplicate merge suggestions",
    "ui.desktopServer_ee8af": "desktop servidor",
    "ui.settings_f4f70": "Definições",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.dataAndRecovery_677d1": "Data & recovery",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.saveCurrentWindow_1b2b6": "Guardar current window",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.exportDataZip_d39bb": "Export dados ZIP",
    "ui.createADesktopCatalogAndSettings_5ec25": "Create a desktop catálogo and definições cópia de segurança.",
    "ui.importDataZip_04e73": "Import dados ZIP",
    "ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762": "Restaurar ingredientes, alimentos, receitas, atividades and desktop definições.",
    "ui.factoryReset_5dcd7": "Reposição de fábrica",
    "ui.deleteTheLocalDesktopCatalogAnd_3509d": "Eliminar the local desktop catálogo and start setup again.",
    "ui.licenses_f6aca": "Licenças",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.privacy_c5f29": "Privacidade",
    "ui.localFirstByDesign_50f82": "Local-first by design",
    "ui.nutrinoDesktopStoresYourIngredientFood_8ab07": "nutrino Desktop stores your ingrediente, alimento, receita and atividade catálogo locally on this machine. The LAN API is used only by your paired móvel app on your own network. No analytics, no public alimento pesquisar, no account.",
    "ui.about_8f7f4": "Sobre",
    "ui.thanksToOpennutritrackerForThePrivacy_2e20e": "Thanks to OpenNutriTracker for the privacy-first nutrition inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star",
    "ui.desktopSetup_8dda1": "Desktop setup",
    "ui.setTheDefaultLanApiPort_c998b": "Set the default LAN API port and review how nutrino Desktop works before pairing móvel.",
    "ui.lanApiPort_509d9": "LAN API port",
    "ui.restoreServerFromBackupZip_aafd4": "Restaurar servidor from cópia de segurança ZIP",
    "ui.importOrCreateIngredientsAndFoods_c86e5": "Import or create ingredientes and alimentos",
    "ui.buildYourPrivateIngredientAndFood_d9651": "Build your private ingrediente and alimento catalogs.",
    "ui.buildRecipes_f4672": "Build receitas",
    "ui.combineFoodsIntoReusableMeals_a2483": "Combine alimentos into reusable meals.",
    "ui.editActivityCatalog_5a8f3": "Editar atividade catálogo",
    "ui.reviewMetAndKcalMinValues_c297b": "Review MET and kcal/min values.",
    "ui.startTheLanApi_61b1e": "Iniciar the LAN API",
    "ui.pairMobileWhenYouAreReady_d3cb4": "Pair móvel when you are ready.",
    "ui.mobilePullsIngredientsFoodsRecipesAnd_7d538": "Mobile pulls ingredientes, alimentos, receitas and atividades from this servidor. Diário dados stays on the phone. You can change startup, tray and cópia de segurança definições later from Definições.",
    "ui.localFirst_f0903": "Local-first",
    "ui.noPublicFoodDatabaseNoAccount_b4d78": "No public alimento database, no account, no analytics.",
    "ui.back_0557f": "Voltar",
    "ui.next_10ac3": "Seguinte",
    "ui.startUsingNutrino_b763a": "Iniciar using nutrino",
    "ui.catalogQr_0d8f3": "catálogo QR",
    "ui.scanThisWithTheMobileApp_231a6": "Digitalizar this with the móvel app to review, edit and save the item locally. Large receitas are split into numbered QR parts; scan every part once.",
    "ui.theFirstQrIncludesTheTotal_0940b": "The first QR includes the total count. Continue until the phone says the receita was imported.",
    "ui.previous_dd1f7": "Previous",
    "ui.done_f9296": "Concluído",
    "ui.mergeCatalogItem_db2c1": "merge catálogo item",
    "ui.chooseTheItemToKeep_9e3c5": "Choose the item to keep",
    "ui.merge_68be4": "Unir",
    "ui.close_d3d2e": "Fechar",
    "ui.noMatchingTargetItem_6e9d3": "No matching target item.",
    "ui.cancel_ea478": "Cancelar",
    "ui.mergeIntoSelected_1a212": "Unir into selected",
    "ui.mobileUploadInbox_5ea98": "móvel upload inbox",
    "ui.reviewAndEditBeforeRecording_f198d": "Review and edit before recording",
    "ui.sameIdReplacementsFromThisUpload_1aae1": "Same-ID replacements from this upload",
    "ui.exactDuplicateSuggestionsFromThisUpload_3fbfc": "Exact duplicate suggestions from this upload",
    "ui.noIngredientsInThisUpload_dfd36": "No ingredientes in this upload.",
    "ui.ingredient_59198": "Ingrediente",
    "ui.noFoodsInThisUpload_d06f6": "No alimentos in this upload.",
    "ui.food_0a38e": "Alimento",
    "ui.noRecipesInThisUpload_f370c": "No receitas in this upload.",
    "ui.recipe_aef6e": "Receita",
    "ui.noActivitiesInThisUpload_ded76": "No atividades in this upload.",
    "ui.activity_ecfc2": "Atividade",
    "ui.privateMobileDiaryData_f455b": "Private móvel diary dados",
    "ui.keptOnPhoneOnly_f22ee": "Kept on phone only",
    "ui.mealNotesActivityLogsAndWeight_c2580": "Meal notes, atividade logs and peso logs are not imported to desktop. They stay local on móvel.",
    "ui.skippedItems_66bcb": "Skipped itens",
    "ui.skipped_d9c8f": "Skipped",
    "ui.advancedJsonEditor_19192": "Advanced JSON editor",
    "ui.useThisOnlyWhenTheVisual_9b0cc": "Use this only when the visual editor does not expose a field you need.",
    "ui.saveDraft_48ca5": "Guardar draft",
    "ui.note_3b064": "Nota",
    "ui.defaultUnit_81471": "Default unit",
    "ui.servingSizeG_8fd02": "Serving size g",
    "ui.kcal100g_bb877": "kcal / 100 g",
    "ui.carbs100g_77af9": "Hidratos / 100 g",
    "ui.fat100g_6709a": "Gordura / 100 g",
    "ui.protein100g_bf529": "Proteína / 100 g",
    "ui.sugars100g_7ebdd": "Sugars / 100 g",
    "ui.fiber100g_31731": "Fiber / 100 g",
    "ui.salt100g_1473d": "Salt / 100 g",
    "ui.brandSourceLabel_07afa": "Marca / fonte label",
    "ui.barcodeEanUpc_1335e": "Barcode / EAN / UPC",
    "ui.description_b5a7a": "Descrição",
    "ui.extraKcal_70d7d": "Extra kcal",
    "ui.addsToOrSubtractsFromThe_2330b": "Adds to or subtracts from the ingrediente kcal total. Macros stay calculated from ingredientes.",
    "ui.servings_4349e": "Porções",
    "ui.whenSet1DbEqualsTotal_3140a": "When set, 1 db equals total receita gramas / servings.",
    "ui.noMatchingItem_12f96": "Sem correspondência.",
    "ui.remove_1063e": "Remover",
    "ui.carbs100g_ed4c3": "carbs/100g",
    "ui.fat100g_a84e1": "fat/100g",
    "ui.protein100g_cdbf5": "protein/100g",
    "ui.code_ca0db": "Código",
    "ui.type_a1fa2": "Tipo",
    "ui.kcalMin_22677": "kcal / min",
    "ui.searchIngredientsByNameNoteOr_23ce9": "Pesquisar ingredientes by nome, nota or ID...",
    "ui.searchFoodsByNameBrandBarcode_d7567": "Pesquisar alimentos by nome, brand, código de barras, nota or ID...",
    "ui.searchRecipesByNameDescriptionNote_0dd65": "Pesquisar receitas by nome, descrição, nota or ID...",
    "ui.searchActivityTypeCode_9bb39": "Pesquisar atividade, type, código...",
    "ui.leaveEmptyForNoPassword_c6e10": "Leave empty for no palavra-passe",
    "ui.optionalLeaveEmptyForNoPassword_151bc": "Opcional; leave empty for no palavra-passe",
    "ui.searchByNameIdBrandCode_0c5a3": "Pesquisar by nome, ID, brand, código...",
    "ui.ingredientName_cbdf8": "Ingrediente nome",
    "ui.unit_19c56": "Unidade",
    "ui.carbs_ccebb": "carbs",
    "ui.fat_0d8dc": "fat",
    "ui.protein_6e694": "protein",
    "ui.foodName_61083": "Alimento nome",
    "ui.brand_1be6f": "Marca",
    "ui.recipeName_23955": "Receita nome",
    "ui.servingsOptional_9fcb2": "Porções (opcional)",
    "ui.activityName_75c4c": "Atividade nome",
    "ui.met_f99ac": "MET",
    "ui.kcalMin_cf3fd": "kcal/min",
    "ui.optionalNoteSourceOrMeasurementHint_0b79d": "Opcional nota, fonte or measurement hint",
    "ui.brandRestaurantShopOrSource_21f1e": "Marca, restaurant, shop or fonte",
    "ui.optional_ebb06": "Opcional",
    "ui.optionalNoteSourcePortionHintOr_88ebb": "Opcional nota, fonte, portion hint or cooking detail",
    "ui.optionalNegativeIsAllowed_cb1cb": "Opcional; negative is allowed",
    "ui.optionalEmptyMeansTheWholeRecipe_cae88": "Opcional; empty means the whole receita is 1 portion",
    "ui.searchFoodIngredientOrRecipe_1f688": "Pesquisar alimento, ingrediente or receita...",
    "ui.grams_ca820": "gramas",
    "ui.pieces_6b7e9": "peças",
    "ui.running_75101": "corrida",
    "ui.general_95815": "geral",
    "ui.desktopSetupSteps_ae24e": "Desktop setup steps"
  }
};
for (const [language, values] of Object.entries(completeDesktopLanguageTranslations)) {
  translations[language] = { ...translations.en, ...(translations[language] || {}), ...values };
}
// end generated completeDesktopLanguageTranslations

// v0.11.9 final desktop i18n overrides for UI strings that were still hardcoded or too fallback-heavy.
const desktopFinalTranslations: Record<string, Record<string, string>> = {
  en: {
    "ui.apiRunning": "API running",
    "ui.apiStopped": "API stopped",
    "ui.lanApiRunningTitle": "LAN API running",
    "ui.lanApiStoppedTitle": "LAN API stopped",
    "ui.mobileCanSyncCatalog": "Your mobile app can sync the catalog from this computer.",
    "ui.startServerToPairRefresh": "Start the server to pair or refresh the mobile catalog.",
    "ui.startServerToPairMobile": "Start the server to pair mobile",
    "ui.connectedDeviceSingular": "connected device",
    "ui.connectedDevicePlural": "connected devices",
    "ui.deviceSingular": "device",
    "ui.devicePlural": "devices",
    "ui.latestDevice": "Latest",
    "ui.online": "Online",
    "ui.offline": "Offline",
    "ui.portLabel": "Port",
    "ui.versionLabel": "Version",
    "ui.never": "never",
    "ui.justNow": "just now",
    "ui.versionUnknown": "version unknown",
    "ui.settingRuntimeTitle": "Runtime",
    "ui.settingRuntimeSubtitle": "Server and background behavior.",
    "ui.settingWindowTitle": "Window behavior",
    "ui.settingWindowSubtitle": "Desktop window and tray preferences.",
    "ui.settingRememberWindowTitle": "Remember window position and size",
    "ui.settingRememberWindowBody": "Restore the latest desktop window geometry on next launch. When enabled, the latest size and position are saved automatically when the window closes.",
    "ui.settingLaunchStartupTitle": "Launch at system startup",
    "ui.settingLaunchStartupBody": "Register nutrino Desktop for Windows login startup.",
    "ui.settingRunBackgroundTitle": "Run in background",
    "ui.settingRunBackgroundBody": "Keep the tray process alive so the LAN API can keep running.",
    "ui.settingAutoStartServerTitle": "Start API server on app launch",
    "ui.settingAutoStartServerBody": "Automatically start the LAN server on the saved port.",
    "ui.settingCloseTrayTitle": "Close button hides to tray",
    "ui.settingCloseTrayBody": "When background mode is enabled, X hides the window instead of exiting.",
    "ui.settingStartHiddenTitle": "Start hidden in tray on Windows login",
    "ui.settingStartHiddenBody": "Start in the tray when launched by Windows startup.",
    "ui.csvNoteKeepHeader": "Keep the first row as the exact header row shown here.",
    "ui.csvNoteLeaveIdEmpty": "Leave id/recipe_id empty when Nutrino should generate a new local ID.",
    "ui.csvNoteDotDecimals": "Use dot decimals, for example 12.5, not 12,5.",
    "ui.csvNoteRecipeIngredients": "Recipe ingredients_json must contain food_id and amount_g values; amounts are stored in grams.",
    "ui.statusNewLower": "new",
    "ui.statusModifiedLower": "modified",
    "ui.statusUnchangedLower": "already on desktop",
    "ui.statusSkippedLower": "skipped",
    "ui.statusNew": "New",
    "ui.statusModified": "Modified",
    "ui.statusUnchanged": "Already on desktop",
    "ui.statusSkipped": "Skipped",
    "ui.inboxNoDataItems": "No data items",
    "ui.inboxNewHint": "This item does not exist on desktop yet.",
    "ui.inboxModifiedHintPrefix": "Same ID exists on desktop",
    "ui.inboxModifiedHintSuffix": "but the content differs.",
    "ui.inboxUnchangedHint": "Same ID and same content already exist on desktop.",
    "ui.settingsSaved": "Settings saved.",
    "ui.currentWindowSaved": "Current window position and size saved.",
    "ui.recipesCsvExported": "Recipes CSV exported.",
    "ui.activitiesCsvExported": "Activities CSV exported.",
    "ui.closeUnsavedPanelConfirm": "Close this data-entry panel without saving?",
    "ui.recordMobileUploadConfirm": "Record this mobile upload on the server? Exact duplicates will be merged and aliases will sync back to mobile.",
    "ui.rejectMobileUploadConfirm": "Reject this mobile upload? The phone will keep its local data, but this server will not record this batch.",
    "ui.importOverwriteConfirm": "This backup will overwrite the current desktop server catalog and settings. Continue?",
    "ui.factoryResetDesktopConfirm": "Factory reset deletes the desktop ingredient, food, recipe and activity catalog, settings and onboarding state. Continue?",
    "ui.invalidDesktopBackup": "This is not a valid nutrino desktop server backup.",
    "ui.emptyDesktopBackup": "The backup ZIP is empty (0 B).",
    "ui.exportSizeMismatch": "Export verification size mismatch",
    "ui.noticeNutrinoPurpose": "Application source code and project license.",
    "ui.noticeVuePurpose": "Reactive user interface framework for the mobile and desktop apps.",
    "ui.noticeTauriPurpose": "Native desktop/mobile runtime, app shell and platform bridge.",
    "ui.noticeRustPurpose": "Systems language and native backend ecosystem used by Tauri.",
    "ui.noticeJsZipPurpose": "Creation and validation of portable ZIP backups.",
    "ui.noticeQrCodePurpose": "Generating catalog QR codes in the desktop app.",
    "ui.noticeAndroidFsPurpose": "Android Storage Access Framework file picker used for reliable mobile ZIP backup import/export.",
    "ui.noticeLucidePurpose": "Open-source SVG icon set used across the app interface.",
    "ui.noticeLucideNote": "Some Lucide icons are derived from Feather Icons, MIT licensed.",
    "ui.noticeVitePurpose": "Development server and frontend production build tooling.",
    "ui.noticeTypeScriptPurpose": "Typed JavaScript language tooling used by the frontend codebase.",
    "ui.noticeOpenNutriTrackerPurpose": "Inspiration for a privacy-first, open-source nutrition tracker.",
    "ui.noticeOpenNutriTrackerNote": "Thank you for the inspiration. No OpenNutriTracker source code or assets are copied into Nutrino.",
    "ui.ackOpenNutriTracker": "Thank you to OpenNutriTracker for showing how good a privacy-first open-source nutrition tracker can feel.",
    "ui.ackTauriRust": "Thank you to Tauri and Rust for making a small, local-first desktop and mobile architecture possible.",
    "ui.ackFrontendTools": "Thank you to Vue, Vite, TypeScript, JSZip and Lucide for the developer tools, runtime pieces and icons used by Nutrino.",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Third-party notices and acknowledgements.",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Runtime, tray, startup, backups, privacy and project links.",
    "ui.backupsRestoreAndReset_6433e": "Backups, restore and reset.",
    "ui.storeTheCurrentPositionAndSize_161c9": "Store the current position and size immediately.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Report issue",
    "ui.star_26f93": "Star"
  },
  hu: {
    "ui.apiRunning": "API fut",
    "ui.apiStopped": "API leállítva",
    "ui.lanApiRunningTitle": "LAN API fut",
    "ui.lanApiStoppedTitle": "LAN API leállítva",
    "ui.mobileCanSyncCatalog": "A mobilapp erről a gépről tudja szinkronizálni a katalógust.",
    "ui.startServerToPairRefresh": "Indítsd el a szervert a mobil párosításához vagy frissítéséhez.",
    "ui.startServerToPairMobile": "Indítsd el a szervert a mobil párosításához",
    "ui.connectedDeviceSingular": "csatlakozott eszköz",
    "ui.connectedDevicePlural": "csatlakozott eszköz",
    "ui.deviceSingular": "eszköz",
    "ui.devicePlural": "eszköz",
    "ui.latestDevice": "Legutóbbi",
    "ui.online": "Online",
    "ui.offline": "Offline",
    "ui.portLabel": "Port",
    "ui.versionLabel": "Verzió",
    "ui.never": "soha",
    "ui.justNow": "épp most",
    "ui.versionUnknown": "ismeretlen verzió",
    "ui.settingRuntimeTitle": "Futtatás",
    "ui.settingRuntimeSubtitle": "Szerver és háttérben futás.",
    "ui.settingWindowTitle": "Ablak viselkedése",
    "ui.settingWindowSubtitle": "Desktop ablak és tálca beállítások.",
    "ui.settingRememberWindowTitle": "Ablak pozíciójának és méretének megjegyzése",
    "ui.settingRememberWindowBody": "A legutóbbi desktop ablakméret és pozíció visszaállítása indításkor. Bekapcsolva bezáráskor automatikusan menti az aktuális méretet és pozíciót.",
    "ui.settingLaunchStartupTitle": "Indítás a rendszerrel",
    "ui.settingLaunchStartupBody": "A nutrino Desktop regisztrálása Windows bejelentkezéskori indításhoz.",
    "ui.settingRunBackgroundTitle": "Futás háttérben",
    "ui.settingRunBackgroundBody": "A tálca folyamat életben tartása, hogy a LAN API tovább futhasson.",
    "ui.settingAutoStartServerTitle": "API szerver indítása appindításkor",
    "ui.settingAutoStartServerBody": "A LAN szerver automatikus indítása a mentett porton.",
    "ui.settingCloseTrayTitle": "A bezárás gomb a tálcára rejt",
    "ui.settingCloseTrayBody": "Ha a háttérben futás be van kapcsolva, az X kilépés helyett elrejti az ablakot.",
    "ui.settingStartHiddenTitle": "Rejtett indítás tálcára Windows bejelentkezéskor",
    "ui.settingStartHiddenBody": "Windows automatikus indításkor az app a tálcán induljon.",
    "ui.csvNoteKeepHeader": "Az első sor maradjon pontosan az itt látható fejléc.",
    "ui.csvNoteLeaveIdEmpty": "Hagyd üresen az id/recipe_id mezőt, ha a Nutrino generáljon új helyi ID-t.",
    "ui.csvNoteDotDecimals": "Tizedespontot használj, például 12.5, ne 12,5 formátumot.",
    "ui.csvNoteRecipeIngredients": "A recept ingredients_json mezőjében food_id és amount_g értékek kellenek; a mennyiségek grammban tárolódnak.",
    "ui.statusNewLower": "új",
    "ui.statusModifiedLower": "módosított",
    "ui.statusUnchangedLower": "már desktopon van",
    "ui.statusSkippedLower": "kihagyva",
    "ui.statusNew": "Új",
    "ui.statusModified": "Módosított",
    "ui.statusUnchanged": "Már desktopon van",
    "ui.statusSkipped": "Kihagyva",
    "ui.inboxNoDataItems": "Nincs adattétel",
    "ui.inboxNewHint": "Ez a tétel még nem létezik desktopon.",
    "ui.inboxModifiedHintPrefix": "Ugyanez az ID már létezik desktopon",
    "ui.inboxModifiedHintSuffix": "de a tartalma eltér.",
    "ui.inboxUnchangedHint": "Ugyanez az ID és tartalom már létezik desktopon.",
    "ui.settingsSaved": "Beállítások mentve.",
    "ui.currentWindowSaved": "Az aktuális ablakpozíció és méret mentve.",
    "ui.recipesCsvExported": "Receptek CSV exportálva.",
    "ui.activitiesCsvExported": "Aktivitások CSV exportálva.",
    "ui.closeUnsavedPanelConfirm": "Bezárod az adatbeviteli panelt mentés nélkül?",
    "ui.recordMobileUploadConfirm": "Rögzíted ezt a mobil feltöltést a szerveren? A pontos duplikátumok össze lesznek vonva, az aliasok pedig visszaszinkronizálnak mobilra.",
    "ui.rejectMobileUploadConfirm": "Elutasítod ezt a mobil feltöltést? A telefon megtartja a helyi adatokat, de ez a szerver nem rögzíti a csomagot.",
    "ui.importOverwriteConfirm": "Ez a mentés felülírja a jelenlegi desktop szerver katalógust és beállításokat. Folytatod?",
    "ui.factoryResetDesktopConfirm": "A gyári visszaállítás törli a desktop alapanyag-, étel-, recept- és aktivitáskatalógust, a beállításokat és az onboarding állapotot. Folytatod?",
    "ui.invalidDesktopBackup": "Ez nem érvényes nutrino desktop szerver mentés.",
    "ui.emptyDesktopBackup": "A backup ZIP üres (0 B).",
    "ui.exportSizeMismatch": "Az export ellenőrzött mérete eltér",
    "ui.noticeNutrinoPurpose": "Alkalmazás forráskódja és projektlicence.",
    "ui.noticeVuePurpose": "Reaktív felhasználói felület keretrendszer a mobil és desktop apphoz.",
    "ui.noticeTauriPurpose": "Natív desktop/mobil futtatókörnyezet, app shell és platformhíd.",
    "ui.noticeRustPurpose": "Rendszerprogramozási nyelv és natív backend ökoszisztéma Taurihoz.",
    "ui.noticeJsZipPurpose": "Hordozható ZIP mentések létrehozása és ellenőrzése.",
    "ui.noticeQrCodePurpose": "Katalógus QR kódok generálása a desktop appban.",
    "ui.noticeAndroidFsPurpose": "Android Storage Access Framework fájlválasztó a megbízható mobil ZIP backup importhoz/exporthoz.",
    "ui.noticeLucidePurpose": "Nyílt forrású SVG ikonkészlet az app felületén.",
    "ui.noticeLucideNote": "Néhány Lucide ikon Feather Icons alapú, MIT licenc alatt.",
    "ui.noticeVitePurpose": "Fejlesztői szerver és frontend production build eszköz.",
    "ui.noticeTypeScriptPurpose": "Típusos JavaScript eszközrendszer a frontend kódban.",
    "ui.noticeOpenNutriTrackerPurpose": "Inspiráció egy privacy-first, nyílt forrású táplálkozáskövetőhöz.",
    "ui.noticeOpenNutriTrackerNote": "Köszönet az inspirációért. OpenNutriTracker forráskód vagy asset nem lett átmásolva a Nutrino projektbe.",
    "ui.ackOpenNutriTracker": "Köszönet az OpenNutriTrackernek, ami megmutatta, milyen jó lehet egy privacy-first nyílt forrású táplálkozáskövető.",
    "ui.ackTauriRust": "Köszönet a Tauri és Rust projekteknek, amelyek lehetővé teszik a kicsi, local-first desktop és mobil architektúrát.",
    "ui.ackFrontendTools": "Köszönet a Vue, Vite, TypeScript, JSZip és Lucide eszközöknek a Nutrino fejlesztői alapjaiért, futtatókörnyezeti elemeiért és ikonjaiért.",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Külső licencek és köszönetnyilvánítások.",
    "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Futtatás, tálca, automatikus indítás, mentések, adatvédelem és projektlinkek.",
    "ui.backupsRestoreAndReset_6433e": "Mentések, visszaállítás és reset.",
    "ui.storeTheCurrentPositionAndSize_161c9": "Az aktuális pozíció és méret azonnali mentése.",
    "ui.repository_33fcf": "Repository",
    "ui.reportIssue_92fd0": "Hiba jelentése",
    "ui.star_26f93": "Csillag"
  },
  de: {
    "ui.apiRunning": "API läuft",
    "ui.apiStopped": "API gestoppt",
    "ui.lanApiRunningTitle": "LAN-API läuft",
    "ui.lanApiStoppedTitle": "LAN-API gestoppt",
    "ui.mobileCanSyncCatalog": "Die Mobile-App kann den Katalog von diesem Computer synchronisieren.",
    "ui.startServerToPairRefresh": "Starte den Server, um die Mobile-App zu koppeln oder den Katalog zu aktualisieren.",
    "ui.startServerToPairMobile": "Server starten, um Mobile zu koppeln",
    "ui.connectedDeviceSingular": "verbundenes Gerät",
    "ui.connectedDevicePlural": "verbundene Geräte",
    "ui.deviceSingular": "Gerät",
    "ui.devicePlural": "Geräte",
    "ui.latestDevice": "Zuletzt",
    "ui.online": "Online",
    "ui.offline": "Offline",
    "ui.portLabel": "Port",
    "ui.versionLabel": "Version",
    "ui.never": "nie",
    "ui.justNow": "gerade eben",
    "ui.versionUnknown": "Version unbekannt",
    "ui.settingRuntimeTitle": "Laufzeit",
    "ui.settingRuntimeSubtitle": "Server- und Hintergrundverhalten.",
    "ui.settingWindowTitle": "Fensterverhalten",
    "ui.settingWindowSubtitle": "Desktop-Fenster- und Tray-Einstellungen.",
    "ui.settingRememberWindowTitle": "Fensterposition und -größe merken",
    "ui.settingRememberWindowBody": "Stellt die letzte Fenstergeometrie beim nächsten Start wieder her. Wenn aktiv, werden Größe und Position beim Schließen automatisch gespeichert.",
    "ui.settingLaunchStartupTitle": "Beim Systemstart starten",
    "ui.settingLaunchStartupBody": "nutrino Desktop für den Windows-Anmeldestart registrieren.",
    "ui.settingRunBackgroundTitle": "Im Hintergrund ausführen",
    "ui.settingRunBackgroundBody": "Tray-Prozess aktiv halten, damit die LAN-API weiterlaufen kann.",
    "ui.settingAutoStartServerTitle": "API-Server beim App-Start starten",
    "ui.settingAutoStartServerBody": "LAN-Server automatisch auf dem gespeicherten Port starten.",
    "ui.settingCloseTrayTitle": "Schließen blendet in den Tray aus",
    "ui.settingCloseTrayBody": "Wenn Hintergrundmodus aktiv ist, blendet X das Fenster aus, statt die App zu beenden.",
    "ui.settingStartHiddenTitle": "Bei Windows-Anmeldung versteckt im Tray starten",
    "ui.settingStartHiddenBody": "Beim Windows-Autostart direkt im Tray starten.",
    "ui.csvNoteKeepHeader": "Die erste Zeile muss exakt die hier gezeigte Kopfzeile bleiben.",
    "ui.csvNoteLeaveIdEmpty": "id/recipe_id leer lassen, wenn Nutrino eine neue lokale ID erzeugen soll.",
    "ui.csvNoteDotDecimals": "Dezimalpunkte verwenden, zum Beispiel 12.5, nicht 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json für Rezepte muss food_id und amount_g enthalten; Mengen werden in Gramm gespeichert.",
    "ui.statusNewLower": "neu", "ui.statusModifiedLower": "geändert", "ui.statusUnchangedLower": "bereits auf Desktop", "ui.statusSkippedLower": "übersprungen",
    "ui.statusNew": "Neu", "ui.statusModified": "Geändert", "ui.statusUnchanged": "Bereits auf Desktop", "ui.statusSkipped": "Übersprungen",
    "ui.inboxNoDataItems": "Keine Datenelemente", "ui.inboxNewHint": "Dieses Element existiert auf dem Desktop noch nicht.", "ui.inboxModifiedHintPrefix": "Dieselbe ID existiert auf dem Desktop", "ui.inboxModifiedHintSuffix": "aber der Inhalt unterscheidet sich.", "ui.inboxUnchangedHint": "Dieselbe ID und derselbe Inhalt existieren bereits auf dem Desktop.",
    "ui.settingsSaved": "Einstellungen gespeichert.", "ui.currentWindowSaved": "Aktuelle Fensterposition und -größe gespeichert.", "ui.recipesCsvExported": "Rezepte-CSV exportiert.", "ui.activitiesCsvExported": "Aktivitäten-CSV exportiert.",
    "ui.closeUnsavedPanelConfirm": "Dieses Eingabefenster ohne Speichern schließen?", "ui.recordMobileUploadConfirm": "Diesen mobilen Upload auf dem Server speichern? Exakte Duplikate werden zusammengeführt und Aliase zurück zum Mobilgerät synchronisiert.", "ui.rejectMobileUploadConfirm": "Diesen mobilen Upload ablehnen? Das Telefon behält seine lokalen Daten, aber dieser Server speichert den Stapel nicht.", "ui.importOverwriteConfirm": "Dieses Backup überschreibt den aktuellen Desktop-Serverkatalog und die Einstellungen. Fortfahren?", "ui.factoryResetDesktopConfirm": "Der Werksreset löscht Desktop-Katalog, Einstellungen und Onboarding-Status. Fortfahren?", "ui.invalidDesktopBackup": "Dies ist kein gültiges nutrino Desktop-Server-Backup.", "ui.emptyDesktopBackup": "Die Backup-ZIP ist leer (0 B).", "ui.exportSizeMismatch": "Export-Prüfgröße stimmt nicht überein",
    "ui.noticeNutrinoPurpose": "Quellcode der Anwendung und Projektlizenz.", "ui.noticeVuePurpose": "Reaktives UI-Framework für Mobile- und Desktop-App.", "ui.noticeTauriPurpose": "Native Desktop-/Mobile-Laufzeit, App-Shell und Plattformbrücke.", "ui.noticeRustPurpose": "Systemsprache und natives Backend-Ökosystem für Tauri.", "ui.noticeJsZipPurpose": "Erstellung und Prüfung portabler ZIP-Backups.", "ui.noticeQrCodePurpose": "Erzeugung von Katalog-QR-Codes in der Desktop-App.", "ui.noticeAndroidFsPurpose": "Android-Dateiauswahl für zuverlässigen mobilen ZIP-Backup-Import und -Export.", "ui.noticeLucidePurpose": "Open-Source-SVG-Icons für die App-Oberfläche.", "ui.noticeLucideNote": "Einige Lucide-Icons basieren auf Feather Icons unter MIT-Lizenz.", "ui.noticeVitePurpose": "Entwicklungsserver und Frontend-Produktionsbuild.", "ui.noticeTypeScriptPurpose": "Typisierte JavaScript-Werkzeuge im Frontend-Code.", "ui.noticeOpenNutriTrackerPurpose": "Inspiration für einen datenschutzorientierten Open-Source-Ernährungstracker.", "ui.noticeOpenNutriTrackerNote": "Danke für die Inspiration. Kein OpenNutriTracker-Quellcode und keine Assets werden in Nutrino kopiert.",
    "ui.ackOpenNutriTracker": "Danke an OpenNutriTracker dafür, zu zeigen, wie gut ein datenschutzorientierter Open-Source-Ernährungstracker sein kann.", "ui.ackTauriRust": "Danke an Tauri und Rust für die kleine, local-first Desktop- und Mobile-Architektur.", "ui.ackFrontendTools": "Danke an Vue, Vite, TypeScript, JSZip und Lucide für Werkzeuge, Laufzeitteile und Icons von Nutrino.",
    "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Drittanbieter-Hinweise und Danksagungen.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Laufzeit, Tray, Autostart, Backups, Datenschutz und Projektlinks.", "ui.backupsRestoreAndReset_6433e": "Backups, Wiederherstellung und Zurücksetzen.", "ui.storeTheCurrentPositionAndSize_161c9": "Aktuelle Position und Größe sofort speichern.", "ui.repository_33fcf": "Repository", "ui.reportIssue_92fd0": "Problem melden", "ui.star_26f93": "Stern"
  }
};
const desktopFinalFallbacks: Record<string, Record<string, string>> = {
  fr: {
    "ui.apiRunning": "API en cours", "ui.apiStopped": "API arrêtée", "ui.lanApiRunningTitle": "API LAN en cours", "ui.lanApiStoppedTitle": "API LAN arrêtée", "ui.mobileCanSyncCatalog": "L’app mobile peut synchroniser le catalogue depuis cet ordinateur.", "ui.startServerToPairRefresh": "Démarre le serveur pour associer ou actualiser le catalogue mobile.", "ui.startServerToPairMobile": "Démarre le serveur pour associer le mobile", "ui.connectedDeviceSingular": "appareil connecté", "ui.connectedDevicePlural": "appareils connectés", "ui.deviceSingular": "appareil", "ui.devicePlural": "appareils", "ui.latestDevice": "Dernier", "ui.online": "En ligne", "ui.offline": "Hors ligne", "ui.portLabel": "Port", "ui.versionLabel": "Version", "ui.never": "jamais", "ui.justNow": "à l’instant", "ui.versionUnknown": "version inconnue", "ui.settingRuntimeTitle": "Exécution", "ui.settingRuntimeSubtitle": "Comportement du serveur et de l’arrière-plan.", "ui.settingWindowTitle": "Comportement de la fenêtre", "ui.settingWindowSubtitle": "Préférences de fenêtre desktop et de zone de notification.", "ui.settingRememberWindowTitle": "Mémoriser la position et la taille de la fenêtre", "ui.settingRememberWindowBody": "Restaure la dernière géométrie de fenêtre au prochain lancement. Si activé, la taille et la position sont enregistrées automatiquement à la fermeture.", "ui.settingLaunchStartupTitle": "Lancer au démarrage du système", "ui.settingLaunchStartupBody": "Enregistrer nutrino Desktop au démarrage de session Windows.", "ui.settingRunBackgroundTitle": "Exécuter en arrière-plan", "ui.settingRunBackgroundBody": "Garder le processus de zone de notification actif pour que l’API LAN continue de fonctionner.", "ui.settingAutoStartServerTitle": "Démarrer le serveur API au lancement", "ui.settingAutoStartServerBody": "Démarre automatiquement le serveur LAN sur le port enregistré.", "ui.settingCloseTrayTitle": "Le bouton fermer masque dans la zone de notification", "ui.settingCloseTrayBody": "Quand le mode arrière-plan est activé, X masque la fenêtre au lieu de quitter.", "ui.settingStartHiddenTitle": "Démarrer masqué dans la zone de notification à la connexion Windows", "ui.settingStartHiddenBody": "Démarre dans la zone de notification lors du démarrage Windows.", "ui.csvNoteKeepHeader": "Conserve la première ligne exactement comme l’en-tête affiché ici.", "ui.csvNoteLeaveIdEmpty": "Laisse id/recipe_id vide si Nutrino doit générer un nouvel ID local.", "ui.csvNoteDotDecimals": "Utilise le point décimal, par exemple 12.5, pas 12,5.", "ui.csvNoteRecipeIngredients": "Le champ ingredients_json des recettes doit contenir food_id et amount_g; les quantités sont stockées en grammes.", "ui.statusNewLower": "nouveaux", "ui.statusModifiedLower": "modifiés", "ui.statusUnchangedLower": "déjà sur desktop", "ui.statusSkippedLower": "ignorés", "ui.statusNew": "Nouveau", "ui.statusModified": "Modifié", "ui.statusUnchanged": "Déjà sur desktop", "ui.statusSkipped": "Ignoré", "ui.inboxNoDataItems": "Aucun élément", "ui.inboxNewHint": "Cet élément n’existe pas encore sur desktop.", "ui.inboxModifiedHintPrefix": "Le même ID existe sur desktop", "ui.inboxModifiedHintSuffix": "mais le contenu est différent.", "ui.inboxUnchangedHint": "Le même ID et le même contenu existent déjà sur desktop.", "ui.settingsSaved": "Paramètres enregistrés.", "ui.currentWindowSaved": "Position et taille actuelles de la fenêtre enregistrées.", "ui.recipesCsvExported": "CSV des recettes exporté.", "ui.activitiesCsvExported": "CSV des activités exporté.", "ui.closeUnsavedPanelConfirm": "Fermer ce panneau de saisie sans enregistrer ?", "ui.recordMobileUploadConfirm": "Enregistrer cet envoi mobile sur le serveur ? Les doublons exacts seront fusionnés et les alias seront resynchronisés vers le mobile.", "ui.rejectMobileUploadConfirm": "Rejeter cet envoi mobile ? Le téléphone gardera ses données locales, mais ce serveur n’enregistrera pas ce lot.", "ui.importOverwriteConfirm": "Cette sauvegarde écrasera le catalogue et les paramètres actuels du serveur desktop. Continuer ?", "ui.factoryResetDesktopConfirm": "La réinitialisation supprime le catalogue desktop, les paramètres et l’état d’onboarding. Continuer ?", "ui.invalidDesktopBackup": "Ce n’est pas une sauvegarde valide du serveur desktop nutrino.", "ui.emptyDesktopBackup": "Le ZIP de sauvegarde est vide (0 B).", "ui.exportSizeMismatch": "La taille vérifiée de l’export ne correspond pas", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Mentions tierces et remerciements.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Exécution, zone de notification, démarrage, sauvegardes, confidentialité et liens projet.", "ui.backupsRestoreAndReset_6433e": "Sauvegardes, restauration et réinitialisation.", "ui.storeTheCurrentPositionAndSize_161c9": "Enregistrer immédiatement la position et la taille actuelles.", "ui.repository_33fcf": "Dépôt", "ui.reportIssue_92fd0": "Signaler un problème", "ui.star_26f93": "Étoile"
  },
  ru: {
    "ui.apiRunning": "API работает", "ui.apiStopped": "API остановлен", "ui.lanApiRunningTitle": "LAN API работает", "ui.lanApiStoppedTitle": "LAN API остановлен", "ui.mobileCanSyncCatalog": "Мобильное приложение может синхронизировать каталог с этого компьютера.", "ui.startServerToPairRefresh": "Запустите сервер, чтобы подключить мобильное приложение или обновить каталог.", "ui.startServerToPairMobile": "Запустите сервер для подключения мобильного приложения", "ui.connectedDeviceSingular": "подключенное устройство", "ui.connectedDevicePlural": "подключенных устройств", "ui.deviceSingular": "устройство", "ui.devicePlural": "устройства", "ui.latestDevice": "Последнее", "ui.online": "Онлайн", "ui.offline": "Офлайн", "ui.portLabel": "Порт", "ui.versionLabel": "Версия", "ui.never": "никогда", "ui.justNow": "только что", "ui.versionUnknown": "версия неизвестна", "ui.settingRuntimeTitle": "Выполнение", "ui.settingRuntimeSubtitle": "Поведение сервера и фонового режима.", "ui.settingWindowTitle": "Поведение окна", "ui.settingWindowSubtitle": "Настройки окна рабочего стола и трея.", "ui.settingRememberWindowTitle": "Запоминать положение и размер окна", "ui.settingRememberWindowBody": "Восстанавливает последнюю геометрию окна при следующем запуске. Если включено, размер и положение сохраняются автоматически при закрытии.", "ui.settingLaunchStartupTitle": "Запускать вместе с системой", "ui.settingLaunchStartupBody": "Добавить nutrino Desktop в автозапуск Windows.", "ui.settingRunBackgroundTitle": "Работать в фоне", "ui.settingRunBackgroundBody": "Оставлять процесс в трее активным, чтобы LAN API продолжал работать.", "ui.settingAutoStartServerTitle": "Запускать API-сервер при старте приложения", "ui.settingAutoStartServerBody": "Автоматически запускать LAN-сервер на сохраненном порту.", "ui.settingCloseTrayTitle": "Кнопка закрытия скрывает в трей", "ui.settingCloseTrayBody": "Если включен фоновый режим, X скрывает окно вместо выхода.", "ui.settingStartHiddenTitle": "Запускать скрытым в трее при входе в Windows", "ui.settingStartHiddenBody": "Запускать в трее при автозапуске Windows.", "ui.csvNoteKeepHeader": "Первая строка должна точно совпадать с показанным здесь заголовком.", "ui.csvNoteLeaveIdEmpty": "Оставьте id/recipe_id пустым, если Nutrino должен создать новый локальный ID.", "ui.csvNoteDotDecimals": "Используйте точку для дробей, например 12.5, а не 12,5.", "ui.csvNoteRecipeIngredients": "ingredients_json рецепта должен содержать food_id и amount_g; количества хранятся в граммах.", "ui.statusNewLower": "новые", "ui.statusModifiedLower": "измененные", "ui.statusUnchangedLower": "уже на desktop", "ui.statusSkippedLower": "пропущенные", "ui.statusNew": "Новое", "ui.statusModified": "Изменено", "ui.statusUnchanged": "Уже на desktop", "ui.statusSkipped": "Пропущено", "ui.inboxNoDataItems": "Нет элементов данных", "ui.inboxNewHint": "Этого элемента еще нет на desktop.", "ui.inboxModifiedHintPrefix": "Такой же ID уже есть на desktop", "ui.inboxModifiedHintSuffix": "но содержимое отличается.", "ui.inboxUnchangedHint": "Такой же ID и содержимое уже есть на desktop.", "ui.settingsSaved": "Настройки сохранены.", "ui.currentWindowSaved": "Текущие положение и размер окна сохранены.", "ui.recipesCsvExported": "CSV рецептов экспортирован.", "ui.activitiesCsvExported": "CSV активностей экспортирован.", "ui.closeUnsavedPanelConfirm": "Закрыть панель ввода без сохранения?", "ui.recordMobileUploadConfirm": "Записать эту мобильную отправку на сервер? Точные дубликаты будут объединены, а алиасы синхронизируются обратно на мобильное устройство.", "ui.rejectMobileUploadConfirm": "Отклонить эту мобильную отправку? Телефон сохранит локальные данные, но сервер не запишет этот пакет.", "ui.importOverwriteConfirm": "Эта резервная копия перезапишет текущий каталог и настройки desktop-сервера. Продолжить?", "ui.factoryResetDesktopConfirm": "Сброс удалит desktop-каталог, настройки и состояние onboarding. Продолжить?", "ui.invalidDesktopBackup": "Это не действительная резервная копия desktop-сервера nutrino.", "ui.emptyDesktopBackup": "ZIP резервной копии пуст (0 B).", "ui.exportSizeMismatch": "Проверенный размер экспорта не совпадает", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Уведомления сторонних компонентов и благодарности.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Выполнение, трей, автозапуск, резервные копии, приватность и ссылки проекта.", "ui.backupsRestoreAndReset_6433e": "Резервные копии, восстановление и сброс.", "ui.storeTheCurrentPositionAndSize_161c9": "Немедленно сохранить текущие положение и размер.", "ui.repository_33fcf": "Репозиторий", "ui.reportIssue_92fd0": "Сообщить о проблеме", "ui.star_26f93": "Звезда"
  },
  uk: {
    "ui.apiRunning": "API працює", "ui.apiStopped": "API зупинено", "ui.lanApiRunningTitle": "LAN API працює", "ui.lanApiStoppedTitle": "LAN API зупинено", "ui.mobileCanSyncCatalog": "Мобільний застосунок може синхронізувати каталог із цього комп’ютера.", "ui.startServerToPairRefresh": "Запусти сервер, щоб під’єднати мобільний застосунок або оновити каталог.", "ui.startServerToPairMobile": "Запусти сервер для під’єднання мобільного застосунку", "ui.connectedDeviceSingular": "під’єднаний пристрій", "ui.connectedDevicePlural": "під’єднані пристрої", "ui.deviceSingular": "пристрій", "ui.devicePlural": "пристрої", "ui.latestDevice": "Останній", "ui.online": "Онлайн", "ui.offline": "Офлайн", "ui.portLabel": "Порт", "ui.versionLabel": "Версія", "ui.never": "ніколи", "ui.justNow": "щойно", "ui.versionUnknown": "версія невідома", "ui.settingRuntimeTitle": "Виконання", "ui.settingRuntimeSubtitle": "Поведінка сервера та фонового режиму.", "ui.settingWindowTitle": "Поведінка вікна", "ui.settingWindowSubtitle": "Налаштування desktop-вікна та трея.", "ui.settingRememberWindowTitle": "Запам’ятовувати позицію і розмір вікна", "ui.settingRememberWindowBody": "Відновлює останню геометрію вікна під час наступного запуску. Якщо ввімкнено, розмір і позиція автоматично зберігаються під час закриття.", "ui.settingLaunchStartupTitle": "Запускати разом із системою", "ui.settingLaunchStartupBody": "Додати nutrino Desktop до автозапуску Windows.", "ui.settingRunBackgroundTitle": "Працювати у фоні", "ui.settingRunBackgroundBody": "Тримати процес у треї активним, щоб LAN API продовжував працювати.", "ui.settingAutoStartServerTitle": "Запускати API-сервер під час старту застосунку", "ui.settingAutoStartServerBody": "Автоматично запускати LAN-сервер на збереженому порті.", "ui.settingCloseTrayTitle": "Кнопка закриття ховає у трей", "ui.settingCloseTrayBody": "Коли фоновий режим увімкнено, X ховає вікно замість виходу.", "ui.settingStartHiddenTitle": "Запускати приховано у треї під час входу в Windows", "ui.settingStartHiddenBody": "Запускати у треї під час автозапуску Windows.", "ui.csvNoteKeepHeader": "Перший рядок має точно відповідати показаному заголовку.", "ui.csvNoteLeaveIdEmpty": "Залиш id/recipe_id порожнім, якщо Nutrino має створити новий локальний ID.", "ui.csvNoteDotDecimals": "Використовуй крапку для дробів, наприклад 12.5, а не 12,5.", "ui.csvNoteRecipeIngredients": "ingredients_json рецепта має містити food_id і amount_g; кількості зберігаються у грамах.", "ui.statusNewLower": "нові", "ui.statusModifiedLower": "змінені", "ui.statusUnchangedLower": "вже на desktop", "ui.statusSkippedLower": "пропущені", "ui.statusNew": "Нове", "ui.statusModified": "Змінено", "ui.statusUnchanged": "Вже на desktop", "ui.statusSkipped": "Пропущено", "ui.inboxNoDataItems": "Немає елементів даних", "ui.inboxNewHint": "Цього елемента ще немає на desktop.", "ui.inboxModifiedHintPrefix": "Такий самий ID вже є на desktop", "ui.inboxModifiedHintSuffix": "але вміст відрізняється.", "ui.inboxUnchangedHint": "Такий самий ID і вміст вже є на desktop.", "ui.settingsSaved": "Налаштування збережено.", "ui.currentWindowSaved": "Поточні позицію і розмір вікна збережено.", "ui.recipesCsvExported": "CSV рецептів експортовано.", "ui.activitiesCsvExported": "CSV активностей експортовано.", "ui.closeUnsavedPanelConfirm": "Закрити панель введення без збереження?", "ui.recordMobileUploadConfirm": "Записати це мобільне завантаження на сервер? Точні дублікати буде об’єднано, а псевдоніми синхронізуються назад на мобільний.", "ui.rejectMobileUploadConfirm": "Відхилити це мобільне завантаження? Телефон збереже локальні дані, але сервер не запише цей пакет.", "ui.importOverwriteConfirm": "Ця резервна копія перезапише поточний каталог і налаштування desktop-сервера. Продовжити?", "ui.factoryResetDesktopConfirm": "Скидання видалить desktop-каталог, налаштування та стан onboarding. Продовжити?", "ui.invalidDesktopBackup": "Це не дійсна резервна копія desktop-сервера nutrino.", "ui.emptyDesktopBackup": "ZIP резервної копії порожній (0 B).", "ui.exportSizeMismatch": "Перевірений розмір експорту не збігається", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Повідомлення сторонніх компонентів і подяки.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Виконання, трей, автозапуск, резервні копії, приватність і посилання проєкту.", "ui.backupsRestoreAndReset_6433e": "Резервні копії, відновлення та скидання.", "ui.storeTheCurrentPositionAndSize_161c9": "Негайно зберегти поточні позицію і розмір.", "ui.repository_33fcf": "Репозиторій", "ui.reportIssue_92fd0": "Повідомити про проблему", "ui.star_26f93": "Зірка"
  },
  zh: {
    "ui.apiRunning": "API 正在运行", "ui.apiStopped": "API 已停止", "ui.lanApiRunningTitle": "LAN API 正在运行", "ui.lanApiStoppedTitle": "LAN API 已停止", "ui.mobileCanSyncCatalog": "移动应用可以从这台电脑同步目录。", "ui.startServerToPairRefresh": "启动服务器以配对移动端或刷新移动目录。", "ui.startServerToPairMobile": "启动服务器以配对移动端", "ui.connectedDeviceSingular": "已连接设备", "ui.connectedDevicePlural": "已连接设备", "ui.deviceSingular": "设备", "ui.devicePlural": "设备", "ui.latestDevice": "最新", "ui.online": "在线", "ui.offline": "离线", "ui.portLabel": "端口", "ui.versionLabel": "版本", "ui.never": "从未", "ui.justNow": "刚刚", "ui.versionUnknown": "版本未知", "ui.settingRuntimeTitle": "运行", "ui.settingRuntimeSubtitle": "服务器和后台行为。", "ui.settingWindowTitle": "窗口行为", "ui.settingWindowSubtitle": "桌面窗口和托盘设置。", "ui.settingRememberWindowTitle": "记住窗口位置和大小", "ui.settingRememberWindowBody": "下次启动时恢复上一次桌面窗口位置和大小。启用后，关闭窗口时会自动保存最新大小和位置。", "ui.settingLaunchStartupTitle": "随系统启动", "ui.settingLaunchStartupBody": "将 nutrino Desktop 注册到 Windows 登录启动项。", "ui.settingRunBackgroundTitle": "后台运行", "ui.settingRunBackgroundBody": "保持托盘进程运行，让 LAN API 可以继续工作。", "ui.settingAutoStartServerTitle": "应用启动时启动 API 服务器", "ui.settingAutoStartServerBody": "使用保存的端口自动启动 LAN 服务器。", "ui.settingCloseTrayTitle": "关闭按钮隐藏到托盘", "ui.settingCloseTrayBody": "启用后台模式时，X 会隐藏窗口而不是退出。", "ui.settingStartHiddenTitle": "Windows 登录时隐藏到托盘启动", "ui.settingStartHiddenBody": "由 Windows 自动启动时直接在托盘中启动。", "ui.csvNoteKeepHeader": "第一行必须保持为这里显示的完整表头。", "ui.csvNoteLeaveIdEmpty": "如果要让 Nutrino 生成新的本地 ID，请留空 id/recipe_id。", "ui.csvNoteDotDecimals": "使用小数点，例如 12.5，不要用 12,5。", "ui.csvNoteRecipeIngredients": "配方的 ingredients_json 必须包含 food_id 和 amount_g；数量以克保存。", "ui.statusNewLower": "新增", "ui.statusModifiedLower": "已修改", "ui.statusUnchangedLower": "已在桌面端", "ui.statusSkippedLower": "已跳过", "ui.statusNew": "新增", "ui.statusModified": "已修改", "ui.statusUnchanged": "已在桌面端", "ui.statusSkipped": "已跳过", "ui.inboxNoDataItems": "没有数据项", "ui.inboxNewHint": "此项目尚不存在于桌面端。", "ui.inboxModifiedHintPrefix": "相同 ID 已存在于桌面端", "ui.inboxModifiedHintSuffix": "但内容不同。", "ui.inboxUnchangedHint": "相同 ID 和内容已存在于桌面端。", "ui.settingsSaved": "设置已保存。", "ui.currentWindowSaved": "当前窗口位置和大小已保存。", "ui.recipesCsvExported": "食谱 CSV 已导出。", "ui.activitiesCsvExported": "活动 CSV 已导出。", "ui.closeUnsavedPanelConfirm": "不保存并关闭此数据输入面板？", "ui.recordMobileUploadConfirm": "将此移动端上传记录到服务器？完全重复项会合并，别名会同步回移动端。", "ui.rejectMobileUploadConfirm": "拒绝此移动端上传？手机会保留本地数据，但此服务器不会记录该批次。", "ui.importOverwriteConfirm": "此备份会覆盖当前桌面服务器目录和设置。继续？", "ui.factoryResetDesktopConfirm": "恢复出厂设置会删除桌面目录、设置和引导状态。继续？", "ui.invalidDesktopBackup": "这不是有效的 nutrino 桌面服务器备份。", "ui.emptyDesktopBackup": "备份 ZIP 为空（0 B）。", "ui.exportSizeMismatch": "导出校验大小不匹配", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "第三方声明与致谢。", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "运行、托盘、启动、备份、隐私和项目链接。", "ui.backupsRestoreAndReset_6433e": "备份、恢复和重置。", "ui.storeTheCurrentPositionAndSize_161c9": "立即保存当前位置和大小。", "ui.repository_33fcf": "代码仓库", "ui.reportIssue_92fd0": "报告问题", "ui.star_26f93": "加星"
  }
};
const desktopCompactTranslations: Record<string, Partial<Record<keyof typeof desktopFinalTranslations.en, string>>> = {
  sk: { "ui.apiRunning": "API beží", "ui.apiStopped": "API zastavené", "ui.lanApiRunningTitle": "LAN API beží", "ui.lanApiStoppedTitle": "LAN API zastavené", "ui.mobileCanSyncCatalog": "Mobilná aplikácia môže synchronizovať katalóg z tohto počítača.", "ui.startServerToPairRefresh": "Spusti server na spárovanie alebo obnovenie mobilného katalógu.", "ui.startServerToPairMobile": "Spusti server na spárovanie mobilu", "ui.online": "Online", "ui.offline": "Offline", "ui.portLabel": "Port", "ui.versionLabel": "Verzia", "ui.never": "nikdy", "ui.justNow": "práve teraz", "ui.versionUnknown": "neznáma verzia", "ui.settingRuntimeTitle": "Beh", "ui.settingRuntimeSubtitle": "Správanie servera a pozadia.", "ui.settingWindowTitle": "Správanie okna", "ui.settingWindowSubtitle": "Nastavenia desktop okna a systémovej lišty.", "ui.settingRememberWindowTitle": "Zapamätať pozíciu a veľkosť okna", "ui.settingRememberWindowBody": "Pri ďalšom spustení obnoví poslednú geometriu okna. Ak je zapnuté, pri zatvorení automaticky uloží aktuálnu veľkosť a pozíciu.", "ui.settingLaunchStartupTitle": "Spustiť pri štarte systému", "ui.settingLaunchStartupBody": "Zaregistrovať nutrino Desktop pre spustenie po prihlásení do Windows.", "ui.settingRunBackgroundTitle": "Bežať na pozadí", "ui.settingRunBackgroundBody": "Udržať proces v lište aktívny, aby LAN API mohlo bežať.", "ui.settingAutoStartServerTitle": "Spustiť API server pri štarte aplikácie", "ui.settingAutoStartServerBody": "Automaticky spustiť LAN server na uloženom porte.", "ui.settingCloseTrayTitle": "Tlačidlo zatvorenia skryje do lišty", "ui.settingCloseTrayBody": "Keď je zapnuté pozadie, X skryje okno namiesto ukončenia.", "ui.settingStartHiddenTitle": "Spustiť skryté v lište po prihlásení do Windows", "ui.settingStartHiddenBody": "Spustiť v lište pri automatickom štarte Windows.", "ui.settingsSaved": "Nastavenia uložené.", "ui.currentWindowSaved": "Aktuálna pozícia a veľkosť okna uložené.", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Oznámenia tretích strán a poďakovania.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Beh, lišta, štart, zálohy, súkromie a odkazy projektu.", "ui.backupsRestoreAndReset_6433e": "Zálohy, obnova a reset.", "ui.storeTheCurrentPositionAndSize_161c9": "Okamžite uložiť aktuálnu pozíciu a veľkosť.", "ui.repository_33fcf": "Repozitár", "ui.reportIssue_92fd0": "Nahlásiť problém", "ui.star_26f93": "Hviezdička" },
  ro: { "ui.apiRunning": "API rulează", "ui.apiStopped": "API oprit", "ui.lanApiRunningTitle": "API LAN rulează", "ui.lanApiStoppedTitle": "API LAN oprit", "ui.mobileCanSyncCatalog": "Aplicația mobilă poate sincroniza catalogul de pe acest computer.", "ui.startServerToPairRefresh": "Pornește serverul pentru asociere sau reîmprospătarea catalogului mobil.", "ui.startServerToPairMobile": "Pornește serverul pentru asocierea mobilului", "ui.online": "Online", "ui.offline": "Offline", "ui.portLabel": "Port", "ui.versionLabel": "Versiune", "ui.never": "niciodată", "ui.justNow": "chiar acum", "ui.versionUnknown": "versiune necunoscută", "ui.settingRuntimeTitle": "Rulare", "ui.settingRuntimeSubtitle": "Comportamentul serverului și al fundalului.", "ui.settingWindowTitle": "Comportamentul ferestrei", "ui.settingWindowSubtitle": "Preferințe pentru fereastra desktop și tray.", "ui.settingRememberWindowTitle": "Reține poziția și dimensiunea ferestrei", "ui.settingRememberWindowBody": "Restaurează ultima geometrie a ferestrei la următoarea pornire. Când este activ, dimensiunea și poziția se salvează automat la închidere.", "ui.settingLaunchStartupTitle": "Lansează la pornirea sistemului", "ui.settingLaunchStartupBody": "Înregistrează nutrino Desktop pentru pornirea la autentificarea Windows.", "ui.settingRunBackgroundTitle": "Rulează în fundal", "ui.settingRunBackgroundBody": "Ține procesul din tray activ pentru ca API-ul LAN să poată rula.", "ui.settingAutoStartServerTitle": "Pornește serverul API la lansarea aplicației", "ui.settingAutoStartServerBody": "Pornește automat serverul LAN pe portul salvat.", "ui.settingCloseTrayTitle": "Butonul de închidere ascunde în tray", "ui.settingCloseTrayBody": "Când modul fundal este activ, X ascunde fereastra în loc să iasă.", "ui.settingStartHiddenTitle": "Pornește ascuns în tray la autentificarea Windows", "ui.settingStartHiddenBody": "Pornește în tray când este lansat de Windows startup.", "ui.settingsSaved": "Setări salvate.", "ui.currentWindowSaved": "Poziția și dimensiunea curentă a ferestrei au fost salvate.", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Notificări terțe și mulțumiri.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Rulare, tray, pornire, backupuri, confidențialitate și linkuri proiect.", "ui.backupsRestoreAndReset_6433e": "Backupuri, restaurare și resetare.", "ui.storeTheCurrentPositionAndSize_161c9": "Salvează imediat poziția și dimensiunea curentă.", "ui.repository_33fcf": "Repository", "ui.reportIssue_92fd0": "Raportează o problemă", "ui.star_26f93": "Stea" },
  cs: { "ui.apiRunning": "API běží", "ui.apiStopped": "API zastaveno", "ui.lanApiRunningTitle": "LAN API běží", "ui.lanApiStoppedTitle": "LAN API zastaveno", "ui.mobileCanSyncCatalog": "Mobilní aplikace může synchronizovat katalog z tohoto počítače.", "ui.startServerToPairRefresh": "Spusť server pro spárování nebo obnovení mobilního katalogu.", "ui.startServerToPairMobile": "Spusť server pro spárování mobilu", "ui.online": "Online", "ui.offline": "Offline", "ui.portLabel": "Port", "ui.versionLabel": "Verze", "ui.never": "nikdy", "ui.justNow": "právě teď", "ui.versionUnknown": "neznámá verze", "ui.settingRuntimeTitle": "Běh", "ui.settingRuntimeSubtitle": "Chování serveru a pozadí.", "ui.settingWindowTitle": "Chování okna", "ui.settingWindowSubtitle": "Nastavení desktopového okna a systémové lišty.", "ui.settingRememberWindowTitle": "Pamatovat pozici a velikost okna", "ui.settingRememberWindowBody": "Při dalším spuštění obnoví poslední geometrii okna. Je-li zapnuto, při zavření automaticky uloží aktuální velikost a pozici.", "ui.settingLaunchStartupTitle": "Spustit při startu systému", "ui.settingLaunchStartupBody": "Registrovat nutrino Desktop pro spuštění po přihlášení do Windows.", "ui.settingRunBackgroundTitle": "Běžet na pozadí", "ui.settingRunBackgroundBody": "Udržet proces v liště aktivní, aby LAN API mohlo běžet.", "ui.settingAutoStartServerTitle": "Spustit API server při spuštění aplikace", "ui.settingAutoStartServerBody": "Automaticky spustit LAN server na uloženém portu.", "ui.settingCloseTrayTitle": "Tlačítko zavření skryje do lišty", "ui.settingCloseTrayBody": "Když je zapnuté pozadí, X skryje okno místo ukončení.", "ui.settingStartHiddenTitle": "Spustit skryté v liště po přihlášení do Windows", "ui.settingStartHiddenBody": "Spustit v liště při automatickém startu Windows.", "ui.settingsSaved": "Nastavení uloženo.", "ui.currentWindowSaved": "Aktuální pozice a velikost okna uloženy.", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Oznámení třetích stran a poděkování.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Běh, lišta, start, zálohy, soukromí a odkazy projektu.", "ui.backupsRestoreAndReset_6433e": "Zálohy, obnovení a reset.", "ui.storeTheCurrentPositionAndSize_161c9": "Okamžitě uložit aktuální pozici a velikost.", "ui.repository_33fcf": "Repozitář", "ui.reportIssue_92fd0": "Nahlásit problém", "ui.star_26f93": "Hvězda" },
  sl: { "ui.apiRunning": "API deluje", "ui.apiStopped": "API ustavljen", "ui.lanApiRunningTitle": "LAN API deluje", "ui.lanApiStoppedTitle": "LAN API ustavljen", "ui.mobileCanSyncCatalog": "Mobilna aplikacija lahko sinhronizira katalog iz tega računalnika.", "ui.startServerToPairRefresh": "Zaženi strežnik za seznanitev ali osvežitev mobilnega kataloga.", "ui.startServerToPairMobile": "Zaženi strežnik za seznanitev mobilne aplikacije", "ui.online": "Online", "ui.offline": "Offline", "ui.portLabel": "Vrata", "ui.versionLabel": "Različica", "ui.never": "nikoli", "ui.justNow": "pravkar", "ui.versionUnknown": "neznana različica", "ui.settingRuntimeTitle": "Izvajanje", "ui.settingRuntimeSubtitle": "Obnašanje strežnika in ozadja.", "ui.settingWindowTitle": "Obnašanje okna", "ui.settingWindowSubtitle": "Nastavitve desktop okna in sistemske vrstice.", "ui.settingRememberWindowTitle": "Zapomni si položaj in velikost okna", "ui.settingRememberWindowBody": "Ob naslednjem zagonu obnovi zadnjo geometrijo okna. Ko je vklopljeno, se velikost in položaj samodejno shranita ob zapiranju.", "ui.settingLaunchStartupTitle": "Zaženi ob zagonu sistema", "ui.settingLaunchStartupBody": "Registriraj nutrino Desktop za zagon ob prijavi v Windows.", "ui.settingRunBackgroundTitle": "Deluj v ozadju", "ui.settingRunBackgroundBody": "Ohrani proces v vrstici aktiven, da LAN API lahko deluje.", "ui.settingAutoStartServerTitle": "Zaženi API strežnik ob zagonu aplikacije", "ui.settingAutoStartServerBody": "Samodejno zaženi LAN strežnik na shranjenih vratih.", "ui.settingCloseTrayTitle": "Gumb za zapiranje skrije v vrstico", "ui.settingCloseTrayBody": "Ko je ozadje vklopljeno, X skrije okno namesto izhoda.", "ui.settingStartHiddenTitle": "Zaženi skrito v vrstici ob prijavi v Windows", "ui.settingStartHiddenBody": "Zaženi v vrstici ob samodejnem zagonu Windows.", "ui.settingsSaved": "Nastavitve shranjene.", "ui.currentWindowSaved": "Trenutni položaj in velikost okna shranjena.", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Obvestila tretjih oseb in zahvale.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Izvajanje, vrstica, zagon, varnostne kopije, zasebnost in povezave projekta.", "ui.backupsRestoreAndReset_6433e": "Varnostne kopije, obnovitev in ponastavitev.", "ui.storeTheCurrentPositionAndSize_161c9": "Takoj shrani trenutni položaj in velikost.", "ui.repository_33fcf": "Repozitorij", "ui.reportIssue_92fd0": "Prijavi težavo", "ui.star_26f93": "Zvezdica" },
  hr: { "ui.apiRunning": "API radi", "ui.apiStopped": "API zaustavljen", "ui.lanApiRunningTitle": "LAN API radi", "ui.lanApiStoppedTitle": "LAN API zaustavljen", "ui.mobileCanSyncCatalog": "Mobilna aplikacija može sinkronizirati katalog s ovog računala.", "ui.startServerToPairRefresh": "Pokreni server za uparivanje ili osvježavanje mobilnog kataloga.", "ui.startServerToPairMobile": "Pokreni server za uparivanje mobitela", "ui.online": "Online", "ui.offline": "Offline", "ui.portLabel": "Port", "ui.versionLabel": "Verzija", "ui.never": "nikad", "ui.justNow": "upravo sada", "ui.versionUnknown": "nepoznata verzija", "ui.settingRuntimeTitle": "Izvođenje", "ui.settingRuntimeSubtitle": "Ponašanje servera i pozadine.", "ui.settingWindowTitle": "Ponašanje prozora", "ui.settingWindowSubtitle": "Postavke desktop prozora i traya.", "ui.settingRememberWindowTitle": "Zapamti položaj i veličinu prozora", "ui.settingRememberWindowBody": "Pri sljedećem pokretanju vraća zadnju geometriju prozora. Ako je uključeno, veličina i položaj automatski se spremaju pri zatvaranju.", "ui.settingLaunchStartupTitle": "Pokreni sa sustavom", "ui.settingLaunchStartupBody": "Registriraj nutrino Desktop za pokretanje pri prijavi u Windows.", "ui.settingRunBackgroundTitle": "Radi u pozadini", "ui.settingRunBackgroundBody": "Održi tray proces aktivnim kako bi LAN API mogao raditi.", "ui.settingAutoStartServerTitle": "Pokreni API server pri pokretanju aplikacije", "ui.settingAutoStartServerBody": "Automatski pokreni LAN server na spremljenom portu.", "ui.settingCloseTrayTitle": "Gumb za zatvaranje skriva u tray", "ui.settingCloseTrayBody": "Kad je pozadina uključena, X skriva prozor umjesto izlaza.", "ui.settingStartHiddenTitle": "Pokreni skriveno u tray pri prijavi u Windows", "ui.settingStartHiddenBody": "Pokreni u trayu kad ga pokrene Windows startup.", "ui.settingsSaved": "Postavke spremljene.", "ui.currentWindowSaved": "Trenutni položaj i veličina prozora spremljeni.", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Obavijesti trećih strana i zahvale.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Izvođenje, tray, pokretanje, sigurnosne kopije, privatnost i poveznice projekta.", "ui.backupsRestoreAndReset_6433e": "Sigurnosne kopije, vraćanje i resetiranje.", "ui.storeTheCurrentPositionAndSize_161c9": "Odmah spremi trenutni položaj i veličinu.", "ui.repository_33fcf": "Repozitorij", "ui.reportIssue_92fd0": "Prijavi problem", "ui.star_26f93": "Zvjezdica" },
  pl: { "ui.apiRunning": "API działa", "ui.apiStopped": "API zatrzymane", "ui.lanApiRunningTitle": "LAN API działa", "ui.lanApiStoppedTitle": "LAN API zatrzymane", "ui.mobileCanSyncCatalog": "Aplikacja mobilna może synchronizować katalog z tego komputera.", "ui.startServerToPairRefresh": "Uruchom serwer, aby sparować telefon lub odświeżyć katalog mobilny.", "ui.startServerToPairMobile": "Uruchom serwer, aby sparować telefon", "ui.online": "Online", "ui.offline": "Offline", "ui.portLabel": "Port", "ui.versionLabel": "Wersja", "ui.never": "nigdy", "ui.justNow": "przed chwilą", "ui.versionUnknown": "wersja nieznana", "ui.settingRuntimeTitle": "Uruchamianie", "ui.settingRuntimeSubtitle": "Zachowanie serwera i pracy w tle.", "ui.settingWindowTitle": "Zachowanie okna", "ui.settingWindowSubtitle": "Preferencje okna desktop i zasobnika.", "ui.settingRememberWindowTitle": "Zapamiętaj pozycję i rozmiar okna", "ui.settingRememberWindowBody": "Przy następnym uruchomieniu przywraca ostatnią geometrię okna. Po włączeniu rozmiar i pozycja zapisują się automatycznie przy zamknięciu.", "ui.settingLaunchStartupTitle": "Uruchamiaj przy starcie systemu", "ui.settingLaunchStartupBody": "Zarejestruj nutrino Desktop do uruchamiania przy logowaniu Windows.", "ui.settingRunBackgroundTitle": "Działaj w tle", "ui.settingRunBackgroundBody": "Utrzymaj proces w zasobniku, aby LAN API mogło działać.", "ui.settingAutoStartServerTitle": "Uruchamiaj serwer API przy starcie aplikacji", "ui.settingAutoStartServerBody": "Automatycznie uruchom serwer LAN na zapisanym porcie.", "ui.settingCloseTrayTitle": "Przycisk zamknięcia ukrywa do zasobnika", "ui.settingCloseTrayBody": "Gdy tryb tła jest włączony, X ukrywa okno zamiast kończyć program.", "ui.settingStartHiddenTitle": "Startuj ukryty w zasobniku przy logowaniu Windows", "ui.settingStartHiddenBody": "Uruchamiaj w zasobniku, gdy startuje przez Windows.", "ui.settingsSaved": "Ustawienia zapisane.", "ui.currentWindowSaved": "Bieżąca pozycja i rozmiar okna zapisane.", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Informacje o komponentach zewnętrznych i podziękowania.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Uruchamianie, zasobnik, autostart, kopie, prywatność i linki projektu.", "ui.backupsRestoreAndReset_6433e": "Kopie zapasowe, przywracanie i reset.", "ui.storeTheCurrentPositionAndSize_161c9": "Zapisz natychmiast bieżącą pozycję i rozmiar.", "ui.repository_33fcf": "Repozytorium", "ui.reportIssue_92fd0": "Zgłoś problem", "ui.star_26f93": "Gwiazdka" },
  es: { "ui.apiRunning": "API en ejecución", "ui.apiStopped": "API detenida", "ui.lanApiRunningTitle": "API LAN en ejecución", "ui.lanApiStoppedTitle": "API LAN detenida", "ui.mobileCanSyncCatalog": "La app móvil puede sincronizar el catálogo desde este ordenador.", "ui.startServerToPairRefresh": "Inicia el servidor para vincular o actualizar el catálogo móvil.", "ui.startServerToPairMobile": "Inicia el servidor para vincular el móvil", "ui.online": "En línea", "ui.offline": "Sin conexión", "ui.portLabel": "Puerto", "ui.versionLabel": "Versión", "ui.never": "nunca", "ui.justNow": "ahora mismo", "ui.versionUnknown": "versión desconocida", "ui.settingRuntimeTitle": "Ejecución", "ui.settingRuntimeSubtitle": "Comportamiento del servidor y segundo plano.", "ui.settingWindowTitle": "Comportamiento de la ventana", "ui.settingWindowSubtitle": "Preferencias de ventana desktop y bandeja.", "ui.settingRememberWindowTitle": "Recordar posición y tamaño de la ventana", "ui.settingRememberWindowBody": "Restaura la última geometría de la ventana al iniciar de nuevo. Si está activado, guarda automáticamente el tamaño y la posición al cerrar.", "ui.settingLaunchStartupTitle": "Iniciar con el sistema", "ui.settingLaunchStartupBody": "Registrar nutrino Desktop para el inicio de sesión de Windows.", "ui.settingRunBackgroundTitle": "Ejecutar en segundo plano", "ui.settingRunBackgroundBody": "Mantener activo el proceso de bandeja para que la API LAN pueda seguir funcionando.", "ui.settingAutoStartServerTitle": "Iniciar servidor API al abrir la app", "ui.settingAutoStartServerBody": "Iniciar automáticamente el servidor LAN en el puerto guardado.", "ui.settingCloseTrayTitle": "El botón cerrar oculta en la bandeja", "ui.settingCloseTrayBody": "Cuando el modo segundo plano está activo, X oculta la ventana en lugar de salir.", "ui.settingStartHiddenTitle": "Iniciar oculto en la bandeja al iniciar Windows", "ui.settingStartHiddenBody": "Iniciar en la bandeja cuando lo lance Windows startup.", "ui.settingsSaved": "Ajustes guardados.", "ui.currentWindowSaved": "Posición y tamaño actuales de la ventana guardados.", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Avisos de terceros y agradecimientos.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Ejecución, bandeja, inicio, copias, privacidad y enlaces del proyecto.", "ui.backupsRestoreAndReset_6433e": "Copias, restauración y reinicio.", "ui.storeTheCurrentPositionAndSize_161c9": "Guardar inmediatamente la posición y el tamaño actuales.", "ui.repository_33fcf": "Repositorio", "ui.reportIssue_92fd0": "Informar problema", "ui.star_26f93": "Estrella" },
  pt: { "ui.apiRunning": "API em execução", "ui.apiStopped": "API parada", "ui.lanApiRunningTitle": "API LAN em execução", "ui.lanApiStoppedTitle": "API LAN parada", "ui.mobileCanSyncCatalog": "A aplicação móvel pode sincronizar o catálogo a partir deste computador.", "ui.startServerToPairRefresh": "Inicia o servidor para emparelhar ou atualizar o catálogo móvel.", "ui.startServerToPairMobile": "Inicia o servidor para emparelhar o móvel", "ui.online": "Online", "ui.offline": "Offline", "ui.portLabel": "Porta", "ui.versionLabel": "Versão", "ui.never": "nunca", "ui.justNow": "agora mesmo", "ui.versionUnknown": "versão desconhecida", "ui.settingRuntimeTitle": "Execução", "ui.settingRuntimeSubtitle": "Comportamento do servidor e do segundo plano.", "ui.settingWindowTitle": "Comportamento da janela", "ui.settingWindowSubtitle": "Preferências da janela desktop e tray.", "ui.settingRememberWindowTitle": "Memorizar posição e tamanho da janela", "ui.settingRememberWindowBody": "Restaura a última geometria da janela no próximo arranque. Quando ativo, guarda automaticamente o tamanho e a posição ao fechar.", "ui.settingLaunchStartupTitle": "Iniciar com o sistema", "ui.settingLaunchStartupBody": "Registar nutrino Desktop para iniciar no login do Windows.", "ui.settingRunBackgroundTitle": "Executar em segundo plano", "ui.settingRunBackgroundBody": "Manter o processo no tray ativo para que a API LAN continue a funcionar.", "ui.settingAutoStartServerTitle": "Iniciar servidor API ao abrir a app", "ui.settingAutoStartServerBody": "Iniciar automaticamente o servidor LAN na porta guardada.", "ui.settingCloseTrayTitle": "O botão fechar oculta no tray", "ui.settingCloseTrayBody": "Quando o modo de segundo plano está ativo, X oculta a janela em vez de sair.", "ui.settingStartHiddenTitle": "Iniciar oculto no tray ao entrar no Windows", "ui.settingStartHiddenBody": "Iniciar no tray quando lançado pelo arranque do Windows.", "ui.settingsSaved": "Definições guardadas.", "ui.currentWindowSaved": "Posição e tamanho atuais da janela guardados.", "ui.thirdPartyNoticesAndAcknowledgements_833ba": "Avisos de terceiros e agradecimentos.", "ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f": "Execução, tray, arranque, cópias, privacidade e links do projeto.", "ui.backupsRestoreAndReset_6433e": "Cópias, restauro e reposição.", "ui.storeTheCurrentPositionAndSize_161c9": "Guardar imediatamente a posição e o tamanho atuais.", "ui.repository_33fcf": "Repositório", "ui.reportIssue_92fd0": "Reportar problema", "ui.star_26f93": "Estrela" }
};
for (const [language, values] of Object.entries(desktopFinalFallbacks)) {
  desktopFinalTranslations[language] = { ...desktopFinalTranslations.en, ...normalizeTranslationValues(values) };
}
for (const [language, values] of Object.entries(desktopCompactTranslations)) {
  desktopFinalTranslations[language] = { ...desktopFinalTranslations.en, ...normalizeTranslationValues(values) };
}

for (const [language, values] of Object.entries(desktopFinalTranslations)) {
  translations[language] = { ...translations.en, ...(translations[language] || {}), ...values };
}
const desktopVisibleTextTranslations: Record<string, Record<string, string>> = {
  en: { "ui.noBrand": "No brand", "ui.lastSeen": "Last seen", "ui.requestSingular": "request", "ui.requestPlural": "requests", "ui.mealsNotes": "meals/notes", "ui.activityLogs": "activity logs", "ui.weights": "weights", "ui.replaces": "replaces", "ui.onDesktopServer": "on the desktop server", "ui.itemsCount": "item(s)", "ui.recipesCount": "recipe(s)" },
  hu: { "ui.noBrand": "Nincs márka", "ui.lastSeen": "Utolsó kapcsolat", "ui.requestSingular": "kérés", "ui.requestPlural": "kérés", "ui.mealsNotes": "étkezések/jegyzetek", "ui.activityLogs": "aktivitásnaplók", "ui.weights": "súlyok", "ui.replaces": "lecseréli", "ui.onDesktopServer": "a desktop szerveren", "ui.itemsCount": "tétel", "ui.recipesCount": "recept" },
  de: { "ui.noBrand": "Keine Marke", "ui.lastSeen": "Zuletzt gesehen", "ui.requestSingular": "Anfrage", "ui.requestPlural": "Anfragen", "ui.mealsNotes": "Mahlzeiten/Notizen", "ui.activityLogs": "Aktivitätsprotokolle", "ui.weights": "Gewichte", "ui.replaces": "ersetzt", "ui.onDesktopServer": "auf dem Desktop-Server", "ui.itemsCount": "Element(e)", "ui.recipesCount": "Rezept(e)" },
  fr: { "ui.noBrand": "Sans marque", "ui.lastSeen": "Vu pour la dernière fois", "ui.requestSingular": "requête", "ui.requestPlural": "requêtes", "ui.mealsNotes": "repas/notes", "ui.activityLogs": "journaux d’activité", "ui.weights": "poids", "ui.replaces": "remplace", "ui.onDesktopServer": "sur le serveur desktop", "ui.itemsCount": "élément(s)", "ui.recipesCount": "recette(s)" },
  ru: { "ui.noBrand": "Без бренда", "ui.lastSeen": "Последний раз", "ui.requestSingular": "запрос", "ui.requestPlural": "запросов", "ui.mealsNotes": "приемы пищи/заметки", "ui.activityLogs": "журналы активности", "ui.weights": "вес", "ui.replaces": "заменяет", "ui.onDesktopServer": "на desktop-сервере", "ui.itemsCount": "элемент(ы)", "ui.recipesCount": "рецепт(ы)" },
  uk: { "ui.noBrand": "Без бренду", "ui.lastSeen": "Останній раз", "ui.requestSingular": "запит", "ui.requestPlural": "запитів", "ui.mealsNotes": "прийоми їжі/нотатки", "ui.activityLogs": "журнали активності", "ui.weights": "вага", "ui.replaces": "замінює", "ui.onDesktopServer": "на desktop-сервері", "ui.itemsCount": "елемент(и)", "ui.recipesCount": "рецепт(и)" },
  zh: { "ui.noBrand": "无品牌", "ui.lastSeen": "最后在线", "ui.requestSingular": "请求", "ui.requestPlural": "请求", "ui.mealsNotes": "餐食/备注", "ui.activityLogs": "活动日志", "ui.weights": "体重", "ui.replaces": "替换", "ui.onDesktopServer": "在桌面服务器上", "ui.itemsCount": "项", "ui.recipesCount": "食谱" },
  sk: { "ui.noBrand": "Bez značky", "ui.lastSeen": "Naposledy videné", "ui.requestSingular": "požiadavka", "ui.requestPlural": "požiadaviek", "ui.mealsNotes": "jedlá/poznámky", "ui.activityLogs": "záznamy aktivít", "ui.weights": "hmotnosti", "ui.replaces": "nahrádza", "ui.onDesktopServer": "na desktop serveri", "ui.itemsCount": "položka(y)", "ui.recipesCount": "recept(y)" },
  ro: { "ui.noBrand": "Fără marcă", "ui.lastSeen": "Văzut ultima dată", "ui.requestSingular": "cerere", "ui.requestPlural": "cereri", "ui.mealsNotes": "mese/notițe", "ui.activityLogs": "jurnale de activitate", "ui.weights": "greutăți", "ui.replaces": "înlocuiește", "ui.onDesktopServer": "pe serverul desktop", "ui.itemsCount": "element(e)", "ui.recipesCount": "rețetă(e)" },
  cs: { "ui.noBrand": "Bez značky", "ui.lastSeen": "Naposledy viděno", "ui.requestSingular": "požadavek", "ui.requestPlural": "požadavků", "ui.mealsNotes": "jídla/poznámky", "ui.activityLogs": "záznamy aktivit", "ui.weights": "hmotnosti", "ui.replaces": "nahrazuje", "ui.onDesktopServer": "na desktop serveru", "ui.itemsCount": "položka(y)", "ui.recipesCount": "recept(y)" },
  sl: { "ui.noBrand": "Brez znamke", "ui.lastSeen": "Nazadnje videno", "ui.requestSingular": "zahteva", "ui.requestPlural": "zahtev", "ui.mealsNotes": "obroki/opombe", "ui.activityLogs": "dnevniki aktivnosti", "ui.weights": "teže", "ui.replaces": "zamenja", "ui.onDesktopServer": "na desktop strežniku", "ui.itemsCount": "element(i)", "ui.recipesCount": "recept(i)" },
  hr: { "ui.noBrand": "Bez marke", "ui.lastSeen": "Zadnje viđeno", "ui.requestSingular": "zahtjev", "ui.requestPlural": "zahtjeva", "ui.mealsNotes": "obroci/bilješke", "ui.activityLogs": "dnevnici aktivnosti", "ui.weights": "težine", "ui.replaces": "zamjenjuje", "ui.onDesktopServer": "na desktop serveru", "ui.itemsCount": "stavka(e)", "ui.recipesCount": "recept(i)" },
  pl: { "ui.noBrand": "Brak marki", "ui.lastSeen": "Ostatnio widziano", "ui.requestSingular": "żądanie", "ui.requestPlural": "żądań", "ui.mealsNotes": "posiłki/notatki", "ui.activityLogs": "dzienniki aktywności", "ui.weights": "wagi", "ui.replaces": "zastępuje", "ui.onDesktopServer": "na serwerze desktop", "ui.itemsCount": "element(y)", "ui.recipesCount": "przepis(y)" },
  es: { "ui.noBrand": "Sin marca", "ui.lastSeen": "Visto por última vez", "ui.requestSingular": "solicitud", "ui.requestPlural": "solicitudes", "ui.mealsNotes": "comidas/notas", "ui.activityLogs": "registros de actividad", "ui.weights": "pesos", "ui.replaces": "reemplaza", "ui.onDesktopServer": "en el servidor desktop", "ui.itemsCount": "elemento(s)", "ui.recipesCount": "receta(s)" },
  pt: { "ui.noBrand": "Sem marca", "ui.lastSeen": "Visto por último", "ui.requestSingular": "pedido", "ui.requestPlural": "pedidos", "ui.mealsNotes": "refeições/notas", "ui.activityLogs": "registos de atividade", "ui.weights": "pesos", "ui.replaces": "substitui", "ui.onDesktopServer": "no servidor desktop", "ui.itemsCount": "item(ns)", "ui.recipesCount": "receita(s)" }
};
for (const [language, values] of Object.entries(desktopVisibleTextTranslations)) {
  translations[language] = { ...translations.en, ...(translations[language] || {}), ...values };
}


// v0.11.9 hard safety patch for visible CSV notes and Settings/runtime labels.
// Keep this after all generated/fallback translation merges so raw ui.* keys cannot leak into the UI.
const desktopV0119TranslationPatches: Record<string, Record<string, string>> = {
  en: {
    "ui.csvNoteKeepHeader": "Keep the first row exactly as the header shown here.",
    "ui.csvNoteLeaveIdEmpty": "Leave id/recipe_id empty when Nutrino should generate a new local ID.",
    "ui.csvNoteDotDecimals": "Use dot decimals, for example 12.5, not 12,5.",
    "ui.csvNoteRecipeIngredients": "Recipe ingredients_json must contain food_id and amount_g values; amounts are stored in grams."
  },
  hu: {
    "ui.csvNoteKeepHeader": "Az első sor maradjon pontosan az itt látható fejléc.",
    "ui.csvNoteLeaveIdEmpty": "Hagyd üresen az id/recipe_id mezőt, ha a Nutrino generáljon új helyi ID-t.",
    "ui.csvNoteDotDecimals": "Tizedespontot használj, például 12.5, ne 12,5 formátumot.",
    "ui.csvNoteRecipeIngredients": "A recept ingredients_json mezőjében food_id és amount_g értékek kellenek; a mennyiségek grammban tárolódnak."
  },
  de: {
    "ui.csvNoteKeepHeader": "Die erste Zeile muss exakt die hier gezeigte Kopfzeile bleiben.",
    "ui.csvNoteLeaveIdEmpty": "id/recipe_id leer lassen, wenn Nutrino eine neue lokale ID erzeugen soll.",
    "ui.csvNoteDotDecimals": "Dezimalpunkte verwenden, zum Beispiel 12.5, nicht 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json für Rezepte muss food_id und amount_g enthalten; Mengen werden in Gramm gespeichert."
  },
  fr: {
    "ui.csvNoteKeepHeader": "Conserve la première ligne exactement comme l’en-tête affiché ici.",
    "ui.csvNoteLeaveIdEmpty": "Laisse id/recipe_id vide si Nutrino doit générer un nouvel ID local.",
    "ui.csvNoteDotDecimals": "Utilise le point décimal, par exemple 12.5, pas 12,5.",
    "ui.csvNoteRecipeIngredients": "Le champ ingredients_json des recettes doit contenir food_id et amount_g; les quantités sont stockées en grammes."
  },
  ru: {
    "ui.csvNoteKeepHeader": "Первая строка должна точно совпадать с показанным здесь заголовком.",
    "ui.csvNoteLeaveIdEmpty": "Оставьте id/recipe_id пустым, если Nutrino должен создать новый локальный ID.",
    "ui.csvNoteDotDecimals": "Используйте точку для дробей, например 12.5, а не 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json рецепта должен содержать food_id и amount_g; количества хранятся в граммах."
  },
  uk: {
    "ui.csvNoteKeepHeader": "Перший рядок має точно відповідати показаному заголовку.",
    "ui.csvNoteLeaveIdEmpty": "Залиш id/recipe_id порожнім, якщо Nutrino має створити новий локальний ID.",
    "ui.csvNoteDotDecimals": "Використовуй крапку для дробів, наприклад 12.5, а не 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json рецепта має містити food_id і amount_g; кількості зберігаються у грамах."
  },
  zh: {
    "ui.csvNoteKeepHeader": "第一行必须保持为这里显示的完整表头。",
    "ui.csvNoteLeaveIdEmpty": "如果要让 Nutrino 生成新的本地 ID，请留空 id/recipe_id。",
    "ui.csvNoteDotDecimals": "使用小数点，例如 12.5，不要用 12,5。",
    "ui.csvNoteRecipeIngredients": "配方的 ingredients_json 必须包含 food_id 和 amount_g；数量以克保存。"
  },
  sk: {
    "ui.csvNoteKeepHeader": "Prvý riadok musí zostať presne ako tu zobrazená hlavička.",
    "ui.csvNoteLeaveIdEmpty": "id/recipe_id nechaj prázdne, ak má Nutrino vytvoriť nové lokálne ID.",
    "ui.csvNoteDotDecimals": "Používaj desatinnú bodku, napríklad 12.5, nie 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json receptu musí obsahovať food_id a amount_g; množstvá sa ukladajú v gramoch."
  },
  ro: {
    "ui.csvNoteKeepHeader": "Păstrează primul rând exact ca antetul afișat aici.",
    "ui.csvNoteLeaveIdEmpty": "Lasă id/recipe_id gol dacă Nutrino trebuie să genereze un ID local nou.",
    "ui.csvNoteDotDecimals": "Folosește punct pentru zecimale, de exemplu 12.5, nu 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json pentru rețete trebuie să conțină food_id și amount_g; cantitățile sunt stocate în grame."
  },
  cs: {
    "ui.csvNoteKeepHeader": "První řádek musí přesně odpovídat zde zobrazené hlavičce.",
    "ui.csvNoteLeaveIdEmpty": "id/recipe_id nech prázdné, pokud má Nutrino vytvořit nové lokální ID.",
    "ui.csvNoteDotDecimals": "Používej desetinnou tečku, například 12.5, ne 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json receptu musí obsahovat food_id a amount_g; množství se ukládají v gramech."
  },
  sl: {
    "ui.csvNoteKeepHeader": "Prva vrstica mora ostati natančno taka kot prikazana glava.",
    "ui.csvNoteLeaveIdEmpty": "id/recipe_id pusti prazno, če naj Nutrino ustvari nov lokalni ID.",
    "ui.csvNoteDotDecimals": "Uporabi decimalno piko, na primer 12.5, ne 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json za recepte mora vsebovati food_id in amount_g; količine se shranijo v gramih."
  },
  hr: {
    "ui.csvNoteKeepHeader": "Prvi red mora ostati točno kao ovdje prikazano zaglavlje.",
    "ui.csvNoteLeaveIdEmpty": "id/recipe_id ostavi prazno ako Nutrino treba generirati novi lokalni ID.",
    "ui.csvNoteDotDecimals": "Koristi decimalnu točku, na primjer 12.5, ne 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json recepta mora sadržavati food_id i amount_g; količine se spremaju u gramima."
  },
  pl: {
    "ui.csvNoteKeepHeader": "Pierwszy wiersz musi dokładnie odpowiadać pokazanemu tutaj nagłówkowi.",
    "ui.csvNoteLeaveIdEmpty": "Pozostaw id/recipe_id puste, jeśli Nutrino ma wygenerować nowe lokalne ID.",
    "ui.csvNoteDotDecimals": "Używaj kropki dziesiętnej, na przykład 12.5, nie 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json przepisu musi zawierać food_id i amount_g; ilości są zapisywane w gramach."
  },
  es: {
    "ui.csvNoteKeepHeader": "Mantén la primera fila exactamente como el encabezado mostrado aquí.",
    "ui.csvNoteLeaveIdEmpty": "Deja id/recipe_id vacío cuando Nutrino deba generar un nuevo ID local.",
    "ui.csvNoteDotDecimals": "Usa punto decimal, por ejemplo 12.5, no 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json de recetas debe contener food_id y amount_g; las cantidades se guardan en gramos."
  },
  pt: {
    "ui.csvNoteKeepHeader": "Mantém a primeira linha exatamente como o cabeçalho apresentado aqui.",
    "ui.csvNoteLeaveIdEmpty": "Deixa id/recipe_id vazio quando o Nutrino deve gerar um novo ID local.",
    "ui.csvNoteDotDecimals": "Usa ponto decimal, por exemplo 12.5, não 12,5.",
    "ui.csvNoteRecipeIngredients": "ingredients_json das receitas deve conter food_id e amount_g; as quantidades são guardadas em gramas."
  }
};
for (const [language, values] of Object.entries(desktopV0119TranslationPatches)) {
  translations[language] = { ...translations.en, ...(translations[language] || {}), ...values };
}

const desktopNutrientTranslations: Record<string, Record<string, string>> = {
  en: {
    'ui.importantNutrients': 'Important nutrients',
    'ui.optionalNutrients': 'Optional nutrients',
    'ui.optionalNutrientsHint': 'Optional per-100g values can be left empty.',
    'ui.sugars': 'Sugars',
    'ui.fiber': 'Fiber',
    'ui.saturatedFat': 'Saturated fat',
    'ui.sodium': 'Sodium',
    'ui.calcium': 'Calcium',
    'ui.iron': 'Iron',
    'ui.potassium': 'Potassium',
    'ui.vitaminD': 'Vitamin D',
    'ui.vitaminB12': 'Vitamin B12',
    'ui.magnesium': 'Magnesium',
  },
  hu: {
    'ui.importantNutrients': 'Fontos tápanyagok',
    'ui.optionalNutrients': 'Opcionális tápanyagok',
    'ui.optionalNutrientsHint': 'Az opcionális /100g értékek üresen hagyhatók.',
    'ui.sugars': 'Cukor',
    'ui.fiber': 'Rost',
    'ui.saturatedFat': 'Telített zsír',
    'ui.sodium': 'Nátrium',
    'ui.calcium': 'Kalcium',
    'ui.iron': 'Vas',
    'ui.potassium': 'Kálium',
    'ui.vitaminD': 'D-vitamin',
    'ui.vitaminB12': 'B12-vitamin',
    'ui.magnesium': 'Magnézium',
  },
};
for (const [language, values] of Object.entries(desktopNutrientTranslations)) {
  translations[language] = { ...translations.en, ...(translations[language] || {}), ...values };
}

const desktopUpdateTranslations: Record<string, Record<string, string>> = {
  en: {
    'ui.appUpdates': 'App updates',
    'ui.appUpdatesBody': 'Check GitHub Releases for a newer Nutrino desktop version.',
    'ui.checkUpdates': 'Check for updates',
    'ui.checkingUpdates': 'Checking…',
    'ui.includePrereleaseUpdates': 'Watch pre-releases',
    'ui.includePrereleaseUpdatesHint': 'Off by default; stable releases are checked unless enabled.',
    'ui.updateAvailable': 'Update available',
    'ui.updateAvailableBody': 'A newer Nutrino release is available.',
    'ui.installUpdate': 'Install update',
    'ui.remindLater': 'Remind me later',
    'ui.remindLaterSaved': 'Update reminder postponed.',
    'ui.latestInstalled': 'You are on the latest version.',
    'ui.updateCheckFailed': 'Update check failed',
    'ui.updateInstallerStarted': 'Update installer started.',
    'ui.updateInstallerFailed': 'Could not start the update installer',
    'ui.updateInstallerFallback': 'Could not start the installer directly; opening the download instead',
    'ui.mobileRequestedDesktopUpdateCheck': 'Mobile requested a desktop update check.',
  },
  hu: {
    'ui.appUpdates': 'App frissítések',
    'ui.appUpdatesBody': 'Új Nutrino desktop verzió keresése GitHub Releases alapján.',
    'ui.checkUpdates': 'Frissítés keresése',
    'ui.checkingUpdates': 'Ellenőrzés…',
    'ui.includePrereleaseUpdates': 'Pre-release figyelése',
    'ui.includePrereleaseUpdatesHint': 'Alapból kikapcsolva; bekapcsolás nélkül csak stabil kiadásokat néz.',
    'ui.updateAvailable': 'Frissítés érhető el',
    'ui.updateAvailableBody': 'Újabb Nutrino kiadás érhető el.',
    'ui.installUpdate': 'Frissítés telepítése',
    'ui.remindLater': 'Emlékeztess később',
    'ui.remindLaterSaved': 'Frissítési emlékeztető elhalasztva.',
    'ui.latestInstalled': 'A legfrissebb verzió van fent.',
    'ui.updateCheckFailed': 'A frissítés ellenőrzése sikertelen',
    'ui.updateInstallerStarted': 'A frissítő telepítő elindult.',
    'ui.updateInstallerFailed': 'Nem sikerült elindítani a frissítő telepítőt',
    'ui.updateInstallerFallback': 'A telepítő közvetlen indítása nem sikerült; megnyitom a letöltést',
    'ui.mobileRequestedDesktopUpdateCheck': 'A mobil frissítéskeresést kért a desktop appnak.',
  },
};
for (const [language, values] of Object.entries(desktopUpdateTranslations)) {
  translations[language] = { ...translations.en, ...(translations[language] || {}), ...values };
}

const effectiveLanguage = computed<Exclude<AppLanguage, 'system'>>(() => {
  if (desktopLanguage.value !== 'system') return desktopLanguage.value;
  const detected = String(navigator.language || 'en').slice(0, 2).toLowerCase() as Exclude<AppLanguage, 'system'>;
  return supportedLanguageCodes.includes(detected) ? detected : 'en';
});

const filteredLanguageOptions = computed(() => {
  const query = languageSearch.value.trim().toLowerCase();
  if (!query) return languageOptions;
  return languageOptions.filter((language) => [language.code, language.englishName, language.nativeName, ...language.aliases].join(' ').toLowerCase().includes(query));
});

function t(key: string): string {
  return translations[effectiveLanguage.value]?.[key] ?? translations.en[key] ?? key;
}

function setDesktopLanguage(code: AppLanguage) {
  desktopLanguage.value = code;
  localStorage.setItem(desktopLanguageKey, code);
}


function localFormOptionalNutrients(kind: 'ingredient' | 'food'): Record<string, number | null | undefined> {
  const form = kind === 'ingredient' ? ingredientForm.value : foodForm.value;
  if (!form.optional_nutrients) form.optional_nutrients = {};
  return form.optional_nutrients;
}

function localOptionalNutrientValue(kind: 'ingredient' | 'food', nutrient: OptionalNutrientDefinition): number | null {
  const form = kind === 'ingredient' ? ingredientForm.value : foodForm.value;
  if (nutrient.field) return Number((form as any)[nutrient.field] || 0);
  return localFormOptionalNutrients(kind)[nutrient.key] as number | null ?? null;
}

function setOptionalNutrientValue(kind: 'ingredient' | 'food', nutrient: OptionalNutrientDefinition, event: Event) {
  const form = kind === 'ingredient' ? ingredientForm.value : foodForm.value;
  const raw = String((event.target as HTMLInputElement | null)?.value ?? '').trim();
  if (!raw) {
    if (nutrient.field) (form as any)[nutrient.field] = 0;
    else delete localFormOptionalNutrients(kind)[nutrient.key];
    return;
  }
  const value = Number(raw);
  const normalized = Number.isFinite(value) ? Math.max(0, value) : null;
  if (nutrient.field) {
    (form as any)[nutrient.field] = normalized ?? 0;
    return;
  }
  if (normalized !== null) localFormOptionalNutrients(kind)[nutrient.key] = normalized;
}

function currentLocale(): string {
  return languageOptions.find((language) => language.code === effectiveLanguage.value)?.locale || 'en-US';
}

function localizedName(item: { name: string; name_i18n?: LocalizedNameMap | null }): string {
  return item.name_i18n?.[effectiveLanguage.value] || item.name;
}

function searchableLocalizedName(item: { name: string; name_i18n?: LocalizedNameMap | null }): string {
  return [item.name, localizedName(item), ...Object.values(item.name_i18n || {})].join(' ');
}

function compareLocalizedName(a: { name: string; name_i18n?: LocalizedNameMap | null }, b: { name: string; name_i18n?: LocalizedNameMap | null }): number {
  return localizedName(a).localeCompare(localizedName(b), currentLocale());
}

function ensureNameI18n(form: { name_i18n?: LocalizedNameMap | null }): LocalizedNameMap {
  if (!form.name_i18n) form.name_i18n = {};
  return form.name_i18n;
}

function formForI18n(kind: CatalogKind): { name_i18n?: LocalizedNameMap | null } {
  if (kind === 'ingredient') return ingredientForm.value;
  if (kind === 'food') return foodForm.value;
  if (kind === 'recipe') return recipeForm.value;
  return activityForm.value;
}

function addNameTranslation(kind: CatalogKind, code: AppLanguage | string = effectiveLanguage.value) {
  if (!code) return;
  if (code === 'system') code = effectiveLanguage.value;
  ensureNameI18n(formForI18n(kind))[String(code)] ||= '';
}

function addNameTranslationFromEvent(kind: CatalogKind, event: Event) {
  const select = event.target as HTMLSelectElement;
  addNameTranslation(kind, select.value);
  select.value = '';
}

function removeNameTranslation(kind: CatalogKind, code: string) {
  const map = ensureNameI18n(formForI18n(kind));
  delete map[code];
}

function translationLanguageLabel(code: string): string {
  const option = languageOptions.find((language) => language.code === code);
  return option ? `${option.englishName} · ${option.nativeName} (${option.code})` : code;
}

function translationEntries(kind: CatalogKind) {
  return Object.entries(ensureNameI18n(formForI18n(kind))).sort(([a], [b]) => a.localeCompare(b));
}

function availableTranslationLanguages(kind: CatalogKind) {
  const existing = new Set(Object.keys(ensureNameI18n(formForI18n(kind))));
  return languageOptions.filter((language) => language.code !== 'system' && !existing.has(language.code));
}

const repositoryUrl = 'https://github.com/rozsazoltan/nutrino';
const issueUrl = 'https://github.com/rozsazoltan/nutrino/issues/new/choose';
const starUrl = 'https://github.com/rozsazoltan/nutrino/stargazers';
const ingredientCsvHeader = 'id,name,name_i18n_json,note,default_unit,serving_size_g,kcal_per_100g,carbs_per_100g,fat_per_100g,protein_per_100g,sugars_per_100g,fiber_per_100g,salt_per_100g,optional_nutrients_json,saturated_fat_per_100g,sodium_mg_per_100g,calcium_mg_per_100g,iron_mg_per_100g,potassium_mg_per_100g,vitamin_d_mcg_per_100g,vitamin_b12_mcg_per_100g,magnesium_mg_per_100g';
const foodCsvHeader = 'id,name,name_i18n_json,brand,note,barcode,default_unit,serving_size_g,kcal_per_100g,carbs_per_100g,fat_per_100g,protein_per_100g,sugars_per_100g,fiber_per_100g,salt_per_100g,optional_nutrients_json,saturated_fat_per_100g,sodium_mg_per_100g,calcium_mg_per_100g,iron_mg_per_100g,potassium_mg_per_100g,vitamin_d_mcg_per_100g,vitamin_b12_mcg_per_100g,magnesium_mg_per_100g';
const recipeCsvHeader = 'recipe_id,name,name_i18n_json,description,note,extra_kcal,servings_count,ingredients_json';
const activityCsvHeader = 'id,code,name,name_i18n_json,description,activity_type,met,kcal_per_min';
const csvImportNotes = [
  'ui.csvNoteKeepHeader',
  'ui.csvNoteLeaveIdEmpty',
  'ui.csvNoteDotDecimals',
  'ui.csvNoteRecipeIngredients',
];
const desktopOnboardingKey = 'nutrino.desktop.onboarded.v1';
const onboardingOpen = ref(false);
const onboardingStep = ref(0);
const onboardingPort = ref(8090);
const serverPassword = ref('');
const onboardingPassword = ref('');
let messageTimer: number | undefined;
let connectedDevicesTimer: number | undefined;

const nutrinoLogoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"> <rect width="64" height="64" rx="18" fill="#0D2514"/> <g fill="#33E36A"> <circle cx="18" cy="14" r="5"/> <circle cx="18" cy="26" r="5"/> <circle cx="18" cy="38" r="5"/> <circle cx="18" cy="50" r="5"/> <circle cx="29" cy="24" r="5"/> <circle cx="35" cy="34" r="5"/> <circle cx="46" cy="14" r="5"/> <circle cx="46" cy="26" r="5"/> <circle cx="46" cy="38" r="5"/> <circle cx="46" cy="50" r="5"/> </g> </svg>';

type ThirdPartyNotice = {
  name: string;
  license: string;
  purposeKey: string;
  url: string;
  noteKey?: string;
};

const thirdPartyNotices: ThirdPartyNotice[] = [
  { name: 'Nutrino', license: 'AGPL-3.0-only', purposeKey: 'ui.noticeNutrinoPurpose', url: repositoryUrl },
  { name: 'Vue', license: 'MIT', purposeKey: 'ui.noticeVuePurpose', url: 'https://vuejs.org/' },
  { name: 'Tauri', license: 'MIT OR Apache-2.0', purposeKey: 'ui.noticeTauriPurpose', url: 'https://tauri.app/' },
  { name: 'Rust', license: 'MIT OR Apache-2.0', purposeKey: 'ui.noticeRustPurpose', url: 'https://www.rust-lang.org/' },
  { name: 'JSZip', license: 'MIT OR GPL-3.0', purposeKey: 'ui.noticeJsZipPurpose', url: 'https://github.com/Stuk/jszip' },
  { name: 'qrcode', license: 'MIT', purposeKey: 'ui.noticeQrCodePurpose', url: 'https://github.com/soldair/node-qrcode' },
  { name: 'tauri-plugin-android-fs', license: 'MIT OR Apache-2.0', purposeKey: 'ui.noticeAndroidFsPurpose', url: 'https://docs.rs/crate/tauri-plugin-android-fs/latest' },
  { name: 'Lucide Icons', license: 'ISC', purposeKey: 'ui.noticeLucidePurpose', url: 'https://lucide.dev/', noteKey: 'ui.noticeLucideNote' },
  { name: 'Vite', license: 'MIT', purposeKey: 'ui.noticeVitePurpose', url: 'https://vite.dev/' },
  { name: 'TypeScript', license: 'Apache-2.0', purposeKey: 'ui.noticeTypeScriptPurpose', url: 'https://www.typescriptlang.org/' },
  { name: 'OpenNutriTracker', license: 'GPL-3.0', purposeKey: 'ui.noticeOpenNutriTrackerPurpose', url: 'https://github.com/simonoppowa/OpenNutriTracker', noteKey: 'ui.noticeOpenNutriTrackerNote' },
];

const acknowledgements = [
  'ui.ackOpenNutriTracker',
  'ui.ackTauriRust',
  'ui.ackFrontendTools',
];

const emptyIngredientForm = (): IngredientInput => ({
  id: null,
  name: '',
  name_i18n: {},
  note: '',
  default_unit: 'g',
  serving_size_g: null,
  kcal_per_100g: 0,
  carbs_per_100g: 0,
  fat_per_100g: 0,
  protein_per_100g: 0,
  sugars_per_100g: 0,
  fiber_per_100g: 0,
  salt_per_100g: 0,
  optional_nutrients: {},
});

const emptyFoodForm = (): FoodInput => ({
  id: null,
  name: '',
  name_i18n: {},
  brand: '',
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
  optional_nutrients: {},
});

const emptyActivityForm = (): ActivityInput => ({
  id: null,
  code: 'custom',
  name_i18n: {},
  name: '',
  description: '',
  activity_type: 'custom',
  met: 3,
  kcal_per_min: 3.8,
});

const emptyRecipeForm = (): RecipeInput => ({
  id: null,
  name: '',
  name_i18n: {},
  description: '',
  note: '',
  total_weight_g: null,
  extra_kcal: 0,
  servings_count: null,
  items: [{ food_id: '', amount_g: 0 }],
});

const ingredientForm = ref<IngredientInput>(emptyIngredientForm());
const foodForm = ref<FoodInput>(emptyFoodForm());
const activityForm = ref<ActivityInput>(emptyActivityForm());
const recipeForm = ref<RecipeInput>(emptyRecipeForm());
const recipeIngredientSearch = ref<Record<number, string>>({});
const recipeIngredientPickerOpen = ref<Record<number, boolean>>({});
const recipeIngredientSearchRefs = ref<Record<number, HTMLInputElement | null>>({});
const modalInitialSnapshot = ref('');

const editingIngredientId = computed(() => ingredientForm.value.id || null);
const editingFoodId = computed(() => foodForm.value.id || null);
const editingRecipeId = computed(() => recipeForm.value.id || null);
const editingActivityId = computed(() => activityForm.value.id || null);

function modalPayloadSnapshot(kind: ModalKind = modal.value): string {
  if (kind === 'ingredient') return JSON.stringify(ingredientForm.value);
  if (kind === 'food') return JSON.stringify(foodForm.value);
  if (kind === 'recipe') return JSON.stringify(recipeForm.value);
  if (kind === 'activity') return JSON.stringify(activityForm.value);
  return '';
}

function captureModalSnapshot(kind: ModalKind = modal.value) {
  modalInitialSnapshot.value = modalPayloadSnapshot(kind);
}

function hasModalDraftChanges(): boolean {
  return Boolean(modal.value) && modalPayloadSnapshot() !== modalInitialSnapshot.value;
}

const totalFoods = computed(() => foods.value.length);
const totalRecipes = computed(() => recipes.value.length);
const totalActivities = computed(() => activities.value.length);
const avgKcal = computed(() => foods.value.length ? Math.round(foods.value.reduce((sum, food) => sum + food.kcal_per_100g, 0) / foods.value.length) : 0);
const avgIngredientKcal = computed(() => ingredients.value.length ? Math.round(ingredients.value.reduce((sum, ingredient) => sum + ingredient.kcal_per_100g, 0) / ingredients.value.length) : null);
const avgFoodKcal = computed(() => foods.value.length ? Math.round(foods.value.reduce((sum, food) => sum + food.kcal_per_100g, 0) / foods.value.length) : null);
const avgRecipeKcal = computed(() => recipes.value.length ? Math.round(recipes.value.reduce((sum, detail) => sum + detail.nutrition.kcal_per_100g, 0) / recipes.value.length) : null);

const totalIngredients = computed(() => ingredients.value.length);
const totalPreparedFoods = computed(() => foods.value.length);
const latestIngredientUpdatedAt = computed(() => latestUpdatedAt(ingredients.value));
const latestFoodUpdatedAt = computed(() => latestUpdatedAt(foods.value));
const latestRecipeUpdatedAt = computed(() => latestUpdatedAt(recipes.value.map((detail) => detail.recipe)));
const latestActivityUpdatedAt = computed(() => latestUpdatedAt(activities.value));

function latestUpdatedAt(items: Array<{ updated_at?: number | null; deleted_at?: number | null }>): number | null {
  const latest = items.filter((item) => !item.deleted_at).reduce((max, item) => Math.max(max, Number(item.updated_at || 0)), 0);
  return latest > 0 ? latest : null;
}

function formatFreshness(value: number | null): string {
  if (!value) return t('ui.never');
  return new Date(value).toLocaleString();
}

function formatMetricKcal(value: number | null): string {
  return value === null ? '—' : `${value} kcal`;
}

function foodKindLabel(_food: Food): string {
  return 'Food';
}

function ingredientAsRecipeCatalogItem(ingredient: Ingredient): RecipeCatalogItem {
  return {
    id: `ingredient:${ingredient.id}`,
    source_id: ingredient.source_id,
    name: ingredient.name,
    name_i18n: ingredient.name_i18n ?? {},
    brand: 'Ingredient',
    note: ingredient.note ?? null,
    barcode: null,
    default_unit: ingredient.default_unit,
    serving_size_g: ingredient.serving_size_g ?? null,
    kcal_per_100g: ingredient.kcal_per_100g,
    carbs_per_100g: ingredient.carbs_per_100g,
    fat_per_100g: ingredient.fat_per_100g,
    protein_per_100g: ingredient.protein_per_100g,
    sugars_per_100g: ingredient.sugars_per_100g,
    fiber_per_100g: ingredient.fiber_per_100g,
    salt_per_100g: ingredient.salt_per_100g,
    optional_nutrients: { ...(ingredient.optional_nutrients ?? {}) },
    updated_at: ingredient.updated_at,
    deleted_at: ingredient.deleted_at,
    catalog_source: 'ingredient',
  };
}

const sortedFoods = computed(() => {
  const q = foodQuery.value.trim().toLowerCase();
  const items = q ? foods.value.filter((food) => `${searchableLocalizedName(food)} ${food.brand ?? ''} ${food.note ?? ''} ${food.barcode ?? ''} ${food.id}`.toLowerCase().includes(q)) : [...foods.value];
  return items.sort((a, b) => {
    if (foodSort.value === 'kcal') return b.kcal_per_100g - a.kcal_per_100g;
    if (foodSort.value === 'protein') return b.protein_per_100g - a.protein_per_100g;
    if (foodSort.value === 'carbs') return b.carbs_per_100g - a.carbs_per_100g;
    if (foodSort.value === 'fat') return b.fat_per_100g - a.fat_per_100g;
    return compareLocalizedName(a, b);
  });
});


const ingredientQuery = ref('');
const ingredientSort = ref<'name' | 'kcal' | 'protein' | 'carbs' | 'fat'>('name');

const sortedIngredients = computed(() => {
  const q = ingredientQuery.value.trim().toLowerCase();
  const items = q ? ingredients.value.filter((ingredient) => `${searchableLocalizedName(ingredient)} ${ingredient.note ?? ''} ${ingredient.id}`.toLowerCase().includes(q)) : [...ingredients.value];
  return items.sort((a, b) => {
    if (ingredientSort.value === 'kcal') return b.kcal_per_100g - a.kcal_per_100g;
    if (ingredientSort.value === 'protein') return b.protein_per_100g - a.protein_per_100g;
    if (ingredientSort.value === 'carbs') return b.carbs_per_100g - a.carbs_per_100g;
    if (ingredientSort.value === 'fat') return b.fat_per_100g - a.fat_per_100g;
    return compareLocalizedName(a, b);
  });
});

const sortedRecipes = computed(() => {
  const q = recipeQuery.value.trim().toLowerCase();
  const items = q ? recipes.value.filter((detail) => `${searchableLocalizedName(detail.recipe)} ${detail.recipe.description ?? ''} ${detail.recipe.note ?? ''} ${detail.recipe.id}`.toLowerCase().includes(q)) : [...recipes.value];
  return items.sort((a, b) => {
    const nutritionA = recipeDynamicNutrition(a);
    const nutritionB = recipeDynamicNutrition(b);
    if (recipeSort.value === 'kcal') return nutritionB.kcalTotal - nutritionA.kcalTotal;
    if (recipeSort.value === 'protein') return nutritionB.proteinTotal - nutritionA.proteinTotal;
    if (recipeSort.value === 'carbs') return nutritionB.carbsTotal - nutritionA.carbsTotal;
    if (recipeSort.value === 'fat') return nutritionB.fatTotal - nutritionA.fatTotal;
    return compareLocalizedName(a.recipe, b.recipe);
  });
});

const apiDisplay = computed(() => status.value?.base_url ?? t('ui.startServerToPairMobile'));
const serverRunning = computed(() => Boolean(status.value?.running));

const connectedDeviceCount = computed(() => connectedDevices.value.length || status.value?.connected_devices || 0);

function formatDeviceSeenAt(value: number): string {
  const diff = Math.max(0, Date.now() - Number(value || 0));
  if (diff < 10_000) return t('ui.justNow');
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return formatDateTime(value);
}

function connectedDeviceSubtitle(device: ConnectedDevice): string {
  const platform = [device.platform, device.os_version].filter(Boolean).join(' ');
  const parts = [
    device.manufacturer && device.model && !device.display_name.toLowerCase().includes(device.model.toLowerCase()) ? `${device.manufacturer} ${device.model}` : '',
    platform,
    device.ip_address,
  ].filter(Boolean);
  return parts.join(' · ');
}

function connectedDeviceAppLabel(device: ConnectedDevice): string {
  const channel = String(device.app_channel || 'unknown').trim();
  const version = String(device.app_version || '').trim();
  if (version) return `${channel} · v${version}`;
  return `${channel} · ${t('ui.versionUnknown')}`;
}


const navigation: Array<{ key: Tab; label: string; icon: AppIconName }> = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'ingredients', label: 'Ingredients', icon: 'ingredients' },
  { key: 'foods', label: 'Foods', icon: 'foods' },
  { key: 'recipes', label: 'Recipes', icon: 'recipes' },
  { key: 'activities', label: 'Activities', icon: 'activities' },
  { key: 'server', label: 'Server', icon: 'server' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

const settingRows: Array<{ key: keyof DesktopSettings; titleKey: string; bodyKey: string; icon: AppIconName }> = [
  { key: 'remember_window_state', titleKey: 'ui.settingRememberWindowTitle', bodyKey: 'ui.settingRememberWindowBody', icon: 'settings' },
  { key: 'launch_at_startup', titleKey: 'ui.settingLaunchStartupTitle', bodyKey: 'ui.settingLaunchStartupBody', icon: 'server' },
  { key: 'run_in_background', titleKey: 'ui.settingRunBackgroundTitle', bodyKey: 'ui.settingRunBackgroundBody', icon: 'dashboard' },
  { key: 'auto_start_server', titleKey: 'ui.settingAutoStartServerTitle', bodyKey: 'ui.settingAutoStartServerBody', icon: 'server' },
  { key: 'close_to_tray', titleKey: 'ui.settingCloseTrayTitle', bodyKey: 'ui.settingCloseTrayBody', icon: 'settings' },
  { key: 'start_hidden_to_tray', titleKey: 'ui.settingStartHiddenTitle', bodyKey: 'ui.settingStartHiddenBody', icon: 'dashboard' },
];



type SettingRow = (typeof settingRows)[number];

const settingGroups: Array<{ titleKey: string; subtitleKey: string; rows: SettingRow[] }> = [
  {
    titleKey: 'ui.settingRuntimeTitle',
    subtitleKey: 'ui.settingRuntimeSubtitle',
    rows: [settingRows[1], settingRows[3], settingRows[2]],
  },
  {
    titleKey: 'ui.settingWindowTitle',
    subtitleKey: 'ui.settingWindowSubtitle',
    rows: [settingRows[0], settingRows[4], settingRows[5]],
  },
];

const appIconMap = {
  dashboard: 'layoutDashboard',
  ingredients: 'wheat',
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

function formatOptionalGrams(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${round(value)}g` : '—';
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

function detectDesktopUpdateTarget() {
  const platform = String(navigator.platform || navigator.userAgent || '').toLowerCase();
  if (platform.includes('win')) return 'windows' as const;
  if (platform.includes('mac')) return 'macos' as const;
  if (platform.includes('linux')) return 'linux' as const;
  return 'desktop' as const;
}

function updateReleaseTitle(result = updateCheckResult.value): string {
  if (!result?.release) return t('ui.appUpdates');
  return `${t('ui.updateAvailable')} ${result.release.version}`;
}

function updateReleaseBody(result = updateCheckResult.value): string {
  if (!result?.release) return t('ui.latestInstalled');
  return `${t('ui.updateAvailableBody')} ${t('ui.versionLabel')} ${appVersion} → ${result.release.version}.`;
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

async function checkForAppUpdates(options: { quiet?: boolean; manual?: boolean; ignoreRemindLater?: boolean } = {}) {
  if (updateBusy.value) return;
  updateBusy.value = true;
  try {
    const result = await checkNutrinoUpdates(appVersion, {
      includePrereleases: settings.value?.check_prerelease_updates === true,
      target: detectDesktopUpdateTarget(),
    });
    updateCheckResult.value = result;
    if (result.status === 'available' && (options.ignoreRemindLater || options.manual || !updateRemindLaterActive(result))) {
      updateDialogOpen.value = true;
      return;
    }
    if (options.manual && !options.quiet) setMessage(t('ui.latestInstalled'));
  } catch (error) {
    if (!options.quiet || options.manual) setMessage(`${t('ui.updateCheckFailed')}: ${String(error)}`);
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
    await commands.downloadAndOpenUpdateInstaller(url, release.assetName || `nutrino-${release.version}`);
    updateDialogOpen.value = false;
    setMessage(t('ui.updateInstallerStarted'));
  } catch (error) {
    updateDialogOpen.value = true;
    setMessage(`${t('ui.updateInstallerFailed')}: ${String(error)}`);
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
  setMessage(t('ui.remindLaterSaved'));
}

function openUpdateCenter() {
  if (updateAvailable.value) {
    updateDialogOpen.value = true;
    return;
  }
  void checkForAppUpdates({ manual: true, ignoreRemindLater: true });
}

function typeLabel(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

async function refreshConnectedDevices() {
  try {
    connectedDevices.value = await commands.listConnectedDevices();
    if (status.value) status.value = { ...status.value, connected_devices: connectedDevices.value.length };
  } catch {
    connectedDevices.value = [];
  }
}

async function refreshAll() {
  status.value = await commands.getServerStatus();
  await refreshConnectedDevices();
  serverPassword.value = status.value.token || '';
  ingredients.value = await commands.listIngredients();
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
    await refreshConnectedDevices();
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
    await refreshConnectedDevices();
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
    connectedDevices.value = [];
    setMessage('LAN API server stopped. Mobile can continue with its offline cache.');
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}



type InboxPayloadArrayKey = 'ingredients' | 'foods' | 'recipes' | 'recipe_items' | 'activities' | 'intakes' | 'activity_logs' | 'weight_logs';
type InboxReviewKind = 'ingredient' | 'food' | 'recipe' | 'recipe_item' | 'activity' | 'intake' | 'activity_log' | 'weight_log';
type InboxReviewStatus = 'new' | 'modified' | 'unchanged' | 'skipped';

type InboxReviewItem = {
  key: string;
  kind: InboxReviewKind;
  payloadKey?: InboxPayloadArrayKey;
  index?: number;
  id: string;
  label: string;
  subtitle: string;
  status: InboxReviewStatus;
  item?: unknown;
  skippedItem?: SkippedSyncItem;
  existingLabel?: string;
  incomingUpdatedAt?: number;
  existingUpdatedAt?: number;
};

function normalizeNullable(value: unknown) {
  if (value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100000) / 100000 : null;
  return value;
}

function comparableCatalogContent(kind: InboxReviewKind, value: any): Record<string, unknown> {
  if (kind === 'ingredient') {
    return {
      name: normalizeNullable(value?.name),
      note: normalizeNullable(value?.note),
      default_unit: normalizeNullable(value?.default_unit),
      serving_size_g: normalizeNullable(value?.serving_size_g),
      kcal_per_100g: normalizeNullable(value?.kcal_per_100g),
      carbs_per_100g: normalizeNullable(value?.carbs_per_100g),
      fat_per_100g: normalizeNullable(value?.fat_per_100g),
      protein_per_100g: normalizeNullable(value?.protein_per_100g),
      sugars_per_100g: normalizeNullable(value?.sugars_per_100g),
      fiber_per_100g: normalizeNullable(value?.fiber_per_100g),
      salt_per_100g: normalizeNullable(value?.salt_per_100g),
      deleted_at: normalizeNullable(value?.deleted_at),
    };
  }
  if (kind === 'food') {
    return {
      name: normalizeNullable(value?.name),
      brand: normalizeNullable(value?.brand),
      note: normalizeNullable(value?.note),
      barcode: normalizeNullable(value?.barcode),
      default_unit: normalizeNullable(value?.default_unit),
      serving_size_g: normalizeNullable(value?.serving_size_g),
      kcal_per_100g: normalizeNullable(value?.kcal_per_100g),
      carbs_per_100g: normalizeNullable(value?.carbs_per_100g),
      fat_per_100g: normalizeNullable(value?.fat_per_100g),
      protein_per_100g: normalizeNullable(value?.protein_per_100g),
      sugars_per_100g: normalizeNullable(value?.sugars_per_100g),
      fiber_per_100g: normalizeNullable(value?.fiber_per_100g),
      salt_per_100g: normalizeNullable(value?.salt_per_100g),
      deleted_at: normalizeNullable(value?.deleted_at),
    };
  }
  if (kind === 'recipe') {
    return {
      name: normalizeNullable(value?.name),
      description: normalizeNullable(value?.description),
      note: normalizeNullable(value?.note),
      extra_kcal: normalizeNullable(value?.extra_kcal),
      servings_count: normalizeNullable(value?.servings_count),
      deleted_at: normalizeNullable(value?.deleted_at),
    };
  }
  if (kind === 'activity') {
    return {
      code: normalizeNullable(value?.code),
      name: normalizeNullable(value?.name),
      description: normalizeNullable(value?.description),
      activity_type: normalizeNullable(value?.activity_type || value?.type),
      met: normalizeNullable(value?.met),
      kcal_per_min: normalizeNullable(value?.kcal_per_min),
      deleted_at: normalizeNullable(value?.deleted_at),
    };
  }
  return value ?? {};
}

function sameCatalogContent(kind: InboxReviewKind, incoming: unknown, existing: unknown) {
  return JSON.stringify(comparableCatalogContent(kind, incoming)) === JSON.stringify(comparableCatalogContent(kind, existing));
}

function desktopItemForInbox(kind: InboxReviewKind, id: string): unknown | undefined {
  if (kind === 'ingredient') return ingredients.value.find((item) => item.id === id);
  if (kind === 'food') return foods.value.find((item) => item.id === id);
  if (kind === 'recipe') return recipes.value.find((item) => item.recipe.id === id)?.recipe;
  if (kind === 'activity') return activities.value.find((item) => item.id === id);
  return undefined;
}

function inboxPayloadKeyForKind(kind: InboxReviewKind): InboxPayloadArrayKey | null {
  if (kind === 'ingredient') return 'ingredients';
  if (kind === 'food') return 'foods';
  if (kind === 'recipe') return 'recipes';
  if (kind === 'activity') return 'activities';
  if (kind === 'recipe_item') return 'recipe_items';
  if (kind === 'intake') return 'intakes';
  if (kind === 'activity_log') return 'activity_logs';
  if (kind === 'weight_log') return 'weight_logs';
  return null;
}

function inboxKindFromPayloadKey(key: InboxPayloadArrayKey): InboxReviewKind {
  if (key === 'ingredients') return 'ingredient';
  if (key === 'foods') return 'food';
  if (key === 'recipes') return 'recipe';
  if (key === 'activities') return 'activity';
  if (key === 'recipe_items') return 'recipe_item';
  if (key === 'activity_logs') return 'activity_log';
  if (key === 'weight_logs') return 'weight_log';
  return 'intake';
}

function inboxItemLabel(kind: InboxReviewKind, item: any): string {
  if (kind === 'recipe_item') return item?.food_id || item?.id || 'Recipe item';
  if (kind === 'activity_log') return item?.activity_name || item?.id || 'Activity log';
  if (kind === 'weight_log') return item?.weight_kg ? `${item.weight_kg} kg` : item?.id || 'Weight log';
  if (kind === 'intake') return item?.note_title || item?.food_id || item?.id || 'Meal / note';
  return item?.name || item?.code || item?.id || 'Unnamed item';
}

function inboxItemSubtitle(kind: InboxReviewKind, item: any, existing?: any): string {
  if (kind === 'ingredient' || kind === 'food') {
    const brand = kind === 'food' && item?.brand ? ` · ${item.brand}` : '';
    return `${Math.round(Number(item?.kcal_per_100g || 0))} kcal / 100g${brand}`;
  }
  if (kind === 'recipe') return `${Number(item?.extra_kcal || 0) ? `${round(Number(item.extra_kcal))} extra kcal · ` : ''}${item?.description || 'recipe'}`;
  if (kind === 'activity') return `${item?.activity_type || item?.type || 'activity'} · ${round(Number(item?.kcal_per_min || 0))} kcal/min`;
  if (kind === 'intake') return `${Math.round(Number(item?.amount_g || 0))} g · ${item?.meal_type || 'meal'} · ${formatDateTime(Number(item?.consumed_at || Date.now()))}`;
  if (kind === 'recipe_item') return `${Math.round(Number(item?.amount_g || 0))} g · recipe ${item?.recipe_id || ''}`;
  if (kind === 'activity_log') return `${Math.round(Number(item?.duration_min || 0))} min · ${Math.round(Number(item?.kcal || 0))} kcal`;
  if (kind === 'weight_log') return `${formatDateTime(Number(item?.measured_at || Date.now()))}`;
  return existing?.name ? `Desktop: ${existing.name}` : '';
}

function inboxReviewItemStatus(kind: InboxReviewKind, item: any): { status: InboxReviewStatus; existing?: any } {
  if (kind === 'recipe_item' || kind === 'intake' || kind === 'activity_log' || kind === 'weight_log') return { status: 'new' };
  const existing = desktopItemForInbox(kind, String(item?.id || ''));
  if (!existing) return { status: 'new' };
  return { status: sameCatalogContent(kind, item, existing) ? 'unchanged' : 'modified', existing };
}
function recipeItemsChangedForInbox(payload: SyncPushPayload, recipeId: string): boolean {
  const incoming = (payload.recipe_items || [])
    .filter((row) => row.recipe_id === recipeId || row.recipe_id === `recipe:${recipeId}`)
    .map((row) => ({ food_id: String(row.food_id || ''), amount_g: normalizeNullable(row.amount_g), deleted_at: normalizeNullable(row.deleted_at) }))
    .sort((a, b) => a.food_id.localeCompare(b.food_id));
  if (!incoming.length) return false;
  const existing = recipes.value.find((detail) => detail.recipe.id === recipeId)?.items
    .map((row) => ({ food_id: String(row.food_id || ''), amount_g: normalizeNullable(row.amount_g), deleted_at: normalizeNullable(row.deleted_at) }))
    .sort((a, b) => a.food_id.localeCompare(b.food_id)) || [];
  return JSON.stringify(incoming) !== JSON.stringify(existing);
}


function buildInboxReviewItems(entry: SyncInboxEntry): InboxReviewItem[] {
  const payload = entry.payload;
  const rows: InboxReviewItem[] = [];
  const pushRows = (payloadKey: InboxPayloadArrayKey) => {
    const value = payload[payloadKey];
    if (!Array.isArray(value)) return;
    const kind = inboxKindFromPayloadKey(payloadKey);
    value.forEach((item: any, index: number) => {
      const id = String(item?.id || `${payloadKey}-${index}`);
      const base = inboxReviewItemStatus(kind, item);
      let status = base.status;
      const existing = base.existing;
      if (kind === 'recipe' && status === 'unchanged' && recipeItemsChangedForInbox(payload, String(item?.id || ''))) status = 'modified';
      rows.push({
        key: `${entry.id}:${payloadKey}:${id}:${index}`,
        kind,
        payloadKey,
        index,
        id,
        label: inboxItemLabel(kind, item),
        subtitle: inboxItemSubtitle(kind, item, existing),
        status,
        item,
        existingLabel: existing ? inboxItemLabel(kind, existing) : undefined,
        incomingUpdatedAt: Number(item?.updated_at || item?.consumed_at || item?.performed_at || item?.measured_at || 0),
        existingUpdatedAt: Number(existing?.updated_at || 0),
      });
    });
  };

  for (const key of ['ingredients', 'foods', 'recipes', 'activities'] as InboxPayloadArrayKey[]) pushRows(key);
  for (const skipped of payload.skipped_items || []) {
    const kind = skipped.kind as InboxReviewKind;
    rows.push({
      key: `${entry.id}:skipped:${skipped.kind}:${skipped.id}`,
      kind,
      id: skipped.id,
      label: skipped.label || inboxItemLabel(kind, skipped.item as any),
      subtitle: 'Skipped locally · kept in this mobile upload draft',
      status: 'skipped',
      skippedItem: skipped,
    });
  }
  return rows;
}

function visibleInboxReviewItems(entry: SyncInboxEntry) {
  return buildInboxReviewItems(entry).filter((item) => !hideUnchangedInboxItems.value || item.status !== 'unchanged');
}

function inboxStatusCounts(entry: SyncInboxEntry): Record<InboxReviewStatus, number> {
  const counts: Record<InboxReviewStatus, number> = { new: 0, modified: 0, unchanged: 0, skipped: 0 };
  for (const item of buildInboxReviewItems(entry)) counts[item.status]++;
  return counts;
}

function inboxStatusLabel(status: InboxReviewStatus) {
  if (status === 'new') return t('ui.statusNew');
  if (status === 'modified') return t('ui.statusModified');
  if (status === 'unchanged') return t('ui.statusUnchanged');
  return t('ui.statusSkipped');
}

function inboxStatusHint(item: InboxReviewItem) {
  if (item.status === 'new') return 'This item does not exist on desktop yet.';
  if (item.status === 'modified') return `Same ID exists on desktop${item.existingLabel ? ` as "${item.existingLabel}"` : ''}, but the content differs.`;
  if (item.status === 'unchanged') return 'Same ID and same content already exist on desktop.';
  return 'This item stays visible in the draft, but will not be recorded.';
}

function inboxItemClass(item: InboxReviewItem) {
  return [`inbox-review-row-${item.status}`, item.status === 'modified' ? 'inbox-review-row-attention' : ''];
}

function ensurePayloadArray(payload: SyncPushPayload, key: InboxPayloadArrayKey): unknown[] {
  const current = payload[key];
  if (Array.isArray(current)) return current;
  (payload as any)[key] = [];
  return (payload as any)[key];
}

function movePayloadItemToSkipped(payload: SyncPushPayload, item: InboxReviewItem) {
  if (!item.payloadKey || item.index === undefined) return;
  const rows = ensurePayloadArray(payload, item.payloadKey);
  const removed = rows.splice(item.index, 1)[0];
  if (!removed) return;
  payload.skipped_items = payload.skipped_items || [];
  payload.skipped_items.push({
    kind: item.kind,
    id: item.id,
    label: item.label,
    skipped_at: Date.now(),
    item: removed,
  });

  if (item.kind === 'recipe' && payload.recipe_items?.length) {
    const recipeItemsToSkip = payload.recipe_items.filter((row) => row.recipe_id === item.id || row.recipe_id === `recipe:${item.id}`);
    payload.recipe_items = payload.recipe_items.filter((row) => row.recipe_id !== item.id && row.recipe_id !== `recipe:${item.id}`);
    for (const recipeItem of recipeItemsToSkip) {
      payload.skipped_items.push({
        kind: 'recipe_item',
        id: recipeItem.id,
        label: `Recipe item for ${item.label}`,
        skipped_at: Date.now(),
        item: recipeItem,
      });
    }
  }
}

function restoreSkippedPayloadItem(payload: SyncPushPayload, skipped: SkippedSyncItem) {
  payload.skipped_items = (payload.skipped_items || []).filter((entry) => !(entry.kind === skipped.kind && entry.id === skipped.id));
  const key = inboxPayloadKeyForKind(skipped.kind as InboxReviewKind);
  if (!key) return;
  ensurePayloadArray(payload, key).push(skipped.item);
}

async function saveInboxEntryPayloadDraft(entry: SyncInboxEntry) {
  const updated = await commands.updateSyncInboxPayload(entry.id, JSON.stringify(entry.payload, null, 2));
  const idx = syncInbox.value.findIndex((candidate) => candidate.id === updated.id);
  if (idx >= 0) syncInbox.value[idx] = updated;
  if (reviewingInboxEntry.value?.id === updated.id) {
    reviewingInboxEntry.value = JSON.parse(JSON.stringify(updated));
    reviewPayloadText.value = JSON.stringify(updated.payload, null, 2);
  }
  return updated;
}

async function skipInboxReviewItem(entry: SyncInboxEntry, item: InboxReviewItem) {
  if (!item.payloadKey || item.index === undefined) return;
  loading.value = true;
  try {
    movePayloadItemToSkipped(entry.payload, item);
    await saveInboxEntryPayloadDraft(entry);
    setMessage(`Skipped ${item.kind}: ${item.label}. It remains visible in the upload draft but will not be recorded.`);
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function restoreInboxSkippedItem(entry: SyncInboxEntry, item: InboxReviewItem) {
  if (!item.skippedItem) return;
  loading.value = true;
  try {
    restoreSkippedPayloadItem(entry.payload, item.skippedItem);
    await saveInboxEntryPayloadDraft(entry);
    setMessage(`Restored ${item.kind}: ${item.label}.`);
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

function skipReviewPayloadItem(key: InboxPayloadArrayKey, index: number) {
  if (!reviewingInboxEntry.value) return;
  const rows = ensurePayloadArray(reviewingInboxEntry.value.payload, key);
  const kind = inboxKindFromPayloadKey(key);
  const item = rows[index] as any;
  if (!item) return;
  movePayloadItemToSkipped(reviewingInboxEntry.value.payload, {
    key: `${key}:${item.id || index}`,
    kind,
    payloadKey: key,
    index,
    id: String(item.id || `${key}-${index}`),
    label: inboxItemLabel(kind, item),
    subtitle: inboxItemSubtitle(kind, item),
    status: 'skipped',
    item,
  });
}

function restoreReviewSkippedItem(skipped: SkippedSyncItem) {
  if (!reviewingInboxEntry.value) return;
  restoreSkippedPayloadItem(reviewingInboxEntry.value.payload, skipped);
}

function reviewItemStatus(kind: InboxReviewKind, item: unknown) {
  return inboxReviewItemStatus(kind, item).status;
}

function reviewItemStatusText(kind: InboxReviewKind, item: unknown) {
  return inboxStatusLabel(reviewItemStatus(kind, item));
}

function syncInboxSummary(entry: SyncInboxEntry) {
  const parts = [
    entry.summary.ingredients ? `${entry.summary.ingredients} ingredients` : '',
    entry.summary.foods ? `${entry.summary.foods} foods` : '',
    entry.summary.recipes ? `${entry.summary.recipes} recipes` : '',
    entry.summary.activities ? `${entry.summary.activities} activities` : '',

  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('ui.inboxNoDataItems');
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

const reviewIngredients = computed<Ingredient[]>(() => reviewingInboxEntry.value?.payload.ingredients ?? []);
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
  if (kind === 'ingredient') return ingredients.value.map((ingredient) => ({ id: ingredient.id, name: localizedName(ingredient), name_i18n: ingredient.name_i18n ?? {}, subtitle: `${round(ingredient.kcal_per_100g)} kcal / 100g · ingredient` }));
  if (kind === 'food') return foods.value.map((food) => ({ id: food.id, name: localizedName(food), name_i18n: food.name_i18n ?? {}, subtitle: `${round(food.kcal_per_100g)} kcal / 100g · ${food.brand || 'no brand'}` }));
  if (kind === 'recipe') return recipes.value.map((detail) => ({ id: detail.recipe.id, name: localizedName(detail.recipe), name_i18n: detail.recipe.name_i18n ?? {}, subtitle: `${round(detail.nutrition.kcal_per_100g)} kcal / 100g · ${detail.recipe.description || 'no description'}` }));
  return activities.value.map((activity) => ({ id: activity.id, name: localizedName(activity), name_i18n: activity.name_i18n ?? {}, subtitle: `code ${activity.code} · MET ${round(activity.met)} · ${activity.activity_type}` }));
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
  if (kind === 'ingredient') {
    const item = ingredients.value.find((ingredient) => ingredient.id === id);
    if (item) openIngredientModal(item);
  } else if (kind === 'food') {
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

type CatalogQrSource = Ingredient | Food | Recipe | ActivityDefinition | RecipeDetail;
const catalogQrPrefix = 'nutrino-catalog-v1:';
const catalogQrPartPrefix = 'nutrino-catalog-part-v1:';
const singleQrMaxLength = 760;
const qrPartChunkLength = 420;

function encodeUtf8Base64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function createQrSequence(payload: string): string[] {
  if (payload.length <= singleQrMaxLength || !payload.startsWith(catalogQrPrefix)) return [payload];
  const encoded = payload.slice(catalogQrPrefix.length);
  const sequenceId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const total = Math.ceil(encoded.length / qrPartChunkLength);
  return Array.from({ length: total }, (_, index) => {
    const part = encoded.slice(index * qrPartChunkLength, (index + 1) * qrPartChunkLength);
    return `${catalogQrPartPrefix}${sequenceId}:${index + 1}:${total}:${part}`;
  });
}

function activeQrPart() {
  const dialog = qrDialog.value;
  if (!dialog) return null;
  return dialog.parts[Math.min(Math.max(dialog.activeIndex, 0), dialog.parts.length - 1)] ?? null;
}

function setQrPart(index: number) {
  if (!qrDialog.value) return;
  qrDialog.value.activeIndex = Math.min(Math.max(index, 0), qrDialog.value.parts.length - 1);
}

function activeQrPartLabel(): string {
  const part = activeQrPart();
  if (!part) return '';
  return part.total > 1 ? `QR ${part.index}/${part.total}` : 'QR code';
}

function activeQrHasMultiple(): boolean {
  return (activeQrPart()?.total ?? 0) > 1;
}

function activeQrPartSvg(): string {
  return activeQrPart()?.svg ?? '';
}

function activeQrPartPayload(): string {
  return activeQrPart()?.payload ?? qrDialog.value?.payload ?? '';
}

function recipeQrDependencies(detail: RecipeDetail) {
  const ingredientIds = new Set<string>();
  const foodIds = new Set<string>();
  const recipeIds = new Set<string>();
  for (const item of detail.items) {
    const id = String(item.food_id || '');
    if (id.startsWith('ingredient:')) ingredientIds.add(id.replace(/^ingredient:/, ''));
    else if (id.startsWith('recipe:')) recipeIds.add(id.replace(/^recipe:/, ''));
    else if (id) foodIds.add(id);
  }
  recipeIds.delete(detail.recipe.id);
  return {
    ingredients: ingredients.value.filter((item) => ingredientIds.has(item.id)),
    foods: foods.value.filter((item) => foodIds.has(item.id)),
    recipes: recipes.value.filter((item) => recipeIds.has(item.recipe.id)).map((item) => item.recipe),
  };
}

function encodeCatalogQrPayload(kind: CatalogKind, source: CatalogQrSource): string {
  if (kind === 'recipe' && 'recipe' in source && 'items' in source) {
    const detail = source as RecipeDetail;
    const body = {
      app: 'nutrino',
      version: 2,
      kind,
      item: detail.recipe,
      recipe_items: detail.items.map((item) => ({
        id: item.id,
        recipe_id: detail.recipe.id,
        food_id: item.food_id,
        amount_g: item.amount_g,
        updated_at: detail.recipe.updated_at,
        deleted_at: null,
      })),
      dependencies: recipeQrDependencies(detail),
    };
    return `${catalogQrPrefix}${encodeUtf8Base64(JSON.stringify(body))}`;
  }

  const body = { app: 'nutrino', version: 1, kind, item: source };
  return `${catalogQrPrefix}${encodeUtf8Base64(JSON.stringify(body))}`;
}


async function showCatalogQr(kind: CatalogKind, item: CatalogQrSource, title: string) {
  try {
    const payload = encodeCatalogQrPayload(kind, item);
    const sequencePayloads = createQrSequence(payload);
    const parts: QrDialogPart[] = [];
    for (let index = 0; index < sequencePayloads.length; index += 1) {
      const svg = await QRCode.toString(sequencePayloads[index], { type: 'svg', margin: 1, width: 300, errorCorrectionLevel: 'M' });
      parts.push({ index: index + 1, total: sequencePayloads.length, svg, payload: sequencePayloads[index] });
    }
    qrDialog.value = { title, parts, activeIndex: 0, payload };
  } catch (error) {
    setMessage(String(error));
  }
}

async function acceptInboxEntry(entry: SyncInboxEntry) {
  if (!window.confirm(t('ui.recordMobileUploadConfirm'))) return;
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
  if (!window.confirm(t('ui.rejectMobileUploadConfirm'))) return;
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

function openIngredientModal(ingredient?: Ingredient) {
  if (ingredient) {
    ingredientForm.value = {
      id: ingredient.id,
      name: ingredient.name,
      name_i18n: { ...(ingredient.name_i18n ?? {}) },
      note: ingredient.note ?? '',
      default_unit: ingredient.default_unit,
      serving_size_g: ingredient.serving_size_g ?? null,
      kcal_per_100g: ingredient.kcal_per_100g,
      carbs_per_100g: ingredient.carbs_per_100g,
      fat_per_100g: ingredient.fat_per_100g,
      protein_per_100g: ingredient.protein_per_100g,
      sugars_per_100g: ingredient.sugars_per_100g,
      fiber_per_100g: ingredient.fiber_per_100g,
      salt_per_100g: ingredient.salt_per_100g,
      optional_nutrients: { ...(ingredient.optional_nutrients ?? {}) },
    };
  } else {
    ingredientForm.value = emptyIngredientForm();
  }
  modal.value = 'ingredient';
  captureModalSnapshot('ingredient');
}

function openFoodModal(food?: Food) {
  if (food) {
    foodForm.value = {
      id: food.id,
      name: food.name,
      name_i18n: { ...(food.name_i18n ?? {}) },
      brand: food.brand ?? '',
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
      optional_nutrients: { ...(food.optional_nutrients ?? {}) },
    };
  } else {
    foodForm.value = emptyFoodForm();
  }
  modal.value = 'food';
  captureModalSnapshot('food');
}

function openActivityModal(activity?: ActivityDefinition) {
  if (activity) {
    activityForm.value = {
      id: activity.id,
      code: activity.code,
      name: activity.name,
      name_i18n: { ...(activity.name_i18n ?? {}) },
      description: activity.description ?? '',
      activity_type: activity.activity_type,
      met: activity.met,
      kcal_per_min: activity.kcal_per_min,
    };
  } else {
    activityForm.value = emptyActivityForm();
  }
  modal.value = 'activity';
  captureModalSnapshot('activity');
}

function openRecipeModal(recipe?: RecipeDetail) {
  if (recipe) {
    recipeForm.value = {
      id: recipe.recipe.id,
      name: recipe.recipe.name,
      name_i18n: { ...(recipe.recipe.name_i18n ?? {}) },
      description: recipe.recipe.description ?? '',
      note: recipe.recipe.note ?? '',
      total_weight_g: null,
      extra_kcal: recipe.recipe.extra_kcal ?? 0,
      servings_count: recipe.recipe.servings_count ?? null,
      items: recipe.items.map((item) => ({ food_id: item.food_id, amount_g: item.amount_g })),
    };
  } else {
    recipeForm.value = emptyRecipeForm();
  }
  if (!recipeForm.value.items.length) addRecipeItem();
  recipeIngredientSearch.value = {};
  recipeIngredientPickerOpen.value = {};
  recipeIngredientSearchRefs.value = {};
  modal.value = 'recipe';
  captureModalSnapshot('recipe');
}

function requestCloseModal() {
  if (!modal.value) return;
  if (!hasModalDraftChanges() || window.confirm(t('ui.closeUnsavedPanelConfirm'))) {
    closeModal();
  }
}

function handleModalBackdropClick() {
  setMessage('Use Close or Save to leave this editor. Backdrop clicks are ignored to prevent accidental data loss.');
}

function closeModal() {
  modal.value = null;
  modalInitialSnapshot.value = '';
}

async function saveIngredient() {
  loading.value = true;
  try {
    await commands.saveIngredient(ingredientForm.value);
    setMessage(editingIngredientId.value ? 'Ingredient updated.' : 'Ingredient created.');
    closeModal();
    ingredientForm.value = emptyIngredientForm();
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function saveFood() {
  loading.value = true;
  try {
    await commands.saveFood(foodForm.value);
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

async function moveFoodToIngredient(food: Food) {
  if (!window.confirm(`Move ${food.name} from foods to ingredients? Existing server references will be migrated by ID.`)) return;
  loading.value = true;
  try {
    await commands.saveIngredient({
      id: food.id,
      name: food.name,
      note: food.note ?? null,
      default_unit: food.default_unit,
      serving_size_g: food.serving_size_g ?? null,
      kcal_per_100g: food.kcal_per_100g,
      carbs_per_100g: food.carbs_per_100g,
      fat_per_100g: food.fat_per_100g,
      protein_per_100g: food.protein_per_100g,
      sugars_per_100g: food.sugars_per_100g,
      fiber_per_100g: food.fiber_per_100g,
      salt_per_100g: food.salt_per_100g,
      optional_nutrients: { ...(food.optional_nutrients ?? {}) },
    });
    await commands.deleteFood(food.id);
    setMessage('Moved to ingredients.');
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function moveIngredientToFood(ingredient: Ingredient) {
  if (!window.confirm(`Move ${ingredient.name} from ingredients to foods? It will become a concrete food item without brand/barcode yet.`)) return;
  loading.value = true;
  try {
    await commands.saveFood({
      id: ingredient.id,
      name: ingredient.name,
      brand: null,
      note: ingredient.note ?? null,
      barcode: null,
      default_unit: ingredient.default_unit,
      serving_size_g: ingredient.serving_size_g ?? null,
      kcal_per_100g: ingredient.kcal_per_100g,
      carbs_per_100g: ingredient.carbs_per_100g,
      fat_per_100g: ingredient.fat_per_100g,
      protein_per_100g: ingredient.protein_per_100g,
      sugars_per_100g: ingredient.sugars_per_100g,
      fiber_per_100g: ingredient.fiber_per_100g,
      salt_per_100g: ingredient.salt_per_100g,
      optional_nutrients: { ...(ingredient.optional_nutrients ?? {}) },
    });
    await commands.deleteIngredient(ingredient.id);
    setMessage('Moved to foods.');
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function removeIngredient(ingredient: Ingredient) {
  const confirmed = window.confirm(`Delete ingredient ${ingredient.name}? Existing logs keep their snapshots, but this ingredient will no longer be selectable.`);
  if (!confirmed) return;
  loading.value = true;
  try {
    await commands.deleteIngredient(ingredient.id);
    setMessage('Ingredient deleted.');
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


async function importIngredientsFromFile(event: Event) {
  const text = await readCsvFile(event);
  if (!text) return;
  loading.value = true;
  try {
    const result = await commands.importIngredientsCsv(text, skipCsvDuplicates.value);
    setMessage(`Imported ${result.inserted_or_updated} ingredients. Skipped ${result.skipped}.`);
    await refreshAll();
  } catch (error) {
    setMessage(String(error));
  } finally {
    loading.value = false;
  }
}

async function exportIngredients() {
  try {
    const text = await commands.exportIngredientsCsv();
    downloadCsv(`nutrino-ingredients-${new Date().toISOString().slice(0, 10)}.csv`, text);
    setMessage('Ingredients CSV exported.');
  } catch (error) {
    setMessage(String(error));
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
  recipeForm.value.items.push({ food_id: '', amount_g: 0 });
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
  let ingredientWeight = 0;
  let ingredientKcal = 0;
  let carbs = 0;
  let fat = 0;
  let protein = 0;

  for (const item of recipeForm.value.items) {
    const food = selectedFood(item);
    const amount = Math.max(0, Number(item.amount_g || 0));
    if (!food || amount <= 0) continue;
    ingredientWeight += amount;
    ingredientKcal += Number(food.kcal_per_100g || 0) * amount / 100;
    carbs += Number(food.carbs_per_100g || 0) * amount / 100;
    fat += Number(food.fat_per_100g || 0) * amount / 100;
    protein += Number(food.protein_per_100g || 0) * amount / 100;
  }

  const extraKcal = Number(recipeForm.value.extra_kcal || 0);
  const kcal = ingredientKcal + (Number.isFinite(extraKcal) ? extraKcal : 0);
  const ratio = ingredientWeight > 0 ? 100 / ingredientWeight : 0;
  const servings = Number(recipeForm.value.servings_count || 0) > 0 ? Number(recipeForm.value.servings_count) : null;
  return {
    ingredientWeight,
    totalWeight: ingredientWeight,
    servingWeight: servings && ingredientWeight > 0 ? ingredientWeight / servings : null,
    extraKcal: Number.isFinite(extraKcal) ? extraKcal : 0,
    kcalTotal: kcal,
    kcalPer100g: kcal * ratio,
    carbsTotal: carbs,
    fatTotal: fat,
    proteinTotal: protein,
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
      total_weight_g: null,
      extra_kcal: Number(recipeForm.value.extra_kcal || 0),
      servings_count: Number(recipeForm.value.servings_count || 0) > 0 ? Number(recipeForm.value.servings_count) : null,
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
  return activities.value.filter((activity) => [searchableLocalizedName(activity), activity.description ?? '', activity.activity_type, activity.code]
    .join(' ')
    .toLowerCase()
    .includes(q));
});


function recipeDetailAsCatalogItem(detail: RecipeDetail): RecipeCatalogItem {
  const totalWeight = detail.nutrition.total_weight_g;
  const serving = detail.recipe.servings_count && detail.recipe.servings_count > 0 && totalWeight > 0 ? totalWeight / detail.recipe.servings_count : null;
  return {
    id: `recipe:${detail.recipe.id}`,
    source_id: detail.recipe.source_id,
    name: detail.recipe.name,
    name_i18n: detail.recipe.name_i18n ?? {},
    brand: 'Recipe',
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
    optional_nutrients: {},
    updated_at: detail.recipe.updated_at,
    deleted_at: detail.recipe.deleted_at,
    catalog_source: 'recipe',
  };
}

const recipeCatalogItems = computed<RecipeCatalogItem[]>(() => [
  ...ingredients.value.map(ingredientAsRecipeCatalogItem),
  ...foods.value.map((food) => ({ ...food, catalog_source: 'food' as const })),
  ...recipes.value
    .filter((detail) => detail.recipe.id !== editingRecipeId.value)
    .map(recipeDetailAsCatalogItem),
].sort(compareLocalizedName));

function recipeIngredientOptions(index: number): RecipeCatalogItem[] {
  const q = String(recipeIngredientSearch.value[index] || '').trim().toLowerCase();
  if (!q) return recipeCatalogItems.value;
  return recipeCatalogItems.value.filter((item) => `${searchableLocalizedName(item)} ${item.brand ?? ''} ${item.note ?? ''} ${item.id}`.toLowerCase().includes(q));
}

function recipeIngredientLabel(item: RecipeCatalogItem): string {
  const name = localizedName(item);
  if (item.catalog_source === 'recipe') return `Recipe · ${name}`;
  if (item.catalog_source === 'ingredient') return `Ingredient · ${name}`;
  return `Food · ${name}${item.brand ? ` · ${item.brand}` : ''}`;
}

function selectedRecipeIngredientLabel(item: RecipeInputItem): string {
  const food = selectedFood(item);
  return food ? recipeIngredientLabel(food) : 'Choose food, ingredient or recipe';
}

function selectedRecipeIngredientMeta(item: RecipeInputItem): string {
  const food = selectedFood(item);
  if (!food) return '';
  return `${round(food.kcal_per_100g)} kcal / 100g · ${food.serving_size_g ? `${round(food.serving_size_g)} g/db` : 'grams only'}`;
}

function chooseRecipeIngredient(index: number, item: RecipeCatalogItem) {
  const row = recipeForm.value.items[index];
  if (!row) return;
  row.food_id = item.id;
  recipeIngredientSearch.value[index] = '';
  recipeIngredientPickerOpen.value[index] = false;
  onRecipeItemFoodChange(row);
}

function shouldShowRecipeIngredientSearch(item: RecipeInputItem, index: number): boolean {
  return !selectedFood(item) || Boolean(recipeIngredientPickerOpen.value[index]);
}

function setRecipeIngredientSearchRef(index: number, element: unknown) {
  if (element instanceof HTMLInputElement) recipeIngredientSearchRefs.value[index] = element;
  else delete recipeIngredientSearchRefs.value[index];
}

function openRecipeIngredientPicker(index: number, resetSearch = false) {
  if (resetSearch) recipeIngredientSearch.value[index] = '';
  recipeIngredientPickerOpen.value[index] = true;
  void nextTick(() => {
    const input = recipeIngredientSearchRefs.value[index];
    if (!input) return;
    input.focus();
    input.select();
  });
}

function closeRecipeIngredientPickerSoon(index: number) {
  window.setTimeout(() => {
    recipeIngredientPickerOpen.value[index] = false;
    const row = recipeForm.value.items[index];
    if (row && selectedFood(row)) recipeIngredientSearch.value[index] = '';
  }, 160);
}

function recipeItemNutrition(item: RecipeInputItem) {
  const food = selectedFood(item);
  const amount = Math.max(0, Number(item.amount_g || 0));
  if (!food || amount <= 0) return { weight: 0, kcal: 0, carbs: 0, fat: 0, protein: 0 };
  return {
    weight: Math.round(amount * 10) / 10,
    kcal: Math.round(Number(food.kcal_per_100g || 0) * amount / 100),
    carbs: Math.round(Number(food.carbs_per_100g || 0) * amount / 10) / 10,
    fat: Math.round(Number(food.fat_per_100g || 0) * amount / 10) / 10,
    protein: Math.round(Number(food.protein_per_100g || 0) * amount / 10) / 10,
  };
}

function recipeDynamicNutrition(detail: RecipeDetail) {
  const totalWeight = detail.items.reduce((sum, item) => sum + Math.max(0, Number(item.amount_g || 0)), 0);
  const ingredientKcal = detail.items.reduce((sum, item) => sum + Number(item.kcal || 0), 0);
  const extraKcal = Number(detail.recipe.extra_kcal || 0);
  const kcalTotal = ingredientKcal + (Number.isFinite(extraKcal) ? extraKcal : 0);
  const carbsTotal = detail.items.reduce((sum, item) => sum + Number(item.carbs || 0), 0);
  const fatTotal = detail.items.reduce((sum, item) => sum + Number(item.fat || 0), 0);
  const proteinTotal = detail.items.reduce((sum, item) => sum + Number(item.protein || 0), 0);
  const multiplier = totalWeight > 0 ? 100 / totalWeight : 0;
  const servings = Number(detail.recipe.servings_count || 0) > 0 ? Number(detail.recipe.servings_count) : null;
  return {
    totalWeight,
    servingWeight: servings && totalWeight > 0 ? totalWeight / servings : null,
    extraKcal: Number.isFinite(extraKcal) ? extraKcal : 0,
    kcalTotal,
    carbsTotal,
    fatTotal,
    proteinTotal,
    kcalPer100g: kcalTotal * multiplier,
    carbsPer100g: carbsTotal * multiplier,
    fatPer100g: fatTotal * multiplier,
    proteinPer100g: proteinTotal * multiplier,
  };
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
    setMessage(t('ui.recipesCsvExported'));
  } catch (error) { setMessage(String(error)); }
}


async function exportActivities() {
  try {
    const text = await commands.exportActivitiesCsv();
    downloadCsv(`nutrino-activities-${new Date().toISOString().slice(0, 10)}.csv`, text);
    setMessage(t('ui.activitiesCsvExported'));
  } catch (error) { setMessage(String(error)); }
}


async function toggleSetting(key: keyof DesktopSettings) {
  if (!settings.value || typeof settings.value[key] !== 'boolean') return;
  const next = { ...settings.value, [key]: !settings.value[key] } as DesktopSettings;
  try {
    settings.value = await commands.saveDesktopSettings(next);
    setMessage(t('ui.settingsSaved'));
  } catch (error) { setMessage(String(error)); }
}

async function saveDesktopSettingsNow() {
  if (!settings.value) return;
  try {
    settings.value = await commands.saveDesktopSettings(settings.value);
    setMessage(t('ui.settingsSaved'));
  } catch (error) { setMessage(String(error)); }
}

async function rememberWindowNow() {
  try {
    settings.value = await commands.rememberCurrentWindow();
    setMessage(t('ui.currentWindowSaved'));
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
  throw new Error(t('ui.invalidDesktopBackup'));
}

function assertValidZipBytes(bytes: Uint8Array) {
  if (!bytes.length) throw new Error(t('ui.emptyDesktopBackup'));
  if (bytes.length < 22) throw new Error(t('ui.invalidDesktopBackup'));
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(t('ui.invalidDesktopBackup'));
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
    ingredients: ingredients.value,
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
      if (savedBytes.length !== bytes.length) throw new Error(`${t('ui.exportSizeMismatch')}: ${formatBytes(savedBytes.length)} / ${formatBytes(bytes.length)}`);
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
    if (!manifestText || !dataText) throw new Error(t('ui.invalidDesktopBackup'));
    const manifest = JSON.parse(manifestText) as { app?: string; formatVersion?: number; exportType?: string };
    if (manifest.app !== 'nutrino' || manifest.formatVersion !== 1 || manifest.exportType !== 'desktop-server') {
      throw new Error(t('ui.invalidDesktopBackup'));
    }
    if (!window.confirm(t('ui.importOverwriteConfirm'))) {
      return setMessage('Import canceled.');
    }
    const data = JSON.parse(dataText) as {
      settings?: DesktopSettings;
      serverPassword?: string;
      desktopLocalStorage?: Record<string, string>;
      ingredients?: Ingredient[];
      foods?: Food[];
      recipes?: RecipeDetail[];
      activities?: ActivityDefinition[];
    };
    const currentRecipes = await commands.listRecipes();
    for (const recipe of currentRecipes) await commands.deleteRecipe(recipe.recipe.id);
    const currentActivities = await commands.listActivities();
    for (const activity of currentActivities) await commands.deleteActivity(activity.id);
    const currentIngredients = await commands.listIngredients();
    for (const ingredient of currentIngredients) await commands.deleteIngredient(ingredient.id);
    const currentFoods = await commands.listFoods();
    for (const food of currentFoods) await commands.deleteFood(food.id);
    restoreDesktopLocalStorage(data.desktopLocalStorage);
    if (typeof data.serverPassword === 'string') await commands.setServerPassword(data.serverPassword);
    if (data.settings) {
      const restoredSettings = { ...data.settings } as DesktopSettings;
      restoredSettings.check_prerelease_updates = data.settings.check_prerelease_updates === true;
      await commands.saveDesktopSettings(restoredSettings);
    }
    for (const ingredient of data.ingredients ?? []) {
      await commands.saveIngredient({
        id: ingredient.id,
        name: ingredient.name,
        note: ingredient.note ?? '',
        default_unit: ingredient.default_unit,
        serving_size_g: ingredient.serving_size_g ?? null,
        kcal_per_100g: ingredient.kcal_per_100g,
        carbs_per_100g: ingredient.carbs_per_100g,
        fat_per_100g: ingredient.fat_per_100g,
        protein_per_100g: ingredient.protein_per_100g,
        sugars_per_100g: ingredient.sugars_per_100g,
        fiber_per_100g: ingredient.fiber_per_100g,
        salt_per_100g: ingredient.salt_per_100g,
      });
    }
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
        total_weight_g: null,
        extra_kcal: detail.recipe.extra_kcal ?? 0,
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
  void checkForAppUpdates({ quiet: true });
  try {
    updateCheckUnlisten = await listen('nutrino-update-check-requested', () => {
      setMessage(t('ui.mobileRequestedDesktopUpdateCheck'));
      void checkForAppUpdates({ quiet: true, ignoreRemindLater: true });
    });
  } catch {
    updateCheckUnlisten = null;
  }
  onboardingPort.value = port.value;
  if (!localStorage.getItem(desktopOnboardingKey)) onboardingOpen.value = true;
  connectedDevicesTimer = window.setInterval(refreshConnectedDevices, 5000);
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
  if (!window.confirm(t('ui.factoryResetDesktopConfirm'))) return;
  loading.value = true;
  try {
    const currentRecipes = await commands.listRecipes();
    for (const recipe of currentRecipes) await commands.deleteRecipe(recipe.recipe.id);
    const currentActivities = await commands.listActivities();
    for (const activity of currentActivities) await commands.deleteActivity(activity.id);
    const currentIngredients = await commands.listIngredients();
    for (const ingredient of currentIngredients) await commands.deleteIngredient(ingredient.id);
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
      check_prerelease_updates: false,
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
  if (connectedDevicesTimer) window.clearInterval(connectedDevicesTimer);
  if (updateCheckUnlisten) {
    updateCheckUnlisten();
    updateCheckUnlisten = null;
  }
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
        <div class="desktop-header-statuses">
          <div class="server-pill" :class="serverRunning ? 'server-pill-running' : 'server-pill-stopped'">
            <span class="server-dot" />
            <span class="font-semibold">{{ t('ui.status_24a23') }}</span>
            <span>{{ serverRunning ? t('ui.apiRunning') : t('ui.apiStopped') }}</span>
            <span v-if="serverRunning" class="server-device-count">{{ connectedDeviceCount }} {{ t(connectedDeviceCount === 1 ? 'ui.deviceSingular' : 'ui.devicePlural') }}</span>
          </div>
          <button v-if="updateAvailable" class="desktop-update-chip" type="button" @click="openUpdateCenter"><span></span>{{ t('ui.updateAvailable') }} {{ updateCheckResult?.release?.version }}</button>
        </div>
      </div>
    </header>

    <div class="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8">
      <aside class="card h-fit">
        <nav class="desktop-nav">
          <button v-for="item in navigation" :key="item.key" class="nav-button" :class="tab === item.key ? 'nav-button-active' : ''" @click="tab = item.key">
            <span class="nav-icon" v-html="icon(item.icon, tab === item.key)"></span>
            <span>{{ t(`nav.${item.key}`) }}</span>
          </button>
        </nav>
      </aside>

      <section class="min-w-0 space-y-6">
        <p v-if="message" class="message-card">{{ message }}</p>

        <div v-if="tab === 'dashboard'" class="space-y-5">
          <article class="desktop-home-card">
            <div class="desktop-home-copy">
              <p class="desktop-kicker">{{ t('ui.nutrinoDesktopServer_a80f2') }}</p>
              <h2>{{ serverRunning ? t('ui.lanApiRunningTitle') : t('ui.lanApiStoppedTitle') }}</h2>
              <p>{{ serverRunning ? t('ui.mobileCanSyncCatalog') : t('ui.startServerToPairRefresh') }}</p>
              <code>{{ apiDisplay }}</code>
              <div v-if="serverRunning" class="connected-device-inline"><span>{{ connectedDeviceCount }} {{ t(connectedDeviceCount === 1 ? 'ui.connectedDeviceSingular' : 'ui.connectedDevicePlural') }}</span><span v-if="connectedDevices[0]">{{ t('ui.latestDevice') }}: {{ connectedDevices[0].display_name }}</span></div>
            </div>
            <div class="desktop-mobile-gauge" :class="serverRunning ? 'online' : 'offline'">
              <svg viewBox="0 0 220 180" aria-hidden="true">
                <path class="gauge-track" d="M36 128a76 76 0 1 1 148 0" />
                <path class="gauge-value" d="M36 128a76 76 0 1 1 148 0" />
              </svg>
              <div class="desktop-gauge-center"><b>{{ serverRunning ? t('ui.online') : t('ui.offline') }}</b><small>{{ t('ui.lanApi_0ee00') }}</small></div>
              <span class="port-chip">{{ t('ui.portLabel') }} {{ port }}</span>
            </div>
          </article>
          <div class="dashboard-metrics">
            <article class="metric-card metric-card-rich">
              <div class="metric-card-title"><span class="inline-svg" v-html="icon('ingredients')"></span><p>{{ t('ui.ingredients_210c9') }}</p></div>
              <strong>{{ totalIngredients }}</strong>
              <div class="metric-card-meta"><span>{{ t('ui.avg100g_5f553') }} <b>{{ formatMetricKcal(avgIngredientKcal) }}</b></span><span>{{ t('ui.updated_ff0a3') }} <b>{{ formatFreshness(latestIngredientUpdatedAt) }}</b></span></div>
            </article>
            <article class="metric-card metric-card-rich">
              <div class="metric-card-title"><span class="inline-svg" v-html="icon('foods')"></span><p>{{ t('ui.foods_9428a') }}</p></div>
              <strong>{{ totalPreparedFoods }}</strong>
              <div class="metric-card-meta"><span>{{ t('ui.avg100g_5f553') }} <b>{{ formatMetricKcal(avgFoodKcal) }}</b></span><span>{{ t('ui.updated_ff0a3') }} <b>{{ formatFreshness(latestFoodUpdatedAt) }}</b></span></div>
            </article>
            <article class="metric-card metric-card-rich">
              <div class="metric-card-title"><span class="inline-svg" v-html="icon('recipes')"></span><p>{{ t('ui.recipes_0153a') }}</p></div>
              <strong>{{ totalRecipes }}</strong>
              <div class="metric-card-meta"><span>{{ t('ui.avg100g_5f553') }} <b>{{ formatMetricKcal(avgRecipeKcal) }}</b></span><span>{{ t('ui.updated_ff0a3') }} <b>{{ formatFreshness(latestRecipeUpdatedAt) }}</b></span></div>
            </article>
            <article class="metric-card metric-card-rich">
              <div class="metric-card-title"><span class="inline-svg" v-html="icon('activities')"></span><p>{{ t('ui.activities_d78ed') }}</p></div>
              <strong>{{ totalActivities }}</strong>
              <div class="metric-card-meta"><span>{{ t('ui.avg100g_5f553') }} <b>—</b></span><span>{{ t('ui.updated_ff0a3') }} <b>{{ formatFreshness(latestActivityUpdatedAt) }}</b></span></div>
            </article>
          </div>
          <article class="card">
            <h2 class="text-xl font-bold">{{ t('ui.offlineFirstLocalArchitecture_127b5') }}</h2>
            <p class="mt-3 text-neutral-600">{{ t('ui.thisDesktopAppOwnsTheIngredient_dbe12') }}</p>
          </article>
        </div>


        <div v-if="tab === 'ingredients'" class="space-y-4">
          <div class="section-toolbar">
            <div>
              <h2 class="section-title">{{ t('ui.ingredients_210c9') }}</h2>
              <p class="section-subtitle">{{ t('ui.genericRawBaseItemsWithoutBrand_92a0f') }}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button class="btn-secondary icon-button" @click="refreshAll"><span class="inline-svg" v-html="icon('refresh')"></span>{{ t('ui.refresh_63a6a') }}</button>
              <label class="btn-secondary icon-button file-action"><span class="inline-svg" v-html="icon('import')"></span>{{ t('ui.importCsv_28ec2') }}<input type="file" accept=".csv,text/csv" @change="importIngredientsFromFile" /></label><label class="csv-skip-toggle"><input v-model="skipCsvDuplicates" type="checkbox" /> {{ t('ui.skipDuplicates_6d417') }}</label>
              <button class="btn-secondary icon-button" @click="exportIngredients"><span class="inline-svg" v-html="icon('export')"></span>{{ t('ui.exportCsv_c04f1') }}</button>
              <button class="btn-primary icon-button" @click="openIngredientModal()"><span class="inline-svg" v-html="icon('add')"></span>{{ t('ui.addIngredient_590a4') }}</button>
            </div>
          </div>
          <article class="card catalog-controls">
            <input v-model="ingredientQuery" class="input" :placeholder="t('ui.searchIngredientsByNameNoteOr_23ce9')" />
            <select v-model="ingredientSort" class="input"><option value="name">{{ t('ui.sortByName_deb7e') }}</option><option value="kcal">{{ t('ui.sortByKcal_a0e33') }}</option><option value="protein">{{ t('ui.sortByProtein_30969') }}</option><option value="carbs">{{ t('ui.sortByCarbs_8895f') }}</option><option value="fat">{{ t('ui.sortByFat_e8cb8') }}</option></select>
          </article>
          <article class="card csv-format-card">
            <div>
              <h3 class="text-lg font-bold">{{ t('ui.ingredientCsvStructure_bbae0') }}</h3>
              <p class="muted">{{ t('ui.ingredientsAreNonBrandedBaseMaterials_d41e1') }}</p>
            </div>
            <code class="csv-header-code">{{ ingredientCsvHeader }}</code>
            <ul class="csv-note-list"><li v-for="note in csvImportNotes.slice(0, 3)" :key="note">{{ t(note) }}</li></ul>
          </article>
          <article class="card min-w-0">
            <div class="overflow-auto table-wrap">
              <table class="min-w-[780px] w-full border-collapse">
                <thead>
                  <tr><th>{{ t('ui.name_49ee3') }}</th><th>{{ t('ui.id_b718a') }}</th><th>kcal</th><th>{{ t('ui.carbs_ee64f') }}</th><th>{{ t('ui.fat_4d09c') }}</th><th>{{ t('ui.protein_7e667') }}</th><th>{{ t('ui.actions_06df3') }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="ingredient in sortedIngredients" :key="ingredient.id">
                    <td><strong>{{ localizedName(ingredient) }}</strong><br /><span class="muted">{{ t('ui.ingredientNoBrandBarcode_b87ef') }}</span><small v-if="ingredient.note" class="block muted">{{ ingredient.note }}</small></td>
                    <td class="font-mono text-xs">{{ ingredient.id }}</td>
                    <td>{{ round(ingredient.kcal_per_100g) }}</td>
                    <td>{{ round(ingredient.carbs_per_100g) }}g</td>
                    <td>{{ round(ingredient.fat_per_100g) }}g</td>
                    <td>{{ round(ingredient.protein_per_100g) }}g</td>
                    <td>
                      <button class="link-button icon-only-label" @click="openIngredientModal(ingredient)"><span class="inline-svg" v-html="icon('edit')"></span>{{ t('ui.edit_7dce1') }}</button>
                      <button class="link-button icon-only-label" @click="mergeCatalogInto('ingredient', ingredient.id, localizedName(ingredient))"><span class="inline-svg" v-html="icon('refresh')"></span>{{ t('ui.mergeInto_f7c29') }}</button>
                      <button class="link-button icon-only-label" @click="moveIngredientToFood(ingredient)">{{ t('ui.moveToFoods_e1a6b') }}</button>
                      <button class="link-button icon-only-label" @click="showCatalogQr('ingredient', ingredient, localizedName(ingredient))"><span class="inline-svg" v-html="icon('qrCode')"></span>QR</button>
                      <button class="link-button danger icon-only-label" @click="removeIngredient(ingredient)"><span class="inline-svg" v-html="icon('trash')"></span>{{ t('ui.delete_f2a6c') }}</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <div v-if="tab === 'foods'" class="space-y-4">
          <div class="section-toolbar">
            <div>
              <h2 class="section-title">{{ t('ui.foods_9428a') }}</h2>
              <p class="section-subtitle">{{ t('ui.createEditDeleteImportAndExport_14d0a') }}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button class="btn-secondary icon-button" @click="refreshAll"><span class="inline-svg" v-html="icon('refresh')"></span>{{ t('ui.refresh_63a6a') }}</button>
              <label class="btn-secondary icon-button file-action"><span class="inline-svg" v-html="icon('import')"></span>{{ t('ui.importCsv_28ec2') }}<input type="file" accept=".csv,text/csv" @change="importFoodsFromFile" /></label><label class="csv-skip-toggle"><input v-model="skipCsvDuplicates" type="checkbox" /> {{ t('ui.skipDuplicates_6d417') }}</label>
              <button class="btn-secondary icon-button" @click="exportFoods"><span class="inline-svg" v-html="icon('export')"></span>{{ t('ui.exportCsv_c04f1') }}</button>
              <button class="btn-primary icon-button" @click="openFoodModal()"><span class="inline-svg" v-html="icon('add')"></span>{{ t('ui.addFood_2e2e1') }}</button>
            </div>
          </div>
          <article class="card catalog-controls">
            <input v-model="foodQuery" class="input" :placeholder="t('ui.searchFoodsByNameBrandBarcode_d7567')" />
            <select v-model="foodSort" class="input"><option value="name">{{ t('ui.sortByName_deb7e') }}</option><option value="kcal">{{ t('ui.sortByKcal_a0e33') }}</option><option value="protein">{{ t('ui.sortByProtein_30969') }}</option><option value="carbs">{{ t('ui.sortByCarbs_8895f') }}</option><option value="fat">{{ t('ui.sortByFat_e8cb8') }}</option></select>
          </article>
          <article class="card csv-format-card">
            <div>
              <h3 class="text-lg font-bold">{{ t('ui.foodCsvStructure_f4bb5') }}</h3>
              <p class="muted">{{ t('ui.importFilesMustUseThisHeader_fb913') }}</p>
            </div>
            <code class="csv-header-code">{{ foodCsvHeader }}</code>
            <ul class="csv-note-list"><li v-for="note in csvImportNotes.slice(0, 3)" :key="note">{{ t(note) }}</li></ul>
          </article>
          <article class="card min-w-0">
            <div class="overflow-auto table-wrap">
              <table class="min-w-[820px] w-full border-collapse">
                <thead>
                  <tr><th>{{ t('ui.name_49ee3') }}</th><th>{{ t('ui.id_b718a') }}</th><th>kcal</th><th>{{ t('ui.carbs_ee64f') }}</th><th>{{ t('ui.fat_4d09c') }}</th><th>{{ t('ui.protein_7e667') }}</th><th>{{ t('ui.actions_06df3') }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="food in sortedFoods" :key="food.id">
                    <td><strong>{{ localizedName(food) }}</strong><br /><span class="muted">{{ t('ui.food_0a38e') }} · {{ food.brand || t('ui.noBrand') }}</span><small v-if="food.note" class="block muted">{{ food.note }}</small></td>
                    <td class="font-mono text-xs">{{ food.id }}</td>
                    <td>{{ round(food.kcal_per_100g) }}</td>
                    <td>{{ round(food.carbs_per_100g) }}g</td>
                    <td>{{ round(food.fat_per_100g) }}g</td>
                    <td>{{ round(food.protein_per_100g) }}g</td>
                    <td>
                      <button class="link-button icon-only-label" @click="openFoodModal(food)"><span class="inline-svg" v-html="icon('edit')"></span>{{ t('ui.edit_7dce1') }}</button>
                      <button class="link-button icon-only-label" @click="mergeCatalogInto('food', food.id, localizedName(food))"><span class="inline-svg" v-html="icon('refresh')"></span>{{ t('ui.mergeInto_f7c29') }}</button><button class="link-button icon-only-label" @click="moveFoodToIngredient(food)">{{ t('ui.moveToIngredients_39253') }}</button><button class="link-button icon-only-label" @click="showCatalogQr('food', food, localizedName(food))"><span class="inline-svg" v-html="icon('qrCode')"></span>QR</button>
                      <button class="link-button danger icon-only-label" @click="removeFood(food)"><span class="inline-svg" v-html="icon('trash')"></span>{{ t('ui.delete_f2a6c') }}</button>
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
              <h2 class="section-title">{{ t('ui.recipes_0153a') }}</h2>
              <p class="section-subtitle">{{ t('ui.buildReusableMealsFromFoodsNutrition_d435d') }}</p>
            </div>
            <div class="flex flex-wrap gap-2"><label class="btn-secondary icon-button file-action"><span class="inline-svg" v-html="icon('import')"></span>{{ t('ui.importCsv_28ec2') }}<input type="file" accept=".csv,text/csv" @change="importRecipesFromFile" /></label><label class="csv-skip-toggle"><input v-model="skipCsvDuplicates" type="checkbox" /> {{ t('ui.skipDuplicates_6d417') }}</label><button class="btn-secondary icon-button" @click="exportRecipes"><span class="inline-svg" v-html="icon('export')"></span>{{ t('ui.exportCsv_c04f1') }}</button><button class="btn-primary icon-button" @click="openRecipeModal()"><span class="inline-svg" v-html="icon('add')"></span>{{ t('ui.addRecipe_39767') }}</button></div>
          </div>
          <article class="card catalog-controls">
            <input v-model="recipeQuery" class="input" :placeholder="t('ui.searchRecipesByNameDescriptionNote_0dd65')" />
            <select v-model="recipeSort" class="input"><option value="name">{{ t('ui.sortByName_deb7e') }}</option><option value="kcal">{{ t('ui.sortByKcal_a0e33') }}</option><option value="protein">{{ t('ui.sortByProtein_30969') }}</option><option value="carbs">{{ t('ui.sortByCarbs_8895f') }}</option><option value="fat">{{ t('ui.sortByFat_e8cb8') }}</option></select>
          </article>
          <article class="card csv-format-card">
            <div>
              <h3 class="text-lg font-bold">{{ t('ui.recipeCsvStructure_a4db3') }}</h3>
              <p class="muted">{{ t('ui.recipesAreImportedFromAHeader_3c31f') }}</p>
            </div>
            <code class="csv-header-code">{{ recipeCsvHeader }}</code>
            <ul class="csv-note-list"><li v-for="note in csvImportNotes" :key="note">{{ t(note) }}</li></ul>
          </article>
          <div class="grid gap-4 xl:grid-cols-2">
            <article v-for="recipe in sortedRecipes" :key="recipe.recipe.id" class="card">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 class="text-lg font-bold">{{ localizedName(recipe.recipe) }}</h3>
                  <p class="muted">{{ recipe.recipe.description || 'No description' }}</p><small v-if="recipe.recipe.note" class="block muted">{{ recipe.recipe.note }}</small>
                </div>
                <div class="flex gap-2">
                  <button class="link-button icon-only-label" @click="openRecipeModal(recipe)"><span class="inline-svg" v-html="icon('edit')"></span>{{ t('ui.edit_7dce1') }}</button>
                  <button class="link-button icon-only-label" @click="mergeCatalogInto('recipe', recipe.recipe.id, recipe.recipe.name)"><span class="inline-svg" v-html="icon('refresh')"></span>{{ t('ui.mergeInto_f7c29') }}</button><button class="link-button icon-only-label" @click="showCatalogQr('recipe', recipe, recipe.recipe.name)"><span class="inline-svg" v-html="icon('qrCode')"></span>QR</button>
                  <button class="link-button danger icon-only-label" @click="removeRecipe(recipe)"><span class="inline-svg" v-html="icon('trash')"></span>{{ t('ui.delete_f2a6c') }}</button>
                </div>
              </div>
              <div class="mt-4 grid grid-cols-2 gap-2 text-center text-sm md:grid-cols-4">
                <div class="mini-stat"><strong>{{ round(recipeDynamicNutrition(recipe).kcalTotal) }}</strong><span>{{ t('ui.kcalTotal_0c895') }}</span></div>
                <div class="mini-stat"><strong>{{ round(recipeDynamicNutrition(recipe).carbsTotal) }}g</strong><span>{{ t('ui.carbsTotal_d2ae4') }}</span></div>
                <div class="mini-stat"><strong>{{ round(recipeDynamicNutrition(recipe).fatTotal) }}g</strong><span>{{ t('ui.fatTotal_41615') }}</span></div>
                <div class="mini-stat"><strong>{{ round(recipeDynamicNutrition(recipe).proteinTotal) }}g</strong><span>{{ t('ui.proteinTotal_67f44') }}</span></div>
              </div>
              <div class="mt-2 grid grid-cols-2 gap-2 text-center text-xs md:grid-cols-4">
                <div class="mini-stat subtle"><strong>{{ round(recipeDynamicNutrition(recipe).kcalPer100g) }}</strong><span>{{ t('ui.kcal100g_40bdf') }}</span></div>
                <div class="mini-stat subtle"><strong>{{ round(recipeDynamicNutrition(recipe).totalWeight) }}g</strong><span>{{ t('ui.weight_7edab') }}</span></div>
                <div class="mini-stat subtle"><strong>{{ round(recipeDynamicNutrition(recipe).extraKcal) }}</strong><span>{{ t('ui.extraKcal_65a05') }}</span></div>
                <div class="mini-stat subtle"><strong>{{ formatOptionalGrams(recipeDynamicNutrition(recipe).servingWeight) }}</strong><span>{{ t('ui.1Db_42565') }}</span></div>
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
              <h2 class="section-title">{{ t('ui.activities_d78ed') }}</h2>
              <p class="section-subtitle">{{ t('ui.opennutritrackerActivityCatalogWithEditableMet_58263') }}</p>
            </div>
            <div class="flex flex-wrap gap-2"><label class="btn-secondary icon-button file-action"><span class="inline-svg" v-html="icon('import')"></span>{{ t('ui.importCsv_28ec2') }}<input type="file" accept=".csv,text/csv" @change="importActivitiesFromFile" /></label><label class="csv-skip-toggle"><input v-model="skipCsvDuplicates" type="checkbox" /> {{ t('ui.skipDuplicates_6d417') }}</label><button class="btn-secondary icon-button" @click="exportActivities"><span class="inline-svg" v-html="icon('export')"></span>{{ t('ui.exportCsv_c04f1') }}</button><button class="btn-primary icon-button" @click="openActivityModal()"><span class="inline-svg" v-html="icon('add')"></span>{{ t('ui.addActivity_a263a') }}</button></div>
          </div>
          <article class="card">
            <input v-model="activityQuery" class="input" :placeholder="t('ui.searchActivityTypeCode_9bb39')" />
          </article>
          <article class="card csv-format-card">
            <div>
              <h3 class="text-lg font-bold">{{ t('ui.activityCsvStructure_c2cbe') }}</h3>
              <p class="muted">{{ t('ui.useThisHeaderRowForActivity_4eb62') }}</p>
            </div>
            <code class="csv-header-code">{{ activityCsvHeader }}</code>
            <ul class="csv-note-list"><li v-for="note in csvImportNotes.slice(0, 3)" :key="note">{{ t(note) }}</li></ul>
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
                    <h4 class="font-bold">{{ localizedName(activity) }}</h4>
                    <p class="muted text-sm">{{ activity.description || 'No description' }}</p>
                    <p class="mt-2 text-xs font-bold uppercase tracking-wide text-nutri-700">{{ t('ui.code_ca0db') }} {{ activity.code }} · MET {{ round(activity.met) }} · {{ round(activity.kcal_per_min) }} kcal/min</p>
                  </div>
                </div>
                <div class="activity-card-actions">
                  <button class="link-button icon-only-label" @click="openActivityModal(activity)"><span class="inline-svg" v-html="icon('edit')"></span>{{ t('ui.edit_7dce1') }}</button>
                  <button class="link-button icon-only-label" @click="mergeCatalogInto('activity', activity.id, localizedName(activity))"><span class="inline-svg" v-html="icon('refresh')"></span>{{ t('ui.mergeInto_f7c29') }}</button><button class="link-button icon-only-label" @click="showCatalogQr('activity', activity, localizedName(activity))"><span class="inline-svg" v-html="icon('qrCode')"></span>QR</button>
                  <button class="link-button danger icon-only-label" @click="removeActivity(activity)"><span class="inline-svg" v-html="icon('trash')"></span>{{ t('ui.delete_f2a6c') }}</button>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div v-if="tab === 'server'" class="grid gap-6 xl:grid-cols-2">
          <article class="card">
            <h2 class="text-xl font-bold">{{ t('ui.lanApiServer_2738b') }}</h2>
            <p class="mt-2 muted">{{ t('ui.setAnOptionalServerPasswordIf_5e0e9') }}</p>
            <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end">
              <div><label class="field-label">{{ t('ui.port_60aaf') }}</label><input v-model.number="port" class="input mt-1" type="number" min="1024" /></div>
              <div><label class="field-label">{{ t('ui.serverPassword_7dfb3') }}</label><input v-model="serverPassword" class="input mt-1" type="password" autocomplete="new-password" :placeholder="t('ui.leaveEmptyForNoPassword_c6e10')" /></div>
              <button class="btn-primary" :disabled="loading || serverRunning" @click="startServer">{{ t('ui.start_a6122') }}</button>
              <button class="btn-secondary" :disabled="loading || !serverRunning" @click="stopServer">{{ t('ui.stop_11a75') }}</button>
              <button class="btn-secondary" :disabled="loading" @click="saveServerPassword">{{ t('ui.savePassword_49284') }}</button>
              <button class="btn-secondary" :disabled="loading || serverRunning" @click="importAppDataZip">{{ t('ui.restoreBackup_dd06b') }}</button>
            </div>
          </article>
          <article class="card min-w-0">
            <h2 class="text-xl font-bold">{{ t('ui.pairingDetails_d8479') }}</h2>
            <dl class="mt-4 space-y-3 text-sm">
              <div><dt class="field-label">{{ t('ui.baseUrl_ade86') }}</dt><dd class="break-api-url font-mono font-bold">{{ apiDisplay }}</dd></div>
              <div><dt class="field-label">{{ t('ui.sourceId_33735') }}</dt><dd class="break-api-url font-mono">{{ status?.source_id }}</dd></div>
              <div><dt class="field-label">{{ t('ui.auth_632c9') }}</dt><dd>{{ status?.auth_required ? 'Password required' : 'No password required' }}</dd></div>
              <div><dt class="field-label">{{ t('ui.channel_781dc') }}</dt><dd>{{ status?.app_channel ?? appChannel }}</dd></div>
            </dl>
          </article>
          <article class="card min-w-0 xl:col-span-2 connected-devices-card">
            <div class="connected-devices-head">
              <div>
                <h2 class="text-xl font-bold">{{ t('ui.connectedDevices_1aee3') }}</h2>
                <p class="mt-2 muted">{{ t('ui.devicesSeenByTheLanApi_7cc05') }}</p>
              </div>
              <button class="btn-secondary" :disabled="loading" @click="refreshConnectedDevices">{{ t('ui.refresh_63a6a') }}</button>
            </div>
            <div v-if="!serverRunning" class="empty-state mt-4">{{ t('ui.startTheLanApiServerTo_231bf') }}</div>
            <div v-else-if="!connectedDevices.length" class="empty-state mt-4">{{ t('ui.noMobileDeviceHasContactedThe_a557c') }}</div>
            <div v-else class="connected-device-list mt-4">
              <article v-for="device in connectedDevices" :key="device.id" class="connected-device-row">
                <div class="connected-device-avatar"><span class="inline-svg" v-html="icon('server')"></span></div>
                <div class="connected-device-main">
                  <h3>{{ device.display_name }} <span class="connected-device-app-pill">{{ connectedDeviceAppLabel(device) }}</span></h3>
                  <p>{{ connectedDeviceSubtitle(device) }}</p>
                  <small>{{ t('ui.lastSeen') }} {{ formatDeviceSeenAt(device.last_seen) }} · {{ device.last_path }} · {{ device.request_count }} {{ t(device.request_count === 1 ? 'ui.requestSingular' : 'ui.requestPlural') }}</small>
                </div>
              </article>
            </div>
          </article>
        </div>


        <section v-if="tab === 'server'" class="card mt-6 duplicate-suggestions-panel">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-xl font-bold">{{ t('ui.mergeSuggestions_3f578') }}</h2>
              <p class="mt-2 muted">{{ t('ui.nutrinoCanListLikelyDuplicateFoods_06da2') }}</p>
            </div>
            <button class="btn-secondary" :disabled="loading" @click="refreshAll">{{ t('ui.refresh_63a6a') }}</button><button class="btn-primary" :disabled="loading || !duplicateSuggestions.length" @click="mergeAllDuplicateSuggestions">{{ t('ui.mergeAllSelected_07c3e') }}</button>
          </div>
          <div v-if="!duplicateSuggestions.length" class="empty-state mt-4">{{ t('ui.noLikelyDuplicateCatalogItemsFound_e496c') }}</div>
          <div v-else class="duplicate-suggestion-grid mt-4">
            <article v-for="suggestion in duplicateSuggestions" :key="duplicateSuggestionKey(suggestion)" class="duplicate-suggestion-card">
              <div class="duplicate-suggestion-head">
                <div>
                  <p class="desktop-kicker">{{ suggestion.kind }} · {{ suggestion.confidence }} confidence · {{ suggestion.score }}%</p>
                  <h3>{{ suggestion.reason }}</h3>
                </div>
                <button class="btn-primary" :disabled="loading" @click="mergeDuplicateSuggestion(suggestion)">{{ t('ui.mergeSelected_1f978') }}</button>
              </div>
              <div class="duplicate-item-list">
                <label v-for="item in suggestion.items" :key="item.id" class="duplicate-item-row" :class="duplicateCanonicalId(suggestion) === item.id ? 'duplicate-item-kept' : ''">
                  <input type="radio" :name="duplicateSuggestionKey(suggestion)" :checked="duplicateCanonicalId(suggestion) === item.id" @change="setDuplicateCanonical(suggestion, item.id)" />
                  <span class="duplicate-item-copy">
                    <b>{{ item.name }}</b>
                    <small>{{ item.subtitle }}</small>
                    <code>{{ item.id }}</code>
                  </span>
                  <button type="button" class="link-button" @click.prevent="editDuplicateItem(suggestion.kind, item.id)">{{ t('ui.edit_7dce1') }}</button>
                </label>
              </div>
            </article>
          </div>
        </section>

        <section v-if="tab === 'server'" class="card mt-6">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-xl font-bold">{{ t('ui.mobileUploadInbox_3476a') }}</h2>
              <p class="mt-2 muted">{{ t('ui.uploadsSentFromMobileAreStaged_beb6b') }}</p>
            </div>
            <button class="btn-secondary" :disabled="loading" @click="refreshAll">{{ t('ui.refresh_63a6a') }}</button>
          </div>
          <label class="inbox-filter-toggle mt-4">
            <input v-model="hideUnchangedInboxItems" type="checkbox" />
            <span><b>{{ t('ui.hideItemsAlreadyOnDesktop_6efec') }}</b><small>{{ t('ui.defaultViewShowsOnlyNewChanged_1b926') }}</small></span>
          </label>
          <div v-if="!syncInbox.length" class="empty-state mt-4">{{ t('ui.noPendingMobileUploads_7e5ca') }}</div>
          <div v-else class="mt-4 grid gap-3">
            <article v-for="entry in syncInbox" :key="entry.id" class="sync-inbox-card">
              <div class="sync-inbox-head">
                <div>
                  <b>{{ entry.device_name || entry.source_id }}</b>
                  <small>{{ formatDateTime(entry.received_at) }} · {{ syncInboxSummary(entry) }}</small>
                </div>
                <div class="flex gap-2">
                  <button class="btn-secondary" :disabled="loading" @click="openInboxReview(entry)">{{ t('ui.reviewEdit_77e3a') }}</button>
                  <button class="btn-primary" :disabled="loading" @click="acceptInboxEntry(entry)">{{ t('ui.recordDraft_685b4') }}</button>
                  <button class="btn-secondary" :disabled="loading" @click="rejectInboxEntry(entry)">{{ t('ui.reject_d98ac') }}</button>
                </div>
              </div>
              <div class="sync-payload-preview inbox-status-preview">
                <span class="status-new">{{ inboxStatusCounts(entry).new }} {{ t('ui.statusNewLower') }}</span>
                <span class="status-modified">{{ inboxStatusCounts(entry).modified }} {{ t('ui.statusModifiedLower') }}</span>
                <span class="status-unchanged">{{ inboxStatusCounts(entry).unchanged }} {{ t('ui.statusUnchangedLower') }}</span>
                <span v-if="inboxStatusCounts(entry).skipped" class="status-skipped">{{ inboxStatusCounts(entry).skipped }} {{ t('ui.statusSkippedLower') }}</span>
              </div>
              <div v-if="!visibleInboxReviewItems(entry).length" class="empty-state compact-empty mt-3">{{ t('ui.allUnchangedDesktopItemsAreHidden_df79b') }}</div>
              <div v-else class="inbox-review-list mt-3">
                <article v-for="item in visibleInboxReviewItems(entry)" :key="item.key" class="inbox-review-row" :class="inboxItemClass(item)">
                  <div class="inbox-review-main">
                    <span class="inbox-status-pill" :class="`status-${item.status}`">{{ inboxStatusLabel(item.status) }}</span>
                    <div>
                      <b>{{ item.label }}</b>
                      <small>{{ item.kind }} · {{ item.subtitle }}</small>
                      <small>{{ inboxStatusHint(item) }}</small>
                      <code>{{ item.id }}</code>
                    </div>
                  </div>
                  <div class="inbox-review-actions">
                    <button class="btn-secondary" :disabled="loading || item.status === 'skipped'" @click="openInboxReview(entry)">{{ t('ui.edit_7dce1') }}</button>
                    <button v-if="item.status !== 'skipped'" class="btn-secondary" :disabled="loading" @click="skipInboxReviewItem(entry, item)">{{ t('ui.skip_72ef2') }}</button>
                    <button v-else class="btn-primary" :disabled="loading" @click="restoreInboxSkippedItem(entry, item)">{{ t('ui.restore_2bd33') }}</button>
                  </div>
                </article>
              </div>
              <div v-if="entry.merge_candidates.length" class="merge-candidate-list">
                <p class="field-label">{{ t('ui.exactDuplicateMergeSuggestions_d8d31') }}</p>
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
              <p class="desktop-kicker">{{ t('ui.desktopServer_ee8af') }}</p>
              <h2 class="section-title">{{ t('ui.settings_f4f70') }}</h2>
              <p class="section-subtitle">{{ t('ui.runtimeTrayStartupBackupsPrivacyAnd_fbc8f') }}</p>
            </div>
          </div>

          <div v-if="settings" class="settings-layout-v040">
            <section v-for="group in settingGroups" :key="group.titleKey" class="settings-section-card">
              <div class="settings-section-head">
                <div>
                  <p class="desktop-kicker">{{ t(group.titleKey) }}</p>
                  <h3>{{ t(group.subtitleKey) }}</h3>
                </div>
              </div>
              <article class="mobile-settings-list settings-group-list">
                <button v-for="row in group.rows" :key="row.key" class="mobile-setting-row settings-row-v040" @click="toggleSetting(row.key)">
                  <span class="mobile-setting-icon" v-html="icon(row.icon)"></span>
                  <span class="mobile-setting-copy"><b>{{ t(row.titleKey) }}</b><small>{{ t(row.bodyKey) }}</small></span>
                  <span class="toggle compact" :class="{ enabled: settings[row.key] }"></span>
                </button>
              </article>
            </section>

            <section class="settings-section-card">
              <div class="settings-section-head">
                <div>
                  <p class="desktop-kicker">i18n</p>
                  <h3>{{ t('language') }}</h3>
                </div>
              </div>
              <div class="language-picker-panel">
                <input v-model="languageSearch" class="input" type="search" :placeholder="t('languageSearch')" />
                <div class="language-option-grid">
                  <button v-for="language in filteredLanguageOptions" :key="language.code" type="button" class="language-option-button" :class="desktopLanguage === language.code ? 'active' : ''" @click="setDesktopLanguage(language.code)">
                    <b>{{ language.englishName }}</b>
                    <small>{{ language.nativeName }} · {{ language.code }}</small>
                  </button>
                </div>
              </div>
            </section>

            <section class="settings-section-card update-settings-section">
              <div class="settings-section-head">
                <div>
                  <p class="desktop-kicker">{{ t('ui.appUpdates') }}</p>
                  <h3>{{ t('ui.appUpdatesBody') }}</h3>
                </div>
              </div>
              <article class="desktop-update-settings-panel">
                <div class="desktop-update-status-card" :class="{ attention: updateAvailable, latest: updateCheckResult?.status === 'latest' }">
                  <span class="desktop-update-status-orb"></span>
                  <div>
                    <b>{{ updateAvailable ? updateReleaseTitle(updateCheckResult) : updateCheckResult?.status === 'latest' ? t('ui.latestInstalled') : t('ui.appUpdates') }}</b>
                    <small>{{ updateAvailable ? updateReleaseBody(updateCheckResult) : `${t('ui.versionLabel')} ${appVersion}` }}</small>
                    <small v-if="updateReleaseAssetLabel()">{{ updateReleaseAssetLabel() }}</small>
                  </div>
                </div>
                <label class="mobile-setting-row settings-row-v040">
                  <span class="mobile-setting-icon" v-html="icon('refresh')"></span>
                  <span class="mobile-setting-copy"><b>{{ t('ui.includePrereleaseUpdates') }}</b><small>{{ t('ui.includePrereleaseUpdatesHint') }}</small></span>
                  <span class="toggle compact" :class="{ enabled: settings.check_prerelease_updates }"></span>
                  <input v-model="settings.check_prerelease_updates" class="sr-only" type="checkbox" @change="saveDesktopSettingsNow" />
                </label>
                <div class="desktop-update-actions">
                  <button class="btn-secondary" type="button" :disabled="updateBusy" @click="checkForAppUpdates({ manual: true, ignoreRemindLater: true })">{{ updateBusy ? t('ui.checkingUpdates') : t('ui.checkUpdates') }}</button>
                  <button v-if="updateAvailable" class="btn-primary" type="button" :disabled="updateBusy" @click="installAvailableUpdate">{{ updateBusy ? t('ui.checkingUpdates') : t('ui.installUpdate') }}</button>
                </div>
              </article>
            </section>

            <section class="settings-section-card">
              <div class="settings-section-head">
                <div>
                  <p class="desktop-kicker">{{ t('ui.dataAndRecovery_677d1') }}</p>
                  <h3>{{ t('ui.backupsRestoreAndReset_6433e') }}</h3>
                </div>
              </div>
              <article class="mobile-settings-list settings-group-list">
                <button class="mobile-setting-row settings-row-v040" @click="rememberWindowNow">
                  <span class="mobile-setting-icon" v-html="icon('settings')"></span>
                  <span class="mobile-setting-copy"><b>{{ t('ui.saveCurrentWindow_1b2b6') }}</b><small>{{ t('ui.storeTheCurrentPositionAndSize_161c9') }}</small></span>
                  <span class="settings-row-chevron" v-html="icon('chevronRight')"></span>
                </button>
                <button class="mobile-setting-row settings-row-v040" :disabled="loading" @click="exportAppDataZip">
                  <span class="mobile-setting-icon" v-html="icon('export')"></span>
                  <span class="mobile-setting-copy"><b>{{ t('ui.exportDataZip_d39bb') }}</b><small>{{ t('ui.createADesktopCatalogAndSettings_5ec25') }}</small></span>
                  <span class="settings-row-chevron" v-html="icon('chevronRight')"></span>
                </button>
                <button class="mobile-setting-row settings-row-v040" :disabled="loading" @click="importAppDataZip">
                  <span class="mobile-setting-icon" v-html="icon('import')"></span>
                  <span class="mobile-setting-copy"><b>{{ t('ui.importDataZip_04e73') }}</b><small>{{ t('ui.restoreIngredientsFoodsRecipesActivitiesAnd_9d762') }}</small></span>
                  <span class="settings-row-chevron" v-html="icon('chevronRight')"></span>
                </button>
                <button class="mobile-setting-row settings-row-v040 danger-row-v040" :disabled="loading" @click="factoryResetDesktop">
                  <span class="mobile-setting-icon" v-html="icon('refresh')"></span>
                  <span class="mobile-setting-copy"><b>{{ t('ui.factoryReset_5dcd7') }}</b><small>{{ t('ui.deleteTheLocalDesktopCatalogAnd_3509d') }}</small></span>
                  <span class="settings-row-chevron" v-html="icon('chevronRight')"></span>
                </button>
              </article>
            </section>

            <section class="settings-section-card licenses-section-card">
              <div class="settings-section-head">
                <div>
                  <p class="desktop-kicker">{{ t('ui.licenses_f6aca') }}</p>
                  <h3>{{ t('ui.thirdPartyNoticesAndAcknowledgements_833ba') }}</h3>
                </div>
              </div>
              <article class="license-list">
                <a v-for="notice in thirdPartyNotices" :key="notice.name" class="license-card" :href="notice.url" target="_blank" rel="noreferrer">
                  <span class="mobile-setting-icon" v-html="icon('licenses')"></span>
                  <span class="mobile-setting-copy"><b>{{ notice.name }}</b><small>{{ t(notice.purposeKey) }}</small><small v-if="notice.noteKey">{{ t(notice.noteKey) }}</small></span>
                  <strong>{{ notice.license }}</strong>
                </a>
              </article>
              <ul class="acknowledgement-list"><li v-for="item in acknowledgements" :key="item">{{ t(item) }}</li></ul>
            </section>
          </div>

          <section class="desktop-info-grid settings-info-grid-v040">
            <article class="mobile-info-card privacy-card">
              <div class="mobile-info-icon" v-html="icon('shield')"></div>
              <div>
                <p class="desktop-kicker">{{ t('ui.privacy_c5f29') }}</p>
                <h3>{{ t('ui.localFirstByDesign_50f82') }}</h3>
                <p>{{ t('ui.nutrinoDesktopStoresYourIngredientFood_8ab07') }}</p>
              </div>
            </article>

            <article class="mobile-info-card about-card">
              <div class="mobile-info-icon logo-info-icon" v-html="nutrinoLogoSvg"></div>
              <div>
                <p class="desktop-kicker">{{ t('ui.about_8f7f4') }}</p>
                <h3>{{ appName }}</h3>
                <p>{{ t('ui.versionLabel') }} {{ appVersion }} · {{ appChannel }} · AGPL-3.0-only</p>
                <p>{{ t('ui.thanksToOpennutritrackerForThePrivacy_2e20e') }}</p>
                <div class="mobile-info-actions">
                  <a :href="repositoryUrl" target="_blank" rel="noreferrer"><span class="inline-svg" v-html="icon('recipes')"></span>{{ t('ui.repository_33fcf') }}</a>
                  <a :href="issueUrl" target="_blank" rel="noreferrer"><span class="inline-svg" v-html="icon('activities')"></span>{{ t('ui.reportIssue_92fd0') }}</a>
                  <a :href="starUrl" target="_blank" rel="noreferrer"><span class="inline-svg" v-html="icon('star')"></span>{{ t('ui.star_26f93') }}</a>
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
          <div class="modal-header"><div class="modal-brand-row"><span class="modal-logo" v-html="nutrinoLogoSvg"></span><div><p class="modal-kicker">nutrino</p><h2 class="text-2xl font-bold">{{ t('ui.desktopSetup_8dda1') }}</h2></div></div></div>
          <div v-if="onboardingStep === 0" class="grid gap-4">
            <p class="muted">{{ t('ui.setTheDefaultLanApiPort_c998b') }}</p>
            <div><label class="field-label">{{ t('ui.lanApiPort_509d9') }}</label><input v-model.number="onboardingPort" class="input mt-1" type="number" min="1024" /></div>
            <div><label class="field-label">{{ t('ui.serverPassword_7dfb3') }}</label><input v-model="onboardingPassword" class="input mt-1" type="password" autocomplete="new-password" :placeholder="t('ui.optionalLeaveEmptyForNoPassword_151bc')" /></div>
            <button class="btn-secondary" :disabled="loading" @click="importAppDataZip">{{ t('ui.restoreServerFromBackupZip_aafd4') }}</button>
            <ol class="desktop-tour-timeline" :aria-label="t('ui.desktopSetupSteps_ae24e')">
              <li class="desktop-tour-step"><span class="desktop-tour-index">1</span><div><b>{{ t('ui.importOrCreateIngredientsAndFoods_c86e5') }}</b><small>{{ t('ui.buildYourPrivateIngredientAndFood_d9651') }}</small></div></li>
              <li class="desktop-tour-step"><span class="desktop-tour-index">2</span><div><b>{{ t('ui.buildRecipes_f4672') }}</b><small>{{ t('ui.combineFoodsIntoReusableMeals_a2483') }}</small></div></li>
              <li class="desktop-tour-step"><span class="desktop-tour-index">3</span><div><b>{{ t('ui.editActivityCatalog_5a8f3') }}</b><small>{{ t('ui.reviewMetAndKcalMinValues_c297b') }}</small></div></li>
              <li class="desktop-tour-step"><span class="desktop-tour-index">4</span><div><b>{{ t('ui.startTheLanApi_61b1e') }}</b><small>{{ t('ui.pairMobileWhenYouAreReady_d3cb4') }}</small></div></li>
            </ol>
          </div>
          <div v-else class="grid gap-4">
            <p class="muted">{{ t('ui.mobilePullsIngredientsFoodsRecipesAnd_7d538') }}</p>
            <article class="mobile-info-card"><div class="mobile-info-icon" v-html="icon('shield')"></div><div><h3>{{ t('ui.localFirst_f0903') }}</h3><p>{{ t('ui.noPublicFoodDatabaseNoAccount_b4d78') }}</p></div></article>
          </div>
          <div class="dialog-actions"><button v-if="onboardingStep > 0" class="btn-secondary" @click="onboardingStep--">{{ t('ui.back_0557f') }}</button><button v-if="onboardingStep === 0" class="btn-primary" @click="onboardingStep++">{{ t('ui.next_10ac3') }}</button><button v-else class="btn-primary" @click="finishDesktopOnboarding">{{ t('ui.startUsingNutrino_b763a') }}</button></div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="updateDialogOpen && updateCheckResult?.release" class="modal-backdrop" @click.self="remindUpdateLater">
        <section class="modal-card update-modal">
          <div class="modal-title-row">
            <div><p class="modal-kicker">{{ t('ui.appUpdates') }}</p><h2>{{ updateReleaseTitle() }}</h2><p class="muted update-release-copy">{{ updateReleaseBody() }}<small v-if="updateReleaseAssetLabel()">{{ updateReleaseAssetLabel() }}</small></p></div>
          </div>
          <div class="dialog-actions">
            <button class="btn-secondary" type="button" @click="remindUpdateLater">{{ t('ui.remindLater') }}</button>
            <button class="btn-primary" type="button" :disabled="updateBusy" @click="installAvailableUpdate">{{ updateBusy ? t('ui.checkingUpdates') : t('ui.installUpdate') }}</button>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="qrDialog" class="modal-backdrop" @click.self="qrDialog = null">
        <section class="modal-card qr-modal">
          <div class="modal-title-row"><div><p class="modal-kicker">{{ t('ui.catalogQr_0d8f3') }}</p><h2>{{ qrDialog.title }}</h2><p class="muted">{{ t('ui.scanThisWithTheMobileApp_231a6') }}</p></div></div>
          <div v-if="activeQrPart()" class="qr-sequence-head">
            <strong>{{ activeQrPartLabel() }}</strong>
            <small v-if="activeQrHasMultiple()">{{ t('ui.theFirstQrIncludesTheTotal_0940b') }}</small>
          </div>
          <div v-if="activeQrPart()" class="qr-preview" v-html="activeQrPartSvg()"></div>
          <div v-if="qrDialog.parts.length > 1" class="qr-stepper">
            <button class="btn-secondary" type="button" :disabled="qrDialog.activeIndex === 0" @click="setQrPart(qrDialog.activeIndex - 1)">{{ t('ui.previous_dd1f7') }}</button>
            <span>{{ qrDialog.activeIndex + 1 }} / {{ qrDialog.parts.length }}</span>
            <button class="btn-secondary" type="button" :disabled="qrDialog.activeIndex >= qrDialog.parts.length - 1" @click="setQrPart(qrDialog.activeIndex + 1)">{{ t('ui.next_10ac3') }}</button>
          </div>
          <textarea class="input textarea-input" rows="3" readonly :value="activeQrPartPayload()"></textarea>
          <div class="dialog-actions"><button class="btn-primary" @click="qrDialog = null">{{ t('ui.done_f9296') }}</button></div>
        </section>
      </div>

      <div v-if="mergePicker" class="modal-backdrop" @click.self="closeMergePicker">
        <section class="modal-card merge-picker-modal">
          <div class="modal-header">
            <div>
              <p class="modal-kicker">{{ t('ui.mergeCatalogItem_db2c1') }}</p>
              <h2 class="text-2xl font-bold">{{ t('ui.chooseTheItemToKeep_9e3c5') }}</h2>
              <p class="muted">{{ t('ui.mergeDialogPrefix') }} <b>{{ mergePicker.aliasName }}</b> {{ t('ui.mergeDialogMiddle') }} {{ mergePicker.kind }}. {{ t('ui.mergeDialogSuffix') }}</p>
            </div>
            <button class="btn-secondary" @click="closeMergePicker">{{ t('ui.close_d3d2e') }}</button>
          </div>
          <input v-model="mergePicker.query" class="input" autofocus :placeholder="t('ui.searchByNameIdBrandCode_0c5a3')" />
          <div class="merge-target-list mt-4">
            <button v-for="item in mergePickerOptions" :key="item.id" class="merge-target-row" :class="mergePicker.selectedId === item.id ? 'merge-target-selected' : ''" @click="mergePicker.selectedId = item.id">
              <span><b>{{ item.name }}</b><small>{{ item.subtitle }}</small><code>{{ item.id }}</code></span>
              <span class="inline-svg" v-html="icon('chevronRight')"></span>
            </button>
          </div>
          <div v-if="!mergePickerOptions.length" class="empty-state mt-4">{{ t('ui.noMatchingTargetItem_6e9d3') }}</div>
          <div class="dialog-actions"><button class="btn-secondary" @click="closeMergePicker">{{ t('ui.cancel_ea478') }}</button><button class="btn-primary" :disabled="loading || !mergePicker.selectedId" @click="confirmMergePicker">{{ t('ui.mergeIntoSelected_1a212') }}</button></div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="reviewingInboxEntry" class="modal-backdrop" @click.self="closeInboxReview">
        <section class="modal-card sync-review-modal">
          <div class="modal-header">
            <div>
              <p class="modal-kicker">{{ t('ui.mobileUploadInbox_5ea98') }}</p>
              <h2 class="text-2xl font-bold">{{ t('ui.reviewAndEditBeforeRecording_f198d') }}</h2>
              <p class="muted">{{ reviewingInboxEntry.device_name || reviewingInboxEntry.source_id }} · {{ syncInboxSummary(reviewingInboxEntry) }}</p>
            </div>
            <button class="btn-secondary" @click="closeInboxReview">{{ t('ui.close_d3d2e') }}</button>
          </div>

          <div class="sync-review-summary-row">
            <span v-if="reviewIngredients.length">{{ reviewIngredients.length }} ingredients</span>
            <span v-if="reviewFoods.length">{{ reviewFoods.length }} foods</span>
            <span v-if="reviewRecipes.length">{{ reviewRecipes.length }} recipes</span>
            <span v-if="reviewActivities.length">{{ reviewActivities.length }} activities</span>
            <span v-if="reviewIntakes.length">{{ reviewIntakes.length }} {{ t('ui.mealsNotes') }}</span>
            <span v-if="reviewActivityLogs.length">{{ reviewActivityLogs.length }} {{ t('ui.activityLogs') }}</span>
            <span v-if="reviewWeightLogs.length">{{ reviewWeightLogs.length }} {{ t('ui.weights') }}</span>
          </div>

          <div v-if="reviewingInboxEntry.replacement_candidates.length" class="merge-candidate-list replacement-candidate-list sync-review-merge-list">
            <p class="field-label">{{ t('ui.sameIdReplacementsFromThisUpload_1aae1') }}</p>
            <div v-for="candidate in reviewingInboxEntry.replacement_candidates" :key="`${candidate.kind}:${candidate.id}`" class="merge-candidate-row">
              <span>{{ candidate.kind }} · <b>{{ candidate.incoming_name }}</b></span>
              <small>{{ candidate.id }} {{ t('ui.replaces') }} {{ candidate.existing_name }} {{ t('ui.onDesktopServer') }}</small>
            </div>
          </div>

          <div v-if="reviewingInboxEntry.merge_candidates.length" class="merge-candidate-list sync-review-merge-list">
            <p class="field-label">{{ t('ui.exactDuplicateSuggestionsFromThisUpload_3fbfc') }}</p>
            <div v-for="candidate in reviewingInboxEntry.merge_candidates" :key="`${candidate.kind}:${candidate.incoming_id}`" class="merge-candidate-row">
              <span>{{ candidate.kind }} · <b>{{ candidate.incoming_name }}</b></span>
              <small>{{ candidate.incoming_id }} → {{ candidate.canonical_name }} / {{ candidate.canonical_id }}</small>
            </div>
          </div>

          <div class="sync-review-grid nice-sync-review-grid">
            <article class="sync-review-section">
              <div class="sync-review-section-head">
                <h3>{{ t('ui.ingredients_210c9') }}</h3>
                <small>{{ reviewIngredients.length }} {{ t('ui.itemsCount') }}</small>
              </div>
              <div v-if="!reviewIngredients.length" class="empty-state compact-empty">{{ t('ui.noIngredientsInThisUpload_dfd36') }}</div>
              <div v-else class="sync-edit-list">
                <div v-for="(ingredient, index) in reviewIngredients" :key="`review-ingredient-${ingredient.id}`" class="sync-edit-card">
                  <div class="sync-edit-card-head"><b>{{ t('ui.ingredient_59198') }}</b><span class="inbox-status-pill" :class="`status-${reviewItemStatus('ingredient', ingredient)}`">{{ reviewItemStatusText('ingredient', ingredient) }}</span><button class="link-button danger" @click="skipReviewPayloadItem('ingredients', index)">{{ t('ui.skip_72ef2') }}</button></div>
                  <input v-model="ingredient.name" class="input" :placeholder="t('ui.ingredientName_cbdf8')" />
                  <div class="sync-edit-grid-2"><input v-model="ingredient.default_unit" class="input" :placeholder="t('ui.unit_19c56')" /><input v-model.number="ingredient.serving_size_g" class="input" type="number" step="0.1" :placeholder="t('ui.servingSizeG_8fd02')" /></div>
                  <textarea v-model="ingredient.note" class="input textarea-input" rows="2" :placeholder="t('ui.note_3b064')"></textarea>
                  <div class="sync-edit-grid-4">
                    <input v-model.number="ingredient.kcal_per_100g" class="input" type="number" step="0.1" :placeholder="t('ui.kcal100g_bb877')" />
                    <input v-model.number="ingredient.carbs_per_100g" class="input" type="number" step="0.1" :placeholder="t('ui.carbs_ccebb')" />
                    <input v-model.number="ingredient.fat_per_100g" class="input" type="number" step="0.1" :placeholder="t('ui.fat_0d8dc')" />
                    <input v-model.number="ingredient.protein_per_100g" class="input" type="number" step="0.1" :placeholder="t('ui.protein_6e694')" />
                  </div>
                  <code>{{ ingredient.id }}</code>
                </div>
              </div>
            </article>

            <article class="sync-review-section">
              <div class="sync-review-section-head">
                <h3>{{ t('ui.foods_9428a') }}</h3>
                <small>{{ reviewFoods.length }} {{ t('ui.itemsCount') }}</small>
              </div>
              <div v-if="!reviewFoods.length" class="empty-state compact-empty">{{ t('ui.noFoodsInThisUpload_d06f6') }}</div>
              <div v-else class="sync-edit-list">
                <div v-for="(food, index) in reviewFoods" :key="`review-food-${food.id}`" class="sync-edit-card">
                  <div class="sync-edit-card-head"><b>{{ t('ui.food_0a38e') }}</b><span class="inbox-status-pill" :class="`status-${reviewItemStatus('food', food)}`">{{ reviewItemStatusText('food', food) }}</span><button class="link-button danger" @click="skipReviewPayloadItem('foods', index)">{{ t('ui.skip_72ef2') }}</button></div>
                  <input v-model="food.name" class="input" :placeholder="t('ui.foodName_61083')" />
                  <div class="sync-edit-grid-2"><input v-model="food.brand" class="input" :placeholder="t('ui.brand_1be6f')" /><input v-model="food.default_unit" class="input" :placeholder="t('ui.unit_19c56')" /></div>
                  <textarea v-model="food.note" class="input textarea-input" rows="2" :placeholder="t('ui.note_3b064')"></textarea>
                  <div class="sync-edit-grid-4">
                    <input v-model.number="food.kcal_per_100g" class="input" type="number" step="0.1" :placeholder="t('ui.kcal100g_bb877')" />
                    <input v-model.number="food.carbs_per_100g" class="input" type="number" step="0.1" :placeholder="t('ui.carbs_ccebb')" />
                    <input v-model.number="food.fat_per_100g" class="input" type="number" step="0.1" :placeholder="t('ui.fat_0d8dc')" />
                    <input v-model.number="food.protein_per_100g" class="input" type="number" step="0.1" :placeholder="t('ui.protein_6e694')" />
                  </div>
                  <code>{{ food.id }}</code>
                </div>
              </div>
            </article>

            <article class="sync-review-section">
              <div class="sync-review-section-head">
                <h3>{{ t('ui.recipes_0153a') }}</h3>
                <small>{{ reviewRecipes.length }} {{ t('ui.recipesCount') }}</small>
              </div>
              <div v-if="!reviewRecipes.length" class="empty-state compact-empty">{{ t('ui.noRecipesInThisUpload_f370c') }}</div>
              <div v-else class="sync-edit-list">
                <div v-for="(recipe, index) in reviewRecipes" :key="`review-recipe-${recipe.id}`" class="sync-edit-card">
                  <div class="sync-edit-card-head"><b>{{ t('ui.recipe_aef6e') }}</b><span class="inbox-status-pill" :class="`status-${reviewItemStatus('recipe', recipe)}`">{{ reviewItemStatusText('recipe', recipe) }}</span><button class="link-button danger" @click="skipReviewPayloadItem('recipes', index)">{{ t('ui.skip_72ef2') }}</button></div>
                  <input v-model="recipe.name" class="input" :placeholder="t('ui.recipeName_23955')" />
                  <input v-model="recipe.description" class="input" :placeholder="t('ui.description_b5a7a')" />
                  <textarea v-model="recipe.note" class="input textarea-input" rows="2" :placeholder="t('ui.note_3b064')"></textarea>
                  <div class="sync-edit-grid-2"><input v-model.number="recipe.extra_kcal" class="input" type="number" step="any" inputmode="decimal" :placeholder="t('ui.extraKcal_70d7d')" /><input v-model.number="recipe.servings_count" class="input" type="number" step="0.1" :placeholder="t('ui.servingsOptional_9fcb2')" /></div>
                  <code>{{ recipe.id }}</code>
                </div>
              </div>
            </article>

            <article class="sync-review-section">
              <div class="sync-review-section-head">
                <h3>{{ t('ui.activities_d78ed') }}</h3>
                <small>{{ reviewActivities.length }} {{ t('ui.itemsCount') }}</small>
              </div>
              <div v-if="!reviewActivities.length" class="empty-state compact-empty">{{ t('ui.noActivitiesInThisUpload_ded76') }}</div>
              <div v-else class="sync-edit-list">
                <div v-for="(activity, index) in reviewActivities" :key="`review-activity-${activity.id}`" class="sync-edit-card">
                  <div class="sync-edit-card-head"><b>{{ t('ui.activity_ecfc2') }}</b><span class="inbox-status-pill" :class="`status-${reviewItemStatus('activity', activity)}`">{{ reviewItemStatusText('activity', activity) }}</span><button class="link-button danger" @click="skipReviewPayloadItem('activities', index)">{{ t('ui.skip_72ef2') }}</button></div>
                  <input v-model="activity.name" class="input" :placeholder="t('ui.activityName_75c4c')" />
                  <div class="sync-edit-grid-2"><input v-model="activity.code" class="input" :placeholder="t('ui.code_ca0db')" /><input v-model="activity.activity_type" class="input" :placeholder="t('ui.type_a1fa2')" /></div>
                  <textarea v-model="activity.description" class="input textarea-input" rows="2" :placeholder="t('ui.description_b5a7a')"></textarea>
                  <div class="sync-edit-grid-2"><input v-model.number="activity.met" class="input" type="number" step="0.1" :placeholder="t('ui.met_f99ac')" /><input v-model.number="activity.kcal_per_min" class="input" type="number" step="0.1" :placeholder="t('ui.kcalMin_cf3fd')" /></div>
                  <code>{{ activity.id }}</code>
                </div>
              </div>
            </article>

            <article v-if="reviewIntakes.length || reviewActivityLogs.length || reviewWeightLogs.length" class="sync-review-section private-review-section">
              <div class="sync-review-section-head">
                <h3>{{ t('ui.privateMobileDiaryData_f455b') }}</h3>
                <small>{{ t('ui.keptOnPhoneOnly_f22ee') }}</small>
              </div>
              <div class="empty-state compact-empty">{{ t('ui.mealNotesActivityLogsAndWeight_c2580') }}</div>
            </article>
          </div>

          <article v-if="reviewingInboxEntry.payload.skipped_items?.length" class="sync-review-section skipped-review-section mt-4">
            <div class="sync-review-section-head">
              <h3>{{ t('ui.skippedItems_66bcb') }}</h3>
              <small>{{ reviewingInboxEntry.payload.skipped_items?.length }} {{ t('ui.itemsCount') }}</small>
            </div>
            <div class="sync-edit-list">
              <div v-for="skipped in reviewingInboxEntry.payload.skipped_items" :key="`skipped-${skipped.kind}-${skipped.id}`" class="sync-edit-card inbox-review-row-skipped">
                <div class="sync-edit-card-head"><b>{{ skipped.label }}</b><span class="inbox-status-pill status-skipped">{{ t('ui.skipped_d9c8f') }}</span><button class="link-button" @click="restoreReviewSkippedItem(skipped)">{{ t('ui.restore_2bd33') }}</button></div>
                <small>{{ skipped.kind }} · {{ skipped.id }}</small>
              </div>
            </div>
          </article>

          <details class="sync-json-details" :open="reviewAdvancedJson">
            <summary @click.prevent="toggleReviewAdvancedJson">{{ t('ui.advancedJsonEditor_19192') }}</summary>
            <p class="muted">{{ t('ui.useThisOnlyWhenTheVisual_9b0cc') }}</p>
            <textarea v-model="reviewPayloadText" class="input sync-payload-editor" spellcheck="false"></textarea>
          </details>

          <div class="dialog-actions">
            <button class="btn-secondary" @click="closeInboxReview">{{ t('ui.cancel_ea478') }}</button>
            <button class="btn-primary" :disabled="loading" @click="saveInboxReview">{{ t('ui.saveDraft_48ca5') }}</button>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="modal" class="modal-backdrop" @click.self="handleModalBackdropClick">
        <section class="modal-card">
          <div class="modal-header">
            <div>
              <p class="modal-kicker">nutrino</p>
              <h2 v-if="modal === 'ingredient'" class="text-2xl font-bold">{{ editingIngredientId ? 'Edit ingredient' : 'Add ingredient' }}</h2>
              <h2 v-if="modal === 'food'" class="text-2xl font-bold">{{ editingFoodId ? 'Edit food' : 'Add food' }}</h2>
              <h2 v-if="modal === 'recipe'" class="text-2xl font-bold">{{ editingRecipeId ? 'Edit recipe' : 'Add recipe' }}</h2>
              <h2 v-if="modal === 'activity'" class="text-2xl font-bold">{{ editingActivityId ? 'Edit activity' : 'Add activity' }}</h2>
            </div>
            <button class="btn-secondary" @click="requestCloseModal">{{ t('ui.close_d3d2e') }}</button>
          </div>

          <div v-if="modal === 'ingredient'" class="modal-body grid gap-3">
            <label class="field-label">{{ t('ui.name_49ee3') }}</label><input v-model="ingredientForm.name" class="input" :placeholder="t('ui.ingredientName_cbdf8')" />
            <details class="i18n-extra-panel"><summary>{{ t('translations') }}</summary><p class="muted">{{ t('translationHint') }}</p><div v-if="!translationEntries('ingredient').length" class="empty-state compact-empty">{{ t('noTranslation') }}</div><div v-for="[code] in translationEntries('ingredient')" :key="code" class="i18n-row"><span>{{ translationLanguageLabel(code) }}</span><input v-model="ensureNameI18n(ingredientForm)[code]" class="input" :placeholder="t('nameInLanguage')" /><button type="button" class="link-button danger" @click="removeNameTranslation('ingredient', code)">{{ t('remove') }}</button></div><select class="input" @change="addNameTranslationFromEvent('ingredient', $event)"><option value="">{{ t('addTranslation') }}</option><option v-for="language in availableTranslationLanguages('ingredient')" :key="language.code" :value="language.code">{{ language.englishName }} · {{ language.nativeName }} ({{ language.code }})</option></select></details>
            <label class="field-label">{{ t('ui.note_3b064') }}</label><textarea v-model="ingredientForm.note" class="input textarea-input" rows="3" :placeholder="t('ui.optionalNoteSourceOrMeasurementHint_0b79d')"></textarea>
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">{{ t('ui.defaultUnit_81471') }}</label><input v-model="ingredientForm.default_unit" class="input mt-1" /></div><div><label class="field-label">{{ t('ui.servingSizeG_8fd02') }}</label><input v-model.number="ingredientForm.serving_size_g" class="input mt-1" type="number" min="0" step="0.1" /></div></div>
            <div class="nutrient-form-section">
              <b>{{ t('ui.importantNutrients') }}</b>
              <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">{{ t('ui.kcal100g_bb877') }}</label><input v-model.number="ingredientForm.kcal_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">{{ t('ui.carbs100g_77af9') }}</label><input v-model.number="ingredientForm.carbs_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">{{ t('ui.fat100g_6709a') }}</label><input v-model.number="ingredientForm.fat_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">{{ t('ui.protein100g_bf529') }}</label><input v-model.number="ingredientForm.protein_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div></div>
            </div>
            <details class="optional-nutrients-panel" open>
              <summary><span>{{ t('ui.optionalNutrients') }}</span><small>{{ t('ui.optionalNutrientsHint') }}</small></summary>
              <div class="grid gap-3 sm:grid-cols-2"><div v-for="nutrient in optionalNutrientDefinitions" :key="`ingredient-${nutrient.key}`"><label class="field-label">{{ t(nutrient.labelKey) }} / 100g</label><input :value="localOptionalNutrientValue('ingredient', nutrient)" class="input mt-1" type="number" min="0" step="0.01" @input="setOptionalNutrientValue('ingredient', nutrient, $event)" /></div></div>
            </details>
            <button class="btn-primary mt-2" :disabled="loading" @click="saveIngredient">{{ editingIngredientId ? 'Save changes' : 'Create ingredient' }}</button>
          </div>

          <div v-if="modal === 'food'" class="modal-body grid gap-3">
            <label class="field-label">{{ t('ui.name_49ee3') }}</label><input v-model="foodForm.name" class="input" :placeholder="t('ui.foodName_61083')" />
            <details class="i18n-extra-panel"><summary>{{ t('translations') }}</summary><p class="muted">{{ t('translationHint') }}</p><div v-if="!translationEntries('food').length" class="empty-state compact-empty">{{ t('noTranslation') }}</div><div v-for="[code] in translationEntries('food')" :key="code" class="i18n-row"><span>{{ translationLanguageLabel(code) }}</span><input v-model="ensureNameI18n(foodForm)[code]" class="input" :placeholder="t('nameInLanguage')" /><button type="button" class="link-button danger" @click="removeNameTranslation('food', code)">{{ t('remove') }}</button></div><select class="input" @change="addNameTranslationFromEvent('food', $event)"><option value="">{{ t('addTranslation') }}</option><option v-for="language in availableTranslationLanguages('food')" :key="language.code" :value="language.code">{{ language.englishName }} · {{ language.nativeName }} ({{ language.code }})</option></select></details>
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">{{ t('ui.brandSourceLabel_07afa') }}</label><input v-model="foodForm.brand" class="input mt-1" :placeholder="t('ui.brandRestaurantShopOrSource_21f1e')" /></div><div><label class="field-label">{{ t('ui.barcodeEanUpc_1335e') }}</label><input v-model="foodForm.barcode" class="input mt-1" :placeholder="t('ui.optional_ebb06')" /></div></div>
            <label class="field-label">{{ t('ui.note_3b064') }}</label><textarea v-model="foodForm.note" class="input textarea-input" rows="3" :placeholder="t('ui.optionalNoteSourcePortionHintOr_88ebb')"></textarea>
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">{{ t('ui.defaultUnit_81471') }}</label><input v-model="foodForm.default_unit" class="input mt-1" /></div><div><label class="field-label">{{ t('ui.servingSizeG_8fd02') }}</label><input v-model.number="foodForm.serving_size_g" class="input mt-1" type="number" min="0" step="0.1" /></div></div>
            <div class="nutrient-form-section">
              <b>{{ t('ui.importantNutrients') }}</b>
              <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">{{ t('ui.kcal100g_bb877') }}</label><input v-model.number="foodForm.kcal_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">{{ t('ui.carbs100g_77af9') }}</label><input v-model.number="foodForm.carbs_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">{{ t('ui.fat100g_6709a') }}</label><input v-model.number="foodForm.fat_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">{{ t('ui.protein100g_bf529') }}</label><input v-model.number="foodForm.protein_per_100g" class="input mt-1" type="number" min="0" step="0.1" /></div></div>
            </div>
            <details class="optional-nutrients-panel" open>
              <summary><span>{{ t('ui.optionalNutrients') }}</span><small>{{ t('ui.optionalNutrientsHint') }}</small></summary>
              <div class="grid gap-3 sm:grid-cols-2"><div v-for="nutrient in optionalNutrientDefinitions" :key="`food-${nutrient.key}`"><label class="field-label">{{ t(nutrient.labelKey) }} / 100g</label><input :value="localOptionalNutrientValue('food', nutrient)" class="input mt-1" type="number" min="0" step="0.01" @input="setOptionalNutrientValue('food', nutrient, $event)" /></div></div>
            </details>
            <button class="btn-primary mt-2" :disabled="loading" @click="saveFood">{{ editingFoodId ? 'Save changes' : 'Create food' }}</button>
          </div>

          <div v-if="modal === 'recipe'" class="modal-body grid gap-3">
            <label class="field-label">{{ t('ui.name_49ee3') }}</label><input v-model="recipeForm.name" class="input" :placeholder="t('ui.recipeName_23955')" />
            <details class="i18n-extra-panel"><summary>{{ t('translations') }}</summary><p class="muted">{{ t('translationHint') }}</p><div v-if="!translationEntries('recipe').length" class="empty-state compact-empty">{{ t('noTranslation') }}</div><div v-for="[code] in translationEntries('recipe')" :key="code" class="i18n-row"><span>{{ translationLanguageLabel(code) }}</span><input v-model="ensureNameI18n(recipeForm)[code]" class="input" :placeholder="t('nameInLanguage')" /><button type="button" class="link-button danger" @click="removeNameTranslation('recipe', code)">{{ t('remove') }}</button></div><select class="input" @change="addNameTranslationFromEvent('recipe', $event)"><option value="">{{ t('addTranslation') }}</option><option v-for="language in availableTranslationLanguages('recipe')" :key="language.code" :value="language.code">{{ language.englishName }} · {{ language.nativeName }} ({{ language.code }})</option></select></details>
            <label class="field-label">{{ t('ui.description_b5a7a') }}</label><input v-model="recipeForm.description" class="input" :placeholder="t('ui.optional_ebb06')" />
            <label class="field-label">{{ t('ui.note_3b064') }}</label><textarea v-model="recipeForm.note" class="input textarea-input" rows="3" :placeholder="t('ui.optionalNoteSourcePortionHintOr_88ebb')"></textarea>
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">{{ t('ui.extraKcal_70d7d') }}</label><input v-model.number="recipeForm.extra_kcal" class="input mt-1" type="number" step="any" inputmode="decimal" :placeholder="t('ui.optionalNegativeIsAllowed_cb1cb')" /><small class="muted block mt-1">{{ t('ui.addsToOrSubtractsFromThe_2330b') }}</small></div><div><label class="field-label">{{ t('ui.servings_4349e') }}</label><input v-model.number="recipeForm.servings_count" class="input mt-1" type="number" min="0" step="0.1" :placeholder="t('ui.optionalEmptyMeansTheWholeRecipe_cae88')" /><small class="muted block mt-1">{{ t('ui.whenSet1DbEqualsTotal_3140a') }}</small></div></div>
            <div class="rounded-2xl bg-soft p-3">
              <div v-for="(item, index) in recipeForm.items" :key="index" class="recipe-ingredient-editor mb-3 grid gap-2 sm:grid-cols-[1fr_120px_120px_auto]">
                <div class="recipe-ingredient-picker custom-picker">
                  <button v-if="selectedFood(item) && !recipeIngredientPickerOpen[index]" type="button" class="recipe-selected-item" @click="openRecipeIngredientPicker(index, true)">
                    <b>{{ selectedRecipeIngredientLabel(item) }}</b>
                    <small>{{ selectedRecipeIngredientMeta(item) }}</small>
                  </button>
                  <input v-if="shouldShowRecipeIngredientSearch(item, index)" :ref="(el) => setRecipeIngredientSearchRef(index, el)" v-model="recipeIngredientSearch[index]" class="input recipe-picker-search" type="search" :placeholder="t('ui.searchFoodIngredientOrRecipe_1f688')" autocomplete="off" @focus="openRecipeIngredientPicker(index)" @blur="closeRecipeIngredientPickerSoon(index)" @keydown.escape.prevent="closeRecipeIngredientPickerSoon(index)" />
                  <div v-if="recipeIngredientPickerOpen[index]" class="recipe-picker-menu">
                    <button v-for="food in recipeIngredientOptions(index).slice(0, 12)" :key="food.id" type="button" class="recipe-picker-option" :class="item.food_id === food.id ? 'selected' : ''" @mousedown.prevent="chooseRecipeIngredient(index, food)">
                      <span><b>{{ recipeIngredientLabel(food) }}</b><small>{{ round(food.kcal_per_100g) }} kcal / 100g · {{ food.serving_size_g ? `${round(food.serving_size_g)} g/db` : 'grams only' }}</small></span>
                    </button>
                    <p v-if="!recipeIngredientOptions(index).length" class="muted px-2 py-2">{{ t('ui.noMatchingItem_12f96') }}</p>
                  </div>
                </div>
                <label class="compact-unit-field">
                  <span>g</span>
                  <input v-model.number="item.amount_g" class="input" type="number" min="0" step="0.1" :placeholder="t('ui.grams_ca820')" />
                </label>
                <label class="compact-unit-field" :class="{ disabled: !recipeItemServingSize(item) }">
                  <span>db</span>
                  <input :value="recipeItemPieces(item)" class="input" type="number" min="0" step="0.25" :disabled="!recipeItemServingSize(item)" :placeholder="t('ui.pieces_6b7e9')" @input="setRecipeItemPieces(item, $event)" />
                </label>
                <button class="btn-secondary" @click="removeRecipeItem(index)">{{ t('ui.remove_1063e') }}</button>
                <small class="recipe-ingredient-help sm:col-start-2 sm:col-span-2">{{ recipeItemServingLabel(item) }}</small>
                <small v-if="selectedFood(item)" class="recipe-ingredient-nutrition sm:col-start-1 sm:col-span-3">{{ recipeItemNutrition(item).kcal }} kcal · {{ recipeItemNutrition(item).weight }} g · C {{ recipeItemNutrition(item).carbs }}g · F {{ recipeItemNutrition(item).fat }}g · P {{ recipeItemNutrition(item).protein }}g</small>
              </div>
              <button class="btn-secondary" @click="addRecipeItem">{{ t('ui.addIngredient_590a4') }}</button>
            </div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-6"><div class="mini-stat"><strong>{{ round(recipeFormNutrition.totalWeight) }}g</strong><span>{{ t('ui.weight_7edab') }}</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.kcalTotal) }}</strong><span>{{ t('ui.kcalTotal_0c895') }}</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.extraKcal) }}</strong><span>{{ t('ui.extraKcal_65a05') }}</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.kcalPer100g) }}</strong><span>{{ t('ui.kcal100g_40bdf') }}</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.carbsPer100g) }}g</strong><span>{{ t('ui.carbs100g_ed4c3') }}</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.fatPer100g) }}g</strong><span>{{ t('ui.fat100g_a84e1') }}</span></div><div class="mini-stat"><strong>{{ round(recipeFormNutrition.proteinPer100g) }}g</strong><span>{{ t('ui.protein100g_cdbf5') }}</span></div><div v-if="recipeFormNutrition.servingWeight" class="mini-stat"><strong>{{ round(recipeFormNutrition.servingWeight) }}g</strong><span>{{ t('ui.1Db_42565') }}</span></div></div>
            <button class="btn-primary mt-2" :disabled="loading" @click="saveRecipe">{{ editingRecipeId ? 'Save changes' : 'Create recipe' }}</button>
          </div>

          <div v-if="modal === 'activity'" class="modal-body grid gap-3">
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">{{ t('ui.code_ca0db') }}</label><input v-model="activityForm.code" class="input mt-1" /></div><div><label class="field-label">{{ t('ui.type_a1fa2') }}</label><input v-model="activityForm.activity_type" class="input mt-1" /></div></div>
            <label class="field-label">{{ t('ui.name_49ee3') }}</label><input v-model="activityForm.name" class="input" :placeholder="t('ui.running_75101')" />
            <details class="i18n-extra-panel"><summary>{{ t('translations') }}</summary><p class="muted">{{ t('translationHint') }}</p><div v-if="!translationEntries('activity').length" class="empty-state compact-empty">{{ t('noTranslation') }}</div><div v-for="[code] in translationEntries('activity')" :key="code" class="i18n-row"><span>{{ translationLanguageLabel(code) }}</span><input v-model="ensureNameI18n(activityForm)[code]" class="input" :placeholder="t('nameInLanguage')" /><button type="button" class="link-button danger" @click="removeNameTranslation('activity', code)">{{ t('remove') }}</button></div><select class="input" @change="addNameTranslationFromEvent('activity', $event)"><option value="">{{ t('addTranslation') }}</option><option v-for="language in availableTranslationLanguages('activity')" :key="language.code" :value="language.code">{{ language.englishName }} · {{ language.nativeName }} ({{ language.code }})</option></select></details>
            <label class="field-label">{{ t('ui.description_b5a7a') }}</label><input v-model="activityForm.description" class="input" :placeholder="t('ui.general_95815')" />
            <div class="grid gap-3 sm:grid-cols-2"><div><label class="field-label">MET</label><input v-model.number="activityForm.met" class="input mt-1" type="number" min="0" step="0.1" /></div><div><label class="field-label">{{ t('ui.kcalMin_22677') }}</label><input v-model.number="activityForm.kcal_per_min" class="input mt-1" type="number" min="0" step="0.1" /></div></div>
            <button class="btn-primary mt-2" :disabled="loading" @click="saveActivity">{{ editingActivityId ? 'Save changes' : 'Create activity' }}</button>
          </div>
        </section>
      </div>
    </Teleport>
  </main>
</template>
