// BABY // COGNITIVE FIELD
// Real-time projection of Engine trace events. Presentation only.
//
// A figure starts with empty graph. Instance steps add L4 instance nodes at object anchors;
// fact steps add L0 property nodes and edges instance -> fact; derivation steps add conclusions
// near their premises, an edge from each premise, and a particle that travels the actual path.
// The playback rate is adjustable.

import * as THREE from "./vendor/three.module.min.js";
import { BRAIN_DATA } from "./data.js";

const LAYER_COLORS = [0x4b7f88, 0x57e0d0, 0xffb454, 0xff7a6b, 0xe8f6ff];
const LAYER_CSS = ["#4b7f88", "#57e0d0", "#ffb454", "#ff7a6b", "#e8f6ff"];
const LAYER_CAPS = [96, 64, 96, 64, 24];
const LAYER_RADII = [4.45, 3.75, 3.05, 2.35, 1.68];
const LAYER_HEIGHTS = [2.30, 3.25, 4.20, 5.15, 6.10];
const INSTANCE_HEIGHT = 1.35;
const STEP_INSTANCE = 0.32;
const STEP_OBSERVE = 0.26;
const STEP_DERIVE = 0.62;
const BASE_HOLD = 1.8;
const LABEL_HOLD = 600;
const LABEL_FADE = 450;
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const NODE_GEOMETRY = new THREE.OctahedronGeometry(0.085, 0);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pad = (n) => String(n).padStart(2, "0");
const $ = (id) => document.getElementById(id);

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.28, "rgba(255,255,255,.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const GLOW = glowTexture();

/* ------------------------------------------------------------------ */
/* camera rig                                                          */
/* ------------------------------------------------------------------ */

class CameraRig {
  constructor(camera, canvas, onPick, onInteract, onHover) {
    this.camera = camera;
    this.canvas = canvas;
    this.onPick = onPick;
    this.onInteract = onInteract;
    this.onHover = onHover;
    this.theta = 0.62;
    this.phi = 1.12;
    this.radius = 15.8;
    this.target = new THREE.Vector3(0, 3.15, 0);
    this.dragging = false;
    this.moved = 0;
    this.mode = "orbit";
    this.button = 0;
    this.last = { x: 0, y: 0 };
    this.pointers = new Map();
    this.auto = false;

    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", (event) => this.down(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", (event) => this.up(event));
    canvas.addEventListener("pointercancel", (event) => this.up(event));
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) this.onHover?.(event.clientX, event.clientY);
    });
    canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("auxclick", (event) => event.preventDefault());
    this.resize();
    this.update(0);
  }

  down(event) {
    this.onInteract?.();
    if (event.button === 1 || event.button === 2) event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.dragging = true;
    this.moved = 0;
    this.button = event.button;
    this.mode = event.button === 1 ? "pan" : event.button === 2 ? "ground" : "orbit";
    this.canvas.style.cursor = "grabbing";
    this.last = { x: event.clientX, y: event.clientY };
  }

  move(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch) this.radius = clamp(this.radius - (distance - this.pinch) * 0.035, 8.5, 27);
      this.pinch = distance;
      return;
    }
    const dx = event.clientX - this.last.x;
    const dy = event.clientY - this.last.y;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.mode === "pan" || this.mode === "ground") {
      const scale = (2 * this.radius * Math.tan((this.camera.fov * Math.PI) / 360)) / window.innerHeight;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      if (this.mode === "pan") {
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
        this.target.addScaledVector(right, -dx * scale);
        this.target.addScaledVector(up, dy * scale);
      } else {
        // 右键：贴着地面（世界 XZ 平面）平移；相机前向压平到地面。
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        const flatRight = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        this.target.addScaledVector(flatRight, -dx * scale);
        this.target.addScaledVector(forward, dy * scale);
      }
      this.last = { x: event.clientX, y: event.clientY };
      return;
    }
    this.theta -= dx * 0.005;
    this.phi = clamp(this.phi - dy * 0.004, 0.55, 1.52);
    this.last = { x: event.clientX, y: event.clientY };
  }

  up(event) {
    if (this.mode === "orbit" && this.button === 0 && this.pointers.has(event.pointerId) && this.moved < 6 && this.pointers.size === 1) {
      this.onPick?.(event.clientX, event.clientY);
    }
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.mode = "orbit";
      this.button = 0;
      this.pinch = 0;
      this.canvas.style.cursor = "grab";
    }
  }

  wheel(event) {
    event.preventDefault();
    this.onInteract?.();
    this.radius = clamp(this.radius * (1 + event.deltaY * 0.0012), 8.5, 27);
  }

  resize() {
    const narrow = window.innerWidth < 760;
    this.radius = narrow ? 20.0 : 15.8;
    this.target.y = narrow ? 3.35 : 3.15;
  }

  update(dt) {
    if (!this.dragging && this.auto) this.theta += dt * 0.045;
    const sin = Math.sin(this.phi);    this.camera.position.set(
      this.target.x + this.radius * sin * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sin * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
  }
}

/* ------------------------------------------------------------------ */
/* figure relief                                                       */
/* ------------------------------------------------------------------ */

class FigureView {
  constructor(parent, figure) {
    this.figure = figure;
    this.group = new THREE.Group();
    this.group.position.y = 0.18;
    this.born = performance.now() / 1000;
    this.flash = 0;
    parent.add(this.group);

    const accent = new THREE.Color(figure.accent);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(3.65, 3.85, 0.16, 72),
      new THREE.MeshStandardMaterial({ color: 0x050708, metalness: 0.35, roughness: 0.72 }),
    );
    base.position.y = -0.04;
    this.group.add(base);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(3.56, 0.012, 6, 96),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.055;
    this.group.add(rim);
    this.rim = rim;

    const shape = figure.shape;
    const y = 0.96;
    const world = (gx, gy) => new THREE.Vector3((gx - 7.5) * 0.365, y, (gy - 7.5) * 0.365);
    this.shapeMaterial = new THREE.MeshStandardMaterial({
      color: accent.clone().multiplyScalar(0.34),
      metalness: 0.74,
      roughness: 0.22,
      emissive: accent,
      emissiveIntensity: 0.58,
    });
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.13,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const samples = [];
    const addTube = (a, b, radius = 0.058) => {
      const direction = new THREE.Vector3().subVectors(b, a);
      const length = direction.length();
      if (length < 1e-5) return;
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10, 1), this.shapeMaterial);
      tube.position.copy(a).add(b).multiplyScalar(0.5);
      tube.quaternion.copy(quaternion);
      this.group.add(tube);
      const glowTube = new THREE.Mesh(new THREE.CylinderGeometry(radius * 2.8, radius * 2.8, length, 8, 1), this.glowMaterial);
      glowTube.position.copy(tube.position);
      glowTube.quaternion.copy(quaternion);
      this.group.add(glowTube);
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        samples.push(lerp(a.x, b.x, u), y + 0.01, lerp(a.z, b.z, u));
      }
    };
    if (shape.kind === "ring") {
      const radius = shape.r * 0.365;
      const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.058, 8, 160), this.shapeMaterial);
      torus.rotation.x = Math.PI / 2;
      torus.position.y = y;
      this.group.add(torus);
      const glowTorus = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.14, 6, 160), this.glowMaterial);
      glowTorus.rotation.x = Math.PI / 2;
      glowTorus.position.y = y;
      this.group.add(glowTorus);
      for (let i = 0; i < 64; i++) {
        const angle = (i / 64) * Math.PI * 2;
        samples.push(Math.cos(angle) * radius, y + 0.01, Math.sin(angle) * radius);
      }
    } else if (shape.kind === "line") {
      addTube(world(shape.x0, shape.y0), world(shape.x1, shape.y1));
    } else {
      const vertex = world(shape.x, shape.y);
      addTube(vertex, world(shape.ax, shape.ay));
      addTube(vertex, world(shape.bx, shape.by));
      const joint = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), this.shapeMaterial);
      joint.position.copy(vertex);
      this.group.add(joint);
    }

    const topGeometry = new THREE.BufferGeometry();
    topGeometry.setAttribute("position", new THREE.Float32BufferAttribute(samples, 3));
    this.topMaterial = new THREE.PointsMaterial({
      color: accent, size: 0.038, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.tops = new THREE.Points(topGeometry, this.topMaterial);
    this.group.add(this.tops);

    // 对象实例锚点：实体在画面上的实际位置，节点从这些位置长出来。
    this.anchors = new Map();
    for (const instance of figure.instances ?? []) {
      const color = 0x57e0d0;
      const material = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const radius = Math.max(0.09, (instance.r ?? 0.1) * 0.28);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.008, 4, 32), material);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(instance.x, y + 0.05, instance.z);
      this.group.add(ring);
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.026, 12), material);
      core.rotation.x = -Math.PI / 2;
      core.position.set(instance.x, y + 0.06, instance.z);
      this.group.add(core);
      this.anchors.set(instance.id, { ring, core, material, flash: 0 });
    }
  }

  flashInstance(id) {
    const anchor = this.anchors?.get(id);
    if (anchor) anchor.flash = 1;
  }

  update(t, dt, activation) {
    const age = t - this.born;
    const intro = clamp(age / 0.55, 0, 1);
    const ease = 1 - Math.pow(1 - intro, 3);
    this.group.scale.setScalar(0.82 + ease * 0.18);
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.shapeMaterial.emissiveIntensity = 0.42 + 0.22 * activation + 0.35 * this.flash + 0.05 * Math.sin(t * 2.1);
    this.glowMaterial.opacity = 0.09 + 0.06 * activation + 0.14 * this.flash + 0.02 * Math.sin(t * 2.4);
    this.topMaterial.opacity = 0.38 + 0.22 * activation + 0.3 * this.flash + 0.08 * Math.sin(t * 3.2);
    this.rim.material.opacity = 0.24 + 0.16 * activation + 0.3 * this.flash;
    for (const anchor of this.anchors?.values() ?? []) {
      anchor.flash = Math.max(0, anchor.flash - dt * 1.7);
      anchor.material.opacity = 0.16 + 0.28 * anchor.flash + 0.08 * anchor.flash * Math.sin(t * 5);
      const scale = 1 + anchor.flash * 0.45;
      anchor.ring.scale.setScalar(scale);
      anchor.core.scale.setScalar(scale);
    }
  }

  flashOnce() {
    this.flash = 1;
  }

  dispose() {
    this.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.group.removeFromParent();
  }
}

/* ------------------------------------------------------------------ */
/* reasoning graph                                                     */
/* ------------------------------------------------------------------ */

class ReasoningGraph {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.labels = {};
    this.layerNodes = [[], [], [], [], []];
    this.nodeMap = new Map();
    this.edges = [];
    this.edgeCount = 0;
    this.edgeCapacity = 640;
    this.particles = [];
    this.particleCapacity = 160;
    this.resetAt = performance.now() / 1000;
    this.epoch = 1;
    this.stacks = new Map();
    this.factCounts = new Map();
    this.hovered = null;

    this.rings = [];
    for (let index = 0; index < 4; index++) {
      const color = new THREE.Color(LAYER_COLORS[index]);
      const material = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(LAYER_RADII[index], 0.012 + index * 0.003, 6, 112),
        material,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = LAYER_HEIGHTS[index];
      this.group.add(ring);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: GLOW, color, transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.position.y = LAYER_HEIGHTS[index];
      halo.scale.setScalar(LAYER_RADII[index] * 2.0);
      this.group.add(halo);
      this.rings.push({ ring, material, halo, flash: 0 });
    }

    this.nodeMeshes = [];
    for (let layer = 0; layer < 5; layer++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.InstancedMesh(NODE_GEOMETRY, material, LAYER_CAPS[layer]);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.userData.layer = layer;
      // 先建 instanceColor 缓冲：否则材质第一次渲染按“无实例色”编译，后来新增节点会全是白色。
      mesh.setColorAt(0, new THREE.Color(LAYER_COLORS[layer]));
      mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.nodeMeshes.push(mesh);
    }

    this.edgeGeometry = new THREE.BufferGeometry();
    this.edgePositions = new Float32Array(this.edgeCapacity * 6);
    this.edgeColors = new Float32Array(this.edgeCapacity * 6);
    this.edgeGeometry.setAttribute("position", new THREE.BufferAttribute(this.edgePositions, 3));
    this.edgeGeometry.setAttribute("color", new THREE.BufferAttribute(this.edgeColors, 3));
    this.edgeGeometry.setDrawRange(0, 0);
    this.edgeLines = new THREE.LineSegments(this.edgeGeometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.72,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.edgeLines.frustumCulled = false;
    this.group.add(this.edgeLines);

    this.particleGeometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(this.particleCapacity * 3);
    this.particleColors = new Float32Array(this.particleCapacity * 3);
    this.particleGeometry.setAttribute("position", new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute("color", new THREE.BufferAttribute(this.particleColors, 3));
    this.particleGeometry.setDrawRange(0, 0);
    this.particlePoints = new THREE.Points(this.particleGeometry, new THREE.PointsMaterial({
      size: 0.095, vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.particlePoints.frustumCulled = false;
    this.group.add(this.particlePoints);
  }

  setLabels(labels) {
    this.labels = labels;
  }

  beginFigure(labels, now = performance.now() / 1000) {
    this.archive();
    this.epoch++;
    this.nodeMap.clear();
    this.labels = labels;
    this.stacks.clear();
    this.factCounts.clear();
    this.resetAt = now;
    for (const ring of this.rings) ring.flash = 1;
  }

  /** 旧经验不清空：把上一张图的节点移到外圈并变暗，当前图从内圈重新长。 */
  archive() {
    if (this.nodeMap.size === 0) return;
    const old = this.epoch;
    for (const nodes of this.layerNodes) {
      for (const node of nodes) {
        if (node.epoch !== old) continue;
        node.memory = true;
        node.flash = 0;
        node.x *= 1.16;
        node.z *= 1.16;
      }
    }
    for (const edge of this.edges) {
      if (edge.epoch !== old) continue;
      edge.memory = true;
      edge.flash = 0;
    }
    this.rebuildEdges();
  }

  rebuildEdges() {
    for (let i = 0; i < this.edgeCount; i++) {
      const edge = this.edges[i];
      const offset = i * 6;
      this.edgePositions.set([edge.a.x, edge.a.y, edge.a.z, edge.b.x, edge.b.y, edge.b.z], offset);
    }
    this.edgeGeometry.attributes.position.needsUpdate = true;
  }

  reset(now = performance.now() / 1000) {
    this.layerNodes = [[], [], [], [], []];
    this.nodeMap.clear();
    for (const mesh of this.nodeMeshes) mesh.count = 0;
    this.edges = [];
    this.edgeCount = 0;
    this.edgeGeometry.setDrawRange(0, 0);
    this.particles = [];
    this.particleGeometry.setDrawRange(0, 0);
    this.resetAt = now;
    for (const ring of this.rings) ring.flash = 1;
  }

  counts() {
    return this.layerNodes.map((nodes) => nodes.filter((node) => node.epoch === this.epoch).length);
  }

  total() {
    return this.layerNodes.reduce((sum, nodes) => sum + nodes.length, 0);
  }

  ringPosition(layer, ordinal, key) {
    const angle = ordinal * 2.399963 + layer * 0.7 + hash(key) * 0.22;
    const radius = LAYER_RADII[layer] * (0.85 + hash(`${key}:r`) * 0.28);
    return {
      x: Math.cos(angle) * radius,
      y: LAYER_HEIGHTS[layer] + (hash(`${key}:y`) - 0.5) * 0.18,
      z: Math.sin(angle) * radius,
    };
  }

  nearPosition(near, layer, key) {
    return {
      x: near.x + (hash(`${key}:x`) - 0.5) * 0.9,
      y: LAYER_HEIGHTS[layer] + (hash(`${key}:y`) - 0.5) * 0.18,
      z: near.z + (hash(`${key}:z`) - 0.5) * 0.9,
    };
  }

  derivedPosition(focus, layer, key) {
    if (!focus) return this.ringPosition(layer, this.layerNodes[layer].length, key);
    const stackKey = `${focus.key}:${layer}`;
    const stack = this.stacks.get(stackKey) ?? 0;
    this.stacks.set(stackKey, stack + 1);
    const angle = stack * 2.399963 + hash(`${key}:a`) * 0.8;
    const spread = stack === 0 ? 0 : 0.28;
    return {
      x: focus.x + Math.cos(angle) * spread,
      y: Math.max(LAYER_HEIGHTS[layer], focus.y + 0.9) + stack * 0.16,
      z: focus.z + Math.sin(angle) * spread,
    };
  }

  addNode(key, label, layer, position, now) {
    if (this.nodeMap.has(key)) return this.nodeMap.get(key);
    const nodes = this.layerNodes[layer];
    if (nodes.length >= LAYER_CAPS[layer]) return null;
    const mesh = this.nodeMeshes[layer];
    const node = {
      key, label, layer,
      x: position.x, y: position.y, z: position.z,
      born: now, flash: 1, epoch: this.epoch, memory: false, hover: 0,
    };
    nodes.push(node);
    this.nodeMap.set(key, node);
    mesh.count = nodes.length;
    mesh.setColorAt(nodes.length - 1, new THREE.Color(LAYER_COLORS[layer]));
    mesh.instanceColor.needsUpdate = true;
    return node;
  }

  ensureNode(key, near, now) {
    if (!key) return null;
    const known = this.nodeMap.get(key);
    if (known) return known;
    const meta = this.labels[key] ?? { label: key, layer: 2 };
    const layer = clamp(meta.layer, 0, 4);
    const position = near ? this.nearPosition(near, layer, key) : this.ringPosition(layer, this.layerNodes[layer].length, key);
    return this.addNode(key, meta.label, layer, position, now);
  }

  addEdge(a, b, now) {
    if (!a || !b || a === b || this.edgeCount >= this.edgeCapacity) return;
    if (this.edges.some((edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a))) return;
    this.edges.push({ a, b, flash: 1, born: now, epoch: this.epoch, memory: false });
    const offset = this.edgeCount * 6;
    this.edgePositions.set([a.x, a.y, a.z, b.x, b.y, b.z], offset);
    this.edgeGeometry.attributes.position.needsUpdate = true;
    this.edgeCount++;
    this.edgeGeometry.setDrawRange(0, this.edgeCount * 2);
  }

  spawnParticle(a, b, now, duration) {
    if (this.particles.length >= this.particleCapacity) this.particles.shift();
    this.particles.push({ a, b, born: now, duration: Math.max(0.25, duration), u: 0 });
  }

  observe(step, now) {
    const node = this.addNode(
      step.conclusion, step.label, step.layer,
      { x: step.focus.x, y: LAYER_HEIGHTS[step.layer], z: step.focus.z },
      now,
    );
    if (node) this.flashNode(node, 1);
    return node;
  }

  addInstance(step, now) {
    const node = this.addNode(
      step.conclusion, step.label, 4,
      { x: step.focus.x, y: INSTANCE_HEIGHT, z: step.focus.z },
      now,
    );
    if (node) this.flashNode(node, 1);
    return node;
  }

  observeFact(step, now) {
    const instance = this.ensureInstance(step, now);
    const index = this.factCounts.get(step.instance) ?? 0;
    this.factCounts.set(step.instance, index + 1);
    const angle = index * Math.PI + 0.35;
    const node = this.addNode(
      step.conclusion, step.label, step.layer,
      {
        x: step.focus.x + Math.cos(angle) * 0.2,
        y: LAYER_HEIGHTS[0],
        z: step.focus.z + Math.sin(angle) * 0.2,
      },
      now,
    );
    if (instance && node) {
      this.addEdge(instance, node, now);
      this.spawnParticle(instance, node, now, 0.5);
      this.flashNode(instance, 0.7);
    }
    if (node) this.flashNode(node, 1);
    return node;
  }

  ensureInstance(step, now) {
    if (!step.instance) return null;
    const known = this.nodeMap.get(step.instance);
    if (known) return known;
    return this.addNode(
      step.instance, step.instance, 4,
      { x: step.focus.x, y: INSTANCE_HEIGHT, z: step.focus.z },
      now,
    );
  }

  derive(step, now, speed) {
    const task = this.ensureNode(step.task, null, now);
    const belief = this.ensureNode(step.belief, task, now);
    const parents = [task, belief].filter((node) => node !== null);
    const focus = parents.length
      ? {
          key: parents.map((node) => node.key).join("|"),
          x: parents.reduce((sum, node) => sum + node.x, 0) / parents.length,
          y: Math.max(...parents.map((node) => node.y)),
          z: parents.reduce((sum, node) => sum + node.z, 0) / parents.length,
        }
      : null;
    const node = this.addNode(step.conclusion, step.label, step.layer, this.derivedPosition(focus, step.layer, step.conclusion), now);
    if (!node) return { node: null, focus };
    for (const parent of parents) {
      this.addEdge(parent, node, now);
      this.spawnParticle(parent, node, now, 0.55 / Math.max(0.5, speed));
      this.flashNode(parent, 0.55);
    }
    this.flashNode(node, 1);
    return { node, focus };
  }

  setHover(node) {
    this.hovered = node;
  }

  flashNode(node, strength) {
    node.flash = Math.max(node.flash, strength);
  }

  update(t, dt) {
    const reset = clamp((t - this.resetAt) / 0.7, 0, 1);
    for (let index = 0; index < this.rings.length; index++) {
      const ring = this.rings[index];
      ring.flash = Math.max(0, ring.flash - dt * 1.1);
      ring.material.opacity = 0.13 + 0.08 * Math.sin(t * 1.4 + index) + 0.26 * ring.flash * (1 - reset * 0.4);
      ring.halo.material.opacity = 0.05 + 0.12 * ring.flash;
      ring.ring.scale.setScalar(1 + 0.018 * ring.flash);
    }

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    for (let layer = 0; layer < 5; layer++) {
      const nodes = this.layerNodes[layer];
      const mesh = this.nodeMeshes[layer];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const hovered = node === this.hovered;
        const age = t - node.born;
        const grow = clamp(age / 0.28, 0, 1);
        const pop = 1 - Math.pow(1 - grow, 3);
        const overshoot = 1 + 0.3 * Math.sin(Math.PI * clamp(age / 0.5, 0, 1)) * clamp(1 - age / 0.5, 0, 1);
        const baseScale = node.memory ? 0.55 : pop * overshoot;
        const nodeScale = Math.max(0.001, baseScale * (1 + 0.14 * node.flash) * (hovered ? 1.45 : 1));
        matrix.compose(new THREE.Vector3(node.x, node.y, node.z), quaternion, scale.setScalar(nodeScale));
        mesh.setMatrixAt(i, matrix);
        color.set(LAYER_COLORS[layer]);
        if (node.memory) {
          color.multiplyScalar(0.32);
        } else {
          color.lerp(new THREE.Color(0xffffff), 0.02 + node.flash * 0.22);
          color.multiplyScalar(0.78 + node.flash * 0.42);
        }
        if (hovered) color.lerp(new THREE.Color(0xffffff), 0.65);
        mesh.setColorAt(i, color);
        node.flash = Math.max(0, node.flash - dt * 2.2);
      }
      mesh.count = nodes.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const edgeColor = new THREE.Color();
    for (let i = 0; i < this.edgeCount; i++) {
      const edge = this.edges[i];
      edge.flash = Math.max(0, edge.flash - dt * 1.4);
      if (edge.memory) {
        edgeColor.set(0x173432).multiplyScalar(0.55);
      } else {
        edgeColor.set(0x2b6f6b);
        edgeColor.lerp(new THREE.Color(0xb8fff0), edge.flash);
        edgeColor.multiplyScalar(0.55 + edge.flash * 0.8);
      }
      const offset = i * 6;
      this.edgeColors[offset] = edgeColor.r;
      this.edgeColors[offset + 1] = edgeColor.g;
      this.edgeColors[offset + 2] = edgeColor.b;
      this.edgeColors[offset + 3] = edgeColor.r;
      this.edgeColors[offset + 4] = edgeColor.g;
      this.edgeColors[offset + 5] = edgeColor.b;
    }
    this.edgeGeometry.attributes.color.needsUpdate = true;

    let active = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.u = (t - particle.born) / particle.duration;
      if (particle.u >= 1) {
        this.particles.splice(i, 1);
        continue;
      }
    }
    for (const particle of this.particles) {
      const u = clamp(particle.u, 0, 1);
      const offset = active * 3;
      this.particlePositions[offset] = lerp(particle.a.x, particle.b.x, u);
      this.particlePositions[offset + 1] = lerp(particle.a.y, particle.b.y, u);
      this.particlePositions[offset + 2] = lerp(particle.a.z, particle.b.z, u);
      const brightness = 0.7 + 0.3 * Math.sin(u * Math.PI);
      this.particleColors[offset] = 0.7 * brightness;
      this.particleColors[offset + 1] = 1.0 * brightness;
      this.particleColors[offset + 2] = 0.92 * brightness;
      active++;
    }
    this.particleGeometry.setDrawRange(0, active);
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
  }

  pick(clientX, clientY, camera) {
    const pointer = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(this.nodeMeshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const layer = hit.object.userData.layer;
    return this.layerNodes[layer]?.[hit.instanceId] ?? null;
  }

  /** 屏幕空间拾取：节点很小，悬停/点击用一个 24px 的容差，不要求正中。 */
  projectPick(clientX, clientY, camera, world) {
    world.updateMatrixWorld();
    const point = new THREE.Vector3();
    let best = null;
    let bestDistance = 24;
    for (const nodes of this.layerNodes) {
      for (const node of nodes) {
        point.set(node.x, node.y, node.z).applyMatrix4(world.matrixWorld).project(camera);
        if (point.z < -1 || point.z > 1) continue;
        const x = (point.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-point.y * 0.5 + 0.5) * window.innerHeight;
        const distance = Math.hypot(x - clientX, y - clientY);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node;
        }
      }
    }
    return best;
  }
}

/* ------------------------------------------------------------------ */
/* scan focus                                                          */
/* ------------------------------------------------------------------ */

class ScanField {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.x0 = -2.7;
    this.x1 = 2.7;
    this.z0 = -2.5;
    this.z1 = 2.5;
    this.cols = 8;
    this.rows = 6;
    this.sampleCount = 1;
    this.cellW = (this.x1 - this.x0) / this.cols;
    this.cellD = (this.z1 - this.z0) / this.rows;
    this.y = 1.24;
    this.focus = { x: 0, z: 0 };
    this.target = { x: 0, z: 0 };

    this.gridMaterial = new THREE.LineBasicMaterial({
      color: 0x57e0d0, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const lines = [];
    for (let c = 0; c <= this.cols; c++) {
      const x = this.x0 + c * this.cellW;
      lines.push(x, this.y, this.z0, x, this.y, this.z1);
    }
    for (let r = 0; r <= this.rows; r++) {
      const z = this.z0 + r * this.cellD;
      lines.push(this.x0, this.y, z, this.x1, this.y, z);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    this.grid = new THREE.LineSegments(gridGeometry, this.gridMaterial);
    this.group.add(this.grid);

    this.cellMaterial = new THREE.MeshBasicMaterial({
      color: 0x57e0d0, transparent: true, opacity: 0.07,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.cell = new THREE.Mesh(new THREE.PlaneGeometry(this.cellW * 0.92, this.cellD * 0.92), this.cellMaterial);
    this.cell.rotation.x = -Math.PI / 2;
    this.cell.position.y = this.y + 0.006;
    this.group.add(this.cell);

    const borderGeometry = new THREE.BufferGeometry();
    borderGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
    ], 3));
    this.borderMaterial = new THREE.LineBasicMaterial({
      color: 0x57e0d0, transparent: true, opacity: 0.48,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.border = new THREE.LineLoop(borderGeometry, this.borderMaterial);
    this.border.position.y = this.y + 0.014;
    this.border.scale.set(this.cellW * 0.92, 1, this.cellD * 0.92);
    this.group.add(this.border);

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x57e0d0, transparent: true, opacity: 0.65,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.spot = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.17, 36), this.ringMaterial);
    this.spot.rotation.x = -Math.PI / 2;
    this.spot.position.y = this.y + 0.012;
    this.group.add(this.spot);

    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: 0x57e0d0, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.13, 1.06, 14, 1, true), this.beamMaterial);
    this.beam.position.y = this.y + 0.53;
    this.group.add(this.beam);
  }

  setAccent(color) {
    this.gridMaterial.color.set(color);
    this.cellMaterial.color.set(color);
    this.borderMaterial.color.set(color);
    this.ringMaterial.color.set(color);
    this.beamMaterial.color.set(color);
  }

  cellAt(index) {
    const total = this.cols * this.rows;
    const position = this.sampleCount > 1
      ? Math.round((index * (total - 1)) / (this.sampleCount - 1))
      : 0;
    const row = Math.floor(position / this.cols) % this.rows;
    const rawCol = position % this.cols;
    const col = row % 2 === 0 ? rawCol : this.cols - 1 - rawCol;
    return {
      x: this.x0 + (col + 0.5) * this.cellW,
      z: this.z0 + (row + 0.5) * this.cellD,
      w: this.cellW,
      d: this.cellD,
      row,
      col,
    };
  }

  setSampleCount(count) {
    this.sampleCount = Math.max(1, count);
  }

  focusAt(x, z) {
    this.target.x = x;
    this.target.z = z;
  }

  reset() {
    const cell = this.cellAt(0);
    this.focus.x = cell.x;
    this.focus.z = cell.z;
    this.target.x = cell.x;
    this.target.z = cell.z;
    this.cell.position.x = cell.x;
    this.cell.position.z = cell.z;
    this.border.position.x = cell.x;
    this.border.position.z = cell.z;
    this.spot.position.x = cell.x;
    this.spot.position.z = cell.z;
    this.beam.position.x = cell.x;
    this.beam.position.z = cell.z;
  }

  update(t) {
    const ease = 1 - Math.pow(0.001, 0.016);
    this.focus.x = lerp(this.focus.x, this.target.x, ease);
    this.focus.z = lerp(this.focus.z, this.target.z, ease);
    this.cell.position.x = this.focus.x;
    this.cell.position.z = this.focus.z;
    this.border.position.x = this.focus.x;
    this.border.position.z = this.focus.z;
    this.spot.position.x = this.focus.x;
    this.spot.position.z = this.focus.z;
    this.beam.position.x = this.focus.x;
    this.beam.position.z = this.focus.z;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    this.spot.scale.setScalar(1 + 0.08 * pulse);
    this.ringMaterial.opacity = 0.5 + 0.3 * pulse;
    this.borderMaterial.opacity = 0.32 + 0.25 * pulse;
    this.beamMaterial.opacity = 0.08 + 0.08 * pulse;
  }
}

/* ------------------------------------------------------------------ */
/* scene shell                                                         */
/* ------------------------------------------------------------------ */

class CognitiveField {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: "high-performance",
      alpha: false,
      stencil: false,
    });
    this.renderer.setClearColor(0x05080a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05080a, 0.021);
    this.camera = new THREE.PerspectiveCamera(41, 1, 0.1, 120);

    this.scene.add(new THREE.HemisphereLight(0xa8e8ff, 0x050b0c, 1.15));
    const key = new THREE.DirectionalLight(0xffd6a0, 2.3);
    key.position.set(6, 11, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x5fd8e8, 0.7);
    fill.position.set(-7, 4, -6);
    this.scene.add(fill);
    const core = new THREE.PointLight(0x57e0d0, 6, 26, 2);
    core.position.set(0, 4.2, 0);
    this.scene.add(core);

    const grid = new THREE.GridHelper(22, 44, 0x14333a, 0x0a171c);
    grid.position.y = -0.14;
    grid.material.transparent = true;
    grid.material.opacity = 0.34;
    this.scene.add(grid);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.rotationAngle = 0;
    this.rotationEnabled = true;
    this.interacted = false;
    this.hoverKey = null;
    this.lastHover = 0;

    this.shell = this.buildShell();
    this.world.add(this.shell);

    this.graph = new ReasoningGraph(this.world);
    this.scan = new ScanField(this.world);

    const dustPositions = [];
    for (let i = 0; i < 140; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2 + Math.random() * 6;
      dustPositions.push(Math.cos(angle) * radius, Math.random() * 8.5, Math.sin(angle) * radius);
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.Float32BufferAttribute(dustPositions, 3));
    this.dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
      color: 0x6fa7b0, size: 0.025, transparent: true, opacity: 0.26,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(this.dust);

    this.figureView = null;
    this.rig = new CameraRig(
      this.camera,
      canvas,
      (x, y) => this.pick(x, y),
      () => this.noteInteraction(),
      (x, y) => this.hover(x, y),
    );
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  buildShell() {
    const points = [];
    const radius = 4.86;
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      points.push(
        Math.cos(angle) * radius, 1.85, Math.sin(angle) * radius,
        Math.cos(angle) * radius, 6.55, Math.sin(angle) * radius,
      );
    }
    for (const y of [1.95, 2.3, 3.25, 4.2, 5.15, 6.1, 6.5]) {
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const b = ((i + 1) / 72) * Math.PI * 2;
        points.push(
          Math.cos(a) * radius, y, Math.sin(a) * radius,
          Math.cos(b) * radius, y, Math.sin(b) * radius,
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x1b3f48, transparent: true, opacity: 0.32, depthWrite: false,
    });
    return new THREE.LineSegments(geometry, material);
  }

  setFigure(figure) {
    if (this.figureView) this.figureView.dispose();
    this.figureView = new FigureView(this.world, figure);
    this.scan.setAccent(figure.accent);
    this.scan.reset();
  }

  noteInteraction() {
    if (this.interacted) return;
    this.interacted = true;
    this.rotationEnabled = false;
    hud?.setRotation(false);
  }

  toggleRotation() {
    this.interacted = true;
    this.rotationEnabled = !this.rotationEnabled;
    hud?.setRotation(this.rotationEnabled);
  }

  setRotation(enabled) {
    this.rotationEnabled = enabled;
    hud?.setRotation(enabled);
  }

  flash() {
    this.figureView?.flashOnce();
  }

  hover(clientX, clientY) {
    const now = performance.now();
    if (now - this.lastHover < 45) return;
    this.lastHover = now;
    const node = this.graph.projectPick(clientX, clientY, this.camera, this.world);
    this.canvas.style.cursor = node ? "pointer" : "grab";
    if (node === null) {
      if (this.hoverKey !== null) {
        this.hoverKey = null;
        this.graph.setHover(null);
        hud?.hoverNode(null);
      }
      return;
    }
    if (this.hoverKey !== node.key) {
      this.hoverKey = node.key;
      this.noteInteraction();
      this.graph.setHover(node);
      hud?.hoverNode(node, clientX, clientY);
    } else {
      hud?.moveHover(clientX, clientY);
    }
  }

  update(t, dt, activation, graphNow) {
    this.figureView?.update(t, dt, activation);
    this.graph.update(graphNow, dt);
    this.scan.update(t);
    if (this.rotationEnabled) this.rotationAngle += dt * 0.08;
    this.world.rotation.y = this.rotationAngle;
    this.rig.update(dt);
    this.dust.rotation.y = t * 0.006;
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, width < 760 ? 1.25 : 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.rig?.resize();
  }

  pick(clientX, clientY) {
    const node = this.graph.projectPick(clientX, clientY, this.camera, this.world);
    if (node) hud.toast(node, clientX, clientY);
  }
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

class Hud {
  constructor(data) {
    this.data = data;
    this.figName = $("figName");
    this.figCode = $("figCode");
    this.idx = $("idx");
    this.famTag = $("famTag");
    this.obs = $("obs");
    this.bar = $("bar");
    this.stats = $("stats");
    this.layers = $("layers");
    this.trace = $("trace");
    this.phase = $("phase");
    this.clock = $("clock");
    this.fps = $("fps");
    this.toastEl = $("toast");
    this.flashEl = $("flash");
    this.timeline = $("timeline");
    this.mode = $("mode");
    this.boot = $("boot");
    this.speed = $("speed");
    this.stepInfo = $("stepInfo");
    this.labelsLayer = $("labels");
    this.instLayer = $("instLabels");
    this.rotateBtn = $("rotate");
    this.memInfo = $("memInfo");
    this.pauseBtn = $("pauseBtn");
    this.dwellBtn = $("dwellBtn");
    this.nodeLabels = [];
    this.instanceLabels = [];
    this.hoveredNode = null;
    this.layerRows = [];
    this.buildTimeline();
    this.buildLayers();
    this.buildSpeed();
    this.buildSwitches();
    this.buildRotation();
  }

  buildTimeline() {
    this.ticks = this.data.figures.map((figure, index) => {
      const button = document.createElement("button");
      button.className = "tick";
      button.type = "button";
      button.innerHTML = `${pad(index + 1)} ${figure.code}<span class="bar"></span>`;
      button.addEventListener("click", () => {
        director.interact();
        director.jump(index);
      });
      this.timeline.appendChild(button);
      return button;
    });
  }

  buildLayers() {
    for (let index = 0; index < this.data.layerNames.length; index++) {
      const row = document.createElement("div");
      row.className = "layer";
      row.style.setProperty("--lc", LAYER_CSS[index]);
      row.innerHTML = `
        <div class="row"><span><i class="dot"></i>${this.data.layerNames[index]}</span><b data-count>0</b></div>
        <div class="track"><i data-fill></i></div>`;
      this.layers.appendChild(row);
      this.layerRows.push({
        count: row.querySelector("[data-count]"),
        fill: row.querySelector("[data-fill]"),
      });
    }
  }

  buildSpeed() {
    this.speedButtons = SPEEDS.map((rate) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.rate = String(rate);
      button.textContent = `${rate}×`;
      button.addEventListener("click", () => {
        director.interact();
        director.setSpeed(rate);
      });
      this.speed.appendChild(button);
      return button;
    });
  }

  buildSwitches() {
    this.pauseBtn.addEventListener("click", () => {
      director.interact();
      director.togglePause();
    });
    this.dwellBtn.addEventListener("click", () => {
      director.interact();
      director.cycleDwell();
    });
  }

  buildRotation() {
    this.rotateBtn.addEventListener("click", () => director.toggleRotation());
    this.setRotation(true);
  }

  setRotation(enabled) {
    this.rotateBtn.classList.toggle("active", enabled);
    this.rotateBtn.textContent = enabled ? "ROTATE ON" : "ROTATE OFF";
  }

  setDwell(multiplier) {
    this.dwellBtn.textContent = `DWELL ${multiplier}×`;
    this.dwellBtn.classList.toggle("active", multiplier !== 1);
  }

  setMemory(count) {
    this.memInfo.textContent = `MEM ${count}`;
  }

  setFigure(figure, index, total) {
    document.documentElement.style.setProperty("--accent", figure.accent);
    this.figName.textContent = figure.name;
    this.figCode.textContent = figure.code;
    this.idx.textContent = `${pad(index + 1)} / ${pad(total)}`;
    this.famTag.textContent = figure.family.toUpperCase();
    this.obs.textContent = `STEP 00 / ${pad(figure.steps.length)}`;
    this.stats.innerHTML = `
      <div><span>OBJECTS</span><b>${figure.stats.objects}</b></div>
      <div><span>LINKS</span><b>${figure.stats.links}</b></div>
      <div><span>STEPS</span><b>${figure.stats.steps}</b></div>
      <div><span>CONCEPTS</span><b>${figure.stats.concepts}</b></div>
      <div class="${figure.stats.similar ? "hot" : ""}"><span>SIM</span><b>${figure.stats.similar ? "YES" : "NO"}</b></div>
      <div class="${figure.stats.compounds ? "hot" : ""}"><span>∩</span><b>${figure.stats.compounds}</b></div>`;
    for (const row of this.layerRows) {
      row.count.textContent = "0";
      row.fill.style.width = "0%";
    }
    this.trace.innerHTML = "";
    this.clearLabels();
    this.buildInstanceLabels(figure.instances ?? []);
    this.toastEl.classList.remove("show");
    this.stepInfo.textContent = `STEP 00/${pad(figure.steps.length)}`;
    this.bar.style.width = "0%";
    this.ticks.forEach((tick, i) => tick.classList.toggle("active", i === index));
  }

  setCounts(counts) {
    const max = Math.max(1, ...counts);
    for (let i = 0; i < this.layerRows.length; i++) {
      this.layerRows[i].count.textContent = counts[i] ?? 0;
      this.layerRows[i].fill.style.width = `${((counts[i] ?? 0) / max) * 100}%`;
    }
  }

  setStep(step, cursor, total, counts, memory = 0) {
    this.bar.style.width = `${(cursor / Math.max(1, total)) * 100}%`;
    this.obs.textContent = `STEP ${pad(cursor)}/${pad(total)} · MEM ${memory}`;
    this.stepInfo.textContent = `STEP ${pad(cursor)}/${pad(total)}`;
    this.memInfo.textContent = `MEM ${memory}`;
    this.phase.textContent = step.kind === "instance" ? "INSTANCING" : step.kind === "observe" ? "OBSERVING" : "REASONING";
    this.phase.classList.remove("transition");
    this.setCounts(counts);
    const row = document.createElement("div");
    row.className = `trace-row ${step.kind}`;
    row.innerHTML = `
      <span class="rule">${step.kind === "instance" ? "INST" : step.kind === "observe" ? "OBS" : (step.rule ?? "?")}</span>
      <span class="statement">${step.label}</span>
      <span class="truth">${step.truth.f.toFixed(2)}</span>`;
    row.querySelector(".statement")?.setAttribute("title", step.label);
    if (step.worker) row.title = `${step.worker} · ${step.label}`;
    this.trace.prepend(row);
    while (this.trace.children.length > 5) this.trace.lastElementChild?.remove();
  }

  clearLabels() {
    this.nodeLabels = [];
    this.hoveredNode = null;
    this.labelsLayer.innerHTML = "";
  }

  buildInstanceLabels(instances) {
    this.clearInstanceLabels();
    for (const instance of instances) {
      const el = document.createElement("div");
      el.className = "ilabel";
      el.dataset.kind = instance.kind;
      el.textContent = instance.id;
      this.instLayer.appendChild(el);
      this.instanceLabels.push({ instance, el });
    }
  }

  clearInstanceLabels() {
    this.instanceLabels = [];
    this.instLayer.innerHTML = "";
  }

  updateInstanceLabels(camera, world) {
    if (!this.instanceLabels.length) return;
    world.updateMatrixWorld();
    const vector = new THREE.Vector3();
    for (const entry of this.instanceLabels) {
      vector.set(entry.instance.x, INSTANCE_HEIGHT + 0.2, entry.instance.z).applyMatrix4(world.matrixWorld);
      vector.project(camera);
      if (vector.z < -1 || vector.z > 1) {
        entry.el.style.display = "none";
        continue;
      }
      entry.el.style.display = "block";
      entry.el.style.left = `${(vector.x * 0.5 + 0.5) * window.innerWidth}px`;
      entry.el.style.top = `${(-vector.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
  }

  showNodeLabel(node) {
    if (!node) return;
    const entry = { node, el: document.createElement("div"), born: performance.now(), hover: false };
    entry.el.className = "nlabel";
    entry.el.textContent = node.label.length > 38 ? `${node.label.slice(0, 37)}…` : node.label;
    this.labelsLayer.appendChild(entry.el);
    this.nodeLabels.push(entry);
    while (this.nodeLabels.length > 8) {
      const removable = this.nodeLabels.find((item) => !item.hover);
      if (!removable) break;
      removable.el.remove();
      this.nodeLabels.splice(this.nodeLabels.indexOf(removable), 1);
    }
  }

  hoverNode(node, x, y) {
    this.hoveredNode = node;
    clearTimeout(this.toastTimer);
    if (!node) {
      this.toastEl.classList.remove("show");
      const now = performance.now();
      for (const entry of this.nodeLabels) {
        if (!entry.hover) continue;
        entry.hover = false;
        entry.el.classList.remove("hover");
        entry.born = now;
      }
      return;
    }
    let entry = this.nodeLabels.find((item) => item.node === node);
    if (!entry) {
      this.showNodeLabel(node);
      entry = this.nodeLabels[this.nodeLabels.length - 1];
    }
    if (entry) {
      entry.hover = true;
      entry.el.classList.add("hover");
      entry.el.style.opacity = "1";
    }
    this.toastEl.innerHTML = `<b>${node.label}</b>L${node.layer} · ${node.key}`;
    this.moveHover(x, y);
    this.toastEl.classList.add("show");
  }

  moveHover(x, y) {
    this.toastEl.style.left = `${Math.min(x + 16, window.innerWidth - 420)}px`;
    this.toastEl.style.top = `${Math.min(y + 16, window.innerHeight - 140)}px`;
  }

  updateLabels(camera, world) {
    world.updateMatrixWorld();
    const now = performance.now();
    const vector = new THREE.Vector3();
    for (let i = this.nodeLabels.length - 1; i >= 0; i--) {
      const entry = this.nodeLabels[i];
      if (entry.node !== this.hoveredNode && now - entry.born > LABEL_HOLD) {
        entry.el.style.opacity = "0";
        if (now - entry.born > LABEL_HOLD + LABEL_FADE) {
          entry.el.remove();
          this.nodeLabels.splice(i, 1);
          continue;
        }
      }
      vector.set(entry.node.x, entry.node.y + 0.18, entry.node.z).applyMatrix4(world.matrixWorld);
      vector.project(camera);
      if (vector.z < -1 || vector.z > 1) {
        entry.el.style.opacity = "0";
        continue;
      }
      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
      entry.el.style.left = `${x}px`;
      entry.el.style.top = `${y}px`;
      if (entry.node === this.hoveredNode) entry.el.style.opacity = "1";
      else if (now - entry.born <= LABEL_HOLD) entry.el.style.opacity = "1";
    }
  }

  setSpeed(speed) {
    this.currentSpeed = speed;
    for (const button of this.speedButtons) {
      button.classList.toggle("active", Number(button.dataset.rate) === speed);
    }
  }

  setClock(seconds) {
    this.clock.textContent = `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds % 60))}.${Math.floor((seconds % 1) * 10)}`;
  }

  setFps(fps) {
    this.fps.textContent = `${Math.round(fps)} FPS`;
  }

  flash() {
    this.flashEl.classList.remove("on");
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("on");
    setTimeout(() => this.flashEl.classList.remove("on"), 80);
  }

  toast(node, x, y) {
    this.toastEl.innerHTML = `<b>${node.label}</b>L${node.layer} · ${node.key}`;
    this.toastEl.style.left = `${Math.min(x + 16, window.innerWidth - 420)}px`;
    this.toastEl.style.top = `${Math.min(y + 16, window.innerHeight - 140)}px`;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), 2400);
  }

  setPaused(paused) {
    document.body.classList.toggle("paused", paused);
    this.pauseBtn.textContent = paused ? "RESUME" : "PAUSE";
    this.pauseBtn.classList.toggle("active", paused);
    this.mode.textContent = paused ? "PAUSED" : `AUTO ×${this.currentSpeed ?? 1}`;
  }

  bootDone() {
    this.boot.classList.add("done");
  }
}

/* ------------------------------------------------------------------ */
/* director                                                            */
/* ------------------------------------------------------------------ */

class Director {
  constructor(data, field, hud) {
    this.data = data;
    this.field = field;
    this.hud = hud;
    this.index = 0;
    this.cursor = 0;
    this.timer = 0;
    this.hold = 0;
    this.total = 0;
    this.speed = 1;
    this.dwell = 2;
    this.paused = false;
    this.phase = "run";
    this.now = performance.now() / 1000;
    this.build(0);
    this.hud.setClock(0);
    this.hud.setSpeed(this.speed);
    this.hud.setDwell(this.dwell);
    this.hud.setPaused(false);
  }

  get figure() {
    return this.data.figures[this.index];
  }

  get activation() {
    return 1 - 0.18 * (this.cursor / Math.max(1, this.figure.steps.length));
  }

  build(index) {
    this.index = index;
    this.cursor = 0;
    this.timer = 0;
    this.hold = 0;
    this.phase = "run";
    const now = performance.now() / 1000;
    this.now = now;
    this.field.graph.beginFigure(this.figure.labels, now);
    this.field.setFigure(this.figure);
    this.hud.setFigure(this.figure, index, this.data.figures.length);
    this.hud.setMemory(this.field.graph.total());
    this.hud.flash();
    this.field.flash();
  }

  interact() {
    this.field.noteInteraction();
  }

  toggleRotation() {
    this.field.toggleRotation();
  }

  jump(index) {
    if (index === this.index) return;
    this.interact();
    this.build((index + this.data.figures.length) % this.data.figures.length);
  }

  next() {
    this.interact();
    this.build((this.index + 1) % this.data.figures.length);
  }

  prev() {
    this.interact();
    this.build((this.index - 1 + this.data.figures.length) % this.data.figures.length);
  }

  togglePause() {
    this.paused = !this.paused;
    this.hud.setPaused(this.paused);
  }

  setSpeed(speed) {
    this.speed = speed;
    this.hud.setSpeed(speed);
    this.hud.setPaused(this.paused);
  }

  cycleDwell() {
    const options = [1, 2, 4];
    const index = options.indexOf(this.dwell);
    this.setDwell(options[(index + 1) % options.length]);
  }

  setDwell(multiplier) {
    this.dwell = multiplier;
    this.hud.setDwell(multiplier);
  }

  interval(step) {
    if (step.kind === "instance") return STEP_INSTANCE / this.speed;
    return (step.kind === "observe" ? STEP_OBSERVE : STEP_DERIVE) / this.speed;
  }

  update(dt) {
    if (this.paused) return;
    this.total += dt;
    this.now += dt;
    this.hud.setClock(this.total);
    if (this.phase === "hold") {
      this.hold -= dt;
      if (this.hold <= 0) this.build((this.index + 1) % this.data.figures.length);
      return;
    }
    const steps = this.figure.steps;
    if (this.cursor >= steps.length) {
      this.phase = "hold";
      this.hold = BASE_HOLD * this.dwell;
      this.hud.setStep(steps[steps.length - 1], steps.length, steps.length, this.field.graph.counts(), this.field.graph.total());
      return;
    }
    this.timer += dt;
    const step = steps[this.cursor];
    if (this.timer < this.interval(step)) return;
    this.timer = 0;
    const now = this.now;
    if (step.kind === "instance") {
      this.field.scan.focusAt(step.focus.x, step.focus.z);
      this.field.figureView?.flashInstance?.(step.instance);
      const node = this.field.graph.addInstance(step, now);
      this.hud.showNodeLabel(node);
    } else if (step.kind === "observe") {
      this.field.scan.focusAt(step.focus.x, step.focus.z);
      this.field.figureView?.flashInstance?.(step.instance);
      const node = this.field.graph.observeFact(step, now);
      this.hud.showNodeLabel(node);
    } else {
      const result = this.field.graph.derive(step, now, this.speed);
      if (result.focus) this.field.scan.focusAt(result.focus.x, result.focus.z);
      this.hud.showNodeLabel(result.node);
    }
    this.cursor++;
    this.hud.setStep(step, this.cursor, steps.length, this.field.graph.counts(), this.field.graph.total());
  }
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

const data = BRAIN_DATA;
const field = new CognitiveField($("scene"));
const hud = new Hud(data);
const director = new Director(data, field, hud);

const params = new URLSearchParams(location.search);
if (params.get("boot") === "0") hud.boot.style.display = "none";
const startFigure = Number(params.get("figure") ?? 0);
if (Number.isInteger(startFigure) && startFigure > 0) director.build(startFigure % data.figures.length);
if (params.get("pause") === "1") director.togglePause();
const simulate = Number(params.get("simulate") ?? 0);
if (simulate > 0) {
  for (let i = 0; i < Math.ceil(simulate * 60); i++) {
    director.update(1 / 60);
    field.graph.update(director.now, 1 / 60);
    field.scan.update(director.now);
  }
}

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    director.interact();
    director.togglePause();
  } else if (event.code === "ArrowRight") {
    director.next();
  } else if (event.code === "ArrowLeft") {
    director.prev();
  } else if (event.code === "BracketRight") {
    director.interact();
    const index = SPEEDS.indexOf(director.speed);
    director.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, index + 1)]);
  } else if (event.code === "BracketLeft") {
    director.interact();
    const index = SPEEDS.indexOf(director.speed);
    director.setSpeed(SPEEDS[Math.max(0, index - 1)]);
  }
});

let last = performance.now();
let fpsTime = 0;
let fpsFrames = 0;
let booted = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (document.hidden) return;
  const t = now / 1000;
  director.update(dt);
  field.update(t, dt, director.activation, director.now);
  hud.updateLabels(field.camera, field.world);
  hud.updateInstanceLabels(field.camera, field.world);
  field.renderer.render(field.scene, field.camera);
  fpsTime += dt;
  fpsFrames++;
  if (fpsTime >= 0.6) {
    hud.setFps(fpsFrames / fpsTime);
    fpsTime = 0;
    fpsFrames = 0;
  }
  if (!booted) {
    booted = true;
    requestAnimationFrame(() => hud.bootDone());
  }
}

requestAnimationFrame(frame);

