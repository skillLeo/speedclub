import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Icon, Text } from '@/ui';

import { useFirstLineBox } from './lineBox';

export type Rule = {
  key: string;
  label: string;
  /** `null`: only the server can tell, so no verdict before sending. */
  met: boolean | null;
};

const useStyles = createStyles((t) => ({
  list: { gap: t.space[4] },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8] },
  text: { flex: 1 },
}));

/** The rules of a field as a checklist: each one is met or not, and there is no score (02_PRODUCT_SPEC §3.1). */
export function RuleList({ rules, testID }: { rules: readonly Rule[]; testID?: string }) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const iconBox = useFirstLineBox('caption');
  return (
    <View style={styles.list} role="list" testID={testID}>
      {rules.map((rule) => (
        <View
          key={rule.key}
          style={styles.row}
          role="listitem"
          accessible
          aria-label={rule.met === null ? rule.label : `${rule.label}: ${t(rule.met ? 'rules.met' : 'rules.notMet')}`}
          testID={testID ? `${testID}.${rule.key}` : undefined}
        >
          <View style={iconBox}>
            <Icon name={rule.met ? 'check' : 'minus'} size={16} color={rule.met ? 'text.primary' : 'text.tertiary'} />
          </View>
          <Text variant="caption" color={rule.met ? 'text.primary' : 'text.secondary'} style={styles.text}>
            {rule.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
