/**
 * ProviderButtons (09 §5, §7.2 AUTH-02): the sign-in methods as a stack of L buttons.
 *
 * - Apple: Apple's adaptive style — a white button on the dark themes, black on Hell (the inverse fill), solid logo, radius 8,
 *   height 52. The native `AppleAuthenticationButton` replaces it on iOS once `expo-apple-authentication` is installed.
 * - Google: Google's branding (dark variant on the dark themes, light on Hell; the multicolour "G"), colours in GoogleBrand.
 * - E-Mail: always present. While it is the first method of the stack (no Apple or Google above it) it is the one primary, in the
 *   inverse fill (DQ-989, ADR-431 a); below a provider it is the secondary, on a photo over the `chrome.translucent` ground (DQ-986).
 * - Passkey: tertiary "Mit Passkey anmelden" where passkeys are available (the web offers them in the e-mail field too).
 *
 * Order (AUTH-02): Apple first on iOS, Google first on Android, Apple then Google on the web; E-Mail after them. Loading shows the
 * spinner inside the pressed button and disables the others; offline disables all with the reason underneath.
 */
import { Platform, View } from 'react-native';

import { createStyles } from '@/theme';

import { Button } from './Button';
import { GoogleButton, GoogleMark } from './GoogleBrand';
import { Icon, type IconName } from './icons/Icon';
import { useReduceTransparency } from './motion';
import { Text } from './Text';

export type ProviderKey = 'apple' | 'google' | 'email' | 'passkey';

/** Which methods this build offers right now; `email` is always on. */
export type ProviderAvailability = { apple: boolean; google: boolean; passkey: boolean };

/** The stack's order for a platform (AUTH-02). */
export function providerOrder(available: ProviderAvailability, os: string = Platform.OS): ProviderKey[] {
  const social: ProviderKey[] = os === 'android' ? ['google', 'apple'] : ['apple', 'google'];
  return [...social.filter((key) => available[key as 'apple' | 'google']), 'email', ...(available.passkey ? (['passkey'] as const) : [])];
}

export type ProviderButtonsProps = {
  providers: readonly ProviderKey[];
  onPress: (provider: ProviderKey) => void;
  /** The provider whose sign-in is running: its button spins, the others rest. */
  busy?: ProviderKey | null;
  /** Offline: every button rests and `disabledReason` says why under them. */
  disabled?: boolean;
  disabledReason?: string;
  labels: Record<ProviderKey, string>;
  /** Over the Welcome photo the tertiary passkey button takes the photo's text colour. */
  onPhoto?: boolean;
  /** Buttons hug their labels in a row on wide windows (AUTH-02 ≥ tablet); full width otherwise. */
  fullWidth?: boolean;
  /** `<route>.provider.<key>` per button. */
  testID: string;
};

const useStyles = createStyles((t) => ({
  stack: { gap: t.space[12] },
  // DQ-986: an outlined button over a photo stands on the chrome ground, so the photo never shows through its label.
  photoGround: { backgroundColor: t.color.chrome.translucent, borderRadius: t.radius.sm },
  photoGroundOpaque: { backgroundColor: t.color.chrome.opaque, borderRadius: t.radius.sm },
  // ProviderStackPreview: the buttons as a picture, at their real geometry.
  preview: { gap: t.space[12], pointerEvents: 'none' },
  previewRow: {
    alignItems: 'center',
    borderColor: t.color.border.default,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    flexDirection: 'row',
    gap: t.space[8],
    justifyContent: 'center',
    minHeight: t.size.button.l,
    paddingHorizontal: t.size.buttonPaddingX.l,
  },
  previewMarked: { backgroundColor: t.color.bg.inverse, borderColor: t.color.bg.inverse },
}));

export function ProviderButtons({
  providers,
  onPress,
  busy = null,
  disabled = false,
  disabledReason,
  labels,
  onPhoto = false,
  fullWidth = true,
  testID,
}: ProviderButtonsProps) {
  const styles = useStyles();
  const opaque = useReduceTransparency();
  const emailLeads = providers[0] === 'email';
  const resting = (key: ProviderKey) => disabled || (busy !== null && busy !== key);
  return (
    <View style={styles.stack} testID={testID}>
      {providers.map((key) => {
        const common = {
          label: labels[key],
          size: 'l' as const,
          fullWidth,
          loading: busy === key,
          disabled: resting(key),
          onPress: () => onPress(key),
          testID: `${testID}.${key}`,
        };
        switch (key) {
          case 'apple':
            return <Button key={key} {...common} variant="primary" icon="apple-logo" iconWeight="fill" />;
          case 'google':
            return <GoogleButton key={key} {...common} />;
          case 'email':
            if (emailLeads) return <Button key={key} {...common} variant="primary" icon="envelope-simple" />;
            if (!onPhoto) return <Button key={key} {...common} variant="secondary" icon="envelope-simple" />;
            return (
              <View key={key} style={opaque ? styles.photoGroundOpaque : styles.photoGround}>
                <Button {...common} variant="onPhoto" icon="envelope-simple" />
              </View>
            );
          case 'passkey':
            return (
              <Button
                key={key}
                {...common}
                size="m"
                variant={onPhoto ? 'onPhotoText' : 'tertiary'}
                icon="key"
              />
            );
        }
      })}
      {disabled && disabledReason ? (
        <Text variant="caption" color={onPhoto ? 'onPhoto.secondary' : 'text.secondary'} testID={`${testID}.reason`}>
          {disabledReason}
        </Text>
      ) : null}
    </View>
  );
}

const PREVIEW_ICONS: Readonly<Record<Exclude<ProviderKey, 'google'>, IconName>> = { apple: 'apple-logo', email: 'envelope-simple', passkey: 'key' };

export type ProviderStackPreviewProps = {
  providers: readonly ProviderKey[];
  labels: Record<ProviderKey, string>;
  /** The method drawn in the inverse fill; the others are dimmed outlines. */
  marked: ProviderKey;
  testID: string;
};

/**
 * DQ-994 (AUTH-14, 09 §7.2): the AUTH-02 stack as an illustration: the rows at the buttons' geometry, the marked one in the inverse
 * fill and the rest dimmed. Nothing here is a control: no press, no focus, hidden from screen readers (the body says it in words).
 */
export function ProviderStackPreview({ providers, labels, marked, testID }: ProviderStackPreviewProps) {
  const styles = useStyles();
  return (
    <View aria-hidden importantForAccessibility="no-hide-descendants" style={styles.preview} testID={testID}>
      {providers.map((key) => {
        const on = key === marked;
        const color = on ? 'text.inverse' : 'text.tertiary';
        return (
          <View key={key} style={[styles.previewRow, on ? styles.previewMarked : null]} testID={`${testID}.${key}${on ? '.marked' : ''}`}>
            {key === 'google' ? (
              <GoogleMark size={20} />
            ) : (
              <Icon name={PREVIEW_ICONS[key]} size={20} color={color} weight={key === 'apple' ? 'fill' : 'regular'} />
            )}
            <Text variant="bodyStrong" color={color} selectable={false} hyphenate={false}>
              {labels[key]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
