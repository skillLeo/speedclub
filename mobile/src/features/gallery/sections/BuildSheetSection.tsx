import { BuildSheet } from '@/ui';

import { noop } from '../data';
import { Group, SectionScreen } from '../parts';

/** DEV-01 Build-Sheet: the 09 §5 BuildSheet with expandable and plain rows, status and legal pills. */
export function BuildSheetSection() {
  return (
    <SectionScreen section="buildsheet">
      <Group title="Build-Sheet" note="Je System Glyphe, Titel und Anzahl. Zeilen mindestens 64 hoch, Glyphe in der 40er-Kachel, Details klappen auf.">
        <BuildSheet
          testID="DEV-01.buildsheet.sheet"
          sections={[
            {
              key: 'engine',
              title: 'Motor',
              icon: 'engine',
              count: 2,
              countLabel: '2 Mods',
              mods: [
                { key: 'turbo', icon: 'turbo', name: 'HKS GT-SS Lader', brand: 'HKS', values: '2 × 0,9 bar', status: 'Verbaut', details: [{ label: 'Eingebaut', value: 'März 2023' }], onPress: noop, testID: 'DEV-01.buildsheet.turbo' },
                { key: 'ecu', icon: 'ecu-chip', name: 'Abstimmung auf dem Prüfstand', values: '500 PS · 540 Nm', status: 'Geplant', onPress: noop },
              ],
            },
            {
              key: 'exhaust',
              title: 'Abgasanlage',
              icon: 'exhaust',
              count: 1,
              countLabel: '1 Mod',
              mods: [{ key: 'tomei', icon: 'exhaust', name: 'Tomei Expreme Ti', brand: 'Tomei', values: 'Titan · 80 mm', status: 'Verbaut', legalStatus: 'Teilegutachten', legalStatusLabel: 'Rechtlicher Status: Teilegutachten', onPress: noop }],
            },
            {
              key: 'wheels',
              title: 'Räder & Reifen',
              icon: 'wheel',
              count: 1,
              countLabel: '1 Mod',
              mods: [{ key: 'bbs', icon: 'wheel', name: 'BBS LM', brand: 'BBS', values: '19″ × 9,5J ET35 · 255/35 R19', status: 'Verbaut', details: [{ label: 'Eingebaut', value: 'Juni 2026' }], onPress: noop, testID: 'DEV-01.buildsheet.bbs' }],
            },
          ]}
        />
      </Group>
    </SectionScreen>
  );
}
