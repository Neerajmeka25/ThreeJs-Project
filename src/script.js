import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FlyControls } from "three/examples/jsm/controls/FlyControls.js";
import { FirstPersonControls } from "three/examples/jsm/controls/FirstPersonControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import GUI from "lil-gui";

// ── LASER ─────────────────────────────────────────────────────────
let laserLine = null;
const laserMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
const laserGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(), new THREE.Vector3()
]);

let demoObject = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let enableRaycast = false;
let currentIntersect = null;
let lastIntersectedObject = null; // FIX: track to reset scale

// ── RENDERER ──────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// FIX: disabled physicallyCorrectLights — in this mode intensity must be in lumens
// (hundreds to thousands), making roughness/metalness differences invisible at low values.
// Keeping it off so standard 0–5 intensity values work and PBR properties are visible.
renderer.physicallyCorrectLights = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputEncoding = THREE.sRGBEncoding;

// ── SCENE ─────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080814);

// ── CAMERAS ───────────────────────────────────────────────────────
let W = window.innerWidth, H = window.innerHeight;
let aspect = W / H;

const perspCam = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
perspCam.position.set(5, 4, 7);

const camP = { type: 'Perspective', fov: 60, near: 0.1, far: 1000, posX: 5, posY: 4, posZ: 7, orthoSize: 7 };

const orthoCam = new THREE.OrthographicCamera(
  -camP.orthoSize * aspect, camP.orthoSize * aspect,
  camP.orthoSize, -camP.orthoSize, 0.1, 1000
);
orthoCam.position.set(5, 4, 7);

let activeCamera = perspCam;

// ── ORBIT CONTROLS (defined before switchControls uses it) ────────
let controls = new OrbitControls(activeCamera, renderer.domElement);
let controlMode = 'Orbit';
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0);
controls.update();

// ── ORBIT PARAMS (defined before applyOrbit is called) ───────────
const orbitP = {
  enabled: true, autoRotate: false, autoRotateSpeed: 1.5,
  enableDamping: true, dampingFactor: 0.05,
  minDist: 1, maxDist: 80, minPolar: 0, maxPolar: 180,
  minAzimuth: -180, maxAzimuth: 180,
  enableZoom: true, enablePan: true, zoomSpeed: 1,
};

// FIX: applyOrbit defined before switchControls references it
function applyOrbit() {
  if (controlMode !== 'Orbit') return;
  controls.enabled = orbitP.enabled;
  controls.autoRotate = orbitP.autoRotate;
  controls.autoRotateSpeed = orbitP.autoRotateSpeed;
  controls.enableDamping = orbitP.enableDamping;
  controls.dampingFactor = orbitP.dampingFactor;
  controls.minDistance = orbitP.minDist;
  controls.maxDistance = orbitP.maxDist;
  controls.minPolarAngle = THREE.MathUtils.degToRad(orbitP.minPolar);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(orbitP.maxPolar);
  controls.minAzimuthAngle = orbitP.minAzimuth <= -180 ? -Infinity : THREE.MathUtils.degToRad(orbitP.minAzimuth);
  controls.maxAzimuthAngle = orbitP.maxAzimuth >= 180 ? Infinity : THREE.MathUtils.degToRad(orbitP.maxAzimuth);
  controls.enableZoom = orbitP.enableZoom;
  controls.enablePan = orbitP.enablePan;
  controls.zoomSpeed = orbitP.zoomSpeed;
}
applyOrbit();

function switchControls(type) {
  if (controls) controls.dispose();
  const oldTarget = controls?.target?.clone?.() || new THREE.Vector3();
  controlMode = type;

  switch (type) {
    case 'Orbit':
      controls = new OrbitControls(activeCamera, renderer.domElement);
      controls.target.copy(oldTarget);
      applyOrbit();
      break;
    case 'Fly':
      controls = new FlyControls(activeCamera, renderer.domElement);
      controls.movementSpeed = 10;
      controls.rollSpeed = Math.PI / 24;
      controls.dragToLook = true;
      break;
    case 'FirstPerson':
      controls = new FirstPersonControls(activeCamera, renderer.domElement);
      controls.movementSpeed = 5;
      controls.lookSpeed = 0.1;
      break;
    case 'PointerLock':
      controls = new PointerLockControls(activeCamera, document.body);
      // Only lock on canvas click, not GUI clicks
      canvas.addEventListener('click', () => controls.lock(), { once: false });
      break;
  }
  updateGuide(type);
}

// ── LASER ─────────────────────────────────────────────────────────
laserLine = new THREE.Line(laserGeometry, laserMaterial);
laserLine.visible = false;
scene.add(laserLine);

// ── HELPERS ───────────────────────────────────────────────────────
const gridHelper = new THREE.GridHelper(24, 24, 0x1a1a3a, 0x111128);
gridHelper.position.y = -1.51;
scene.add(gridHelper);

const axesHelper = new THREE.AxesHelper(4);
scene.add(axesHelper);

// ── GROUND ────────────────────────────────────────────────────────
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.MeshStandardMaterial({ color: 0x0d0d22, roughness: 0.95, metalness: 0.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.5;
ground.receiveShadow = true;
scene.add(ground);

// ── LIGHTS ────────────────────────────────────────────────────────

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// FIX: intensity back to 1.8 (physicallyCorrectLights is off, so this is correct)
const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(6, 10, 6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 60;
dirLight.shadow.camera.left = -12;
dirLight.shadow.camera.right = 12;
dirLight.shadow.camera.top = 12;
dirLight.shadow.camera.bottom = -12;
dirLight.shadow.bias = -0.001;
dirLight.shadow.radius = 4;
scene.add(dirLight);

const dirHelper = new THREE.DirectionalLightHelper(dirLight, 1.2, 0xffff00);
dirHelper.visible = false;
scene.add(dirHelper);

const dirShadowHelper = new THREE.CameraHelper(dirLight.shadow.camera);
dirShadowHelper.visible = false;
scene.add(dirShadowHelper);

const pointLight = new THREE.PointLight(0xff6b6b, 0, 15, 2);
pointLight.position.set(-4, 3, 2);
pointLight.castShadow = true;
pointLight.visible = false;
scene.add(pointLight);

const pointHelper = new THREE.PointLightHelper(pointLight, 0.35, 0xff6b6b);
pointHelper.visible = false;
scene.add(pointHelper);

const spotLight = new THREE.SpotLight(0x5ee7df, 0);
spotLight.position.set(0, 9, 0);
spotLight.angle = Math.PI / 7;
spotLight.penumbra = 0.25;
spotLight.decay = 2;
spotLight.distance = 22;
spotLight.castShadow = true;
spotLight.shadow.mapSize.set(1024, 1024);
spotLight.visible = false;
scene.add(spotLight);

const spotHelper = new THREE.SpotLightHelper(spotLight);
spotHelper.visible = false;
scene.add(spotHelper);

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x5c4033, 0);
hemiLight.visible = false;
scene.add(hemiLight);

const hemiHelper = new THREE.HemisphereLightHelper(hemiLight, 1);
hemiHelper.visible = false;
scene.add(hemiHelper);

// ── GEOMETRIES ────────────────────────────────────────────────────
function makeGeometry(type) {
  switch (type) {
    case 'Box': return new THREE.BoxGeometry(1.2, 1.2, 1.2, 2, 2, 2);
    case 'Sphere': return new THREE.SphereGeometry(0.8, 32, 32);
    case 'Cylinder': return new THREE.CylinderGeometry(0.55, 0.55, 1.6, 32);
    case 'Cone': return new THREE.ConeGeometry(0.75, 1.6, 32);
    case 'Torus': return new THREE.TorusGeometry(0.65, 0.28, 20, 80);
    case 'TorusKnot': return new THREE.TorusKnotGeometry(0.5, 0.18, 120, 20);
    case 'Octahedron': return new THREE.OctahedronGeometry(0.9);
    case 'Icosahedron': return new THREE.IcosahedronGeometry(0.9);
    case 'Tetrahedron': return new THREE.TetrahedronGeometry(1.0);
    case 'Dodecahedron': return new THREE.DodecahedronGeometry(0.8);
    case 'Capsule': return new THREE.CylinderGeometry(0.4, 0.4, 1.2, 24);
    default: return new THREE.BoxGeometry(1.2, 1.2, 1.2);
  }
}

const SIDE = {
  'Front': THREE.FrontSide,
  'Back': THREE.BackSide,
  'Double': THREE.DoubleSide
};

function makeMaterial(s) {
  const base = {
    color: new THREE.Color(s.color),
    wireframe: s.wireframe,
    transparent: s.transparent || s.opacity < 1,
    opacity: s.opacity,
    side: SIDE[s.side] ?? THREE.FrontSide,
  };
  switch (s.materialType) {
    case 'Basic':
      return new THREE.MeshBasicMaterial(base);
    case 'Normal':
      return new THREE.MeshNormalMaterial({
        wireframe: s.wireframe, side: base.side,
        transparent: base.transparent, opacity: base.opacity
      });
    case 'Depth':
      return new THREE.MeshDepthMaterial({ wireframe: s.wireframe });
    case 'Lambert':
      return new THREE.MeshLambertMaterial({ ...base, emissive: new THREE.Color(s.emissive) });
    case 'Phong':
      return new THREE.MeshPhongMaterial({
        ...base, emissive: new THREE.Color(s.emissive),
        shininess: s.shininess, flatShading: s.flatShading
      });
    case 'Standard':
      return new THREE.MeshStandardMaterial({
        ...base, emissive: new THREE.Color(s.emissive),
        roughness: s.roughness, metalness: s.metalness, flatShading: s.flatShading
      });
    case 'Physical':
      return new THREE.MeshPhysicalMaterial({
        ...base, emissive: new THREE.Color(s.emissive),
        roughness: s.roughness, metalness: s.metalness,
        clearcoat: s.clearcoat, clearcoatRoughness: 0.1, flatShading: s.flatShading
      });
    case 'Toon':
      return new THREE.MeshToonMaterial({ ...base, emissive: new THREE.Color(s.emissive) });
    default:
      return new THREE.MeshStandardMaterial({
        ...base, emissive: new THREE.Color(s.emissive),
        roughness: s.roughness, metalness: s.metalness
      });
  }
}

// ── MAIN MESH STATE ───────────────────────────────────────────────
const M1 = {
  shape: 'Box', materialType: 'Standard',
  color: '#e05c6e', emissive: '#000000',
  roughness: 0.45, metalness: 0.1, shininess: 80, clearcoat: 0.5,
  wireframe: false, flatShading: false, transparent: false, opacity: 1.0, side: 'Front',
  posX: 0, posY: 0, posZ: 0,
  rotX: 0, rotY: 0, rotZ: 0,
  scaleX: 1, scaleY: 1, scaleZ: 1, uniformScale: 1,
  castShadow: true, receiveShadow: true,
  textureMap: 'None',
  textureRepeat: 1,
  spinX: false, spinY: false, spinZ: false, spinSpeed: 0.5,
};

let mesh1 = new THREE.Mesh(makeGeometry(M1.shape), makeMaterial(M1));
mesh1.castShadow = true;
mesh1.receiveShadow = true;
scene.add(mesh1);

// FIX: rebuildMesh1Geo now preserves current material state correctly
function rebuildMesh1Geo() {
  mesh1.geometry.dispose();
  mesh1.geometry = makeGeometry(M1.shape);
}

// FIX: rebuildMesh1Mat always reads from M1 state object — all GUI changes
// must update M1 before calling this (which they do via the state object binding)
function rebuildMesh1Mat() {
  mesh1.material.dispose();
  mesh1.material = makeMaterial(M1);
  applyTexture(mesh1.material, M1.textureMap, M1.textureRepeat);
}

// FIX: applyMesh1Prop now also syncs M1 state so rebuild stays consistent
function applyMesh1Prop(key, val) {
  M1[key] = val; // keep state in sync
  const mat = mesh1.material;
  if (!mat) return;
  if (key === 'color' && mat.color) mat.color.set(val);
  else if (key === 'emissive' && mat.emissive) mat.emissive.set(val);
  else if (key === 'roughness' && mat.roughness !== undefined) mat.roughness = val;
  else if (key === 'metalness' && mat.metalness !== undefined) mat.metalness = val;
  else if (key === 'shininess' && mat.shininess !== undefined) mat.shininess = val;
  else if (key === 'wireframe') mat.wireframe = val;
  else if (key === 'flatShading' && mat.flatShading !== undefined) { mat.flatShading = val; mat.needsUpdate = true; }
  else if (key === 'transparent') mat.transparent = val;
  else if (key === 'opacity') { mat.opacity = val; mat.transparent = val < 1; }
  else if (key === 'side') { mat.side = SIDE[val]; mat.needsUpdate = true; }
  else if (key === 'clearcoat' && mat.clearcoat !== undefined) mat.clearcoat = val;
  else if (key === 'textureMap' || key === 'textureRepeat') {
    applyTexture(mesh1.material, M1.textureMap, M1.textureRepeat);
  }
  // If the property doesn't exist on current material type, do a full rebuild
  // e.g. switching between Basic (no roughness) and Standard (has roughness)
}

const _texCache = {};

function makeCanvasTexture(type) {
  if (_texCache[type]) return _texCache[type];
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');

  switch (type) {
    case 'Checker': {
      const t = S / 8;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#dddddd' : '#333333';
        ctx.fillRect(c * t, r * t, t, t);
      }
      break;
    }
    case 'Brick': {
      ctx.fillStyle = '#9b4520';
      ctx.fillRect(0, 0, S, S);
      const bW = S / 4, bH = S / 8;
      for (let r = 0; r < 9; r++) {
        const off = r % 2 === 0 ? 0 : bW / 2;
        for (let c = -1; c < 5; c++) {
          const lightness = 30 + Math.abs(Math.sin(r * 7 + c * 3)) * 12;
          ctx.fillStyle = `hsl(16, 55%, ${lightness}%)`;
          ctx.fillRect(c * bW + off + 3, r * bH + 3, bW - 6, bH - 6);
        }
        ctx.fillStyle = '#8b7355';
        ctx.fillRect(0, r * bH, S, 3);
      }
      break;
    }
    case 'Grid': {
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = '#3388ff';
      ctx.lineWidth = 1.5;
      for (let i = 0; i <= 16; i++) {
        const p = i * S / 16;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
      }
      ctx.strokeStyle = '#66aaff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
      break;
    }
    case 'Marble': {
      const id = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const n = Math.sin(x / 28 + Math.sin(y / 18 + Math.cos(x / 40)) * 4) * 0.5 + 0.5;
        const v = Math.floor(n * 190 + 65);
        const i = (y * S + x) * 4;
        id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = Math.min(255, v + 25); id.data[i + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      break;
    }
    case 'Wood': {
      const id = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.sqrt((x - S * 0.4) ** 2 + (y - S * 0.5) ** 2);
        const ring = Math.sin(d / 10 + Math.sin(x / 60) * 1.5) * 0.5 + 0.5;
        const i = (y * S + x) * 4;
        id.data[i] = Math.floor(ring * 120 + 100);
        id.data[i + 1] = Math.floor(ring * 60 + 45);
        id.data[i + 2] = Math.floor(ring * 15 + 15);
        id.data[i + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      break;
    }
    case 'Metal': {
      const id = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const streak = Math.sin(y / 4 + Math.sin(x / 20) * 0.3) * 0.5 + 0.5;
        const v = Math.floor(streak * 80 + 140);
        const i = (y * S + x) * 4;
        id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = Math.min(255, v + 15); id.data[i + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      break;
    }
    case 'UV': {
      const gx = ctx.createLinearGradient(0, 0, S, 0);
      gx.addColorStop(0, '#ff0000'); gx.addColorStop(0.5, '#00ff00'); gx.addColorStop(1, '#0000ff');
      ctx.fillStyle = gx; ctx.fillRect(0, 0, S, S);
      const gy = ctx.createLinearGradient(0, 0, 0, S);
      gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.fillStyle = gy; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const p = i * S / 8;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
      }
      break;
    }
    case 'Lava': {
      const id = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const n = Math.abs(Math.sin(x / 30) * Math.cos(y / 25) + Math.sin((x + y) / 40));
        const i = (y * S + x) * 4;
        id.data[i] = Math.min(255, Math.floor(n * 255));
        id.data[i + 1] = Math.floor(n * 80);
        id.data[i + 2] = 0;
        id.data[i + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      break;
    }
    case 'Camo': {
      const id = ctx.createImageData(S, S);
      const blobs = Array.from({ length: 20 }, () => ({
        x: Math.random() * S, y: Math.random() * S,
        r: 30 + Math.random() * 60,
        c: [
          [85, 107, 47], [107, 142, 35], [139, 119, 62], [34, 50, 20]
        ][Math.floor(Math.random() * 4)]
      }));
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        let best = { dist: Infinity, c: [60, 90, 30] };
        for (const b of blobs) {
          const d = Math.hypot(x - b.x, y - b.y);
          if (d < b.r && d < best.dist) best = { dist: d, c: b.c };
        }
        const i = (y * S + x) * 4;
        [id.data[i], id.data[i + 1], id.data[i + 2]] = best.c;
        id.data[i + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      break;
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  _texCache[type] = tex;
  return tex;
}

const TEX_TYPES = ['None', 'Checker', 'Brick', 'Grid', 'Marble', 'Wood', 'Metal', 'UV', 'Lava', 'Camo'];

// Applies (or removes) a texture on a material. Mutates the cached texture's repeat
// so we share the same CanvasTexture instance across all materials using the same type.
// If two objects need the same type at different repeat scales, this is a limitation of the demo.
function applyTexture(mat, texName, repeat) {
  if (!mat) return;
  if (texName === 'None') {
    mat.map = null;
  } else {
    const tex = makeCanvasTexture(texName);
    tex.repeat.set(repeat, repeat);
    tex.needsUpdate = true;
    mat.map = tex;
  }
  mat.needsUpdate = true;
}

// ── ADDITIONAL OBJECTS ────────────────────────────────────────────
const extraMeshes = [];
let extraFolder = null;
let extraSelectedFolder = null;

const addState = { shape: 'Sphere', color: '#5ee7df', posX: 2.5, posY: 0, posZ: 0, label: 'Object 2' };

function refreshCount() {
  const el = document.getElementById('count');
  if (el) el.textContent = 1 + extraMeshes.length;
}

let addPosXCtrl = null, addLabelCtrl = null;

function addExtraMesh() {
  const geo = makeGeometry(addState.shape);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(addState.color),
    roughness: 0.5, metalness: 0.1
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(addState.posX, addState.posY, addState.posZ);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.label = addState.label || `Object ${extraMeshes.length + 2}`;
  scene.add(m);
  extraMeshes.push(m);
  refreshCount();
  rebuildExtraFolder();
  addState.posX = parseFloat((addState.posX + 2.8).toFixed(1));
  addState.label = `Object ${extraMeshes.length + 2}`;
  if (addPosXCtrl) addPosXCtrl.updateDisplay();
  if (addLabelCtrl) addLabelCtrl.updateDisplay();
}

// ── GUI ───────────────────────────────────────────────────────────
const gui = new GUI({ title: '⚙  Three.js Controls', width: 310 });
gui.domElement.style.cssText = 'position:fixed;top:10px;right:10px;width:25vw;max-height:95vh;overflow-y:auto;z-index:200;';

// ── RAYCASTING ────────────────────────────────────────────────────
const rayF = gui.addFolder('🎯 Raycasting');
const rayP = { enabled: false };
rayF.add(rayP, 'enabled').name('Enable Raycasting').onChange(v => {
  enableRaycast = v;
  if (!v) laserLine.visible = false;
});

// ── MESH TYPES DEMO ───────────────────────────────────────────────
const meshDemo = { type: 'Mesh' };
const meshDemoF = gui.addFolder('🧩 Mesh Types Demo');
meshDemoF.add(meshDemo, 'type', ['Mesh', 'Instanced', 'Points', 'Line', 'Sprite', 'Group'])
  .name('Demo Type').onChange(updateMeshDemo);

// ── CONTROL MODE ──────────────────────────────────────────────────
const ctrlModeF = gui.addFolder('🕹 Control Mode');
const ctrlState = { mode: 'Orbit' };
ctrlModeF.add(ctrlState, 'mode', ['Orbit', 'Fly', 'FirstPerson', 'PointerLock'])
  .name('Type').onChange(v => switchControls(v));

// ── SCENE ─────────────────────────────────────────────────────────
const scF = gui.addFolder('🌍  Scene');
const scP = {
  bgColor: '#080814', fog: false, fogColor: '#080814', fogNear: 8, fogFar: 60,
  showGrid: true, showAxes: true, shadowMapType: 'PCFSoft', exposure: 1.0,
};
scF.addColor(scP, 'bgColor').name('Background').onChange(v => scene.background.set(v));
scF.add(scP, 'fog').name('Enable Fog').onChange(v => {
  scene.fog = v ? new THREE.Fog(new THREE.Color(scP.fogColor), scP.fogNear, scP.fogFar) : null;
});
scF.addColor(scP, 'fogColor').name('Fog Color').onChange(v => { if (scene.fog) scene.fog.color.set(v); });
scF.add(scP, 'fogNear', 0.5, 30).name('Fog Near').onChange(v => { if (scene.fog) scene.fog.near = v; });
scF.add(scP, 'fogFar', 5, 200).name('Fog Far').onChange(v => { if (scene.fog) scene.fog.far = v; });
scF.add(scP, 'showGrid').name('Show Grid').onChange(v => gridHelper.visible = v);
scF.add(scP, 'showAxes').name('Show Axes').onChange(v => axesHelper.visible = v);
scF.add(scP, 'shadowMapType', ['None', 'Basic', 'PCF', 'PCFSoft', 'VSM']).name('Shadow Quality').onChange(v => {
  const t = { None: null, Basic: THREE.BasicShadowMap, PCF: THREE.PCFShadowMap, PCFSoft: THREE.PCFSoftShadowMap, VSM: THREE.VSMShadowMap };
  renderer.shadowMap.enabled = t[v] !== null;
  if (t[v] !== null) renderer.shadowMap.type = t[v];
  renderer.shadowMap.needsUpdate = true;
});
scF.add(scP, 'exposure', 0, 3, 0.01).name('Exposure').onChange(v => renderer.toneMappingExposure = v);
scF.close();

// ── CAMERA ────────────────────────────────────────────────────────
const camF = gui.addFolder('📷  Camera');
camF.add(camP, 'type', ['Perspective', 'Orthographic']).name('Camera Type').onChange(v => {
  const oldPos = activeCamera.position.clone();
  const oldTarget = (controls.target || new THREE.Vector3()).clone();
  controls.dispose();
  activeCamera = v === 'Perspective' ? perspCam : orthoCam;
  activeCamera.position.copy(oldPos);
  controls = new OrbitControls(activeCamera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = orbitP.dampingFactor;
  controls.target.copy(oldTarget);
  controlMode = 'Orbit';
  applyOrbit();
});
camF.add(camP, 'fov', 10, 150, 1).name('FOV  (Perspective)').onChange(v => {
  perspCam.fov = v; perspCam.updateProjectionMatrix();
});
camF.add(camP, 'near', 0.01, 10, 0.01).name('Near Clip').onChange(v => {
  activeCamera.near = v; activeCamera.updateProjectionMatrix();
});
camF.add(camP, 'far', 10, 2000, 10).name('Far Clip').onChange(v => {
  activeCamera.far = v; activeCamera.updateProjectionMatrix();
});
const camOrthoF = camF.addFolder('Ortho Size');
camOrthoF.add(camP, 'orthoSize', 1, 30, 0.5).name('Ortho Size').onChange(v => {
  const a = W / H;
  orthoCam.left = -v * a; orthoCam.right = v * a;
  orthoCam.top = v; orthoCam.bottom = -v;
  orthoCam.updateProjectionMatrix();
});
const camPosF = camF.addFolder('Position');
camPosF.add(camP, 'posX', -30, 30, 0.1).name('X').onChange(v => activeCamera.position.x = v);
camPosF.add(camP, 'posY', -20, 30, 0.1).name('Y').onChange(v => activeCamera.position.y = v);
camPosF.add(camP, 'posZ', -30, 30, 0.1).name('Z').onChange(v => activeCamera.position.z = v);
camPosF.add({
  reset() {
    activeCamera.position.set(5, 4, 7);
    camP.posX = 5; camP.posY = 4; camP.posZ = 7;
    camPosF.controllers.forEach(c => c.updateDisplay());
    if (controls.target) controls.target.set(0, 0, 0);
    controls.update();
  }
}, 'reset').name('↩  Reset Camera');
camF.close();

// ── ORBIT CONTROLS GUI ────────────────────────────────────────────
const orbitF = gui.addFolder('🎮  Orbit Controls');
orbitF.add(orbitP, 'enabled').name('Enabled').onChange(applyOrbit);
orbitF.add(orbitP, 'autoRotate').name('Auto Rotate').onChange(applyOrbit);
orbitF.add(orbitP, 'autoRotateSpeed', 0.1, 10, 0.1).name('Rotate Speed').onChange(applyOrbit);
orbitF.add(orbitP, 'enableDamping').name('Damping').onChange(applyOrbit);
orbitF.add(orbitP, 'dampingFactor', 0.01, 0.5, 0.01).name('Damping Factor').onChange(applyOrbit);
orbitF.add(orbitP, 'minDist', 0.5, 20, 0.5).name('Min Distance').onChange(applyOrbit);
orbitF.add(orbitP, 'maxDist', 5, 200, 1).name('Max Distance').onChange(applyOrbit);
orbitF.add(orbitP, 'minPolar', 0, 180, 1).name('Min Polar Angle°').onChange(applyOrbit);
orbitF.add(orbitP, 'maxPolar', 0, 180, 1).name('Max Polar Angle°').onChange(applyOrbit);
orbitF.add(orbitP, 'minAzimuth', -180, 180, 1).name('Min Azimuth°').onChange(applyOrbit);
orbitF.add(orbitP, 'maxAzimuth', -180, 180, 1).name('Max Azimuth°').onChange(applyOrbit);
orbitF.add(orbitP, 'enableZoom').name('Enable Zoom').onChange(applyOrbit);
orbitF.add(orbitP, 'enablePan').name('Enable Pan').onChange(applyOrbit);
orbitF.add(orbitP, 'zoomSpeed', 0.1, 5, 0.1).name('Zoom Speed').onChange(applyOrbit);
orbitF.close();

// ── LIGHTS ────────────────────────────────────────────────────────
const lightsF = gui.addFolder('💡  Lights');

const ambF = lightsF.addFolder('Ambient  (no direction/shadow)');
const ambP = { on: true, color: '#ffffff', intensity: 0.4 };
ambF.add(ambP, 'on').name('Enabled').onChange(v => ambientLight.visible = v);
ambF.addColor(ambP, 'color').name('Color').onChange(v => ambientLight.color.set(v));
ambF.add(ambP, 'intensity', 0, 5, 0.05).name('Intensity').onChange(v => ambientLight.intensity = v);

const dirF = lightsF.addFolder('Directional  (parallel, like sun)');
const dirP = {
  on: true, color: '#ffffff', intensity: 1.8,
  px: 6, py: 10, pz: 6,
  castShadow: true, shadowRadius: 4, shadowBias: -0.001,
  showHelper: false, showShadowCam: false
};
dirF.add(dirP, 'on').name('Enabled').onChange(v => { dirLight.visible = v; dirHelper.visible = dirP.showHelper && v; });
dirF.addColor(dirP, 'color').name('Color').onChange(v => { dirLight.color.set(v); dirHelper.update(); });
dirF.add(dirP, 'intensity', 0, 15, 0.1).name('Intensity').onChange(v => dirLight.intensity = v);
const dirPosF = dirF.addFolder('Position');
dirPosF.add(dirP, 'px', -20, 20, 0.1).name('X').onChange(v => { dirLight.position.x = v; dirHelper.update(); });
dirPosF.add(dirP, 'py', 0, 30, 0.1).name('Y').onChange(v => { dirLight.position.y = v; dirHelper.update(); });
dirPosF.add(dirP, 'pz', -20, 20, 0.1).name('Z').onChange(v => { dirLight.position.z = v; dirHelper.update(); });
const dirShadF = dirF.addFolder('Shadows');
dirShadF.add(dirP, 'castShadow').name('Cast Shadow').onChange(v => dirLight.castShadow = v);
dirShadF.add(dirP, 'shadowRadius', 1, 20, 0.5).name('Softness').onChange(v => dirLight.shadow.radius = v);
dirShadF.add(dirP, 'shadowBias', -0.05, 0.05, 0.001).name('Bias').onChange(v => dirLight.shadow.bias = v);
dirF.add(dirP, 'showHelper').name('Show Helper').onChange(v => dirHelper.visible = v && dirP.on);
dirF.add(dirP, 'showShadowCam').name('Show Shadow Cam').onChange(v => dirShadowHelper.visible = v && dirP.on);

const ptF = lightsF.addFolder('Point  (omnidirectional, like bulb)');
const ptP = { on: false, color: '#ff6b6b', intensity: 8, px: -4, py: 3, pz: 2, distance: 15, decay: 2, castShadow: true, showHelper: false };
ptF.add(ptP, 'on').name('Enabled').onChange(v => { pointLight.visible = v; pointHelper.visible = ptP.showHelper && v; });
ptF.addColor(ptP, 'color').name('Color').onChange(v => { pointLight.color.set(v); pointHelper.update(); });
ptF.add(ptP, 'intensity', 0, 60, 0.5).name('Intensity').onChange(v => pointLight.intensity = v);
const ptPosF = ptF.addFolder('Position');
ptPosF.add(ptP, 'px', -15, 15, 0.1).name('X').onChange(v => { pointLight.position.x = v; pointHelper.update(); });
ptPosF.add(ptP, 'py', -10, 15, 0.1).name('Y').onChange(v => { pointLight.position.y = v; pointHelper.update(); });
ptPosF.add(ptP, 'pz', -15, 15, 0.1).name('Z').onChange(v => { pointLight.position.z = v; pointHelper.update(); });
ptF.add(ptP, 'distance', 0, 60, 0.5).name('Max Distance').onChange(v => pointLight.distance = v);
ptF.add(ptP, 'decay', 0, 5, 0.1).name('Decay (falloff)').onChange(v => pointLight.decay = v);
ptF.add(ptP, 'castShadow').name('Cast Shadow').onChange(v => pointLight.castShadow = v);
ptF.add(ptP, 'showHelper').name('Show Helper').onChange(v => pointHelper.visible = v && ptP.on);

const spF = lightsF.addFolder('Spot  (cone beam, like flashlight)');
const spP = { on: false, color: '#5ee7df', intensity: 20, px: 0, py: 9, pz: 0, angle: 25, penumbra: 0.25, distance: 22, decay: 2, castShadow: true, showHelper: false };
spF.add(spP, 'on').name('Enabled').onChange(v => { spotLight.visible = v; spotHelper.visible = spP.showHelper && v; });
spF.addColor(spP, 'color').name('Color').onChange(v => { spotLight.color.set(v); spotHelper.update(); });
spF.add(spP, 'intensity', 0, 100, 0.5).name('Intensity').onChange(v => spotLight.intensity = v);
const spPosF = spF.addFolder('Position');
spPosF.add(spP, 'px', -15, 15, 0.1).name('X').onChange(v => { spotLight.position.x = v; spotHelper.update(); });
spPosF.add(spP, 'py', 0, 20, 0.1).name('Y').onChange(v => { spotLight.position.y = v; spotHelper.update(); });
spPosF.add(spP, 'pz', -15, 15, 0.1).name('Z').onChange(v => { spotLight.position.z = v; spotHelper.update(); });
spF.add(spP, 'angle', 1, 89, 1).name('Cone Angle°').onChange(v => { spotLight.angle = THREE.MathUtils.degToRad(v); spotHelper.update(); });
spF.add(spP, 'penumbra', 0, 1, 0.01).name('Penumbra (soft edge)').onChange(v => { spotLight.penumbra = v; spotHelper.update(); });
spF.add(spP, 'distance', 0, 60, 0.5).name('Max Distance').onChange(v => spotLight.distance = v);
spF.add(spP, 'decay', 0, 5, 0.1).name('Decay').onChange(v => spotLight.decay = v);
spF.add(spP, 'castShadow').name('Cast Shadow').onChange(v => spotLight.castShadow = v);
spF.add(spP, 'showHelper').name('Show Helper').onChange(v => spotHelper.visible = v && spP.on);

const hemiF = lightsF.addFolder('Hemisphere  (sky/ground gradient)');
const hemiP = { on: false, skyColor: '#87ceeb', groundColor: '#5c4033', intensity: 1.2, showHelper: false };
hemiF.add(hemiP, 'on').name('Enabled').onChange(v => { hemiLight.visible = v; hemiHelper.visible = hemiP.showHelper && v; });
hemiF.addColor(hemiP, 'skyColor').name('Sky Color').onChange(v => hemiLight.color.set(v));
hemiF.addColor(hemiP, 'groundColor').name('Ground Color').onChange(v => hemiLight.groundColor.set(v));
hemiF.add(hemiP, 'intensity', 0, 5, 0.05).name('Intensity').onChange(v => hemiLight.intensity = v);
hemiF.add(hemiP, 'showHelper').name('Show Helper').onChange(v => hemiHelper.visible = v && hemiP.on);
lightsF.close();

// ── OBJECT 1 ──────────────────────────────────────────────────────
const obj1F = gui.addFolder('📦  Object 1  (Main Mesh)');

const geoF = obj1F.addFolder('Geometry Shape');
geoF.add(M1, 'shape', ['Box', 'Sphere', 'Cylinder', 'Cone', 'Torus', 'TorusKnot', 'Octahedron', 'Icosahedron', 'Tetrahedron', 'Dodecahedron'])
  .name('Type').onChange(rebuildMesh1Geo);

const matF = obj1F.addFolder('Material');
// FIX: materialType change does a full rebuild so the new material type
// gets all current M1 values (roughness, metalness, etc.) baked in
matF.add(M1, 'materialType', ['Basic', 'Normal', 'Depth', 'Lambert', 'Phong', 'Standard', 'Physical', 'Toon'])
  .name('Shader Type').onChange(() => rebuildMesh1Mat());
matF.addColor(M1, 'color').name('Color').onChange(v => applyMesh1Prop('color', v));
matF.addColor(M1, 'emissive').name('Emissive (glow)').onChange(v => applyMesh1Prop('emissive', v));
matF.add(M1, 'roughness', 0, 1, 0.01).name('Roughness').onChange(v => applyMesh1Prop('roughness', v));
matF.add(M1, 'metalness', 0, 1, 0.01).name('Metalness').onChange(v => applyMesh1Prop('metalness', v));
matF.add(M1, 'shininess', 0, 300, 1).name('Shininess (Phong)').onChange(v => applyMesh1Prop('shininess', v));
matF.add(M1, 'clearcoat', 0, 1, 0.01).name('Clearcoat (Physical)').onChange(v => applyMesh1Prop('clearcoat', v));
matF.add(M1, 'wireframe').name('Wireframe').onChange(v => applyMesh1Prop('wireframe', v));
matF.add(M1, 'flatShading').name('Flat Shading').onChange(v => applyMesh1Prop('flatShading', v));
matF.add(M1, 'transparent').name('Transparent').onChange(v => applyMesh1Prop('transparent', v));
matF.add(M1, 'opacity', 0, 1, 0.01).name('Opacity').onChange(v => applyMesh1Prop('opacity', v));
matF.add(M1, 'side', ['Front', 'Back', 'Double']).name('Visible Side').onChange(v => applyMesh1Prop('side', v));
const texF1 = matF.addFolder('🗺 Texture');

texF1.add(M1, 'textureMap', TEX_TYPES)
  .name('Map')
  .onChange(v => applyMesh1Prop('textureMap', v));

texF1.add(M1, 'textureRepeat', 0.1, 16, 0.1)
  .name('Repeat (UV tiling)')
  .onChange(v => applyMesh1Prop('textureRepeat', v));

texF1.open();

const trsF = obj1F.addFolder('Transform');
const posF1 = trsF.addFolder('📍  Position');
posF1.add(M1, 'posX', -12, 12, 0.1).name('X').onChange(v => mesh1.position.x = v);
posF1.add(M1, 'posY', -6, 12, 0.1).name('Y').onChange(v => mesh1.position.y = v);
posF1.add(M1, 'posZ', -12, 12, 0.1).name('Z').onChange(v => mesh1.position.z = v);
const rotF1 = trsF.addFolder('🔄  Rotation  (degrees)');
rotF1.add(M1, 'rotX', -180, 180, 1).name('X').onChange(v => mesh1.rotation.x = THREE.MathUtils.degToRad(v));
rotF1.add(M1, 'rotY', -180, 180, 1).name('Y').onChange(v => mesh1.rotation.y = THREE.MathUtils.degToRad(v));
rotF1.add(M1, 'rotZ', -180, 180, 1).name('Z').onChange(v => mesh1.rotation.z = THREE.MathUtils.degToRad(v));
const scaleF1 = trsF.addFolder('📏  Scale');
scaleF1.add(M1, 'scaleX', 0.05, 6, 0.05).name('X').onChange(v => mesh1.scale.x = v);
scaleF1.add(M1, 'scaleY', 0.05, 6, 0.05).name('Y').onChange(v => mesh1.scale.y = v);
scaleF1.add(M1, 'scaleZ', 0.05, 6, 0.05).name('Z').onChange(v => mesh1.scale.z = v);
scaleF1.add(M1, 'uniformScale', 0.05, 6, 0.05).name('Uniform').onChange(v => {
  mesh1.scale.setScalar(v);
  M1.scaleX = M1.scaleY = M1.scaleZ = v;
  scaleF1.controllers.slice(0, 3).forEach(c => c.updateDisplay());
});
trsF.add({
  reset() {
    M1.posX = 0; M1.posY = 0; M1.posZ = 0;
    M1.rotX = 0; M1.rotY = 0; M1.rotZ = 0;
    M1.scaleX = 1; M1.scaleY = 1; M1.scaleZ = 1; M1.uniformScale = 1;
    mesh1.position.set(0, 0, 0); mesh1.rotation.set(0, 0, 0); mesh1.scale.set(1, 1, 1);
    posF1.controllers.forEach(c => c.updateDisplay());
    rotF1.controllers.forEach(c => c.updateDisplay());
    scaleF1.controllers.forEach(c => c.updateDisplay());
  }
}, 'reset').name('↩  Reset Transform');

const shadF1 = obj1F.addFolder('🌒  Shadows');
shadF1.add(M1, 'castShadow').name('Cast Shadow').onChange(v => mesh1.castShadow = v);
shadF1.add(M1, 'receiveShadow').name('Receive Shadow').onChange(v => mesh1.receiveShadow = v);

const animF1 = obj1F.addFolder('🔁  Auto Spin');
animF1.add(M1, 'spinX').name('Spin X');
animF1.add(M1, 'spinY').name('Spin Y');
animF1.add(M1, 'spinZ').name('Spin Z');
animF1.add(M1, 'spinSpeed', 0.1, 5, 0.1).name('Speed');
animF1.add({
  resetSpin() {
    // stop spin
    M1.spinX = false;
    M1.spinY = false;
    M1.spinZ = false;
    M1.spinSpeed = 0.5;

    // 🔥 IMPORTANT: reset rotation
    M1.rotX = 0;
    M1.rotY = 0;
    M1.rotZ = 0;

    mesh1.rotation.set(0, 0, 0);

    animF1.controllers.forEach(c => c.updateDisplay());
  }
}, 'resetSpin').name('⛔ Reset Spin');

// ── ADD OBJECTS ───────────────────────────────────────────────────
const addF = gui.addFolder('➕  Add Object to Scene');
addF.add(addState, 'shape', ['Box', 'Sphere', 'Cylinder', 'Cone', 'Torus', 'TorusKnot', 'Octahedron', 'Icosahedron', 'Tetrahedron']).name('Shape');
addF.addColor(addState, 'color').name('Color');
addPosXCtrl = addF.add(addState, 'posX', -12, 12, 0.1).name('Position X');
addF.add(addState, 'posY', -6, 12, 0.1).name('Position Y');
addF.add(addState, 'posZ', -12, 12, 0.1).name('Position Z');
addLabelCtrl = addF.add(addState, 'label').name('Label');
addF.add({ add: addExtraMesh }, 'add').name('➕  Add to Scene');

// ── EXTRA OBJECTS LIST ────────────────────────────────────────────
const extraListF = gui.addFolder('🗂  Additional Objects');
extraListF.close();

function rebuildExtraFolder() {
  if (extraFolder) { try { extraFolder.destroy(); } catch (e) { } extraFolder = null; }
  if (extraSelectedFolder) { try { extraSelectedFolder.destroy(); } catch (e) { } extraSelectedFolder = null; }
  if (extraMeshes.length === 0) return;
  const names = extraMeshes.map(m => m.userData.label);
  const sel = { selected: names[names.length - 1] };
  extraFolder = extraListF.addFolder('Select Object');
  extraFolder.add(sel, 'selected', names).name('Object').onChange(name => {
    if (extraSelectedFolder) { try { extraSelectedFolder.destroy(); } catch (e) { } extraSelectedFolder = null; }
    buildExtraControls(name);
  });
  buildExtraControls(names[names.length - 1]);
  extraListF.open();
}

function buildExtraControls(name) {
  if (extraSelectedFolder) { try { extraSelectedFolder.destroy(); } catch (e) { } extraSelectedFolder = null; }
  const idx = extraMeshes.findIndex(m => m.userData.label === name);
  if (idx === -1) return;
  const m = extraMeshes[idx];
  extraSelectedFolder = extraListF.addFolder(`✏  ${name}`);
  const ep = {
    posX: m.position.x,
    posY: m.position.y,
    posZ: m.position.z,

    rotX: THREE.MathUtils.radToDeg(m.rotation.x),
    rotY: THREE.MathUtils.radToDeg(m.rotation.y),
    rotZ: THREE.MathUtils.radToDeg(m.rotation.z),

    scaleX: m.scale.x,
    scaleY: m.scale.y,
    scaleZ: m.scale.z,

    color: '#' + m.material.color.getHexString(),
    roughness: m.material.roughness ?? 0.5,
    metalness: m.material.metalness ?? 0.1,
    wireframe: m.material.wireframe ?? false,

    // ✅ ADD THESE
    textureMap: 'None',
    textureRepeat: 1,

    castShadow: m.castShadow,
    receiveShadow: m.receiveShadow,

    spinY: false,
    spinSpeed: 0.5,
  };
  m.userData.ep = ep;
  const ePosF = extraSelectedFolder.addFolder('📍  Position');
  ePosF.add(ep, 'posX', -12, 12, 0.1).name('X').onChange(v => m.position.x = v);
  ePosF.add(ep, 'posY', -6, 12, 0.1).name('Y').onChange(v => m.position.y = v);
  ePosF.add(ep, 'posZ', -12, 12, 0.1).name('Z').onChange(v => m.position.z = v);
  const eRotF = extraSelectedFolder.addFolder('🔄  Rotation (°)');
  eRotF.add(ep, 'rotX', -180, 180, 1).name('X').onChange(v => m.rotation.x = THREE.MathUtils.degToRad(v));
  eRotF.add(ep, 'rotY', -180, 180, 1).name('Y').onChange(v => m.rotation.y = THREE.MathUtils.degToRad(v));
  eRotF.add(ep, 'rotZ', -180, 180, 1).name('Z').onChange(v => m.rotation.z = THREE.MathUtils.degToRad(v));
  const eScaleF = extraSelectedFolder.addFolder('📏  Scale');
  eScaleF.add(ep, 'scaleX', 0.05, 6, 0.05).name('X').onChange(v => m.scale.x = v);
  eScaleF.add(ep, 'scaleY', 0.05, 6, 0.05).name('Y').onChange(v => m.scale.y = v);
  eScaleF.add(ep, 'scaleZ', 0.05, 6, 0.05).name('Z').onChange(v => m.scale.z = v);
  const eMatF = extraSelectedFolder.addFolder('🎨  Material');
  eMatF.addColor(ep, 'color').name('Color').onChange(v => m.material.color.set(v));
  eMatF.add(ep, 'roughness', 0, 1, 0.01).name('Roughness').onChange(v => { if (m.material.roughness !== undefined) m.material.roughness = v; });
  eMatF.add(ep, 'metalness', 0, 1, 0.01).name('Metalness').onChange(v => { if (m.material.metalness !== undefined) m.material.metalness = v; });
  eMatF.add(ep, 'wireframe').name('Wireframe').onChange(v => m.material.wireframe = v);
  const eShadF = extraSelectedFolder.addFolder('🌒  Shadows');
  eShadF.add(ep, 'castShadow').name('Cast Shadow').onChange(v => m.castShadow = v);
  eShadF.add(ep, 'receiveShadow').name('Receive Shadow').onChange(v => m.receiveShadow = v);
  const eAnimF = extraSelectedFolder.addFolder('🔁  Spin');
  eAnimF.add(ep, 'spinY').name('Auto Spin Y');
  eAnimF.add(ep, 'spinSpeed', 0.1, 5, 0.1).name('Speed');
  extraSelectedFolder.add({
    remove() {
      scene.remove(m);
      m.geometry.dispose(); m.material.dispose();
      extraMeshes.splice(idx, 1);
      refreshCount();
      rebuildExtraFolder();
    }
  }, 'remove').name('🗑  Remove Object');
  eAnimF.add({
    resetSpin() {
      ep.spinY = false;
      ep.spinSpeed = 0.5;

      // reset rotation
      ep.rotY = 0;
      m.rotation.y = 0;

      eAnimF.controllers.forEach(c => c.updateDisplay());
    }
  }, 'resetSpin').name('⛔ Reset Spin');
  const eTexF = extraSelectedFolder.addFolder('🗺 Texture');

  eTexF.add(ep, 'textureMap', TEX_TYPES)
    .name('Map')
    .onChange(v => applyTexture(m.material, v, ep.textureRepeat));

  eTexF.add(ep, 'textureRepeat', 0.1, 16, 0.1)
    .name('Repeat')
    .onChange(v => {
      if (ep.textureMap !== 'None') {
        applyTexture(m.material, ep.textureMap, v);
      }
    });
}

// ── MESH DEMO ─────────────────────────────────────────────────────
function updateMeshDemo(type) {
  if (demoObject) {
    scene.remove(demoObject);
    demoObject = null;
  }
  mesh1.visible = (type === 'Mesh');

  switch (type) {
    case 'Mesh':
      // mesh1 is already visible
      break;

    case 'Instanced': {
      const count = 100;
      const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.5, metalness: 0.1 });
      const inst = new THREE.InstancedMesh(geo, mat, count);
      inst.castShadow = true;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        dummy.position.set(
          (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 6
        );
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      demoObject = inst;
      break;
    }

    case 'Points': {
      const ptsGeo = new THREE.BufferGeometry();
      const ptsCount = 800;
      const positions = new Float32Array(ptsCount * 3);
      for (let i = 0; i < ptsCount * 3; i++) positions[i] = (Math.random() - 0.5) * 6;
      ptsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      demoObject = new THREE.Points(ptsGeo, new THREE.PointsMaterial({ size: 0.06, color: 0xffffff, sizeAttenuation: true }));
      break;
    }

    case 'Line': {
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const t = (i / 60) * Math.PI * 4;
        pts.push(new THREE.Vector3(Math.cos(t) * 2, t * 0.2 - 2, Math.sin(t) * 2));
      }
      demoObject = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xff4444 })
      );
      break;
    }

    case 'Sprite': {
      const spriteMat = new THREE.SpriteMaterial({ color: 0x00ff88 });
      demoObject = new THREE.Sprite(spriteMat);
      demoObject.position.set(0, 1, 0);
      demoObject.scale.set(2, 2, 2);
      break;
    }

    case 'Group': {
      const group = new THREE.Group();
      const shapes = [
        { geo: new THREE.BoxGeometry(0.8, 0.8, 0.8), color: 0xff4444, x: -2 },
        { geo: new THREE.SphereGeometry(0.5, 32, 32), color: 0x4444ff, x: 0 },
        { geo: new THREE.ConeGeometry(0.5, 1, 32), color: 0x44ff44, x: 2 },
      ];
      shapes.forEach(s => {
        const m = new THREE.Mesh(s.geo, new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.5, metalness: 0.1 }));
        m.position.x = s.x;
        m.castShadow = true;
        group.add(m);
      });
      demoObject = group;
      break;
    }
  }

  if (demoObject) scene.add(demoObject);
}

// ── GUIDE ─────────────────────────────────────────────────────────
function updateGuide(type) {
  const content = document.getElementById('guide-content');
  const title = document.getElementById('guide-title');
  if (!content || !title) return;

  switch (type) {
    case 'Orbit':
      title.innerText = '🎮 ORBIT';
      content.innerHTML = 'LEFT DRAG → Rotate<br>SCROLL → Zoom<br>RIGHT DRAG → Pan';
      break;
    case 'Fly':
      title.innerText = '✈️ FLY';
      content.innerHTML = 'HOLD CLICK → Look<br>W/A/S/D → Move<br>Q/E → Roll';
      break;
    case 'FirstPerson':
      title.innerText = '🧍 FPS';
      content.innerHTML = 'W/A/S/D → Move<br>MOUSE → Look';
      break;
    case 'PointerLock':
      title.innerText = '🎯 POINTER LOCK';
      content.innerHTML = 'CLICK CANVAS → Lock cursor<br>MOUSE → Look<br>ESC → Unlock';
      break;
  }
}

// ── RESIZE ────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  W = window.innerWidth; H = window.innerHeight;
  aspect = W / H;
  perspCam.aspect = aspect;
  perspCam.updateProjectionMatrix();
  const os = camP.orthoSize;
  orthoCam.left = -os * aspect; orthoCam.right = os * aspect;
  orthoCam.top = os; orthoCam.bottom = -os;
  orthoCam.updateProjectionMatrix();
  renderer.setSize(W, H);
});

window.addEventListener('mousemove', (event) => {
  mouse.x = (event.clientX / W) * 2 - 1;
  mouse.y = -(event.clientY / H) * 2 + 1;
});

// FIX: click handler - only rotate if raycasting is enabled
window.addEventListener('click', (e) => {
  if (!enableRaycast) return;
  // Don't trigger on GUI clicks
  if (e.target.closest && e.target.closest('.lil-gui')) return;
  if (currentIntersect) {
    currentIntersect.object.rotation.y += Math.PI / 4;
  }
});

// ── ANIMATION LOOP ────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (M1.spinX) mesh1.rotation.x += dt * M1.spinSpeed;
  if (M1.spinY) mesh1.rotation.y += dt * M1.spinSpeed;
  if (M1.spinZ) mesh1.rotation.z += dt * M1.spinSpeed;

  extraMeshes.forEach(m => {
    const ep = m.userData.ep;
    if (ep && ep.spinY) m.rotation.y += dt * ep.spinSpeed;
  });

  camP.posX = +activeCamera.position.x.toFixed(2);
  camP.posY = +activeCamera.position.y.toFixed(2);
  camP.posZ = +activeCamera.position.z.toFixed(2);

  if (controls) {
    if (controlMode === 'Fly' || controlMode === 'FirstPerson') {
      controls.update(dt);
    } else if (controlMode === 'Orbit' && controls.update) {
      controls.update();
    }
  }

  if (spotHelper.visible) spotHelper.update();

  // ── RAYCASTING ──────────────────────────────────────────────────
  if (enableRaycast) {
    raycaster.setFromCamera(mouse, activeCamera);
    const objectsToTest = [mesh1, ...extraMeshes];
    if (demoObject) objectsToTest.push(demoObject);
    const intersects = raycaster.intersectObjects(objectsToTest, true);

    // FIX: reset previously highlighted object's scale before highlighting new one
    if (lastIntersectedObject) {
      lastIntersectedObject.scale.set(
        lastIntersectedObject.userData.baseScaleX ?? 1,
        lastIntersectedObject.userData.baseScaleY ?? 1,
        lastIntersectedObject.userData.baseScaleZ ?? 1
      );
    }

    const rayStart = activeCamera.position.clone();

    if (intersects.length > 0) {
      currentIntersect = intersects[0];
      const obj = currentIntersect.object;

      // Store original scale if not already stored
      if (obj.userData.baseScaleX === undefined) {
        obj.userData.baseScaleX = obj.scale.x;
        obj.userData.baseScaleY = obj.scale.y;
        obj.userData.baseScaleZ = obj.scale.z;
      }
      obj.scale.set(
        obj.userData.baseScaleX * 1.15,
        obj.userData.baseScaleY * 1.15,
        obj.userData.baseScaleZ * 1.15
      );
      lastIntersectedObject = obj;

      // FIX: correct laser endpoint
      laserGeometry.setFromPoints([rayStart, currentIntersect.point]);
    } else {
      currentIntersect = null;
      lastIntersectedObject = null;

      // FIX: correct laser endpoint when nothing is hit — project ray forward
      const rayEnd = rayStart.clone().add(
        raycaster.ray.direction.clone().multiplyScalar(30)
      );
      laserGeometry.setFromPoints([rayStart, rayEnd]);
    }

    laserLine.visible = true;
    laserGeometry.attributes.position.needsUpdate = true;
  } else {
    laserLine.visible = false;
    if (lastIntersectedObject) {
      lastIntersectedObject.scale.set(
        lastIntersectedObject.userData.baseScaleX ?? 1,
        lastIntersectedObject.userData.baseScaleY ?? 1,
        lastIntersectedObject.userData.baseScaleZ ?? 1
      );
      lastIntersectedObject = null;
    }
  }

  renderer.render(scene, activeCamera);
}

// ── INIT ──────────────────────────────────────────────────────────
updateMeshDemo('Mesh');
updateGuide('Orbit');
obj1F.open();
lightsF.open();
dirF.open();
animate();