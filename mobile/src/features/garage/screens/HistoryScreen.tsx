import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { newIdempotencyKey } from '@/api/client';
import { useAddNote, useHideUpdate, useOwnerUpdates, useVehicle, type OwnerUpdate } from '@/api/queries/garage';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { HISTORY_CHANGES_SHOWN } from '@/features/vehicle/components/ProfileSections';
import { changeLines, historyMetaLine, historyTitle } from '@/features/vehicle/model';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { keepFiguresTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, useBreakpoint } from '@/theme';
import {
  Button,
  Dialog,
  EmptyState,
  Header,
  IconButton,
  Screen,
  Sheet,
  Skeleton,
  SkeletonText,
  StatusPill,
  Text,
  TextInput,
  TimelineMonth,
  TimelineRow,
  toast,
  type HeaderAction,
  type TimelineEntry,
} from '@/ui';
import { WEB_HAIRLINE } from '@/ui/specStripLayout';

import { useCharCount } from '../components/fields';
import { FORM_MAX_WIDTH, GoneState, LoadErrorState, RestrictedNotice, SignInState, useGarageAccess, usePushedHeaderWidth } from '../components/frames';
import { isGone, isKeyReused, saveErrorMessage } from '../errors';
import { fieldMessage, NOTE_MAX_LENGTH, noteSchema } from '../schemas';

const ROUTE = 'GAR-11';
/** Timeline's spine: a device hairline on native, the web's 1 px. */
const SPINE = isWeb ? WEB_HAIRLINE : StyleSheet.hairlineWidth;
const EDGES: readonly Edge[] = ['left', 'right'];
const NOTE_ROWS = 6;

type Row = { kind: 'month'; label: string; first: boolean } | { kind: 'entry'; update: OwnerUpdate; first: boolean; last: boolean };

/** Newest first, one group per month as VEH-01's Verlauf ("März 2023"). */
export function historyRows(updates: readonly OwnerUpdate[]): Row[] {
  const rows: Row[] = [];
  let month: string | null = null;
  let groupStart = 0;
  updates.forEach((update) => {
    const label = update.month_label ?? '';
    if (label !== month) {
      if (rows.length > 0) {
        const previous = rows[rows.length - 1];
        if (previous?.kind === 'entry') previous.last = true;
      }
      rows.push({ kind: 'month', label, first: month === null });
      month = label;
      groupStart = rows.length;
    }
    rows.push({ kind: 'entry', update, first: rows.length === groupStart, last: false });
  });
  const tail = rows[rows.length - 1];
  if (tail?.kind === 'entry') tail.last = true;
  return rows;
}

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  // DQ-156: from 768 the column starts on the gutter under back (frames.tsx usePushedHeaderWidth).
  column: { alignSelf: 'flex-start', maxWidth: FORM_MAX_WIDTH, width: '100%' },
  top: { gap: t.space[16], paddingBottom: t.space[8], paddingTop: t.space[16] },
  month: { paddingBottom: t.space[12], paddingTop: t.space[24] },
  // The skeleton's piece of VEH-01's Timeline spine (the entries themselves are ui/TimelineRow, DQ-1072).
  card: { borderLeftColor: t.color.border.default, borderLeftWidth: SPINE, marginLeft: t.space[4] },
  first: { marginTop: t.space[8] },
  last: { paddingBottom: t.space[8] },
  text: { gap: t.space[2], paddingLeft: t.space[16], paddingRight: t.space[8], paddingVertical: t.space[12] },
  end: { paddingBottom: t.space[32] },
  more: { alignItems: 'center', paddingTop: t.space[16] },
  sheetBody: { gap: t.space[16], paddingBottom: t.space[8] },
}));

type EntryProps = { update: OwnerUpdate; first: boolean; last: boolean; onToggle: (update: OwnerUpdate) => void; onOpen: (update: OwnerUpdate) => void; disabled: boolean };

/**
 * DQ-1072: one entry of the owner's Verlauf in VEH-01's Timeline anatomy (ui/TimelineRow: spine, node, `headline` title, changes,
 * note, meta) with the owner's eye in Timeline's trailing slot. A hidden entry is dimmed and says so.
 */
const Entry = memo(function Entry({ update, first, last, onToggle, onOpen, disabled }: EntryProps) {
  const { t } = useTranslation('garage');
  const vehicleT = useTranslation('vehicle').t;
  const format = useFormat();
  const created = update.created_at ? format.relative(new Date(update.created_at)) : null;
  const note = update.type === 'note';
  // DQ-175: as VEH-01's Verlauf, each change under its own label ("Fahrwerk: Serie → KW V3"). DQ-1059: an entry with one named
  // change takes VEH-01's title ("AP Racing Radi-CAL statt Brembo Serie") and only the system and key value under it ("Bremsen ·
  // 356 mm"), so the kind is printed once. A note is titled by its own text, never "Notiz" (DQ-1085).
  const named = note ? null : historyMetaLine(update);
  const { lines, more } = note || named ? { lines: [], more: 0 } : changeLines(update, HISTORY_CHANGES_SHOWN);
  const noteText = note ? (update.note ?? update.summary)?.trim() || null : null;
  const head = note ? t('history.note') : update.type_label;
  const title = named
    ? historyTitle(update, (key, values) => vehicleT(`history.title.${key}`, values))
    : (noteText ?? (lines.length > 0 ? head : null) ?? head);
  // The toggle hides the whole entry: it takes the name of a change only when that is all there is, else the kind and its date.
  const onlyChange = named ? title : lines.length === 1 && more === 0 ? lines[0]?.label : undefined;
  const toggleName = onlyChange ?? [head, created].filter(Boolean).join(', ');
  const summary = lines.length > 0 || named || note ? null : keepFiguresTogether(update.summary, true);
  const added = note ? null : update.note?.trim();
  const entry: TimelineEntry = {
    key: update.id,
    date: update.month_label ?? '',
    title,
    lines: named
      ? [{ key: 'named', label: named.label, detail: named.diff ?? undefined, inline: true }]
      : lines.map((line) => ({ key: line.key, label: line.label, detail: line.diff ?? undefined })),
    note: [summary, added].filter(Boolean).join('\n') || undefined,
    more: more > 0 ? vehicleT('history.moreChanges', { count: more }) : undefined,
    meta: created ?? undefined,
    dimmed: update.hidden,
    status: update.hidden ? <StatusPill label={t('history.hidden')} testID={`${ROUTE}.entry.${update.id}.hidden`} /> : undefined,
    trailing: (
      <IconButton
        icon={update.hidden ? 'eye' : 'eye-slash'}
        label={update.hidden ? t('history.show', { entry: toggleName }) : t('history.hide', { entry: toggleName })}
        color="text.secondary"
        disabled={disabled}
        onPress={() => onToggle(update)}
        testID={`${ROUTE}.entry.${update.id}.toggle`}
      />
    ),
    onPress: update.hidden ? undefined : () => onOpen(update),
    testID: `${ROUTE}.entry.${update.id}`,
  };
  return <TimelineRow entry={entry} first={first} last={last} />;
});

function HistorySkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.month}>
        <SkeletonText variant="headline" width="30%" />
      </View>
      <View style={[styles.card, styles.first, styles.last]}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.text}>
            <SkeletonText variant="bodyStrong" width="50%" />
            <SkeletonText variant="callout" width="70%" />
            <SkeletonText variant="caption" width="40%" />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/** GAR-11 /garage/[id]/history: the owner's Verlauf with hidden entries, hide and show, and "Notiz hinzufügen". */
export function HistoryScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const access = useGarageAccess();
  const back = useBack('/garage');
  const params = useLocalSearchParams<{ id: string }>();
  const id = paramOf(params.id) ?? '';
  const vehicle = useVehicle(id);
  const published = vehicle.data?.status === 'published';
  const query = useOwnerUpdates(id, published);
  const hide = useHideUpdate({ id, slug: vehicle.data?.slug ?? '' });
  const inset = useTabBarInset();
  const { gutter } = useBreakpoint();
  const headerWidth = usePushedHeaderWidth(FORM_MAX_WIDTH);
  const listRef = useRef<FlashListRef<Row>>(null);
  const offset = useRef(0);
  const [writing, setWriting] = useState(false);

  const updates = useMemo(() => (qaState === 'empty' ? [] : (query.data?.pages.flatMap((page) => page.data) ?? [])), [qaState, query.data]);
  const rows = useMemo(() => historyRows(updates), [updates]);
  const locked = access.restriction !== null;

  useTabScrollToTop(() => {
    if (offset.current <= 0) return false;
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    return true;
  });

  const toggle = useCallback(
    (update: OwnerUpdate) =>
      hide.mutate(
        { id: update.id, hidden: !update.hidden },
        {
          onSuccess: (next) => toast(next.hidden ? t('history.hiddenToast') : t('history.shownToast'), { testID: `${ROUTE}.toast` }),
          onError: (error) => toast(saveErrorMessage(t, error), { testID: `${ROUTE}.toast` }),
        },
      ),
    [hide, t],
  );
  const open = useCallback(
    (update: OwnerUpdate) => {
      if (vehicle.data) router.push(`/v/${vehicle.data.slug}/updates/${update.id}`);
    },
    [router, vehicle.data],
  );

  const actions: HeaderAction[] =
    published && access.status === 'member'
      ? [{ icon: 'plus', label: t('history.addNote'), onPress: () => setWriting(true), disabled: locked || !online, testID: `${ROUTE}.add` }]
      : [];

  let state: ReactNode = null;
  if (access.status === 'guest') state = <SignInState routeId={ROUTE} returnTo={`/garage/${id}/history`} />;
  else if (vehicle.error && isGone(vehicle.error)) state = <GoneState routeId={ROUTE} title={t('gone.vehicleTitle')} body={t('gone.vehicleBody')} />;
  else if (qaState === 'loading' || access.status === 'loading' || (!vehicle.data && vehicle.isPending) || (published && !query.data && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default'))
    state = <HistorySkeleton />;
  else if (qaState === 'error' || !vehicle.data || (published && !query.data))
    state = (
      <LoadErrorState
        routeId={ROUTE}
        offline={!online || query.fetchStatus === 'paused'}
        onRetry={() => {
          void vehicle.refetch();
          void query.refetch();
        }}
        retrying={query.isFetching || vehicle.isFetching}
      />
    );
  else if (!published)
    state = <EmptyState icon="list" title={t('history.draftTitle')} body={t('history.draftBody')} testID={`${ROUTE}.draft`} />;
  else if (updates.length === 0)
    state = (
      <EmptyState
        icon="list"
        title={t('history.emptyTitle')}
        body={t('history.emptyBody')}
        action={{ label: t('history.addNote'), onPress: () => setWriting(true), disabled: locked || !online }}
        testID={`${ROUTE}.empty`}
      />
    );

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={t('history.title')} onBack={back} actions={actions} contentMaxWidth={headerWidth} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner />
      <FlashList
        ref={listRef}
        data={state ? [] : rows}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.y;
        }}
        keyExtractor={(row: Row) => (row.kind === 'month' ? `month.${row.label}` : row.update.id)}
        getItemType={(row: Row) => row.kind}
        style={styles.list}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: inset }}
        ListHeaderComponent={
          <View style={[styles.column, styles.top]}>
            {access.restriction ? <RestrictedNotice message={access.restriction} testID={`${ROUTE}.restricted`} /> : null}
            <Text variant="callout" color="text.secondary">
              {t('history.intro')}
            </Text>
          </View>
        }
        ListEmptyComponent={state ? <View style={styles.column}>{state}</View> : null}
        ListFooterComponent={
          <View style={[styles.column, styles.end]}>
            {query.hasNextPage ? (
              <View style={styles.more}>
                <Button
                  label={t('history.loadMore')}
                  variant="secondary"
                  size="m"
                  loading={query.isFetchingNextPage}
                  onPress={() => void query.fetchNextPage()}
                  testID={`${ROUTE}.more`}
                />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }: { item: Row }) => (
          <View style={styles.column}>
            {item.kind === 'month' ? (
              <TimelineMonth label={item.label} first={item.first} />
            ) : (
              <Entry update={item.update} first={item.first} last={item.last} onToggle={toggle} onOpen={open} disabled={!online || (locked && item.update.hidden)} />
            )}
          </View>
        )}
        testID={`${ROUTE}.list`}
      />
      {vehicle.data ? <NoteSheet visible={writing} onClose={() => setWriting(false)} vehicle={vehicle.data} /> : null}
    </Screen>
  );
}

/**
 * "Notiz hinzufügen". A typed note is never lost to a swipe, the scrim, Escape or Android back: closing asks first (the
 * discard guard of every form, §9). Sending and Verwerfen close at once.
 */
function NoteSheet({ visible, onClose, vehicle }: { visible: boolean; onClose: () => void; vehicle: { id: string; slug: string } }) {
  const { t } = useTranslation('garage');
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const close = () => {
    setAsking(false);
    setDirty(false);
    onClose();
  };
  return (
    <>
      <Sheet visible={visible} onClose={() => (dirty ? setAsking(true) : close())} title={t('history.addNote')} testID={`${ROUTE}.noteSheet`}>
        <NoteForm onDone={close} onDirty={setDirty} vehicle={vehicle} />
      </Sheet>
      <Dialog
        visible={visible && asking}
        onClose={() => setAsking(false)}
        title={t('history.discardTitle')}
        body={t('history.discardBody')}
        testID={`${ROUTE}.noteSheet.discard`}
        actions={[
          { label: t('history.discardKeep'), variant: 'secondary', onPress: () => setAsking(false), testID: `${ROUTE}.noteSheet.discard.keep` },
          { label: t('history.discardConfirm'), destructive: true, onPress: close, testID: `${ROUTE}.noteSheet.discard.discard` },
        ]}
      />
    </>
  );
}

/** Lives inside the sheet, so a new opening starts empty and with a new idempotency key. */
function NoteForm({ onDone, onDirty, vehicle }: { onDone: () => void; onDirty: (dirty: boolean) => void; vehicle: { id: string; slug: string } }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const charCount = useCharCount();
  const add = useAddNote(vehicle);
  const [key, setKey] = useState(newIdempotencyKey);
  const [notice, setNotice] = useState<string | null>(null);
  const { control, handleSubmit, setError } = useForm<{ note: string }>({ resolver: zodResolver(noteSchema), mode: 'onTouched', defaultValues: { note: '' } });
  const note = useWatch({ control, name: 'note' });
  const dirty = note.trim().length > 0 && !add.isPending;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const submit = handleSubmit(async (values) => {
    setNotice(null);
    try {
      await add.mutateAsync({ note: values.note.trim(), idempotencyKey: key });
      toast(t('history.noteSaved'), { haptic: 'success', testID: `${ROUTE}.toast` });
      onDone();
    } catch (error) {
      // The first version of this note is stored: the list behind the sheet reads again (useAddNote) and the member decides,
      // because only a new key can send a second one.
      if (isKeyReused(error)) {
        setKey(newIdempotencyKey());
        setNotice(t('history.noteReused'));
        return;
      }
      setNotice(applyServerErrors(error, setError, { note: 'note' }) === null ? null : saveErrorMessage(t, error, { creating: true }));
    }
  });
  return (
    <View style={styles.sheetBody}>
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.noteSheet.notice`} /> : null}
      <Controller
        control={control}
        name="note"
        render={({ field, fieldState }) => (
          <TextInput
            ref={field.ref}
            label={t('history.noteLabel')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder={t('history.notePlaceholder')}
            helper={`${t('history.noteHelper')} ${charCount(note.length, NOTE_MAX_LENGTH)}`}
            error={fieldMessage(t, fieldState.error)}
            multiline
            maxRows={NOTE_ROWS}
            maxLength={NOTE_MAX_LENGTH}
            autoFocus
            testID={`${ROUTE}.noteSheet.input`}
          />
        )}
      />
      <Button label={t('history.publishNote')} size="l" fullWidth loading={add.isPending} onPress={() => void submit()} testID={`${ROUTE}.noteSheet.submit`} />
    </View>
  );
}
