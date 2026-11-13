import { Redirect, useLocalSearchParams } from 'expo-router';
import type { ComponentType } from 'react';

import type { SectionId } from '../data';
import { AvatarsSection } from '../sections/AvatarsSection';
import { BadgesSection } from '../sections/BadgesSection';
import { BrandSection } from '../sections/BrandSection';
import { BuildSheetSection } from '../sections/BuildSheetSection';
import { ButtonsSection } from '../sections/ButtonsSection';
import { CardsSection } from '../sections/CardsSection';
import { ChatSection } from '../sections/ChatSection';
import { ColourSection } from '../sections/ColourSection';
import { FoundationSection } from '../sections/FoundationSection';
import { HeaderSection } from '../sections/HeaderSection';
import { IconsSection } from '../sections/IconsSection';
import { InputsSection } from '../sections/InputsSection';
import { MotionSection } from '../sections/MotionSection';
import { OverlaysSection } from '../sections/OverlaysSection';
import { QrSection } from '../sections/QrSection';
import { RowsSection } from '../sections/RowsSection';
import { SelectionSection } from '../sections/SelectionSection';
import { SpecSection } from '../sections/SpecSection';
import { StatesSection } from '../sections/StatesSection';
import { TimelineSection } from '../sections/TimelineSection';
import { TypographySection } from '../sections/TypographySection';

const SCREENS: Record<SectionId, ComponentType> = {
  typography: TypographySection,
  colour: ColourSection,
  foundation: FoundationSection,
  motion: MotionSection,
  icons: IconsSection,
  buttons: ButtonsSection,
  inputs: InputsSection,
  selection: SelectionSection,
  badges: BadgesSection,
  avatars: AvatarsSection,
  cards: CardsSection,
  rows: RowsSection,
  spec: SpecSection,
  timeline: TimelineSection,
  buildsheet: BuildSheetSection,
  states: StatesSection,
  qr: QrSection,
  chat: ChatSection,
  header: HeaderSection,
  overlays: OverlaysSection,
  brand: BrandSection,
};

export function GallerySectionScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const Section = SCREENS[section as SectionId];
  return Section ? <Section /> : <Redirect href="/dev/gallery" />;
}
