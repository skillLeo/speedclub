/**
 * The app's entry (M4.18, ADR-454): Expo Router first, then the Android widget "Mein Auto". Android launches this same bundle
 * headless when a placed widget asks to be drawn, so the widget's task handler is registered here, outside any screen. On iOS and
 * the web `registerWidget` is an empty function (register.ts) and the widget library stays out of the bundle.
 */
import 'expo-router/entry';

import { registerWidget } from './src/features/widget/register';

registerWidget();
