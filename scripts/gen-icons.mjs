// Gera ícones PNG (quadrado roxo Linear + triângulo play branco) sem dependências.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixelAt) {
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4)
    raw[row] = 0 // filtro None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y)
      raw.set([r, g, b, a], row + 1 + x * 4)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const BG = [0x5e, 0x6a, 0xd2, 0xff]
const FG = [0xff, 0xff, 0xff, 0xff]
const EMPTY = [0, 0, 0, 0]

function iconPixel(size) {
  const radius = size * 0.22
  // Triângulo play: vértices proporcionais ao tamanho.
  const x0 = size * 0.38
  const y0 = size * 0.28
  const y1 = size * 0.72
  const x1 = size * 0.74
  return (x, y) => {
    // Cantos arredondados.
    const cx = Math.min(Math.max(x, radius), size - radius)
    const cy = Math.min(Math.max(y, radius), size - radius)
    if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) return EMPTY
    // Dentro do triângulo? Largura da linha cresce até o meio e volta.
    if (x >= x0 && y >= y0 && y <= y1) {
      const t = 1 - Math.abs((y - (y0 + y1) / 2) / ((y1 - y0) / 2))
      if (x <= x0 + (x1 - x0) * t) return FG
    }
    return BG
  }
}

for (const size of [16, 48, 128]) {
  writeFileSync(join(outDir, `icon${size}.png`), png(size, iconPixel(size)))
}
console.log('Ícones gerados em public/icons/')
