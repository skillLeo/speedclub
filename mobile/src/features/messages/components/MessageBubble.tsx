import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { photoFields } from '@/features/profile/media';
import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space, typography } from '@/theme';
import { Button, ChatBubble, Icon, Photo, PressableScale, Text } from '@/ui';
import { endsWord, joinLabel } from '@/ui/rowParts';
import { shownText, TranslationControls } from '@/features/ai/TranslatableText';
import type { TranslationState } from '@/features/ai/translations';

import { MESSAGE_GLYPHS } from '../glyphs';
import type { MessageItem } from '../grouping';
import type { ChatVehicle, ReactionKey, ThreadMessage } from '../model';
import { photoAspect } from '../text';
import { useScreenReader } from '../useScreenReader';

import { ChatPhoto, chatPhotoUrl } from './ChatPhoto';
import { ReactionChips } from './Reactions';

const PHOTO_WIDTH = size.chatBubbleMaxWidthRatio * 100;
/**
 * The shortest bubble: one `bodyDense` line in the bubble's vertical padding. Below 44 (§8 touch target), so a pressable bubble
 * gets PressableScale's invisible hit area up to 44 around it; the bubble and the 2 between bubbles of a group stay as drawn.
 */
const BUBBLE_MIN_HEIGHT = typography.bodyDense.lineHeight + 2 * space[8];

const useStyles = createStyles((t) => ({
  row: { paddingHorizontal: 0 },
  // Inside a group 2 apart, groups 12 apart (§8: "group within 5 min").
  inGroup: { paddingTop: t.space[2] },
  groupGap: { paddingTop: t.space[12] },
  own: { alignItems: 'flex-end' },
  other: { alignItems: 'flex-start' },
  press: { maxWidth: `${PHOTO_WIDTH}%` },
  pressMedia: { width: `${PHOTO_WIDTH}%` },
  // The press target is already 75 % wide: the bubble fills it instead of taking 75 % of it again.
  bubble: { maxWidth: '100%' },
  bubbleMedia: { alignSelf: 'stretch', maxWidth: '100%' },
  vehicle: { gap: t.space[4] },
  status: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[4], marginTop: t.space[4] },
  receipt: { marginTop: t.space[4] },
  dim: { opacity: t.opacity.pressed },
}));

export type MessageBubbleProps = {
  item: MessageItem;
  /** "Gelesen" goes under this one (receipts.ts). */
  receipt: boolean;
  /** The other member's name for screen readers: "Nachricht von Jann". */
  otherName: string;
  /** Written here and still on its way (the outbox): §10 "message send", rises 8 and fades in. The server copy keeps the key, so it does not rise again. */
  animateIn: boolean;
  /** [SIG] reactions: tapping a chip toggles your own. */
  reactions: boolean;
  onActions: (message: ThreadMessage) => void;
  onRetry: (clientId: string) => void;
  onRemove: (clientId: string) => void;
  onOpenPhoto: (message: ThreadMessage) => void;
  onOpenVehicle: (vehicle: ChatVehicle) => void;
  onReact: (message: ThreadMessage, key: ReactionKey | null) => void;
  /** A signed photo URL did not load (expired): read the newest page again for fresh ones. */
  onPhotoFailed?: (message: ThreadMessage) => void;
  /** M3.7 ai.translate: this message's translation once asked for (from the actions); the bubble shows it with its label. */
  translation?: TranslationState;
  onToggleTranslation?: (message: ThreadMessage) => void;
  testID: string;
};

/** The owner line under a shared vehicle: "Fahrzeug von @lukas.sc". */
function ownerLine(vehicle: ChatVehicle, t: (key: string, options: { username: string }) => string): string | null {
  return vehicle.ownerUsername ? t('thread.contextOwner', { username: vehicle.ownerUsername }) : null;
}

function VehicleContent({ vehicle, own, timeFollows }: { vehicle: ChatVehicle; own: boolean; timeFollows: boolean }) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const owner = ownerLine(vehicle, t);
  return (
    <View style={styles.vehicle}>
      <Photo aspect="4:3" corner="sm" {...photoFields(vehicle.cover, size.thumb.card * 4)} />
      <Text variant="bodyStrong" color={own ? 'text.inverse' : 'text.primary'} hyphenate={false}>
        {endsWord(keepNameTogether(vehicle.title), Boolean(owner) || timeFollows)}
      </Text>
      {owner ? (
        <Text variant="caption" color={own ? 'text.inverse' : 'text.secondary'} hyphenate={false}>
          {endsWord(owner, timeFollows)}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One message of FS-7 on §8's ChatBubble: text, a photo or a vehicle card, the time under its group, its reactions, and for your
 * own the way it is going ("Wartet auf Verbindung", "Nicht gesendet · Erneut senden") and "Gelesen". Long-press (and a press on
 * web for a text) opens the message actions; a photo opens the viewer and a vehicle its page.
 */
export const MessageBubble = memo(function MessageBubble({
  item,
  receipt,
  otherName,
  animateIn,
  reactions,
  onActions,
  onRetry,
  onRemove,
  onOpenPhoto,
  onOpenVehicle,
  onReact,
  onPhotoFailed,
  translation,
  onToggleTranslation,
  testID,
}: MessageBubbleProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const format = useFormat();
  const { message, groupStart, groupEnd } = item;
  const own = message.mine;
  const created = new Date(message.createdAt);
  const time = message.delivery === 'sent' && groupEnd ? format.time(created) : undefined;
  const sender = own ? t('you') : otherName;
  const media = message.kind === 'photo';
  const vehicle = message.kind === 'vehicle' ? message.vehicle : null;
  const photo = media
    ? message.media
      ? { uri: chatPhotoUrl(message.media, size.thumb.card * 4), blurhash: message.media.blurhash, aspect: photoAspect(message.media.width, message.media.height) }
      : message.localPhoto
        ? { uri: message.localPhoto.uri, blurhash: null, aspect: photoAspect(message.localPhoto.width, message.localPhoto.height) }
        : null
    : null;

  // What the bubble shows comes first, in its order, then the time under it (WCAG 2.5.3: the name starts with the visible text),
  // then who wrote it and how it is going.
  const body = shownText(message.body ?? '', translation);
  const content = media ? [t('thread.photo')] : vehicle ? [keepNameTogether(vehicle.title), ownerLine(vehicle, t)] : [body];
  const label = joinLabel([
    ...content,
    format.time(created),
    own ? t('you') : t('thread.messageFrom', { name: otherName }),
    message.delivery === 'queued' ? t('thread.queued') : message.delivery === 'failed' ? t('thread.failed') : null,
    receipt ? t('thread.read') : null,
  ]);

  // Review 11: with a screen reader a press opens the actions (they hold "Foto öffnen" and "Fahrzeug öffnen" too), and the
  // actions are a custom accessibility action as well, since a long-press is hard to reach there.
  const openPrimary = () => {
    if (screenReader && message.delivery === 'sent') onActions(message);
    else if (media && photo) onOpenPhoto(message);
    else if (vehicle) onOpenVehicle(vehicle);
    else if (isWeb) onActions(message);
  };
  const pressable = message.delivery === 'sent' || media || Boolean(vehicle);
  const screenReader = useScreenReader();

  return (
    <View style={[styles.row, groupStart ? styles.groupGap : styles.inGroup, own ? styles.own : styles.other]} testID={testID}>
      <PressableScale
        role="button"
        aria-label={label}
        aria-busy={message.delivery === 'sending'}
        disabled={!pressable}
        onPress={openPrimary}
        onLongPress={message.delivery === 'sent' ? () => onActions(message) : undefined}
        accessibilityActions={message.delivery === 'sent' ? [{ name: 'longpress', label: t('actions.label') }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress' && message.delivery === 'sent') onActions(message);
        }}
        delayLongPress={350}
        visualHeight={pressable ? BUBBLE_MIN_HEIGHT : undefined}
        style={media || vehicle ? styles.pressMedia : styles.press}
        testID={`${testID}.press`}
      >
        <ChatBubble
          own={own}
          tail={groupEnd}
          time={time}
          animateIn={animateIn}
          fill={media || Boolean(vehicle)}
          text={message.kind === 'text' ? body : undefined}
          style={[media || vehicle ? styles.bubbleMedia : styles.bubble, message.delivery === 'sending' || message.delivery === 'queued' ? styles.dim : null]}
          testID={`${testID}.chat`}
        >
          {photo ? (
            <ChatPhoto
              uri={photo.uri}
              blurhash={photo.blurhash}
              aspect={photo.aspect}
              label={t('thread.photoFrom', { name: sender })}
              onFailed={message.media ? () => onPhotoFailed?.(message) : undefined}
              testID={`${testID}.photo`}
            />
          ) : null}
          {vehicle ? <VehicleContent vehicle={vehicle} own={own} timeFollows={Boolean(time)} /> : null}
        </ChatBubble>
      </PressableScale>
      {translation && onToggleTranslation && message.kind === 'text' && translation.status !== 'failed' ? (
        <TranslationControls state={translation} onToggle={() => onToggleTranslation(message)} testID={`${testID}.translate`} />
      ) : null}
      {reactions && message.reactions.length > 0 ? (
        <ReactionChips reactions={message.reactions} onToggle={(key, mine) => onReact(message, mine ? null : key)} testID={`${testID}.reactions`} />
      ) : null}
      {message.delivery === 'queued' ? (
        <View style={styles.status} testID={`${testID}.queued`}>
          <Icon name={MESSAGE_GLYPHS.waiting} size={16} color="text.tertiary" />
          <Text variant="caption" color="text.tertiary">
            {t('thread.queued')}
          </Text>
        </View>
      ) : null}
      {message.delivery === 'failed' && message.clientId ? (
        <View style={styles.status} testID={`${testID}.failed`} role="alert">
          <Icon name={MESSAGE_GLYPHS.failed} size={16} color="accent.fg" />
          <Text variant="caption" color="accent.fg">
            {message.failure?.message || t('thread.failed')}
          </Text>
          {message.failure?.reason !== 'cannot_message' && message.failure?.reason !== 'request_pending' && message.failure?.reason !== 'invalid' ? (
            <Button
              label={t('thread.retry')}
              variant="tertiary"
              size="s"
              onPress={() => message.clientId && onRetry(message.clientId)}
              testID={`${testID}.retry`}
            />
          ) : null}
          <Button
            label={t('thread.remove')}
            variant="tertiary"
            size="s"
            onPress={() => message.clientId && onRemove(message.clientId)}
            testID={`${testID}.remove`}
          />
        </View>
      ) : null}
      {receipt ? (
        <Text variant="caption" color="text.tertiary" style={styles.receipt} testID={`${testID}.read`}>
          {t('thread.read')}
        </Text>
      ) : null}
    </View>
  );
});
