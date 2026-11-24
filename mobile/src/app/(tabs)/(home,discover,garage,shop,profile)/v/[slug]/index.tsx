import { useVehicleViewBeacon } from '@/features/insights/pageBeacons';
import { VehicleScreen } from '@/features/vehicle/screens/VehicleScreen';

export default function Route() {
  // M5.7: one counted view per open of somebody else's build (features/insights/beacon.ts).
  useVehicleViewBeacon();
  return <VehicleScreen />;
}
