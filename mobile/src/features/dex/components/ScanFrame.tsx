import { View } from 'react-native';

import { createStyles } from '@/theme';

const useStyles = createStyles((t) => {
  const arm = t.space[32];
  const stroke = t.space[4];
  const corner = { borderColor: t.color.onPhoto.primary, height: arm, position: 'absolute' as const, width: arm };
  return {
    frame: { pointerEvents: 'none' },
    topLeft: { ...corner, borderLeftWidth: stroke, borderTopLeftRadius: t.radius.md, borderTopWidth: stroke, left: 0, top: 0 },
    topRight: { ...corner, borderRightWidth: stroke, borderTopRightRadius: t.radius.md, borderTopWidth: stroke, right: 0, top: 0 },
    bottomLeft: { ...corner, borderBottomLeftRadius: t.radius.md, borderBottomWidth: stroke, borderLeftWidth: stroke, bottom: 0, left: 0 },
    bottomRight: { ...corner, borderBottomRightRadius: t.radius.md, borderBottomWidth: stroke, borderRightWidth: stroke, bottom: 0, right: 0 },
  };
});

/** DEX-02's corner frame: four white corners where the sticker goes. Decoration: hidden from readers, the hint says it. */
export function ScanFrame({ side, testID }: { side: number; testID: string }) {
  const styles = useStyles();
  return (
    <View aria-hidden style={[styles.frame, { width: side, height: side }]} testID={testID}>
      <View style={styles.topLeft} />
      <View style={styles.topRight} />
      <View style={styles.bottomLeft} />
      <View style={styles.bottomRight} />
    </View>
  );
}
