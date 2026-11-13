import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { photoFields } from '@/features/profile/media';
import { joinShortCompounds, keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { bubble, createStyles, size, space, typography, useTheme } from '@/theme';
import { Button, ChatBubble, DisplayTitle, Icon, Photo, PressableScale, Text, WIDE_BUBBLE_SCALE } from '@/ui';
import { SwipeReply } from '@/ui/motion/kit';
import type { Rect } from '@/ui/motion/math';
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
import { BubbleQuote } from './ReplyQuote';

const PHOTO_WIDTH = bubble.maxWidthRatio * 100;
/**
 * The shortest bubble: one `bodyDense` line in the bubble's vertical padding. Below 44 (§8 touch target), so a pressable bubble
 * gets PressableScale's invisible hit area up to 44 around it; the bubble and the 2 between bubbles of a group stay as drawn.
 */
const BUBBLE_MIN_HEIGHT = typography.body.lineHeight + 2 * space[8];

const useStyles = createStyles((t) => ({
  row: { paddingHorizontal: 0 },
  // Inside a group 2 apart, groups 12 apart (§8: "group within 5 min").
  inGroup: { paddingTop: t.space[2] },
  groupGap: { paddingTop: t.space[12] },
  own: { alignItems: 'flex-end' },
  other: { alignItems: 'flex-start' },
  press: { maxWidth: `${PHOTO_WIDTH}%` },
  pressMedia: { width: `${PHOTO_WIDTH}%` },
  // DQ-939: from font scale 1.5 a text bubble may take the whole column (ChatBubble WIDE_BUBBLE_SCALE).
  pressWide: { maxWidth: '100%' },
  // The press target is already 75 % wide: the bubble fills it instead of taking 75 % of it again.
  bubble: { maxWidth: '100%' },
  bubbleMedia: { alignSelf: 'stretch', maxWidth: '100%' },
  vehicle: { gap: t.space[8] },
  vehicleText: { gap: t.space[2] },
  vehicleView: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
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
  /** 09 §7.8 swipe-to-reply (flag `msg_replies`, native only): a sent message answers on a right swipe. */
  onReply?: (message: ThreadMessage) => void;
  /** SM12: the composer rect this message was sent from, while its morph is due. */
  enterFrom?: Rect | null;
  testID: string;
};

/** The owner line under a shared vehicle: "Fahrzeug von @lukas.sc". */
function ownerLine(vehicle: ChatVehicle, t: (key: string, options: { username: string }) => string): string | null {
  return vehicle.ownerUsername ? t('thread.contextOwner', { username: vehicle.ownerUsername }) : null;
}

const NBSP = '\u00A0';

/** DQ-1086 spec mini-line: "510 PS · 650 Nm", null when the server sends neither. */
export function vehicleSpecLine(vehicle: ChatVehicle, number: (value: number) => string): string | null {
  const parts = [
    vehicle.powerPs ? `${number(Math.round(vehicle.powerPs))}${NBSP}PS` : null,
    vehicle.torqueNm ? `${number(Math.round(vehicle.torqueNm))}${NBSP}Nm` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * DQ-1086 / 09 §7.8 shared vehicle rich card: 16:9 photo (radius concentric to the bubble: 20 − 12 padding = 8), the name in
 * Archivo SemiExpanded (DisplayTitle `card`), the spec mini-line in tabular figures, the owner, and "Ansehen". The whole bubble is
 * the link (a press opens the vehicle), so "Ansehen" is its visible affordance, not a second control inside it.
 */
function VehicleContent({ vehicle, own, timeFollows, testID }: { vehicle: ChatVehicle; own: boolean; timeFollows: boolean; testID: string }) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const format = useFormat();
  const [width, setWidth] = useState(0);
  const owner = ownerLine(vehicle, t);
  const spec = vehicleSpecLine(vehicle, format.number);
  const tone = own ? 'bubble.ownText' : 'bubble.otherText';
  return (
    <View style={styles.vehicle} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Photo aspect="16:9" corner="sm" {...photoFields(vehicle.cover, size.thumb.card * 4)} />
      <View style={styles.vehicleText}>
        <DisplayTitle placement="card" layoutWidth={width > 0 ? width : undefined} color={tone} testID={`${testID}.title`}>
          {endsWord(keepNameTogether(vehicle.title), true)}
        </DisplayTitle>
        {spec ? (
          <Text variant="callout" numeric color={tone} hyphenate={false} testID={`${testID}.spec`}>
            {endsWord(spec, true)}
          </Text>
        ) : null}
        {owner ? (
          <Text variant="caption" color={tone} hyphenate={false}>
            {endsWord(owner, true)}
          </Text>
        ) : null}
      </View>
      <View style={styles.vehicleView} testID={`${testID}.view`}>
        <Text variant="calloutStrong" color={tone} hyphenate={false}>
          {endsWord(t('thread.vehicleView'), timeFollows)}
        </Text>
        <Icon name="caret-right" size={16} color={tone} />
      </View>
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
  onReply,
  enterFrom = null,
  testID,
}: MessageBubbleProps) {
  const wide = useTheme().fontScale >= WIDE_BUBBLE_SCALE;
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
  // r5 MSG-02: a member's own words never break beside a short part of a compound ("RB- / Spezialisten"); display only.
  const body = joinShortCompounds(shownText(message.body ?? '', translation));
  const content = media
    ? [t('thread.photo')]
    : vehicle
      ? [keepNameTogether(vehicle.title), vehicleSpecLine(vehicle, format.number), ownerLine(vehicle, t), t('thread.vehicleView')]
      : [body];
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
      <SwipeReply
        enabled={Boolean(onReply) && !isWeb && message.delivery === 'sent' && message.id !== null}
        onReply={() => onReply?.(message)}
        invertedList
        align={own ? 'end' : 'start'}
        testID={`${testID}.swipe`}
      >
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
          style={media || vehicle ? styles.pressMedia : [styles.press, wide ? styles.pressWide : null]}
          testID={`${testID}.press`}
        >
          <ChatBubble
            own={own}
            groupStart={groupStart}
            groupEnd={groupEnd}
            time={time}
            animateIn={animateIn}
            enterFrom={message.kind === 'text' ? enterFrom : null}
            invertedList
            fill={media || Boolean(vehicle)}
            text={message.kind === 'text' ? body : undefined}
            style={[media || vehicle ? styles.bubbleMedia : styles.bubble, message.delivery === 'sending' || message.delivery === 'queued' ? styles.dim : null]}
            testID={`${testID}.chat`}
          >
            {message.replyTo ? <BubbleQuote quote={message.replyTo} otherName={otherName} own={own} testID={`${testID}.quote`} /> : null}
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
            {vehicle ? <VehicleContent vehicle={vehicle} own={own} timeFollows={Boolean(time)} testID={`${testID}.vehicle`} /> : null}
          </ChatBubble>
        </PressableScale>
      </SwipeReply>
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
