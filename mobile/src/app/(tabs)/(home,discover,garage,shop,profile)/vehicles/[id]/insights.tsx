import { LandInOwnTab } from '@/features/insights/coldLink';
import { InsightsScreen } from '@/features/insights/screens/InsightsScreen';

export default function Route() {
  return (
    <LandInOwnTab>
      <InsightsScreen scope="vehicle" />
    </LandInOwnTab>
  );
}
