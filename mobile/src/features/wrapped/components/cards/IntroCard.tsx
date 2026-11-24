import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { WrappedIntroCard, WrappedPayload } from '@/api/queries/wrapped';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space } from '@/theme';
import { DisplayTitle } from '@/ui/DisplayTitle';

import { seasonName } from '../../model';
import { CARD_FONT_SCALE_CAP, CardFrame, CardLine, CardPhoto } from './parts';

const useStyles = createStyles((t) => ({
  body: { justifyContent: 'space-between' },
  withPhoto: { gap: t.space[16], justifyContent: 'flex-start' },
  mark: { paddingTop: t.space[24] },
  text: { gap: t.space[12] },
  // In the full-bleed lead the wordmark keeps the card's text edge.
  leadMark: { paddingHorizontal: t.space[24] },
  // DQ-P5G-58: the opening photo runs to the card's edges, square-cornered, so the first card differs from the inset ones.
  bleed: { borderRadius: t.radius.none },
}));

export type IntroCardProps = { card: WrappedIntroCard; payload: WrappedPayload; width: number; height: number; testID: string };

/**
 * Card 1, the brand moment (SKILL §6/§9: the brush logo with its katakana only here and on the share card): the logo, the member's
 * own lead car (ADR-516 a, the photo the share card shows) when the server sends one, full-bleed to the card's edges and taking the
 * room the words leave (DQ-P5G-58), the server's title in display.title, its line,
 * the window ("1. März bis 31. Oktober 2026") and whose season it is. Without a photo the card stays typographic, the logo larger.
 */
export const IntroCard = forwardRef<ComponentRef<typeof View>, IntroCardProps>(function IntroCard({ card, payload, width, height, testID }, ref) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const inner = width - 2 * space[24];
  const from = new Date(payload.window.from);
  const to = new Date(payload.window.to);
  const window = Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) ? null : t('wrapped.cards.intro.window', { from: format.dayMonth(from), to: format.longDate(to) });
  const name = payload.member.display_name ?? (payload.member.username ? `@${payload.member.username}` : null);
  const photo = card.image;
  return (
    <CardFrame
      ref={ref}
      width={width}
      height={height}
      eyebrow={seasonName(t, payload.season_key)}
      sample={payload.is_sample === true}
      bodyStyle={photo ? styles.withPhoto : styles.body}
      lead={
        photo ? (
          <>
            <View style={styles.leadMark}>
              <AppWordmark width={Math.round(width * 0.4)} tone="white" testID={`${testID}.wordmark`} />
            </View>
            <CardPhoto photo={photo} label={t('wrapped.cards.photoLabel')} width={width} style={styles.bleed} testID={`${testID}.photo`} />
          </>
        ) : undefined
      }
      testID={testID}
    >
      {photo ? null : (
        <View style={styles.mark}>
          <AppWordmark width={Math.round(width * 0.62)} tone="white" testID={`${testID}.wordmark`} />
        </View>
      )}
      <View style={styles.text}>
        <DisplayTitle kind="copy" placement="card" layoutWidth={inner} color="onPhoto.primary" fontScaleCap={CARD_FONT_SCALE_CAP} testID={`${testID}.title`}>
          {card.title}
        </DisplayTitle>
        {card.subtitle ? <CardLine>{card.subtitle}</CardLine> : null}
        {window ? (
          <CardLine variant="callout" tone="secondary" numeric testID={`${testID}.window`}>
            {window}
          </CardLine>
        ) : null}
        {name ? (
          <CardLine variant="callout" tone="secondary" testID={`${testID}.member`}>
            {t('wrapped.cards.intro.member', { name })}
          </CardLine>
        ) : null}
      </View>
    </CardFrame>
  );
});
