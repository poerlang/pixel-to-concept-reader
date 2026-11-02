/**
 * 3D 分层视图（three.js）。
 *
 * 层按词项的封装深度分：
 *   层 0：黑 / 白 / shiftX / shiftY 等原子词项
 *   层 1：黑白 / 白黑 / 黑黑 / 白白 等顺序对
 *   层 2：{黑白, 白黑} 等集合
 *
 * 每一层是一张画幅四叉树平面：
 * - 概念节点排在该层左侧（场景左边），不跟句子连线；
 * - 句子实例按生成时的落点 (x, y) 放在平面上；
 * - 句子用 InstancedMesh 批量画，避免逐条建 mesh 影响性能。
 *
 * 底层仍保留场景里的像素块与扫描头；交互：拖拽旋转、滚轮缩放、自动旋转。
 */

import * as THREE from 'three'

const DECK_Y = 0
const DECK_RADIUS = 9.4
const LAYER_GAP = 4.4
const PLANE_HALF = 5
const GRID_DEPTH = 4
const GRID_SIDE = 1 << GRID_DEPTH
const CONCEPT_X = 5.9
const SENTENCE_Y_OFFSET = 0.2
const CONCEPT_Y_OFFSET = 0.95

/** 层 0 的一个像素块（场景里被四叉树索引的那张图） */
export type TowerChip = {
  id: string
  label: string
  /** 世界坐标（-5..5） */
  x: number
  z: number
  size: number
  pixels: Uint8Array
  side: number
  selected: boolean
}

/** 某一层左侧的一个概念节点 */
export type TowerConceptNode = {
  key: string
  label: string
  kind: string
  depth: number
  /** 悬停提示里的说明（句数 / 复杂度等） */
  detail: string
}

/** 某一层平面上的一个句子实例 */
export type TowerSentence = {
  key: string
  conceptKey: string
  label: string
  kind: string
  /** 画幅坐标 0..1 */
  x: number
  y: number
  value: number | null
  /** 悬停提示里的说明（来源 / 位置 / 值） */
  detail: string
}

/** 一层：对应一个封装深度 */
export type TowerLayer = {
  depth: number
  label: string
  concepts: TowerConceptNode[]
  sentences: TowerSentence[]
}

export type TowerData = {
  chips: TowerChip[]
  layers: TowerLayer[]
  maxDepth: number
}

/** 扫描头：压在层 0 某个像素块上的位置（世界坐标） */
export type TowerScan = { x: number; z: number; size: number }

/** 最近 shift 落点；给 3D 轨迹粒子/线段用 */
export type TowerTracePoint = {
  x: number
  z: number
  dx: number
  dz: number
}

/** 3D 里可悬停 / 可选中的一个节点 */
export type TowerPickInfo = {
  type: 'concept' | 'sentence'
  key: string
  label: string
  detail: string
  /** 世界坐标：选中后摄像机就绕它转 */
  x: number
  y: number
  z: number
}

export type TowerHandle = {
  setData(data: TowerData): void
  setScan(scan: TowerScan | null): void
  /** 最近 shift 轨迹；传入世界坐标，空数组隐藏 */
  setTrace(points: TowerTracePoint[]): void
  /** 拖拽悬停时，在底板上标出将要落下的位置 */
  setDropPreview(point: { x: number; z: number } | null): void
  /** 把屏幕坐标打到层 0 的底板上，返回世界坐标 x/z */
  pickDeck(clientX: number, clientY: number): { x: number; z: number } | null
  /** 鼠标悬停到概念 / 句子节点上；离开时 info = null，坐标给界面放提示框 */
  setHoverHandler(
    handler: ((info: TowerPickInfo | null, clientX: number, clientY: number) => void) | null,
  ): void
  /** 选中节点；点空白取消选择时 info = null */
  setSelectHandler(handler: ((info: TowerPickInfo | null) => void) | null): void
  resize(): void
  setAutoRotate(value: boolean): void
  dispose(): void
}

const KIND_COLORS: Record<string, number> = {
  atom: 0xe8eef2,
  statement: 0xe8eef2,
  sequence: 0x7fe3d0,
  set: 0x5ef0c8,
  operation: 0xb7a8ff,
  mental: 0xf0b429,
  compound: 0x8ea3b0,
}

function colorOf(kind: string): number {
  return KIND_COLORS[kind] ?? 0xe8eef2
}

function colorHex(kind: string): string {
  return `#${colorOf(kind).toString(16).padStart(6, '0')}`
}

function layerName(depth: number): string {
  if (depth === 0) return '原子'
  if (depth === 1) return '顺序对'
  if (depth === 2) return '集合'
  return `复合 ${depth}`
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

/** 文字牌：画在 canvas 上，做成 Sprite */
function makeLabel(
  text: string,
  options: { color?: string; bg?: string; border?: string; fontSize?: number; bold?: boolean; scale?: number } = {},
): { sprite: THREE.Sprite; texture: THREE.CanvasTexture } {
  const fontSize = options.fontSize ?? 26
  const paddingX = 14
  const paddingY = 10
  const font = `${options.bold ? '600 ' : ''}${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  context.font = font
  const textWidth = Math.ceil(context.measureText(text).width)
  canvas.width = Math.max(24, textWidth + paddingX * 2)
  canvas.height = fontSize + paddingY * 2

  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  roundRect(context, 0.5, 0.5, canvas.width - 1, canvas.height - 1, 9)
  context.fillStyle = options.bg ?? 'rgba(8, 15, 21, 0.86)'
  context.fill()
  context.strokeStyle = options.border ?? 'rgba(255, 255, 255, 0.18)'
  context.lineWidth = 1
  context.stroke()
  context.fillStyle = options.color ?? '#e8eef2'
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  const scale = options.scale ?? 0.009
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1)
  return { sprite, texture }
}

/** 28×28 灰度 → 贴图 */
function makeChipTexture(pixels: Uint8Array, side: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')!
  const image = context.createImageData(side, side)
  for (let index = 0; index < side * side; index++) {
    const value = pixels[index] ?? 0
    const offset = index * 4
    image.data[offset] = value
    image.data[offset + 1] = value
    image.data[offset + 2] = value
    image.data[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  return texture
}

export function createTower(container: HTMLElement): TowerHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false)
  renderer.setClearColor(0x05090d, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const canvas = renderer.domElement
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  canvas.style.touchAction = 'none'
  container.appendChild(canvas)

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x05090d, 0.016)

  const camera = new THREE.PerspectiveCamera(
    50,
    Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
    0.01,
    5000,
  )

  scene.add(new THREE.AmbientLight(0xa9c2d4, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(8, 18, 10)
  scene.add(sun)
  const rim = new THREE.PointLight(0x5ef0c8, 140, 70)
  rim.position.set(-9, 8, -11)
  scene.add(rim)
  const warm = new THREE.PointLight(0xf0b429, 90, 60)
  warm.position.set(10, 7, 9)
  scene.add(warm)

  const root = new THREE.Group()
  scene.add(root)
  const content = new THREE.Group()
  root.add(content)

  /* ---------- 视角 / 节点选择 ---------- */

  let azimuth = -2.05
  let polar = 1.14
  let radius = 19
  let autoRotate = false
  let dragMode: 'none' | 'orbit' | 'panGround' | 'panScreen' = 'none'
  let lastX = 0
  let lastY = 0
  let pressX = 0
  let pressY = 0
  let moved = false
  /** 按下时命中的节点：松开不移动就选中它 */
  let pressedInfo: TowerPickInfo | null = null
  /** 按下的是空白处：松开不移动就取消选择 */
  let pressedEmpty = false
  /** 用户是否已经动过摄像机（数据更新时不再重置视角） */
  let hasUserMoved = false
  let lastHoverAt = 0
  let hoverHandler: ((info: TowerPickInfo | null, clientX: number, clientY: number) => void) | null =
    null
  let selectHandler: ((info: TowerPickInfo | null) => void) | null = null
  let pickables: THREE.Object3D[] = []
  let selectedKey: string | null = null
  let selectedInfo: TowerPickInfo | null = null

  /** 用户选中节点时，摄像机平滑移向的目标点 */
  let focusActive = false
  const focusGoal = new THREE.Vector3()

  /** 没有选中节点时的旋转中心：画布中心 */
  const sceneCenter = new THREE.Vector3(0, 4.6, 0)
  /** 当前旋转 / 聚焦中心；选中节点后就是节点位置 */
  const target = sceneCenter.clone()
  const forward = new THREE.Vector3()
  const right = new THREE.Vector3()
  const upAxis = new THREE.Vector3(0, 1, 0)
  const screenRight = new THREE.Vector3()
  const screenUp = new THREE.Vector3()

  function placeCamera() {
    const sinPolar = Math.sin(polar)
    camera.position.set(
      target.x + radius * sinPolar * Math.cos(azimuth),
      target.y + radius * Math.cos(polar),
      target.z + radius * sinPolar * Math.sin(azimuth),
    )
    camera.lookAt(target)
  }

  /** 平滑地把旋转中心移到某个点 */
  function focusTo(x: number, y: number, z: number) {
    hasUserMoved = true
    focusGoal.set(x, y, z)
    focusActive = true
  }

  function updateClipPlanes() {
    camera.near = Math.max(1e-4, radius * 0.001)
    camera.far = Math.max(2000, radius * 20)
    camera.updateProjectionMatrix()
  }

  updateClipPlanes()

  /** 中键拖拽：让相机在水平面上平移（右向量 + 地面上的前向），不设边界 */
  function panGround(dx: number, dy: number) {
    forward.subVectors(target, camera.position)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
    forward.normalize()
    right.crossVectors(forward, upAxis).normalize()

    const step = radius * 0.0024
    target.addScaledVector(right, -dx * step)
    target.addScaledVector(forward, dy * step)
  }

  /** 右键拖拽：沿屏幕平面平移，位移量和光标 1:1，不设边界 */
  function panScreen(dx: number, dy: number) {
    const height = Math.max(1, container.clientHeight)
    const worldPerPixel = (2 * radius * Math.tan((camera.fov * Math.PI) / 360)) / height
    screenRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
    screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
    target.addScaledVector(screenRight, -dx * worldPerPixel)
    target.addScaledVector(screenUp, dy * worldPerPixel)
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button === 1) {
      dragMode = 'panGround'
      pressedInfo = null
      pressedEmpty = false
    } else if (event.button === 2) {
      dragMode = 'panScreen'
      pressedInfo = null
      pressedEmpty = false
    } else if (event.button === 0) {
      const info = pickAt(event.clientX, event.clientY)
      if (info) {
        // 点在节点上：先不旋转，松开且没移动就选中
        pressedInfo = info
        pressedEmpty = false
        dragMode = 'none'
      } else {
        pressedInfo = null
        pressedEmpty = true
        dragMode = 'orbit'
      }
    } else {
      return
    }
    event.preventDefault()
    hasUserMoved = true
    focusActive = false
    hoverHandler?.(null, 0, 0)
    pressX = lastX = event.clientX
    pressY = lastY = event.clientY
    moved = false
    canvas.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent) {
    if (dragMode === 'none' && pressedInfo) {
      const distance = Math.hypot(event.clientX - pressX, event.clientY - pressY)
      if (distance <= 4) {
        canvas.style.cursor = 'pointer'
        hoverHandler?.(pressedInfo, event.clientX, event.clientY)
        return
      }
      // 从节点上拖走：变成正常旋转，不选中
      pressedInfo = null
      pressedEmpty = false
      dragMode = 'orbit'
      moved = true
      lastX = pressX
      lastY = pressY
    }

    if (dragMode === 'none') {
      updateHover(event)
      return
    }

    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    lastX = event.clientX
    lastY = event.clientY
    if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 4) moved = true

    if (dragMode === 'orbit') {
      azimuth += dx * 0.006
      polar = Math.min(1.45, Math.max(0.22, polar - dy * 0.005))
      canvas.style.cursor = 'grabbing'
    } else if (dragMode === 'panGround') {
      panGround(dx, dy)
      canvas.style.cursor = 'grabbing'
    } else {
      panScreen(dx, dy)
      canvas.style.cursor = 'grabbing'
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (dragMode === 'none' && pressedInfo && !moved) {
      selectNode(pressedInfo)
    } else if (dragMode === 'orbit' && pressedEmpty && !moved) {
      clearSelection(true)
    }
    pressedInfo = null
    pressedEmpty = false
    moved = false
    dragMode = 'none'
    canvas.style.cursor = pickAt(event.clientX, event.clientY) ? 'pointer' : 'grab'
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }

  function onPointerLeave() {
    if (dragMode !== 'none' || pressedInfo) return
    hoverHandler?.(null, 0, 0)
    canvas.style.cursor = 'grab'
  }

  /** 中键别触发浏览器自动滚屏 */
  function onMouseDown(event: MouseEvent) {
    if (event.button === 1) event.preventDefault()
  }

  /** 右键别弹菜单 */
  function onContextMenu(event: MouseEvent) {
    event.preventDefault()
  }

  /** 滚轮缩放：指数变化，不设上下限（半径只防止缩到 0 / 溢出成无穷） */
  function onWheel(event: WheelEvent) {
    event.preventDefault()
    hasUserMoved = true
    focusActive = false
    const next = radius * Math.exp(event.deltaY * 0.001)
    if (Number.isFinite(next)) radius = Math.max(1e-3, next)
    updateClipPlanes()
  }

  function updateHover(event: PointerEvent) {
    const now = performance.now()
    if (now - lastHoverAt < 40) return
    lastHoverAt = now
    const info = pickAt(event.clientX, event.clientY)
    canvas.style.cursor = info ? 'pointer' : 'grab'
    hoverHandler?.(info, event.clientX, event.clientY)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('contextmenu', onContextMenu)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.style.cursor = 'grab'

  /* ---------- 资源回收 ---------- */

  let disposables: Array<{ dispose(): void }> = []

  function track<T extends { dispose(): void }>(item: T): T {
    disposables.push(item)
    return item
  }

  function clearContent() {
    content.clear()
    pickables = []
    for (const item of disposables) item.dispose()
    disposables = []
  }

  const staticDisposables: Array<{ dispose(): void }> = []

  function trackStatic<T extends { dispose(): void }>(item: T): T {
    staticDisposables.push(item)
    return item
  }

  /* ---------- 静态底座 ---------- */

  const floor = new THREE.Mesh(
    trackStatic(new THREE.CircleGeometry(DECK_RADIUS, 72)),
    trackStatic(new THREE.MeshStandardMaterial({ color: 0x0a131a, roughness: 0.92, metalness: 0.18 })),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = DECK_Y - 0.02
  root.add(floor)

  const halo = new THREE.Mesh(
    trackStatic(new THREE.RingGeometry(DECK_RADIUS - 0.12, DECK_RADIUS, 96)),
    trackStatic(new THREE.MeshBasicMaterial({ color: 0x5ef0c8, transparent: true, opacity: 0.45 })),
  )
  halo.rotation.x = -Math.PI / 2
  halo.position.y = DECK_Y
  root.add(halo)

  {
    const points: number[] = []
    for (let step = -9; step <= 9; step++) {
      points.push(step, DECK_Y, -9, step, DECK_Y, 9)
      points.push(-9, DECK_Y, step, 9, DECK_Y, step)
    }
    const geometry = trackStatic(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const grid = new THREE.LineSegments(
      geometry,
      trackStatic(new THREE.LineBasicMaterial({ color: 0x1d3341, transparent: true, opacity: 0.55 })),
    )
    root.add(grid)
  }

  /* ---------- 扫描轨迹：固定池粒子 + 细线 ---------- */

  const MAX_TRACE = 64
  const tracePositions = new Float32Array(MAX_TRACE * 3)
  const traceColors = new Float32Array(MAX_TRACE * 3)
  const traceGeometry = trackStatic(new THREE.BufferGeometry())
  traceGeometry.setAttribute('position', new THREE.BufferAttribute(tracePositions, 3))
  traceGeometry.setAttribute('color', new THREE.BufferAttribute(traceColors, 3))
  traceGeometry.setDrawRange(0, 0)
  const traceMaterial = trackStatic(
    new THREE.PointsMaterial({
      size: 0.23,
      vertexColors: true,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  )
  const traceParticles = new THREE.Points(traceGeometry, traceMaterial)
  traceParticles.frustumCulled = false
  traceParticles.renderOrder = 8

  const traceLinePositions = new Float32Array(MAX_TRACE * 3)
  const traceLineGeometry = trackStatic(new THREE.BufferGeometry())
  traceLineGeometry.setAttribute('position', new THREE.BufferAttribute(traceLinePositions, 3))
  traceLineGeometry.setDrawRange(0, 0)
  const traceLineMaterial = trackStatic(
    new THREE.LineBasicMaterial({
      color: 0x5ef0c8,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const traceLine = new THREE.Line(traceLineGeometry, traceLineMaterial)
  traceLine.frustumCulled = false
  traceLine.renderOrder = 7

  // 每个落点向下投一条极淡的光柱，形成“数据帘”；固定池，不逐帧分配
  const traceStreakPositions = new Float32Array(MAX_TRACE * 6)
  const traceStreakGeometry = trackStatic(new THREE.BufferGeometry())
  traceStreakGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(traceStreakPositions, 3),
  )
  traceStreakGeometry.setDrawRange(0, 0)
  const traceStreakMaterial = trackStatic(
    new THREE.LineBasicMaterial({
      color: 0x5ef0c8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const traceStreaks = new THREE.LineSegments(traceStreakGeometry, traceStreakMaterial)
  traceStreaks.frustumCulled = false
  traceStreaks.renderOrder = 6

  const traceHalo = new THREE.Mesh(
    trackStatic(new THREE.RingGeometry(0.52, 0.66, 48)),
    trackStatic(
      new THREE.MeshBasicMaterial({
        color: 0xf0b429,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    ),
  )
  traceHalo.rotation.x = -Math.PI / 2
  traceHalo.visible = false
  traceHalo.renderOrder = 9

  // 最近落点的一枚低亮光点；用于在远景里给出“当前 shift”位置
  const beaconCanvas = document.createElement('canvas')
  beaconCanvas.width = 64
  beaconCanvas.height = 64
  const beaconContext = beaconCanvas.getContext('2d')!
  const beaconGradient = beaconContext.createRadialGradient(32, 32, 2, 32, 32, 30)
  beaconGradient.addColorStop(0, 'rgba(240, 180, 41, 0.95)')
  beaconGradient.addColorStop(0.25, 'rgba(94, 240, 200, 0.55)')
  beaconGradient.addColorStop(1, 'rgba(94, 240, 200, 0)')
  beaconContext.fillStyle = beaconGradient
  beaconContext.fillRect(0, 0, 64, 64)
  const beaconTexture = trackStatic(new THREE.CanvasTexture(beaconCanvas))
  beaconTexture.colorSpace = THREE.SRGBColorSpace
  const beacon = new THREE.Sprite(
    trackStatic(
      new THREE.SpriteMaterial({
        map: beaconTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  )
  beacon.scale.set(1.15, 1.15, 1)
  beacon.visible = false
  beacon.renderOrder = 9

  const traceGroup = new THREE.Group()
  traceGroup.visible = false
  traceGroup.add(traceLine, traceParticles, traceStreaks, traceHalo, beacon)
  root.add(traceGroup)

  const traceColor = new THREE.Color()
  const traceAmber = new THREE.Color(0xf0b429)
  const traceCyan = new THREE.Color(0x5ef0c8)

  function setTrace(points: TowerTracePoint[]) {
    const recent = points.slice(-MAX_TRACE)
    const count = recent.length
    for (let index = 0; index < count; index++) {
      const point = recent[index]!
      const offset = index * 3
      const age = count <= 1 ? 1 : index / (count - 1)
      const y = 0.3 + (1 - age) * 1.25
      tracePositions[offset] = point.x
      tracePositions[offset + 1] = y
      tracePositions[offset + 2] = point.z
      traceColor.copy(index === count - 1 ? traceAmber : traceCyan)
      traceColor.multiplyScalar(0.18 + age * 0.82)
      traceColors[offset] = traceColor.r
      traceColors[offset + 1] = traceColor.g
      traceColors[offset + 2] = traceColor.b
      traceLinePositions[offset] = point.x
      traceLinePositions[offset + 1] = y
      traceLinePositions[offset + 2] = point.z
      const streakOffset = index * 6
      traceStreakPositions[streakOffset] = point.x
      traceStreakPositions[streakOffset + 1] = y
      traceStreakPositions[streakOffset + 2] = point.z
      traceStreakPositions[streakOffset + 3] = point.x
      traceStreakPositions[streakOffset + 4] = 0.04
      traceStreakPositions[streakOffset + 5] = point.z
    }
    traceGeometry.setDrawRange(0, count)
    traceLineGeometry.setDrawRange(0, count)
    traceStreakGeometry.setDrawRange(0, count * 2)
    traceGeometry.attributes.position!.needsUpdate = true
    traceGeometry.attributes.color!.needsUpdate = true
    traceLineGeometry.attributes.position!.needsUpdate = true
    traceStreakGeometry.attributes.position!.needsUpdate = true
    traceGroup.visible = count > 0
    const last = count ? recent[count - 1]! : null
    beacon.visible = last !== null
    traceHalo.visible = last !== null
    if (last) {
      beacon.position.set(last.x, 2.15, last.z)
      beacon.scale.setScalar(2.2)
      traceHalo.position.set(last.x, 2.15, last.z)
      traceHalo.scale.setScalar(2.1)
    }
  }

  /* ---------- 扫描头 ---------- */

  const scanGroup = new THREE.Group()
  scanGroup.visible = false
  root.add(scanGroup)

  const scanRing = new THREE.Mesh(
    trackStatic(new THREE.RingGeometry(0.8, 1, 48)),
    trackStatic(
      new THREE.MeshBasicMaterial({
        color: 0x5ef0c8,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  )
  scanRing.rotation.x = -Math.PI / 2
  scanRing.renderOrder = 10
  scanGroup.add(scanRing)

  const scanDot = new THREE.Mesh(
    trackStatic(new THREE.CircleGeometry(0.18, 16)),
    trackStatic(
      new THREE.MeshBasicMaterial({
        color: 0x5ef0c8,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    ),
  )
  scanDot.rotation.x = -Math.PI / 2
  scanDot.renderOrder = 11
  scanGroup.add(scanDot)

  let scanScale = 1

  function setScan(scan: TowerScan | null) {
    if (!scan) {
      scanGroup.visible = false
      return
    }
    scanGroup.visible = true
    scanGroup.position.set(scan.x, 0.16, scan.z)
    scanScale = Math.max(0.2, scan.size * 0.1)
    scanGroup.scale.setScalar(scanScale)
  }

  /* ---------- 拖放落点预览 ---------- */

  const dropGroup = new THREE.Group()
  dropGroup.visible = false
  root.add(dropGroup)

  const dropRing = new THREE.Mesh(
    trackStatic(new THREE.RingGeometry(0.78, 1, 48)),
    trackStatic(
      new THREE.MeshBasicMaterial({
        color: 0xf0b429,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  )
  dropRing.rotation.x = -Math.PI / 2
  dropRing.renderOrder = 12
  dropGroup.add(dropRing)

  const dropDot = new THREE.Mesh(
    trackStatic(new THREE.CircleGeometry(0.14, 16)),
    trackStatic(
      new THREE.MeshBasicMaterial({
        color: 0xf0b429,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    ),
  )
  dropDot.rotation.x = -Math.PI / 2
  dropDot.renderOrder = 13
  dropGroup.add(dropDot)

  dropGroup.scale.setScalar(0.42)

  function setDropPreview(point: { x: number; z: number } | null) {
    if (!point) {
      dropGroup.visible = false
      return
    }
    dropGroup.visible = true
    dropGroup.position.set(point.x, 0.14, point.z)
  }

  /* ---------- 选中标记 ---------- */

  const selectionCanvas = document.createElement('canvas')
  selectionCanvas.width = 128
  selectionCanvas.height = 128
  {
    const context = selectionCanvas.getContext('2d')!
    context.clearRect(0, 0, 128, 128)
    context.beginPath()
    context.arc(64, 64, 50, 0, Math.PI * 2)
    context.lineWidth = 10
    context.strokeStyle = 'rgba(240, 180, 41, 0.25)'
    context.stroke()
    context.beginPath()
    context.arc(64, 64, 48, 0, Math.PI * 2)
    context.lineWidth = 5
    context.strokeStyle = '#f0b429'
    context.stroke()
    context.beginPath()
    context.arc(64, 64, 4, 0, Math.PI * 2)
    context.fillStyle = '#f0b429'
    context.fill()
  }
  const selectionTexture = trackStatic(new THREE.CanvasTexture(selectionCanvas))
  selectionTexture.colorSpace = THREE.SRGBColorSpace
  const selectionMaterial = trackStatic(
    new THREE.SpriteMaterial({
      map: selectionTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  )
  const selectionSprite = new THREE.Sprite(selectionMaterial)
  selectionSprite.visible = false
  selectionSprite.renderOrder = 30
  selectionSprite.scale.set(1.6, 1.6, 1)
  root.add(selectionSprite)

  /* ---------- 屏幕坐标 → 底板 / 节点 ---------- */

  const raycaster = new THREE.Raycaster()
  const deckPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08)
  const pointerNdc = new THREE.Vector2()
  const deckHit = new THREE.Vector3()

  function pickDeck(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointerNdc, camera)
    if (!raycaster.ray.intersectPlane(deckPlane, deckHit)) return null
    return { x: deckHit.x, z: deckHit.z }
  }

  function pickAt(clientX: number, clientY: number): TowerPickInfo | null {
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointerNdc, camera)
    const hits = raycaster.intersectObjects(pickables, false)
    for (const hit of hits) {
      const data = hit.object.userData as
        | { pickType?: string; info?: TowerPickInfo; sentences?: TowerSentence[]; layerY?: number }
        | undefined
      if (!data) continue
      if (data.pickType === 'concept' && data.info) return data.info
      if (data.pickType === 'sentences' && data.sentences && hit.instanceId !== undefined) {
        const sentence = data.sentences[hit.instanceId]
        if (!sentence) continue
        const y = (data.layerY ?? 0) + SENTENCE_Y_OFFSET
        return {
          type: 'sentence',
          key: `s:${sentence.key}`,
          label: sentence.label,
          detail: sentence.detail,
          x: (sentence.x - 0.5) * PLANE_HALF * 2,
          y,
          z: (sentence.y - 0.5) * PLANE_HALF * 2,
        }
      }
    }
    return null
  }

  function selectNode(info: TowerPickInfo) {
    selectedKey = info.key
    selectedInfo = info
    selectionSprite.visible = true
    selectionSprite.position.set(info.x, info.y, info.z)
    selectionSprite.scale.setScalar(info.type === 'concept' ? 1.8 : 0.85)
    hasUserMoved = true
    focusTo(info.x, info.y, info.z)
    selectHandler?.(info)
  }

  function clearSelection(notify: boolean, recenter = true) {
    selectedKey = null
    selectedInfo = null
    selectionSprite.visible = false
    if (recenter) focusTo(sceneCenter.x, sceneCenter.y, sceneCenter.z)
    if (notify) selectHandler?.(null)
  }

  /* ---------- 数据：像素块 ---------- */

  function buildChips(chips: TowerChip[]) {
    for (const chip of chips) {
      const texture = track(makeChipTexture(chip.pixels, chip.side))
      const geometry = track(new THREE.PlaneGeometry(chip.size, chip.size))
      const material = track(
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: chip.selected ? 1 : 0.82 }),
      )
      const mesh = new THREE.Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(chip.x, 0.08, chip.z)
      content.add(mesh)

      const borderGeometry = track(new THREE.BufferGeometry())
      borderGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            -chip.size / 2, 0.1, -chip.size / 2, chip.size / 2, 0.1, -chip.size / 2,
            chip.size / 2, 0.1, -chip.size / 2, chip.size / 2, 0.1, chip.size / 2,
            chip.size / 2, 0.1, chip.size / 2, -chip.size / 2, 0.1, chip.size / 2,
            -chip.size / 2, 0.1, chip.size / 2, -chip.size / 2, 0.1, -chip.size / 2,
          ],
          3,
        ),
      )
      const border = new THREE.LineSegments(
        borderGeometry,
        track(
          new THREE.LineBasicMaterial({
            color: chip.selected ? 0x5ef0c8 : 0x38505e,
            transparent: true,
            opacity: chip.selected ? 0.95 : 0.7,
          }),
        ),
      )
      border.position.set(chip.x, 0, chip.z)
      content.add(border)

      const { sprite, texture: labelTexture } = makeLabel(chip.label, {
        fontSize: 20,
        color: chip.selected ? '#5ef0c8' : '#8ea3b0',
        border: chip.selected ? 'rgba(94,240,200,0.6)' : 'rgba(255,255,255,0.12)',
      })
      track(labelTexture)
      track(sprite.material as THREE.SpriteMaterial)
      sprite.position.set(chip.x, 0.42, chip.z + chip.size / 2 + 0.2)
      content.add(sprite)
    }
  }

  /* ---------- 数据：分层四叉树 / 概念 / 句子 ---------- */

  function layerY(depth: number): number {
    return depth * LAYER_GAP
  }

  /** 每层一张四叉树平面：16×16 叶子，带半透明底板 */
  function buildLayerPlane(depth: number) {
    const y = layerY(depth)
    const plane = new THREE.Mesh(
      track(new THREE.PlaneGeometry(PLANE_HALF * 2, PLANE_HALF * 2)),
      track(
        new THREE.MeshBasicMaterial({
          color: 0x071019,
          transparent: true,
          opacity: depth === 0 ? 0.12 : 0.22,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ),
    )
    plane.rotation.x = -Math.PI / 2
    plane.position.y = depth === 0 ? 0.01 : y - 0.02
    content.add(plane)

    const points: number[] = []
    for (let step = 0; step <= GRID_SIDE; step++) {
      const offset = -PLANE_HALF + (step / GRID_SIDE) * PLANE_HALF * 2
      points.push(offset, y, -PLANE_HALF, offset, y, PLANE_HALF)
      points.push(-PLANE_HALF, y, offset, PLANE_HALF, y, offset)
    }
    points.push(
      -PLANE_HALF, y, -PLANE_HALF, PLANE_HALF, y, -PLANE_HALF,
      PLANE_HALF, y, -PLANE_HALF, PLANE_HALF, y, PLANE_HALF,
      PLANE_HALF, y, PLANE_HALF, -PLANE_HALF, y, PLANE_HALF,
      -PLANE_HALF, y, PLANE_HALF, -PLANE_HALF, y, -PLANE_HALF,
    )
    const geometry = track(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const grid = new THREE.LineSegments(
      geometry,
      track(
        new THREE.LineBasicMaterial({
          color: 0x2d4a5a,
          transparent: true,
          opacity: 0.42 + depth * 0.05,
        }),
      ),
    )
    content.add(grid)
  }

  function buildLayerLabel(layer: TowerLayer) {
    const y = layerY(layer.depth)
    const { sprite, texture } = makeLabel(`层 ${layer.depth} · ${layerName(layer.depth)}`, {
      fontSize: 18,
      color: '#8ea3b0',
      border: 'rgba(94, 240, 200, 0.22)',
      scale: 0.008,
    })
    track(texture)
    track(sprite.material as THREE.SpriteMaterial)
    sprite.position.set(CONCEPT_X, y + 0.28, -5.6)
    content.add(sprite)
  }

  function buildConceptNodes(layer: TowerLayer) {
    const count = layer.concepts.length
    if (!count) return
    const y = layerY(layer.depth) + CONCEPT_Y_OFFSET
    const compact = count > 8
    const spacing = count > 1 ? Math.max(1.05, Math.min(2, 10 / (count - 1))) : 0
    layer.concepts.forEach((concept, index) => {
      const z = (index - (count - 1) / 2) * spacing
      const color = colorHex(concept.kind)
      const rgb = colorOf(concept.kind)
      const { sprite, texture } = makeLabel(concept.label, {
        fontSize: compact ? 16 : 21,
        color,
        border: `rgba(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255}, 0.45)`,
        bold: true,
        scale: compact ? 0.0075 : 0.0105,
      })
      track(texture)
      track(sprite.material as THREE.SpriteMaterial)
      sprite.position.set(CONCEPT_X, y, z)
      sprite.userData = {
        pickType: 'concept',
        info: {
          type: 'concept',
          key: `c:${concept.key}`,
          label: concept.label,
          detail: concept.detail,
          x: CONCEPT_X,
          y,
          z,
        } satisfies TowerPickInfo,
      }
      pickables.push(sprite)
      content.add(sprite)
    })
  }

  function buildSentenceInstances(layer: TowerLayer) {
    if (!layer.sentences.length) return
    const y = layerY(layer.depth) + SENTENCE_Y_OFFSET
    const geometry = track(new THREE.OctahedronGeometry(0.11, 0))
    const material = track(new THREE.MeshBasicMaterial({ color: 0xffffff }))
    const mesh = new THREE.InstancedMesh(geometry, material, layer.sentences.length)
    mesh.frustumCulled = false
    mesh.userData = {
      pickType: 'sentences',
      sentences: layer.sentences,
      layerY: layerY(layer.depth),
    }
    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()
    layer.sentences.forEach((sentence, index) => {
      matrix.makeTranslation(
        (sentence.x - 0.5) * PLANE_HALF * 2,
        y,
        (sentence.y - 0.5) * PLANE_HALF * 2,
      )
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, color.set(colorOf(sentence.kind)))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    pickables.push(mesh)
    content.add(mesh)
  }

  function buildLayers(layers: TowerLayer[]) {
    for (const layer of layers) {
      buildLayerPlane(layer.depth)
      buildLayerLabel(layer)
      buildConceptNodes(layer)
      buildSentenceInstances(layer)
    }
  }

  function setData(data: TowerData) {
    clearContent()
    buildLayers(data.layers)
    buildChips(data.chips)

    // 选中的节点如果还在新数据里就保留，否则取消选择
    const keys = new Set<string>()
    for (const layer of data.layers) {
      for (const concept of layer.concepts) keys.add(`c:${concept.key}`)
      for (const sentence of layer.sentences) keys.add(`s:${sentence.key}`)
    }
    if (selectedKey && !keys.has(selectedKey)) clearSelection(true, false)

    // 数据更新不重置用户已经动过的摄像机
    if (!hasUserMoved && !selectedKey) target.copy(sceneCenter)
  }

  function resize() {
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const observer = new ResizeObserver(() => resize())
  observer.observe(container)

  renderer.setAnimationLoop(() => {
    if (autoRotate && dragMode === 'none') azimuth += 0.0013
    if (focusActive) {
      target.lerp(focusGoal, 0.16)
      if (target.distanceToSquared(focusGoal) < 1e-4) {
        target.copy(focusGoal)
        focusActive = false
      }
    }
    if (scanGroup.visible) {
      const pulse = 1 + 0.07 * Math.sin(performance.now() * 0.0042)
      scanGroup.scale.setScalar(scanScale * pulse)
    }
    if (traceGroup.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.0036)
      traceMaterial.size = 0.21 + pulse * 0.08
      traceLineMaterial.opacity = 0.4 + pulse * 0.2
      traceStreakMaterial.opacity = 0.1 + pulse * 0.1
      if (beacon.visible) {
        beacon.scale.setScalar(2 + pulse * 0.45)
        ;(beacon.material as THREE.SpriteMaterial).opacity = 0.55 + pulse * 0.35
      }
      if (traceHalo.visible) {
        traceHalo.scale.setScalar(1.9 + pulse * 0.4)
        ;(traceHalo.material as THREE.MeshBasicMaterial).opacity = 0.24 + pulse * 0.28
      }
    }
    placeCamera()
    renderer.render(scene, camera)
  })

  return {
    setData,
    setScan,
    setTrace,
    setDropPreview,
    pickDeck,
    setHoverHandler(handler) {
      hoverHandler = handler
    },
    setSelectHandler(handler) {
      selectHandler = handler
      handler?.(selectedInfo)
    },
    resize,
    setAutoRotate(value: boolean) {
      autoRotate = value
    },
    dispose() {
      observer.disconnect()
      renderer.setAnimationLoop(null)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('wheel', onWheel)
      hoverHandler = null
      selectHandler = null
      clearContent()
      for (const item of staticDisposables) item.dispose()
      root.clear()
      renderer.dispose()
      canvas.remove()
    },
  }
}
