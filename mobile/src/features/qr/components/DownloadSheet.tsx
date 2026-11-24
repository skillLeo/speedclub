import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { keepNameTogether } from '@/lib/format';
import { createStyles, space, typography, useTheme } from '@/theme';
import { Icon } from '@/ui/icons/Icon';
import { Progress } from '@/ui/Progress';
import { QRDisplay } from '@/ui/QRDisplay';
import { Sheet } from '@/ui/Sheet';
import { Spinner } from '@/ui/Spinner';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { RowBody, RowDivider } from '@/ui/rowParts';

import { PLACARD_FLAG, sheetFormats, type QrDownloadOutcome, type QrFormat } from '../download';
import { useQrDownload } from '../useQrDownload';

const PERCENT = 100;

const useStyles = createStyles((t) => ({
  card: { marginBottom: t.space[16] },
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingVertical: t.space[12] },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  trailing: { alignItems: 'center', height: t.size.icon.l, justifyContent: 'center', width: t.size.icon.l },
  error: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8], marginTop: t.space[4] },
  errorText: { flex: 1 },
}));

export type DownloadSheetProps = {
  visible: boolean;
  onClose: () => void;
  vehicleId: string;
  code: string;
  /** "Nissan Skyline GT-R R34", for the share sheet's title. */
  vehicleTitle: string;
  /** A 404: the code is no longer active, the page refetches it. */
  onGone?: () => void;
  /** DQ-M54-10: the sticker's QR code itself, on its white card above the formats (STK-02 leads with the sticker, not the code). */
  card?: { svg: string; label: string; code: string; url?: string };
};

/**
 * FS-9's format sheet: PNG · PNG 2048 · SVG · PDF-Sticker and, behind `sig.placard_pdf`, Placard A5 · A4, each with what it is for. The row on its way shows its progress, a
 * failure stays on its row with the reason; closing the sheet cancels a running transfer.
 */
export function DownloadSheet({ visible, onClose, vehicleId, code, vehicleTitle, onGone, card }: DownloadSheetProps) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const theme = useTheme();
  const formats = sheetFormats(useFlag(PLACARD_FLAG));

  const onDone = (outcome: QrDownloadOutcome) => {
    onClose();
    if (outcome.kind === 'saved') toast(t('download.started', { file: outcome.fileName }), { testID: 'STK-02.downloadToast' });
  };
  // A 404 says the code is no longer active: the page refetches and shows what is true now.
  const onFailed = (error: ApiError) => {
    if (error.status === 404) onGone?.();
  };
  const download = useQrDownload(
    { vehicleId, code, dialogTitle: t('download.shareTitle', { vehicle: vehicleTitle }) },
    onDone,
    onFailed,
  );

  const close = () => {
    download.cancel();
    onClose();
  };

  const start = (format: QrFormat) => {
    void download.start(format);
  };

  const failed = download.error;
  const errorIconBox = { height: typography.caption.lineHeight * theme.fontScale, justifyContent: 'center' as const };

  return (
    <Sheet visible={visible} onClose={close} title={card ? t('detail.qrCode') : t('download.title')} narrow testID="STK-02.downloadSheet">
      {card ? (
        <QRDisplay svg={card.svg} label={card.label} code={card.code} url={card.url} style={styles.card} testID="STK-02.card" />
      ) : null}
      {formats.map((format, index) => {
        const active = download.active === format;
        const busy = download.active !== null;
        const error = failed?.format === format ? failed.error : null;
        const title = t(`download.formats.${format}.title`);
        const detail = t(`download.formats.${format}.detail`);
        const progressLabel =
          download.progress === null ? t('download.loading') : t('download.progress', { percent: Math.round(download.progress * PERCENT) });
        return (
          <View key={format} aria-busy={active}>
            <RowBody
              role="button"
              onPress={() => start(format)}
              disabled={busy && !active}
              label={[title, detail, active ? progressLabel : null, error?.message].filter(Boolean).join(', ')}
              style={styles.row}
              testID={`STK-02.download.${format}`}
            >
              <View style={styles.text}>
                <Text variant="body" color={busy && !active ? 'text.disabled' : 'text.primary'}>
                  {title}
                </Text>
                <Text variant="callout" color={busy && !active ? 'text.disabled' : 'text.secondary'}>
                  {detail}
                </Text>
                {error ? (
                  <View style={styles.error} role="alert" testID={`STK-02.download.${format}.error`}>
                    <View style={errorIconBox}>
                      <Icon name="warning" size={16} color="accent.fg" />
                    </View>
                    <Text variant="caption" style={styles.errorText}>
                      {error.status === 404 ? t('download.gone') : keepNameTogether(error.message)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.trailing}>
                {active ? (
                  download.progress === null ? (
                    <Spinner size={20} label={progressLabel} testID={`STK-02.download.${format}.progress`} />
                  ) : (
                    <Progress variant="ring" value={download.progress} label={progressLabel} testID={`STK-02.download.${format}.progress`} />
                  )
                ) : (
                  <Icon name={error ? 'arrow-clockwise' : 'download-simple'} size={20} color={busy ? 'text.disabled' : 'text.secondary'} />
                )}
              </View>
            </RowBody>
            {index < formats.length - 1 ? <RowDivider inset={space[0]} /> : null}
          </View>
        );
      })}
    </Sheet>
  );
}
