import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { keepNameTogether } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space } from '@/theme';
import { Button, Chip, ListRow, RangeSlider, Skeleton, SkeletonBlock, Text, TextInput } from '@/ui';

import { chipLabel } from '../chipLabels';
import {
  currentYear,
  POWER_LIMITS,
  setRange,
  setSingle,
  sliderRange,
  toggleValue,
  YEAR_MIN,
  type FacetOption,
  type FilterOptions,
  type FilterRange,
  type MultiKey,
  type SearchFilters,
} from '../filters';

export type FilterPanelStatus = 'ready' | 'loading' | 'error' | 'offline';

export type FilterPanelProps = {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  options: FilterOptions;
  status: FilterPanelStatus;
  onRetry: () => void;
  retrying?: boolean;
  /** The make and model rows open their pickers. */
  onOpenPicker: (field: 'make' | 'model') => void;
  /** The chosen make's and model's names. */
  makeLabel: string | null;
  modelLabel: string | null;
  /** The active generation's name ("R34"), for its chip while the facets have not listed it (yet). */
  generationLabel?: string | null;
  /**
   * `sheet` inside the filter sheet (bg.raised): grouped rows step up to bg.overlay (DQ-334) and the first group keeps 16 from the
   * sheet's title. `panel` beside the results from 1280, on the canvas: grouped rows on bg.surface.
   */
  surface?: 'sheet' | 'panel';
  /** `<ROUTE-ID>.filters`; sections add `.<group>`, options `.<field>.<value>`. */
  testID: string;
};

type Group = { key: string; title: string; fields: readonly { field: MultiKey; title: string }[] };

const useStyles = createStyles((t) => ({
  root: { gap: t.space[32], paddingBottom: t.space[24] },
  rootSheet: { paddingTop: t.space[16] },
  rowsSheet: { backgroundColor: t.color.bg.overlay },
  group: { gap: t.space[16] },
  field: { gap: t.space[12] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  item: { maxWidth: '100%' },
  rows: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  years: { flexDirection: 'row', gap: t.space[12] },
  year: { flex: 1, minWidth: 0 },
  status: { alignItems: 'flex-start', gap: t.space[8] },
  skeletonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
}));

const SKELETON_CHIPS = 5;

/** The chips of one facet while the facets load: the same 36-high pills, in the place they will take. */
function ChipsSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeletonChips}>
      {Array.from({ length: SKELETON_CHIPS }, (_, index) => (
        <SkeletonBlock key={index} width={index % 2 === 0 ? space[64] + space[24] : space[64]} height={size.chip} corner="full" />
      ))}
    </View>
  );
}

function FacetChips({
  field,
  title,
  options,
  selected,
  onToggle,
  labelOf,
  testID,
}: {
  field: MultiKey;
  /** The field's name, the group's accessible name. */
  title: string;
  options: readonly FacetOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  labelOf: (option: FacetOption) => string;
  testID: string;
}) {
  const styles = useStyles();
  const { t } = useTranslation('discover');
  const format = useFormat();
  return (
    <View role="group" aria-label={title} style={styles.chips}>
      {options.map((option) => {
        const label = labelOf(option);
        return (
          <View key={option.value} style={styles.item}>
            <Chip
              label={label}
              count={option.count}
              accessibilityLabel={t('filters.optionLabel', { label, formatted: format.number(option.count), count: option.count })}
              selected={selected.includes(option.value)}
              onPress={() => onToggle(option.value)}
              testID={`${testID}.${field}.${option.value}`}
            />
          </View>
        );
      })}
    </View>
  );
}

/** Von / Bis as numbers. A field commits on blur or Enter; a year outside the catalogue says so under it. */
function YearInputs({ range, onCommit, testID }: { range: FilterRange; onCommit: (range: FilterRange) => void; testID: string }) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const upper = currentYear();
  const [low, setLow] = useState(range.min === null ? '' : String(range.min));
  const [high, setHigh] = useState(range.max === null ? '' : String(range.max));
  const [seen, setSeen] = useState(range);
  if (seen.min !== range.min || seen.max !== range.max) {
    setSeen(range);
    setLow(range.min === null ? '' : String(range.min));
    setHigh(range.max === null ? '' : String(range.max));
  }
  const parse = (text: string): number | null | 'invalid' => {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    if (!/^\d{4}$/.test(trimmed)) return 'invalid';
    const value = Number(trimmed);
    return value < YEAR_MIN || value > upper ? 'invalid' : value;
  };
  const lowValue = parse(low);
  const highValue = parse(high);
  const [touched, setTouched] = useState({ low: false, high: false });
  const error = t('filters.yearInvalid', { min: String(YEAR_MIN), max: String(upper) });
  // Every valid change goes up at once, so "… Ergebnisse anzeigen" never applies a draft without the year typed last; the
  // facets request waits for typing to settle (SearchScreen). An unfinished year says so once the field is left or full.
  const change = (side: 'low' | 'high', text: string) => {
    if (side === 'low') setLow(text);
    else setHigh(text);
    const nextLow = side === 'low' ? parse(text) : lowValue;
    const nextHigh = side === 'high' ? parse(text) : highValue;
    if (nextLow === 'invalid' || nextHigh === 'invalid') return;
    if (nextLow === range.min && nextHigh === range.max) return;
    onCommit({ min: nextLow, max: nextHigh });
  };
  const showError = (side: 'low' | 'high', text: string, value: number | null | 'invalid') =>
    value === 'invalid' && (touched[side] || text.trim().length >= 4) ? error : undefined;
  return (
    <View style={styles.years}>
      <TextInput
        label={t('filters.fields.yearFrom')}
        value={low}
        onChangeText={(text) => change('low', text)}
        onBlur={() => setTouched((before) => ({ ...before, low: true }))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={4}
        placeholder={String(YEAR_MIN)}
        error={showError('low', low, lowValue)}
        containerStyle={styles.year}
        testID={`${testID}.yearMin`}
      />
      <TextInput
        label={t('filters.fields.yearTo')}
        value={high}
        onChangeText={(text) => change('high', text)}
        onBlur={() => setTouched((before) => ({ ...before, high: true }))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={4}
        placeholder={String(upper)}
        error={showError('high', high, highValue)}
        containerStyle={styles.year}
        testID={`${testID}.yearMax`}
      />
    </View>
  );
}

/** §3.7 power: slider 50–1500 step 10 with two numeric inputs. Moves at once, commits once it rests. */
function PowerRange({ range, onCommit, testID }: { range: FilterRange; onCommit: (range: FilterRange) => void; testID: string }) {
  const { t } = useTranslation('discover');
  const format = useFormat();
  const outer: [number, number] = [range.min ?? POWER_LIMITS.min, range.max ?? POWER_LIMITS.max];
  const [value, setValue] = useState<readonly [number, number]>(outer);
  const [seen, setSeen] = useState(range);
  if (seen.min !== range.min || seen.max !== range.max) {
    setSeen(range);
    setValue(outer);
  }
  return (
    <RangeSlider
      min={POWER_LIMITS.min}
      max={POWER_LIMITS.max}
      step={POWER_LIMITS.step}
      value={value}
      // Every step goes up at once (the draft, or the panel's pending write); the network waits for the thumbs to rest.
      onChange={(next) => {
        setValue(next);
        onCommit(sliderRange(next));
      }}
      lowLabel={t('filters.fields.powerLow')}
      highLabel={t('filters.fields.powerHigh')}
      // The power filter is in PS whatever the display setting (SET-11): the API filters on PS.
      formatValue={(power) => t('chips.powerExact', { value: format.number(power) })}
      inputs={{ lowLabel: t('filters.fields.powerFrom'), highLabel: t('filters.fields.powerTo'), suffix: t('filters.powerUnit') }}
      testID={`${testID}.power`}
    />
  );
}

/**
 * The FS-11 filter groups, the same in the sheet and in the desktop panel: Fahrzeug (make, model, generation, year),
 * Leistung, Antrieb, Räder & Fahrwerk, Abgas, Mods. Each option carries its real facet count; a group with no value for
 * the current results is left out, an active value always stays.
 */
export function FilterPanel({
  filters,
  onChange,
  options,
  status,
  onRetry,
  retrying = false,
  onOpenPicker,
  makeLabel,
  modelLabel,
  generationLabel = null,
  surface = 'sheet',
  testID,
}: FilterPanelProps) {
  const { t } = useTranslation('discover');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const format = useFormat();
  const loading = status === 'loading';

  const groups: readonly Group[] = [
    {
      key: 'drive',
      title: t('filters.groups.drive'),
      fields: [
        { field: 'drivetrain', title: t('filters.fields.drivetrain') },
        { field: 'gearbox', title: t('filters.fields.gearbox') },
        { field: 'fuel', title: t('filters.fields.fuel') },
      ],
    },
    {
      key: 'wheels',
      title: t('filters.groups.wheels'),
      fields: [
        { field: 'wheel_diameter', title: t('filters.fields.wheelDiameter') },
        { field: 'wheel_brand', title: t('filters.fields.wheelBrand') },
        { field: 'suspension_type', title: t('filters.fields.suspensionType') },
        { field: 'suspension_brand', title: t('filters.fields.suspensionBrand') },
      ],
    },
    { key: 'exhaust', title: t('filters.groups.exhaust'), fields: [{ field: 'exhaust_brand', title: t('filters.fields.exhaustBrand') }] },
    { key: 'mods', title: t('filters.groups.mods'), fields: [{ field: 'mod_category', title: t('filters.fields.modCategory') }] },
  ];

  const labelOf = (field: MultiKey) => (option: FacetOption) =>
    field === 'wheel_diameter' ? chipLabel({ field, value: option.value }, t, format.number) : option.label;

  const statusBlock =
    status === 'error' || status === 'offline' ? (
      <View style={styles.status} testID={`${testID}.status`}>
        <Text variant="supporting" color="text.secondary">
          {status === 'offline' ? t('filters.offline') : t('filters.loadError')}
        </Text>
        {status === 'error' ? (
          <Button label={common('actions.retry')} variant="secondary" size="m" loading={retrying} onPress={onRetry} testID={`${testID}.retry`} />
        ) : null}
      </View>
    ) : null;

  // DQ-449: an active generation always has its control. Facets that have not listed it (a later answer, or an empty one under a
  // rate limit) still show it, selected, from the applied filter's own label, so its group never drops out of the panel.
  const listed = options.generation ?? [];
  const active = filters.model ? filters.generation : null;
  const unlisted = active !== null && !listed.some((option) => option.value === active);
  const generations: readonly FacetOption[] = unlisted && active ? [{ value: active, label: generationLabel ?? active, count: 0 }, ...listed] : listed;

  return (
    <View style={[styles.root, surface === 'sheet' ? styles.rootSheet : null]} testID={testID}>
      {statusBlock}
      <View style={styles.group} testID={`${testID}.vehicle`}>
        <Text variant="titleS" role="heading" {...({ 'aria-level': 3 } as object)}>
          {t('filters.groups.vehicle')}
        </Text>
        <View style={[styles.rows, surface === 'sheet' ? styles.rowsSheet : null]}>
          <ListRow
            title={t('filters.fields.make')}
            value={makeLabel ? keepNameTogether(makeLabel) : t('filters.any')}
            hyphenate={false}
            role="button"
            onPress={() => onOpenPicker('make')}
            divider
            inset={space[16]}
            testID={`${testID}.make`}
          />
          <ListRow
            title={t('filters.fields.model')}
            subtitle={filters.make ? undefined : t('filters.modelNeedsMake')}
            value={filters.make ? (modelLabel ? keepNameTogether(modelLabel) : t('filters.any')) : undefined}
            hyphenate={false}
            role="button"
            disabled={!filters.make}
            onPress={() => {
              // Inert without a make, but still a button that says so (aria-disabled), with its reason as the subtitle.
              if (filters.make) onOpenPicker('model');
            }}
            inset={space[16]}
            testID={`${testID}.model`}
          />
        </View>
        {filters.model && (generations.length > 0 || loading) ? (
          <View style={styles.field}>
            <Text variant="labelS" color="text.secondary">
              {t('filters.fields.generation')}
            </Text>
            {loading && listed.length === 0 && !active ? (
              <Skeleton>
                <ChipsSkeleton />
              </Skeleton>
            ) : (
              <View role="radiogroup" aria-label={t('filters.fields.generation')} style={styles.chips}>
                {generations.map((option) => (
                  <View key={option.value} style={styles.item}>
                    <Chip
                      label={option.label}
                      // The active one before the facets count it: no "0" beside a filter that is applied.
                      count={unlisted && option.value === active ? undefined : option.count}
                      accessibilityLabel={
                        unlisted && option.value === active
                          ? option.label
                          : t('filters.optionLabel', { label: option.label, formatted: format.number(option.count), count: option.count })
                      }
                      selected={filters.generation === option.value}
                      selectionRole="radio"
                      onPress={() => onChange(setSingle(filters, 'generation', filters.generation === option.value ? null : option.value))}
                      testID={`${testID}.generation.${option.value}`}
                    />
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}
        {/* DQ-328: the inputs name themselves ("Baujahr von", "Baujahr bis"), so no second label row sits above their labels. */}
        <View style={styles.field}>
          <YearInputs range={filters.year} onCommit={(range) => onChange(setRange(filters, 'year', range))} testID={testID} />
        </View>
      </View>

      <View style={styles.group} testID={`${testID}.power`}>
        <Text variant="titleS" role="heading" {...({ 'aria-level': 3 } as object)}>
          {t('filters.groups.power')}
        </Text>
        <PowerRange range={filters.power} onCommit={(range) => onChange(setRange(filters, 'power', range))} testID={testID} />
      </View>

      {groups.map((group) => {
        const fields = group.fields.filter(({ field }) => loading || (options[field]?.length ?? 0) > 0 || filters[field].length > 0);
        if (fields.length === 0) return null;
        return (
          <View key={group.key} style={styles.group} testID={`${testID}.${group.key}`}>
            <Text variant="titleS" role="heading" {...({ 'aria-level': 3 } as object)}>
              {group.title}
            </Text>
            {fields.map(({ field, title }) => {
              const list = options[field] ?? [];
              // An active value the facets no longer list (a shared link, a value with no build left) stays removable here.
              const missing = filters[field]
                .filter((value) => !list.some((option) => option.value === value))
                .map((value) => ({ value, label: chipLabel({ field, value }, t, format.number), count: 0 }));
              const shown = [...list, ...missing];
              return (
                <View key={field} style={styles.field}>
                  <Text variant="labelS" color="text.secondary">
                    {title}
                  </Text>
                  {loading && shown.length === 0 ? (
                    <Skeleton>
                      <ChipsSkeleton />
                    </Skeleton>
                  ) : (
                    <FacetChips
                      field={field}
                      title={title}
                      options={shown}
                      selected={filters[field]}
                      onToggle={(value) => onChange(toggleValue(filters, field, value))}
                      labelOf={labelOf(field)}
                      testID={testID}
                    />
                  )}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
