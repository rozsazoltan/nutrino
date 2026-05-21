import { invoke } from '@tauri-apps/api/core';
import type {
  Food,
  FoodInput,
  ImportCommitResult,
  ImportPreview,
  RecipeDetail,
  RecipeInput,
  ServerStatus,
  ActivityDefinition,
  ActivityInput,
  DesktopSettings,
} from '../types';

export const commands = {
  getServerStatus: () => invoke<ServerStatus>('get_server_status'),
  startServer: (port: number) => invoke<ServerStatus>('start_api_server', { port }),
  stopServer: () => invoke<ServerStatus>('stop_api_server'),

  listFoods: () => invoke<Food[]>('list_foods'),
  saveFood: (input: FoodInput) => invoke<Food>('save_food', { input }),
  deleteFood: (foodId: string) => invoke<void>('delete_food', { foodId }),
  exportFoodsCsv: () => invoke<string>('export_foods_csv'),
  previewCsv: (csvText: string) => invoke<ImportPreview>('import_foods_preview', { csvText }),
  commitCsv: (csvText: string) => invoke<ImportCommitResult>('import_foods_commit', { csvText }),

  listRecipes: () => invoke<RecipeDetail[]>('list_recipes'),
  saveRecipe: (input: RecipeInput) => invoke<RecipeDetail>('save_recipe', { input }),
  deleteRecipe: (recipeId: string) => invoke<void>('delete_recipe', { recipeId }),

  exportRecipesCsv: () => invoke<string>('export_recipes_csv'),
  importRecipesCsv: (csvText: string) => invoke<ImportCommitResult>('import_recipes_csv', { csvText }),

  listActivities: () => invoke<ActivityDefinition[]>('list_activities'),
  saveActivity: (input: ActivityInput) => invoke<ActivityDefinition>('save_activity', { input }),
  deleteActivity: (activityId: string) => invoke<void>('delete_activity', { activityId }),

  exportActivitiesCsv: () => invoke<string>('export_activities_csv'),
  importActivitiesCsv: (csvText: string) => invoke<ImportCommitResult>('import_activities_csv', { csvText }),

  getDesktopSettings: () => invoke<DesktopSettings>('get_desktop_settings'),
  saveDesktopSettings: (settings: DesktopSettings) => invoke<DesktopSettings>('save_desktop_settings', { settings }),
  rememberCurrentWindow: () => invoke<DesktopSettings>('remember_current_window'),
};
