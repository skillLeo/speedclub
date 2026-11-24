/**
 * [AI] features (M3.7, 02 §6, ADR-242): each one a POST behind its flag. All of them answer 404 `feature_disabled` while the flag is
 * off (always without a provider, OA-18), 403 `ai_opt_in_required` without the member's "KI-Vorschläge" (not translation), 422
 * `ai_refused` / `ai_unverifiable`, 503 `ai_unavailable` / `ai_budget_exhausted`, 429 rate-limited. Nothing is cached in the query
 * cache or on the device (a translation is cached on the server, encrypted, 30 days); nothing saves anything for the member.
 */
import { useMutation } from '@tanstack/react-query';

import { api, apiData } from '@/api/client';
import type { components } from '@/api/schema';

export const AI_FLAGS = {
  search: 'ai.nl_search',
  mods: 'ai.mod_assist',
  photos: 'ai.photo_tagging',
  translate: 'ai.translate',
  description: 'ai.description_assist',
  // M5.9 (m5.9-contract): typical factory specs in the wizard and GAR-06, a typed part matched to the catalogue (both with the
  // opt-in), the forum summary (no opt-in, D-3: it arrives with the thread and has no request of its own).
  specs: 'ai.vehicle_specs',
  productMatch: 'ai.product_match',
  forumSummary: 'ai.forum_summary',
} as const;

export type AiFlag = (typeof AI_FLAGS)[keyof typeof AI_FLAGS];

export type SearchInterpretation = components['schemas']['SearchInterpretationResource'];
export type InterpretationChip = SearchInterpretation['chips'][number];
export type ModSuggestion = components['schemas']['ModSuggestionResource'];
export type PhotoCategorySuggestion = components['schemas']['PhotoCategoryResource'];
export type Translation = components['schemas']['TranslationResource'];
export type TranslationSource = components['schemas']['TranslationSource'];
export type DescriptionSuggestion = components['schemas']['DescriptionSuggestionResource'];
export type SpecSuggestion = components['schemas']['SpecSuggestionResource'];
export type SpecVariant = SpecSuggestion['variants'][number];
export type ProductMatch = components['schemas']['ProductMatchResource'];

/** The longest search text ai/search/interpret takes, and the longest pasted text of ai/mods/suggest. */
export const AI_SEARCH_MAX = 200;
export const AI_MOD_TEXT_MAX = 500;
/** The longest typed part ai/products/match takes, and the shortest. */
export const AI_PRODUCT_TEXT_MAX = 80;
export const AI_PRODUCT_TEXT_MIN = 2;

/** DISC-02 "Mit KI suchen": the typed search as editable filter chips. */
export function useInterpretSearch() {
  return useMutation({
    mutationFn: async (q: string) => (await apiData(api.POST('/ai/search/interpret', { body: { q: q.slice(0, AI_SEARCH_MAX) } }))).data,
  });
}

/** GAR-10 "Aus Text übernehmen": field values from a pasted text, each to accept or discard. */
export function useSuggestMod() {
  return useMutation({
    mutationFn: async (input: { categoryKey: string | null; text: string }) =>
      (await apiData(api.POST('/ai/mods/suggest', { body: { category_key: input.categoryKey, text: input.text.slice(0, AI_MOD_TEXT_MAX) } }))).data,
  });
}

/** GAR-07/08: the suggested category of an own photo. 409 while the photo is still processing. */
export function useSuggestPhotoCategory() {
  return useMutation({
    mutationFn: async (mediaId: string) => (await apiData(api.POST('/ai/photos/{media}/category', { params: { path: { media: mediaId } } }))).data,
  });
}

/** VEH-01 description, a build update, an MSG-02 message: "Übersetzen", on a tap, no opt-in. */
export function useTranslateText() {
  return useMutation({
    mutationFn: async (input: { source: TranslationSource; id: string; to: 'de' | 'en' }) =>
      (await apiData(api.POST('/ai/translate', { body: input }))).data,
  });
}

/** GAR-03 step 3 "Beschreibung vorschlagen": from the vehicle's structured data only. */
export function useSuggestDescription() {
  return useMutation({
    mutationFn: async (vehicleId: string) => (await apiData(api.POST('/ai/vehicles/{vehicle}/description', { params: { path: { vehicle: vehicleId } } }))).data,
  });
}

/** What "Daten übernehmen?" asks for: the catalogue generation, or the model and its year when the model has no generations. */
export type SpecSubject = { generation_id: number } | { model_id: number; model_year: number };

/**
 * GAR-03 step 2 / GAR-06 "Daten übernehmen?" (M5.9): up to six typical factory variants of the catalogue car, shared by every member
 * who picks it. Nothing is written: the member takes a variant into the form and saves as usual (with `ai_suggestion`).
 */
export function useSuggestSpecs() {
  return useMutation({
    mutationFn: async (subject: SpecSubject): Promise<SpecSuggestion> => {
      const body = await apiData(api.POST('/ai/specs/suggest', { body: subject }));
      return body.data;
    },
  });
}

/** GAR-10 product search found nothing: the typed part matched to at most three catalogue products (never one we do not list). */
export function useMatchProduct() {
  return useMutation({
    mutationFn: async (input: { text: string; categoryKey: string | null }) =>
      (
        await apiData(
          api.POST('/ai/products/match', {
            body: { text: input.text.trim().slice(0, AI_PRODUCT_TEXT_MAX), ...(input.categoryKey ? { category_key: input.categoryKey } : {}) },
          }),
        )
      ).data,
  });
}
