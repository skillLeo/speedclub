import { Image } from 'expo-image';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { createStyles } from '@/theme';

import { Text } from './Text';

type QrSource =
  /** The SVG markup the server returns. Preferred: it stays sharp at every size. */
  | { svg: string; imageUri?: undefined }
  /** A PNG the server returns. */
  | { svg?: undefined; imageUri: string };

export type QRDisplayProps = QrSource & {
  /** Accessible name of the code, for example "QR-Code für Nissan Skyline GT-R R34". */
  label: string;
  /** "7H2K QXMB" */
  code: string;
  /** "speedclub.de/C/7H2KQXMB". May break once, after the last slash. */
  url?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  card: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: t.color.qr.bg,
    boxShadow: t.colorScheme === 'light' ? t.shadow.e1 : undefined,
    borderRadius: t.radius.lg,
    gap: t.space[4],
    maxWidth: t.size.qrMaxOnScreen + t.space[24] * 2,
    padding: t.space[24],
    width: '100%',
  },
  code: {
    aspectRatio: 1,
    marginBottom: t.space[12],
    maxWidth: t.size.qrMaxOnScreen,
    minWidth: t.size.qrMinOnScreen,
    width: '100%',
  },
  image: { height: '100%', width: '100%' },
  text: { textAlign: 'center' },
  // Inline blocks give the browser one break between the segments, and a selection still copies a single clean URL.
  // Browsers do not break after a slash on their own; iOS and Android do, so they need no style here.
  urlSegmentWeb: { display: 'inline-block' as 'flex' },
}));

/** The URL in two parts, after the last slash. Text without a slash, or ending in one, stays whole. */
export function urlSegments(url: string): readonly string[] {
  const cut = url.lastIndexOf('/') + 1;
  return cut > 0 && cut < url.length ? [url.slice(0, cut), url.slice(cut)] : [url];
}

/**
 * §8 QR display: white card radius 16 padding 24, QR 200 to 320 (card width − 48), always black on white through the
 * qr.* tokens, in every theme. The server draws the code with its quiet zone and EC level Q.
 */
export function QRDisplay({ svg, imageUri, label, code, url, style, testID }: QRDisplayProps) {
  const styles = useStyles();
  const part = (name: string) => (testID ? `${testID}.${name}` : undefined);

  return (
    <View
      dataSet={{ qaExempt: 'qr' }}
      testID={testID}
      style={[styles.card, style]}
    >
      <View accessible role="img" aria-label={label} style={styles.code} testID={part('code')}>
        {svg !== undefined ? (
          <SvgXml xml={svg} width="100%" height="100%" />
        ) : (
          <Image source={{ uri: imageUri }} contentFit="contain" alt="" accessibilityLabel="" accessible={false} style={styles.image} />
        )}
      </View>
      <Text variant="code" color="qr.fg" selectable style={styles.text} testID={part('shortCode')}>
        {code}
      </Text>
      {url ? (
        <Text variant="caption" color="qr.caption" hyphenate={false} selectable style={styles.text} testID={part('url')}>
          {urlSegments(url).map((segment) => (
            <Text key={segment} variant="caption" color="qr.caption" hyphenate={false} style={Platform.OS === 'web' ? styles.urlSegmentWeb : undefined}>
              {segment}
            </Text>
          ))}
        </Text>
      ) : null}
    </View>
  );
}
