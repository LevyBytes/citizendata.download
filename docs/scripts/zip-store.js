(() => {
  "use strict";

  const encoder = new TextEncoder();
  const UTF8_FLAG = 0x0800;
  const DOS_DATE = 0x0021;

  function crcTable() {
    return Array.from({ length: 256 }, (_, value) => {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      return crc >>> 0;
    });
  }

  const CRC_TABLE = crcTable();

  function toBytes(value) {
    if (typeof value === "string") return encoder.encode(value);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError("ZIP file content must be a string, ArrayBuffer, or typed-array view.");
  }

  function safePath(name) {
    if (typeof name !== "string" || !name || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
    if (name.split("/").some((segment) => !segment || segment === "." || segment === "..")) return false;
    return /^[A-Za-z0-9._/-]+$/u.test(name);
  }

  function crc32(value) {
    const bytes = toBytes(value);
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function write16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function write32(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  function concat(chunks, totalLength) {
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  function build(files) {
    if (!Array.isArray(files) || files.length === 0) throw new TypeError("At least one ZIP file is required.");
    if (files.length > 0xffff) throw new RangeError("ZIP64 is not supported for more than 65,535 files.");

    const normalized = files.map((file) => {
      if (!file || !safePath(file.name)) throw new TypeError(`Unsafe ZIP path: ${String(file?.name ?? "")}`);
      const bytes = toBytes(file.bytes);
      const name = encoder.encode(file.name);
      if (name.byteLength > 0xffff) throw new RangeError(`ZIP path is too long: ${file.name}`);
      if (bytes.byteLength > 0xffffffff) throw new RangeError(`ZIP64 is not supported: ${file.name}`);
      return { path: file.name, name, bytes, crc: crc32(bytes) };
    }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index - 1].path === normalized[index].path) throw new TypeError(`Duplicate ZIP path: ${normalized[index].path}`);
    }

    const localChunks = [];
    const centralChunks = [];
    let localOffset = 0;
    let centralLength = 0;

    for (const file of normalized) {
      const local = new Uint8Array(30);
      const localView = new DataView(local.buffer);
      write32(localView, 0, 0x04034b50);
      write16(localView, 4, 20);
      write16(localView, 6, UTF8_FLAG);
      write16(localView, 8, 0);
      write16(localView, 10, 0);
      write16(localView, 12, DOS_DATE);
      write32(localView, 14, file.crc);
      write32(localView, 18, file.bytes.byteLength);
      write32(localView, 22, file.bytes.byteLength);
      write16(localView, 26, file.name.byteLength);
      write16(localView, 28, 0);
      localChunks.push(local, file.name, file.bytes);

      const central = new Uint8Array(46);
      const centralView = new DataView(central.buffer);
      write32(centralView, 0, 0x02014b50);
      write16(centralView, 4, 20);
      write16(centralView, 6, 20);
      write16(centralView, 8, UTF8_FLAG);
      write16(centralView, 10, 0);
      write16(centralView, 12, 0);
      write16(centralView, 14, DOS_DATE);
      write32(centralView, 16, file.crc);
      write32(centralView, 20, file.bytes.byteLength);
      write32(centralView, 24, file.bytes.byteLength);
      write16(centralView, 28, file.name.byteLength);
      write16(centralView, 30, 0);
      write16(centralView, 32, 0);
      write16(centralView, 34, 0);
      write16(centralView, 36, 0);
      write32(centralView, 38, 0);
      write32(centralView, 42, localOffset);
      centralChunks.push(central, file.name);

      localOffset += local.byteLength + file.name.byteLength + file.bytes.byteLength;
      centralLength += central.byteLength + file.name.byteLength;
      if (localOffset > 0xffffffff || centralLength > 0xffffffff) throw new RangeError("ZIP64 is not supported for this archive size.");
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054b50);
    write16(endView, 4, 0);
    write16(endView, 6, 0);
    write16(endView, 8, normalized.length);
    write16(endView, 10, normalized.length);
    write32(endView, 12, centralLength);
    write32(endView, 16, localOffset);
    write16(endView, 20, 0);

    const archiveLength = localOffset + centralLength + end.byteLength;
    if (archiveLength > 0xffffffff) throw new RangeError("ZIP64 is not supported for this archive size.");
    return concat([...localChunks, ...centralChunks, end], archiveLength);
  }

  globalThis.CitizenDataZip = Object.freeze({ build, crc32, safePath });
})();
