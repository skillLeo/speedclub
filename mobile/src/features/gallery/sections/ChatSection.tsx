import { useState } from 'react';
import { View } from 'react-native';

import { bubble, createStyles, size } from '@/theme';
import { ChatBubble, Composer } from '@/ui';

import { noop } from '../data';
import { FullBleed, Group, SectionScreen, Specimen } from '../parts';

const useStyles = createStyles((t) => ({
  thread: { gap: t.space[4] },
  groupGap: { marginTop: t.space[12] },
}));

const LABELS = { placeholder: 'Nachricht schreiben', sendLabel: 'Senden', attachLabel: 'Foto anhängen' };

export function ChatSection() {
  const styles = useStyles();
  const [draft, setDraft] = useState('');
  return (
    <SectionScreen section="chat">
      <Group
        title="Blasen"
        note={`Höchstens ${Math.round(bubble.maxWidthRatio * 100)}\u00A0% breit, Radius ${bubble.radius}, ${bubble.tailRadius} an der Ecke zum Absender.`}
      >
        <View style={styles.thread}>
          <ChatBubble text="Hi, ist das dein R34 aus Stuttgart?" senderLabel="Jann" tail={false} testID="DEV-01.chat.other" />
          <ChatBubble text={'Hast du die BBS\u00A0LM selbst aufbereitet?'} senderLabel="Jann" time="14:32" />
          <View style={styles.groupGap}>
            <ChatBubble own text="Ja, das ist meiner." senderLabel="Du" tail={false} testID="DEV-01.chat.own" />
          </View>
          <ChatBubble
            own
            senderLabel="Du"
            text="Die Felgen hat eine Werkstatt in Esslingen gemacht, das KW V3 habe ich selbst eingebaut und um 35 mm tiefergelegt."
            time="14:35"
          />
        </View>
      </Group>
      <Group
        title="Eingabezeile"
        note={`Randlos wie auf einem echten Bildschirm: Plus am Seitenrand, Senden endet an der eigenen Blase. Mindestens ${size.composerMin} hoch, wächst bis ${size.composerMaxLines} Zeilen, Senden erst mit Text.`}
      >
        <Specimen label="Live" fill>
          <FullBleed>
            <Composer {...LABELS} value={draft} onChangeText={setDraft} onSend={() => setDraft('')} onAttach={noop} testID="DEV-01.chat.composer" />
          </FullBleed>
        </Specimen>
        <Specimen label="Mit Text" fill>
          <FullBleed>
            <Composer {...LABELS} value="Wann bist du beim nächsten Treffen dabei?" onChangeText={noop} onSend={noop} onAttach={noop} />
          </FullBleed>
        </Specimen>
        <Specimen label="Mehrzeilig" fill>
          <FullBleed>
            <Composer
              {...LABELS}
              value={'Das klingt gut.\nWelche Federrate fährst du vorne?\nUnd passt das noch mit 255/35 R19?\nIch überlege, auch auf KW V3 zu gehen.\nHast du eine Eintragung?'}
              onChangeText={noop}
              onSend={noop}
              onAttach={noop}
            />
          </FullBleed>
        </Specimen>
        <Specimen label="Fokus" fill forced={{ focused: true }}>
          <FullBleed>
            <Composer {...LABELS} value="Wann bist du beim nächsten Treffen dabei?" onChangeText={noop} onSend={noop} onAttach={noop} />
          </FullBleed>
        </Specimen>
        <Specimen label="Wird gesendet" fill>
          <FullBleed>
            <Composer {...LABELS} value="Bis Samstag am Hockenheimring." onChangeText={noop} onSend={noop} onAttach={noop} sending />
          </FullBleed>
        </Specimen>
        <Specimen label="Deaktiviert" fill>
          <FullBleed>
            <Composer {...LABELS} value="" onChangeText={noop} onSend={noop} onAttach={noop} disabled />
          </FullBleed>
        </Specimen>
      </Group>
    </SectionScreen>
  );
}
