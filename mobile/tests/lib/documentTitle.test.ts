/** R4B-002: the browser title names the focused screen, the product name alone where a screen has no title. */
import { documentTitleFor } from '@/lib/documentTitle';

describe('documentTitleFor', () => {
  it('puts the screen title before the product name', () => {
    expect(documentTitleFor('Garage')).toBe('Garage | Speedclub');
    expect(documentTitleFor('  Skyline GT-R R34 ')).toBe('Skyline GT-R R34 | Speedclub');
  });

  it('is the product name alone without a title', () => {
    expect(documentTitleFor(undefined)).toBe('Speedclub');
    expect(documentTitleFor('   ')).toBe('Speedclub');
  });
});
