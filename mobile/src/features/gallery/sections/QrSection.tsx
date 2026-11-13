import { radius, space } from '@/theme';
import { QRDisplay } from '@/ui';

import { Group, SectionScreen } from '../parts';
import { QR_SAMPLE_SVG } from '../qrSample';

export function QrSection() {
  return (
    <SectionScreen section="qr">
      <Group title="QR-Anzeige" note={`Weiße Karte in jedem Theme, Radius ${radius.md}, Innenabstand ${space[24]}, Fehlerkorrektur Q.`}>
        <QRDisplay
          svg={QR_SAMPLE_SVG}
          label="QR-Code für Nissan Skyline GT-R R34"
          code="7H2K QXMB"
          url="speedclub.de/C/7H2KQXMB"
          testID="DEV-01.qr.display"
        />
      </Group>
    </SectionScreen>
  );
}
