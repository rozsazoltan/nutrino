import { describe, expect, it } from 'vitest';
import type { Medication, MedicationDoseLog, MedicationTreatment } from '../types';
import {
  medicationDosePlansForDay,
  medicationTreatmentActiveOnDate,
  medicationTreatmentEffectiveEndDate,
  medicationTreatmentRemainingUnits,
  medicationTreatmentSupplyEndDate,
  sanitizeMedicationReminderTimes,
} from './medications';

const medication: Medication = {
  id: 'med-1',
  source_id: 'mobile',
  name: 'Amoxicillin',
  barcode: '1234567890123',
  strength_mg: 500,
  note: null,
  updated_at: 1,
};

function treatment(overrides: Partial<MedicationTreatment> = {}): MedicationTreatment {
  return {
    id: 'treatment-1',
    medication_id: medication.id,
    title: null,
    start_date: '2026-06-10',
    end_date: null,
    total_units: null,
    dose_amount_units: 1,
    doses_per_day: 2,
    reminder_enabled: true,
    reminder_times: ['08:00', '20:00'],
    note: null,
    active: true,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

describe('medication helpers', () => {
  it('keeps indefinite treatments active until they are ended', () => {
    const entry = treatment();
    expect(medicationTreatmentActiveOnDate(entry, '2026-06-09')).toBe(false);
    expect(medicationTreatmentActiveOnDate(entry, '2026-06-10')).toBe(true);
    expect(medicationTreatmentActiveOnDate(entry, '2027-01-01')).toBe(true);
    expect(medicationTreatmentActiveOnDate({ ...entry, active: false }, '2026-06-11')).toBe(false);
  });

  it('derives an effective end date from supply and explicit end dates', () => {
    const bySupply = treatment({ total_units: 10, dose_amount_units: 1, doses_per_day: 2 });
    expect(medicationTreatmentSupplyEndDate(bySupply)).toBe('2026-06-14');
    expect(medicationTreatmentEffectiveEndDate(bySupply)).toBe('2026-06-14');
    expect(medicationTreatmentEffectiveEndDate({ ...bySupply, end_date: '2026-06-20' })).toBe('2026-06-14');
    expect(medicationTreatmentEffectiveEndDate({ ...bySupply, end_date: '2026-06-12' })).toBe('2026-06-12');
  });

  it('builds daily dose plans from active treatments and existing logs', () => {
    const log: MedicationDoseLog = {
      id: 'dose-1',
      treatment_id: 'treatment-1',
      medication_id: medication.id,
      scheduled_date: '2026-06-11',
      dose_index: 1,
      scheduled_time: '20:00',
      dose_amount_units: 1,
      status: 'taken',
      taken_at: 100,
      note: null,
      created_at: 1,
      updated_at: 1,
    };
    const plans = medicationDosePlansForDay([medication], [treatment()], [log], '2026-06-11');
    expect(plans).toHaveLength(2);
    expect(plans.map((plan) => plan.scheduledTime)).toEqual(['08:00', '20:00']);
    expect(plans.map((plan) => plan.status)).toEqual(['pending', 'taken']);
  });

  it('includes one-day medication logs without a treatment cycle', () => {
    const oneDayLog: MedicationDoseLog = {
      id: 'dose-one-day',
      treatment_id: null,
      medication_id: medication.id,
      scheduled_date: '2026-06-11',
      dose_index: null,
      scheduled_time: '09:30',
      dose_amount_units: 2,
      status: 'taken',
      taken_at: 100,
      note: null,
      created_at: 1,
      updated_at: 1,
    };
    const plans = medicationDosePlansForDay([medication], [], [oneDayLog], '2026-06-11');
    expect(plans[0]).toMatchObject({ source: 'one_day', doseAmountUnits: 2, status: 'taken' });
  });

  it('tracks remaining supply from taken dose logs', () => {
    const entry = treatment({ total_units: 6, dose_amount_units: 1, doses_per_day: 2 });
    const logs: MedicationDoseLog[] = [
      {
        id: 'dose-1',
        treatment_id: entry.id,
        medication_id: medication.id,
        scheduled_date: '2026-06-10',
        dose_index: 0,
        scheduled_time: '08:00',
        dose_amount_units: 1,
        status: 'taken',
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'dose-2',
        treatment_id: entry.id,
        medication_id: medication.id,
        scheduled_date: '2026-06-10',
        dose_index: 1,
        scheduled_time: '20:00',
        dose_amount_units: 1,
        status: 'skipped',
        created_at: 1,
        updated_at: 1,
      },
    ];
    expect(medicationTreatmentRemainingUnits(entry, logs)).toBe(5);
  });

  it('sanitizes reminder times and falls back to dose-based defaults', () => {
    expect(sanitizeMedicationReminderTimes(['25:00', '08:00', '08:00'], 2)).toEqual(['08:00']);
    expect(sanitizeMedicationReminderTimes([], 3)).toEqual(['08:00', '14:00', '20:00']);
  });
});
