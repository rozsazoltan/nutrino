import type { Medication, MedicationDoseLog, MedicationDoseStatus, MedicationTreatment } from '../types';

export type MedicationDosePlan = {
  key: string;
  medication: Medication;
  treatment: MedicationTreatment | null;
  log: MedicationDoseLog | null;
  scheduledDate: string;
  doseIndex: number | null;
  scheduledTime: string | null;
  doseAmountUnits: number;
  status: MedicationDoseStatus;
  source: 'treatment' | 'one_day';
  remainingUnits: number | null;
};

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultMedicationReminderTimes(dosesPerDay: number): string[] {
  const count = Math.max(1, Math.min(6, Math.round(Number(dosesPerDay || 1))));
  if (count === 1) return ['08:00'];
  if (count === 2) return ['08:00', '20:00'];
  if (count === 3) return ['08:00', '14:00', '20:00'];
  const startMinutes = 8 * 60;
  const endMinutes = 22 * 60;
  const step = Math.floor((endMinutes - startMinutes) / Math.max(1, count - 1));
  return Array.from({ length: count }, (_, index) => formatMinutes(startMinutes + index * step));
}

export function sanitizeMedicationReminderTimes(value: unknown, dosesPerDay = 1): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : defaultMedicationReminderTimes(dosesPerDay);
  const result = raw.map((item) => String(item || '').trim()).filter((item) => timePattern.test(item));
  const unique = [...new Set(result)].sort();
  return unique.length ? unique : defaultMedicationReminderTimes(dosesPerDay);
}

export function normalizeMedication(entry: Partial<Medication> | null | undefined): Medication | null {
  if (!entry) return null;
  const name = String(entry.name || '').trim();
  if (!name) return null;
  const now = Date.now();
  return {
    id: String(entry.id || `medication-${now}`),
    source_id: String(entry.source_id || 'mobile'),
    name,
    name_i18n: entry.name_i18n ?? null,
    barcode: cleanOptionalString(entry.barcode),
    strength_mg: optionalPositiveNumber(entry.strength_mg),
    note: cleanOptionalString(entry.note),
    updated_at: positiveTimestamp(entry.updated_at, now),
    deleted_at: optionalTimestamp(entry.deleted_at),
    pending_sync: entry.pending_sync === true,
    catalog_source_kind: entry.catalog_source_kind ?? 'custom',
    source_label: entry.source_label ?? null,
    source_url: entry.source_url ?? null,
    source_checked_at: optionalTimestamp(entry.source_checked_at),
    locked: entry.locked ?? null,
    inactive: entry.inactive === true,
  };
}

export function normalizeMedicationTreatment(
  entry: Partial<MedicationTreatment> | null | undefined,
): MedicationTreatment | null {
  if (!entry) return null;
  const medicationId = String(entry.medication_id || '').trim();
  if (!medicationId) return null;
  const dosesPerDay = clampInteger(entry.doses_per_day, 1, 8, 1);
  const startDate = normalizeDateKey(entry.start_date) ?? todayKey();
  const now = Date.now();
  return {
    id: String(entry.id || `medication-treatment-${now}`),
    medication_id: medicationId,
    title: cleanOptionalString(entry.title),
    start_date: startDate,
    end_date: normalizeDateKey(entry.end_date),
    total_units: optionalPositiveNumber(entry.total_units),
    dose_amount_units: positiveNumber(entry.dose_amount_units, 1),
    doses_per_day: dosesPerDay,
    reminder_enabled: entry.reminder_enabled === true,
    reminder_times: sanitizeMedicationReminderTimes(entry.reminder_times, dosesPerDay),
    note: cleanOptionalString(entry.note),
    active: entry.active !== false,
    created_at: positiveTimestamp(entry.created_at, now),
    updated_at: positiveTimestamp(entry.updated_at, now),
    completed_at: optionalTimestamp(entry.completed_at),
    deleted_at: optionalTimestamp(entry.deleted_at),
    pending_sync: entry.pending_sync === true,
  };
}

export function normalizeMedicationDoseLog(
  entry: Partial<MedicationDoseLog> | null | undefined,
): MedicationDoseLog | null {
  if (!entry) return null;
  const medicationId = String(entry.medication_id || '').trim();
  const scheduledDate = normalizeDateKey(entry.scheduled_date);
  if (!medicationId || !scheduledDate) return null;
  const now = Date.now();
  const status =
    entry.status === 'taken' || entry.status === 'skipped' || entry.status === 'pending' ? entry.status : 'taken';
  return {
    id: String(entry.id || `medication-dose-${now}`),
    treatment_id: cleanOptionalString(entry.treatment_id),
    medication_id: medicationId,
    scheduled_date: scheduledDate,
    dose_index: Number.isInteger(entry.dose_index) ? Number(entry.dose_index) : null,
    scheduled_time:
      typeof entry.scheduled_time === 'string' && timePattern.test(entry.scheduled_time) ? entry.scheduled_time : null,
    dose_amount_units: optionalPositiveNumber(entry.dose_amount_units),
    status,
    taken_at: optionalTimestamp(entry.taken_at),
    note: cleanOptionalString(entry.note),
    created_at: positiveTimestamp(entry.created_at, now),
    updated_at: positiveTimestamp(entry.updated_at, now),
    pending_sync: entry.pending_sync === true,
  };
}

export function medicationTreatmentSupplyEndDate(treatment: MedicationTreatment): string | null {
  const totalUnits = Number(treatment.total_units || 0);
  const dailyUnits = Number(treatment.dose_amount_units || 0) * Number(treatment.doses_per_day || 0);
  if (!Number.isFinite(totalUnits) || !Number.isFinite(dailyUnits) || totalUnits <= 0 || dailyUnits <= 0) return null;
  const coveredDays = Math.max(1, Math.floor(totalUnits / dailyUnits));
  return addDays(treatment.start_date, coveredDays - 1);
}

export function medicationTreatmentEffectiveEndDate(treatment: MedicationTreatment): string | null {
  const explicitEnd = normalizeDateKey(treatment.end_date);
  const supplyEnd = medicationTreatmentSupplyEndDate(treatment);
  if (explicitEnd && supplyEnd) return explicitEnd < supplyEnd ? explicitEnd : supplyEnd;
  return explicitEnd || supplyEnd;
}

export function medicationTreatmentActiveOnDate(treatment: MedicationTreatment, dayKey: string): boolean {
  if (treatment.deleted_at || treatment.active === false) return false;
  if (!dateKeyPattern.test(dayKey)) return false;
  if (dayKey < treatment.start_date) return false;
  const endDate = medicationTreatmentEffectiveEndDate(treatment);
  return !endDate || dayKey <= endDate;
}

export function medicationTreatmentRemainingUnits(
  treatment: MedicationTreatment,
  logs: MedicationDoseLog[],
): number | null {
  if (!Number.isFinite(Number(treatment.total_units)) || Number(treatment.total_units) <= 0) return null;
  const takenUnits = logs
    .filter((log) => log.treatment_id === treatment.id && log.status === 'taken')
    .reduce((sum, log) => sum + positiveNumber(log.dose_amount_units, treatment.dose_amount_units), 0);
  return Math.max(0, Math.round((Number(treatment.total_units) - takenUnits) * 100) / 100);
}

export function medicationDosePlansForDay(
  medications: Medication[],
  treatments: MedicationTreatment[],
  logs: MedicationDoseLog[],
  dayKey: string,
): MedicationDosePlan[] {
  const medicationById = new Map(medications.filter((item) => !item.deleted_at).map((item) => [item.id, item]));
  const normalizedLogs = logs.filter((log) => !log.scheduled_date || log.scheduled_date === dayKey);
  const logsByDose = new Map<string, MedicationDoseLog>();
  for (const log of normalizedLogs) {
    if (log.treatment_id) logsByDose.set(`${log.treatment_id}:${log.dose_index ?? 0}`, log);
  }

  const plans: MedicationDosePlan[] = [];
  for (const treatment of treatments) {
    if (!medicationTreatmentActiveOnDate(treatment, dayKey)) continue;
    const medication = medicationById.get(treatment.medication_id);
    if (!medication) continue;
    const remainingUnits = medicationTreatmentRemainingUnits(treatment, logs);
    for (let index = 0; index < treatment.doses_per_day; index += 1) {
      const log = logsByDose.get(`${treatment.id}:${index}`) ?? null;
      const scheduledTime = treatment.reminder_times[index] ?? treatment.reminder_times[0] ?? null;
      plans.push({
        key: `${treatment.id}:${index}`,
        medication,
        treatment,
        log,
        scheduledDate: dayKey,
        doseIndex: index,
        scheduledTime,
        doseAmountUnits: treatment.dose_amount_units,
        status: log?.status ?? 'pending',
        source: 'treatment',
        remainingUnits,
      });
    }
  }

  for (const log of normalizedLogs) {
    if (log.treatment_id) continue;
    const medication = medicationById.get(log.medication_id);
    if (!medication) continue;
    plans.push({
      key: log.id,
      medication,
      treatment: null,
      log,
      scheduledDate: dayKey,
      doseIndex: log.dose_index ?? null,
      scheduledTime: log.scheduled_time ?? null,
      doseAmountUnits: positiveNumber(log.dose_amount_units, 1),
      status: log.status,
      source: 'one_day',
      remainingUnits: null,
    });
  }

  return plans.sort((left, right) => {
    const leftTime = left.scheduledTime ?? '99:99';
    const rightTime = right.scheduledTime ?? '99:99';
    if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
    return left.medication.name.localeCompare(right.medication.name);
  });
}

function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return dateKeyPattern.test(clean) ? clean : null;
}

function todayKey(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return todayKeyFromDate(date);
}

function todayKeyFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMinutes(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function cleanOptionalString(value: unknown): string | null {
  const clean = String(value ?? '').trim();
  return clean || null;
}

function optionalTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveTimestamp(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
