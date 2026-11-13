import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { photoFields } from '@/features/profile/media';
import { keepNameTogether } from '@/lib/format';
import { createStyles, size } from '@/theme';
import { EmptyState, ErrorState, ListRow, Sheet, Skeleton, SkeletonBlock, SkeletonText, type IconName } from '@/ui';
import { nameInText } from '@/ui/textBreaks';

import type { Loadable, MuteChange } from '../data';
import { MESSAGE_GLYPHS } from '../glyphs';
import { isMuted, type ChatVehicle, type ConversationSummary, type ReactionKey, type ThreadMessage } from '../model';

import { ReactionPicker } from './Reactions';

export type SheetAction = { key: string; label: string; icon?: IconName; subtitle?: string; destructive?: boolean; onPress: () => void };

const useStyles = createStyles((t) => ({
  top: { paddingBottom: t.space[8] },
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb },
  skeletonText: { flex: 1 },
}));

export type ActionSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  label: string;
  /** Above the rows, for example the reaction picker. */
  top?: ReactNode;
  actions: readonly SheetAction[];
  /** `.<key>` per row. */
  testID: string;
};

/** §9 "pickers and actions — bottom sheets": rows that close the sheet and then act. */
export function ActionSheet({ visible, onClose, title, label, top, actions, testID }: ActionSheetProps) {
  const styles = useStyles();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} label={label} expandable={false} narrow testID={testID}>
      {top ? <View style={styles.top}>{top}</View> : null}
      {actions.map((action, index) => (
        <ListRow
          key={action.key}
          icon={action.icon}
          title={action.label}
          subtitle={action.subtitle}
          destructive={action.destructive}
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

export type MessageActionsSheetProps = {
  message: ThreadMessage | null;
  onClose: () => void;
  /** [SIG] reactions: the picker row. */
  reactions: boolean;
  onReact: (message: ThreadMessage, key: ReactionKey | null) => void;
  onCopy: (message: ThreadMessage) => void;
  onHide: (message: ThreadMessage) => void;
  /** M3.7 ai.translate: "Übersetzen" on another member's text, while the flag is on. */
  onTranslate?: (message: ThreadMessage) => void;
  /** M2.6's report flow; the row is there only once the flow is. */
  onReport?: (message: ThreadMessage) => void;
  /** A photo or vehicle message opens from here too, so a screen reader reaches it (review 11). */
  onOpenPhoto?: (message: ThreadMessage) => void;
  onOpenVehicle?: (vehicle: ChatVehicle) => void;
  /** 09 §7.8 "Antworten" (flag `msg_replies`): the way to reply without the swipe (screen readers, keyboards, web). */
  onReply?: (message: ThreadMessage) => void;
  testID: string;
};

/** Contract §7: reactions on long-press (six fixed) and Kopieren · Für mich löschen · Melden. */
export function MessageActionsSheet({
  message,
  onClose,
  reactions,
  onReact,
  onCopy,
  onHide,
  onTranslate,
  onReport,
  onOpenPhoto,
  onOpenVehicle,
  onReply,
  testID,
}: MessageActionsSheetProps) {
  const { t } = useTranslation('messages');
  const common = useTranslation('common').t;
  const actions: SheetAction[] = [];
  if (message?.id && onReply) actions.push({ key: 'reply', label: t('reply.action'), icon: 'arrow-bend-up-left', onPress: () => onReply(message) });
  if (message?.kind === 'photo' && onOpenPhoto) actions.push({ key: 'openPhoto', label: t('thread.openPhoto'), icon: MESSAGE_GLYPHS.photo, onPress: () => onOpenPhoto(message) });
  const shared = message?.kind === 'vehicle' ? message.vehicle : null;
  if (shared && onOpenVehicle) actions.push({ key: 'openVehicle', label: t('thread.vehicleOpen', { title: nameInText(shared.title) }), icon: MESSAGE_GLYPHS.vehicle, onPress: () => onOpenVehicle(shared) });
  if (message?.kind === 'text' && message.body) actions.push({ key: 'copy', label: t('actions.copy'), icon: MESSAGE_GLYPHS.copy, onPress: () => onCopy(message) });
  if (message?.kind === 'text' && message.body && message.id && !message.mine && onTranslate) {
    actions.push({ key: 'translate', label: common('ai.translate.action'), icon: 'translate', onPress: () => onTranslate(message) });
  }
  if (message?.id) actions.push({ key: 'hide', label: t('actions.hide'), icon: MESSAGE_GLYPHS.delete, onPress: () => onHide(message) });
  if (message?.id && !message.mine && onReport) {
    actions.push({ key: 'report', label: t('actions.report'), icon: MESSAGE_GLYPHS.report, destructive: true, onPress: () => onReport(message) });
  }
  const mine = message?.reactions.find((reaction) => reaction.mine)?.key ?? null;
  return (
    <ActionSheet
      visible={message !== null}
      onClose={onClose}
      label={t('actions.label')}
      top={
        reactions && message?.id ? (
          <ReactionPicker
            mine={mine}
            onPick={(key) => {
              onClose();
              onReact(message, key);
            }}
            testID={`${testID}.react`}
          />
        ) : null
      }
      actions={actions}
      testID={testID}
    />
  );
}

export type OrganiseSheetProps = {
  conversation: ConversationSummary | null;
  name: string;
  onClose: () => void;
  onPin: (conversation: ConversationSummary, pinned: boolean) => void;
  onMute: (conversation: ConversationSummary) => void;
  onUnmute: (conversation: ConversationSummary) => void;
  onArchive: (conversation: ConversationSummary, archived: boolean) => void;
  onDelete: (conversation: ConversationSummary) => void;
  testID: string;
};

/** [SIG] organise (contract §7): Anheften, Stummschalten, Archivieren, Löschen. */
export function OrganiseSheet({ conversation, name, onClose, onPin, onMute, onUnmute, onArchive, onDelete, testID }: OrganiseSheetProps) {
  const { t } = useTranslation('messages');
  const actions: SheetAction[] = [];
  if (conversation) {
    const pinned = Boolean(conversation.pinnedAt);
    const muted = isMuted(conversation, new Date());
    const archived = conversation.folder === 'archived';
    if (conversation.folder !== 'requests') {
      if (!archived) actions.push({ key: 'pin', label: t(pinned ? 'organise.unpin' : 'organise.pin'), icon: MESSAGE_GLYPHS.pinned, onPress: () => onPin(conversation, !pinned) });
      actions.push({
        key: 'mute',
        label: t(muted ? 'organise.unmute' : 'organise.mute'),
        icon: MESSAGE_GLYPHS.muted,
        onPress: () => (muted ? onUnmute(conversation) : onMute(conversation)),
      });
      actions.push({ key: 'archive', label: t(archived ? 'organise.unarchive' : 'organise.archive'), icon: MESSAGE_GLYPHS.archive, onPress: () => onArchive(conversation, !archived) });
    }
    actions.push({ key: 'delete', label: t('organise.delete'), icon: MESSAGE_GLYPHS.delete, destructive: true, onPress: () => onDelete(conversation) });
  }
  return (
    <ActionSheet
      visible={conversation !== null}
      onClose={onClose}
      title={t('organise.title', { name })}
      label={t('organise.title', { name })}
      actions={actions}
      testID={testID}
    />
  );
}

const HOUR_MS = 60 * 60 * 1000;

/** "8 Stunden" and "1 Woche" end at a moment; "Bis du es wieder änderst" has no end, never a date far ahead (the server allows a year). */
export function muteChange(choice: 'hours' | 'week' | 'always', from: Date): MuteChange {
  if (choice === 'always') return 'indefinite';
  const hours = choice === 'hours' ? 8 : 7 * 24;
  return { until: new Date(from.getTime() + hours * HOUR_MS).toISOString() };
}

export type MuteSheetProps = {
  visible: boolean;
  onClose: () => void;
  onChoose: (choice: 'hours' | 'week' | 'always') => void;
  testID: string;
};

export function MuteSheet({ visible, onClose, onChoose, testID }: MuteSheetProps) {
  const { t } = useTranslation('messages');
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={t('organise.muteTitle')}
      label={t('organise.muteTitle')}
      top={null}
      actions={[
        { key: 'hours', label: t('organise.muteHours'), subtitle: t('organise.muteBody'), onPress: () => onChoose('hours') },
        { key: 'week', label: t('organise.muteWeek'), onPress: () => onChoose('week') },
        { key: 'always', label: t('organise.muteAlways'), onPress: () => onChoose('always') },
      ]}
      testID={testID}
    />
  );
}

export type AttachSheetProps = {
  visible: boolean;
  onClose: () => void;
  onPhoto: () => void;
  onVehicle: () => void;
  testID: string;
};

/** FS-7 attach sheet: Foto · Fahrzeug teilen. */
export function AttachSheet({ visible, onClose, onPhoto, onVehicle, testID }: AttachSheetProps) {
  const { t } = useTranslation('messages');
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={t('attach.title')}
      label={t('attach.title')}
      actions={[
        { key: 'photo', label: t('attach.photo'), subtitle: t('attach.photoBody'), icon: MESSAGE_GLYPHS.photo, onPress: onPhoto },
        { key: 'vehicle', label: t('attach.vehicle'), subtitle: t('attach.vehicleBody'), icon: MESSAGE_GLYPHS.vehicle, onPress: onVehicle },
      ]}
      testID={testID}
    />
  );
}

export type VehiclePickerSheetProps = {
  visible: boolean;
  onClose: () => void;
  vehicles: Loadable<readonly ChatVehicle[]>;
  onPick: (vehicle: ChatVehicle) => void;
  testID: string;
};

/** "Fahrzeug teilen": your vehicles as rows with a 56 thumb; picking one sends it as a card. */
export function VehiclePickerSheet({ visible, onClose, vehicles, onPick, testID }: VehiclePickerSheetProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const list = vehicles.data ?? [];
  let body: ReactNode;
  if (!vehicles.data && vehicles.isPending) {
    body = (
      <Skeleton testID={`${testID}.skeleton`}>
        {[0, 1].map((index) => (
          <View key={index} style={styles.skeletonRow}>
            <SkeletonBlock width={size.thumb.row} height={size.thumb.row} corner="sm" />
            <View style={styles.skeletonText}>
              <SkeletonText variant="body" width="70%" />
            </View>
          </View>
        ))}
      </Skeleton>
    );
  } else if (!vehicles.data) {
    body = <ErrorState title={t('attach.vehicleError')} onRetry={vehicles.refetch} retrying={vehicles.isFetching} testID={`${testID}.error`} />;
  } else if (list.length === 0) {
    body = <EmptyState icon={MESSAGE_GLYPHS.vehicle} title={t('attach.vehicleEmpty')} testID={`${testID}.empty`} />;
  } else {
    body = list.map((vehicle, index) => (
      <ListRow
        key={vehicle.id}
        title={keepNameTogether(vehicle.title)}
        thumb={photoFields(vehicle.cover, size.thumb.row)}
        hyphenate={false}
        role="button"
        chevron={false}
        onPress={() => {
          onClose();
          onPick(vehicle);
        }}
        inset={0}
        divider={index < list.length - 1}
        testID={`${testID}.${vehicle.slug}`}
      />
    ));
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={t('attach.vehicleTitle')} label={t('attach.vehicleTitle')} narrow testID={testID}>
      {body}
    </Sheet>
  );
}
