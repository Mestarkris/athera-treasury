/** Minimal Borsh writer: only the types NEAR transactions and NEP-413 need. */
export class BorshWriter {
  private chunks: Uint8Array[] = [];

  u8(v: number): this {
    this.chunks.push(Uint8Array.of(v & 0xff));
    return this;
  }

  u32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.chunks.push(b);
    return this;
  }

  u64(v: bigint): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    this.chunks.push(b);
    return this;
  }

  i64(v: bigint): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, v, true);
    this.chunks.push(b);
    return this;
  }

  u128(v: bigint): this {
    const b = new Uint8Array(16);
    const dv = new DataView(b.buffer);
    dv.setBigUint64(0, v & 0xffff_ffff_ffff_ffffn, true);
    dv.setBigUint64(8, v >> 64n, true);
    this.chunks.push(b);
    return this;
  }

  fixed(bytes: Uint8Array, len: number): this {
    if (bytes.length !== len) throw new Error(`expected ${len} bytes, got ${bytes.length}`);
    this.chunks.push(bytes);
    return this;
  }

  bytes(bytes: Uint8Array): this {
    this.u32(bytes.length);
    this.chunks.push(bytes);
    return this;
  }

  string(s: string): this {
    return this.bytes(new TextEncoder().encode(s));
  }

  option<T>(v: T | undefined, write: (w: this, v: T) => void): this {
    if (v === undefined) return this.u8(0);
    this.u8(1);
    write(this, v);
    return this;
  }

  done(): Uint8Array {
    const len = this.chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}
