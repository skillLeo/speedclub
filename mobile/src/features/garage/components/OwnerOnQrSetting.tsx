import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useMemberSettings, useSetShowOwnerOnQr } from '@/api/queries/settings';
import { KnownTextSkeleton } from '@/features/vehicle/components/KnownTextSkeleton';
import { RowCard } from '@/features/vehicle/components/RowCard';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { useOnline } from '@/state/online';
import { createStyles, size, typography, useTheme } from '@/theme';
import { Button, Icon, Skeleton, SkeletonBlock, Switch, Text, toast } from '@/ui';

import { saveErrorMessage } from '../errors';
import { FormGroup } from './fields';

const OWNER_ICON = 'user';

const useStyles = createStyles((t) => ({
  // DQ-215: as the plate reminder on the same page and this row's error and offline bodies: 16 around, the 20 icon and 12
  // before the text, and everything starts on the title's line. The helper runs to several lines, where ListRow would
  // centre the icon and the switch on the block.
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12], padding: t.space[16] },
  text: { flex: 1, minWidth: 0 },
  firstLine: { justifyContent: 'center' },
  problemText: { alignItems: 'flex-start', flex: 1, gap: t.space[4], minWidth: 0 },
}));

/** The box of the title's line: a glyph or a switch centred in it sits on that line, whatever the font scale. */
function useFirstLineBox() {
  const { fontScale } = useTheme();
  return { height: typography.body.lineHeight * fontScale };
}

/**
 * The loading row of the setting on its card, in the row's geometry: icon, the label and the helper in as many lines as the
 * real ones take at this width and font scale, then the 51 × 31 switch. GAR-12's own skeleton draws the same row.
 */
export function OwnerOnQrSkeletonRow() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const firstLine = useFirstLineBox();
  return (
    <View style={styles.row}>
      <View style={[styles.firstLine, firstLine]}>
        <SkeletonBlock width={size.icon.m} height={size.icon.m} corner="xs" />
      </View>
      <View style={styles.text}>
        <KnownTextSkeleton text={t('visibility.ownerOnQr.label')} variant="body" />
        <KnownTextSkeleton text={t('visibility.ownerOnQr.helper')} variant="supporting" />
      </View>
      <View style={[styles.firstLine, firstLine]}>
        <SkeletonBlock width={size.switch.width} height={size.switch.height} corner="full" />
      </View>
    </View>
  );
}

/**
 * GAR-12 "Besitzer auf der QR-Seite" (ADR-148 a): `show_owner_on_qr` of the account, so the group names all vehicles. The
 * switch saves at once (optimistic, back on failure with a toast), closes while offline, and stays open under a publishing
 * restriction, which the server allows because the setting only ever hides the owner. DQ-212: a toast says when it saved,
 * because "Speichern" under it stays greyed out and belongs to the radio choice. DQ-208: on a surface card like every other
 * group of the page, so its label lines up with "Link kopieren".
 */
export function OwnerOnQrSetting({ routeId }: { routeId: string }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const firstLine = useFirstLineBox();
  const online = useOnline();
  const readOnly = useViewAsReadOnly();
  const settings = useMemberSettings();
  const change = useSetShowOwnerOnQr();
  const testID = `${routeId}.ownerOnQr`;
  const label = t('visibility.ownerOnQr.label');

  const flip = (show: boolean) => {
    change.mutate(show, {
      onSuccess: () => toast(t('visibility.ownerOnQr.saved'), { testID: `${testID}.saved` }),
      onError: (error) => toast(saveErrorMessage(t, error), { haptic: 'warning', testID: `${testID}.failed` }),
    });
  };

  let body;
  if (settings.data) {
    const color = online ? 'text.secondary' : 'text.disabled';
    body = (
      <View style={styles.row} testID={`${testID}.row`}>
        <View style={[styles.firstLine, firstLine]}>
          <Icon name={OWNER_ICON} size={20} color={color} />
        </View>
        <View style={styles.text}>
          <Text variant="body" color={online ? 'text.primary' : 'text.disabled'}>
            {label}
          </Text>
          <Text variant="supporting" color={color}>
            {t('visibility.ownerOnQr.helper')}
          </Text>
        </View>
        <View style={[styles.firstLine, firstLine]}>
          <Switch label={label} value={settings.data.show_owner_on_qr} onValueChange={flip} disabled={!online || readOnly} testID={`${testID}.switch`} />
        </View>
      </View>
    );
  } else if (settings.isError) {
    body = (
      <View style={styles.row} testID={`${testID}.error`}>
        <Icon name={OWNER_ICON} size={20} color="text.secondary" />
        <View style={styles.problemText}>
          <Text variant="body">{label}</Text>
          <Text variant="supporting" color="text.secondary">
            {t('visibility.ownerOnQr.loadFailed')}
          </Text>
          <Button
            label={t('visibility.ownerOnQr.retry')}
            variant="tertiary"
            size="m"
            flush="start"
            disabled={!online}
            loading={settings.isFetching}
            onPress={() => void settings.refetch()}
            testID={`${testID}.retry`}
          />
        </View>
      </View>
    );
  } else if (!online) {
    // Nothing cached and no connection: the query waits, paused, and loads once the device is back.
    body = (
      <View style={styles.row} testID={`${testID}.offline`}>
        <Icon name={OWNER_ICON} size={20} color="text.disabled" />
        <View style={styles.problemText}>
          <Text variant="body" color="text.disabled">
            {label}
          </Text>
          <Text variant="supporting" color="text.secondary">
            {t('visibility.ownerOnQr.offline')}
          </Text>
        </View>
      </View>
    );
  } else {
    body = (
      <Skeleton testID={`${testID}.loading`}>
        <OwnerOnQrSkeletonRow />
      </Skeleton>
    );
  }

  return (
    <FormGroup title={t('visibility.ownerOnQr.group')} testID={testID}>
      <RowCard>{body}</RowCard>
    </FormGroup>
  );
}
