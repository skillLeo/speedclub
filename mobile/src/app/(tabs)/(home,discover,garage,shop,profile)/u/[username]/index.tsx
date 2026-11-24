import { useProfileViewBeacon } from '@/features/insights/pageBeacons';
import { MemberProfileScreen } from '@/features/profile/screens/MemberProfileScreen';

export default function Route() {
  // M5.7: one counted view per open of another member's profile (features/insights/beacon.ts).
  useProfileViewBeacon();
  return <MemberProfileScreen />;
}
