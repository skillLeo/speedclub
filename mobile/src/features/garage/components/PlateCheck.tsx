import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import {
  plateCheckCount,
  plateCheckOpen,
  useBlurCheckedPhoto,
  useDismissPlateCheck,
  useKeepPhoto,
  usePlateCheck,
  type PlateCheckItem,
} from '@/api/queries/plateCheck';
import { defaultChoice, uploadRegions, type PlateBlurChoice } from '@/features/media/plateBlur/model';
import { PlateBlurEditor } from '@/features/media/plateBlur/PlateBlurEditor';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { createStyles, size } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { Icon } from '@/ui/icons/Icon';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { Sheet } from '@/ui/Sheet';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';

import { RestrictedNotice } from './frames';

const ROUTE = 'GAR-01';
/** The check's photos keep their shape, between a portrait 3:4 and a wide 16:9, so a plate is judged on the real crop. */
const RATIO_MIN = 3 / 4;
const RATIO_MAX = 16 / 9;
const SKELETON_ROWS = 2;
const CARD_THUMBS = 3;

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.space[16] },
  cardHead: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  cardTitle: { flex: 1 },
  thumbs: { flexDirection: 'row', gap: t.space[4] },
  thumb: { aspectRatio: 1, borderRadius: t.radius.sm, width: t.size.thumb.row },
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  // DQ-P5G-15: a photo's two choices stacked on the text's edge, the tertiary flush with it.
  itemActions: { alignItems: 'flex-start', gap: t.space[4] },
  list: { gap: t.space[16], paddingBottom: t.space[16] },
  intro: { gap: t.space[4] },
  row: { gap: t.space[12] },
  photo: { borderRadius: t.radius.md, width: '100%' },
  rowText: { gap: t.space[2] },
  done: { gap: t.space[12], paddingBottom: t.space[16] },
  footer: { gap: t.space[8] },
}));

/** Whether GAR-01 shows the card: the member's unchecked photos exist and "Später" was not chosen (contract §4). */
export function usePlateCheckCard(enabled: boolean) {
  const query = usePlateCheck(enabled);
  return { visible: enabled && plateCheckOpen(query.data), count: plateCheckCount(query.data), items: query.data?.pages[0]?.data ?? [] };
}

export type PlateCheckCardProps = {
  count: number;
  items: readonly PlateCheckItem[];
  onOpen: () => void;
  disabled?: boolean;
};

/**
 * GAR-01 "Kennzeichen prüfen" (10 §16.1): once, calm, no warning tone. A few of the photos in question, what is new, and the
 * choice: look at them now, or later ("Später" ends the prompt for good; single photos stay editable in GAR-08).
 */
export function PlateCheckCard({ count, items, onOpen, disabled = false }: PlateCheckCardProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const dismiss = useDismissPlateCheck();
  const later = () =>
    dismiss.mutate(undefined, {
      onSuccess: () => toast(t('plateCheck.laterDone'), { testID: `${ROUTE}.plateCheck.toast` }),
      onError: (error) => toast(error instanceof ApiError ? error.message : t('plateCheck.failed'), { testID: `${ROUTE}.plateCheck.toast` }),
    });
  return (
    <View style={styles.card} testID={`${ROUTE}.plateCheck.card`}>
      <View style={styles.cardHead}>
        <Icon name="eye-slash" size={20} color="text.secondary" />
        <Text variant="headline" role="heading" style={styles.cardTitle}>
          {t('plateCheck.title')}
        </Text>
      </View>
      <Text variant="callout" color="text.secondary" testID={`${ROUTE}.plateCheck.body`}>
        {t('plateCheck.body', { count })}
      </Text>
      {items.length > 0 ? (
        <View style={styles.thumbs} aria-hidden>
          {items.slice(0, CARD_THUMBS).map((item) => (
            <CardThumb key={item.media_id} item={item} />
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button label={t('plateCheck.open')} variant="secondary" size="m" onPress={onOpen} disabled={disabled} testID={`${ROUTE}.plateCheck.open`} />
        <Button
          label={t('plateCheck.later')}
          variant="tertiary"
          size="m"
          onPress={later}
          loading={dismiss.isPending}
          disabled={disabled}
          testID={`${ROUTE}.plateCheck.later`}
        />
      </View>
    </View>
  );
}

function CardThumb({ item }: { item: PlateCheckItem }) {
  const styles = useStyles();
  const placeholder = useImagePlaceholder(item.image.blurhash, 'cover', item.image.thumbhash);
  return <Image source={{ uri: item.image.url }} {...placeholder} contentFit="cover" recyclingKey={item.media_id} accessible={false} style={styles.thumb} />;
}

export type PlateCheckSheetProps = {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  /** Restricted from publishing: blurring and keeping answer 403 (contract §4), so both stay off with the reason. */
  restriction: string | null;
};

/**
 * The list of unchecked photos, each with "Unkenntlich machen" (the plate blur editor in GAR-08 mode, then `PATCH media/{id}`)
 * and "Kein Kennzeichen sichtbar" (`decision: keep`). One sheet: the editor replaces the list while one photo is open.
 * The pages are 25 photos each; "Weitere Fotos laden" asks for the next.
 */
export function PlateCheckSheet({ visible, onClose, online, restriction }: PlateCheckSheetProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const qaState = useQaState();
  const query = usePlateCheck(visible);
  const keep = useKeepPhoto();
  const blur = useBlurCheckedPhoto();
  const [editing, setEditing] = useState<PlateCheckItem | null>(null);
  const [choice, setChoice] = useState<PlateBlurChoice>(defaultChoice);
  const [edited, setEdited] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState<'back' | 'close' | null>(null);
  const testID = `${ROUTE}.plateCheck`;
  const offline = !online || qaState === 'offline';
  // useGarageAccess already turns qaState=restricted into the reason.
  const restricted = restriction;
  const locked = offline || restricted !== null;
  const items = qaState === 'empty' ? [] : (query.data?.pages.flatMap((page) => page.data) ?? []);

  const open = (item: PlateCheckItem) => {
    setEditing(item);
    setChoice(defaultChoice());
    setEdited(false);
  };
  const back = () => {
    setEditing(null);
    setEdited(false);
    setConfirming(false);
  };
  const leave = (how: 'back' | 'close') => {
    if (editing && edited && !blur.isPending) {
      setDiscarding(how);
      return;
    }
    if (how === 'close') {
      back();
      onClose();
    } else back();
  };

  const keepPhoto = (item: PlateCheckItem) =>
    keep.mutate(item.media_id, {
      onSuccess: () => toast(t('plateCheck.kept'), { testID: `${testID}.toast` }),
      onError: (error) => {
        haptics.error();
        toast(error instanceof ApiError ? error.message : t('plateCheck.failed'), { testID: `${testID}.toast` });
      },
    });

  const applyBlur = () => {
    if (!editing) return;
    blur.mutate(
      { item: editing, regions: uploadRegions(choice) },
      {
        onSuccess: () => {
          haptics.success();
          toast(t('plateCheck.blurred'), { testID: `${testID}.toast` });
          back();
        },
        onError: (error) => {
          setConfirming(false);
          haptics.error();
          toast(error instanceof ApiError ? error.message : t('plateCheck.failed'), { testID: `${testID}.toast` });
        },
      },
    );
  };

  let body;
  if (editing) {
    body = (
      <PlateBlurEditor
        photo={{ uri: editing.image.url, width: editing.image.width, height: editing.image.height, thumbhash: editing.image.thumbhash, blurhash: editing.image.blurhash }}
        value={choice}
        onChange={(next) => {
          setEdited(true);
          setChoice(next);
        }}
        mode="existing"
        disabled={locked || blur.isPending}
        testID={`${testID}.editor`}
      />
    );
  } else if (qaState === 'loading' || (query.isPending && query.fetchStatus !== 'paused')) {
    body = <PlateCheckSkeleton />;
  } else if (qaState === 'error' || (query.isError && items.length === 0) || (!query.data && query.fetchStatus === 'paused')) {
    body = (
      <ErrorState
        title={t('plateCheck.loadErrorTitle')}
        message={offline ? t('plateCheck.offline') : t('plateCheck.loadErrorBody')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${testID}.error`}
      />
    );
  } else if (items.length === 0) {
    body = (
      <View style={styles.done} testID={`${testID}.done`}>
        <Text variant="body">{t('plateCheck.allDone')}</Text>
      </View>
    );
  } else {
    body = (
      <View style={styles.list} testID={`${testID}.list`}>
        <View style={styles.intro}>
          <Text variant="callout" color="text.secondary">
            {t('plateCheck.intro')}
          </Text>
        </View>
        {items.map((item, index) => (
          <View key={item.media_id} style={styles.row} testID={`${testID}.item.${item.media_id}`}>
            {index > 0 ? <Hairline /> : null}
            <CheckPhoto item={item} />
            <View style={styles.rowText}>
              <Text variant="bodyStrong">{item.vehicle?.name ?? t('plateCheck.kind.cover')}</Text>
              <Text variant="caption" color="text.secondary">
                {t(`plateCheck.kind.${item.kind}`)}
              </Text>
            </View>
            <View style={styles.itemActions}>
              <Button
                label={t('plateCheck.blur')}
                variant="secondary"
                size="s"
                icon="eye-slash"
                disabled={locked}
                onPress={() => open(item)}
                testID={`${testID}.item.${item.media_id}.blur`}
              />
              <Button
                label={t('plateCheck.keep')}
                variant="tertiary"
                size="s"
                flush="start"
                disabled={locked || (keep.isPending && keep.variables === item.media_id)}
                onPress={() => keepPhoto(item)}
                testID={`${testID}.item.${item.media_id}.keep`}
              />
            </View>
          </View>
        ))}
        {query.hasNextPage ? (
          <Button
            label={t('plateCheck.more')}
            variant="tertiary"
            size="m"
            flush="start"
            loading={query.isFetchingNextPage}
            onPress={() => void query.fetchNextPage()}
            testID={`${testID}.more`}
          />
        ) : null}
      </View>
    );
  }

  const footer = editing ? (
    <View style={styles.footer}>
      <Button
        label={t('plateCheck.apply')}
        fullWidth
        icon="eye-slash"
        disabled={locked || choice.regions.length === 0}
        loading={blur.isPending}
        onPress={() => setConfirming(true)}
        testID={`${testID}.editor.apply`}
      />
      <Button label={t('plateCheck.back')} variant="tertiary" fullWidth disabled={blur.isPending} onPress={() => leave('back')} testID={`${testID}.editor.back`} />
    </View>
  ) : undefined;

  return (
    <>
      <Sheet
        visible={visible}
        onClose={() => leave('close')}
        title={editing ? t('plateCheck.editTitle') : t('plateCheck.title')}
        initialSnap="full"
        footer={footer}
        testID={`${testID}.sheet`}
      >
        {offline ? <OfflineBanner label={t('plateCheck.offline')} testID={`${testID}.offline`} /> : null}
        {restricted ? <RestrictedNotice message={restricted} testID={`${testID}.restricted`} /> : null}
        {body}
      </Sheet>
      <Dialog
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={t('blur.confirmTitle')}
        body={t('blur.confirmBody')}
        testID={`${testID}.confirm`}
        actions={[
          { label: t('common.cancel'), variant: 'secondary', onPress: () => setConfirming(false), testID: `${testID}.confirm.cancel` },
          { label: t('blur.confirm'), destructive: true, loading: blur.isPending, onPress: applyBlur, testID: `${testID}.confirm.apply` },
        ]}
      />
      <Dialog
        visible={discarding !== null}
        onClose={() => setDiscarding(null)}
        title={t('plateCheck.discardTitle')}
        body={t('plateCheck.discardBody')}
        testID={`${testID}.discard`}
        actions={[
          { label: t('plateCheck.discardKeep'), variant: 'secondary', onPress: () => setDiscarding(null), testID: `${testID}.discard.keep` },
          {
            label: t('plateCheck.discard'),
            destructive: true,
            onPress: () => {
              const how = discarding;
              setDiscarding(null);
              back();
              if (how === 'close') onClose();
            },
            testID: `${testID}.discard.confirm`,
          },
        ]}
      />
    </>
  );
}

function CheckPhoto({ item }: { item: PlateCheckItem }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const placeholder = useImagePlaceholder(item.image.blurhash, 'cover', item.image.thumbhash);
  const raw = item.image.width > 0 && item.image.height > 0 ? item.image.width / item.image.height : 4 / 3;
  const ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, raw));
  return (
    <Image
      source={{ uri: item.image.url }}
      {...placeholder}
      contentFit="cover"
      recyclingKey={item.media_id}
      accessibilityLabel={t('plateCheck.photoLabel', { name: item.vehicle?.name ?? t('plateCheck.kind.cover') })}
      style={[styles.photo, { aspectRatio: ratio }]}
      testID={`${ROUTE}.plateCheck.item.${item.media_id}.photo`}
    />
  );
}

/** Same geometry as the list: the intro line, then photo, two text lines and the two actions per row. */
function PlateCheckSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton style={styles.list} testID={`${ROUTE}.plateCheck.skeleton`}>
      <SkeletonText variant="callout" lines={2} lastLineWidth="60%" />
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <View key={index} style={styles.row}>
          <SkeletonBlock aspectRatio={4 / 3} corner="md" />
          <View style={styles.rowText}>
            <SkeletonText variant="bodyStrong" width="50%" />
            <SkeletonText variant="caption" width="30%" />
          </View>
          <View style={styles.itemActions}>
            <SkeletonBlock width="45%" height={size.button.s} corner="sm" />
            <SkeletonBlock width="40%" height={size.button.s} corner="sm" />
          </View>
        </View>
      ))}
    </Skeleton>
  );
}
