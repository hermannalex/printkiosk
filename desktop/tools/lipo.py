#!/usr/bin/env python3
"""Joins 64-bit Mach-O binaries for different CPUs into one universal (fat) binary, like Apple's lipo.
Usage: lipo.py out in-arm64 in-amd64"""
import struct, sys

NAMES = {0x0100000C: "arm64", 0x01000007: "x86_64"}
ALIGN = 14  # 16 KB pages

out, inputs = sys.argv[1], sys.argv[2:]
slices = []
for path in inputs:
    data = open(path, "rb").read()
    magic, cputype, cpusubtype = struct.unpack("<III", data[:12])
    if magic != 0xFEEDFACF:
        sys.exit(f"{path}: não é Mach-O 64 bits")
    slices.append((cputype, cpusubtype, data))

up = lambda n: (n + (1 << ALIGN) - 1) & ~((1 << ALIGN) - 1)
offset = up(8 + 20 * len(slices))
blob = bytearray(struct.pack(">II", 0xCAFEBABE, len(slices)))
placed = []
for cputype, cpusubtype, data in slices:
    blob += struct.pack(">IIIII", cputype, cpusubtype, offset, len(data), ALIGN)
    placed.append((offset, data))
    offset = up(offset + len(data))
for off, data in placed:
    blob += b"\0" * (off - len(blob))
    blob += data
open(out, "wb").write(blob)
print(out, [NAMES.get(c, hex(c)) for c, _, _ in slices])
