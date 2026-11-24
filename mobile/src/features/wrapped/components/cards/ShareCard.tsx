import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import type { WrappedPayload, WrappedShareCard } from '@/api/queries/wrapped';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { dexNumberText } from '@/features/dex/copy';
import { displayQrUrl } from '@/features/qr/code';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space } from '@/theme';
import { DisplayTitle } from '@/ui/DisplayTitle';
import { Text } from '@/ui/Text';
import { urlSegments } from '@/ui/QRDisplay';

import { seasonName } from '../../model';
import { CARD_FONT_SCALE_CAP, CardFrame, CardLine, CardPhoto, Numeral } from './parts';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], justifyContent: 'flex-start' },
  // The facts and the QR are the frame's pinned footer: at any font scale the QR stays whole on the card (DQ-P5G-04).
  bottom: { alignItems: 'flex-end', columnGap: t.space[16], flexDirection: 'row' },
  facts: { flex: 1, gap: t.space[4], minWidth: 0 },
  // The QR is always black on white (qr.* tokens) with its quiet zone, as the server draws it.
  // Inline blocks give the browser one break between the segments (QRDisplay's rule).
  urlSegmentWeb: { display: 'inline-block' as 'flex' },
  qr: { backgroundColor: t.color.qr.bg, borderRadius: t.radius.sm, padding: t.space[4] },
}));

export type ShareCardProps = {
  card: WrappedShareCard;
  payload: WrappedPayload;
  /** The server's drawing of the car's active code (`QRDisplay`'s source); null without an active code: the address alone. */
  qrSvg: string | null;
  width: number;
  height: number;
  testID: string;
};

/**
 * Card 9, the share card and the second brand moment: the brush logo, the car's blurred photo, its name in display.title, the Dex
 * number, the Build Score with its stage, and the QR to its public page (`/v/{slug}`, ADR-514). The facts and the QR are pinned to
 * the card's foot, so the QR is always whole; the photo gives way first. The phone exports exactly this; the web downloads the
 * server's drawing of it.
 */
export const ShareCard = forwardRef<ComponentRef<typeof View>, ShareCardProps>(function ShareCard({ card, payload, qrSvg, width, height, testID }, ref) {
  const { t } = useTranslation('profile');
  const { t: tVehicle } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const number = dexNumberText(card.dex_number);
  const qrBox = Math.round(width * 0.26);
  const facts = [
    card.score !== null ? t('wrapped.cards.share.score', { value: format.number(card.score) }) : null,
    card.stage !== null ? tVehicle('score.stage', { stage: card.stage }) : null,
  ].filter((part): part is string => part !== null);
  const inner = width - 2 * space[24];
  const footer = (
    <View style={styles.bottom}>
      <View style={styles.facts}>
        {number ? <Numeral value={t('wrapped.cards.spots.dexNumber', { number })} small testID={`${testID}.dexNumber`} /> : null}
        {facts.length > 0 ? (
          <CardLine variant="callout" numeric testID={`${testID}.score`}>
            {facts.join('\u00A0· ')}
          </CardLine>
        ) : null}
        {card.qr_url ? (
          // The address breaks only after its last slash, never inside the code (as QRDisplay).
          <Text variant="caption" color="onPhoto.secondary" hyphenate={false} desktopSize={false} fontScaleCap={CARD_FONT_SCALE_CAP} testID={`${testID}.url`}>
            {urlSegments(displayQrUrl(card.qr_url)).map((segment) => (
              <Text
                key={segment}
                variant="caption"
                color="onPhoto.secondary"
                hyphenate={false}
                desktopSize={false}
                fontScaleCap={CARD_FONT_SCALE_CAP}
                style={isWeb ? styles.urlSegmentWeb : undefined}
              >
                {segment}
              </Text>
            ))}
          </Text>
        ) : null}
      </View>
      {qrSvg ? (
        <View style={styles.qr} accessible role="img" aria-label={t('wrapped.cards.share.qrLabel', { vehicle: card.vehicle_name })} testID={`${testID}.qr`}>
          <SvgXml xml={qrSvg} width={qrBox} height={qrBox} />
        </View>
      ) : null}
    </View>
  );
  return (
    <CardFrame
      ref={ref}
      width={width}
      height={height}
      eyebrow={seasonName(t, payload.season_key)}
      sample={payload.is_sample === true}
      bodyStyle={styles.body}
      footer={footer}
      testID={testID}
    >
      <AppWordmark width={Math.round(width * 0.4)} tone="white" testID={`${testID}.wordmark`} />
      {card.image ? <CardPhoto photo={card.image} label={card.vehicle_name} width={inner} testID={`${testID}.photo`} /> : null}
      <DisplayTitle placement="card" layoutWidth={inner} color="onPhoto.primary" fontScaleCap={CARD_FONT_SCALE_CAP} testID={`${testID}.vehicle`}>
        {card.vehicle_name}
      </DisplayTitle>
    </CardFrame>
  );
});
