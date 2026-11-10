/**
 * Legal texts from the CMS (SET-17, SET-18): public, versioned, one copy per language. The persisted query cache keeps the
 * last copy read, so a text stays readable offline.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api, apiData, ApiError, withIdempotency } from '@/api/client';
import type { components } from '@/api/schema';
import { notifyConsentAccepted } from '@/state/consent';

export type LegalKey = components['schemas']['LegalDocumentKey'];
export type LegalSummary = components['schemas']['LegalDocumentSummaryResource'];
export type LegalDocument = components['schemas']['LegalDocumentResource'];

/** The order of SET-17. */
export const LEGAL_KEYS: readonly LegalKey[] = ['imprint', 'privacy', 'terms', 'community', 'licenses'];

export function isLegalKey(value: unknown): value is LegalKey {
  return typeof value === 'string' && (LEGAL_KEYS as readonly string[]).includes(value);
}

/** A published text changes rarely; a new version still arrives within the hour, or at once on a pull. */
const LEGAL_STALE_MS = 60 * 60 * 1000;

export const legalListKey = (locale: string) => ['legal', 'list', locale] as const;
export const legalDocumentKey = (key: LegalKey, locale: string) => ['legal', 'document', key, locale] as const;

/** A 404 is an answer, not an outage: retrying cannot change it. */
const retryUnlessAnswered = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;

/** The texts in the list's order, in the app's language. */
export function useLegalDocuments() {
  const locale = useTranslation().i18n.language;
  return useQuery({
    queryKey: legalListKey(locale),
    queryFn: async ({ signal }) => {
      const { data } = await apiData(api.GET('/legal', { signal }));
      return [...data].sort((a, b) => LEGAL_KEYS.indexOf(a.key) - LEGAL_KEYS.indexOf(b.key));
    },
    staleTime: LEGAL_STALE_MS,
    retry: retryUnlessAnswered,
  });
}

/** One text. Disabled for a key the app does not know, which the screen shows as not found. */
export function useLegalDocument(key: LegalKey | null) {
  const locale = useTranslation().i18n.language;
  return useQuery({
    queryKey: legalDocumentKey(key ?? 'imprint', locale),
    queryFn: async ({ signal }) => {
      const { data } = await apiData(api.GET('/legal/{key}', { params: { path: { key: key ?? 'imprint' } }, signal }));
      return data;
    },
    enabled: key !== null,
    staleTime: LEGAL_STALE_MS,
    retry: retryUnlessAnswered,
  });
}

// M3.5 ADM-31 re-consent (ADR-236 f): the documents the member must accept again, and the accept.

export type ConsentState = components['schemas']['ConsentStateResource'];
export type RequiredConsent = ConsentState['required'][number];

export const consentKeys = {
  /** Per re-consent version pair of app-config, so a new publish asks again. */
  state: (terms: string | null, privacy: string | null) => ['me', 'consents', terms ?? '-', privacy ?? '-'] as const,
  all: ['me', 'consents'] as const,
};

/**
 * `GET me/consents`, asked only while a member is signed in and app-config names a re-consent version, or a write was just refused
 * with 403 `consent_required` (`forced`, ADR-245: the server knew before this app's config did). Never persisted.
 */
export function useConsentState(reconsent: { terms: string | null; privacy: string | null }, enabled: boolean, forced = false) {
  return useQuery({
    queryKey: consentKeys.state(reconsent.terms, reconsent.privacy),
    queryFn: async ({ signal }) => (await apiData(api.GET('/me/consents', { signal }))).data,
    enabled: enabled && (forced || reconsent.terms !== null || reconsent.privacy !== null),
    staleTime: Infinity,
    retry: 1,
    meta: { persist: false },
  });
}

/**
 * `POST me/consents` with the versions the sheet showed; idempotent. A 422 means a newer version came out: the sheet reloads. An answer
 * with nothing left to accept is announced (state/consent.ts), and ConsentHost remembers it for an offline start.
 */
export function useAcceptConsents() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (required: readonly RequiredConsent[]) => {
      const body = {
        terms_version: required.find((item) => item.key === 'terms')?.version ?? null,
        privacy_version: required.find((item) => item.key === 'privacy')?.version ?? null,
      };
      return (await apiData(api.POST('/me/consents', { body, ...withIdempotency() }))).data;
    },
    onSuccess: (state) => {
      client.setQueriesData<ConsentState>({ queryKey: consentKeys.all }, state);
      // SF-2: what waited for the consent (a refused message in the outbox) goes out now.
      if (state.required.length === 0) notifyConsentAccepted();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.kind === 'validation') void client.invalidateQueries({ queryKey: consentKeys.all });
    },
  });
}
