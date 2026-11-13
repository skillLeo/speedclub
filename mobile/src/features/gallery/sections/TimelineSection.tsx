import { Timeline } from '@/ui';

import { PHOTOS, noop } from '../data';
import { Group, SectionScreen, Specimen } from '../parts';

/** DEV-01 Verlauf: the 09 §5 Timeline with every kind of entry the build history has. */
export function TimelineSection() {
  return (
    <SectionScreen section="timeline">
      <Group title="Verlauf" note="Haarlinie als Achse, Monat als Überschrift, Titel in headline, Fotos 3-up, Kilometerstand tabellarisch.">
        <Timeline
          testID="DEV-01.timeline.full"
          entries={[
            {
              key: 'suspension',
              date: 'Juni 2026',
              title: 'Fahrwerk geändert',
              lines: [{ key: 'kw', label: 'Fahrwerk', detail: 'Serie → KW V3 · −35 mm' }],
              note: 'Endlich ohne Aufsetzen über die Tiefgaragenrampe.',
              photos: [PHOTOS.r34, PHOTOS.wheels, PHOTOS.interior],
              mileage: '48.200 km',
              onPress: noop,
            },
            {
              key: 'wheels',
              date: 'Juni 2026',
              title: 'Räder hinzugefügt',
              lines: [
                { key: 'bbs', label: 'Felgen', detail: 'BBS LM 19″ × 9,5J ET35' },
                { key: 'tyres', label: 'Reifen', detail: '255/35 R19' },
              ],
              more: 'und 2 weitere Änderungen',
              beforeAfter: {
                before: { ...PHOTOS.e46, label: 'Vorher' },
                after: { ...PHOTOS.r34, label: 'Nachher' },
                label: 'Vorher-Nachher-Vergleich',
              },
              onPress: noop,
            },
            { key: 'note', date: 'März 2023', title: 'Notiz', note: 'Gekauft in Yokohama, über Bremerhaven nach Stuttgart.', photos: [PHOTOS.e46], onPress: noop },
          ]}
        />
      </Group>
      <Specimen label="Ohne Fotos und ohne Link" fill>
        <Timeline
          testID="DEV-01.timeline.plain"
          entries={[{ key: 'specs', date: 'Mai 2026', title: 'Technik aktualisiert', lines: [{ key: 'power', label: 'Leistung', detail: '280 PS → 500 PS' }] }]}
        />
      </Specimen>
    </SectionScreen>
  );
}
