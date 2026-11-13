import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button, Text, type TextProps } from '@/ui';

import type { AiNoteState } from './availability';

const useStyles = createStyles((t) => ({
  root: { alignItems: 'flex-start', gap: t.space[4] },
}));

export type AiNoteProps = {
  note: AiNoteState;
  variant?: Extract<TextProps['variant'], 'callout' | 'caption'>;
  testID: string;
};

/**
 * The line under an AI surface after a request (M3.7): what happened, in words. For 403 `email_not_verified` (ADR-252) it carries the
 * way to confirm the address (AUTH-04), since that is the only thing the member can do about it.
 */
export function AiNote({ note, variant = 'callout', testID }: AiNoteProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const router = useRouter();
  return (
    <View style={styles.root}>
      <Text variant={variant} color="text.secondary" role="status" testID={`${testID}.note`}>
        {note.text}
      </Text>
      {note.verify ? (
        <Button
          label={t('ai.verifyEmail')}
          variant="tertiary"
          size="s"
          role="link"
          icon="arrow-right"
          flush="start"
          onPress={() => router.push('/verify-email')}
          testID={`${testID}.verify`}
        />
      ) : null}
    </View>
  );
}
