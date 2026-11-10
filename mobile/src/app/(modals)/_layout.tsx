import { Stack } from 'expo-router';

import { useCanvasStackOptions } from '@/features/shell/useCanvasStackOptions';

/** Modal stacks. The root stack presents this whole group as a modal; inside it screens push normally. */
export default function Layout() {
  const screenOptions = useCanvasStackOptions();
  return <Stack screenOptions={screenOptions} />;
}
