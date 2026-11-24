/**
 * DEX-02's camera (spike §2, ADR-508): expo-camera's `CameraView` with QR scanning only, the back camera, the torch. Native only:
 * the member web never opens the camera (`Permissions-Policy camera=()` stays), so ScannerCamera.web.tsx keeps expo-camera and its
 * barcode polyfill out of the web bundle.
 */
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { StyleSheet } from 'react-native';

export type ScannerPermission = { granted: boolean; canAskAgain: boolean } | null;

/** `null` while the system answers; then whether the camera may run and whether the system may still ask. */
export function useScannerPermission(): [ScannerPermission, () => Promise<void>] {
  const [permission, request] = useCameraPermissions();
  const ask = async () => {
    await request().catch(() => undefined);
  };
  return [permission ? { granted: permission.granted, canAskAgain: permission.canAskAgain } : null, ask];
}

export type ScannerCameraProps = {
  torch: boolean;
  /** Undefined while a read is handled: the documented way to stop the stream of reads (spike §2). */
  onScanned: ((data: string) => void) | undefined;
  onMountError: () => void;
  testID: string;
};

const BARCODE_SETTINGS = { barcodeTypes: ['qr' as const] };

export function ScannerCamera({ torch, onScanned, onMountError, testID }: ScannerCameraProps) {
  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      enableTorch={torch}
      barcodeScannerSettings={BARCODE_SETTINGS}
      onBarcodeScanned={onScanned ? (result: BarcodeScanningResult) => onScanned(result.data) : undefined}
      onMountError={onMountError}
      testID={testID}
    />
  );
}
