import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';

import type { ShareCardFormat } from '@/api/queries/signature';
import type { components } from '@/api/schema';
import { photoFields } from '@/features/profile/media';
import { createStyles, size, space } from '@/theme';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';
import { haptics } from '@/ui/motion';
import { focalToPosition } from '@/ui/Photo';
import { PhotoScrim } from '@/ui/PhotoScrim';
import { PressableScale } from '@/ui/PressableScale';
import { Text } from '@/ui/Text';
import { useRovingKeys } from '@/ui/useRovingKeys';

import { SHARE_CARD_PHOTO_BOX, SHARE_CARD_SIZE, SHARE_CARD_TEMPLATES, type ShareCardTemplate } from '../shareCardCrop';
import { templateTakesTheme } from '../shareCardOptions';

type Media = components['schemas']['MediaResource'];

/** Each thumbnail takes a third of the row, at most this wide (a story thumbnail is then 213 high). */
export const TEMPLATE_THUMB_MAX = size.thumb.card + space[48];
const THUMB_MAX = TEMPLATE_THUMB_MAX;
/** The card's own margins (the server's 64 px safe area of the square, 250 px of the story), as shares of the card. */
const SQUARE_SAFE = 64 / 1080;
const STORY_SAFE = 250 / 1920;
/** The frame's inset photo: (1080 − 984) / 2 = 48 px on each side. */
const FRAME_INSET = 48 / 1080;

const percent = (fraction: number): DimensionValue => `${Math.round(fraction * 1000) / 10}%`;

const useStyles = createStyles((t) => ({
  row: { columnGap: t.space[12], flexDirection: 'row' },
  option: { alignItems: 'center', flex: 1, gap: t.space[8], maxWidth: THUMB_MAX },
  // The ring sits outside the card, as the focus ring does: 2 wide, 2 off.
  ring: { alignSelf: 'stretch', borderColor: 'transparent', borderRadius: t.radius.sm + t.size.border.focusOffset + t.size.border.focusRing, borderWidth: t.size.border.focusRing, padding: t.size.border.focusOffset },
  ringOn: { borderColor: t.color.text.primary },
  // R5DQ-04: a hairline edge on every thumbnail, so the dark frame keeps its outline on Schwarz (its ground is the canvas there).
  card: { borderColor: t.color.border.default, borderRadius: t.radius.sm, borderWidth: t.size.border.control, overflow: 'hidden', width: '100%' },
  // The card's grounds are its own colours, the same in every app theme: the dark stage and white paper.
  groundDark: { backgroundColor: t.color.media.ground },
  groundLight: { backgroundColor: t.color.qr.bg },
  photo: { backgroundColor: t.color.bg.raised, overflow: 'hidden', position: 'absolute' },
  lines: { gap: t.space[2], left: 0, position: 'absolute', right: 0 },
  line: { borderRadius: t.radius.xs, height: t.space[2] },
  title: { borderRadius: t.radius.xs, height: t.space[4] },
  inkOnDark: { backgroundColor: t.color.onPhoto.secondary },
  inkOnLight: { backgroundColor: t.color.qr.caption },
  caption: { textAlign: 'center' },
  // Stand-ins for the name and the data line, as long as a typical "Nissan Skyline GT-R" and its three specs.
  posterTitle: { width: '70%' },
  nameLine: { width: '62%' },
  dataLine: { width: '44%' },
  qr: { aspectRatio: 1, borderColor: t.color.qr.fg, borderWidth: t.size.border.control, position: 'absolute', backgroundColor: t.color.qr.bg },
}));

export type ShareCardTemplatePickerProps = {
  value: ShareCardTemplate;
  format: ShareCardFormat;
  theme: 'dark' | 'light';
  media: Media | null;
  /** The crop's centre, so each thumbnail shows the part of the photo the card will. */
  focus: { x: number; y: number } | null;
  onChange: (template: ShareCardTemplate) => void;
  disabled?: boolean;
  routeId: string;
};

type Box = { left: number; top: number; width: number; height: number };

/** Where each template puts its photo, its lines and its QR code on this format, as shares of the card (the contract's table). */
function geometry(template: ShareCardTemplate, format: ShareCardFormat): { photo: Box; title: number | null; lines: number; qr: Box } {
  const card = SHARE_CARD_SIZE[format];
  const box = SHARE_CARD_PHOTO_BOX[template][format];
  const safe = format === 'square' ? SQUARE_SAFE : STORY_SAFE;
  const qrSide = (format === 'square' ? 200 : 240) / card.width;
  const qrHeight = (qrSide * card.width) / card.height;
  const qr = { left: 1 - SQUARE_SAFE - qrSide, top: 1 - safe - qrHeight, width: qrSide, height: qrHeight };
  const full = { left: 0, top: 0, width: 1, height: 1 };
  if (template === 'frame') {
    // Inset by the same 48 px on top: the caption block below it then holds the name, the data and the QR code.
    const photo = { left: FRAME_INSET, top: (FRAME_INSET * card.width) / card.height, width: box.width / card.width, height: box.height / card.height };
    return { photo, title: null, lines: photo.top + photo.height, qr };
  }
  if (template === 'poster') return { photo: full, title: safe, lines: 1 - safe - qrHeight, qr };
  if (format === 'square') return { photo: { ...full, height: box.height / card.height }, title: null, lines: box.height / card.height, qr };
  return { photo: full, title: null, lines: 1 - safe - qrHeight, qr };
}

function position(box: Box): ViewStyle {
  return { left: percent(box.left), top: percent(box.top), width: percent(box.width), height: percent(box.height) };
}

/**
 * R5-2e VEH-07: the three templates as small cards with the chosen photo, a radio group (arrow keys on the web). Lines stand for the
 * card's text; the real card is the server's PNG in the preview above.
 */
export function ShareCardTemplatePicker({ value, format, theme, media, focus, onChange, disabled = false, routeId }: ShareCardTemplatePickerProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const card = SHARE_CARD_SIZE[format];
  const selected = SHARE_CARD_TEMPLATES.indexOf(value);
  // Selection haptic once per choice (09 §4.8), as a segmented control.
  const pick = (template: ShareCardTemplate) => {
    if (template === value) return;
    haptics.selection();
    onChange(template);
  };
  const roving = useRovingKeys(
    SHARE_CARD_TEMPLATES.map(() => !disabled),
    selected,
    (index) => pick(SHARE_CARD_TEMPLATES[index] ?? 'band'),
  );
  const fields = photoFields(media, THUMB_MAX);
  const placeholder = useImagePlaceholder(fields.blurhash, 'cover', fields.thumbhash);

  return (
    <View style={styles.row} role="radiogroup" aria-label={t('shareCard.template')} testID={`${routeId}.template`} {...({ onKeyDown: roving.onKeyDown } as object)}>
      {SHARE_CARD_TEMPLATES.map((template, index) => {
        const on = template === value;
        const shape = geometry(template, format);
        const light = templateTakesTheme(template, format) && theme === 'light';
        const ground = template === 'frame' || (template === 'band' && format === 'square');
        const ink = ground && light ? styles.inkOnLight : styles.inkOnDark;
        const scrim = !ground;
        return (
          <View key={template} style={styles.option}>
            <PressableScale
              ref={roving.setRef(index)}
              role="radio"
              aria-checked={on}
              aria-label={`${t(`shareCard.templates.${template}`)}: ${t(`shareCard.templateHints.${template}`)}`}
              disabled={disabled}
              focusable={on}
              onPress={() => pick(template)}
              style={[styles.ring, on ? styles.ringOn : null]}
              testID={`${routeId}.template.${template}`}
            >
              <View style={[styles.card, { aspectRatio: card.width / card.height }, light ? styles.groundLight : styles.groundDark]} aria-hidden>
                <View style={[styles.photo, position(shape.photo)]}>
                  {fields.source ? (
                    <Image
                      source={typeof fields.source === 'string' ? { uri: fields.source } : fields.source}
                      {...placeholder}
                      contentFit="cover"
                      contentPosition={focus ? focalToPosition(focus) : 'center'}
                      draggable={false}
                      style={StyleSheet.absoluteFill}
                    />
                  ) : null}
                  {scrim ? <PhotoScrim /> : null}
                </View>
                {shape.title !== null ? (
                  <View style={[styles.lines, { top: percent(shape.title), paddingHorizontal: percent(SQUARE_SAFE) }]}>
                    <View style={[styles.title, styles.inkOnDark, styles.posterTitle]} />
                  </View>
                ) : null}
                <View style={[styles.lines, { top: percent(shape.lines), paddingHorizontal: percent(SQUARE_SAFE), paddingTop: percent(SQUARE_SAFE / 2) }]}>
                  {shape.title === null ? <View style={[styles.title, ink, styles.nameLine]} /> : null}
                  <View style={[styles.line, ink, styles.dataLine]} />
                </View>
                <View style={[styles.qr, position(shape.qr)]} />
              </View>
            </PressableScale>
            <Text variant="caption" color={on ? 'text.primary' : 'text.secondary'} style={styles.caption} aria-hidden>
              {t(`shareCard.templates.${template}`)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
