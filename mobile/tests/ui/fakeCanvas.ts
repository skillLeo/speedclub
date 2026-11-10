/**
 * A minimal `document.createElement('canvas')` for the blurhash data URL tests: there is no DOM in this Jest environment.
 * `toDataURL` encodes the drawn pixels, so different hashes give different URLs.
 */
export function installFakeCanvas() {
  const created: { width: number; height: number }[] = [];
  const drawn: Uint8ClampedArray[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');

  const document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`Unexpected element ${tag}`);
      let pixels: Uint8ClampedArray = new Uint8ClampedArray(0);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: (image: { data: Uint8ClampedArray }) => {
            pixels = image.data;
            drawn.push(image.data);
          },
        }),
        toDataURL: (type: string) => `data:${type};base64,${Buffer.from(pixels).toString('base64')}`,
      };
      created.push(canvas);
      return canvas;
    },
  };
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });

  return {
    created,
    drawn,
    uninstall() {
      if (previous) Object.defineProperty(globalThis, 'document', previous);
      else delete (globalThis as { document?: unknown }).document;
    },
  };
}
