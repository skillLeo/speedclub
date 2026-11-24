import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { photoFields } from '@/features/profile/media';
import type { ShareCardFormat } from '@/api/queries/signature';
import { createStyles, size } from '@/theme';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Photo } from '@/ui/Photo';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { PressableScale } from '@/ui/PressableScale';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Text } from '@/ui/Text';

import {
  chosenMedia,
  effectiveCrop,
  photoBoxOf,
  photoSizeOf,
  templateTakesTheme,
  toggleShareCardElement,
  withPhoto,
  type ShareCardChoices,
  type ShareCardElement,
  type ShareCardOptions,
  type ShareCardTheme,
} from '../shareCardOptions';
import { ShareCardCropper } from './ShareCardCropper';
import { ShareCardTemplatePicker, TEMPLATE_THUMB_MAX } from './ShareCardTemplatePicker';
import { ShareCardTextField } from './ShareCardTextField';

const THUMB = size.thumb.card;

const useStyles = createStyles((t) => ({
  root: { gap: t.layout.sectionGap },
  group: { gap: t.space[12] },
  photos: { columnGap: t.space[8], flexDirection: 'row' },
  // The ring sits outside the photo, as the focus ring does: 2 wide, 2 off, so the picked photo keeps its full frame.
  thumb: { borderColor: 'transparent', borderRadius: t.radius.sm + t.size.border.focusOffset + t.size.border.focusRing, borderWidth: t.size.border.focusRing, padding: t.size.border.focusOffset },
  thumbOn: { borderColor: t.color.text.primary },
  thumbPhoto: { width: t.size.thumb.card },
  chips: { columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[8] },
  skeletonRow: { columnGap: t.space[12], flexDirection: 'row' },
  skeletonTemplate: { flex: 1, gap: t.space[8], maxWidth: TEMPLATE_THUMB_MAX },
  skeletonPhoto: { width: t.size.thumb.card + 2 * (t.size.border.focusOffset + t.size.border.focusRing) },
}));

export type ShareCardCustomiserProps = {
  options: ShareCardOptions;
  choices: ShareCardChoices;
  onChange: (next: ShareCardOptions) => void;
  /** Whether the options are the stored card's: "Standard" then has nothing to restore. */
  isDefault: boolean;
  onReset: () => void;
  /** The @username of the card, for its chip. */
  username: string | null;
  /** The server's 422 message on `text`. */
  textError?: string | null;
  /** From 768, beside the card: the crop stage's cap (ShareCardCropper). */
  maxCropHeight?: number;
  disabled?: boolean;
  routeId: string;
};

function Section({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.group} testID={testID}>
      <Text variant="calloutStrong" color="text.secondary" role="heading" {...({ 'aria-level': 2 } as object)}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * VEH-07 CF-6 and R5-2e: the card's choices under the preview, in the order the card is made: the template (three small cards with
 * the chosen photo), the photo (the build's ready photos, the cover first) and its crop in the template's photo box, what the card shows
 * besides photo, make and model (only what the build has), the member's own line, and the colour where the template takes one.
 * "Standard" goes back to the stored card.
 */
export function ShareCardCustomiser({ options, choices, onChange, isDefault, onReset, username, textError = null, maxCropHeight, disabled = false, routeId }: ShareCardCustomiserProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const media = chosenMedia(options, choices);
  const photoSize = photoSizeOf(media);
  const crop = effectiveCrop(options, choices);
  const photoId = media?.id ?? null;
  const takesTheme = templateTakesTheme(options.template, options.format);

  const elementLabel = (element: ShareCardElement): string =>
    element === 'username' && username ? `@${username}` : t(`shareCard.elements.${element}`);

  return (
    <View style={styles.root} testID={`${routeId}.customise`}>
      <Section title={t('shareCard.template')}>
        <ShareCardTemplatePicker
          value={options.template}
          format={options.format}
          theme={options.theme}
          media={media}
          focus={crop ? { x: crop.crop.x, y: crop.crop.y } : null}
          onChange={(template) => onChange({ ...options, template })}
          disabled={disabled}
          routeId={routeId}
        />
      </Section>

      {choices.photos.length > 1 ? (
        <Section title={t('shareCard.photo')}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos} role="radiogroup" aria-label={t('shareCard.photo')} testID={`${routeId}.photos`}>
            {choices.photos.map((item, index) => {
              const on = item.id === photoId;
              return (
                <PressableScale
                  key={item.id}
                  role="radio"
                  aria-checked={on}
                  aria-label={item.id === choices.coverId ? t('shareCard.photoCover') : t('shareCard.photoNumber', { index: index + 1, count: choices.photos.length })}
                  disabled={disabled}
                  onPress={() => onChange(withPhoto(options, item.id === choices.coverId ? null : item.id))}
                  style={[styles.thumb, on ? styles.thumbOn : null]}
                  testID={`${routeId}.photo.${item.id}`}
                >
                  <View style={styles.thumbPhoto}>
                    <Photo {...photoFields(item, THUMB)} aspect="1:1" corner="sm" />
                  </View>
                </PressableScale>
              );
            })}
          </ScrollView>
        </Section>
      ) : null}

      {media && photoSize && crop ? (
        <Section title={t('shareCard.crop')}>
          <ShareCardCropper
            media={media}
            photo={photoSize}
            box={photoBoxOf(options)}
            crop={crop.crop}
            isDefault={crop.isDefault}
            onChange={(next) => onChange({ ...options, crop: next })}
            onReset={() => onChange({ ...options, crop: null })}
            disabled={disabled}
            maxStageHeight={maxCropHeight}
            routeId={routeId}
          />
        </Section>
      ) : null}

      <Section title={t('shareCard.shows')}>
        <View style={styles.chips} testID={`${routeId}.elements`}>
          {choices.elements.map((element) => (
            <Chip
              key={element}
              label={elementLabel(element)}
              selected={options.show.includes(element)}
              selectionRole="checkbox"
              disabled={disabled}
              onPress={() => onChange(toggleShareCardElement(options, element))}
              testID={`${routeId}.element.${element}`}
            />
          ))}
        </View>
      </Section>

      {/* R5DQ-14: one label for one field. The field's own label ("Eigener Text") stands where a section title would. */}
      <ShareCardTextField value={options.text} onChange={(text) => onChange({ ...options, text })} serverError={textError} disabled={disabled} routeId={routeId} />

      {takesTheme ? (
        <Section title={t('shareCard.theme')}>
          <SegmentedControl<ShareCardTheme>
            options={[
              { value: 'dark', label: t('shareCard.themes.dark') },
              { value: 'light', label: t('shareCard.themes.light') },
            ]}
            value={options.theme}
            onChange={(theme) => onChange({ ...options, theme })}
            label={t('shareCard.theme')}
            role="radiogroup"
            disabled={disabled}
            testID={`${routeId}.theme`}
          />
        </Section>
      ) : null}

      {isDefault ? null : (
        <Button label={t('shareCard.reset')} variant="tertiary" size="m" flush="start" onPress={onReset} disabled={disabled} testID={`${routeId}.reset`} />
      )}
    </View>
  );
}

/**
 * R5DQ-19: the customiser's geometry while the card loads (the template row at the format's aspect, the photo row, the crop's
 * title), so the page does not grow under the reader once it arrives.
 */
export function ShareCardCustomiserSkeleton({ format, routeId }: { format: ShareCardFormat; routeId: string }) {
  const styles = useStyles();
  const aspect = format === 'story' ? 9 / 16 : 1;
  return (
    <Skeleton style={styles.root} testID={`${routeId}.customiseSkeleton`}>
      <View style={styles.group}>
        <SkeletonText variant="calloutStrong" width="24%" lastLineWidth="24%" />
        <View style={styles.skeletonRow}>
          {[0, 1, 2].map((index) => (
            <View key={index} style={styles.skeletonTemplate}>
              <SkeletonBlock width="100%" aspectRatio={aspect} corner="sm" />
              <SkeletonText variant="caption" width="50%" lastLineWidth="50%" />
            </View>
          ))}
        </View>
      </View>
      <View style={styles.group}>
        <SkeletonText variant="calloutStrong" width="16%" lastLineWidth="16%" />
        <View style={styles.photos}>
          {[0, 1, 2].map((index) => (
            <View key={index} style={styles.skeletonPhoto}>
              <SkeletonBlock width="100%" aspectRatio={1} corner="sm" />
            </View>
          ))}
        </View>
      </View>
      <SkeletonText variant="calloutStrong" width="28%" lastLineWidth="28%" />
    </Skeleton>
  );
}
