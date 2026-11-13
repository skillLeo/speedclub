/**
 * The "Mit Google fortfahren" button in Google's sign-in branding (09 §5 ProviderButtons): the only place outside the tokens that
 * holds colours, because Google prescribes them (https://developers.google.com/identity/branding-guidelines). Dark variant on
 * Carbon and Schwarz, light variant on Hell; the standard multicolour "G". Shape, size, type and press feedback stay the app's.
 */
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { createStyles, useTheme } from '@/theme';

import { PressableScale } from './PressableScale';
import { Spinner } from './Spinner';
import { Text } from './Text';

const GOOGLE = {
  dark: {
    // design-lint-disable-next-line DL01 -- Google sign-in button colours (Google branding guidelines, dark theme)
    fill: '#131314',
    // design-lint-disable-next-line DL01 -- Google sign-in button colours (Google branding guidelines, dark theme)
    stroke: '#8E918F',
    // design-lint-disable-next-line DL01 -- Google sign-in button colours (Google branding guidelines, dark theme)
    label: '#E3E3E3',
  },
  light: {
    // design-lint-disable-next-line DL01 -- Google sign-in button colours (Google branding guidelines, light theme)
    fill: '#FFFFFF',
    // design-lint-disable-next-line DL01 -- Google sign-in button colours (Google branding guidelines, light theme)
    stroke: '#747775',
    // design-lint-disable-next-line DL01 -- Google sign-in button colours (Google branding guidelines, light theme)
    label: '#1F1F1F',
  },
} as const;

const G = {
  // design-lint-disable-next-line DL01 -- the standard Google "G" (Google branding guidelines)
  red: '#EA4335',
  // design-lint-disable-next-line DL01 -- the standard Google "G" (Google branding guidelines)
  blue: '#4285F4',
  // design-lint-disable-next-line DL01 -- the standard Google "G" (Google branding guidelines)
  yellow: '#FBBC05',
  // design-lint-disable-next-line DL01 -- the standard Google "G" (Google branding guidelines)
  green: '#34A853',
} as const;

/** The multicolour "G", 18 × 18 in its own grid, drawn at the icon size. */
export function GoogleMark({ size }: { size: 16 | 20 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <Path fill={G.red} d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z" />
      <Path fill={G.blue} d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <Path fill={G.yellow} d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9.008 9.008 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z" />
      <Path fill={G.green} d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z" />
    </Svg>
  );
}

const useStyles = createStyles((t) => ({
  target: { alignSelf: 'stretch' },
  hug: { alignSelf: 'flex-start' },
  content: {
    alignItems: 'center',
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    flexDirection: 'row',
    gap: t.space[8],
    justifyContent: 'center',
    minHeight: t.size.button.l,
    paddingHorizontal: t.size.buttonPaddingX.l - t.size.border.control,
    paddingVertical: t.space[8],
  },
  inner: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: t.space[8], justifyContent: 'center' },
  label: { flexShrink: 1, textAlign: 'center' },
  hidden: { opacity: 0 },
  spinner: { alignItems: 'center', justifyContent: 'center' },
  // Offline or another provider loading: the app's disabled fill, as every other button.
  disabled: { backgroundColor: t.color.bg.raised, borderColor: t.color.border.default },
}));

export type GoogleButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  testID?: string;
};

export function GoogleButton({ label, onPress, loading = false, disabled = false, fullWidth = true, testID }: GoogleButtonProps) {
  const styles = useStyles();
  const theme = useTheme();
  const colors = theme.colorScheme === 'light' ? GOOGLE.light : GOOGLE.dark;
  return (
    <PressableScale
      role="button"
      aria-label={label}
      aria-busy={loading}
      aria-disabled={disabled || undefined}
      disabled={disabled || undefined}
      feedback={!loading}
      onPress={() => {
        if (!loading) onPress();
      }}
      testID={testID}
      style={fullWidth ? styles.target : styles.hug}
      contentStyle={[styles.content, disabled ? styles.disabled : { backgroundColor: colors.fill, borderColor: colors.stroke }]}
    >
      <View style={[styles.inner, loading ? styles.hidden : null]}>
        <GoogleMark size={20} />
        <Text
          variant="bodyStrong"
          color={disabled ? 'text.disabled' : undefined}
          selectable={false}
          hyphenate={false}
          style={[styles.label, disabled ? null : { color: colors.label }]}
        >
          {label}
        </Text>
      </View>
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.spinner]}>
          <Spinner decorative size={20} color="text.primary" />
        </View>
      ) : null}
    </PressableScale>
  );
}
