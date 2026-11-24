import { LandInStart } from '@/features/messages/coldLink';
import { ConversationInfoScreen } from '@/features/messages/screens/ConversationInfoScreen';

export default function Route() {
  return (
    <LandInStart>
      <ConversationInfoScreen />
    </LandInStart>
  );
}
