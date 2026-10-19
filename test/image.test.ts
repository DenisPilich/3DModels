import { describe, expect, it } from 'vitest'
import { readImageSize } from '../src/index'
import { fakeJpeg, fakePng, fakeWebp } from './fixtures'

function ktx2(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(12, 0, true) // vkFormat
  view.setUint32(16, 1, true) // typeSize
  view.setUint32(20, width, true)
  view.setUint32(24, height, true)
  return bytes
}

function avif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 32, false)
  bytes.set(new TextEncoder().encode('ftyp'), 4)
  bytes.set(new TextEncoder().encode('avif'), 8)
  bytes.set(new TextEncoder().encode('ispe'), 32)
  view.setUint32(40, width, false)
  view.setUint32(44, height, false)
  return bytes
}

describe('readImageSize', () => {
  it('reads PNG', () => {
    expect(readImageSize(fakePng(1024, 512))).toEqual({ mimeType: 'image/png', width: 1024, height: 512 })
  })

  it('reads JPEG', () => {
    expect(readImageSize(fakeJpeg(640, 480))).toEqual({ mimeType: 'image/jpeg', width: 640, height: 480 })
  })

  it('reads WebP', () => {
    expect(readImageSize(fakeWebp(300, 200))).toEqual({ mimeType: 'image/webp', width: 300, height: 200 })
    expect(readImageSize(fakeWebp(2048, 1))).toEqual({ mimeType: 'image/webp', width: 2048, height: 1 })
  })

  it('reads KTX2', () => {
    expect(readImageSize(ktx2(2048, 2048))).toEqual({ mimeType: 'image/ktx2', width: 2048, height: 2048 })
  })

  it('reads AVIF', () => {
    expect(readImageSize(avif(1920, 1080))).toEqual({ mimeType: 'image/avif', width: 1920, height: 1080 })
  })

  it('returns null for unknown or truncated data', () => {
    expect(readImageSize(new Uint8Array(0))).toBeNull()
    expect(readImageSize(new TextEncoder().encode('not an image at all'))).toBeNull()
    expect(readImageSize(fakePng(1, 1).subarray(0, 12))).toBeNull()
  })
})
