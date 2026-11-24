/** The member web has no scanner (ADR-508): DEX-02 shows "Spotten geht nur in der App" and never renders this. */
export type ScannerPermission = { granted: boolean; canAskAgain: boolean } | null;

export function useScannerPermission(): [ScannerPermission, () => Promise<void>] {
  return [{ granted: false, canAskAgain: false }, async () => undefined];
}

export type ScannerCameraProps = {
  torch: boolean;
  onScanned: ((data: string) => void) | undefined;
  onMountError: () => void;
  testID: string;
};

export function ScannerCamera(_props: ScannerCameraProps) {
  return null;
}
