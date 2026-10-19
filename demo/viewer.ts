import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export interface Viewer {
  /** Replace the current model with the one in `buffer`. */
  load(buffer: ArrayBuffer): Promise<{ meshes: number; animations: number }>
  clear(): void
}

/**
 * A deliberately small three.js viewer: one model, orbit controls, studio
 * lighting. It exists to make the report visible, not to be a product.
 */
export function createViewer(canvas: HTMLCanvasElement): Viewer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()

  // A tiny procedural studio environment gives PBR materials something to
  // reflect, without shipping an HDR file.
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.85

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 5000)
  camera.position.set(2.4, 1.8, 3.2)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.rotateSpeed = 0.85
  controls.panSpeed = 0.7
  controls.maxPolarAngle = Math.PI * 0.94
  controls.target.set(0, 0.6, 0)

  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(3, 5, 4)
  const rim = new THREE.DirectionalLight(0x8ed6ff, 1.1)
  rim.position.set(-4, 1.5, -3)
  scene.add(key, rim)

  const loader = new GLTFLoader()

  let current: THREE.Object3D | null = null
  let mixer: THREE.AnimationMixer | null = null
  let previous = performance.now()

  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const delta = Math.min((now - previous) / 1000, 0.1)
    previous = now

    mixer?.update(delta)
    controls.update()
    renderer.render(scene, camera)
  })

  const resize = (): void => {
    const width = canvas.clientWidth || 1
    const height = canvas.clientHeight || 1
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  new ResizeObserver(resize).observe(canvas)
  resize()

  function clear(): void {
    if (!current) return

    scene.remove(current)
    disposeTree(current)
    current = null

    if (mixer) {
      mixer.stopAllAction()
      mixer = null
    }
  }

  async function load(buffer: ArrayBuffer): Promise<{ meshes: number; animations: number }> {
    const gltf = await loader.parseAsync(buffer, '')
    const root = gltf.scene

    clear()
    scene.add(root)
    current = root

    let meshes = 0
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) meshes += 1
    })

    if (gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(root)
      for (const clip of gltf.animations) mixer.clipAction(clip).play()
    }

    frame(root)
    return { meshes, animations: gltf.animations.length }
  }

  function frame(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object)

    if (box.isEmpty()) {
      camera.position.set(2.4, 1.8, 3.2)
      controls.target.set(0, 0, 0)
      controls.update()
      return
    }

    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const halfFov = (camera.fov * Math.PI) / 360
    const tan = Math.tan(halfFov)

    // Fit the bounding box per axis: a wide, flat scene should not be framed
    // as if it were a sphere, or it ends up tiny in the middle of the canvas.
    const forHeight = size.y / 2 / tan
    const forWidth = size.x / 2 / (tan * Math.max(camera.aspect, 0.2))
    const distance = Math.max(forHeight, forWidth, size.z / 2) * 1.3

    const direction = new THREE.Vector3(0.8, 0.45, 1).normalize()
    camera.position.copy(center).addScaledVector(direction, distance)
    camera.near = Math.max(distance / 400, 0.001)
    camera.far = distance * 60
    camera.updateProjectionMatrix()

    controls.target.copy(center)
    controls.minDistance = distance * 0.12
    controls.maxDistance = distance * 6
    controls.update()
  }

  return { load, clear }
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh

    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) disposeMaterial(material)
    }
  })
}

function disposeMaterial(material: THREE.Material | undefined): void {
  if (!material) return

  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose()
  }

  material.dispose()
}
