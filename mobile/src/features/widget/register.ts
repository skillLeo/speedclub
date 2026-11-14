/**
 * Android widget "Mein Auto" (09 §8.14): iOS and the member web have no home-screen widget, so their bundles never load
 * react-native-android-widget. The Android build takes register.android.ts instead.
 */
export function registerWidget(): void {
  // Nothing to register outside Android.
}
