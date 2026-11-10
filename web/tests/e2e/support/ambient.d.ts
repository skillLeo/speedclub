// Type declaration for an untyped dev dependency (no @types package is installed).
declare module 'pngjs' {
  export class PNG {
    constructor(options?: { width?: number; height?: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: { read(buffer: Buffer): PNG; write(png: PNG): Buffer };
    static bitblt(src: PNG, dst: PNG, srcX: number, srcY: number, width: number, height: number, deltaX: number, deltaY: number): void;
  }
}
