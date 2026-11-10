import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';
import { Photo, PressableScale, Text, type PhotoFields } from '@/ui';
import { joinLabel } from '@/ui/rowParts';

export type CollectionCardProps = {
  title: string;
  subtitle?: string | null;
  /** "12 Builds", the real count of builds the viewer can see. */
  countLabel: string;
  photo: PhotoFields;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

const useStyles = createStyles((t) => ({
  body: { borderRadius: t.radius.md },
  text: { gap: t.space[2], marginTop: t.space[12] },
  count: { fontVariant: ['tabular-nums'] },
}));

/** FS-11 "Kollektionen": an admin-curated set of builds as a 16:9 card, its name in `title.s`, the real count below. */
export const CollectionCard = memo(function CollectionCard({ title, subtitle, countLabel, photo, onPress, style, testID }: CollectionCardProps) {
  const styles = useStyles();
  return (
    <PressableScale
      role="link"
      aria-label={isWeb ? undefined : joinLabel([title, subtitle, countLabel])}
      onPress={onPress}
      style={style}
      contentStyle={styles.body}
      testID={testID}
    >
      <Photo {...photo} aspect="16:9" corner="md" testID={`${testID}.photo`} />
      <View style={styles.text}>
        <Text variant="titleS">{title}</Text>
        {subtitle ? (
          <Text variant="supporting" color="text.secondary">
            {subtitle}
          </Text>
        ) : null}
        <Text variant="caption" color="text.tertiary" style={styles.count}>
          {countLabel}
        </Text>
      </View>
    </PressableScale>
  );
});
