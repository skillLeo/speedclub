import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, networkError, newIdempotencyKey } from '@/api/client';
import { useChangeVisibility, usePublishVehicle, type GarageVehicle, type Visibility } from '@/api/queries/garage';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { photoFields, specChips } from '@/features/profile/media';
import { RowCard } from '@/features/vehicle/components/RowCard';
import { keepNameTogether, keepValuesTogether } from '@/lib/format';
import { useOnline } from '@/state/online';
import { createStyles, space } from '@/theme';
import { ListRow, toast, VehicleCard } from '@/ui';
import { useStacksAtFontScale } from '@/ui/rowParts';

import { FormGroup } from '../../components/fields';
import { RestrictedNotice } from '../../components/frames';
import { usePhotoCounts } from '../../components/VehiclePhotos';
import { VisibilityChoice } from '../../components/VisibilityChoice';
import { WizardFrame } from '../../components/WizardFrame';
import { mayStillLand, saveErrorMessage } from '../../errors';
import { isVisibility, missingForPublish, stepFor, type WizardStep } from '../../model';
import { useCloseModal, useReplaceWizardWithPublished, wizardPath } from '../../navigation';
import { useMountedRef, usePreview, useWizardDraft } from '../../wizard';
import { WizardStateBody } from './WizardStateBody';

const CARD_PHOTO_WIDTH = 560;

const useStyles = createStyles((t) => ({
  missing: { gap: t.space[8] },
}));

/** GAR-03 step 4 "Prüfen & veröffentlichen": the card as others will see it, what is still missing, visibility, publish. */
export function WizardReviewScreen() {
  const wizard = useWizardDraft();
  const preview = usePreview(wizard.draft);
  const toPublished = useReplaceWizardWithPublished();
  // A published vehicle has nothing left to review: opened again (a reload, an old link, Fortsetzen from a stale list) or
  // published just now, under this key or after a lost answer under a new one (the server answers a publish of a published
  // vehicle with 200), it goes to GAR-04. The only way there, so a publish never navigates twice; a step that was closed
  // during the publish is unmounted and stays closed (BH-14).
  const publishedId = wizard.state === 'ready' && wizard.draft?.status === 'published' ? wizard.draft.id : null;
  useEffect(() => {
    if (publishedId) toPublished(publishedId);
  }, [publishedId, toPublished]);
  if (wizard.state !== 'ready' || !wizard.draft || publishedId) {
    const state = wizard.state === 'ready' ? (publishedId ? 'loading' : 'gone') : wizard.state;
    return (
      <WizardFrame
        step="review"
        draftId={wizard.draftId}
        reached={wizard.reached}
        preview={preview}
        ready={false}
        still={wizard.state === 'loading' || publishedId !== null}
        bare={state === 'gone'}
        dirty={false}
      >
        <WizardStateBody
          state={state}
          step="review"
          draftId={wizard.draftId}
          onRetry={() => void wizard.query.refetch()}
          retrying={wizard.query.isFetching}
        />
      </WizardFrame>
    );
  }
  return <ReviewStep key={wizard.draft.id} draft={wizard.draft} reached={wizard.reached} restriction={wizard.restriction} />;
}

function ReviewStep({ draft, reached, restriction }: { draft: GarageVehicle; reached: number; restriction: string | null }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const largeFont = useStacksAtFontScale();
  const close = useCloseModal();
  const publish = usePublishVehicle(draft.id);
  const changeVisibility = useChangeVisibility(draft.id);
  const counts = usePhotoCounts(draft);
  const preview = usePreview(draft);
  const mounted = useMountedRef();
  // The choice saves when it is made (BH-08), so every way out keeps it. It shows at once; a failure goes back to what is stored.
  const [choice, setChoice] = useState<Visibility | null>(null);
  const [saving, setSaving] = useState(false);
  const wanted = useRef<Visibility | null>(null);
  const sending = useRef(false);
  const visibility = choice ?? (isVisibility(draft.visibility) ? draft.visibility : 'public');
  // One key per publish intent: a retry after a lost answer keeps it, unless the choice changed. That is safe because the server
  // answers a publish of an already published vehicle with 200 and the vehicle, under any key (ADR-176 a), and the changed choice
  // has saved on its own.
  const publishAttempt = useRef<{ key: string; visibility: Visibility } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverMissing, setServerMissing] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);
  const missing = missingForPublish(draft);
  const locked = restriction !== null;

  useEffect(() => {
    if (leaving) close();
  }, [close, leaving]);

  // Back to an earlier step of this wizard: it is in the stack below, or replaces this one after a direct link.
  const edit = (step: WizardStep) => router.dismissTo(wizardPath(draft.id, step));

  /** Sends the latest pick; a pick made while one is on its way follows it, so the last one is what stays. */
  const saveChoice = async (next: Visibility) => {
    wanted.current = next;
    if (sending.current) return;
    sending.current = true;
    setSaving(true);
    try {
      let sent: Visibility | null = null;
      while (wanted.current !== null && wanted.current !== sent) {
        sent = wanted.current;
        await changeVisibility.mutateAsync(sent);
      }
    } catch (error) {
      const message = saveErrorMessage(t, error);
      if (mounted.current) {
        setChoice(null);
        setNotice(message);
      } else {
        toast(message, { testID: 'GAR-03.toast' });
      }
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };

  const pick = (next: Visibility) => {
    // Under a restriction public and unlisted answer 403: an unchanged value is never sent.
    if (next === visibility) return;
    setNotice(null);
    if (!online) {
      setNotice(saveErrorMessage(t, networkError()));
      return;
    }
    setChoice(next);
    void saveChoice(next);
  };

  const submit = () => {
    setNotice(null);
    setServerMissing([]);
    if (missing.length > 0) {
      setNotice(t('review.incomplete'));
      return;
    }
    if (publishAttempt.current?.visibility !== visibility) publishAttempt.current = { key: newIdempotencyKey(), visibility };
    publish.mutate(
      { visibility, idempotencyKey: publishAttempt.current.key },
      {
        // Success needs nothing here: the answer is the published vehicle in the cache, and the screen above goes to GAR-04.
        onError: (error) => {
          // Only an answer that refuses this publish makes the next attempt a new intent. No answer, a 429, a 5xx or a 401 says
          // nothing about whether the first one landed, so the retry keeps its key (as createOnce).
          if (!mayStillLand(error)) publishAttempt.current = null;
          if (error instanceof ApiError && error.code === 'email_not_verified') {
            router.push('/verify-email');
            return;
          }
          if (error instanceof ApiError && error.code === 'vehicle_incomplete') {
            setServerMissing(Object.values(error.fieldErrors).flatMap((messages) => [...messages]));
            setNotice(error.message);
            return;
          }
          setNotice(saveErrorMessage(t, error, { creating: true }));
        },
      },
    );
  };

  const subline = [draft.model_year ? String(draft.model_year) : null, draft.generation].filter(Boolean).join(' · ');
  const photoLine = counts.pending ? t('review.photosUploading') : t('review.photoCount', { count: counts.ready });

  return (
    <WizardFrame
      step="review"
      draftId={draft.id}
      reached={reached}
      preview={preview}
      dirty={false}
      cta={{ label: t('review.publish'), onPress: submit, loading: publish.isPending || saving, disabled: locked || !online }}
      secondary={{
        label: t('wizard.saveDraft'),
        onPress: () => {
          toast(t('wizard.draftSaved'), { testID: 'GAR-03.toast' });
          setLeaving(true);
        },
        disabled: publish.isPending || saving,
        testID: 'GAR-03.review.saveDraft',
      }}
    >
      {locked && restriction ? <RestrictedNotice message={restriction} testID="GAR-03.restricted" /> : null}
      {notice ? <FormNotice message={notice} testID="GAR-03.notice" /> : null}
      <VehicleCard
        title={draft.full_title.trim() || t('wizard.untitled')}
        subtitle={draft.subline_parts.slice(0, 2).join(' · ') || undefined}
        photo={photoFields(draft.cover, CARD_PHOTO_WIDTH)}
        specs={specChips(draft)}
        testID="GAR-03.review.card"
      />
      {missing.length > 0 || serverMissing.length > 0 ? (
        <FormGroup title={t('review.missingTitle')} testID="GAR-03.review.missing">
          <View style={styles.missing}>
            <RowCard>
              {missing.map((item, index) => (
                <ListRow
                  key={item}
                  icon="warning"
                  title={t(`review.missing.${item}`)}
                  value={t('review.add')}
                  adaptiveValue
                  onPress={() => edit(stepFor(item))}
                  inset={space[16]}
                  divider={index < missing.length - 1 || serverMissing.length > 0}
                  testID={`GAR-03.review.missing.${item}`}
                />
              ))}
              {serverMissing.map((message, index) => (
                <ListRow key={message} icon="warning" title={message} inset={space[16]} divider={index < serverMissing.length - 1} />
              ))}
            </RowCard>
          </View>
        </FormGroup>
      ) : null}
      <FormGroup title={t('review.summaryTitle')}>
        <RowCard testID="GAR-03.review.summary">
          <ListRow
            icon="garage"
            title={t('wizard.steps.vehicle')}
            subtitle={[keepNameTogether(draft.full_title.trim()), subline].filter(Boolean).join(' · ') || t('review.empty')}
            value={t('review.edit')}
            adaptiveValue
            onPress={() => edit('vehicle')}
            inset={space[16]}
            divider
            testID="GAR-03.review.vehicle"
          />
          <ListRow
            icon="engine"
            title={t('wizard.steps.specs')}
            subtitle={keepValuesTogether(specChips(draft).join(' · '), !largeFont) || t('review.noSpecs')}
            value={t('review.edit')}
            adaptiveValue
            onPress={() => edit('specs')}
            inset={space[16]}
            divider
            testID="GAR-03.review.specs"
          />
          <ListRow
            icon="image"
            title={t('wizard.steps.photos')}
            subtitle={photoLine}
            value={t('review.edit')}
            adaptiveValue
            onPress={() => edit('photos')}
            inset={space[16]}
            testID="GAR-03.review.photos"
          />
        </RowCard>
      </FormGroup>
      <FormGroup title={t('visibility.label')}>
        <VisibilityChoice value={visibility} onChange={pick} disabled={publish.isPending} onlyPrivate={locked} testID="GAR-03.review.visibility" />
      </FormGroup>
    </WizardFrame>
  );
}
