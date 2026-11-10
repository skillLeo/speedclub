import { useOnline } from '@/state/online';
import { OfflineBanner } from '@/ui';

/** Under the header of every screen in the shell. `label` replaces the generic line where a screen sends nothing. */
export function ShellOfflineBanner({ label }: { label?: string }) {
  const online = useOnline();
  return online ? null : <OfflineBanner label={label} testID="shell.offline" />;
}
