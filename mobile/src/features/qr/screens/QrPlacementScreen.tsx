import { useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useQrCode } from '@/api/queries/qr';
import { keepNameTogether } from '@/lib/format';
import { createStyles, space, typography, useBreakpoint, useTheme } from '@/theme';
import { Icon } from '@/ui/icons/Icon';
import { Text } from '@/ui/Text';
import { RowDivider } from '@/ui/rowParts';

import { PLACEMENT_ZONES, PlacementDiagram, PlacementMarker } from '../components/PlacementDiagram';
import { QrPage } from '../components/QrPage';
import { QrColumns, QrRowGroup } from '../components/parts';

const ROUTE = 'STK-03';
/** The lead column of a rule: the 24 marker, or the 20 glyph centred in the same width. */
const LEAD = space[24];

const useStyles = createStyles((t) => ({
  rules: { marginTop: t.space[24] },
  // Beside the diagram from 1280: level with its top.
  rulesBeside: { marginTop: t.space[0] },
  rule: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: t.space[12],
    paddingHorizontal: t.space[16],
    paddingVertical: t.space[16],
  },
  lead: { alignItems: 'center', justifyContent: 'center', minWidth: LEAD },
  text: { flex: 1 },
  disclaimer: { marginTop: t.space[16], paddingHorizontal: t.space[16] },
}));

function Rule({
  lead,
  text,
  divider,
  testID,
}: {
  lead: ReactNode;
  text: string;
  divider: boolean;
  testID: string;
}) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  // On the first line of the text, whatever the font scale.
  const lineBox = { minHeight: typography.body.lineHeight * fontScale };
  return (
    <View testID={testID}>
      <View style={styles.rule}>
        <View style={[styles.lead, lineBox]}>{lead}</View>
        <Text variant="body" style={styles.text}>
          {text}
        </Text>
      </View>
      {divider ? <RowDivider inset={space[16]} lead={LEAD + space[12]} /> : null}
    </View>
  );
}

/**
 * QR-03: where the sticker goes, in the conservative wording of 08_LEGAL_COMPLIANCE §7, word for word. The drawing numbers
 * the four places like the list; size, print and the disclaimer follow. Static: nothing to load, nothing to fail.
 */
export function QrPlacementScreen() {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const { kind } = useBreakpoint();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const qr = useQrCode(typeof vehicleId === 'string' ? vehicleId : undefined);

  return (
    <QrPage
      routeId={ROUTE}
      title={t('placement.title')}
      subtitle={qr.data ? keepNameTogether(qr.data.vehicle.full_title) : t('placement.subtitle')}
      fallback="/stickers"
      offlineLabel={t('common.offlineBanner')}
      focusableScroll
    >
      <QrColumns
        ratio={[6, 6]}
        main={<PlacementDiagram testID={`${ROUTE}.diagram`} />}
        side={
          <>
            <QrRowGroup
              style={[styles.rules, kind === 'desktop' ? styles.rulesBeside : null]}
              testID={`${ROUTE}.rules`}
            >
              {PLACEMENT_ZONES.map((zone) => (
                <Rule
                  key={zone.key}
                  lead={
                    <PlacementMarker
                      number={zone.number}
                      tone={zone.tone}
                      label={t(`placement.tone.${zone.tone}`, { number: zone.number })}
                    />
                  }
                  text={t(`placement.rules.${zone.key}`)}
                  divider
                  testID={`${ROUTE}.rule.${zone.key}`}
                />
              ))}
              <Rule
                lead={<Icon name="info" size={20} color="text.secondary" />}
                text={t('placement.rules.size')}
                divider
                testID={`${ROUTE}.rule.size`}
              />
              <Rule
                lead={<Icon name="qr-code" size={20} color="text.secondary" />}
                text={t('placement.print')}
                divider={false}
                testID={`${ROUTE}.rule.print`}
              />
            </QrRowGroup>
            <Text
              variant="callout"
              color="text.secondary"
              style={styles.disclaimer}
              testID={`${ROUTE}.disclaimer`}
            >
              {t('placement.disclaimer')}
            </Text>
          </>
        }
      />
    </QrPage>
  );
}
