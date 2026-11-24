import { LandInStart } from '@/features/messages/coldLink';
import { MessagesScreen } from '@/features/messages/screens/MessagesScreen';

export default function Route() {
  return (
    <LandInStart>
      <MessagesScreen />
    </LandInStart>
  );
}
