import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button, Header } from '@/ui';

import { BrandStage } from '../components/BrandStage';
import { NOT_FOUND_PHOTO } from '../photos';

const useStyles = createStyles(() => ({
  screen: { flex: 1 },
}));

export type NotFoundScreenProps = {
  /** M1.7 passes the "QR revoked" copy here; the layout stays. */
  title?: string;
  body?: string;
};

/**
 * SYS-03 (09 §7.14, DQ-1088): link not found, revoked or private, as a photo-backed brand state like SYS-01/02. A full-bleed 4:5
 * night photo from the top edge under a transparent header with back, fading into the Carbon stage; the wordmark, `title.1`, one
 * line and the one filled way on, "Zur Startseite", left-aligned in the lower part. From 768 the AUTH-02 split: photo 7 columns
 * edge to edge, the copy vertically centred in the other 5. Back leaves the way the member came, or goes home when the link was
 * opened directly (no history), so there is always a control in the corner.
 */
export function NotFoundScreen({ title, body }: NotFoundScreenProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={styles.screen} testID="SYS-03.screen">
      <BrandStage
        routeId="SYS-03"
        photo={NOT_FOUND_PHOTO}
        title={title ?? t('notFound.title')}
        body={body ?? t('notFound.body')}
        header={<Header variant="photo" onBack={back} hairline={false} testID="SYS-03.header" />}
        actions={
          <Link href="/" replace asChild>
            <Button label={t('notFound.home')} role="link" variant="primary" size="l" fullWidth testID="SYS-03.home" />
          </Link>
        }
      />
    </View>
  );
}
