import { LandInStart } from '@/features/messages/coldLink';
import { ConversationScreen } from '@/features/messages/screens/MessagingScreens';

export default function Route() {
  return (
    <LandInStart>
      <ConversationScreen />
    </LandInStart>
  );
}
