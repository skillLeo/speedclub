import { useRef, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import type { StickerOptions, StickerTemplateKey, StickerTemplates } from '@/api/queries/stickers';
import { RadioRows } from '@/features/settings/components/SettingRows';
import { formatNumber } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space } from '@/theme';
import { Chip } from '@/ui/Chip';
import { Hairline } from '@/ui/Hairline';
import { ListRow } from '@/ui/ListRow';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Switch } from '@/ui/Switch';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';

import { QrNotice } from '../components/parts';
import {
  COLOURWAY_ORDER,
  CUSTOM_LINE_MAX,
  MATERIAL_ORDER,
  SIZE_ORDER,
  TEMPLATE_ORDER,
  graphemeCount,
  materialsFor,
  textOptionsFor,
  type CustomLineIssue,
  type DesignState,
  type StickerColourwayKey,
  type StickerSizeKey,
} from './model';

const ROW_INSET = space[16];

const useStyles = createStyles((t) => ({
  rail: { gap: t.space[8], paddingVertical: t.space[4] },
  railWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], paddingVertical: t.space[4] },
  section: { gap: t.space[8], marginTop: t.space[24] },
  first: { marginTop: t.space[8] },
  group: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  field: { padding: t.space[16] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], padding: t.space[16] },
  sizes: { gap: t.space[8], padding: t.space[16] },
  links: { marginTop: t.space[24] },
}));

/** The template rail (10 §2.3: six templates): chips in a row that scrolls sideways. */
export function TemplateRail({
  value,
  templates,
  onChange,
  disabled,
  wrap = false,
  testID,
}: {
  value: StickerTemplateKey;
  templates?: StickerTemplates | null;
  onChange: (next: StickerTemplateKey) => void;
  disabled?: boolean;
  /** The side column (from 900): the chips wrap, so every template stays reachable without a swipe (DQ-M54-06). */
  wrap?: boolean;
  testID: string;
}) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const chips = TEMPLATE_ORDER.map((key) => (
    <Chip
      key={key}
      label={
        templates?.templates.find((entry) => entry.key === key)?.name ?? t(`designer.template.names.${key}`)
      }
      selected={key === value}
      selectionRole="radio"
      disabled={disabled}
      onPress={() => onChange(key)}
      testID={`${testID}.template.${key}`}
    />
  ));
  if (wrap) {
    return (
      <View
        style={styles.railWrap}
        role="radiogroup"
        aria-label={t('designer.template.group')}
        testID={`${testID}.templates`}
      >
        {chips}
      </View>
    );
  }
  return (
    <ScrollingRail value={value} testID={testID} label={t('designer.template.group')}>
      {chips}
    </ScrollingRail>
  );
}

/** DQ-M54R2-07: the phone rail opens with the chosen template in view (no animation), so a saved Round never hides its selection. */
function ScrollingRail({
  value,
  label,
  testID,
  children,
}: {
  value: StickerTemplateKey;
  label: string;
  testID: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  const rail = useRef<ComponentRef<typeof ScrollView>>(null);
  const placed = useRef(false);
  const index = TEMPLATE_ORDER.indexOf(value);
  return (
    <ScrollView
      ref={rail}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      role="radiogroup"
      aria-label={label}
      testID={`${testID}.templates`}
      onContentSizeChange={(contentWidth) => {
        if (placed.current || index <= 0 || contentWidth <= 0) return;
        placed.current = true;
        // Chips are about equal in width: the chosen one's share of the row, less a gutter, brings it into view.
        rail.current?.scrollTo({
          x: Math.max(0, (contentWidth * index) / TEMPLATE_ORDER.length - space[20]),
          animated: false,
        });
      }}
    >
      {children}
    </ScrollView>
  );
}

export type DesignerControlsProps = {
  state: DesignState;
  templates?: StickerTemplates | null;
  /** The field's issue: the editor's own check or the server's refusal ("content_blocked"). */
  customLineError: string | null;
  customLineIssue: CustomLineIssue | null;
  /** A suspended owner, view-as, a conflict waiting for a decision. */
  disabled: boolean;
  /** "Spiegeldruck geht nur auf transparenter Folie": what the editor changed on its own. */
  ruleNote: string | null;
  onOptions: (patch: Partial<StickerOptions>, coalesce?: string) => void;
  onCustomLineBlur: () => void;
  onOpenHistory: () => void;
  onOpenPlacement: () => void;
  testID: string;
};

/** Every option of 10 §2.3, grouped as the member thinks about it: what is on it, how it is printed, how big it is. */
export function DesignerControls({
  state,
  templates,
  customLineError,
  customLineIssue,
  disabled,
  ruleNote,
  onOptions,
  onCustomLineBlur,
  onOpenHistory,
  onOpenPlacement,
  testID,
}: DesignerControlsProps) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const format = useFormat();
  const { options } = state;
  const shown = textOptionsFor(state.template, templates);
  const allowedMaterials = materialsFor(options.colourway, templates);
  const sizes = templates?.templates.find((entry) => entry.key === state.template)?.sizes ?? [];
  const mm = (value: number) => formatNumber(value, format.locale, { maxFractionDigits: 0 });
  const sizeText = (key: StickerSizeKey) => {
    const size = sizes.find((entry) => entry.key === key);
    return size ? t('designer.size.mm', { width: mm(size.width_mm), height: mm(size.height_mm) }) : '';
  };
  const current = sizes.find((entry) => entry.key === options.size);
  const lineLength = graphemeCount((options.custom_line ?? '').trim());
  const lineError =
    customLineError ??
    (customLineIssue
      ? t(`designer.content.customLineErrors.${customLineIssue}`, { max: CUSTOM_LINE_MAX })
      : undefined);

  return (
    <View testID={`${testID}.controls`}>
      {ruleNote ? <QrNotice message={ruleNote} style={styles.first} testID={`${testID}.ruleNote`} /> : null}

      <View style={[styles.section, ruleNote ? null : styles.first]}>
        <Text variant="calloutStrong" color="text.secondary" role="heading" aria-level={2}>
          {t('designer.content.title')}
        </Text>
        <View style={styles.group}>
          <ListRow
            title={t('designer.content.qr')}
            subtitle={options.qr ? t('designer.content.qrOn') : undefined}
            inset={ROW_INSET}
            divider
            control={
              <Switch
                value={options.qr}
                onValueChange={(qr) => onOptions({ qr })}
                label={t('designer.content.qr')}
                disabled={disabled}
                testID={`${testID}.qr`}
              />
            }
          />
          {options.qr ? null : (
            <View style={styles.field}>
              <QrNotice
                message={t('designer.content.qrOffWarning')}
                tone="error"
                icon="warning"
                testID={`${testID}.qrOff`}
              />
            </View>
          )}
          {shown.includes('username') ? (
            <ListRow
              title={t('designer.content.username')}
              inset={ROW_INSET}
              divider={shown.includes('car_name') || shown.includes('custom_line')}
              control={
                <Switch
                  value={options.username}
                  onValueChange={(username) => onOptions({ username })}
                  label={t('designer.content.username')}
                  disabled={disabled}
                  testID={`${testID}.username`}
                />
              }
            />
          ) : null}
          {shown.includes('car_name') ? (
            <ListRow
              title={t('designer.content.carName')}
              inset={ROW_INSET}
              divider={shown.includes('custom_line')}
              control={
                <Switch
                  value={options.car_name}
                  onValueChange={(carName) => onOptions({ car_name: carName })}
                  label={t('designer.content.carName')}
                  disabled={disabled}
                  testID={`${testID}.carName`}
                />
              }
            />
          ) : null}
          {shown.includes('custom_line') ? (
            <View style={styles.field}>
              <TextInput
                label={t('designer.content.customLine')}
                value={options.custom_line ?? ''}
                onChangeText={(text) => onOptions({ custom_line: text }, 'custom_line')}
                onBlur={onCustomLineBlur}
                helper={t('designer.content.customLineHelper', { count: lineLength, max: CUSTOM_LINE_MAX })}
                error={lineError}
                disabled={disabled}
                autoCapitalize="sentences"
                autoCorrect={false}
                returnKeyType="done"
                testID={`${testID}.customLine`}
              />
            </View>
          ) : null}
        </View>
        {shown.length < 3 ? (
          <Text variant="caption" color="text.tertiary" testID={`${testID}.textNote`}>
            {t('designer.content.templateShows', {
              lines: shown.map((key) => t(`designer.content.short.${key}`)).join(', '),
            })}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text variant="calloutStrong" color="text.secondary" role="heading" aria-level={2}>
          {t('designer.print.title')}
        </Text>
        <View style={styles.group}>
          <RadioRows
            label={t('designer.print.colourway')}
            options={COLOURWAY_ORDER.map((key: StickerColourwayKey) => ({
              value: key,
              label:
                templates?.colourways.find((entry) => entry.key === key)?.name ??
                t(`designer.print.colourways.${key}.name`),
              helper:
                templates?.colourways.find((entry) => entry.key === key)?.hint ??
                t(`designer.print.colourways.${key}.hint`),
            }))}
            value={options.colourway}
            onChange={(colourway) => onOptions({ colourway })}
            disabled={disabled}
            testID={`${testID}.colourway`}
          />
          <Hairline inset={ROW_INSET} />
          <View style={styles.chips} role="radiogroup" aria-label={t('designer.print.material')}>
            {MATERIAL_ORDER.map((key) => (
              <Chip
                key={key}
                label={
                  templates?.materials.find((entry) => entry.key === key)?.name ??
                  t(`designer.print.materials.${key}`)
                }
                selected={options.material === key}
                selectionRole="radio"
                disabled={disabled || !allowedMaterials.includes(key)}
                onPress={() => onOptions({ material: key })}
                testID={`${testID}.material.${key}`}
              />
            ))}
          </View>
          <Hairline inset={ROW_INSET} />
          <ListRow
            title={t('designer.print.mirrored')}
            subtitle={t('designer.print.mirroredHelper')}
            inset={ROW_INSET}
            control={
              <Switch
                value={options.mirrored}
                onValueChange={(mirrored) =>
                  onOptions(mirrored ? { mirrored, material: 'transparent' } : { mirrored })
                }
                label={t('designer.print.mirrored')}
                disabled={disabled}
                testID={`${testID}.mirrored`}
              />
            }
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text variant="calloutStrong" color="text.secondary" role="heading" aria-level={2}>
          {t('designer.size.title')}
        </Text>
        <View style={[styles.group, styles.sizes]}>
          <SegmentedControl
            role="radiogroup"
            label={t('designer.size.title')}
            options={[
              { value: SIZE_ORDER[0] as StickerSizeKey, label: t('designer.size.s') },
              { value: SIZE_ORDER[1] as StickerSizeKey, label: t('designer.size.m') },
              { value: SIZE_ORDER[2] as StickerSizeKey, label: t('designer.size.l') },
            ]}
            value={options.size}
            onChange={(size) => onOptions({ size })}
            disabled={disabled}
            testID={`${testID}.size`}
          />
          {current ? (
            <Text variant="callout" color="text.secondary" testID={`${testID}.sizeMm`}>
              {options.qr
                ? t('designer.size.withQr', { size: sizeText(options.size), qr: mm(current.qr_mm) })
                : sizeText(options.size)}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.group, styles.links]}>
        <ListRow
          icon="clock"
          title={t('designer.history')}
          onPress={onOpenHistory}
          inset={ROW_INSET}
          divider
          testID={`${testID}.history`}
        />
        <ListRow
          icon="qr-sticker"
          title={t('detail.placement')}
          onPress={onOpenPlacement}
          inset={ROW_INSET}
          testID={`${testID}.placement`}
        />
      </View>
    </View>
  );
}
