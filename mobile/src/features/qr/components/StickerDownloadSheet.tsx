import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import i18n from '@/i18n';
import { keepNameTogether } from '@/lib/format';
import { createStyles, space, typography, useTheme } from '@/theme';
import { Icon } from '@/ui/icons/Icon';
import { Progress } from '@/ui/Progress';
import { Sheet } from '@/ui/Sheet';
import { Spinner } from '@/ui/Spinner';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { RowBody, RowDivider } from '@/ui/rowParts';

import { downloadStickerFile, STICKER_FORMATS, type StickerFileFormat, type StickerFileTarget } from '../stickerDownload';

const PERCENT = 100;

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingVertical: t.space[12] },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  trailing: { alignItems: 'center', height: t.size.icon.l, justifyContent: 'center', width: t.size.icon.l },
  error: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8], marginTop: t.space[4] },
  errorText: { flex: 1 },
}));

type DownloadState = {
  active: StickerFileFormat | null;
  progress: number | null;
  error: { format: StickerFileFormat; error: ApiError } | null;
};
const IDLE: DownloadState = { active: null, progress: null, error: null };

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError({ kind: 'server', status: 0, code: 'server', message: i18n.t('errors:server') });
}

/** One transfer at a time; closing cancels it; a failure stays on its row (as the QR sheet, useQrDownload). */
export function useStickerDownload(target: StickerFileTarget | null, dialogTitle: string, onDone: (fileName: string, saved: boolean) => void, onFailed?: (error: ApiError) => void) {
  const [state, setState] = useState<DownloadState>(IDLE);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const start = async (format: StickerFileFormat) => {
    if (!target || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setState({ active: format, progress: null, error: null });
    const current = () => controller.current === abort;
    try {
      const outcome = await downloadStickerFile(target, format, {
        signal: abort.signal,
        dialogTitle,
        onProgress: (progress) => setState((now) => (now.active === format ? { ...now, progress } : now)),
      });
      if (!current()) return;
      setState(IDLE);
      onDone(outcome.fileName, outcome.kind === 'saved');
    } catch (error) {
      if (!current()) return;
      if (abort.signal.aborted || (error instanceof Error && error.name === 'AbortError')) setState(IDLE);
      else {
        const failure = asApiError(error);
        setState({ active: null, progress: null, error: { format, error: failure } });
        onFailed?.(failure);
      }
    } finally {
      if (current()) controller.current = null;
    }
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setState(IDLE);
  };

  return { ...state, start, cancel };
}

export type StickerDownloadSheetProps = {
  visible: boolean;
  onClose: () => void;
  target: StickerFileTarget | null;
  vehicleTitle: string;
  /** 409: the version is not validated or its code was replaced; the caller reloads. */
  onStale?: () => void;
  /** `<routeId>.downloadSheet`, `<routeId>.download.<format>`. */
  routeId: string;
};

/** "Herunterladen" (10 §2.3 Export): Druck-PDF · SVG · Bild zum Teilen, each with what it is for. */
export function StickerDownloadSheet({ visible, onClose, target, vehicleTitle, onStale, routeId }: StickerDownloadSheetProps) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const theme = useTheme();
  const download = useStickerDownload(
    target,
    t('stickerFiles.shareTitle', { vehicle: vehicleTitle }),
    (fileName, saved) => {
      onClose();
      if (saved) toast(t('download.started', { file: fileName }), { testID: `${routeId}.downloadToast` });
    },
    (error) => {
      if (error.status === 409) onStale?.();
    },
  );

  const close = () => {
    download.cancel();
    onClose();
  };

  const errorIconBox = { height: typography.caption.lineHeight * theme.fontScale, justifyContent: 'center' as const };

  return (
    <Sheet visible={visible} onClose={close} title={t('stickerFiles.title')} narrow testID={`${routeId}.downloadSheet`}>
      {STICKER_FORMATS.map((format, index) => {
        const active = download.active === format;
        const busy = download.active !== null;
        const error = download.error?.format === format ? download.error.error : null;
        const title = t(`stickerFiles.formats.${format}.title`);
        const detail = t(`stickerFiles.formats.${format}.detail`);
        const progressLabel =
          download.progress === null ? t('download.loading') : t('download.progress', { percent: Math.round(download.progress * PERCENT) });
        const errorText = error
          ? error.status === 409
            ? t('stickerFiles.stale')
            : keepNameTogether(error.message)
          : null;
        return (
          <View key={format} aria-busy={active}>
            <RowBody
              role="button"
              onPress={() => void download.start(format)}
              disabled={busy && !active}
              label={[title, detail, active ? progressLabel : null, errorText].filter(Boolean).join(', ')}
              style={styles.row}
              testID={`${routeId}.download.${format}`}
            >
              <View style={styles.text}>
                <Text variant="body" color={busy && !active ? 'text.disabled' : 'text.primary'}>
                  {title}
                </Text>
                <Text variant="callout" color={busy && !active ? 'text.disabled' : 'text.secondary'}>
                  {detail}
                </Text>
                {errorText ? (
                  <View style={styles.error} role="alert" testID={`${routeId}.download.${format}.error`}>
                    <View style={errorIconBox}>
                      <Icon name="warning" size={16} color="accent.fg" />
                    </View>
                    <Text variant="caption" style={styles.errorText}>
                      {errorText}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.trailing}>
                {active ? (
                  download.progress === null ? (
                    <Spinner size={20} label={progressLabel} testID={`${routeId}.download.${format}.progress`} />
                  ) : (
                    <Progress variant="ring" value={download.progress} label={progressLabel} testID={`${routeId}.download.${format}.progress`} />
                  )
                ) : (
                  <Icon name={error ? 'arrow-clockwise' : 'download-simple'} size={20} color={busy ? 'text.disabled' : 'text.secondary'} />
                )}
              </View>
            </RowBody>
            {index < STICKER_FORMATS.length - 1 ? <RowDivider inset={space[0]} /> : null}
          </View>
        );
      })}
    </Sheet>
  );
}
