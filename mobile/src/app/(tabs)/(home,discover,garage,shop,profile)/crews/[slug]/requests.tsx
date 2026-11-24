import { CrewManageScreen } from '@/features/crews/screens/CrewManageScreen';

/** The tap path of a `request_received` notification (contract §5): CREW-03 on its Anfragen tab. */
export default function Route() {
  return <CrewManageScreen tab="requests" />;
}
