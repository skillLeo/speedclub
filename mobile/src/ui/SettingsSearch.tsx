import { View } from 'react-native';

import { createStyles } from '@/theme';

import { ListRow } from './ListRow';
import { RowGroup, SECTION_HEADER_ROLE } from './RowGroup';
import { SearchBar } from './SearchBar';
import { Text } from './Text';

export type SettingsSearchResult = {
  id: string;
  title: string;
  /** Where it lives: the page of a sub-setting, the section of a page. */
  detail: string;
  onPress: () => void;
};

export type SettingsSearchProps = {
  value: string;
  onChangeText: (text: string) => void;
  /** Visible hint and accessible name of the field ("Einstellungen durchsuchen"). */
  placeholder: string;
  /** The matches for `value`, best first; ignored while `value` is empty. */
  results: readonly SettingsSearchResult[];
  /** Said when nothing matches: one line naming the query ("Nichts zu „Reifen“ gefunden."). */
  emptyTitle: string;
  /** One line with a way on ("Versuch ein anderes Wort, etwa „Passwort“ oder „Einheiten“."). */
  emptyBody: string;
  /** The header above the matches, also a live region: their number ("3 Treffer"). */
  resultsAnnouncement: string;
  testID: string;
};

const useStyles = createStyles((t) => ({
  root: { gap: t.space[24] },
  results: { gap: t.space[8] },
  // In line with the text of the rows below (RowGroup's header).
  count: { paddingHorizontal: t.space[16] },
  empty: { gap: t.space[4], paddingHorizontal: t.space[16] },
}));

/**
 * SET-26 SettingsSearch (09 §5, §7.9): the search field at the top of SET-01 and, while it holds a query, its matches as one
 * grouped list (title, where it lives, chevron) in place of the settings. Enter opens the first match; the matches are ordinary
 * buttons in the tab order after the field, so the keyboard reaches them on the web. The caller owns the index and the query, so
 * the same field works for any static index.
 */
export function SettingsSearch({
  value,
  onChangeText,
  placeholder,
  results,
  emptyTitle,
  emptyBody,
  resultsAnnouncement,
  testID,
}: SettingsSearchProps) {
  const styles = useStyles();
  const searching = value.trim().length > 0;
  return (
    <View style={styles.root} testID={testID}>
      <SearchBar
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        onSubmit={() => results[0]?.onPress()}
        onCancel={() => onChangeText('')}
        returnKeyType="search"
        testID={`${testID}.field`}
      />
      {searching ? (
        <>
          {results.length > 0 ? (
            <View style={styles.results}>
              <Text
                variant={SECTION_HEADER_ROLE}
                color="text.secondary"
                role="status"
                aria-live="polite"
                style={styles.count}
                testID={`${testID}.count`}
              >
                {resultsAnnouncement}
              </Text>
              <RowGroup testID={`${testID}.results`}>
              {results.map((result, index) => (
                <ListRow
                  key={result.id}
                  title={result.title}
                  subtitle={result.detail}
                  onPress={result.onPress}
                  role="link"
                  divider={index < results.length - 1}
                  testID={`${testID}.result.${result.id}`}
                />
              ))}
              </RowGroup>
            </View>
          ) : (
            <View style={styles.empty} role="status" aria-live="polite" testID={`${testID}.empty`}>
              <Text variant="headline">{emptyTitle}</Text>
              <Text variant="callout" color="text.secondary">
                {emptyBody}
              </Text>
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}
