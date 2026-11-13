/**
 * The motion kit (M4.3): the signature motions of 09 §4.7 as components and hooks, each with its reduced-motion variant
 * (ADR-405), springs only through `springTo` / `effectTo`, transform and opacity only. Demoed on DEV-01 "Bewegung"
 * (`/dev/gallery/motion`).
 *
 * SM3 large-title collapse: `useCollapsingHeader` + `Header` (src/ui). SM7 press: `PressableScale`. SM10 sheets: `Sheet`.
 * SM20 toast: `ToastHost` (swipe away through `useSwipeDismiss`).
 */
export { BeforeAfter } from './BeforeAfter';
export type { BeforeAfterProps } from './BeforeAfter';
export { BrushReveal, brushRevealDuration, SPLASH_MAX_HOLD_MS } from './BrushReveal';
export type { BrushRevealProps } from './BrushReveal';
export { CarouselSnap } from './CarouselSnap';
export type { CarouselSnapProps } from './CarouselSnap';
export { CircularReveal } from './CircularReveal';
export type { CircularRevealProps } from './CircularReveal';
export { ContentReveal } from './ContentReveal';
export type { ContentRevealProps } from './ContentReveal';
export { __resetFlightsForTests, endFlight, measureRect, startFlight, useFlights } from './flight';
export type { Flight } from './flight';
export { FlightLayer } from './FlightLayer';
export { FollowButton, SaveToggle } from './FollowMorph';
export type { FollowButtonProps, SaveToggleProps } from './FollowMorph';
export { collapseFlight, expandFrom, FlightSource, FlightTarget } from './HeroExpand';
export type { FlightOptions } from './HeroExpand';
export { __resetOdometerSessionForTests, LiveCount, OdometerNumber, useDebouncedValue, useOdometerOnce, zeroed } from './OdometerNumber';
export type { OdometerNumberProps } from './OdometerNumber';
export { PageIndicator, StaggerIn, usePagerParallax } from './Pager';
export type { PageIndicatorProps } from './Pager';
export { MapPinScale, SlideUpCard } from './PinSelect';
export type { SlideUpCardProps } from './PinSelect';
export { DrawnRule, PrintWipe, QrReveal } from './QrReveal';
export type { QrRevealProps } from './QrReveal';
export { BUILD_REACTION_GLYPHS, ReactionPicker } from './ReactionPicker';
export type { BuildReactionKey, Reaction, ReactionPickerProps } from './ReactionPicker';
export { StretchyHero, useStretchyHero } from './StretchyHero';
export type { StretchyHeroProps } from './StretchyHero';
export { REPLY_THRESHOLD, SwipeReply } from './SwipeReply';
export type { SwipeReplyProps } from './SwipeReply';
export { SwipeRow, useSwipeDismiss } from './SwipeRow';
export type { SwipeAction, SwipeRowProps } from './SwipeRow';
export { TopScrim } from './TopScrim';
export { TypingDots } from './TypingDots';
export { Wipe } from './Wipe';
export type { WipeProps } from './Wipe';
