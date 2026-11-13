import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';
import { Button, Icon, SkeletonBlock, Text } from '@/ui';

import { grantMapConsent } from './mapConsent';

import type { MapMode, MapPin, MapPoint } from './mapConfig';

export type EventMapProps = {
  mode: MapMode;
  /** Explicit, so the box is known before the map loads. */
  height: number;
  center: MapPoint | null;
  zoom?: number;
  pins?: readonly MapPin[];
  selectedId?: string | null;
  /** Snippet: false draws the area ring of a private place (ADR-437 c) instead of the pin. */
  exact?: boolean;
  picked?: MapPoint | null;
  /** Accessible name of the map region. */
  label: string;
  onSelect?: (id: string | null) => void;
  onView?: (bbox: [number, number, number, number]) => void;
  onPick?: (point: MapPoint) => void;
  /** The map could not load (no network, the CDN or tiles refused): the screen offers its list instead. */
  onUnavailable?: () => void;
  /** The first tiles are drawn (DQ-1119 a: EVT-01 shows its "Tippe auf einen Punkt" hint only from then on). */
  onReady?: () => void;
  corner?: 'none' | 'md';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export type MapPhase = 'consent' | 'loading' | 'ready' | 'failed';

const useStyles = createStyles((t) => ({
  root: { backgroundColor: t.color.bg.surface, overflow: 'hidden', width: '100%' },
  rounded: { borderRadius: t.radius.md },
  layer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  failed: {
    alignItems: 'flex-start',
    flexGrow: 1,
    gap: t.space[8],
    justifyContent: 'center',
    padding: t.space[20],
  },
  consentAction: { marginTop: t.space[4] },
}));

/**
 * The box every map draws in (09 §5 MapView): a fixed height on the surface tone, a geometry skeleton until the first tiles, and a
 * plain "Karte gerade nicht verfügbar" when it cannot load — never a spinner, never an empty grey box.
 */
export function EventMapFrame({
  height,
  corner = 'none',
  phase,
  label,
  style,
  testID,
  children,
}: {
  height: number;
  corner?: 'none' | 'md';
  phase: MapPhase;
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  const { t } = useTranslation('events');
  return (
    <View
      role="region"
      aria-label={label}
      aria-busy={phase === 'loading'}
      // A gate or failure note grows with large text (fixed 176 clipped it at 200 %, m4.12-shots EVT-02 fs2); the map keeps its height.
      style={[
        styles.root,
        corner === 'md' ? styles.rounded : null,
        phase === 'consent' || phase === 'failed' ? { minHeight: height } : { height },
        style,
      ]}
      testID={testID}
      dataSet={{ qaExempt: 'photo' }}
    >
      {phase === 'consent' || phase === 'failed' ? null : children}
      {phase === 'loading' ? (
        <SkeletonBlock
          style={styles.layer}
          corner={corner === 'md' ? 'md' : 'none'}
          testID={testID ? `${testID}.skeleton` : undefined}
        />
      ) : null}
      {phase === 'consent' ? (
        <View style={styles.failed} testID={testID ? `${testID}.consent` : undefined}>
          <Icon name="map-trifold" size={24} color="text.secondary" />
          <Text variant="callout" color="text.secondary">
            {t('map.consentBody')}
          </Text>
          <Button
            label={t('map.consentAction')}
            variant="secondary"
            size="s"
            onPress={grantMapConsent}
            style={styles.consentAction}
            testID={testID ? `${testID}.load` : undefined}
          />
        </View>
      ) : null}
      {phase === 'failed' ? (
        <View style={styles.failed} testID={testID ? `${testID}.unavailable` : undefined}>
          <Icon name="map-trifold" size={24} color="text.secondary" />
          <Text variant="headline">{t('map.unavailableTitle')}</Text>
          <Text variant="callout" color="text.secondary">
            {t('map.unavailableBody')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
