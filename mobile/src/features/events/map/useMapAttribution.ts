import { useTranslation } from 'react-i18next';

/** 09 §8.7: "© OpenMapTiles © OpenStreetMap-Mitwirkende", always visible on the map, in the app's language. */
export function useMapAttribution(): string {
  return useTranslation('events').t('map.attribution');
}
