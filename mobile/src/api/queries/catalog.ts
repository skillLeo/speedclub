/**
 * The catalogue (02_PRODUCT_SPEC §3.2, §3.3): makes → models → generations for the add-vehicle wizard and GAR-05, brands and
 * the field schemas of the modification categories for GAR-10. Public reads with an ETag on the server; they change rarely,
 * so a copy is good for an hour and stays in the persisted cache for offline forms.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api, apiData } from '@/api/client';
import type { components } from '@/api/schema';

export type Make = components['schemas']['MakeResource'];
export type VehicleModel = components['schemas']['VehicleModelResource'];
export type Generation = components['schemas']['GenerationResource'];
export type Brand = components['schemas']['BrandResource'];
export type ModCategory = components['schemas']['ModCategoryResource'];
export type ModCategoryField = components['schemas']['ModCategoryFieldResource'];

/** The server's largest page (speedclub.catalog.max_page_size). The lists are far shorter; the loop is a safety net. */
const PAGE_SIZE = 500;
const HOUR_MS = 60 * 60 * 1000;
/** A cursor that never ends would otherwise spin forever. */
const MAX_PAGES = 10;

type Page<T> = { data: T[]; meta: { next_cursor: string | null } };

/** Every page of a cursor list, in order. */
export async function allPages<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer: Page<T> = await fetchPage(cursor);
    rows.push(...answer.data);
    cursor = answer.meta.next_cursor;
    if (!cursor) break;
  }
  return rows;
}

export const catalogKeys = {
  makes: (language: string) => ['catalog', 'makes', language] as const,
  models: (makeId: number) => ['catalog', 'models', makeId] as const,
  generations: (modelId: number) => ['catalog', 'generations', modelId] as const,
  brands: (category: string) => ['catalog', 'brands', category] as const,
  categories: (language: string) => ['catalog', 'mod-categories', language] as const,
};

function useLanguage(): string {
  return useTranslation().i18n.language;
}

/** Popular makes first, as the server sorts them. */
export function useMakes() {
  const language = useLanguage();
  return useQuery({
    queryKey: catalogKeys.makes(language),
    queryFn: ({ signal }) =>
      allPages((cursor) =>
        apiData(api.GET('/catalog/makes', { params: { query: { per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}) } }, signal })),
      ),
    staleTime: HOUR_MS,
  });
}

export function useModels(makeId: number | null | undefined) {
  const id = makeId ?? 0;
  return useQuery({
    queryKey: catalogKeys.models(id),
    queryFn: ({ signal }) =>
      allPages((cursor) =>
        apiData(
          api.GET('/catalog/makes/{make}/models', {
            params: { path: { make: id }, query: { per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
            signal,
          }),
        ),
      ),
    staleTime: HOUR_MS,
    enabled: id > 0,
  });
}

export function useGenerations(modelId: number | null | undefined) {
  const id = modelId ?? 0;
  return useQuery({
    queryKey: catalogKeys.generations(id),
    queryFn: ({ signal }) =>
      allPages((cursor) =>
        apiData(
          api.GET('/catalog/models/{model}/generations', {
            params: { path: { model: id }, query: { per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
            signal,
          }),
        ),
      ),
    staleTime: HOUR_MS,
    enabled: id > 0,
  });
}

/** The brands a category suggests ("Räder & Reifen": BBS, OZ Racing …). Free text stays possible in every field. */
export function useBrands(category: string | undefined) {
  const key = category ?? '';
  return useQuery({
    queryKey: catalogKeys.brands(key),
    queryFn: ({ signal }) =>
      allPages((cursor) =>
        apiData(
          api.GET('/catalog/brands', {
            params: { query: { per_page: PAGE_SIZE, category: key, ...(cursor ? { cursor } : {}) } },
            signal,
          }),
        ),
      ),
    staleTime: HOUR_MS,
    enabled: key !== '',
  });
}

/** The ten categories with their field schemas (ADM-15 can change them, so the form is built from this answer). */
export function useModCategories() {
  const language = useLanguage();
  return useQuery({
    queryKey: catalogKeys.categories(language),
    queryFn: ({ signal }) =>
      allPages((cursor) =>
        apiData(
          api.GET('/catalog/mod-categories', { params: { query: { per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}) } }, signal }),
        ),
      ),
    staleTime: HOUR_MS,
  });
}
