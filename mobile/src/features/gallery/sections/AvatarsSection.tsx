import { Avatar, type AvatarSize } from '@/ui';

import { PHOTOS, LUKAS, photoUri } from '../data';
import { Group, SectionScreen, Specimen, Wrap } from '../parts';

const SIZES: readonly AvatarSize[] = [24, 32, 40, 56, 96];

export function AvatarsSection() {
  const uri = photoUri(PHOTOS.wheels);
  return (
    <SectionScreen section="avatars">
      <Group title="Mit Foto" note="Innere Kontur avatar.innerBorder, Blurhash bis zum Laden.">
        <Wrap>
          {SIZES.map((size) => (
            <Specimen key={size} label={String(size)}>
              <Avatar name={LUKAS.name} uri={uri} blurhash={PHOTOS.wheels.blurhash} size={size} testID={`DEV-01.avatars.photo${size}`} />
            </Specimen>
          ))}
        </Wrap>
      </Group>
      <Group title="Initialen" note="Fallback ohne Foto: Initialen auf bg.raised.">
        <Wrap>
          {SIZES.map((size) => (
            <Specimen key={size} label={String(size)}>
              <Avatar name={LUKAS.name} size={size} testID={`DEV-01.avatars.initials${size}`} />
            </Specimen>
          ))}
        </Wrap>
      </Group>
      <Group title="Namen" note="Einzelnamen, Bindestriche und Umlaute.">
        <Wrap>
          <Specimen label="Einzelname">
            <Avatar name="Jann" size={56} />
          </Specimen>
          <Specimen label="Doppelname">
            <Avatar name="Anna-Lena Böhm" size={56} />
          </Specimen>
          <Specimen label="Umlaut">
            <Avatar name="Özge Müller" size={56} />
          </Specimen>
        </Wrap>
      </Group>
    </SectionScreen>
  );
}
