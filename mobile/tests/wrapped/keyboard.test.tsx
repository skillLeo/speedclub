import { storyKeyAction } from '@/features/wrapped/model';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

describe('WRP-01 on the web keyboard', () => {
  it('→ next, ← previous, Escape close, Space pause', () => {
    expect(storyKeyAction('ArrowRight', null)).toBe('next');
    expect(storyKeyAction('ArrowLeft', null)).toBe('previous');
    expect(storyKeyAction('Escape', null)).toBe('close');
    expect(storyKeyAction(' ', { tagName: 'DIV', getAttribute: () => null })).toBe('pause');
  });

  it('a focused button keeps its own Space; other keys stay the page’s', () => {
    expect(storyKeyAction(' ', { tagName: 'BUTTON' })).toBeNull();
    expect(storyKeyAction(' ', { tagName: 'DIV', getAttribute: (name) => (name === 'role' ? 'button' : null) })).toBeNull();
    expect(storyKeyAction('a', null)).toBeNull();
    expect(storyKeyAction('Tab', null)).toBeNull();
    expect(storyKeyAction('Enter', null)).toBeNull();
  });
});
