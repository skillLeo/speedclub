import { useState } from 'react';
import { View } from 'react-native';

import { EMPTY_HERO } from '@/features/garage/sample';
import { createStyles } from '@/theme';
import { MediaCard } from '@/ui';

const useStyles = createStyles((t) => ({
  // A picture of the state, not content: no pointer, and the stage keeps its corner like inset hero media (radius 20).
  root: { borderRadius: t.radius.xl, overflow: 'hidden', pointerEvents: 'none' },
}));

/** The sample build of the preview: a real car on a licensed seed photo (design/seed-photos/CREDITS.md), always badged. */
const SAMPLE_TITLE = 'BMW M3 E46'; // i18n-ignore
/** Factory figures of the E46 M3 (S54). */
const SAMPLE_SPEC = '343 PS · 365 Nm'; // i18n-ignore

/**
 * DQ-1033 (09 §5 EmptyState): the preview of an empty "Für dich": one lead card as the feed will look, badged "Beispiel". It is
 * hidden from readers and takes no taps; the state's own title and button say what to do.
 */
export function SampleLead({ routeId }: { routeId: string }) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  return (
    <View
      aria-hidden
      style={styles.root}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      testID={`${routeId}.empty.sample`}
    >
      <MediaCard
        variant="lead"
        title={SAMPLE_TITLE}
        photo={EMPTY_HERO}
        spec={SAMPLE_SPEC}
        sample={{ is_sample: true }}
        layoutWidth={width > 0 ? width : undefined}
        testID={`${routeId}.empty.sample.card`}
      />
    </View>
  );
}
