import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size, space } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { joinLabel, RowBody, RowDivider, useRowInset, type RowInset } from './rowParts';
import { Skeleton, SkeletonText } from './Skeleton';
import { Text } from './Text';

export type ProductRowProps = {
  /** The category glyph, for example `coilover`. */
  icon: IconName;
  /** "KW": a text wordmark in Archivo SemiExpanded (no maker marks, 09 §4.6). */
  brand: string;
  /** "Variante 3" */
  name: string;
  /** "Fahrwerk" or "Fahrwerk · Gewindefahrwerk-Linie". */
  category: string;
  /** "In 14 Builds", a real count; left out where the list does not count. */
  builds?: string | null;
  /** "Archiviert", for a product that left the catalogue but still names mods. */
  note?: string | null;
  onPress?: () => void;
  divider?: boolean;
  inset?: RowInset;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.mod, paddingVertical: t.space[12] },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
}));

/**
 * 09 §5 ProductRow: the brand as a text wordmark, the product in `headline`, the category and the real count "In 14 Builds" (tnum) in
 * `caption`, a chevron when it opens BRD-02. Grouped-list row (≥ 64), the glyph monochrome.
 */
export const ProductRow = memo(function ProductRow({
  icon,
  brand,
  name,
  category,
  builds,
  note,
  onPress,
  divider = false,
  inset,
  style,
  testID,
}: ProductRowProps) {
  const styles = useStyles();
  const side = useRowInset(inset);
  const caption = [category, builds, note].filter(Boolean).join(' · ');
  return (
    <View style={style} testID={testID}>
      <RowBody
        onPress={onPress}
        label={joinLabel([brand, name, caption])}
        style={[styles.row, { paddingLeft: side, paddingRight: side }]}
        testID={testID ? `${testID}.body` : undefined}
      >
        <Icon name={icon} size={20} color="text.secondary" />
        <View style={styles.text}>
          <Text variant="displayWordmark" color="text.secondary" hyphenate={false} numberOfLines={1} testID={testID ? `${testID}.brand` : undefined}>
            {brand}
          </Text>
          <Text variant="headline" testID={testID ? `${testID}.name` : undefined}>
            {name}
          </Text>
          <Text variant="caption" color="text.secondary" numeric testID={testID ? `${testID}.caption` : undefined}>
            {caption}
          </Text>
        </View>
        {onPress ? <Icon name="caret-right" size={16} color="text.tertiary" /> : null}
      </RowBody>
      {divider ? <RowDivider inset={side} lead={size.icon.m + space[12]} /> : null}
    </View>
  );
});

/** The rows while a list loads, in the same geometry. */
export function ProductRowSkeleton({ rows = 3, inset = space[16] }: { rows?: number; inset?: number }) {
  const styles = useStyles();
  return (
    <Skeleton>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={[styles.row, { paddingLeft: inset, paddingRight: inset }]}>
          <SkeletonText variant="headline" width={size.icon.m} />
          <View style={styles.text}>
            <SkeletonText variant="displayWordmark" width="25%" />
            <SkeletonText variant="headline" width="55%" />
            <SkeletonText variant="caption" width="40%" />
          </View>
        </View>
      ))}
    </Skeleton>
  );
}
