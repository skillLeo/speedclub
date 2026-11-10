import { registerScroller, runRetap } from '@/features/shell/retap';

describe('runRetap', () => {
  it('scrolls first when the focused screen can', () => {
    const unregister = registerScroller(() => true);
    const pop = jest.fn();
    expect(runRetap(3, pop)).toBe('scrolled');
    expect(pop).not.toHaveBeenCalled();
    unregister();
  });

  it('pops once the screen is at the top', () => {
    const unregister = registerScroller(() => false);
    const pop = jest.fn();
    expect(runRetap(3, pop)).toBe('popped');
    expect(pop).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('pops a screen that registered nothing', () => {
    const pop = jest.fn();
    expect(runRetap(2, pop)).toBe('popped');
  });

  it('does nothing at the root: a pop there would bubble to the root stack', () => {
    const pop = jest.fn();
    expect(runRetap(1, pop)).toBe('none');
    expect(pop).not.toHaveBeenCalled();
  });

  it('a blurred screen cannot remove the registration of the newly focused one', () => {
    const unregisterOld = registerScroller(() => true);
    const unregisterNew = registerScroller(() => false);
    unregisterOld();
    const pop = jest.fn();
    expect(runRetap(2, pop)).toBe('popped');
    unregisterNew();
  });
});
