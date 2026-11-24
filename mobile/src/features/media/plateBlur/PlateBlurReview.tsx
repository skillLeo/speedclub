import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { IconButton } from '@/ui/IconButton';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';

import { defaultChoice, type PlateBlurChoice, type WithPlateBlur } from './model';
import { PlateBlurEditor, type PlateBlurPhoto } from './PlateBlurEditor';

export type PlateBlurReviewOptions = {
  /** The last page's button: "Hochladen" by default, "Senden" for a message. */
  confirmLabel?: string;
};

type Session = {
  photos: readonly PlateBlurPhoto[];
  originals: readonly object[];
  choices: PlateBlurChoice[];
  index: number;
  options: PlateBlurReviewOptions;
  resolve: (result: object[] | null) => void;
};

const useStyles = createStyles((t) => ({
  pager: { alignItems: 'center', flexDirection: 'row', gap: t.space[4], justifyContent: 'space-between' },
  pagerText: { flex: 1, textAlign: 'center' },
  body: { gap: t.space[16], paddingBottom: t.space[16] },
  footer: { gap: t.space[8] },
  allRow: { alignItems: 'flex-start' },
}));

export type PlateBlurReview = {
  /**
   * Opens the editor for the picked photos, one page per photo. Resolves with each photo and its choice once the member
   * goes on, or null when they decided not to upload. Every photo starts with the blur on and the suggested rectangle, so
   * "Hochladen" never waits for anything.
   */
  review: <T extends PlateBlurPhoto>(photos: readonly T[], options?: PlateBlurReviewOptions) => Promise<WithPlateBlur<T>[] | null>;
  /** Render once in the screen that calls `review`. */
  element: ReactNode;
  open: boolean;
};

/** M5.9a: the plate blur step between the photo picker and the upload, shared by every upload flow. */
export function usePlateBlurReview(routeId: string): PlateBlurReview {
  const [session, setSession] = useState<Session | null>(null);
  const current = useRef<Session | null>(null);
  useEffect(() => {
    current.current = session;
  });
  // A screen that goes while the editor is open: the caller's await ends as "not uploaded".
  useEffect(() => () => current.current?.resolve(null), []);

  const review = useCallback(
    <T extends PlateBlurPhoto>(photos: readonly T[], options: PlateBlurReviewOptions = {}) =>
      new Promise<WithPlateBlur<T>[] | null>((resolve) => {
        if (photos.length === 0) {
          resolve([]);
          return;
        }
        current.current?.resolve(null);
        const next: Session = {
          photos,
          originals: photos,
          choices: photos.map(() => defaultChoice()),
          index: 0,
          options,
          resolve: resolve as (result: object[] | null) => void,
        };
        current.current = next;
        setSession(next);
      }),
    [],
  );

  const finish = (result: object[] | null) => {
    const open = current.current;
    if (!open) return;
    current.current = null;
    setSession(null);
    open.resolve(result);
  };

  const element = (
    <PlateBlurReviewSheet
      session={session}
      onChange={(next) => {
        current.current = next;
        setSession(next);
      }}
      onDone={(done) => finish(done.originals.map((photo, at) => ({ ...photo, plateBlur: done.choices[at] ?? defaultChoice() })))}
      onCancel={() => finish(null)}
      testID={`${routeId}.plateBlur`}
    />
  );
  return { review, element, open: session !== null };
}

type SheetProps = {
  session: Session | null;
  onChange: (next: Session) => void;
  onDone: (session: Session) => void;
  onCancel: () => void;
  testID: string;
};

function PlateBlurReviewSheet({ session, onChange, onDone, onCancel, testID }: SheetProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const [leaving, setLeaving] = useState(false);
  // The last session stays drawn while the sheet slides out.
  const [shown, setShown] = useState<Session | null>(session);
  if (session && session !== shown) setShown(session);
  const view = session ?? shown;
  if (!view) return null;

  const total = view.photos.length;
  const photo = view.photos[view.index];
  const choice = view.choices[view.index] ?? defaultChoice();
  const last = view.index >= total - 1;
  const go = (index: number) => onChange({ ...view, index: Math.min(total - 1, Math.max(0, index)) });
  const setChoice = (next: PlateBlurChoice) => onChange({ ...view, choices: view.choices.map((entry, at) => (at === view.index ? next : entry)) });
  const applyToAll = () => {
    onChange({ ...view, choices: view.choices.map(() => ({ on: choice.on, regions: [...choice.regions] })) });
    toast(t('plateBlur.review.appliedAll', { count: total }), { testID: `${testID}.appliedAllToast` });
  };
  const confirm = view.options.confirmLabel ?? t('plateBlur.review.upload', { count: total });

  const footer = (
    <View style={styles.footer}>
      <Button
        label={last ? confirm : t('plateBlur.review.next')}
        fullWidth
        onPress={() => (last ? onDone(view) : go(view.index + 1))}
        testID={`${testID}.${last ? 'confirm' : 'next'}`}
      />
      {!last ? (
        <Button
          label={view.options.confirmLabel ?? t('plateBlur.review.uploadNow', { count: total })}
          variant="tertiary"
          fullWidth
          onPress={() => onDone(view)}
          testID={`${testID}.confirmAll`}
        />
      ) : null}
    </View>
  );

  return (
    <>
      <Sheet
        visible={session !== null}
        onClose={() => setLeaving(true)}
        title={t('plateBlur.review.title', { count: total })}
        initialSnap="full"
        footer={footer}
        testID={`${testID}.sheet`}
      >
        <View style={styles.body}>
          {total > 1 ? (
            <View style={styles.pager} testID={`${testID}.pager`}>
              <IconButton
                icon="caret-left"
                label={t('plateBlur.review.previous')}
                disabled={view.index === 0}
                onPress={() => go(view.index - 1)}
                testID={`${testID}.previous`}
              />
              <Text variant="callout" numeric style={styles.pagerText} role="status" aria-live="polite" testID={`${testID}.page`}>
                {t('plateBlur.review.page', { index: view.index + 1, total })}
              </Text>
              <IconButton
                icon="caret-right"
                label={t('plateBlur.review.nextPhoto')}
                disabled={last}
                onPress={() => go(view.index + 1)}
                testID={`${testID}.forward`}
              />
            </View>
          ) : null}
          {photo ? <PlateBlurEditor key={view.index} photo={photo} value={choice} onChange={setChoice} testID={testID} /> : null}
          {total > 1 ? (
            <View style={styles.allRow}>
              <Button label={t('plateBlur.review.applyAll')} variant="tertiary" size="s" flush="start" onPress={applyToAll} testID={`${testID}.applyAll`} />
            </View>
          ) : null}
        </View>
      </Sheet>
      <Dialog
        visible={leaving}
        onClose={() => setLeaving(false)}
        title={t('plateBlur.review.discardTitle', { count: total })}
        body={t('plateBlur.review.discardBody', { count: total })}
        testID={`${testID}.discard`}
        actions={[
          { label: t('plateBlur.review.keep'), variant: 'secondary', onPress: () => setLeaving(false), testID: `${testID}.discard.keep` },
          {
            label: t('plateBlur.review.discard'),
            destructive: true,
            onPress: () => {
              setLeaving(false);
              onCancel();
            },
            testID: `${testID}.discard.confirm`,
          },
        ]}
      />
    </>
  );
}
