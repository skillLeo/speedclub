import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedScrollHandler, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { createStyles, size, space, type ThemeName } from '@/theme';
import {
  BrandWordmark,
  Button,
  ChatBubble,
  Chip,
  Hairline,
  Icon,
  ListRow,
  Photo,
  PhotoScrim,
  PressableScale,
  QRDisplay,
  Sheet,
  Skeleton,
  SkeletonBlock,
  Switch,
  Text,
  ToastHost,
  toast,
} from '@/ui';
import { setReducedMotionPreview, useMotionPreference } from '@/ui/motion';
import {
  BeforeAfter,
  BUILD_REACTION_GLYPHS,
  BrushReveal,
  CarouselSnap,
  CircularReveal,
  collapseFlight,
  ContentReveal,
  DrawnRule,
  expandFrom,
  FlightSource,
  FlightTarget,
  FollowButton,
  LiveCount,
  MapPinScale,
  OdometerNumber,
  PageIndicator,
  PrintWipe,
  QrReveal,
  ReactionPicker,
  SaveToggle,
  SlideUpCard,
  StaggerIn,
  StretchyHero,
  SwipeRow,
  TypingDots,
  usePagerParallax,
  zeroed,
  type Reaction,
} from '@/ui/motion/kit';
import { ratioOf } from '@/ui/Photo';

import { E46, PHOTOS, R34, noop } from '../data';
import { Group, NoteText, SectionScreen, Specimen, Wrap } from '../parts';
import { QR_SAMPLE_SVG } from '../qrSample';

const KATAKANA = 'スピードクラブ';
const ID = 'DEV-01.motion';

const useStyles = createStyles((t) => ({
  controls: { gap: t.space[12] },
  controlRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], justifyContent: 'space-between' },
  stage: { alignItems: 'center', backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.layout.cardPadding },
  kana: { alignItems: 'center', flexDirection: 'row', gap: t.space[12] },
  rule: { flex: 1 },
  pager: { borderRadius: t.radius.md, overflow: 'hidden' },
  page: { overflow: 'hidden' },
  pageText: { bottom: t.space[16], gap: t.space[4], left: t.space[16], position: 'absolute', right: t.space[16] },
  tile: { borderRadius: t.radius.md, overflow: 'hidden', width: t.size.avatar.xl },
  detail: { gap: t.space[8] },
  stretchBox: { borderRadius: t.radius.md, overflow: 'hidden' },
  stretchBody: { backgroundColor: t.color.bg.canvas, gap: t.space[8], padding: t.space[16] },
  numerals: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[24] },
  numeral: { gap: t.space[2] },
  unitRow: { alignItems: 'baseline', flexDirection: 'row', gap: t.space[4] },
  rows: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  chat: { gap: t.space[8] },
  composer: { alignItems: 'center', backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, flexDirection: 'row', gap: t.space[8], padding: t.space[8] },
  composerText: { flex: 1, paddingHorizontal: t.space[8] },
  qrStage: { borderRadius: t.radius.md, padding: t.space[24] },
  print: { alignItems: 'center', gap: t.space[12] },
  themePanel: { borderRadius: t.radius.md },
  themeBody: { backgroundColor: t.color.bg.canvas, gap: t.space[12], padding: t.space[16] },
  swatches: { flexDirection: 'row', gap: t.space[8] },
  swatch: { alignItems: 'center', borderColor: t.color.border.default, borderRadius: t.radius.full, borderWidth: t.size.border.control, height: t.size.touchMin, justifyContent: 'center', width: t.size.touchMin },
  card: { gap: t.space[8] },
  cardPhoto: { borderRadius: t.radius.md, overflow: 'hidden' },
  map: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[16], overflow: 'hidden', padding: t.space[16] },
  pins: { flexDirection: 'row', gap: t.space[24], justifyContent: 'center' },
  pin: { alignItems: 'center', height: t.size.touchMin, justifyContent: 'center', width: t.size.touchMin },
  eventCard: { backgroundColor: t.color.bg.raised, borderRadius: t.radius.md, gap: t.space[4], padding: t.space[16] },
}));

/** The four build reactions with their custom glyphs (M4.4, App. C). */
const REACTIONS: readonly Reaction[] = [
  { key: 'stark', label: 'Stark', icon: BUILD_REACTION_GLYPHS.stark },
  { key: 'sauber', label: 'Sauber', icon: BUILD_REACTION_GLYPHS.sauber },
  { key: 'tief', label: 'Tief', icon: BUILD_REACTION_GLYPHS.tief },
  { key: 'laut', label: 'Laut', icon: BUILD_REACTION_GLYPHS.laut },
];

const PAGES = [
  { photo: PHOTOS.r34, title: 'Deine Garage', body: 'Fotos, Daten und Mods an einem Ort.' },
  { photo: PHOTOS.wheels, title: 'Jede Mod zählt', body: 'Fahrwerk, Felgen, Abgasanlage, sauber dokumentiert.' },
  { photo: PHOTOS.interior, title: 'Der QR-Sticker', body: 'Dein Auto verlinkt seine Build-Seite.' },
];

const CARS = [
  { key: 'r34', title: R34.title, photo: PHOTOS.r34 },
  { key: 'e46', title: E46.title, photo: PHOTOS.e46 },
  { key: 'wheels', title: 'Porsche 911 GT3 (992)', photo: PHOTOS.wheels },
];

const FILTERS = [
  { key: 'awd', label: 'Allrad', share: 0.4 },
  { key: 'turbo', label: 'Turbo', share: 0.55 },
  { key: 'dyno', label: 'Prüfstand', share: 0.3 },
];
const ALL_BUILDS = 1024;

/** DEV-01 "Bewegung": every signature motion of 09 §4.7 (SM1–SM20), with a reduced-motion preview. */
export function MotionSection() {
  const styles = useStyles();
  const motion = useMotionPreference();
  const [reduced, setReduced] = useState(motion.reduced);
  const [run, setRun] = useState(0);

  // The preview is app-wide; leaving the page hands motion back to the device setting.
  useEffect(() => () => setReducedMotionPreview(null), []);
  const toggleReduced = (next: boolean) => {
    setReduced(next);
    setReducedMotionPreview(next);
  };

  return (
    <SectionScreen
      section="motion"
      footer={
        <>
          <ToastHost testID={`${ID}.toast`} />
        </>
      }
    >
      <Group
        title="Steuerung"
        note="Reduzierte Bewegung gilt hier für die ganze App, bis du die Seite verlässt: Federn werden zur effect.default-Überblendung, Parallaxe und Odometer stehen still."
      >
        <View style={styles.controls}>
          <View style={styles.controlRow}>
            <Text variant="body">Reduzierte Bewegung</Text>
            <Switch value={reduced} onValueChange={toggleReduced} label="Reduzierte Bewegung" testID={`${ID}.reduced`} />
          </View>
          <Button label="Alle Bewegungen neu starten" variant="secondary" onPress={() => setRun((n) => n + 1)} testID={`${ID}.replay`} />
        </View>
      </Group>
      <SplashDemo key={`sm1.${run}`} />
      <PagerDemo />
      <Group title="SM3 · Großer Titel" note="useCollapsingHeader mit Header und HeaderLargeTitle: der Titel wandert beim Scrollen in die Leiste.">
        <Button label="Header-Seite öffnen" variant="tertiary" onPress={() => router.navigate('/dev/gallery/header')} testID={`${ID}.sm3`} />
      </Group>
      <HeroDemo />
      <StretchyDemo />
      <OdometerDemo key={`sm6.${run}`} />
      <Group title="SM7 · Druck" note="Skalierung 0,97 auf spring.fast plus Tonwechsel auf effect.fast, nie nur Deckkraft.">
        <Wrap>
          <Button label="Speichern" onPress={noop} testID={`${ID}.sm7.primary`} />
          <Button label="Teilen" variant="secondary" onPress={noop} testID={`${ID}.sm7.secondary`} />
        </Wrap>
      </Group>
      <FollowDemo />
      <ReactionDemo />
      <SheetDemo />
      <SwipeDemo />
      <SendDemo />
      <QrDemo key={`sm13.${run}`} />
      <ThemeDemo />
      <SkeletonDemo />
      <CarouselDemo />
      <Group title="SM17 · Vorher / Nachher" note="Teiler mit 44 breiter Trefferfläche, Clip folgt dem Finger, leichtes Haptik-Feedback beim Greifen. Pfeiltasten im Web.">
        <BeforeAfter
          before={{ ...PHOTOS.e46, label: 'Vorher: BMW M3 E46 im Serienzustand' }}
          after={{ ...PHOTOS.r34, label: 'Nachher: Beispielfoto' }}
          aspect="4:3"
          label="Vorher-nachher-Vergleich"
          testID={`${ID}.sm17`}
        />
      </Group>
      <LiveCountDemo />
      <MapDemo />
      <Group title="SM20 · Toast mit Rückgängig" note="12 Versatz plus Effekt-Blende, 5 s mit Aktion, seitlich wegwischen, Live-Region.">
        <Button
          label="Toast zeigen"
          variant="secondary"
          onPress={() => toast('Foto entfernt', { undo: noop, testID: `${ID}.toast` })}
          testID={`${ID}.sm20`}
        />
      </Group>
    </SectionScreen>
  );
}

function SplashDemo() {
  const styles = useStyles();
  const [play, setPlay] = useState(true);
  const [done, setDone] = useState(false);
  return (
    <Group title="SM1 · Splash" note="Pinsel-Logo von links nach rechts auf spring.slow, Katakana 120 ms später, 150 ms halten. Keine Schleife.">
      <View style={styles.stage} testID={`${ID}.sm1`}>
        <BrushReveal
          key={String(play)}
          play
          onDone={() => setDone(true)}
          logo={<BrandWordmark width={size.qrMinOnScreen} decorative />}
          katakana={
            <View style={styles.kana} aria-hidden>
              <Text variant="labelBadge" color="text.secondary" selectable={false}>
                {KATAKANA}
              </Text>
            </View>
          }
          testID={`${ID}.sm1.reveal`}
        />
        <Text variant="caption" color="text.tertiary">
          {done ? 'Fertig: jetzt Überblendung in den ersten Screen' : 'Läuft'}
        </Text>
      </View>
      <Button
        label="Splash abspielen"
        variant="tertiary"
        onPress={() => {
          setDone(false);
          setPlay((p) => !p);
        }}
        testID={`${ID}.sm1.play`}
      />
    </Group>
  );
}

function PagerDemo() {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const scrollX = useSharedValue(0);
  const [page, setPage] = useState(0);
  const shownPage = useSharedValue(0);
  const progress = useDerivedValue(() => (width > 0 ? scrollX.get() / width : 0));
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.set(event.contentOffset.x);
    // The page whose text arrives: the nearest whole page, handed over once per change.
    const nearest = width > 0 ? Math.round(event.contentOffset.x / width) : 0;
    if (nearest !== shownPage.get()) {
      shownPage.set(nearest);
      scheduleOnRN(setPage, nearest);
    }
  });
  return (
    <Group title="SM2 · Onboarding-Pager" note="Foto-Parallaxe 0,3×, Texte mit stagger.s, die Pille wandert von Punkt zu Punkt.">
      <View style={styles.pager} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} testID={`${ID}.sm2`}>
        <Animated.ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {PAGES.map((p, index) => (
            <PagerPage key={p.title} index={index} width={width} scrollX={scrollX} active={page === index} {...p} />
          ))}
        </Animated.ScrollView>
      </View>
      <PageIndicator progress={progress} count={PAGES.length} label={`Seite ${page + 1} von ${PAGES.length}`} testID={`${ID}.sm2.indicator`} />
    </Group>
  );
}

function PagerPage({
  index,
  width,
  scrollX,
  active,
  photo,
  title,
  body,
}: {
  index: number;
  width: number;
  scrollX: SharedValue<number>;
  active: boolean;
  photo: (typeof PHOTOS)[keyof typeof PHOTOS];
  title: string;
  body: string;
}) {
  const styles = useStyles();
  const parallax = usePagerParallax(scrollX, index, width);
  return (
    <View style={[styles.page, { width }]}>
      <Animated.View style={parallax}>
        <Photo aspect="4:5" {...photo}>
          <PhotoScrim />
        </Photo>
      </Animated.View>
      <View style={styles.pageText}>
        <StaggerIn order={0} active={active}>
          <Text variant="title2" color="onPhoto.primary">
            {title}
          </Text>
        </StaggerIn>
        <StaggerIn order={1} active={active}>
          <Text variant="body" color="onPhoto.primary">
            {body}
          </Text>
        </StaggerIn>
      </View>
    </View>
  );
}

const renderHero = () => <Photo aspect="4:3" {...PHOTOS.r34} />;

function HeroDemo() {
  const styles = useStyles();
  const motion = useMotionPreference();
  const [open, setOpen] = useState(false);
  const id = `${ID}.sm4`;
  const expand = async () => {
    await expandFrom(id, renderHero);
    setOpen(true);
  };
  const back = () => void collapseFlight(id, renderHero, motion, () => setOpen(false));
  return (
    <Group
      title="SM4 · Karte → Detail"
      note="HeroExpand: ein Klon fliegt auf spring.default vom Kartenfoto zum Hero, Radius 12 → 0; zurück läuft es rückwärts. iOS nutzt später Link.AppleZoom hinter ios.apple_zoom."
    >
      <PressableScale role="button" aria-label={`${R34.title} öffnen`} onPress={() => void expand()} style={styles.tile} testID={`${id}.source`}>
        <FlightSource id={id}>
          <Photo aspect="3:4" corner="md" {...PHOTOS.r34} />
        </FlightSource>
      </PressableScale>
      {open ? (
        <View style={styles.detail} testID={`${id}.detail`}>
          <FlightTarget id={id}>{renderHero()}</FlightTarget>
          <Text variant="headline">{R34.title}</Text>
          <Button label="Zurück" variant="secondary" onPress={back} testID={`${id}.back`} />
        </View>
      ) : null}
    </Group>
  );
}

function StretchyDemo() {
  const styles = useStyles();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  return (
    <Group title="SM5 · Stretchy Hero" note="Nach unten ziehen skaliert bis 1,15 (oben verankert), Scrollen bewegt das Foto mit 0,5×, scrim.top blendet unter dem Header ein.">
      <View style={[styles.stretchBox, { aspectRatio: ratioOf('4:5') }]} testID={`${ID}.sm5`}>
        <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} nestedScrollEnabled>
          <StretchyHero scrollY={scrollY} headerHeight={size.header}>
            <Photo aspect="4:5" {...PHOTOS.e46}>
              <PhotoScrim />
            </Photo>
          </StretchyHero>
          <View style={styles.stretchBody}>
            <Text variant="headline">{E46.title}</Text>
            <Text variant="body" color="text.secondary">
              {E46.subtitle}
            </Text>
          </View>
        </Animated.ScrollView>
      </View>
    </Group>
  );
}

const NUMERALS = [
  { label: 'LEISTUNG', value: '510', unit: 'PS' },
  { label: 'DREHMOMENT', value: '650', unit: 'Nm' },
  { label: '0–100', value: '3,9', unit: 's' },
  { label: 'GEWICHT', value: '1.725', unit: 'kg' },
];

function OdometerDemo() {
  const styles = useStyles();
  return (
    <Group title="SM6 · Odometer-Zahlen" note="Jede Ziffer rollt in ihrer Spalte auf spring.default, einmal pro Fahrzeug und Sitzung; tnum hält die Breite. Reduziert: Sprung.">
      <View style={styles.numerals} testID={`${ID}.sm6`}>
        {NUMERALS.map((n) => (
          <View key={n.label} style={styles.numeral}>
            <Text variant="labelCaps" color="text.secondary">
              {n.label}
            </Text>
            <View style={styles.unitRow}>
              <OdometerNumber value={n.value} rollFrom={zeroed(n.value)} variant="heroNumeralS" testID={`${ID}.sm6.${n.unit}`} />
              <Text variant="labelUnit" color="text.secondary">
                {n.unit}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Group>
  );
}

function FollowDemo() {
  const [following, setFollowing] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <Group title="SM8 · Folgen / Merken" note="Breite morpht auf spring.fast, Haken zeichnet sich (effect.default), Lesezeichen mit Pop 1,12. Leichtes Haptik-Feedback.">
      <Wrap>
        <FollowButton
          following={following}
          onToggle={() => setFollowing((f) => !f)}
          followLabel="Folgen"
          followingLabel="Folge ich"
          testID={`${ID}.sm8.follow`}
        />
        <SaveToggle saved={saved} onToggle={() => setSaved((s) => !s)} saveLabel="Merken" savedLabel="Gemerkt" testID={`${ID}.sm8.save`} />
      </Wrap>
    </Group>
  );
}

function ReactionDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  const [lastUsed, setLastUsed] = useState('stark');
  return (
    <Group
      title="SM9 · Reaktionen"
      note="Tippen = zuletzt benutzte Reaktion. Lange drücken: vier Glyphen ploppen auf (0,6 → 1, stagger.s), ziehen wählt aus. Die Glyphen Stark, Sauber, Tief und Laut aus dem Glyphen-Satz 2.0."
    >
      <Specimen label={selected ? `Gewählt: ${REACTIONS.find((r) => r.key === selected)?.label ?? ''}` : 'Keine Reaktion'}>
        <ReactionPicker
          reactions={REACTIONS}
          selected={selected}
          lastUsed={lastUsed}
          onSelect={(key) => {
            setSelected(key);
            if (key) setLastUsed(key);
          }}
          label="Reagieren"
          testID={`${ID}.sm9`}
        />
      </Specimen>
    </Group>
  );
}

function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Group title="SM10 · Sheet" note="GH3-Pan mit geschwindigkeitsabhängigem Einrasten (spring.default), Gummiband über dem oberen Detent, Scrim auf effect.default.">
      <Button label="Sheet öffnen" variant="secondary" onPress={() => setOpen(true)} testID={`${ID}.sm10`} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Fahrwerk" testID={`${ID}.sm10.sheet`}>
        <ListRow title="KW Variante 3" subtitle="Gewindefahrwerk" />
        <ListRow title="H&R Stabilisatoren" subtitle="vorne und hinten" />
      </Sheet>
    </Group>
  );
}

function SwipeDemo() {
  const styles = useStyles();
  const [archived, setArchived] = useState<string | null>(null);
  return (
    <Group title="SM11 · Wischaktionen" note="Nach links wischen zeigt Aktionen mit Gummiband, Haptik an der Schwelle, spring.calm. Ganz durchwischen archiviert.">
      <View style={styles.rows}>
        <SwipeRow
          fullSwipe
          actions={[
            { key: 'archive', label: 'Archivieren', icon: 'archive', onPress: () => setArchived('Lukas Schneider') },
            { key: 'delete', label: 'Löschen', icon: 'trash', tone: 'destructive', onPress: () => setArchived(null) },
          ]}
          label="Lukas Schneider folgt jetzt deinem BMW M3 E46"
          testID={`${ID}.sm11.row1`}
        >
          <ListRow title="Lukas Schneider" subtitle="folgt jetzt deinem BMW M3 E46" icon="user" />
        </SwipeRow>
        <Hairline />
        <SwipeRow
          actions={[{ key: 'mute', label: 'Stumm', icon: 'bell', onPress: noop }]}
          label="Treffen Stuttgart: neue Zusage zu Samstag, 19:30 Uhr"
          testID={`${ID}.sm11.row2`}
        >
          <ListRow title="Treffen Stuttgart" subtitle="Neue Zusage zu Samstag, 19:30 Uhr" icon="calendar-blank" />
        </SwipeRow>
      </View>
      {archived ? (
        <NoteText variant="caption" color="text.tertiary">
          {`Archiviert: ${archived}`}
        </NoteText>
      ) : null}
    </Group>
  );
}

const MESSAGE = 'Bin um 19:30 Uhr am Treffpunkt.';

function SendDemo() {
  const styles = useStyles();
  const [sent, setSent] = useState(false);
  const id = `${ID}.sm12`;
  const render = () => <ChatBubble own tail text={MESSAGE} />;
  const send = async () => {
    await expandFrom(id, render, { radiusFrom: 0, radiusTo: 0 });
    setSent(true);
  };
  return (
    <Group title="SM12 · Nachricht senden" note="Der Text im Composer wird zur neuen Blase (spring.default); Tipp-Punkte pulsieren auf Effekt-Tokens.">
      <View style={styles.chat} testID={id}>
        <ChatBubble text="Kommst du heute Abend?" tail senderLabel="Lukas" />
        <TypingDots label="Lukas schreibt" testID={`${id}.typing`} />
        {sent ? (
          <FlightTarget id={id}>{render()}</FlightTarget>
        ) : null}
        <View style={styles.composer}>
          <FlightSource id={id} style={styles.composerText}>
            <Text variant="body" color={sent ? 'text.tertiary' : 'text.primary'}>
              {sent ? 'Nachricht' : MESSAGE}
            </Text>
          </FlightSource>
          <Button label={sent ? 'Zurücksetzen' : 'Senden'} size="s" onPress={() => (sent ? setSent(false) : void send())} testID={`${id}.send`} />
        </View>
      </View>
    </Group>
  );
}

function QrDemo() {
  const styles = useStyles();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Group title="SM13 · QR-Reveal und Druck" note="Unscharfes Autofoto, Karte 0,92 → 1 auf spring.slow, mittleres Haptik-Feedback. Druck: Maske von oben nach unten, dann zeichnet sich die Akzentlinie.">
      <QrReveal photo={PHOTOS.r34} revealed={revealed} style={styles.qrStage} testID={`${ID}.sm13.reveal`}>
        <QRDisplay svg={QR_SAMPLE_SVG} label="QR-Code für Nissan Skyline GT-R R34" code="7H2K QXMB" url="speedclub.de/C/7H2KQXMB" />
      </QrReveal>
      <View style={[styles.stage, styles.print]} testID={`${ID}.sm13.print`}>
        <BrandWordmark width={size.qrMinOnScreen} decorative />
        <DrawnRule drawn width={size.qrMinOnScreen} />
        <PrintWipe printing>
          <QRDisplay svg={QR_SAMPLE_SVG} label="QR-Code für Nissan Skyline GT-R R34" code="7H2K QXMB" url="speedclub.de/C/7H2KQXMB" />
        </PrintWipe>
      </View>
    </Group>
  );
}

const THEMES: readonly { name: ThemeName; label: string }[] = [
  { name: 'carbon', label: 'Carbon' },
  { name: 'black', label: 'Schwarz' },
  { name: 'light', label: 'Hell' },
];

function ThemeDemo() {
  const styles = useStyles();
  const [theme, setTheme] = useState<ThemeName>('carbon');
  const [origin, setOrigin] = useState<{ x: number; y: number } | undefined>(undefined);
  return (
    <Group
      title="SM14 · Theme-Wechsel"
      note="Ersatz ohne Skia und view-shot: eine Scheibe in der neuen Hintergrundfarbe wächst vom Farbfeld (effect.slow), dann blendet der Inhalt über. Reduziert: Überblendung."
    >
      <CircularReveal theme={theme} origin={origin} style={styles.themePanel} testID={`${ID}.sm14`}>
        <ThemePanel
          theme={theme}
          onPick={(name, at) => {
            setOrigin(at);
            setTheme(name);
          }}
        />
      </CircularReveal>
    </Group>
  );
}

/** Inside the reveal's ThemeScope: its styles come from the theme it shows. */
function ThemePanel({ theme, onPick }: { theme: ThemeName; onPick: (name: ThemeName, at: { x: number; y: number }) => void }) {
  const styles = useStyles();
  const [row, setRow] = useState({ x: 0, y: 0 });
  const [swatches, setSwatches] = useState<Record<string, number>>({});
  return (
    <View style={styles.themeBody}>
      <Text variant="headline">{R34.title}</Text>
      <Text variant="body" color="text.secondary">
        {R34.subtitle}
      </Text>
      <View style={styles.swatches} onLayout={(event: LayoutChangeEvent) => setRow(event.nativeEvent.layout)}>
        {THEMES.map((t) => (
          <PressableScale
            key={t.name}
            role="radio"
            aria-checked={theme === t.name}
            aria-label={t.label}
            onLayout={(event: LayoutChangeEvent) => {
              const x = event.nativeEvent.layout.x;
              setSwatches((s) => ({ ...s, [t.name]: x }));
            }}
            onPress={() =>
              // The panel's padding is the body's: the row's offset already includes it.
              onPick(t.name, { x: row.x + (swatches[t.name] ?? 0) + size.touchMin / 2, y: row.y + size.touchMin / 2 })
            }
            contentStyle={styles.swatch}
            testID={`${ID}.sm14.${t.name}`}
          >
            <Icon name={theme === t.name ? 'check' : 'selection'} size={20} />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

function SkeletonDemo() {
  const styles = useStyles();
  const [loading, setLoading] = useState(true);
  return (
    <Group title="SM15 · Skeleton → Inhalt" note="Gleiche Geometrie, Überblendung auf effect.default, kein Schimmer unter 1,5 s.">
      <ContentReveal
        loading={loading}
        skeleton={
          <Skeleton label="Fahrzeug wird geladen" testID={`${ID}.sm15.skeleton`}>
            <SkeletonBlock aspectRatio={ratioOf('16:9')} corner="md" />
          </Skeleton>
        }
        testID={`${ID}.sm15.content`}
      >
        <View style={styles.cardPhoto}>
          <Photo aspect="16:9" {...PHOTOS.interior} label="Cockpit mit Handschaltung" />
        </View>
      </ContentReveal>
      <Button label={loading ? 'Daten laden' : 'Zurück zum Skeleton'} variant="secondary" onPress={() => setLoading((l) => !l)} testID={`${ID}.sm15.toggle`} />
    </Group>
  );
}

function CarouselDemo() {
  const styles = useStyles();
  const [cars, setCars] = useState(CARS);
  const [editing, setEditing] = useState(false);
  return (
    <Group title="SM16 · Garage-Karussell" note="Einrasten, Nachbarn 0,94 und 0,7 Deckkraft. Lange drücken: Sortiermodus, Karten 0,9, ziehen mit mittlerem Haptik-Feedback.">
      <CarouselSnap
        items={cars}
        keyOf={(car) => car.key}
        labelOf={(car) => car.title}
        // About two thirds of a phone: the neighbours peek in on both sides.
        itemWidth={size.qrMinOnScreen + space[40]}
        gap={space[12]}
        onReorder={(from, to) =>
          setCars((list) => {
            const next = list.slice();
            const [moved] = next.splice(from, 1);
            if (moved) next.splice(to, 0, moved);
            return next;
          })
        }
        moveLabels={{ left: 'Nach links schieben', right: 'Nach rechts schieben' }}
        editing={editing}
        renderItem={(car) => (
          <View style={styles.card}>
            <View style={styles.cardPhoto}>
              <Photo aspect="3:4" {...car.photo} />
            </View>
            <Text variant="headline" numberOfLines={1}>
              {car.title}
            </Text>
          </View>
        )}
        testID={`${ID}.sm16`}
      />
      <Button
        label={editing ? 'Fertig' : 'Reihenfolge ändern'}
        variant="secondary"
        onPress={() => setEditing((e) => !e)}
        testID={`${ID}.sm16.edit`}
      />
    </Group>
  );
}

function LiveCountDemo() {
  const [active, setActive] = useState<string[]>([]);
  const count = Math.round(FILTERS.filter((f) => active.includes(f.key)).reduce((n, f) => n * f.share, ALL_BUILDS));
  const label = count.toLocaleString('de-DE');
  return (
    <Group title="SM18 · Live-Zähler" note="Die Zahl im Anwenden-Button rollt mit, 250 ms entprellt. Beispielzahlen.">
      <Wrap>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            selected={active.includes(f.key)}
            onPress={() => setActive((a) => (a.includes(f.key) ? a.filter((k) => k !== f.key) : [...a, f.key]))}
            testID={`${ID}.sm18.${f.key}`}
          />
        ))}
      </Wrap>
      <LiveCountRow value={label} />
    </Group>
  );
}

function LiveCountRow({ value }: { value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.unitRow} testID={`${ID}.sm18.count`}>
      <LiveCount value={value} variant="bodyStrong" />
      <Text variant="bodyStrong">Builds anzeigen</Text>
    </View>
  );
}

const PINS = [
  { key: 'stuttgart', title: 'Treffen Stuttgart', meta: 'Samstag, 19:30 Uhr · Cannstatter Wasen' },
  { key: 'muenchen', title: 'Ausfahrt Alpen', meta: 'Sonntag, 9:00 Uhr · Start Bad Tölz' },
];

function MapDemo() {
  const styles = useStyles();
  const [selected, setSelected] = useState<string | null>(null);
  const event = PINS.find((p) => p.key === selected);
  return (
    <Group title="SM19 · Karten-Pin" note="Pin 1 → 1,2 auf spring.fast, Event-Karte gleitet hoch (spring.default). Das Schwenken der Karte kommt mit der Kartenbibliothek in M4.12.">
      <View style={styles.map} testID={`${ID}.sm19`}>
        <View style={styles.pins}>
          {PINS.map((pin) => (
            <PressableScale
              key={pin.key}
              role="button"
              aria-pressed={selected === pin.key}
              aria-label={pin.title}
              onPress={() => setSelected((s) => (s === pin.key ? null : pin.key))}
              contentStyle={styles.pin}
              testID={`${ID}.sm19.${pin.key}`}
            >
              <MapPinScale selected={selected === pin.key}>
                <Icon name="flag" weight={selected === pin.key ? 'fill' : 'regular'} />
              </MapPinScale>
            </PressableScale>
          ))}
        </View>
        <SlideUpCard visible={event !== undefined} style={styles.eventCard} testID={`${ID}.sm19.card`}>
          <Text variant="headline">{event?.title ?? PINS[0]!.title}</Text>
          <Text variant="caption" color="text.secondary">
            {event?.meta ?? PINS[0]!.meta}
          </Text>
        </SlideUpCard>
      </View>
    </Group>
  );
}

