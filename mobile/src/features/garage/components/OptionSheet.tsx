import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles, space } from '@/theme';
import { Button, EmptyState, ErrorState, Icon, ListRow, SearchBar, Sheet, Skeleton, SkeletonText, TextInput } from '@/ui';

export type SheetOption = { value: string; label: string; detail?: string };

export type OptionSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: readonly SheetOption[];
  value?: string | null;
  onSelect: (option: SheetOption) => void;
  /** A search field above the list, for the catalogue. */
  searchPlaceholder?: string;
  /** "Nicht gefunden?": the member types the name, which is saved as free text and filed as a catalogue request. */
  freeText?: { label: string; inputLabel: string; helper: string; submitLabel: string; initial?: string; onSubmit: (text: string) => void; maxLength: number };
  /** "Keine Angabe": clears the value. */
  clearLabel?: string;
  onClear?: () => void;
  loading?: boolean;
  error?: { onRetry: () => void; retrying: boolean };
  testID: string;
};

/** Search results never list more than this; the catalogue is short, the cap keeps a sheet light. */
const MAX_ROWS = 80;
const SKELETON_ROWS = 6;

const useStyles = createStyles((t) => ({
  body: { gap: t.space[12], paddingBottom: t.space[8] },
  list: { marginHorizontal: -t.space[4] },
  free: { gap: t.space[16], paddingTop: t.space[4] },
  freeActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], justifyContent: 'space-between' },
  skeletonRow: { justifyContent: 'center', minHeight: t.size.row.single },
  check: { paddingLeft: t.space[8] },
}));

/** Lowercase without accents: "skoda" finds "Škoda". */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function filterOptions(options: readonly SheetOption[], query: string): SheetOption[] {
  const needle = searchKey(query);
  if (!needle) return options.slice(0, MAX_ROWS);
  const starts: SheetOption[] = [];
  const contains: SheetOption[] = [];
  for (const option of options) {
    const key = searchKey(option.label);
    if (key.startsWith(needle) || key.split(/[\s-]+/).some((word) => word.startsWith(needle))) starts.push(option);
    else if (key.includes(needle)) contains.push(option);
  }
  return [...starts, ...contains].slice(0, MAX_ROWS);
}

/**
 * The picker of §9: a bottom sheet with an optional search, the options as rows with a check on the chosen one, and the
 * catalogue's "Nicht gefunden?" path to free text. The option sets are short and bounded (48 makes, at most 65 brands of a
 * category), so the rows render inside the sheet's own measured scroll body.
 */
export function OptionSheet(props: OptionSheetProps) {
  const { visible, onClose, title, searchPlaceholder, testID } = props;
  return (
    <Sheet visible={visible} onClose={onClose} title={title} initialSnap={searchPlaceholder ? 'full' : 'content'} testID={testID}>
      {/* The body unmounts with the sheet, so each opening starts with an empty search. */}
      <OptionSheetBody {...props} />
    </Sheet>
  );
}

function OptionSheetBody({
  onClose,
  options,
  value,
  onSelect,
  searchPlaceholder,
  freeText,
  clearLabel,
  onClear,
  loading = false,
  error,
  testID,
}: OptionSheetProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState(freeText?.initial ?? '');

  const shown = useMemo(() => filterOptions(options, query), [options, query]);
  const pick = (option: SheetOption) => {
    onSelect(option);
    onClose();
  };
  const submitText = () => {
    const trimmed = text.trim();
    if (!trimmed || !freeText) return;
    freeText.onSubmit(trimmed);
    onClose();
  };

  let list;
  if (loading) {
    list = (
      <Skeleton testID={`${testID}.skeleton`}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index} style={styles.skeletonRow}>
            <SkeletonText variant="body" width="50%" />
          </View>
        ))}
      </Skeleton>
    );
  } else if (error) {
    list = <ErrorState title={t('catalog.errorTitle')} onRetry={error.onRetry} retrying={error.retrying} testID={`${testID}.error`} />;
  } else if (shown.length === 0) {
    list = (
      <EmptyState
        icon="magnifying-glass"
        title={t('catalog.noMatchTitle')}
        body={freeText ? t('catalog.noMatchFreeText') : t('catalog.noMatchBody')}
        hyphenateBody={false}
        testID={`${testID}.noMatch`}
      />
    );
  } else {
    list = (
      <View role="list" style={styles.list}>
        {/* A list holds list items (axe aria-required-children); the row inside stays the button. */}
        {shown.map((option, index) => (
          <View key={option.value} role="listitem">
            <ListRow
              title={option.label}
              subtitle={option.detail}
              role="button"
              chevron={false}
              control={option.value === value ? <SelectedMark label={t('catalog.selected')} /> : undefined}
              onPress={() => pick(option)}
              inset={space[4]}
              divider={index < shown.length - 1}
              testID={`${testID}.option.${option.value}`}
            />
          </View>
        ))}
      </View>
    );
  }

  return typing && freeText ? (
        <View style={styles.free}>
          <TextInput
            label={freeText.inputLabel}
            helper={freeText.helper}
            value={text}
            onChangeText={setText}
            maxLength={freeText.maxLength}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submitText}
            testID={`${testID}.freeText.input`}
          />
          <View style={styles.freeActions}>
            <Button label={t('catalog.backToList')} variant="tertiary" size="m" onPress={() => setTyping(false)} testID={`${testID}.freeText.back`} />
            <Button label={freeText.submitLabel} size="m" onPress={submitText} disabled={!text.trim()} testID={`${testID}.freeText.submit`} />
          </View>
        </View>
      ) : (
        <View style={styles.body}>
          {searchPlaceholder ? (
            <SearchBar value={query} onChangeText={setQuery} placeholder={searchPlaceholder} testID={`${testID}.search`} />
          ) : null}
          {list}
          {onClear && clearLabel ? (
            <ListRow title={clearLabel} role="button" chevron={false} onPress={() => { onClear(); onClose(); }} inset={space[0]} testID={`${testID}.clear`} />
          ) : null}
          {freeText ? (
            <ListRow
              icon="pencil-simple"
              title={freeText.label}
              role="button"
              onPress={() => {
                setText(query.trim() || (freeText.initial ?? ''));
                setTyping(true);
              }}
              inset={space[0]}
              testID={`${testID}.notFound`}
            />
          ) : null}
        </View>
      );
}

/** The check on the chosen row. */
export function SelectedMark({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.check}>
      <Icon name="check" size={20} color="text.primary" label={label} />
    </View>
  );
}
