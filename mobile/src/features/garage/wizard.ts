/**
 * What every wizard step shares (GAR-03, F2): the draft from the route, the step's state, and the live preview card of the
 * desktop pane. The draft is created by step 1's first save; every later step PATCHes `wizard_step`, so "Fortsetzen" in
 * GAR-01 opens the step a member left.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { NEW_DRAFT, useReadVehicleOnOpen, useVehicle, type GarageVehicle } from '@/api/queries/garage';
import { photoFields, specChips } from '@/features/profile/media';
import { paramOf } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';

import type { WizardPreview } from './components/WizardFrame';
import { isGone } from './errors';
import { useGarageAccess } from './components/frames';

/** The desktop pane's card width, for the cover's variant. */
const PREVIEW_PHOTO_WIDTH = 320;

export type WizardState = 'loading' | 'ready' | 'guest' | 'gone' | 'error' | 'offline';

export function useWizardDraft() {
  const params = useLocalSearchParams<{ draftId: string }>();
  const draftId = paramOf(params.draftId) ?? NEW_DRAFT;
  const isNew = draftId === NEW_DRAFT;
  const qaState = useQaState();
  const online = useOnline();
  const access = useGarageAccess();
  const query = useVehicle(isNew ? undefined : draftId);
  // Every step reads the draft fresh on open, as the editors do (ADR-176 c): another device may have changed its specs or its
  // visibility, and step 2's PUT replaces the whole set while the review publishes the visibility it shows.
  useReadVehicleOnOpen(isNew ? undefined : draftId);

  let state: WizardState = 'ready';
  if (qaState === 'loading' || access.status === 'loading') state = 'loading';
  else if (qaState === 'error') state = 'error';
  else if (qaState === 'offline' && !query.data) state = isNew ? 'ready' : 'offline';
  else if (access.status === 'guest') state = 'guest';
  else if (!isNew && !query.data) {
    if (query.error) state = isGone(query.error) ? 'gone' : online ? 'error' : 'offline';
    else state = query.fetchStatus === 'paused' ? 'offline' : 'loading';
  }

  return {
    draftId,
    isNew,
    draft: query.data,
    query,
    state,
    restriction: access.restriction,
    reached: query.data?.wizard?.step ?? 1,
  };
}

/**
 * False once the step is gone: leaving during a slow save keeps the save and skips the navigation behind it (BH-14). Set inside
 * the effect too, so a StrictMode remount does not leave it false.
 */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** The live card: what the form says now, over what the draft has stored. */
export function usePreview(draft: GarageVehicle | undefined, live: { title?: string; subtitle?: string; specs?: readonly string[] } = {}): WizardPreview {
  const { t } = useTranslation('garage');
  return {
    title: live.title ?? (draft?.full_title.trim() || t('wizard.untitled')),
    subtitle: live.subtitle ?? (draft ? draft.subline_parts.slice(0, 2).join(' · ') || undefined : undefined),
    photo: photoFields(draft?.cover ?? null, PREVIEW_PHOTO_WIDTH),
    specs: live.specs ?? (draft ? specChips(draft) : []),
  };
}
