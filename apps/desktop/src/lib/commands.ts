import { invoke } from '@tauri-apps/api/core';
import type {
  Food,
  FoodInput,
  Ingredient,
  IngredientInput,
  ImportCommitResult,
  ImportPreview,
  RecipeDetail,
  RecipeInput,
  ServerStatus,
  ActivityDefinition,
  ActivityInput,
  DesktopSettings,
  SyncInboxEntry,
  SyncInboxCommitResult,
  CatalogDuplicateSuggestion,
} from '../types';

export const commands = {
  getServerStatus: () => invoke<ServerStatus>('get_server_status'),
  startServer: (port: number) => invoke<ServerStatus>('start_api_server', { port }),
  stopServer: () => invoke<ServerStatus>('stop_api_server'),

  listFoods: () => invoke<Food[]>('list_foods'),
  saveFood: (input: FoodInput) => invoke<Food>('save_food', { input }),
  deleteFood: (foodId: string) => invoke<void>('delete_food', { foodId }),

  listIngredients: () => invoke<Ingredient[]>('list_ingredients'),
  saveIngredient: (input: IngredientInput) => invoke<Ingredient>('save_ingredient', { input }),
  deleteIngredient: (ingredientId: string) => invoke<void>('delete_ingredient', { ingredientId }),
  exportIngredientsCsv: () => invoke<string>('export_ingredients_csv'),
  importIngredientsCsv: (csvText: string, skipDuplicates = true) => invoke<ImportCommitResult>('import_ingredients_csv', { csvText, skipDuplicates }),

  exportFoodsCsv: () => invoke<string>('export_foods_csv'),
  previewCsv: (csvText: string) => invoke<ImportPreview>('import_foods_preview', { csvText }),
  commitCsv: (csvText: string, skipDuplicates = true) => invoke<ImportCommitResult>('import_foods_commit', { csvText, skipDuplicates }),

  listRecipes: () => invoke<RecipeDetail[]>('list_recipes'),
  saveRecipe: (input: RecipeInput) => invoke<RecipeDetail>('save_recipe', { input }),
  deleteRecipe: (recipeId: string) => invoke<void>('delete_recipe', { recipeId }),

  exportRecipesCsv: () => invoke<string>('export_recipes_csv'),
  importRecipesCsv: (csvText: string, skipDuplicates = true) => invoke<ImportCommitResult>('import_recipes_csv', { csvText, skipDuplicates }),

  listActivities: () => invoke<ActivityDefinition[]>('list_activities'),
  saveActivity: (input: ActivityInput) => invoke<ActivityDefinition>('save_activity', { input }),
  deleteActivity: (activityId: string) => invoke<void>('delete_activity', { activityId }),

  exportActivitiesCsv: () => invoke<string>('export_activities_csv'),
  importActivitiesCsv: (csvText: string, skipDuplicates = true) => invoke<ImportCommitResult>('import_activities_csv', { csvText, skipDuplicates }),

  getDesktopSettings: () => invoke<DesktopSettings>('get_desktop_settings'),
  saveDesktopSettings: (settings: DesktopSettings) => invoke<DesktopSettings>('save_desktop_settings', { settings }),
  rememberCurrentWindow: () => invoke<DesktopSettings>('remember_current_window'),
  setServerPassword: (password: string) => invoke<ServerStatus>('set_server_password', { password }),
  listSyncInbox: () => invoke<SyncInboxEntry[]>('list_sync_inbox'),
  acceptSyncInbox: (entryId: string) => invoke<SyncInboxCommitResult>('accept_sync_inbox', { entryId }),
  rejectSyncInbox: (entryId: string) => invoke<void>('reject_sync_inbox', { entryId }),
  updateSyncInboxPayload: (entryId: string, payloadJson: string) => invoke<SyncInboxEntry>('update_sync_inbox_payload', { entryId, payloadJson }),
  mergeCatalogItem: (kind: string, aliasId: string, canonicalId: string) => invoke<void>('merge_catalog_item', { kind, aliasId, canonicalId }),
  listCatalogDuplicateSuggestions: () => invoke<CatalogDuplicateSuggestion[]>('list_catalog_duplicate_suggestions'),
};
