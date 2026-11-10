import { useTranslation } from 'react-i18next';

import { ListRow, Sheet, type IconName } from '@/ui';

export type MoreAction = { key: string; icon: IconName; label: string; onPress: () => void };

export type MoreSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The vehicle's name, as the sheet title. */
  title: string;
  actions: readonly MoreAction[];
  /** `.<key>` per row. */
  testID: string;
};

/**
 * The more-actions overlay of the register (VEH). Phase 1: "Link kopieren" for everybody, the owner's way to the garage and
 * the QR code. Report, block, save and compare (Phase 2) join as rows here, so no button exists before its action does.
 */
export function MoreSheet({ visible, onClose, title, actions, testID }: MoreSheetProps) {
  const { t } = useTranslation('vehicle');
  return (
    <Sheet visible={visible} onClose={onClose} title={title} label={t('actions.more')} expandable={false} narrow testID={testID}>
      {actions.map((action, index) => (
        <ListRow
          key={action.key}
          icon={action.icon}
          title={action.label}
          role="button"
          chevron={false}
          onPress={() => {
            onClose();
            action.onPress();
          }}
          inset={0}
          divider={index < actions.length - 1}
          testID={`${testID}.${action.key}`}
        />
      ))}
    </Sheet>
  );
}
