import { useTranslation } from 'react-i18next';

import { FormSkeleton, GoneState, LoadErrorState, SignInState } from '../../components/frames';
import type { WizardStep } from '../../model';
import { wizardPath } from '../../navigation';
import type { WizardState } from '../../wizard';

/** Every state of a step but the form: skeleton of FS-5's geometry, sign-in, a draft that is gone, error, offline. */
export function WizardStateBody({
  state,
  step,
  draftId,
  onRetry,
  retrying,
}: {
  state: Exclude<WizardState, 'ready'>;
  step: WizardStep;
  draftId: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { t } = useTranslation('garage');
  if (state === 'loading') return <FormSkeleton routeId="GAR-03" groups={step === 'specs' ? [5, 2, 1, 2] : [4]} />;
  if (state === 'guest') return <SignInState routeId="GAR-03" returnTo={String(wizardPath(draftId, step))} />;
  if (state === 'gone') return <GoneState routeId="GAR-03" title={t('wizard.goneTitle')} body={t('wizard.goneBody')} />;
  return <LoadErrorState routeId="GAR-03" offline={state === 'offline'} onRetry={onRetry} retrying={retrying} />;
}
