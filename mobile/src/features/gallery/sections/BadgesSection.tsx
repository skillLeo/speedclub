import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { TAB_DESTINATIONS, type TabName } from '@/features/shell/destinations';
import { useRailWidth } from '@/features/shell/Rail';
import { tabLabelCap } from '@/features/shell/TabBar';
import { TabButton, type TabButtonVariant } from '@/features/shell/TabButton';
import { createStyles, useBreakpoint } from '@/theme';
import { Photo, Progress, SpecChip, StatusPill, UnreadBadge } from '@/ui';
import { ForcedVisualStateProvider, type ForcedVisualState } from '@/ui/qaVisualState';

import { PHOTOS } from '../data';
import { FullBleed, Group, SectionScreen, Specimen, Wrap } from '../parts';

const useStyles = createStyles((t) => ({
  ring: { position: 'absolute', right: t.space[8], top: t.space[8] },
  tile: { flexBasis: '40%', flexGrow: 1 },
  bar: { backgroundColor: t.color.bg.surface, flexDirection: 'row', width: '100%' },
  // Above the phone the real shell has no bar: cells of 72, the tightest it ever gets.
  barCapped: { maxWidth: t.layout.rail * 5 },
  rail: { backgroundColor: t.color.bg.canvas },
  sidebar: { backgroundColor: t.color.bg.canvas, maxWidth: t.layout.sidebar, paddingHorizontal: t.space[12], width: '100%' },
}));

/** On a phone the bar runs edge to edge as it does in the real shell, so its cells have the real width: 72 at 360. */
function BarSpecimen(props: { count: number; focusedTab?: TabName }) {
  const { kind } = useBreakpoint();
  const bar = <TabBadgeSpecimen variant="bar" {...props} />;
  return kind === 'phone' ? <FullBleed>{bar}</FullBleed> : bar;
}

/** 3, 42 and 99+ on Nachrichten, with the dot on Start. */
const BADGE_COUNTS = [3, 42, 128] as const;
const NOT_FORCED: ForcedVisualState = {};
const FOCUSED: ForcedVisualState = { focused: true };

/** The real tab buttons at the real metrics of the bar, rail or sidebar. Phase 2 feeds them from useTabBadges. */
function TabBadgeSpecimen({ variant, count, focusedTab }: { variant: TabButtonVariant; count: number; focusedTab?: TabName }) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const railWidth = useRailWidth();
  const { kind } = useBreakpoint();
  const [barWidth, setBarWidth] = useState(0);
  return (
    <View
      role="tablist"
      aria-label={`${variant} ${count}`}
      aria-orientation={variant === 'bar' ? 'horizontal' : 'vertical'}
      style={[styles[variant], variant === 'rail' ? { width: railWidth } : null, variant === 'bar' && kind !== 'phone' ? styles.barCapped : null]}
      onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
      testID={`DEV-01.badges.${variant}.${count}`}
    >
      {TAB_DESTINATIONS.map((destination) => (
        <ForcedVisualStateProvider key={destination.name} value={destination.name === focusedTab ? FOCUSED : NOT_FORCED}>
          <TabButton
            variant={variant}
            labelCap={variant === 'bar' ? tabLabelCap(barWidth / TAB_DESTINATIONS.length) : undefined}
            icon={destination.icon}
            label={t(destination.labelKey)}
            isFocused={destination.name === 'home'}
            count={destination.name === 'messages' ? count : undefined}
            dotLabel={destination.name === 'home' ? t('a11y.unreadNotifications') : undefined}
            testID={`DEV-01.badges.${variant}.${count}.${destination.name}`}
          />
        </ForcedVisualStateProvider>
      ))}
    </View>
  );
}

export function BadgesSection() {
  const styles = useStyles();
  return (
    <SectionScreen section="badges" focusableScroll>
      <Group title="Spec-Chip" note="24 hoch, Radius 4, statisch.">
        <Wrap>
          <SpecChip label="500 PS" testID="DEV-01.badges.specChip" />
          <SpecChip label="540 Nm" />
          <SpecChip label="AWD" />
          <SpecChip label="2,6 l R6 Biturbo" />
          <SpecChip label="6-Gang manuell" testID="DEV-01.badges.specChipHyphen" />
        </Wrap>
      </Group>
      <Group title="Status-Pill" note="20 hoch, Radius 4, auch für den Rechtsstatus.">
        <Wrap>
          <StatusPill label="Verbaut" testID="DEV-01.badges.status" />
          <StatusPill label="Geplant" />
          <StatusPill label="Entfernt" />
          <StatusPill label="TÜV eingetragen" />
        </Wrap>
      </Group>
      <Group title="Unread-Badge" note="Punkt 8 oder Pill 18, accent.fill mit weißem Text.">
        <Wrap>
          <Specimen label="Punkt">
            <UnreadBadge label="Neue Benachrichtigungen" testID="DEV-01.badges.dot" />
          </Specimen>
          <Specimen label="Einstellig">
            <UnreadBadge count={3} label="3 ungelesen" testID="DEV-01.badges.count" />
          </Specimen>
          <Specimen label="Zweistellig">
            <UnreadBadge count={42} label="42 ungelesen" />
          </Specimen>
          <Specimen label="Über 99">
            <UnreadBadge count={128} label="128 ungelesen" />
          </Specimen>
        </Wrap>
      </Group>
      <Group title="Unread in der Navigation" note="Zähler auf Nachrichten, Punkt auf Start. Leiste und Rail am Icon, Sidebar am Zeilenende.">
        {BADGE_COUNTS.map((count) => (
          <Specimen key={count} label={`Leiste · ${count > 99 ? '99+' : count}`} fill>
            <BarSpecimen count={count} />
          </Specimen>
        ))}
        <Wrap>
          {BADGE_COUNTS.map((count) => (
            <Specimen key={count} label={`Rail · ${count > 99 ? '99+' : count}`}>
              <TabBadgeSpecimen variant="rail" count={count} />
            </Specimen>
          ))}
        </Wrap>
        {BADGE_COUNTS.map((count) => (
          <Specimen key={count} label={`Sidebar · ${count > 99 ? '99+' : count}`} fill>
            <TabBadgeSpecimen variant="sidebar" count={count} />
          </Specimen>
        ))}
        <Specimen label="Tastaturfokus · Leiste" fill>
          <BarSpecimen count={1} focusedTab="garage" />
        </Specimen>
      </Group>
      <Group title="Fortschritt" note="2 hoch; Wizard mit vier Segmenten; Upload als Ring 20 auf der Kachel.">
        <Specimen label="Balken · Build zu 70 % vollständig" fill>
          <Progress label="Build zu 70 % vollständig" value={0.7} testID="DEV-01.badges.bar" />
        </Specimen>
        <Specimen label="Wizard · Schritt 2 von 4" fill>
          <Progress variant="wizard" label="Schritt 2 von 4" step={2} total={4} testID="DEV-01.badges.wizard" />
        </Specimen>
        <Wrap>
          <Specimen label="Ring 25 %">
            <Progress variant="ring" label="Upload zu 25 %" value={0.25} testID="DEV-01.badges.ring" />
          </Specimen>
          <Specimen label="Ring 75 %">
            <Progress variant="ring" label="Upload zu 75 %" value={0.75} />
          </Specimen>
        </Wrap>
        <Specimen label="Ring auf der Foto-Kachel" fill>
          <View style={styles.tile}>
            <Photo aspect="4:3" corner="sm" {...PHOTOS.e46}>
              <View style={styles.ring}>
                <Progress variant="ring" label="Upload zu 60 %" value={0.6} onPhoto />
              </View>
            </Photo>
          </View>
        </Specimen>
      </Group>
    </SectionScreen>
  );
}
