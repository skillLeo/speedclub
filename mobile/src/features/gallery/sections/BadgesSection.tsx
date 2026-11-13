import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { TAB_DESTINATIONS, type TabName } from '@/features/shell/destinations';
import { useRailWidth } from '@/features/shell/Rail';
import { tabLabelCap } from '@/features/shell/TabBar';
import { TabButton, type TabButtonVariant } from '@/features/shell/TabButton';
import { createStyles, radius, size, useBreakpoint } from '@/theme';
import { Badge, GridTile, MemberRow, Photo, Progress, SampleBadges, SpecChip, StatusPill, UnreadBadge, VehicleCard, type BadgeKind } from '@/ui';
import { ForcedVisualStateProvider, type ForcedVisualState } from '@/ui/qaVisualState';

import { E46, LUKAS, noop, PHOTOS, R34 } from '../data';
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

const BADGE_KINDS: readonly { kind: BadgeKind; label: string }[] = [
  { kind: 'sample', label: 'Beispiel' },
  { kind: 'editorial', label: 'Editorial' },
  { kind: 'verified', label: 'Verifiziert' },
  { kind: 'business', label: 'Betrieb' },
  { kind: 'founding', label: 'Gründungsmitglied' },
  { kind: 'dyno', label: 'Prüfstand' },
];

/** M4.2 / 09 §8.19: where the app draws sample content, it says so. Counts on samples come null and are not drawn. */
function SampleSurfaces() {
  const styles = useStyles();
  return (
    <Group title="Beispielinhalte" note="is_sample und is_editorial aus der API. Zähler sind bei Beispielen null und bleiben unsichtbar, nie 0.">
      <Specimen label="Fahrzeugkarte · Beispiel und Hauptfahrzeug" fill>
        <VehicleCard
          title={R34.title}
          subtitle={R34.subtitle}
          photo={PHOTOS.r34}
          specs={R34.specs}
          isMain
          sample={{ is_sample: true }}
          onPress={noop}
          testID="DEV-01.badges.sample.card"
        />
      </Specimen>
      <Wrap>
        <Specimen label="Ergebnis-Kachel" style={styles.tile}>
          <GridTile title={E46.title} spec="343 PS · RWD" photo={PHOTOS.e46} sample={{ is_sample: true }} onPress={noop} testID="DEV-01.badges.sample.tile" />
        </Specimen>
      </Wrap>
      <Specimen label="Mitglied · Editorial-Konto" fill>
        <MemberRow
          name="SPEED CLUB Editorial"
          meta="@speedclub · Beispiel-Builds"
          sample={{ is_sample: true, is_editorial: true }}
          onPress={noop}
          inset={0}
          testID="DEV-01.badges.sample.member"
        />
      </Specimen>
      <Specimen label={`Echtes Mitglied · ${LUKAS.name}, kein Badge`} fill>
        <MemberRow name={LUKAS.name} meta={LUKAS.meta} sample={{ is_sample: false, is_editorial: false }} inset={0} testID="DEV-01.badges.sample.real" />
      </Specimen>
    </Group>
  );
}

export function BadgesSection() {
  const styles = useStyles();
  return (
    <SectionScreen section="badges" focusableScroll>
      <Group title="Badge" note="Höhe 20, Radius 4, label.badge 11/14 600, Satzschreibung, auf Carbon und Schwarz surface-3, auf Hell border.subtle, Schrift text.secondary (ADR-431 d). Nie rot. Beispiel ist Pflicht auf Beispielinhalten, Editorial markiert das Konto der Beispiel-Builds, Verifiziert führt mit dem Haken.">
        <Wrap>
          {BADGE_KINDS.map(({ kind, label }) => (
            <Specimen key={kind} label={label}>
              <Badge kind={kind} testID={`DEV-01.badges.badge.${kind}`} />
            </Specimen>
          ))}
        </Wrap>
        <Specimen label="Auf dem Foto · onPhoto-Grund" fill>
          <View style={styles.tile}>
            <Photo aspect="4:3" corner="sm" {...PHOTOS.wheels} label="Mehrteilige Felge vor Bremssattel">
              <SampleBadges flags={{ is_sample: true, is_editorial: true }} tone="onPhoto" style={styles.ring} testID="DEV-01.badges.badge.onPhoto" />
            </Photo>
          </View>
        </Specimen>
      </Group>
      <SampleSurfaces />
      <Group title="Spec-Chip" note={`${size.specChip} hoch, Radius ${radius.xs}, statisch.`}>
        <Wrap>
          <SpecChip label="500 PS" testID="DEV-01.badges.specChip" />
          <SpecChip label="540 Nm" />
          <SpecChip label="AWD" />
          <SpecChip label="2,6 l R6 Biturbo" />
          <SpecChip label="6-Gang manuell" testID="DEV-01.badges.specChipHyphen" />
        </Wrap>
      </Group>
      <Group title="Statusanzeige" note={`${size.statusPill} hoch, Radius ${radius.xs}, auch für den Rechtsstatus.`}>
        <Wrap>
          <StatusPill label="Verbaut" testID="DEV-01.badges.status" />
          <StatusPill label="Geplant" />
          <StatusPill label="Ausgebaut" />
          <StatusPill label="TÜV eingetragen" />
        </Wrap>
      </Group>
      <Group title="Ungelesen-Zähler" note={`Punkt ${size.unreadDot} oder Zähler ${size.unreadPill} hoch, accent.fill mit weißem Text.`}>
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
      <Group title="Ungelesen in der Navigation" note="Zähler auf Nachrichten, Punkt auf Start. Leiste und Rail am Icon, Sidebar am Zeilenende.">
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
      <Group title="Fortschritt" note={`${size.progress.height} hoch; Wizard mit vier Segmenten; Upload als Ring ${size.progress.ring} auf der Kachel.`}>
        <Specimen label={'Balken · Build zu 70\u00a0% vollständig'} fill>
          <Progress label={'Build zu 70\u00a0% vollständig'} value={0.7} testID="DEV-01.badges.bar" />
        </Specimen>
        <Specimen label="Wizard · Schritt 2 von 4" fill>
          <Progress variant="wizard" label="Schritt 2 von 4" step={2} total={4} testID="DEV-01.badges.wizard" />
        </Specimen>
        <Wrap>
          <Specimen label={'Ring 25\u00a0%'}>
            <Progress variant="ring" label={'Upload zu 25\u00a0%'} value={0.25} testID="DEV-01.badges.ring" />
          </Specimen>
          <Specimen label={'Ring 75\u00a0%'}>
            <Progress variant="ring" label={'Upload zu 75\u00a0%'} value={0.75} />
          </Specimen>
        </Wrap>
        <Specimen label="Ring auf der Foto-Kachel" fill>
          <View style={styles.tile}>
            <Photo aspect="4:3" corner="sm" {...PHOTOS.e46}>
              <View style={styles.ring}>
                <Progress variant="ring" label={'Upload zu 60\u00a0%'} value={0.6} onPhoto />
              </View>
            </Photo>
          </View>
        </Specimen>
      </Group>
    </SectionScreen>
  );
}
