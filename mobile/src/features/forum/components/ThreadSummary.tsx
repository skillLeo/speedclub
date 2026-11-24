import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AI_FLAGS } from '@/api/queries/ai';
import { useFlag } from '@/api/queries/appConfig';
import type { ForumThread } from '@/api/queries/forum';
import { createStyles } from '@/theme';
import { IconButton } from '@/ui/IconButton';
import { Icon } from '@/ui/icons/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Text } from '@/ui/Text';

const useStyles = createStyles((t) => ({
  root: { alignItems: 'flex-start', backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, flexDirection: 'row', paddingLeft: t.space[16] },
  main: { flex: 1, minWidth: 0, paddingBottom: t.space[4], paddingTop: t.space[4] },
  toggle: { alignSelf: 'stretch', justifyContent: 'center', minHeight: t.size.touchMin },
  // DQ-P5-056: the wrapping row sits in the toggle's middle (a wrapped row packs to the top by default), and "×" below meets
  // the toggle's centre: main's 4 plus half the 44 toggle = its own 4 plus half its 44 target.
  toggleContent: { alignContent: 'center', alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[2] },
  hide: { marginTop: t.space[4] },
  caretOpen: { transform: [{ rotate: '180deg' }] },
  body: { gap: t.space[8], paddingBottom: t.space[12] },
}));

/** "Ausblenden" holds for the thread while the app runs (no account setting: it is a reading aid, not a preference). */
const dismissed = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function dismiss(threadId: string): void {
  dismissed.add(threadId);
  listeners.forEach((listener) => listener());
}

/** Tests only. */
export function resetThreadSummariesForTests(): void {
  dismissed.clear();
  listeners.forEach((listener) => listener());
}

/**
 * FOR-03 "KI-Zusammenfassung" (M5.9 `ai.forum_summary`, 10 §8.4; no opt-in, guests too, D-3): three short lines the server builds in
 * the background for a published thread with more than 20 replies. A collapsed block above the replies, the label as its caption
 * and no icon of its own (10 §8: label text, no sparkle); it opens on a tap and goes away with "×" for the rest of the session.
 * It arrives with the thread, so it has no loading or error state apart from the thread's; null (flag off, no key, too few replies,
 * a block on a contributing author) shows nothing.
 */
export function ThreadSummary({ thread, routeId }: { thread: Pick<ForumThread, 'id' | 'ai_summary'>; routeId: string }) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const on = useFlag(AI_FLAGS.forumSummary);
  const [open, setOpen] = useState(false);
  const gone = useSyncExternalStore(subscribe, () => dismissed.has(thread.id), () => dismissed.has(thread.id));
  const summary = thread.ai_summary;
  const lines = summary?.lines.filter((line) => line.trim() !== '').slice(0, 3) ?? [];
  if (!on || !summary || lines.length === 0 || gone) return null;
  const basedOn = t('thread.summary.basedOn', { count: summary.based_on_replies });
  const testID = `${routeId}.summary`;

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.main}>
        <PressableScale
          role="button"
          aria-expanded={open}
          aria-label={`${summary.label}, ${basedOn}`}
          onPress={() => setOpen((current) => !current)}
          style={styles.toggle}
          contentStyle={styles.toggleContent}
          testID={`${testID}.toggle`}
        >
          <Text variant="caption" color="text.secondary" hyphenate={false} testID={`${testID}.label`}>
            {summary.label}
          </Text>
          <Text variant="caption" color="text.tertiary" numeric hyphenate={false}>
            {basedOn}
          </Text>
          <View style={open ? styles.caretOpen : null}>
            <Icon name="caret-down" size={16} color="text.secondary" />
          </View>
        </PressableScale>
        {open ? (
          <View style={styles.body} testID={`${testID}.body`}>
            {lines.map((line, index) => (
              <Text key={index} variant="callout" testID={`${testID}.line.${index}`}>
                {line}
              </Text>
            ))}
            <Text variant="caption" color="text.tertiary" testID={`${testID}.note`}>
              {t('thread.summary.note')}
            </Text>
          </View>
        ) : null}
      </View>
      <IconButton icon="x" label={t('thread.summary.hide')} onPress={() => dismiss(thread.id)} style={styles.hide} testID={`${testID}.hide`} />
    </View>
  );
}
