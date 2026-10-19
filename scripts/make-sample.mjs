/**
 * Builds public/sample.glb from scratch: three primitives, two generated PNG
 * textures, one of them deliberately oversized and non-power-of-two so the
 * demo has something to diagnose.
 *
 * Run with `npm run sample`. No dependencies, no downloaded assets.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const OUTPUT = fileURLToPath(new URL('../public/sample.glb', import.meta.url))

/* ------------------------------------------------------------------ PNG */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[n] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typeBytes = Buffer.from(type, 'ascii')
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)

  return Buffer.concat([length, typeBytes, data, checksum])
}

/** Encode RGBA pixels as PNG using the Sub filter, which suits flat colours. */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 1 // filter: Sub
    for (let x = 0; x < stride; x += 1) {
      const value = rgba[y * stride + x]
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0
      raw[rowStart + 1 + x] = (value - left) & 0xff
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function checkerTexture(size, cells) {
  const pixels = Buffer.alloc(size * size * 4)
  const cell = size / cells
  const dark = [24, 30, 42]
  const mint = [70, 214, 176]

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const even = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      const colour = even ? dark : mint
      const offset = (y * size + x) * 4
      pixels[offset] = colour[0]
      pixels[offset + 1] = colour[1]
      pixels[offset + 2] = colour[2]
      pixels[offset + 3] = 255
    }
  }

  return encodePng(size, size, pixels)
}

function gradientTexture(width, height) {
  const pixels = Buffer.alloc(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1)
    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1)
      const offset = (y * width + x) * 4
      pixels[offset] = Math.round(96 + 118 * v + 22 * Math.sin(u * Math.PI * 2))
      pixels[offset + 1] = Math.round(64 + 130 * (1 - v) + 18 * Math.cos(u * Math.PI * 2))
      pixels[offset + 2] = Math.round(168 + 54 * Math.sin(v * Math.PI))
      pixels[offset + 3] = 255
    }
  }

  return encodePng(width, height, pixels)
}

/* ------------------------------------------------------------- geometry */

function box(size) {
  const half = size / 2
  const faces = [
    { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ]

  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  const quadUv = [[0, 0], [1, 0], [1, 1], [0, 1]]

  for (const face of faces) {
    const base = positions.length / 3
    face.corners.forEach((corner, cornerIndex) => {
      positions.push(corner[0] * half, corner[1] * half, corner[2] * half)
      normals.push(...face.normal)
      uvs.push(...quadUv[cornerIndex])
    })
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  }
}

function sphere(radius, widthSegments = 48, heightSegments = 32) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  const gridX = widthSegments
  const gridY = heightSegments

  for (let iy = 0; iy <= gridY; iy += 1) {
    const v = iy / gridY
    for (let ix = 0; ix <= gridX; ix += 1) {
      const u = ix / gridX
      const x = -radius * Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI)
      const y = radius * Math.cos(v * Math.PI)
      const z = radius * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI)

      positions.push(x, y, z)
      normals.push(x / radius, y / radius, z / radius)
      uvs.push(u, 1 - v)
    }
  }

  for (let iy = 0; iy < gridY; iy += 1) {
    for (let ix = 0; ix < gridX; ix += 1) {
      const a = iy * (gridX + 1) + ix
      const b = a + 1
      const c = (iy + 1) * (gridX + 1) + ix + 1
      const d = (iy + 1) * (gridX + 1) + ix
      indices.push(a, b, d, b, c, d)
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  }
}

function torus(majorRadius, minorRadius, tubularSegments = 96, radialSegments = 32) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []

  for (let j = 0; j <= tubularSegments; j += 1) {
    const u = (j / tubularSegments) * Math.PI * 2
    for (let i = 0; i <= radialSegments; i += 1) {
      const v = (i / radialSegments) * Math.PI * 2
      const cosV = Math.cos(v)
      const sinV = Math.sin(v)

      positions.push(
        (majorRadius + minorRadius * cosV) * Math.cos(u),
        (majorRadius + minorRadius * cosV) * Math.sin(u),
        minorRadius * sinV,
      )
      normals.push(cosV * Math.cos(u), cosV * Math.sin(u), sinV)
      uvs.push(j / tubularSegments, i / radialSegments)
    }
  }

  for (let j = 0; j < tubularSegments; j += 1) {
    for (let i = 0; i < radialSegments; i += 1) {
      const a = j * (radialSegments + 1) + i
      const b = (j + 1) * (radialSegments + 1) + i
      const c = (j + 1) * (radialSegments + 1) + i + 1
      const d = j * (radialSegments + 1) + i + 1
      indices.push(a, b, d, b, c, d)
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  }
}

/* ----------------------------------------------------------------- GLB */

const binaryParts = []
let binaryLength = 0

function pushBuffer(buffer) {
  const padding = (4 - (binaryLength % 4)) % 4
  if (padding > 0) {
    binaryParts.push(Buffer.alloc(padding))
    binaryLength += padding
  }

  const offset = binaryLength
  binaryParts.push(buffer)
  binaryLength += buffer.length
  return offset
}

const json = {
  asset: { version: '2.0', generator: 'glb-doctor sample generator' },
  scene: 0,
  scenes: [{ nodes: [0, 1, 2] }],
  nodes: [],
  meshes: [],
  accessors: [],
  bufferViews: [],
  buffers: [{ byteLength: 0 }],
  materials: [],
  textures: [],
  images: [],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function addAccessor(typedArray, componentType, type, target, extra = {}) {
  const buffer = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength)
  const byteOffset = pushBuffer(buffer)

  json.bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: buffer.length,
    ...(target ? { target } : {}),
  })
  json.accessors.push({
    bufferView: json.bufferViews.length - 1,
    componentType,
    count: typedArray.length / COMPONENTS[type],
    type,
    ...extra,
  })

  return json.accessors.length - 1
}

function addMesh(name, geometry, material) {
  const positions = geometry.positions
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]

  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis])
      max[axis] = Math.max(max[axis], positions[index + axis])
    }
  }

  const position = addAccessor(positions, 5126, 'VEC3', 34962, { min, max })
  const normal = addAccessor(geometry.normals, 5126, 'VEC3', 34962)
  const uv = addAccessor(geometry.uvs, 5126, 'VEC2', 34962)
  const indices = addAccessor(geometry.indices, 5123, 'SCALAR', 34963)

  json.meshes.push({
    name,
    primitives: [
      {
        attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv },
        indices,
        material,
      },
    ],
  })

  return json.meshes.length - 1
}

function addImage(name, png) {
  const byteOffset = pushBuffer(png)
  json.bufferViews.push({ buffer: 0, byteOffset, byteLength: png.length })
  json.images.push({ bufferView: json.bufferViews.length - 1, mimeType: 'image/png', name })
  return json.images.length - 1
}

const checker = addImage('checker-1024', checkerTexture(1024, 8))
const gradient = addImage('gradient-3000x1500', gradientTexture(3000, 1500))

json.materials.push(
  {
    name: 'Checkered ceramic',
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      metallicFactor: 0.15,
      roughnessFactor: 0.55,
    },
  },
  {
    name: 'Brushed copper',
    pbrMetallicRoughness: {
      baseColorFactor: [0.95, 0.64, 0.45, 1],
      metallicFactor: 1,
      roughnessFactor: 0.2,
    },
  },
  {
    name: 'Gradient enamel',
    pbrMetallicRoughness: {
      baseColorTexture: { index: 1 },
      metallicFactor: 0.45,
      roughnessFactor: 0.3,
    },
  },
)

json.textures.push(
  { sampler: 0, source: checker, name: 'checker' },
  { sampler: 0, source: gradient, name: 'gradient' },
)

const cubeMesh = addMesh('Cube', box(1.5), 0)
const sphereMesh = addMesh('Sphere', sphere(0.7), 1)
const torusMesh = addMesh('Torus', torus(0.8, 0.25), 2)

json.nodes.push(
  { name: 'Cube', mesh: cubeMesh, translation: [0, 0.75, 0] },
  { name: 'Sphere', mesh: sphereMesh, translation: [-2.5, 0.7, 0.6] },
  {
    name: 'Torus',
    mesh: torusMesh,
    translation: [2.5, 0.25, 0],
    rotation: [-0.70710678, 0, 0, 0.70710678],
  },
)

const bin = Buffer.concat(binaryParts)
json.buffers[0].byteLength = bin.length

const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
const jsonPadding = (4 - (jsonBytes.length % 4)) % 4
const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)])
const binPadding = (4 - (bin.length % 4)) % 4
const binChunk = Buffer.concat([bin, Buffer.alloc(binPadding)])

const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(total, 8)

const jsonHeader = Buffer.alloc(8)
jsonHeader.writeUInt32LE(jsonChunk.length, 0)
jsonHeader.writeUInt32LE(0x4e4f534a, 4)

const binHeader = Buffer.alloc(8)
binHeader.writeUInt32LE(binChunk.length, 0)
binHeader.writeUInt32LE(0x004e4942, 4)

const glb = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk])

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(OUTPUT, glb)

const triangles = json.meshes.reduce((sum, mesh) => {
  const primitive = mesh.primitives[0]
  return sum + json.accessors[primitive.indices].count / 3
}, 0)

console.log(`sample.glb  ${(glb.length / 1024).toFixed(0)} KB`)
console.log(`  meshes     ${json.meshes.length}`)
console.log(`  triangles  ${triangles.toLocaleString('en-US')}`)
console.log(`  textures   ${json.textures.length} (1024×1024, 3000×1500)`)
console.log(`  path       ${OUTPUT}`)
