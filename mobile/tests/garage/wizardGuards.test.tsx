/**
 * R4B-005: a published draft releases the discard guards of all its steps, and the move to GAR-04 waits until the last one has.
 */
import { act, render } from '@testing-library/react-native';

import {
  __resetWizardGuardsForTests,
  markWizardPublished,
  useReportWizardGuard,
  useWizardPublished,
  whenWizardGuardsReleased,
} from '@/features/garage/wizardGuards';

function Step({ draftId, dirty }: { draftId: string; dirty: boolean }) {
  const published = useWizardPublished(draftId);
  useReportWizardGuard(draftId, dirty && !published);
  return null;
}

beforeEach(() => __resetWizardGuardsForTests());

describe('wizardGuards', () => {
  it('runs at once when no step of the draft guards', () => {
    const then = jest.fn();
    whenWizardGuardsReleased('d1', then);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it('waits for a dirty step until the draft is published, then runs once', async () => {
    await act(async () => {
      render(
        <>
          <Step draftId="d1" dirty />
          <Step draftId="d1" dirty={false} />
          <Step draftId="other" dirty />
        </>,
      );
    });
    const then = jest.fn();
    whenWizardGuardsReleased('d1', then);
    expect(then).not.toHaveBeenCalled();

    await act(async () => markWizardPublished('d1'));
    expect(then).toHaveBeenCalledTimes(1);

    // Later changes never run it again; the other draft still guards.
    await act(async () => markWizardPublished('d1'));
    expect(then).toHaveBeenCalledTimes(1);
    const other = jest.fn();
    whenWizardGuardsReleased('other', other);
    expect(other).not.toHaveBeenCalled();
  });

  it('a cancelled wait never runs', async () => {
    await act(async () => {
      render(<Step draftId="d2" dirty />);
    });
    const then = jest.fn();
    const cancel = whenWizardGuardsReleased('d2', then);
    cancel();
    await act(async () => markWizardPublished('d2'));
    expect(then).not.toHaveBeenCalled();
  });
});
