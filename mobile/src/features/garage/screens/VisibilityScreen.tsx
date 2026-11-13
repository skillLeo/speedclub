import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useChangeVisibility, type GarageVehicle, type Visibility } from '@/api/queries/garage';
import { usePublicVehicle } from '@/api/queries/vehicles';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { KnownTextSkeleton } from '@/features/vehicle/components/KnownTextSkeleton';
import { RowCard } from '@/features/vehicle/components/RowCard';
import { useVehicleShare } from '@/features/vehicle/share';
import { textSkeleton } from '@/features/vehicle/skeletonGeometry';
import { useOnline } from '@/state/online';
import { createStyles, size, space, useTheme } from '@/theme';
import { Hairline, ListRow, Skeleton, SkeletonBlock, SkeletonText, Text, toast } from '@/ui';
import { SECTION_HEADER_ROLE } from '@/ui/RowGroup';

import { FormGroup } from '../components/fields';
import { EditorForm, EditorScreen, FORM_MAX_WIDTH, RestrictedNotice } from '../components/frames';
import { OwnerOnQrSetting, OwnerOnQrSkeletonRow } from '../components/OwnerOnQrSetting';
import { PlateReminder } from '../components/PlateReminder';
import { VisibilityChoice } from '../components/VisibilityChoice';
import { saveErrorMessage } from '../errors';
import { isVisibility, VISIBILITIES } from '../model';
import { useOwnVehicle, type KnownVehicle } from '../useOwnVehicle';

const ROUTE = 'GAR-12';
/** VisibilityChoice: a description starts under its radio's label, after the 22 box and the 12 before the label. */
const RADIO_TEXT_INSET = size.checkbox + space[12];

const useStyles = createStyles((t) => ({
  reminder: { alignItems: 'flex-start', backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, flexDirection: 'row', gap: t.space[12], padding: t.space[16] },
  reminderText: { flex: 1, gap: t.space[4] },
  // The skeleton in EditorForm's column and FormGroup's rhythm, on the same cards as the page (frames.tsx, fields.tsx).
  skeletonColumn: { alignSelf: 'flex-start', gap: t.space[24], maxWidth: FORM_MAX_WIDTH, width: '100%' },
  skeletonGroup: { gap: t.space[16], marginTop: t.space[8] },
  skeletonEyebrow: { marginBottom: t.space[8] - t.space[16] },
  skeletonCard: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  radioRow: { gap: t.space[2], paddingBottom: t.space[12], paddingHorizontal: t.space[12], paddingTop: t.space[4] },
  radioLine: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.touchMin },
  // A spacer and not a padding, as in VisibilityChoice: the inset is off the spacing scale by design.
  radioBodyRow: { flexDirection: 'row' },
  radioInset: { width: RADIO_TEXT_INSET },
  radioBody: { flex: 1, minWidth: 0 },
  listRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single, paddingHorizontal: t.space[16], paddingVertical: t.space[8] },
  listRowText: { flex: 1, minWidth: 0 },
  listRowChevron: { width: t.size.icon.s },
}));

/**
 * GAR-12 /garage/[id]/visibility: Öffentlich · Nicht gelistet · Privat, sharing the public page, "Besitzer auf der QR-Seite"
 * for the whole account (saved at once, apart from the form's Speichern), and the reminder about plates and people in the
 * photos.
 */
export function VisibilityScreen() {
  const { t } = useTranslation('garage');
  const own = useOwnVehicle(ROUTE, { path: 'visibility', loading: (known) => <VisibilitySkeleton known={known} /> });
  return (
    <EditorScreen routeId={ROUTE} title={t('visibility.title')} fallback={own.id ? `/garage/${own.id}` : '/garage'} offlineLabel={t('offline.editor')}>
      {own.state ?? (own.vehicle ? <VisibilityForm key={own.vehicle.id} vehicle={own.vehicle} restriction={own.restriction} /> : null)}
    </EditorScreen>
  );
}

function VisibilityForm({ vehicle, restriction }: { vehicle: GarageVehicle; restriction: string | null }) {
  const { t } = useTranslation('garage');
  const router = useRouter();
  const online = useOnline();
  const change = useChangeVisibility(vehicle.id);
  const page = usePublicVehicle(vehicle.status === 'published' ? vehicle.slug : undefined);
  const { share, copy, sharing } = useVehicleShare(ROUTE);
  const stored: Visibility = isVisibility(vehicle.visibility) ? vehicle.visibility : 'public';
  const [value, setValue] = useState<Visibility>(stored);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = value !== stored;
  const locked = restriction !== null;
  const shareable = vehicle.status === 'published' && stored !== 'private' && page.data;

  useEffect(() => {
    if (!saved) return;
    if (router.canGoBack()) router.back();
    else router.replace(`/garage/${vehicle.id}`);
  }, [router, saved, vehicle.id]);

  const submit = () => {
    setNotice(null);
    change.mutate(value, {
      onSuccess: (next) => {
        const message = next.status === 'draft' ? t('visibility.savedDraft') : t(`visibility.saved.${isVisibility(next.visibility) ? next.visibility : 'public'}`);
        toast(message, { haptic: 'success', testID: `${ROUTE}.saved` });
        setSaved(true);
      },
      onError: (error) => setNotice(saveErrorMessage(t, error)),
    });
  };

  return (
    <EditorForm
      routeId={ROUTE}
      dirty={dirty && !change.isPending && !saved}
      cta={{ label: t('editor.save'), onPress: submit, loading: change.isPending, disabled: !online || !dirty }}
    >
      {locked && restriction ? <RestrictedNotice message={t('visibility.restricted')} testID={`${ROUTE}.restricted`} /> : null}
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
      {/* DQ-176: not "Sichtbarkeit" again under the title; this group is the one vehicle, the next one all of them. */}
      <FormGroup title={t('visibility.thisVehicleGroup')}>
        {vehicle.status === 'draft' ? (
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.draftNote`}>
            {t('visibility.draftNote')}
          </Text>
        ) : null}
        <VisibilityChoice value={value} onChange={setValue} disabled={change.isPending} onlyPrivate={locked} testID={`${ROUTE}.choice`} />
      </FormGroup>
      <OwnerOnQrSetting routeId={ROUTE} />
      {shareable && page.data ? (
        <FormGroup title={t('visibility.shareGroup')}>
          <RowCard testID={`${ROUTE}.share`}>
            <ListRow icon="link" title={t('owner.copyLink')} role="button" chevron={false} onPress={() => page.data && void copy(page.data)} inset={space[16]} divider testID={`${ROUTE}.copy`} />
            <ListRow
              icon="share-network"
              title={t('owner.share')}
              role="button"
              chevron={false}
              disabled={sharing}
              onPress={() => page.data && void share(page.data)}
              inset={space[16]}
              divider={Boolean(vehicle.qr)}
              testID={`${ROUTE}.shareLink`}
            />
            {vehicle.qr ? <ListRow icon="qr-code" title={t('owner.qr')} onPress={() => router.push(`/qr/${vehicle.id}`)} inset={space[16]} testID={`${ROUTE}.qr`} /> : null}
          </RowCard>
        </FormGroup>
      ) : null}
      <PlateReminder testID={`${ROUTE}.plateReminder`} />
      <RowCard>
        <ListRow icon="image" title={t('visibility.checkPhotos')} onPress={() => router.push(`/garage/${vehicle.id}/photos`)} inset={space[16]} testID={`${ROUTE}.photos`} />
      </RowCard>
    </EditorForm>
  );
}

/** A 56 list row of the skeleton: the 20 icon and the label as long as the real one, on a card's 16 inset. */
function SkeletonListRow({ label, chevron = false }: { label: string; chevron?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.listRow}>
      <SkeletonBlock width={size.icon.m} height={size.icon.m} />
      <KnownTextSkeleton text={label} variant="body" style={styles.listRowText} />
      {chevron ? <View style={styles.listRowChevron} /> : null}
    </View>
  );
}

/**
 * DQ-207: GAR-12 loads in its own shape, on the same cards as the page: the three radio rows with what each means, the owner
 * switch row (OwnerOnQrSetting's own skeleton row), the share card (once the vehicle is public or unlisted and published,
 * its QR row when it has a code), the plate reminder and "Fotos prüfen". Each text takes the lines and the length its real
 * copy takes at this width and font scale (DQ-214: measured, not estimated).
 */
function VisibilitySkeleton({ known }: { known: KnownVehicle }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const { fontScale } = useTheme();
  const [width, setWidth] = useState(0);
  const vehicle = known.vehicle ?? known.card;
  const shareable = !vehicle || (vehicle.status === 'published' && vehicle.visibility !== 'private');
  const withQr = !vehicle || Boolean(vehicle.qr);
  // The header's own role and width (ADR-426 e), so the skeleton line is as long as the header it stands for.
  const eyebrow = (key: string) => textSkeleton(t(key), SECTION_HEADER_ROLE, fontScale, width).width;
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.skeletonColumn} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={styles.skeletonGroup}>
          <SkeletonText variant={SECTION_HEADER_ROLE} width={eyebrow('visibility.thisVehicleGroup')} style={styles.skeletonEyebrow} testID={`${ROUTE}.skeleton.header.thisVehicle`} />
          {vehicle?.status === 'draft' ? <KnownTextSkeleton text={t('visibility.draftNote')} variant="callout" /> : null}
          <View style={styles.skeletonCard} testID={`${ROUTE}.skeleton.choice`}>
            {VISIBILITIES.map((option, index) => (
              <View key={option}>
                <View style={styles.radioRow}>
                  <View style={styles.radioLine}>
                    <SkeletonBlock width={size.checkbox} height={size.checkbox} corner="full" />
                    <KnownTextSkeleton text={t(`visibility.options.${option}.title`)} variant="body" style={styles.radioBody} />
                  </View>
                  <View style={styles.radioBodyRow}>
                    <View style={styles.radioInset} />
                    <KnownTextSkeleton text={t(`visibility.options.${option}.body`)} variant="callout" style={styles.radioBody} />
                  </View>
                </View>
                {index < VISIBILITIES.length - 1 ? <Hairline /> : null}
              </View>
            ))}
          </View>
        </View>
        <View style={styles.skeletonGroup}>
          <SkeletonText variant={SECTION_HEADER_ROLE} width={eyebrow('visibility.ownerOnQr.group')} style={styles.skeletonEyebrow} testID={`${ROUTE}.skeleton.header.ownerOnQr`} />
          <View style={styles.skeletonCard} testID={`${ROUTE}.skeleton.ownerOnQr`}>
            <OwnerOnQrSkeletonRow />
          </View>
        </View>
        {shareable ? (
          <View style={styles.skeletonGroup}>
            <SkeletonText variant={SECTION_HEADER_ROLE} width={eyebrow('visibility.shareGroup')} style={styles.skeletonEyebrow} testID={`${ROUTE}.skeleton.header.share`} />
            <View style={styles.skeletonCard}>
              <SkeletonListRow label={t('owner.copyLink')} />
              <SkeletonListRow label={t('owner.share')} />
              {withQr ? <SkeletonListRow label={t('owner.qr')} chevron /> : null}
            </View>
          </View>
        ) : null}
        <View style={styles.reminder}>
          <SkeletonBlock width={size.icon.m} height={size.icon.m} />
          <View style={styles.reminderText}>
            <KnownTextSkeleton text={t('visibility.plateTitle')} variant="bodyStrong" />
            <KnownTextSkeleton text={t('visibility.plateBody')} variant="callout" />
          </View>
        </View>
        <View style={styles.skeletonCard}>
          <SkeletonListRow label={t('visibility.checkPhotos')} chevron />
        </View>
      </View>
    </Skeleton>
  );
}
