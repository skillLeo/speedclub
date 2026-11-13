import { useTranslation } from 'react-i18next';

import { useAppConfig } from '@/api/queries/appConfig';
import { size, space } from '@/theme';
import { Button, type PhotoFields } from '@/ui';

import { BrandStage } from '../components/BrandStage';

type GateAction = { label: string; onPress: () => void; loading?: boolean };

type Props = {
  routeId: string;
  title: string;
  body: string;
  hyphenateBody?: boolean;
  /** A line under the body, for example the installed and the required version. */
  detail?: string;
  /** SYS-01's way out of the gate, above "Erneut prüfen": the store or the get-the-app page. */
  primary?: GateAction;
  photo: PhotoFields;
};

/** The width of a gate's text column on a phone, inside the gutters (kept for the line estimates of the copy checks). */
export function gateBodyWidth(windowWidth: number): number {
  return Math.min(size.dialogMaxWidth, windowWidth - 2 * space[24]) - 2 * space[16];
}

/**
 * SYS-01 and SYS-02 (09 §7.14, brand layer ADR-143): the photo-backed brand state — the night photo, the wordmark, one line and
 * the way out: the store for an update (the one filled CTA), "Erneut prüfen" for both. The app-config poll lifts the gate by
 * itself as soon as the server allows it. A message the team wrote can be of any length: the copy scrolls at a large font.
 */
export function GateScreen({ routeId, title, body, hyphenateBody, detail, primary, photo }: Props) {
  const { t } = useTranslation('common');
  const { refetch, isFetching } = useAppConfig();
  const label = t('gate.checkAgain');
  return (
    <BrandStage
      routeId={routeId}
      photo={photo}
      title={title}
      body={body}
      hyphenateBody={hyphenateBody}
      detail={detail}
      actions={
        <>
          {primary ? (
            <Button label={primary.label} size="l" fullWidth loading={primary.loading} onPress={primary.onPress} testID={`${routeId}.store`} />
          ) : null}
          <Button
            label={label}
            variant={primary ? 'secondary' : 'primary'}
            size="l"
            fullWidth
            loading={isFetching}
            onPress={() => void refetch()}
            testID={`${routeId}.state.action`}
          />
        </>
      }
    />
  );
}
