import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Icon, Text } from '@/ui';

import { useFirstLineBox } from './lineBox';

const useStyles = createStyles((t) => ({
  root: {
    alignItems: 'flex-start',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.sm,
    flexDirection: 'row',
    gap: t.space[12],
    padding: t.space[12],
  },
  text: { flex: 1 },
}));

export type FormNoticeProps = {
  message: string;
  /** `error` for what went wrong, `info` for what the member should know. */
  tone?: 'error' | 'info';
  testID?: string;
};

/** An answer that belongs to the whole form, not to one field. Icon and text, never colour alone. */
export function FormNotice({ message, tone = 'error', testID }: FormNoticeProps) {
  const styles = useStyles();
  const iconBox = useFirstLineBox('supporting');
  const error = tone === 'error';
  return (
    <View style={styles.root} role={error ? 'alert' : 'status'} testID={testID}>
      <View style={iconBox}>
        <Icon name={error ? 'warning' : 'info'} size={20} color={error ? 'accent.fg' : 'text.secondary'} />
      </View>
      <Text variant="supporting" style={styles.text}>
        {message}
      </Text>
    </View>
  );
}
