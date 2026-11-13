import { View } from 'react-native';

import { createStyles, size } from '@/theme';
import { Avatar, Photo, type PhotoFields } from '@/ui';

const useStyles = createStyles((t) => ({
  root: { flexShrink: 0 },
  // 09 §5 Avatar / §7.8: the member's main car as a square badge (radius 4) on the avatar's bottom-right, a canvas ring cuts it free.
  badge: {
    borderColor: t.color.bg.canvas,
    borderRadius: t.radius.xs,
    borderWidth: t.size.border.control,
    bottom: -t.space[2],
    height: t.size.icon.m,
    overflow: 'hidden',
    position: 'absolute',
    right: -t.space[2],
    width: t.size.icon.m,
  },
}));

export type CarBadgeAvatarProps = {
  name: string;
  uri?: string | null;
  blurhash?: string | null;
  /** The main car's photo; without it the avatar has no badge. */
  car?: PhotoFields | null;
};

/** MSG-01's avatar 56: who writes, and with the car badge what they drive (09 §7.8). Decorative: the row names the member. */
export function CarBadgeAvatar({ name, uri, blurhash, car }: CarBadgeAvatarProps) {
  const styles = useStyles();
  return (
    <View style={styles.root}>
      <Avatar decorative name={name} uri={uri} blurhash={blurhash} size={size.avatar.lg} />
      {car ? (
        <View style={styles.badge}>
          <Photo {...car} aspect="1:1" />
        </View>
      ) : null}
    </View>
  );
}
