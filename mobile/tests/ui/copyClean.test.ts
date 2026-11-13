/**
 * NH-R4-1: the member web sets zero-width spaces (U+200B) and word joiners (U+2060) to steer where a name or an identifier
 * breaks. Copying from the app gives the text as it reads: none of them reach the clipboard.
 */
import { cleanCopy, withoutBreakControls } from '@/theme/webDocument';
import { handleText, identifierText, nameInText } from '@/ui/textBreaks';

function copyEvent() {
  const data = new Map<string, string>();
  const event = {
    clipboardData: { setData: (type: string, value: string) => data.set(type, value) } as unknown as DataTransfer,
    preventDefault: jest.fn(),
  };
  return { event, data };
}

const selection = (text: string) => ({ toString: () => text });

describe('copy on the member web (NH-R4-1)', () => {
  it('drops the break controls of identifiers, handles and names', () => {
    expect(withoutBreakControls(identifierText('lukas.sc@speed-club.test'))).toBe('lukas.sc@speed-club.test');
    expect(withoutBreakControls(handleText('@paul.roadster'))).toBe('@paul.roadster');
    expect(withoutBreakControls(nameInText('Nissan Skyline GT-R R34'))).toBe('Nissan Skyline GT-R R34');
  });

  it('puts the clean text on the clipboard when the selection holds one', () => {
    const { event, data } = copyEvent();
    const shown = `Code an ${identifierText('lukas.sc@speed-club.test')} gesendet`;
    expect(cleanCopy(event, selection(shown))).toBe(true);
    expect(data.get('text/plain')).toBe('Code an lukas.sc@speed-club.test gesendet');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('leaves a plain selection, a field and an empty selection to the browser', () => {
    for (const text of ['Fahrwerk und Felgen', '']) {
      const { event, data } = copyEvent();
      expect(cleanCopy(event, selection(text))).toBe(false);
      expect(data.size).toBe(0);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    const { event } = copyEvent();
    expect(cleanCopy(event, null)).toBe(false);
  });
});
