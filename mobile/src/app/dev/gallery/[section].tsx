import { Redirect } from 'expo-router';

// The direct comparison lets the bundler drop the require, and the gallery's data and photos with it, in production.
const Gallery =
  process.env.EXPO_PUBLIC_APP_ENV === 'production'
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/features/gallery/screens/GallerySectionScreen') as typeof import('@/features/gallery/screens/GallerySectionScreen'))
        .GallerySectionScreen;

export default function Route() {
  return Gallery ? <Gallery /> : <Redirect href="/" />;
}
