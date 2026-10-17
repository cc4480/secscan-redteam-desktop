export declare class XdrReader {
    private readonly buf;
    private off;
    constructor(buf: Buffer);
    u32(): number;
    /** XDR string: u32 length, bytes, zero-padded to a 4-byte boundary. */
    str(): string;
    /** Skip n bytes plus XDR padding to the next 4-byte boundary. */
    skip(n: number): void;
    rest(): Buffer;
}
export declare function xdrU32(v: number): Buffer;
export declare function xdrString(s: string): Buffer;
