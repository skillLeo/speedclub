import { useMemo, useState } from 'react';
import type { UseFormGetValues, UseFormSetValue } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import type { GarageVehicle, SpecsRequest } from '@/api/queries/garage';
import type { FormatLocale } from '@/lib/format';
import { toast } from '@/ui/toast';

import { storedMarks, type SpecsMarks, type SpecsValues } from './model';

/** The suggestion a save sends as `ai_suggestion`, and the values it put into the form. */
export type TakenSuggestion = { cacheId: string; variant: string; values: SpecsMarks };

export type SpecsSuggestion = {
  /** Writes the taken values into the form (dirty, not saved) with a toast whose "Rückgängig" puts the previous values back. */
  take: (taken: TakenSuggestion) => void;
  /** The values that carry "Herstellerangabe (KI-Vorschlag)" while the fields still show them: stored ones and the ones just taken. */
  marks: SpecsMarks;
  /**
   * Saves with `ai_suggestion` while a suggestion was taken since the last save. A suggestion the server no longer knows (422
   * `errors.ai_suggestion`, expired) does not cost the member the save: it goes again without it, the values stay, only the mark goes.
   */
  send: <T>(save: (body: SpecsRequest) => Promise<T>, body: SpecsRequest) => Promise<T>;
};

/**
 * GAR-03 step 2 and GAR-06 "Daten übernehmen?" (M5.9, ai.vehicle_specs): what the form keeps of a taken suggestion until the save.
 * Nothing reaches the vehicle before the member's own Weiter or Speichern.
 */
export function useSpecsSuggestion<T extends SpecsValues>({
  specs,
  locale,
  getValues,
  setValue,
  routeId,
}: {
  specs: GarageVehicle['specs'] | undefined;
  locale: FormatLocale;
  getValues: UseFormGetValues<T>;
  setValue: UseFormSetValue<T>;
  routeId: string;
}): SpecsSuggestion {
  const { t } = useTranslation('garage');
  const [taken, setTaken] = useState<TakenSuggestion | null>(null);
  const stored = useMemo(() => storedMarks(specs, locale), [specs, locale]);
  const marks = useMemo(() => (taken ? { ...stored, ...taken.values } : stored), [stored, taken]);

  // The form's own value types are SpecsValues' (T only adds keys, as GAR-06's HU/AU month), so a spec key takes a spec value.
  const write = setValue as unknown as UseFormSetValue<SpecsValues>;
  const read = getValues as unknown as UseFormGetValues<SpecsValues>;

  const apply = (values: SpecsMarks) => {
    for (const [key, value] of Object.entries(values) as [keyof SpecsValues, SpecsValues[keyof SpecsValues]][]) {
      write(key, value, { shouldDirty: true, shouldValidate: true });
    }
  };

  const take = (next: TakenSuggestion) => {
    const current = read();
    const before = Object.fromEntries(Object.keys(next.values).map((key) => [key, current[key as keyof SpecsValues]])) as SpecsMarks;
    apply(next.values);
    setTaken(next);
    toast(t('ai.specs.taken'), {
      undo: () => {
        apply(before);
        setTaken(null);
      },
      testID: `${routeId}.specsSuggestion.toast`,
    });
  };

  const send = async <R,>(save: (body: SpecsRequest) => Promise<R>, body: SpecsRequest): Promise<R> => {
    if (!taken) return save(body);
    try {
      const result = await save({ ...body, ai_suggestion: { cache_id: taken.cacheId, variant: taken.variant } });
      setTaken(null);
      return result;
    } catch (error) {
      if (!(error instanceof ApiError) || !error.fieldErrors.ai_suggestion) throw error;
      setTaken(null);
      return save(body);
    }
  };

  return { take, marks, send };
}
