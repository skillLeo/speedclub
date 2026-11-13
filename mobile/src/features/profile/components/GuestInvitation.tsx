import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppWordmark } from '@/features/auth/AppWordmark';
import { PHOTOS } from '@/features/gallery/data';
import { QR_SAMPLE_SVG } from '@/features/gallery/qrSample';
import { SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import { clearAuthIntent } from '@/state/session';
import { createStyles, layout, space, useBreakpoint, type BreakpointKind } from '@/theme';
import { Button, DisplayTitle, Photo, PhotoStageScrim, PhotoTopScrim, QRDisplay, SampleBadge, SpecStrip, Text, VehicleCard, type PhotoAspect } from '@/ui';
import { ratioOf } from '@/ui/Photo';

/** DQ-985: the brush logo wide and white, 28 high, as on AUTH-02; its width follows the bundled file's ratio. */
const LOGO_HEIGHT = space[24] + space[4];
const LOGO_RATIO = 1200 / 359;
const LOGO_WIDTH = LOGO_HEIGHT * LOGO_RATIO;

/** 4:5 on phones (09 §4.6 hero), 16:9 from the tablet. */
export function guestHeroAspect(kind: BreakpointKind): PhotoAspect {
  return kind === 'phone' ? '4:5' : '16:9';
}

export function guestHeroHeight(width: number, kind: BreakpointKind): number {
  return width / ratioOf(guestHeroAspect(kind));
}

const useStyles = createStyles((t) => ({
  // The title sits in the photo's bottom band, on the scrim, inside the large-text safe line (ADR-421 b).
  heroText: { bottom: 0, gap: t.space[12], left: 0, paddingBottom: t.space[24], position: 'absolute', right: 0 },
  logo: { height: LOGO_HEIGHT, width: LOGO_WIDTH },
  column: { gap: t.space[24], maxWidth: layout.contentMax, paddingTop: t.space[24], width: '100%' },
  copyColumn: { maxWidth: layout.feedColumn },
  fragments: { gap: t.space[16] },
  fragmentsWide: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[24] },
  fragment: { gap: t.space[12] },
  fragmentWide: { flex: 1, minWidth: 0 },
  panel: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.xl, gap: t.space[16], padding: t.space[16] },
  actions: { gap: t.space[8], maxWidth: layout.feedColumn },
  actionsWide: { alignItems: 'center', flexDirection: 'row' },
}));

export type GuestInvitationProps = {
  routeId: string;
  /** Where the member lands after signing in. */
  returnTo: string;
  /** The content width: the photo runs edge to edge. */
  width: number;
};

/**
 * The guest's profile (09 §7.7): a brand moment, not a fake profile. A night photo edge to edge with the brush logo and
 * `display.title` "Werde Teil des SPEED CLUB." on its scrim, the promise with "Konto erstellen" (the one filled action) and
 * "Anmelden", then three real pieces of the product with sample data, badged "Beispiel": a VehicleCard, a SpecStrip and the QR card.
 */
export function GuestInvitation({ routeId, returnTo, width }: GuestInvitationProps) {
  const { t } = useTranslation('profile');
  const garage = useTranslation('garage').t;
  const styles = useStyles();
  const router = useRouter();
  const { gutter, kind } = useBreakpoint();
  const wide = kind === 'desktop';
  const inner = Math.max(0, Math.min(width, layout.contentMax) - 2 * gutter);
  const cardWidth = wide ? (inner - layout.grid.desktop.gutter) / 2 : Math.min(inner, layout.feedColumn);
  const open = (pathname: '/auth/email' | '/sign-up') => {
    // A direct way in: nothing the guest tapped earlier belongs to it.
    clearAuthIntent();
    router.push({ pathname, params: { returnTo } });
  };

  const card = (
    <View style={[styles.fragment, wide ? styles.fragmentWide : null]}>
      <VehicleCard
        title={garage('garage.sample.title')}
        subtitle={garage('garage.sample.subtitle')}
        photo={SAMPLE_CARD_PHOTO}
        specs={[garage('garage.sample.power'), garage('garage.sample.torque'), garage('garage.sample.drive')]}
        sample={{ is_sample: true }}
        style={{ width: cardWidth }}
        testID={`${routeId}.guest.card`}
      />
    </View>
  );
  const sheet = (
    <View style={[styles.fragment, wide ? styles.fragmentWide : null]}>
      <View style={styles.panel} testID={`${routeId}.guest.spec`}>
        <SampleBadge />
        <SpecStrip
          items={[
            { value: '500', unit: 'PS', label: t('guest.sample.power'), provenance: t('guest.sample.dyno') },
            { value: '540', unit: 'Nm', label: t('guest.sample.torque'), provenance: t('guest.sample.dyno') },
            { value: '4,9', unit: 's', label: t('guest.sample.sprint'), provenance: t('guest.sample.estimated') },
          ]}
          layoutWidth={(wide ? cardWidth : Math.min(inner, layout.feedColumn)) - 2 * space[16]}
        />
      </View>
      <View style={styles.panel} testID={`${routeId}.guest.qr`}>
        <SampleBadge />
        <QRDisplay svg={QR_SAMPLE_SVG} label={t('guest.sample.qrLabel')} code="7H2K QXMB" url="speedclub.de/C/7H2KQXMB" />
      </View>
    </View>
  );

  return (
    <View testID={`${routeId}.guest`}>
      {/* DQ-1090: a different build from the badged sample card below (the R34), so no photo shows twice. */}
      <Photo {...PHOTOS.e46} aspect={guestHeroAspect(kind)} corner="none" testID={`${routeId}.guest.photo`}>
        <PhotoTopScrim />
        <PhotoStageScrim />
        <View style={[styles.heroText, { paddingHorizontal: gutter }]}>
          <View style={styles.logo}>
            <AppWordmark width={LOGO_WIDTH} height={LOGO_HEIGHT} tone="white" decorative />
          </View>
          <DisplayTitle
            kind="copy"
            placement="page"
            color="onPhoto.primary"
            role="heading"
            layoutWidth={Math.min(inner, layout.feedColumn)}
            testID={`${routeId}.guest.title`}
          >
            {t('guest.title')}
          </DisplayTitle>
        </View>
      </Photo>
      <View style={[styles.column, { paddingHorizontal: gutter }]}>
        <Text variant="body" color="text.secondary" style={styles.copyColumn} testID={`${routeId}.guest.body`}>
          {t('guest.body')}
        </Text>
        {/* DQ-1095: the one filled action follows the promise at once, in the first viewport on every device, before the samples. */}
        <View style={[styles.actions, wide ? styles.actionsWide : null]}>
          <Button label={t('guest.signUp')} size="l" fullWidth={!wide} onPress={() => open('/sign-up')} testID={`${routeId}.signUp`} />
          <Button label={t('guest.signIn')} variant="tertiary" size="l" fullWidth={!wide} onPress={() => open('/auth/email')} testID={`${routeId}.signIn`} />
        </View>
        {/* Decorative: the samples show what an account brings; readers get the line above. */}
        <View aria-hidden style={wide ? styles.fragmentsWide : styles.fragments} testID={`${routeId}.guest.samples`}>
          {card}
          {sheet}
        </View>
      </View>
    </View>
  );
}
