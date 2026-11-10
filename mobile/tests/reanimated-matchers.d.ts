// Reanimated declares these only in its native entry, which TypeScript does not load.
declare namespace jest {
  // @types/jest declares both parameters, and merging requires identical ones.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R, T> {
    toHaveAnimatedStyle(style: Record<string, unknown>, config?: { shouldMatchAllProps?: boolean }): R;
  }
}
