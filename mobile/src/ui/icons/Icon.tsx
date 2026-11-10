/**
 * The only icon component (03_DESIGN_SYSTEM.md §6): the curated Phosphor set plus the custom glyphs.
 * Each Phosphor icon is imported from its own file so the bundle holds only what this map names.
 * Add an icon by adding one import and one map entry here.
 *
 * Icon-only and small controls (M1.2): the icon is the visual, not the target. Web ignores `hitSlop` and
 * the DOM audit measures real elements, so a control below 44 × 44 gets a real hit area, one of:
 *  - a 44 × 44 Pressable around the smaller visual, or an invisible absolutely positioned child of the
 *    Pressable that reaches 44 (preferred, because it also works for the user)
 *  - `dataSet={{ qaHitWrapper: 'true' }}` on a wrapper that handles the press and contains exactly this
 *    one control
 * Name it with `aria-label` on the control, not `label` here. Audit exemptions use only
 * `dataSet={{ qaExempt: '…' }}` (web/tests/e2e/README.md).
 */
import type { Icon as PhosphorIcon } from 'phosphor-react-native';
import { ArchiveIcon } from 'phosphor-react-native/src/icons/Archive';
import { ArrowClockwiseIcon } from 'phosphor-react-native/src/icons/ArrowClockwise';
import { ArrowRightIcon } from 'phosphor-react-native/src/icons/ArrowRight';
import { ArrowSquareOutIcon } from 'phosphor-react-native/src/icons/ArrowSquareOut';
import { ArrowsLeftRightIcon } from 'phosphor-react-native/src/icons/ArrowsLeftRight';
import { BellIcon } from 'phosphor-react-native/src/icons/Bell';
import { BellSlashIcon } from 'phosphor-react-native/src/icons/BellSlash';
import { BookmarkSimpleIcon } from 'phosphor-react-native/src/icons/BookmarkSimple';
import { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { ChartBarIcon } from 'phosphor-react-native/src/icons/ChartBar';
import { ChatCircleIcon } from 'phosphor-react-native/src/icons/ChatCircle';
import { ChatsIcon } from 'phosphor-react-native/src/icons/Chats';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { CircleHalfIcon } from 'phosphor-react-native/src/icons/CircleHalf';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { DeviceMobileIcon } from 'phosphor-react-native/src/icons/DeviceMobile';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { DownloadSimpleIcon } from 'phosphor-react-native/src/icons/DownloadSimple';
import { EyeIcon } from 'phosphor-react-native/src/icons/Eye';
import { EyeSlashIcon } from 'phosphor-react-native/src/icons/EyeSlash';
import { FlagIcon } from 'phosphor-react-native/src/icons/Flag';
import { FunnelIcon } from 'phosphor-react-native/src/icons/Funnel';
import { GarageIcon } from 'phosphor-react-native/src/icons/Garage';
import { GearSixIcon } from 'phosphor-react-native/src/icons/GearSix';
import { GridFourIcon } from 'phosphor-react-native/src/icons/GridFour';
import { HouseIcon } from 'phosphor-react-native/src/icons/House';
import { ImageIcon } from 'phosphor-react-native/src/icons/Image';
import { InfoIcon } from 'phosphor-react-native/src/icons/Info';
import { KeyboardIcon } from 'phosphor-react-native/src/icons/Keyboard';
import { LifebuoyIcon } from 'phosphor-react-native/src/icons/Lifebuoy';
import { LightbulbIcon } from 'phosphor-react-native/src/icons/Lightbulb';
import { LinkIcon } from 'phosphor-react-native/src/icons/Link';
import { ListIcon } from 'phosphor-react-native/src/icons/List';
import { LockSimpleIcon } from 'phosphor-react-native/src/icons/LockSimple';
import { MagicWandIcon } from 'phosphor-react-native/src/icons/MagicWand';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { MegaphoneSimpleIcon } from 'phosphor-react-native/src/icons/MegaphoneSimple';
import { MinusIcon } from 'phosphor-react-native/src/icons/Minus';
import { PencilSimpleIcon } from 'phosphor-react-native/src/icons/PencilSimple';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { ProhibitIcon } from 'phosphor-react-native/src/icons/Prohibit';
import { PushPinIcon } from 'phosphor-react-native/src/icons/PushPin';
import { QrCodeIcon } from 'phosphor-react-native/src/icons/QrCode';
import { QuestionIcon } from 'phosphor-react-native/src/icons/Question';
import { ScalesIcon } from 'phosphor-react-native/src/icons/Scales';
import { SelectionIcon } from 'phosphor-react-native/src/icons/Selection';
import { ShareNetworkIcon } from 'phosphor-react-native/src/icons/ShareNetwork';
import { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';
import { SignInIcon } from 'phosphor-react-native/src/icons/SignIn';
import { SortAscendingIcon } from 'phosphor-react-native/src/icons/SortAscending';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import { TranslateIcon } from 'phosphor-react-native/src/icons/Translate';
import { TrashIcon } from 'phosphor-react-native/src/icons/Trash';
import { UserIcon } from 'phosphor-react-native/src/icons/User';
import { WarningIcon } from 'phosphor-react-native/src/icons/Warning';
import { WifiSlashIcon } from 'phosphor-react-native/src/icons/WifiSlash';
import { WrenchIcon } from 'phosphor-react-native/src/icons/Wrench';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { View } from 'react-native';

import { resolveColor, useTheme, type ColorToken } from '@/theme';

import { autoIcons, type AutoIconName } from './auto';

export const phosphorIcons = {
  archive: ArchiveIcon,
  'arrow-clockwise': ArrowClockwiseIcon,
  'arrow-right': ArrowRightIcon,
  'arrow-square-out': ArrowSquareOutIcon,
  'arrows-left-right': ArrowsLeftRightIcon,
  bell: BellIcon,
  'bell-slash': BellSlashIcon,
  'bookmark-simple': BookmarkSimpleIcon,
  'calendar-blank': CalendarBlankIcon,
  camera: CameraIcon,
  'caret-down': CaretDownIcon,
  'caret-left': CaretLeftIcon,
  'caret-right': CaretRightIcon,
  'chart-bar': ChartBarIcon,
  'chat-circle': ChatCircleIcon,
  chats: ChatsIcon,
  check: CheckIcon,
  'circle-half': CircleHalfIcon,
  clock: ClockIcon,
  copy: CopyIcon,
  'device-mobile': DeviceMobileIcon,
  'dots-three': DotsThreeIcon,
  'download-simple': DownloadSimpleIcon,
  eye: EyeIcon,
  'eye-slash': EyeSlashIcon,
  flag: FlagIcon,
  funnel: FunnelIcon,
  garage: GarageIcon,
  'gear-six': GearSixIcon,
  'grid-four': GridFourIcon,
  house: HouseIcon,
  image: ImageIcon,
  info: InfoIcon,
  keyboard: KeyboardIcon,
  lifebuoy: LifebuoyIcon,
  lightbulb: LightbulbIcon,
  link: LinkIcon,
  list: ListIcon,
  'lock-simple': LockSimpleIcon,
  'magic-wand': MagicWandIcon,
  'magnifying-glass': MagnifyingGlassIcon,
  'megaphone-simple': MegaphoneSimpleIcon,
  minus: MinusIcon,
  'pencil-simple': PencilSimpleIcon,
  plus: PlusIcon,
  prohibit: ProhibitIcon,
  'push-pin': PushPinIcon,
  'qr-code': QrCodeIcon,
  question: QuestionIcon,
  scales: ScalesIcon,
  selection: SelectionIcon,
  'share-network': ShareNetworkIcon,
  'shield-check': ShieldCheckIcon,
  'sign-in': SignInIcon,
  'sort-ascending': SortAscendingIcon,
  star: StarIcon,
  translate: TranslateIcon,
  trash: TrashIcon,
  user: UserIcon,
  warning: WarningIcon,
  'wifi-slash': WifiSlashIcon,
  wrench: WrenchIcon,
  x: XIcon,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof phosphorIcons | AutoIconName;
/** 16, 20 and 24 for UI; 48 only for empty states. */
export type IconSize = 16 | 20 | 24 | 48;
export type IconWeight = 'regular' | 'fill';

export type IconProps = {
  name: IconName;
  size?: IconSize;
  weight?: IconWeight;
  /** Token path; use the colour of the accompanying text. */
  color?: ColorToken;
  /** Gives a standalone meaningful icon an accessible name. Icons inside labelled controls omit it. */
  label?: string;
  testID?: string;
};

function isPhosphor(name: IconName): name is keyof typeof phosphorIcons {
  return name in phosphorIcons;
}

export function Icon({ name, size = 24, weight = 'regular', color = 'text.primary', label, testID }: IconProps) {
  const resolved = resolveColor(useTheme(), color);
  const Glyph = isPhosphor(name) ? phosphorIcons[name] : autoIcons[name];
  const icon = <Glyph size={size} weight={weight} color={resolved} testID={testID} />;
  return label ? (
    <View accessible role="img" aria-label={label}>
      {icon}
    </View>
  ) : (
    icon
  );
}
