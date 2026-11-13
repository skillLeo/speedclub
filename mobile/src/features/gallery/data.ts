/**
 * Sample data of the development gallery (DEV-01). Real car data from 03_DESIGN_SYSTEM.md and licensed seed photos
 * (design/seed-photos/CREDITS.md), so the gallery works without a database. Focal points come from the seed manifest;
 * the blurhashes were computed once from these files.
 */
import { Asset } from 'expo-asset';

import type { PhotoFields, ViewerImage } from '@/ui';

export const PHOTOS = {
  r34: {
    source: require('@/assets/gallery/nissan-r34-01.jpg') as number,
    blurhash: 'LoGlekxvjYof_Nt7ayj]M{j@ofWB',
    focal: { x: 0.54, y: 0.66 },
  },
  e46: {
    source: require('@/assets/gallery/bmw-e46-01.jpg') as number,
    blurhash: 'LVEeGM-UE2V@}mxYR-jZ-QoJWXoL',
    focal: { x: 0.49, y: 0.59 },
  },
  wheels: {
    source: require('@/assets/gallery/generic-wheels-01.jpg') as number,
    blurhash: 'LAAJ=-~p9]?cxvMxITogyX-;whI[',
    focal: { x: 0.35, y: 0.5 },
  },
  interior: {
    source: require('@/assets/gallery/generic-interior-01.jpg') as number,
    blurhash: 'LPBM_PIUxut7~qM{oft7_3Rjofj[',
    focal: { x: 0.55, y: 0.5 },
  },
} satisfies Record<string, PhotoFields>;


/** A bundled photo as a URL, for what takes only URLs: the viewer and the avatar. */
export function photoUri(photo: { source: number }): string {
  return Asset.fromModule(photo.source).uri;
}

export function viewerImages(): ViewerImage[] {
  return [
    { uri: photoUri(PHOTOS.r34), blurhash: PHOTOS.r34.blurhash, aspectRatio: 800 / 1067, alt: 'Blauer Nissan Skyline GT-R R34 von hinten unter Gewitterwolken' },
    { uri: photoUri(PHOTOS.wheels), blurhash: PHOTOS.wheels.blurhash, aspectRatio: 800 / 1000, alt: 'Mehrteilige Work-Felge vor pinkem Brembo-Bremssattel' },
    { uri: photoUri(PHOTOS.interior), blurhash: PHOTOS.interior.blurhash, aspectRatio: 800 / 1000, alt: 'Cockpit eines Sportwagens mit Handschaltung, schwarz-weiß' },
  ];
}

export const R34 = {
  title: 'Nissan Skyline GT-R R34',
  subtitle: '2002 · 2,6 l R6 Biturbo',
  specs: ['500 PS', '540 Nm', 'AWD'],
};

export const E46 = {
  title: 'BMW M3 E46',
  subtitle: '2004 · 3,2 l R6 Sauger',
  specs: ['343 PS', '365 Nm', 'RWD'],
};

export const LUKAS = { name: 'Lukas Schneider', username: '@lukas.sc', meta: '@lukas.sc · Stuttgart' };

export const SECTIONS = [
  { id: 'typography', title: 'Typografie', hint: 'Schriftstile aus §4' },
  { id: 'colour', title: 'Farben', hint: 'Alle Farb-Tokens des Themes' },
  { id: 'foundation', title: 'Form und Bewegung', hint: 'Radien, Motion-Tokens, Chrome' },
  { id: 'motion', title: 'Bewegung', hint: 'Signatur-Bewegungen SM1 bis SM20' },
  { id: 'icons', title: 'Icons', hint: 'Phosphor und Auto-Glyphen' },
  { id: 'buttons', title: 'Buttons', hint: 'Varianten, Größen, Zustände' },
  { id: 'inputs', title: 'Eingaben', hint: 'Textfeld, Suche, Slider, Stepper' },
  { id: 'selection', title: 'Auswahl', hint: 'Chips, Switch, Checkbox, Tabs' },
  { id: 'badges', title: 'Badges', hint: 'Badge, Beispielinhalte, Spec-Chip, Status, Ungelesen' },
  { id: 'avatars', title: 'Avatare', hint: 'Größen und Fallback' },
  { id: 'cards', title: 'Karten', hint: 'Media-Karten, Fahrzeugkarte, Grid-Kachel' },
  { id: 'rows', title: 'Zeilen', hint: 'Update, Member, Mod, Liste, Besitzer' },
  { id: 'spec', title: 'Technik', hint: 'Spec-Strip und Spec-Zeilen' },
  { id: 'timeline', title: 'Verlauf', hint: 'Timeline mit Fotos und Vorher/Nachher' },
  { id: 'buildsheet', title: 'Build-Sheet', hint: 'Mods nach System, Zeilen zum Aufklappen' },
  { id: 'states', title: 'Zustände', hint: 'Skeleton, leer, Fehler, offline' },
  { id: 'qr', title: 'QR-Code', hint: 'Immer Schwarz auf Weiß' },
  { id: 'chat', title: 'Chat', hint: 'Blasen und Composer' },
  { id: 'header', title: 'Header', hint: 'Compact, Large, auf Foto' },
  { id: 'overlays', title: 'Overlays', hint: 'Sheet, Dialog, Toast, Kontextmenü, Besitzer-Kapsel' },
  { id: 'brand', title: 'Marke', hint: 'Wortmarke und Katakana' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export const noop = () => undefined;

/**
 * DQ-909: the colour roles `meta.deprecated.color` in design/tokens/tokens.json still carries, with their replacement. They
 * stay in the generated themes until their module migrates them, so the colour list marks them "veraltet → Ersatz".
 * tests/ui/GalleryTokens.test.tsx keeps this map equal to the token file.
 */
export const DEPRECATED_COLOURS: Readonly<Record<string, string>> = {
  'tabBar.background': 'chrome.translucent',
  'overlay.photoScrimEnd': 'scrim.photoStart → scrim.photoEnd',
};
