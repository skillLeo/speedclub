/**
 * Phosphor is imported from its TypeScript source so each icon is bundled alone, which puts that source
 * under our type check. It passes `className` to Svg (used on web), which the Svg types do not declare.
 */
import 'react-native-svg';

declare module 'react-native-svg/lib/typescript/elements/Svg' {
  interface SvgProps {
    className?: string;
  }
}
