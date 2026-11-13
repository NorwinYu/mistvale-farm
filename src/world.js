import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  groundHeight, fbm, smoothstep, clamp, lerp, damp, mulberry32,
  TAU, makeCanvas, canvasTexture, roundedRectShape,
} from './utils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/* Add a coloured primitive to a list that will be merged later. */
function part(parts, geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m4.compose(V(x, y, z), _q, V(sx, sy, sz));
  g.applyMatrix4(_m4);
  const col = new THREE.Color(color);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  parts.push(g);
  return g;
}

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

function boxMesh(w, h, d, mat, x, y, z, cast = true) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), mat, cast, true);
  m.position.set(x, y, z);
  return m;
}

function standardMat(opts) { return new THREE.MeshStandardMaterial(opts); }

/* ================================================================== */
/*  FarmWorld                                                          */
/* ================================================================== */
export class FarmWorld {
  constructor(scene, renderer, tex) {
    this.scene = scene;
    this.renderer = renderer;
    this.tex = tex;
    this.obstacles = [];
    this.interactables = [];
    this.plots = [];
    this.chickens = [];
    this.butterflies = [];
    this.lampLights = [];
    this.windowMats = [];
    this.windyMats = [];
    this.cloudSprites = [];
    this._elapsed = 0;

    this.rand = mulberry32(3921);
    this._makeMaterials();
    this._makeSky();
    this._makeTerrain();
    this._makePond();
    this._makePaths();
    this._makeField();
    this._makeHouse();
    this._makeBarn();
    this._makeShop();
    this._makeWellAndBin();
    this._makeProps();
    this._makeVegetation();
    this._makeAnimals();
    this._makeAtmosphere();
    this._makeMoonAndStars();
    this._mergeStaticMeshes();
    this.setEnvironment(17.75, 'sunny', true);
    this._preparePlots();
  }

  /* ---------------------------------------------------------------- */
  /*  Bake the many little static props into a handful of draw calls.    */
  /*  Anything that animates (birds, cows, the shopkeeper, particles) is
      excluded. This is a large win on laptop GPUs.                       */
  _mergeStaticMeshes() {
    const dynamicRoots = [
      this.dog, this.cow, this.shopkeeper, this.moonGroup,
      ...this.chickens, ...this.birds, ...this.butterflies,
    ];
    for (const root of dynamicRoots) {
      if (!root) continue;
      root.traverse((o) => { o.userData.noMerge = true; });
    }
    this.scene.updateMatrixWorld(true);
    const buckets = new Map();
    const candidates = [];
    this.scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
      if (o.isSprite || o.isPoints || o.isLine) return;
      if (o.userData.noMerge) return;
      let p = o.parent;
      while (p) { if (p.userData.noMerge) return; p = p.parent; }
      const mat = o.material;
      if (!mat || Array.isArray(mat) || mat.isShaderMaterial || mat.transparent) return;
      if (!o.geometry || o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) return;
      if (o.children.length) return;
      const attrs = Object.keys(o.geometry.attributes).sort().join(',');
      if (!attrs.includes('position') || !attrs.includes('normal')) return;
      const key = `${mat.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}|${o.renderOrder}|${attrs}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
    });

    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geometries = [];
      let failed = false;
      for (const o of list) {
        try {
          let g = o.geometry.clone();
          if (g.index) g = g.toNonIndexed();
          g.applyMatrix4(o.matrixWorld);
          for (const name of Object.keys(g.attributes)) {
            if (!['position', 'normal', 'uv', 'color', 'tangent'].includes(name)) g.deleteAttribute(name);
          }
          g.clearGroups();
          geometries.push(g);
        } catch { failed = true; break; }
      }
      if (failed || !geometries.length) { geometries.forEach((g) => g.dispose()); continue; }
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((g) => g.dispose());
      if (!merged) continue;
      const sample = list[0];
      const m = new THREE.Mesh(merged, sample.material);
      m.castShadow = sample.castShadow;
      m.receiveShadow = sample.receiveShadow;
      m.renderOrder = sample.renderOrder;
      m.frustumCulled = true;
      this.scene.add(m);
      for (const o of list) o.removeFromParent();
    }
  }

  /* ---------------------------------------------------------------- */
  _makeMaterials() {
    const t = this.tex;
    this.m = {
      grass: standardMat({ map: t.grass, roughness: 0.97, metalness: 0, vertexColors: true }),
      soil: standardMat({ map: t.soil, roughness: 0.99 }),
      soilWet: standardMat({ map: t.soilWet, roughness: 0.78, color: 0xcfc2b5 }),
      dirt: standardMat({ map: t.dirt, roughness: 1 }),
      path: standardMat({ map: t.path, roughness: 1, color: 0xd9cdb9 }),
      woodWarm: standardMat({ map: t.woodWarm, roughness: 0.9 }),
      woodDark: standardMat({ map: t.woodDark, roughness: 0.9 }),
      woodPale: standardMat({ map: t.woodPale, roughness: 0.88 }),
      barn: standardMat({ map: t.barn, roughness: 0.92 }),
      fence: standardMat({ map: t.fence, roughness: 0.95 }),
      roof: standardMat({ map: t.roof, roughness: 0.94 }),
      plaster: standardMat({ map: t.plaster, roughness: 0.96, color: 0xefe8d8 }),
      stone: standardMat({ map: t.stone, roughness: 0.96 }),
      bark: standardMat({ map: t.bark, roughness: 1 }),
      awning: standardMat({ map: t.awning, roughness: 0.95, side: THREE.DoubleSide }),
      darkMetal: standardMat({ color: 0x2e3533, roughness: 0.55, metalness: 0.65 }),
      iron: standardMat({ color: 0x403d37, roughness: 0.55, metalness: 0.7 }),
      terracotta: standardMat({ color: 0x9d5c44, roughness: 0.9 }),
      rope: standardMat({ color: 0xbca37b, roughness: 1 }),
      hay: standardMat({ color: 0xc3a24e, roughness: 1 }),
      crop: standardMat({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
      leafDark: standardMat({ color: 0x2f452b, roughness: 0.9 }),
      leafMid: standardMat({ color: 0x455c31, roughness: 0.9 }),
      leafLight: standardMat({ color: 0x5d703c, roughness: 0.9 }),
      apple: standardMat({ color: 0x9d3428, roughness: 0.55 }),
      stoneLight: standardMat({ color: 0x8c887a, roughness: 0.95 }),
      water: null,
      highlight: new THREE.MeshBasicMaterial({ color: 0xffdf9f, transparent: true, opacity: 0.13, depthWrite: false, depthTest: true }),
      highlightLine: new THREE.LineBasicMaterial({ color: 0xffe9b6, transparent: true, opacity: 0.9, depthWrite: false }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x1d2d30, metalness: 0.35, roughness: 0.08, envMapIntensity: 1.2,
        emissive: 0xffae5b, emissiveIntensity: 0,
      }),
      fabric: standardMat({ color: 0xd8cfb8, roughness: 1, side: THREE.DoubleSide }),
    };
    this.m.glass.userData.isWindow = true;
    this.windowMats.push(this.m.glass);

    // Gentle wind sway for foliage. The shadow pass uses the default shader,
    // but the movement is subtle enough not to be noticeable.
    const sway = (strength, speed) => (mat) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 wPos = (instanceMatrix * vec4(transformed,1.0)).xyz;
          #else
            vec3 wPos = (modelMatrix * vec4(transformed,1.0)).xyz;
          #endif
          float swayAmt = smoothstep(0.2, 3.5, transformed.y) * ${strength.toFixed(3)};
          transformed.x += sin(uTime * ${speed.toFixed(2)} + wPos.x * 0.31 + wPos.z * 0.17) * swayAmt;
          transformed.z += cos(uTime * ${(speed * 0.73).toFixed(2)} + wPos.z * 0.27) * swayAmt * 0.65;`
        );
        mat.userData.shader = shader;
      };
    };
    sway(0.08, 0.8)(this.m.leafDark);
    sway(0.08, 0.8)(this.m.leafMid);
    sway(0.08, 0.8)(this.m.leafLight);
    this.windyMats.push(this.m.leafDark, this.m.leafMid, this.m.leafLight);
  }

  /* ---------------------------------------------------------------- */
  _makeSky() {
    const scene = this.scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    this.sky.material.uniforms.turbidity.value = 4.5;
    this.sky.material.uniforms.rayleigh.value = 1.65;
    this.sky.material.uniforms.mieCoefficient.value = 0.006;
    this.sky.material.uniforms.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    // soft image based environment for PBR micro-reflections
    const { canvas, ctx } = makeCanvas(512);
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#698db7');
    g.addColorStop(0.42, '#b9c9cf');
    g.addColorStop(0.57, '#e5cba6');
    g.addColorStop(0.72, '#7c8660');
    g.addColorStop(1, '#3f4633');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
    const env = new THREE.CanvasTexture(canvas);
    env.mapping = THREE.EquirectangularReflectionMapping;
    env.colorSpace = THREE.SRGBColorSpace;
    scene.environment = env;

    this.sunLight = new THREE.DirectionalLight(0xffd6a4, 3.6);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 180;
    this.sunLight.shadow.camera.left = -46;
    this.sunLight.shadow.camera.right = 46;
    this.sunLight.shadow.camera.top = 46;
    this.sunLight.shadow.camera.bottom = -46;
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.035;
    this.sunLight.target.position.set(1, 0, 2);
    scene.add(this.sunLight, this.sunLight.target);

    this.fillLight = new THREE.DirectionalLight(0x9eb8d8, 0.55);
    this.fillLight.position.set(-8, 12, 24);
    scene.add(this.fillLight);

    this.hemi = new THREE.HemisphereLight(0xbfd8eb, 0x50432d, 0.85);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(this.ambient);

    scene.fog = new THREE.FogExp2(0xc6d2cb, 0.0044);
    this.sunDir = new THREE.Vector3(0, 1, 0);

    // Soft cumulus billboards, tinted by the time of day.
    const cloud = this.tex.cloud;
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.SpriteMaterial({
        map: cloud, transparent: true, opacity: 0.38, depthWrite: false, fog: false,
        color: 0xffefd8,
      });
      const s = new THREE.Sprite(mat);
      const angle = -0.9 + this.rand() * 2.6;
      const radius = 130 + this.rand() * 150;
      s.position.set(Math.sin(angle) * radius, 48 + this.rand() * 52, Math.cos(angle) * radius * -0.9 - 40);
      const w = 70 + this.rand() * 100;
      s.scale.set(w, w * (0.32 + this.rand() * 0.18), 1);
      s.userData.baseX = s.position.x;
      s.userData.speed = 0.22 + this.rand() * 0.4;
      s.userData.baseOpacity = 0.32 + this.rand() * 0.36;
      scene.add(s);
      this.cloudSprites.push(s);
    }
    const heroClouds = [
      [[-58, 44, -112], [80, 24], 0.46],
      [[58, 56, -136], [122, 33], 0.4],
      [[102, 32, -88], [65, 19], 0.34],
      [[-118, 38, -55], [75, 21], 0.32],
    ];
    for (const [pos, size, op] of heroClouds) {
      const mat = new THREE.SpriteMaterial({
        map: this.tex.cloud, transparent: true, opacity: op, depthWrite: false,
        fog: false, color: 0xfff1de,
      });
      const s = new THREE.Sprite(mat);
      s.position.set(...pos);
      s.scale.set(size[0], size[1], 1);
      s.userData.baseX = pos[0];
      s.userData.speed = 0.16 + this.rand() * 0.2;
      s.userData.baseOpacity = op;
      scene.add(s);
      this.cloudSprites.push(s);
    }
  }

  _makeTerrain() {
    const size = 460, segs = 200;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const y = groundHeight(x, z);
      p.setY(i, y);
      const n = fbm(x * 0.05 + 5, z * 0.05 - 2, 3);
      const far = smoothstep(35, 120, Math.hypot(x, z));
      const high = smoothstep(8, 42, y);
      c.setRGB(
        (0.86 + n * 0.13 - far * 0.10) * (1 - high * 0.34),
        (0.92 + n * 0.08 - far * 0.04) * (1 - high * 0.28),
        (0.76 + n * 0.11 - far * 0.14) * (1 - high * 0.18) + high * 0.03
      );
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, this.m.grass);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
    this.terrain = terrain;
  }

  _makePaths() {
    const main = [
      [-10.3, -1.0], [-9.8, 1.4], [-8.2, 3.4], [-5.4, 5.0], [-2.0, 6.5],
      [1.6, 8.3], [5.0, 9.7], [7.5, 11.2], [8.1, 13.4], [10.8, 15.6],
      [14.5, 16.3], [18.4, 15.2], [21.4, 13.1], [23.0, 9.6], [24.2, 5.0], [24.8, 0.5],
    ];
    const branch = [[7.4, 10.9], [8.0, 9.1], [8.55, 7.35], [8.9, 6.5]];
    const shopPath = [[14.6, 16.1], [16.5, 14.3], [18.0, 12.8], [18.1, 11.2]];
    this.pathSamples = [];
    const addRibbon = (points, width, textureRepeat = 0.24) => {
      const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => V(x, 0, z)), false, 'catmullrom', 0.25);
      const count = Math.max(20, Math.floor(curve.getLength() * 4));
      const pts = curve.getSpacedPoints(count);
      const pos = [], uv = [], idx = [];
      let dist = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
        const tangent = new THREE.Vector3().subVectors(next, prev); tangent.y = 0; tangent.normalize();
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
        const w = width * (0.94 + Math.sin(i * 0.9) * 0.05);
        for (const side of [-1, 1]) {
          const px = p.x + normal.x * w * 0.5 * side;
          const pz = p.z + normal.z * w * 0.5 * side;
          pos.push(px, groundHeight(px, pz) + 0.027, pz);
          uv.push(side === -1 ? 0 : 1, dist * textureRepeat);
        }
        if (i > 0) {
          const a = (i - 1) * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        dist += i > 0 ? p.distanceTo(pts[i - 1]) : 0;
        if (i % 2 === 0) this.pathSamples.push([p.x, p.z]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = mesh(g, this.m.path, false, true);
      m.renderOrder = 1;
      this.scene.add(m);
    };
    addRibbon(main, 2.45, 0.22);
    addRibbon(branch, 1.75, 0.22);
    addRibbon(shopPath, 1.55, 0.22);

    // little worn stones through the mud
    const stoneGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.06, 7);
    for (let i = 0; i < 44; i++) {
      const p = this.pathSamples[(this.rand() * this.pathSamples.length) | 0];
      if (!p) continue;
      const s = mesh(stoneGeo, this.m.stoneLight, false, true);
      s.position.set(p[0] + (this.rand() - 0.5) * 1.5, 0.035, p[1] + (this.rand() - 0.5) * 1.2);
      s.rotation.y = this.rand() * TAU;
      s.scale.set(0.7 + this.rand(), 1, 0.55 + this.rand() * 0.7);
      this.scene.add(s);
    }
  }

  _makePond() {
    const cx = -27.0, cz = 4.5;
    this.pond = { x: cx, z: cz, rx: 8.7, rz: 6.6 };

    // Muddy bank, built from a noisy ellipse.
    const bankShape = new THREE.Shape();
    const bankPts = [];
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * TAU;
      const n = 1 + Math.sin(a * 3.1 + 1.2) * 0.05 + Math.sin(a * 7.3) * 0.035;
      bankPts.push(new THREE.Vector2(Math.cos(a) * 9.5 * n, Math.sin(a) * 7.4 * n));
    }
    bankShape.setFromPoints(bankPts);
    const bankGeo = new THREE.ShapeGeometry(bankShape, 1);
    bankGeo.rotateX(-Math.PI / 2);
    const bank = mesh(bankGeo, this.m.dirt, false, true);
    bank.position.set(cx, 0.018, cz);
    this.scene.add(bank);

    // Water surface with a custom, gently animated shader.
    const waterShape = new THREE.Shape();
    const wp = [];
    for (let i = 0; i <= 80; i++) {
      const a = i / 80 * TAU;
      const n = 1 + Math.sin(a * 2.4 + 3.1) * 0.055 + Math.sin(a * 6.1 - 0.4) * 0.028;
      wp.push(new THREE.Vector2(Math.cos(a) * 8.9 * n, Math.sin(a) * 6.7 * n));
    }
    waterShape.setFromPoints(wp);
    const wgeo = new THREE.ShapeGeometry(waterShape, 1);
    wgeo.rotateX(-Math.PI / 2);
    this.m.water = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSky: { value: new THREE.Color(0xb8cbd4) },
        uDeep: { value: new THREE.Color(0x2f4846) },
        uShallow: { value: new THREE.Color(0x6f8b7a) },
        uSun: { value: this.sunDir.clone() },
        uSunColor: { value: new THREE.Color(0xffd7a1) },
        uFogColor: { value: new THREE.Color(0xc6d2cb) },
        uFogDensity: { value: 0.0044 },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSky, uDeep, uShallow, uSun, uSunColor, uFogColor;
        uniform float uFogDensity;
        varying vec3 vWorld;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){
          vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
        }
        void main(){
          vec2 p = vWorld.xz;
          float t = uTime;
          float n1 = noise(p * 0.55 + vec2(t*0.12, t*0.045));
          float n2 = noise(p * 1.8 - vec2(t*0.08, -t*0.11));
          float n3 = noise(p * 4.2 + vec2(-t*0.16, t*0.06));
          vec3 nrm = normalize(vec3(
            (n1-0.5)*0.32 + (n2-0.5)*0.12,
            1.0,
            (n2-0.5)*0.30 + (n3-0.5)*0.10));
          vec3 view = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(view, nrm), 0.0), 2.6);
          vec3 base = mix(uDeep, uShallow, 0.35 + n1 * 0.3);
          vec3 col = mix(base, uSky, 0.26 + fres * 0.6);
          vec3 halfDir = normalize(view + normalize(uSun));
          float spec = pow(max(dot(nrm, halfDir), 0.0), 220.0);
          float sparkle = pow(max(dot(nrm, halfDir), 0.0), 60.0) * 0.16;
          col += uSunColor * (spec * 2.4 + sparkle);
          // hand-painted ripple lines
          float ripple = smoothstep(0.018, 0.0, abs(sin(p.x*1.4 + p.y*0.7 + n2*4.0 + t*0.4)*0.5 + (n1-0.5)*0.8));
          col += vec3(0.06,0.075,0.065) * ripple;
          float dist = length(cameraPosition - vWorld);
          float fog = 1.0 - exp(-uFogDensity*uFogDensity*dist*dist);
          col = mix(col, uFogColor, fog);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const water = new THREE.Mesh(wgeo, this.m.water);
    water.position.set(cx, 0.075, cz);
    water.receiveShadow = true;
    water.renderOrder = 0;
    this.scene.add(water);

    // Dock at the southern shore.
    const dock = new THREE.Group();
    dock.position.set(cx + 0.5, 0.14, cz + 7.9);
    for (let i = 0; i < 8; i++) {
      const plank = boxMesh(2.1, 0.09, 0.34, this.m.woodWarm, 0, 0, -i * 0.38, true);
      plank.rotation.y = (this.rand() - 0.5) * 0.025;
      dock.add(plank);
    }
    for (const x of [-0.98, 0.98]) {
      for (const z of [0, -2.9]) {
        const post = boxMesh(0.15, 1.0, 0.15, this.m.woodDark, x, -0.4, z, true);
        dock.add(post);
      }
    }
    this.scene.add(dock);
    this.interactables.push({ id: 'dock', x: cx + 0.5, z: cz + 8.2, r: 2.2, label: '在码头坐一会儿', key: 'dock' });

    // Rowboat.
    const boat = new THREE.Group();
    boat.position.set(cx - 4.4, 0.12, cz - 1.6);
    boat.rotation.y = 0.75;
    const hull = mesh(new THREE.CapsuleGeometry(0.7, 2.5, 4, 10), this.m.woodDark, true, true);
    hull.rotation.z = Math.PI / 2; hull.scale.set(1, 1, 0.55); hull.position.y = 0.18;
    boat.add(hull);
    for (let i = 0; i < 3; i++) {
      boat.add(boxMesh(1.25, 0.055, 0.2, this.m.woodPale, 0, 0.47, -0.8 + i * 0.8, true));
    }
    const oar = boxMesh(0.06, 0.04, 2.9, this.m.woodWarm, 0.2, 0.56, 0.1);
    oar.rotation.y = 0.25; boat.add(oar);
    this.scene.add(boat);

    // Lily pads and a few water flowers.
    const padGeo = new THREE.CircleGeometry(0.28, 12, 0.28, TAU - 0.5);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = standardMat({ color: 0x4c6b3b, roughness: 0.7, side: THREE.DoubleSide });
    for (let i = 0; i < 18; i++) {
      const a = this.rand() * TAU, r = 1 + this.rand() * 5.8;
      const pad = mesh(padGeo, padMat, false, false);
      pad.position.set(cx + Math.cos(a) * r * 1.15, 0.10, cz + Math.sin(a) * r * 0.8);
      pad.rotation.y = this.rand() * TAU;
      pad.scale.setScalar(0.6 + this.rand() * 1.1);
      this.scene.add(pad);
      if (i % 6 === 0) {
        const flower = mesh(new THREE.SphereGeometry(0.09, 6, 4), standardMat({ color: 0xe7c8c8, roughness: 0.8 }), false, false);
        flower.position.copy(pad.position).add(V(0.04, 0.06, 0));
        flower.scale.y = 0.45;
        this.scene.add(flower);
      }
    }

    // Reeds, pebbles, bankside planting.
    const reedParts = [];
    const reedRand = mulberry32(55);
    for (let i = 0; i < 190; i++) {
      const a = reedRand() * TAU;
      if (reedRand() > 0.26) continue;
      const rr = 1 + reedRand() * 0.04;
      const px = Math.cos(a) * 8.9 * rr, pz = Math.sin(a) * 6.7 * rr;
      const h = 0.6 + reedRand() * 0.9;
      part(reedParts, new THREE.PlaneGeometry(0.035, h), '#657848', px, h / 2, pz, 0, reedRand() * TAU, 0.12, 1, 1, 1);
      if (reedRand() > 0.6) {
        part(reedParts, new THREE.CylinderGeometry(0.022, 0.032, 0.16, 5), '#745c3d', px, h + 0.07, pz);
      }
    }
    const reedGeo = mergeGeometries(reedParts, false);
    if (reedGeo) {
      const reeds = mesh(reedGeo, this.m.crop, false, true);
      reeds.position.set(cx, 0.07, cz);
      this.scene.add(reeds);
    }
    const pebble = new THREE.DodecahedronGeometry(0.2, 0);
    for (let i = 0; i < 34; i++) {
      const a = this.rand() * TAU;
      const rock = mesh(pebble, this.m.stone, false, true);
      rock.position.set(cx + Math.cos(a) * (9.2 + this.rand() * 1.2), 0.02, cz + Math.sin(a) * (7.1 + this.rand() * 0.8));
      rock.rotation.set(this.rand() * 3, this.rand() * 3, this.rand() * 3);
      rock.scale.set(0.7 + this.rand() * 1.6, 0.45 + this.rand() * 0.7, 0.8 + this.rand() * 1.4);
      this.scene.add(rock);
    }
    this.addObstacleEllipse(cx, cz, 9.4, 6.9);
  }

  addObstacleBox(cx, cz, hx, hz) {
    this.obstacles.push({ type: 'box', cx, cz, hx, hz });
  }
  addObstacleCircle(x, z, r) {
    this.obstacles.push({ type: 'circle', x, z, r });
  }
  addObstacleEllipse(x, z, rx, rz) {
    this.obstacles.push({ type: 'ellipse', x, z, rx, rz });
  }

  collides(x, z, radius = 0.36) {
    for (const o of this.obstacles) {
      if (o.type === 'box') {
        if (x > o.cx - o.hx - radius && x < o.cx + o.hx + radius &&
            z > o.cz - o.hz - radius && z < o.cz + o.hz + radius) return true;
      } else if (o.type === 'circle') {
        if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + radius) ** 2) return true;
      } else {
        const dx = (x - o.x) / (o.rx + radius), dz = (z - o.z) / (o.rz + radius);
        if (dx * dx + dz * dz < 1) return true;
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  _makeField() {
    const cx = 9.0, cz = 2.4;
    this.field = { cx, cz, cols: 6, rows: 4, pitch: 1.82, tile: 1.66, x0: 3.25, x1: 14.75, z0: -1.4, z1: 6.2 };

    const base = mesh(new THREE.BoxGeometry(11.45, 0.08, 7.5), this.m.dirt, false, true);
    base.position.set(cx, 0.01, cz);
    this.scene.add(base);

    // Weathered edging boards around the plot.
    const edge = this.m.woodDark;
    this.scene.add(boxMesh(11.7, 0.16, 0.16, edge, cx, 0.1, cz - 3.78, false));
    this.scene.add(boxMesh(11.7, 0.16, 0.16, edge, cx, 0.1, cz + 3.78, false));
    this.scene.add(boxMesh(0.16, 0.16, 7.7, edge, cx - 5.78, 0.1, cz, false));
    this.scene.add(boxMesh(0.16, 0.16, 7.7, edge, cx + 5.78, 0.1, cz, false));

    // Fence. Southern fence leaves a generous gate at the path.
    const x0 = this.field.x0, x1 = this.field.x1, z0 = this.field.z0, z1 = this.field.z1;
    const posts = [], railParts = [];
    const postGeo = new THREE.BoxGeometry(0.15, 1.08, 0.15);
    const railGeo = new THREE.BoxGeometry(1, 0.075, 0.075);
    const addPost = (x, z) => part(posts, postGeo, '#ffffff', x, 0.54, z);
    const addRail = (x1, z1, x2, z2, y) => {
      const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
      part(railParts, railGeo, '#ffffff', (x1 + x2) / 2, y, (z1 + z2) / 2, 0, Math.atan2(-dz, dx), 0, len, 1, 1);
    };
    const fenceWithGap = (ax, az, bx, bz, gapStart, gapEnd) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.round(len / 1.8));
      const points = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = lerp(ax, bx, t), z = lerp(az, bz, t);
        if (gapStart !== undefined) {
          const coord = Math.abs(bx - ax) > 0.01 ? x : z;
          if (coord > gapStart && coord < gapEnd) { points.push(null); continue; }
        }
        addPost(x, z);
        points.push([x, z]);
      }
      for (let i = 1; i < points.length; i++) {
        if (points[i - 1] && points[i]) {
          addRail(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], 0.42);
          addRail(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], 0.82);
        }
      }
    };
    fenceWithGap(x0, z0, x1, z0);
    fenceWithGap(x0, z1, x1, z1, 8.05, 9.95);
    fenceWithGap(x0, z0, x0, z1);
    fenceWithGap(x1, z0, x1, z1);
    const postMesh = mesh(mergeGeometries(posts, false), this.m.fence, true, true);
    const railMesh = mesh(mergeGeometries(railParts, false), this.m.fence, true, true);
    this.scene.add(postMesh, railMesh);

    // Fence collision, with an open southern gate.
    this.addObstacleBox(cx, z0, (x1 - x0) / 2, 0.12);
    this.addObstacleBox(cx, z1, (8.05 - x0) / 2, 0.12);
    this.addObstacleBox((9.95 + x1) / 2, z1, (x1 - 9.95) / 2, 0.12);
    this.addObstacleBox(x0, cz, 0.12, (z1 - z0) / 2);
    this.addObstacleBox(x1, cz, 0.12, (z1 - z0) / 2);

    // Gate leaf, propped open against the fence.
    const gate = new THREE.Group();
    gate.position.set(8.08, 0, z1 + 0.12);
    const gateFrame = boxMesh(1.55, 0.1, 0.1, this.m.fence, 0.78, 0.82, 0, true);
    gate.add(gateFrame);
    for (let i = 0; i < 5; i++) {
      gate.add(boxMesh(0.09, 0.72, 0.065, this.m.fence, 0.12 + i * 0.34, 0.45, 0, true));
    }
    const gateDiag = boxMesh(1.55, 0.07, 0.07, this.m.fence, 0.78, 0.45, 0, true);
    gateDiag.rotation.z = 0.32; gate.add(gateDiag);
    gate.rotation.y = -1.18;
    this.scene.add(gate);

    // A friendly scarecrow, just outside the east fence.
    const scare = new THREE.Group();
    scare.position.set(16.2, 0, 2.6);
    scare.rotation.y = -0.4;
    const post = boxMesh(0.17, 2.35, 0.17, this.m.woodDark, 0, 1.1, 0, true);
    scare.add(post);
    const cross = boxMesh(1.75, 0.12, 0.12, this.m.woodDark, 0, 1.75, 0, true);
    scare.add(cross);
    const shirt = mesh(new THREE.CylinderGeometry(0.33, 0.42, 0.78, 7, 1, true), standardMat({ color: 0x6b7862, roughness: 1, side: THREE.DoubleSide }), true);
    shirt.position.y = 1.55; shirt.rotation.z = 0.03; scare.add(shirt);
    for (const side of [-1, 1]) {
      const sleeve = mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.68, 6), standardMat({ color: 0x6b7862, roughness: 1 }), true);
      sleeve.position.set(side * 0.72, 1.75, 0); sleeve.rotation.z = side * 1.27; scare.add(sleeve);
      const hand = mesh(new THREE.SphereGeometry(0.1, 6, 5), this.m.hay, true);
      hand.position.set(side * 1.03, 1.73, 0); scare.add(hand);
    }
    const head = mesh(new THREE.SphereGeometry(0.27, 10, 8), this.m.fabric, true);
    head.position.y = 2.15; head.scale.set(0.92, 1.1, 0.9); scare.add(head);
    const hatBrim = mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.06, 12), this.m.hay, true);
    hatBrim.position.y = 2.39; scare.add(hatBrim);
    const hatTop = mesh(new THREE.ConeGeometry(0.3, 0.35, 10), this.m.hay, true);
    hatTop.position.y = 2.55; scare.add(hatTop);
    for (const side of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.028, 5, 4), this.m.darkMetal, false);
      eye.position.set(side * 0.09, 2.18, 0.235); scare.add(eye);
    }
    const mouth = boxMesh(0.13, 0.025, 0.01, this.m.woodDark, 0, 2.08, 0.255, false);
    mouth.rotation.z = 0.1; scare.add(mouth);
    for (let i = 0; i < 8; i++) {
      const straw = mesh(new THREE.ConeGeometry(0.025, 0.24, 3), this.m.hay, false);
      straw.position.set((this.rand() - 0.5) * 0.9, 1.1 + (this.rand() - 0.5) * 0.4, 0.13);
      straw.rotation.z = (this.rand() - 0.5) * 1.5; scare.add(straw);
    }
    this.scene.add(scare);
    this.addObstacleCircle(16.2, 2.6, 0.32);
  }

  /* ---------------------------------------------------------------- */
  _makeHouse() {
    const g = new THREE.Group();
    g.position.set(-12, 0, -5);
    this.house = g;

    const stoneBase = boxMesh(8.9, 0.72, 6.9, this.m.stone, 0, 0.36, 0, true);
    g.add(stoneBase);
    const walls = boxMesh(8.45, 2.95, 6.45, this.m.plaster, 0, 2.15, 0, true);
    g.add(walls);

    // Timber frame accents.
    const beam = this.m.woodDark;
    const depth = 3.23;
    for (const x of [-4.17, -2.2, 2.0, 4.17]) {
      const b = boxMesh(0.15, 2.9, 0.13, beam, x, 2.15, depth + 0.015, true);
      g.add(b);
    }
    g.add(boxMesh(8.5, 0.16, 0.14, beam, 0, 3.5, depth + 0.03, true));
    g.add(boxMesh(8.5, 0.14, 0.14, beam, 0, 1.0, depth + 0.03, true));
    // East-facing timber detail (seen in the opening shot).
    for (const z of [-2.3, 0, 2.3]) {
      g.add(boxMesh(0.14, 2.9, 0.15, beam, 4.24, 2.15, z, true));
    }
    g.add(boxMesh(0.14, 0.16, 6.45, beam, 4.25, 3.5, 0, true));

    // Gable roof (ridge along local X).
    const roofAngle = Math.atan2(2.2, 3.45);
    const slope = Math.hypot(2.2, 3.45) + 0.55;
    for (const side of [-1, 1]) {
      const panel = mesh(new THREE.BoxGeometry(9.4, 0.18, slope), this.m.roof, true, true);
      panel.rotation.x = side * roofAngle;
      panel.position.set(0, 4.72, side * 1.73);
      g.add(panel);
      // fascia
      const fascia = boxMesh(9.45, 0.24, 0.13, this.m.woodDark, 0, 3.47, side * 3.53, true);
      g.add(fascia);
    }
    const ridge = mesh(new THREE.CylinderGeometry(0.12, 0.12, 9.45, 6), this.m.roof, true);
    ridge.rotation.z = Math.PI / 2; ridge.position.y = 5.87; g.add(ridge);

    const gableShape = new THREE.Shape();
    gableShape.moveTo(-3.23, 0); gableShape.lineTo(3.23, 0); gableShape.lineTo(0, 2.25); gableShape.closePath();
    for (const side of [-1, 1]) {
      const gm = mesh(new THREE.ShapeGeometry(gableShape), this.m.plaster, true, true);
      gm.rotation.y = side * Math.PI / 2;
      gm.position.set(side * 4.215, 3.6, 0);
      g.add(gm);
    }

    // Door.
    const door = new THREE.Group();
    door.position.set(1.32, 0.72, 3.24);
    const doorPanel = boxMesh(1.08, 2.15, 0.11, this.m.woodDark, 0, 1.075, 0.0, true);
    door.add(doorPanel);
    for (const x of [-0.32, 0, 0.32]) {
      door.add(boxMesh(0.023, 1.9, 0.015, this.m.woodPale, x, 1.06, 0.065, false));
    }
    const doorFrame = this.m.woodPale;
    door.add(boxMesh(1.3, 0.11, 0.16, doorFrame, 0, 2.21, 0.03, true));
    door.add(boxMesh(0.1, 2.3, 0.16, doorFrame, -0.64, 1.13, 0.03, true));
    door.add(boxMesh(0.1, 2.3, 0.16, doorFrame, 0.64, 1.13, 0.03, true));
    const knob = mesh(new THREE.SphereGeometry(0.055, 8, 6), standardMat({ color: 0xb69a5c, roughness: 0.3, metalness: 0.8 }), false);
    knob.position.set(0.38, 1.02, 0.09); door.add(knob);
    // small window in door
    const doorGlass = mesh(new THREE.PlaneGeometry(0.42, 0.5), this.m.glass, false, false);
    doorGlass.position.set(0, 1.62, 0.061); door.add(doorGlass);
    g.add(door);

    // windows
    const addWindow = (x, y, z, facing = 'front') => {
      const wg = new THREE.Group();
      const frameMat = this.m.woodPale;
      const glassW = 0.92, glassH = 1.08;
      const glass = mesh(new THREE.PlaneGeometry(glassW, glassH), this.m.glass, false, false);
      wg.add(glass);
      wg.add(boxMesh(glassW + 0.16, 0.1, 0.11, frameMat, 0, glassH / 2 + 0.05, 0.015, true));
      wg.add(boxMesh(glassW + 0.16, 0.1, 0.11, frameMat, 0, -glassH / 2 - 0.05, 0.015, true));
      wg.add(boxMesh(0.1, glassH + 0.2, 0.11, frameMat, -glassW / 2 - 0.05, 0, 0.015, true));
      wg.add(boxMesh(0.1, glassH + 0.2, 0.11, frameMat, glassW / 2 + 0.05, 0, 0.015, true));
      wg.add(boxMesh(0.045, glassH, 0.06, frameMat, 0, 0, 0.035, false));
      wg.add(boxMesh(glassW, 0.045, 0.06, frameMat, 0, 0, 0.035, false));
      wg.add(boxMesh(glassW + 0.32, 0.09, 0.24, frameMat, 0, -glassH / 2 - 0.13, 0.06, true));
      // Shutters
      for (const side of [-1, 1]) {
        const shutter = boxMesh(0.3, glassH + 0.16, 0.06, this.m.woodDark, side * (glassW / 2 + 0.26), 0, 0.04, true);
        wg.add(shutter);
        for (let i = 0; i < 6; i++) {
          wg.add(boxMesh(0.25, 0.025, 0.08, this.m.woodPale, side * (glassW / 2 + 0.26), -glassH / 2 + 0.12 + i * 0.19, 0.075, false));
        }
      }
      // Flower box below.
      const fbox = boxMesh(0.98, 0.22, 0.26, this.m.woodWarm, 0, -glassH / 2 - 0.31, 0.16, true);
      wg.add(fbox);
      for (let i = 0; i < 7; i++) {
        const flower = mesh(new THREE.SphereGeometry(0.075, 5, 4), standardMat({ color: i % 2 ? 0xb8564d : 0xe4d9b7, roughness: 0.9 }), false);
        flower.position.set(-0.38 + i * 0.126, -glassH / 2 - 0.15 + this.rand() * 0.1, 0.25);
        wg.add(flower);
      }
      const leaves = mesh(new THREE.SphereGeometry(0.11, 5, 4), this.m.leafMid, false);
      leaves.position.set(0, -glassH / 2 - 0.2, 0.23); leaves.scale.set(3.5, 0.8, 0.55); wg.add(leaves);
      if (facing === 'front') {
        wg.position.set(x, y, 3.24);
      } else {
        wg.rotation.y = Math.PI / 2;
        wg.position.set(4.24, y, z);
      }
      g.add(wg);
    };
    addWindow(-2.3, 2.18, 3.24);
    addWindow(3.1, 2.18, 3.24);
    addWindow(0, 2.3, 1.1, 'east');

    // Round loft window in the eastern gable.
    const roundWin = new THREE.Group();
    const roundGlass = mesh(new THREE.CircleGeometry(0.33, 20), this.m.glass, false, false);
    roundGlass.rotation.y = Math.PI / 2; roundWin.add(roundGlass);
    const ring = mesh(new THREE.TorusGeometry(0.36, 0.055, 6, 20), this.m.woodPale, true);
    ring.rotation.y = Math.PI / 2; roundWin.add(ring);
    const mullionH = boxMesh(0.02, 0.74, 0.06, this.m.woodPale, 0, 0, 0, false);
    mullionH.rotation.y = Math.PI / 2; roundWin.add(mullionH);
    const mullionV = boxMesh(0.02, 0.06, 0.74, this.m.woodPale, 0, 0, 0, false);
    roundWin.add(mullionV);
    roundWin.position.set(4.25, 4.37, 0);
    g.add(roundWin);

    // Stone chimney.
    const chimney = boxMesh(0.82, 2.5, 0.82, this.m.stone, -2.55, 4.85, -1.25, true);
    g.add(chimney);
    g.add(boxMesh(1.0, 0.16, 1.0, this.m.stoneLight, -2.55, 6.15, -1.25, true));
    this.chimneyTop = V(-12 - 2.55, 6.35, -5 - 1.25);

    // Porch.
    const porch = boxMesh(8.95, 0.18, 1.85, this.m.woodWarm, 0, 0.18, 4.03, true);
    g.add(porch);
    const step1 = boxMesh(2.3, 0.16, 0.55, this.m.woodPale, 0.2, 0.09, 5.18, true);
    const step2 = boxMesh(2.0, 0.16, 0.48, this.m.woodPale, 0.2, 0.23, 4.8, true);
    g.add(step1, step2);
    for (const x of [-3.9, 3.9]) {
      g.add(boxMesh(0.16, 2.8, 0.16, this.m.woodPale, x, 1.56, 4.35, true));
      g.add(boxMesh(0.08, 0.95, 0.08, this.m.woodPale, x, 0.95, 3.55, true));
    }
    const porchRoof = mesh(new THREE.BoxGeometry(9.15, 0.14, 2.0), this.m.roof, true, true);
    porchRoof.rotation.x = 0.17; porchRoof.position.set(0, 3.02, 4.05); g.add(porchRoof);
    const porchBeam = boxMesh(9.0, 0.17, 0.16, this.m.woodDark, 0, 2.82, 5.02, true);
    g.add(porchBeam);
    // rails
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        g.add(boxMesh(0.08, 0.74, 0.08, this.m.woodPale, side * 2.6 - side * i * 0.65, 0.55, 4.42, true));
      }
      g.add(boxMesh(2.1, 0.08, 0.1, this.m.woodPale, side * 3.0, 0.92, 4.42, true));
    }
    // Porch lantern.
    const lantern = new THREE.Group();
    lantern.position.set(2.65, 2.35, 3.46);
    lantern.add(boxMesh(0.16, 0.03, 0.16, this.m.darkMetal, 0, 0.18, 0, true));
    lantern.add(boxMesh(0.03, 0.22, 0.03, this.m.darkMetal, 0, 0.08, 0, false));
    const lanternGlass = boxMesh(0.15, 0.24, 0.15, this.m.glass, 0, -0.08, 0, false);
    lantern.add(lanternGlass);
    const bulb = mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd596 }), false);
    bulb.position.y = -0.07; lantern.add(bulb);
    const lamp = new THREE.PointLight(0xffc27b, 0, 7, 2);
    lamp.position.copy(lantern.position); g.add(lamp); this.lampLights.push(lamp);
    g.add(lantern);

    // Homey clutter: bench, boots, flower pots.
    const bench = new THREE.Group();
    bench.position.set(-2.8, 0.26, 4.1);
    bench.add(boxMesh(1.35, 0.1, 0.42, this.m.woodWarm, 0, 0.35, 0, true));
    bench.add(boxMesh(1.35, 0.38, 0.08, this.m.woodWarm, 0, 0.55, -0.18, true));
    for (const x of [-0.55, 0.55]) bench.add(boxMesh(0.09, 0.35, 0.35, this.m.woodDark, x, 0.17, 0.02, true));
    g.add(bench);
    const potMat = this.m.terracotta;
    for (let i = 0; i < 3; i++) {
      const pot = mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 9), potMat, true);
      pot.position.set(3.5 - i * 0.43, 0.42, 4.7); g.add(pot);
      const bush = mesh(new THREE.IcosahedronGeometry(0.22, 1), this.m.leafLight, true);
      bush.position.set(3.5 - i * 0.43, 0.6, 4.7); bush.scale.y = 0.8; g.add(bush);
    }

    // Foundation shrubs.
    const shrubGeo = new THREE.IcosahedronGeometry(0.42, 1);
    for (let i = 0; i < 7; i++) {
      const sh = mesh(shrubGeo, i % 3 ? this.m.leafMid : this.m.leafDark, true);
      sh.position.set(-3.6 + i * 1.22, 0.4, 3.65 + (this.rand() - 0.5) * 0.12);
      sh.scale.set(0.8 + this.rand() * 0.5, 0.6 + this.rand() * 0.4, 0.75 + this.rand() * 0.3);
      sh.rotation.y = this.rand() * TAU; g.add(sh);
    }

    this.scene.add(g);
    this.addObstacleBox(-12, -5, 4.5, 3.35);
    this.interactables.push({ id: 'house', x: -10.7, z: -0.8, r: 2.25, label: '回家休息', key: 'rest' });
  }

  /* ---------------------------------------------------------------- */
  _makeBarn() {
    const g = new THREE.Group();
    g.position.set(23.0, 0, -10.5);
    this.barn = g;
    g.add(boxMesh(9.4, 0.55, 7.4, this.m.stone, 0, 0.27, 0, true));
    g.add(boxMesh(9.1, 3.5, 7.15, this.m.barn, 0, 2.2, 0, true));

    // White trim & corner boards.
    const trim = standardMat({ color: 0xe4ddcc, roughness: 0.9 });
    for (const x of [-4.55, 4.55]) {
      g.add(boxMesh(0.2, 3.65, 0.15, trim, x, 2.2, 3.62, true));
    }
    g.add(boxMesh(9.2, 0.18, 0.16, trim, 0, 3.98, 3.62, true));
    g.add(boxMesh(8.85, 0.16, 0.1, trim, 0, 1.18, 3.62, true));

    // big sliding doors
    for (const side of [-1, 1]) {
      const door = boxMesh(2.2, 2.9, 0.13, this.m.woodDark, side * 1.17, 1.55, 3.64, true);
      g.add(door);
      const x1 = boxMesh(2.1, 0.13, 0.07, trim, side * 1.17, 1.55, 3.73, false);
      x1.rotation.z = side * 0.66; g.add(x1);
      const x2 = boxMesh(2.1, 0.13, 0.07, trim, side * 1.17, 1.55, 3.73, false);
      x2.rotation.z = -side * 0.66; g.add(x2);
      g.add(boxMesh(0.1, 2.9, 0.08, trim, side * 2.25, 1.55, 3.7, false));
    }
    // door track & handle
    g.add(boxMesh(4.7, 0.08, 0.1, this.m.iron, 0, 3.02, 3.74, false));

    // hay loft opening
    const loft = boxMesh(1.6, 1.15, 0.12, this.m.woodDark, 0, 4.0, 3.57, true);
    g.add(loft);
    for (let i = 0; i < 4; i++) g.add(boxMesh(0.05, 1.1, 0.05, trim, -0.6 + i * 0.4, 4.0, 3.65, false));

    // gable roof, ridge along X
    const angle = Math.atan2(2.15, 3.95);
    const slopeLen = Math.hypot(2.15, 3.95) + 0.45;
    for (const side of [-1, 1]) {
      const panel = mesh(new THREE.BoxGeometry(10.2, 0.18, slopeLen), this.m.roof, true, true);
      panel.rotation.x = side * angle;
      panel.position.set(0, 4.95, side * 1.92);
      g.add(panel);
    }
    const ridge = mesh(new THREE.CylinderGeometry(0.11, 0.11, 10.25, 6), this.m.iron, true);
    ridge.rotation.z = Math.PI / 2; ridge.position.y = 6.1; g.add(ridge);

    // gable infill
    const gs = new THREE.Shape();
    gs.moveTo(-3.62, 0); gs.lineTo(3.62, 0); gs.lineTo(0, 2.18); gs.closePath();
    for (const side of [-1, 1]) {
      const gm = mesh(new THREE.ShapeGeometry(gs), this.m.barn, true, true);
      gm.rotation.y = side * Math.PI / 2;
      gm.position.set(side * 4.56, 4.0, 0);
      g.add(gm);
    }

    // Cupola + weather vane
    const cupola = boxMesh(1.05, 0.9, 1.05, this.m.woodPale, 0, 6.3, 0, true);
    g.add(cupola);
    const cupRoof = mesh(new THREE.ConeGeometry(0.95, 0.7, 4), this.m.iron, true);
    cupRoof.position.y = 6.99; cupRoof.rotation.y = Math.PI / 4; g.add(cupRoof);
    const vanePole = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5), this.m.iron, false);
    vanePole.position.y = 7.7; g.add(vanePole);
    const vaneArrow = mesh(new THREE.ConeGeometry(0.12, 0.42, 4), this.m.iron, false);
    vaneArrow.rotation.z = Math.PI / 2; vaneArrow.position.set(0.17, 7.9, 0); g.add(vaneArrow);
    const vanePlate = boxMesh(0.42, 0.26, 0.025, this.m.iron, -0.16, 7.9, 0, false); g.add(vanePlate);

    // silo
    const siloX = 6.3, siloZ = -0.8;
    const silo = new THREE.Group();
    silo.position.set(siloX, 0, siloZ);
    const body = mesh(new THREE.CylinderGeometry(1.5, 1.55, 7.1, 20, 1), standardMat({ color: 0x8b8e86, roughness: 0.7, metalness: 0.22 }), true, true);
    body.position.y = 3.55; silo.add(body);
    for (let i = 0; i < 5; i++) {
      const band = mesh(new THREE.CylinderGeometry(1.57, 1.57, 0.07, 20), this.m.darkMetal, false);
      band.position.y = 0.6 + i * 1.5; silo.add(band);
    }
    const dome = mesh(new THREE.SphereGeometry(1.5, 20, 10, 0, TAU, 0, Math.PI / 2), standardMat({ color: 0x747b78, roughness: 0.55, metalness: 0.35 }), true);
    dome.position.y = 7.1; silo.add(dome);
    const hatch = boxMesh(0.5, 0.55, 0.08, this.m.darkMetal, 0, 4.3, 1.5, true); silo.add(hatch);
    g.add(silo);

    // side lean-to with firewood
    const lean = new THREE.Group();
    lean.position.set(-5.3, 0, 1.1);
    for (const x of [-0.04, 2.2]) {
      for (const z of [-1.1, 1.1]) {
        lean.add(boxMesh(0.13, 2.3, 0.13, this.m.woodDark, x, 1.15, z, true));
      }
    }
    const leanRoof = mesh(new THREE.BoxGeometry(2.9, 0.14, 2.7), this.m.roof, true, true);
    leanRoof.rotation.z = -0.16; leanRoof.position.set(1.1, 2.35, 0); lean.add(leanRoof);
    g.add(lean);

    this.scene.add(g);
    this.addObstacleBox(23.0, -10.5, 4.8, 3.8);
    this.addObstacleCircle(29.3, -11.3, 1.6);
    this.interactables.push({ id: 'barn', x: 23.0, z: -6.1, r: 2.3, label: '看看谷仓', key: 'barn' });
    this.barnDoor = V(23.0, 0, -6.4);
  }

  /* ---------------------------------------------------------------- */
  _makeShop() {
    const g = new THREE.Group();
    g.position.set(18.0, 0, 12.6);
    g.rotation.y = -Math.PI / 2;
    this.shop = g;

    const deck = boxMesh(4.5, 0.2, 2.65, this.m.woodWarm, 0, 0.1, 0, true);
    g.add(deck);
    // back shelf
    g.add(boxMesh(4.25, 2.1, 0.35, this.m.woodDark, 0, 1.2, -1.02, true));
    for (let i = 0; i < 3; i++) {
      g.add(boxMesh(4.0, 0.1, 0.55, this.m.woodPale, 0, 0.72 + i * 0.58, -0.92, true));
      for (let k = 0; k < 7; k++) {
        const jarColors = [0x8a9a67, 0xb3a067, 0x72513e, 0xd0b782];
        const jar = mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.2, 7), standardMat({ color: jarColors[(i + k) % 4], roughness: 0.65 }), false);
        jar.position.set(-1.72 + k * 0.5, 0.88 + i * 0.58, -0.78 + this.rand() * 0.08);
        g.add(jar);
      }
    }
    // counter
    g.add(boxMesh(4.1, 0.92, 0.55, this.m.woodWarm, 0, 0.55, 0.94, true));
    g.add(boxMesh(4.25, 0.09, 0.7, this.m.woodPale, 0, 1.04, 0.94, true));
    for (let i = 0; i < 4; i++) {
      g.add(boxMesh(0.12, 0.83, 0.6, this.m.woodDark, -1.65 + i * 1.1, 0.5, 0.94, false));
    }
    // crates with produce on counter
    for (let i = 0; i < 3; i++) {
      const crate = boxMesh(0.55, 0.26, 0.4, this.m.woodPale, -1.45 + i * 1.35, 1.2, 0.88, true);
      g.add(crate);
      const col = [0xc36b37, 0xa5382f, 0xc7a755][i];
      for (let k = 0; k < 4; k++) {
        const veg = mesh(new THREE.SphereGeometry(0.075, 6, 5), standardMat({ color: col, roughness: 0.8 }), false);
        veg.position.set(-1.62 + i * 1.35 + (k % 2) * 0.13, 1.34, 0.81 + ((k / 2) | 0) * 0.13);
        g.add(veg);
      }
    }
    // posts
    for (const x of [-2.1, 2.1]) {
      for (const z of [-1.15, 1.15]) {
        g.add(boxMesh(0.13, 2.8, 0.13, this.m.woodDark, x, 1.4, z, true));
      }
    }
    // striped awning
    const awn = mesh(new THREE.PlaneGeometry(4.8, 2.9), this.m.awning, true, true);
    awn.rotation.x = -Math.PI / 2 + 0.13;
    awn.position.set(0, 2.72, 0.05);
    g.add(awn);
    const valance = mesh(new THREE.PlaneGeometry(4.8, 0.34), this.m.awning, true);
    valance.position.set(0, 2.54, 1.4); valance.rotation.x = 0.08; g.add(valance);
    // little scallops
    for (let i = 0; i < 10; i++) {
      const scallop = mesh(new THREE.CircleGeometry(0.16, 10, Math.PI, Math.PI), this.m.awning, false, false);
      scallop.position.set(-2.16 + i * 0.48, 2.4, 1.42);
      g.add(scallop);
    }

    // Shopkeeper, 谷雨. A quietly cheerful silhouette with an apron and straw hat.
    const keeper = new THREE.Group();
    keeper.position.set(0.25, 0.12, -0.16);
    const skirt = mesh(new THREE.ConeGeometry(0.4, 0.92, 10), standardMat({ color: 0x566c54, roughness: 1 }), true);
    skirt.position.y = 0.55; keeper.add(skirt);
    const torso = mesh(new THREE.CapsuleGeometry(0.23, 0.42, 5, 8), standardMat({ color: 0xd9cdb5, roughness: 1 }), true);
    torso.position.y = 1.18; keeper.add(torso);
    const apron = mesh(new THREE.PlaneGeometry(0.43, 0.64), standardMat({ color: 0x9a7a50, roughness: 1, side: THREE.DoubleSide }), true);
    apron.position.set(0, 0.86, 0.235); keeper.add(apron);
    for (const side of [-1, 1]) {
      const arm = mesh(new THREE.CapsuleGeometry(0.07, 0.5, 4, 6), standardMat({ color: 0xd9cdb5, roughness: 1 }), true);
      arm.position.set(side * 0.37, 1.2, 0); arm.rotation.z = side * 0.25; keeper.add(arm);
      const hand = mesh(new THREE.SphereGeometry(0.075, 6, 5), standardMat({ color: 0xcaa386, roughness: 1 }), true);
      hand.position.set(side * 0.47, 0.86, 0.02); keeper.add(hand);
    }
    const head = mesh(new THREE.SphereGeometry(0.21, 12, 10), standardMat({ color: 0xcaa386, roughness: 1 }), true);
    head.position.y = 1.67; head.scale.set(0.9, 1.05, 0.92); keeper.add(head);
    const hair = mesh(new THREE.SphereGeometry(0.225, 12, 10, 0, TAU, 0, Math.PI * 0.63), standardMat({ color: 0x3a2b21, roughness: 1 }), true);
    hair.position.y = 1.71; keeper.add(hair);
    const hairBack = mesh(new THREE.SphereGeometry(0.17, 8, 6), standardMat({ color: 0x3a2b21, roughness: 1 }), true);
    hairBack.position.set(0, 1.57, -0.12); keeper.add(hairBack);
    const hatBrim = mesh(new THREE.CylinderGeometry(0.34, 0.37, 0.035, 16), this.m.hay, true);
    hatBrim.position.y = 1.87; keeper.add(hatBrim);
    const hatTop = mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.16, 12), this.m.hay, true);
    hatTop.position.y = 1.96; keeper.add(hatTop);
    keeper.userData.isNpc = true;
    g.add(keeper);
    this.shopkeeper = keeper;

    // Hanging sign board with the shop's name.
    const { canvas, ctx } = makeCanvas(512);
    ctx.fillStyle = '#3c3023'; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(238,220,182,.65)'; ctx.lineWidth = 5; ctx.strokeRect(14, 14, 484, 484);
    ctx.fillStyle = '#eadcbd'; ctx.textAlign = 'center';
    ctx.font = '700 76px "Songti SC", Georgia, serif';
    ctx.fillText('谷雨杂货铺', 256, 215);
    ctx.font = '26px Georgia, serif'; ctx.fillStyle = 'rgba(234,220,189,.62)';
    ctx.fillText('SEEDS  ·  SUNDRIES  ·  GOOD COMPANY', 256, 272);
    ctx.font = '30px "Kaiti SC", Georgia, serif'; ctx.fillStyle = 'rgba(234,220,189,.8)';
    ctx.fillText('种子 · 杂货 · 新鲜空气', 256, 345);
    const signTex = canvasTexture(canvas, { repeatX: 1, repeatY: 1 });
    const signMat = standardMat({ map: signTex, roughness: 0.9 });
    const sign = boxMesh(2.5, 0.72, 0.09, signMat, 0, 2.28, 1.5, true);
    sign.rotation.x = -0.04; g.add(sign);
    for (const side of [-1, 1]) {
      const rope = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 4), this.m.rope, false);
      rope.position.set(side * 1.05, 2.64, 1.48); g.add(rope);
    }

    // easel chalkboard out front
    const easel = new THREE.Group();
    easel.position.set(1.62, 0.14, 1.55);
    easel.rotation.y = 0.25;
    const board = boxMesh(0.86, 0.82, 0.06, standardMat({ map: this.tex.shopChalk, roughness: 0.95 }), 0, 0.8, 0.04, true);
    easel.add(board);
    for (const side of [-1, 1]) {
      const leg = boxMesh(0.06, 1.2, 0.06, this.m.woodDark, side * 0.38, 0.6, 0, true);
      leg.rotation.z = side * 0.15; easel.add(leg);
    }
    g.add(easel);

    // string lights
    const wireMat = new THREE.LineBasicMaterial({ color: 0x27211b });
    const wirePts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      wirePts.push(new THREE.Vector3(-2.0 + t * 4.0, 2.55 - Math.sin(t * Math.PI) * 0.28, 1.32));
    }
    const wireGeo = new THREE.BufferGeometry().setFromPoints(wirePts);
    g.add(new THREE.Line(wireGeo, wireMat));
    for (let i = 0; i < 6; i++) {
      const bulb = mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd9a1 }), false);
      const t = (i + 0.5) / 6;
      bulb.position.set(-2.0 + t * 4.0, 2.42 - Math.sin(t * Math.PI) * 0.28, 1.33);
      g.add(bulb);
    }
    const shopLight = new THREE.PointLight(0xffc78a, 0, 7, 2);
    shopLight.position.set(0, 2.5, 1.3); g.add(shopLight); this.lampLights.push(shopLight);

    this.scene.add(g);
    this.addObstacleBox(18.0, 12.6, 1.25, 2.2);
    this.interactables.push({ id: 'shop', x: 16.35, z: 12.6, r: 2.45, label: '逛逛谷雨杂货铺', key: 'shop' });
  }

  /* ---------------------------------------------------------------- */
  _makeWellAndBin() {
    // Stone well
    const well = new THREE.Group();
    well.position.set(2.6, 0, 10.6);
    const ring = mesh(new THREE.CylinderGeometry(1.15, 1.24, 0.82, 18, 1, true), this.m.stone, true, true);
    ring.position.y = 0.41; well.add(ring);
    const rim = mesh(new THREE.TorusGeometry(1.15, 0.12, 6, 24), this.m.stoneLight, true);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.82; well.add(rim);
    const inside = mesh(new THREE.CircleGeometry(1.0, 24), standardMat({ color: 0x222c27, roughness: 0.25, metalness: 0.2 }), false);
    inside.rotation.x = -Math.PI / 2; inside.position.y = 0.55; well.add(inside);
    for (const x of [-0.95, 0.95]) {
      well.add(boxMesh(0.12, 2.15, 0.12, this.m.woodDark, x, 1.65, 0, true));
    }
    well.add(boxMesh(2.1, 0.1, 0.12, this.m.woodDark, 0, 2.65, 0, true));
    const axle = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 8), this.m.woodPale, true);
    axle.rotation.z = Math.PI / 2; axle.position.y = 2.25; well.add(axle);
    const littleRoof = mesh(new THREE.ConeGeometry(1.7, 0.8, 4), this.m.roof, true);
    littleRoof.position.y = 3.0; littleRoof.rotation.y = Math.PI / 4; littleRoof.scale.set(1, 1, 0.72); well.add(littleRoof);
    const rope = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 4), this.m.rope, false);
    rope.position.set(0.2, 1.75, 0); well.add(rope);
    const bucket = mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.3, 9), this.m.woodPale, true);
    bucket.position.set(0.2, 1.18, 0); well.add(bucket);
    // flowers at base
    for (let i = 0; i < 7; i++) {
      const a = this.rand() * TAU;
      const stem = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.24, 3), this.m.leafMid, false);
      stem.position.set(Math.cos(a) * 1.2, 0.12, Math.sin(a) * 1.2); well.add(stem);
      const bloom = mesh(new THREE.SphereGeometry(0.045, 5, 4), standardMat({ color: 0xd6c187, roughness: 0.9 }), false);
      bloom.position.copy(stem.position).add(V(0, 0.15, 0)); well.add(bloom);
    }
    this.scene.add(well);
    this.addObstacleCircle(2.6, 10.6, 1.25);
    this.interactables.push({ id: 'well', x: 2.6, z: 12.1, r: 1.9, label: '从井里打水', key: 'well' });

    // Shipping bin near the house path.
    const bin = new THREE.Group();
    bin.position.set(-7.2, 0, 5.0);
    bin.rotation.y = 0.22;
    const body = boxMesh(1.9, 0.86, 1.12, this.m.woodWarm, 0, 0.43, 0, true);
    bin.add(body);
    for (const x of [-0.85, 0.85]) bin.add(boxMesh(0.1, 0.9, 1.18, this.m.iron, x, 0.45, 0, false));
    const lid = boxMesh(1.92, 0.1, 1.14, this.m.woodPale, 0, 1.15, -0.2, true);
    lid.rotation.x = -0.74; bin.add(lid);
    const lidBack = boxMesh(1.92, 0.08, 0.22, this.m.woodPale, 0, 0.98, -0.64, true);
    bin.add(lidBack);
    const handle = boxMesh(0.5, 0.07, 0.07, this.m.iron, 0, 1.38, 0.46, false);
    bin.add(handle);
    for (const x of [-0.55, 0.55]) bin.add(boxMesh(0.07, 0.2, 0.07, this.m.iron, x, 1.04, -0.19, false));
    const signBoard = mesh(new THREE.PlaneGeometry(0.7, 0.3), standardMat({ color: 0xd9cdb1, roughness: 1 }), false);
    signBoard.position.set(0, 0.48, 0.57); bin.add(signBoard);
    this.scene.add(bin);
    this.addObstacleBox(-7.2, 5.0, 0.98, 0.58);
    this.interactables.push({ id: 'bin', x: -7.2, z: 6.15, r: 2.0, label: '打开出货箱', key: 'ship' });

    // mailbox by the front path
    const mail = new THREE.Group();
    mail.position.set(-7.2, 0, 1.4);
    mail.rotation.y = -0.18;
    mail.add(boxMesh(0.16, 1.1, 0.16, this.m.woodDark, 0, 0.55, 0, true));
    const box = mesh(new THREE.BoxGeometry(0.55, 0.38, 0.34), standardMat({ color: 0x586d61, roughness: 0.65, metalness: 0.25 }), true);
    box.position.y = 1.2; mail.add(box);
    const flap = boxMesh(0.53, 0.04, 0.36, this.m.woodDark, 0, 1.4, 0, false);
    mail.add(flap);
    const post = boxMesh(0.06, 0.55, 0.06, this.m.iron, 0.27, 1.13, 0.1, false);
    mail.add(post);
    const flag = boxMesh(0.28, 0.18, 0.03, standardMat({ color: 0xaa533e, roughness: 0.8 }), 0.2, 1.48, 0.16, false);
    flag.rotation.z = 0.8; mail.add(flag);
    this.scene.add(mail);
    this.interactables.push({ id: 'mail', x: -7.2, z: 2.2, r: 1.75, label: '查看信箱', key: 'mail' });
  }

  /* ---------------------------------------------------------------- */
  _makeProps() {
    // Entrance sign — the first thing that welcomes you onto the farm.
    const sign = new THREE.Group();
    sign.position.set(2.4, 0, 15.3);
    sign.rotation.y = 0.05;
    for (const x of [-1.05, 1.05]) {
      sign.add(boxMesh(0.18, 2.35, 0.18, this.m.woodDark, x, 1.17, 0, true));
    }
    const board = boxMesh(2.55, 1.72, 0.16, this.m.woodPale, 0, 2.0, 0.03, true);
    sign.add(board);
    const face = mesh(new THREE.PlaneGeometry(2.3, 1.5), standardMat({ map: this.tex.sign, roughness: 0.9 }), false);
    face.position.set(0, 2.0, 0.13); sign.add(face);
    const smallRoof = mesh(new THREE.BoxGeometry(2.7, 0.1, 0.5), this.m.roof, true);
    smallRoof.rotation.x = 0.22; smallRoof.position.set(0, 2.95, 0.1); sign.add(smallRoof);
    this.scene.add(sign);
    this.addObstacleBox(2.4, 15.3, 1.2, 0.22);

    // Picnic table in the dappled shade by the pond.
    const table = new THREE.Group();
    table.position.set(-18.6, 0, 13.1);
    table.rotation.y = 0.3;
    table.add(boxMesh(2.0, 0.1, 0.9, this.m.woodWarm, 0, 0.78, 0, true));
    for (const x of [-0.75, 0.75]) {
      const leg = boxMesh(0.1, 0.78, 0.1, this.m.woodDark, x, 0.39, 0, true);
      leg.rotation.z = 0.45; table.add(leg);
      const leg2 = leg.clone(); leg2.rotation.z = -0.45; table.add(leg2);
    }
    for (const z of [-0.9, 0.9]) {
      table.add(boxMesh(2.1, 0.09, 0.38, this.m.woodPale, 0, 0.47, z, true));
      for (const x of [-0.7, 0.7]) table.add(boxMesh(0.09, 0.47, 0.3, this.m.woodDark, x, 0.23, z, true));
    }
    const mug = mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.12, 8), standardMat({ color: 0xd8d0bd, roughness: 0.5 }), true);
    mug.position.set(0.3, 0.89, 0.06); table.add(mug);
    this.scene.add(table);
    this.addObstacleCircle(-18.6, 13.1, 1.2);

    // Wheelbarrow with the morning's carrots.
    const wb = new THREE.Group();
    wb.position.set(1.0, 0, 4.7);
    wb.rotation.y = -0.65;
    const tray = boxMesh(1.15, 0.28, 0.65, this.m.woodDark, 0, 0.53, 0, true);
    tray.rotation.x = -0.07; wb.add(tray);
    for (const x of [-0.5, 0.5]) {
      wb.add(boxMesh(0.07, 0.08, 1.3, this.m.woodPale, x, 0.5, -0.04, true));
      const leg = boxMesh(0.08, 0.5, 0.08, this.m.woodPale, x, 0.25, -0.18, true);
      wb.add(leg);
    }
    const wheel = mesh(new THREE.TorusGeometry(0.28, 0.08, 6, 14), this.m.darkMetal, true);
    wheel.position.set(0, 0.28, 0.48); wheel.rotation.y = Math.PI / 2; wb.add(wheel);
    for (let i = 0; i < 8; i++) {
      const carrot = mesh(new THREE.ConeGeometry(0.055, 0.28, 7), standardMat({ color: 0xc47638, roughness: 0.8 }), false);
      carrot.position.set(-0.35 + this.rand() * 0.7, 0.72, -0.18 + this.rand() * 0.35);
      carrot.rotation.set((this.rand() - 0.5) * 1.3, this.rand() * TAU, (this.rand() - 0.5) * 1.1);
      wb.add(carrot);
    }
    this.scene.add(wb);
    this.addObstacleCircle(1.0, 4.7, 0.7);

    // Tractor, parked near the barn.
    const tractor = new THREE.Group();
    tractor.position.set(18.7, 0, 1.35);
    tractor.rotation.y = -0.85;
    this.tractor = tractor;
    const red = standardMat({ color: 0x7d3425, roughness: 0.5, metalness: 0.28 });
    const redDark = standardMat({ color: 0x5a261d, roughness: 0.55, metalness: 0.25 });
    const tire = standardMat({ color: 0x25211c, roughness: 0.95 });
    const body = boxMesh(1.65, 0.58, 0.86, red, 0.1, 0.92, 0, true);
    tractor.add(body);
    const hood = boxMesh(1.0, 0.4, 0.7, redDark, 0.92, 1.12, 0, true);
    hood.rotation.z = -0.05; tractor.add(hood);
    tractor.add(boxMesh(0.42, 0.52, 0.72, this.m.darkMetal, 1.38, 1.1, 0, true));
    for (let i = 0; i < 5; i++) {
      tractor.add(boxMesh(0.03, 0.3, 0.05, this.m.darkMetal, 1.18 + i * 0.05, 1.18, 0.36, false));
    }
    const seat = boxMesh(0.44, 0.14, 0.42, this.m.darkMetal, -0.45, 1.42, 0, true);
    tractor.add(seat);
    const seatBack = boxMesh(0.12, 0.45, 0.42, redDark, -0.65, 1.65, 0, true);
    tractor.add(seatBack);
    const wheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.28, 18);
    for (const z of [-0.58, 0.58]) {
      const w = mesh(wheelGeo, tire, true);
      w.position.set(-0.22, 0.62, z); w.rotation.x = Math.PI / 2; tractor.add(w);
      const hub = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.32, 12), red, true);
      hub.position.set(-0.22, 0.62, z); hub.rotation.x = Math.PI / 2; tractor.add(hub);
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * TAU;
        const lug = boxMesh(0.1, 0.12, 0.32, tire, -0.22 + Math.cos(a) * 0.58, 0.62 + Math.sin(a) * 0.58, z, true);
        lug.rotation.z = a; tractor.add(lug);
      }
      const fw = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 14), tire, true);
      fw.position.set(1.2, 0.34, z); fw.rotation.x = Math.PI / 2; tractor.add(fw);
    }
    const exhaust = mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.8, 6), this.m.iron, true);
    exhaust.position.set(1.2, 1.65, 0.23); tractor.add(exhaust);
    const steering = mesh(new THREE.TorusGeometry(0.22, 0.025, 5, 12), this.m.darkMetal, false);
    steering.position.set(-0.05, 1.76, 0); steering.rotation.x = 1.0; tractor.add(steering);
    const steerPost = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 5), this.m.iron, false);
    steerPost.position.set(-0.05, 1.55, 0); tractor.add(steerPost);
    this.scene.add(tractor);
    this.addObstacleBox(18.7, 1.35, 1.4, 1.0);

    // Hay bales, crates and barrels by the barn.
    const crate = this.m.woodPale;
    const hay = mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.45, 12), this.m.hay, true, true);
    hay.rotation.z = Math.PI / 2; hay.position.set(27.8, 0.72, -4.2); this.scene.add(hay);
    const hay2 = hay.clone(); hay2.position.set(26.2, 0.72, -4.9); hay2.rotation.y = 0.5; this.scene.add(hay2);
    const hay3 = hay.clone(); hay3.position.set(27.0, 1.55, -4.6); hay3.rotation.z = 0.05; hay3.rotation.y = 0.2; this.scene.add(hay3);
    const crates = [
      [17.0, 0.32, -5.0, 0.55], [17.7, 0.32, -5.5, 0.45], [17.2, 0.87, -5.15, 0.42],
      [19.6, 0.38, -4.4, 0.75], [-6.8, 0.35, 3.2, 0.5],
    ];
    for (const [x, y, z, s] of crates) {
      const c = boxMesh(s, s, s, crate, x, y, z, true);
      c.rotation.y = this.rand() * TAU; this.scene.add(c);
      for (const k of [-0.38, 0.38]) {
        const band = boxMesh(s + 0.02, 0.035, 0.035, this.m.woodDark, x, y + k * s, z, false);
        band.rotation.y = c.rotation.y; this.scene.add(band);
      }
    }
    for (const [x, z] of [[28.8, -5.1], [29.6, -6.0], [16.6, -5.4]]) {
      const barrel = mesh(new THREE.CylinderGeometry(0.39, 0.34, 0.82, 12), this.m.woodWarm, true, true);
      barrel.position.set(x, 0.41, z); this.scene.add(barrel);
      for (const y of [0.15, 0.68]) {
        const band = mesh(new THREE.TorusGeometry(0.39, 0.025, 5, 16), this.m.iron, false);
        band.rotation.x = Math.PI / 2; band.position.set(x, y, z); this.scene.add(band);
      }
    }

    // Firewood stack beside the house.
    const logs = new THREE.Group();
    logs.position.set(-6.7, 0, -2.3);
    logs.rotation.y = 0.2;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5 - row; i++) {
        const log = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.9, 7), this.m.bark, true);
        log.rotation.x = Math.PI / 2;
        log.position.set(-0.5 + i * 0.24 + row * 0.12, 0.15 + row * 0.2, 0);
        logs.add(log);
      }
    }
    this.scene.add(logs);

    // Clothesline between house and the oak.
    const lineA = V(-16.1, 2.3, 1.2), lineB = V(-9.2, 2.1, 0.7);
    for (const p of [lineA, lineB]) {
      this.scene.add(boxMesh(0.1, 2.4, 0.1, this.m.woodDark, p.x, 1.2, p.z, true));
    }
    const curve = new THREE.QuadraticBezierCurve3(
      lineA, new THREE.Vector3((lineA.x + lineB.x) / 2, 1.9, (lineA.z + lineB.z) / 2), lineB
    );
    const ropeGeo = new THREE.TubeGeometry(curve, 20, 0.013, 4, false);
    this.scene.add(mesh(ropeGeo, this.m.rope, false, false));
    const sheetCols = [0xe3dbc8, 0xcfd5ce, 0xd9c7ac];
    for (let i = 0; i < 3; i++) {
      const t = 0.22 + i * 0.29;
      const p = curve.getPoint(t);
      const sheet = mesh(new THREE.PlaneGeometry(0.7, 0.9, 1, 3), standardMat({ color: sheetCols[i], roughness: 1, side: THREE.DoubleSide }), true);
      sheet.position.set(p.x, p.y - 0.47, p.z + 0.02);
      sheet.rotation.y = 0.15 + this.rand() * 0.1;
      this.scene.add(sheet);
      // soft folds
      const fold = mesh(new THREE.PlaneGeometry(0.06, 0.9), standardMat({ color: 0xbab29f, roughness: 1 }), false);
      fold.position.copy(sheet.position).add(V(0.1, 0, 0.002));
      this.scene.add(fold);
    }

    // Beehives near the orchard edge.
    for (let i = 0; i < 3; i++) {
      const hive = new THREE.Group();
      hive.position.set(-25.5 + i * 1.2, 0, -8.2);
      const body = mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.75, 10), standardMat({ color: 0x9b8154, roughness: 0.9 }), true);
      body.position.y = 0.75; hive.add(body);
      for (let k = 0; k < 3; k++) {
        const band = mesh(new THREE.TorusGeometry(0.36, 0.03, 4, 12), this.m.woodDark, false);
        band.rotation.x = Math.PI / 2; band.position.y = 0.52 + k * 0.23; hive.add(band);
      }
      const lid = mesh(new THREE.ConeGeometry(0.46, 0.2, 8), this.m.woodDark, true);
      lid.position.y = 1.2; hive.add(lid);
      hive.add(boxMesh(0.08, 0.42, 0.08, this.m.woodDark, 0, 0.2, 0, true));
      this.scene.add(hive);
    }

    // A little wooden bench facing the pond.
    const bench = new THREE.Group();
    bench.position.set(-19.7, 0, 11.6);
    bench.rotation.y = 0.5;
    bench.add(boxMesh(1.7, 0.09, 0.46, this.m.woodWarm, 0, 0.55, 0, true));
    bench.add(boxMesh(1.7, 0.4, 0.09, this.m.woodWarm, 0, 0.8, -0.18, true));
    for (const x of [-0.65, 0.65]) bench.add(boxMesh(0.1, 0.55, 0.45, this.m.woodDark, x, 0.27, 0, true));
    this.scene.add(bench);

    // Lantern posts along the path. Their light is dialled up after dusk.
    const makePathLantern = (x, z) => {
      const lamp = new THREE.Group();
      lamp.position.set(x, 0, z);
      lamp.add(boxMesh(0.16, 2.55, 0.16, this.m.woodDark, 0, 1.27, 0, true));
      lamp.add(boxMesh(0.42, 0.08, 0.42, this.m.iron, 0, 2.54, 0, true));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          lamp.add(boxMesh(0.035, 0.52, 0.035, this.m.iron, sx * 0.16, 2.32, sz * 0.16, false));
        }
      }
      const pane = boxMesh(0.26, 0.4, 0.26, this.m.glass, 0, 2.3, 0, false);
      lamp.add(pane);
      const cap = mesh(new THREE.ConeGeometry(0.34, 0.22, 4), this.m.iron, true);
      cap.position.y = 2.62; cap.rotation.y = Math.PI / 4; lamp.add(cap);
      const bulb = mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd391 }), false);
      bulb.position.y = 2.27; lamp.add(bulb);
      const light = new THREE.PointLight(0xffbe77, 0, 9, 2);
      light.position.set(0, 2.25, 0);
      lamp.add(light);
      this.lampLights.push(light);
      this.scene.add(lamp);
    };
    makePathLantern(5.7, 10.1);
    makePathLantern(-6.2, 7.4);

    // Boots by the porch.
    for (const x of [-0.3, 0.1]) {
      const boot = mesh(new THREE.BoxGeometry(0.12, 0.26, 0.2), standardMat({ color: 0x4b382b, roughness: 0.8 }), true);
      boot.position.set(-9.7 + x, 0.32, -1.42); this.scene.add(boot);
    }
  }

  /* ---------------------------------------------------------------- */
  _makeVegetation() {
    this._makeGrass();
    this._makeFlowers();
    this._makeTrees();
    this._makeBushes();
  }

  _nearPath(x, z, dist) {
    for (const p of this.pathSamples) {
      const dx = p[0] - x, dz = p[1] - z;
      if (dx * dx + dz * dz < dist * dist) return true;
    }
    return false;
  }

  _isOpenGround(x, z, pad = 0) {
    if (Math.hypot(x, z) > 52) return false;
    // keep the field, its fence and the main buildings clear
    if (x > 2.6 - pad && x < 15.4 + pad && z > -2.1 - pad && z < 6.9 + pad) return false;
    if (x > -17.3 - pad && x < -6.7 + pad && z > -9.4 - pad && z < -0.8 + pad) return false;
    if (x > 17.3 - pad && x < 28.8 + pad && z > -14.8 - pad && z < -5.8 + pad) return false;
    if (x > 16.0 - pad && x < 19.7 + pad && z > 10.2 - pad && z < 15.0 + pad) return false;
    if (x > 15.7 - pad && x < 21.8 + pad && z > -0.4 - pad && z < 3.3 + pad) return false;
    if (x > 1.2 - pad && x < 4.1 + pad && z > 9.2 - pad && z < 12.0 + pad) return false;
    if (x > -6.0 - pad && x < 0.0 + pad && z > 3.6 - pad && z < 11.5 + pad) return false;
    if (x > -20.8 - pad && x < -13.0 + pad && z > -16.7 - pad && z < -10.0 + pad) return false;
    const pdx = (x + 27) / (9.8 + pad), pdz = (z - 4.5) / (7.3 + pad);
    if (pdx * pdx + pdz * pdz < 1) return false;
    if (this._nearPath(x, z, 1.55 + pad)) return false;
    return true;
  }

  _makeGrass() {
    const blades = [];
    const blade = (angle, height, width, lean) => {
      const c = Math.cos(angle), s = Math.sin(angle);
      const g = new THREE.BufferGeometry();
      const verts = new Float32Array([
        -width / 2, 0, 0, width / 2, 0, 0,
        lean, height, 0,
      ]);
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const nrm = new THREE.Vector3(0.14, 1, 0.14).normalize();
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z]), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(angle));
      return g;
    };
    for (let i = 0; i < 3; i++) {
      blades.push(blade(i / 3 * TAU + 0.4, 0.24 + i * 0.045, 0.042, 0.035));
      blades.push(blade(i / 3 * TAU - 0.35, 0.19 + i * 0.035, 0.032, -0.02));
    }
    const geo = mergeGeometries(blades, false);
    const mat = standardMat({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide, vertexColors: false });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
        #else
          vec2 ip = vec2(0.0);
        #endif
        float bend = sin(uTime * 1.15 + ip.x * 0.53 + ip.y * 0.39) * 0.16
                   + sin(uTime * 2.3 + ip.x * 1.2 - ip.y * 0.8) * 0.035;
        transformed.x += bend * smoothstep(0.0, 0.3, transformed.y);
        transformed.z += bend * 0.44 * smoothstep(0.0, 0.3, transformed.y);`
      );
      mat.userData.shader = shader;
    };
    this.windyMats.push(mat);

    const COUNT = 8800;
    const inst = new THREE.InstancedMesh(geo, mat, COUNT);
    inst.castShadow = false; inst.receiveShadow = false;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let n = 0, guard = 0;
    while (n < COUNT && guard < COUNT * 8) {
      guard++;
      const x = (this.rand() - 0.5) * 96;
      const z = (this.rand() - 0.5) * 90 - 2;
      if (!this._isOpenGround(x, z, -0.05)) continue;
      // Leave a nicely mown apron around the house and front path.
      if (x > -16.8 && x < -7.2 && z > -9.5 && z < 7.5 && this.rand() < 0.7) continue;
      const y = groundHeight(x, z);
      const scale = 0.42 + this.rand() * 0.72;
      dummy.position.set(x, y, z);
      dummy.rotation.y = this.rand() * TAU;
      dummy.scale.set(0.75 + this.rand() * 0.45, scale, 0.75 + this.rand() * 0.45);
      dummy.updateMatrix();
      inst.setMatrixAt(n, dummy.matrix);
      const hue = 0.225 + (this.rand() - 0.5) * 0.04;
      color.setHSL(hue, 0.32 + this.rand() * 0.15, 0.23 + this.rand() * 0.12, THREE.SRGBColorSpace);
      inst.setColorAt(n, color);
      n++;
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.scene.add(inst);
    this.grassMesh = inst;

    // A few taller, seeded meadow grasses around the pond and hedges.
    const tallGeo = mergeGeometries([
      blade(0.2, 0.65, 0.028, 0.09), blade(1.4, 0.5, 0.025, -0.06),
      blade(2.6, 0.7, 0.022, 0.05), blade(4.1, 0.55, 0.02, -0.08),
    ], false);
    const tallMat = mat.clone();
    tallMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
        #else
          vec2 ip = vec2(0.0);
        #endif
        float bend = sin(uTime * 1.15 + ip.x * 0.53 + ip.y * 0.39) * 0.16
                   + sin(uTime * 2.3 + ip.x * 1.2 - ip.y * 0.8) * 0.035;
        transformed.x += bend * smoothstep(0.0, 0.3, transformed.y);
        transformed.z += bend * 0.44 * smoothstep(0.0, 0.3, transformed.y);`
      );
      tallMat.userData.shader = shader;
    };
    this.windyMats.push(tallMat);
    const tall = new THREE.InstancedMesh(tallGeo, tallMat, 950);
    let m = 0; guard = 0;
    while (m < 950 && guard < 30000) {
      guard++;
      const a = this.rand() * TAU;
      const r = 13 + this.rand() * 34;
      const x = -27 + Math.cos(a) * 10 + (this.rand() - 0.5) * 4;
      const z = 4.5 + Math.sin(a) * 8 + (this.rand() - 0.5) * 4;
      if (!this._isOpenGround(x, z, -0.3)) continue;
      const y = groundHeight(x, z);
      dummy.position.set(x, y, z);
      dummy.rotation.y = this.rand() * TAU;
      dummy.scale.set(0.8 + this.rand() * 0.6, 0.55 + this.rand() * 0.6, 0.8 + this.rand() * 0.6);
      dummy.updateMatrix();
      tall.setMatrixAt(m, dummy.matrix);
      color.setHSL(0.23 + this.rand() * 0.035, 0.30, 0.22 + this.rand() * 0.09, THREE.SRGBColorSpace);
      tall.setColorAt(m, color);
      m++;
    }
    tall.count = m;
    tall.castShadow = false; tall.receiveShadow = false;
    tall.instanceMatrix.needsUpdate = true;
    if (tall.instanceColor) tall.instanceColor.needsUpdate = true;
    this.scene.add(tall);
    this.tallGrass = tall;
  }

  _makeFlowers() {
    const sets = [
      { petal: '#d8ca9b', center: '#c69a46', count: 250 },
      { petal: '#bca8bd', center: '#c5a257', count: 140 },
      { petal: '#c28d72', center: '#b9853f', count: 120 },
    ];
    const dummy = new THREE.Object3D();
    for (const set of sets) {
      const parts = [];
      const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.24, 3);
      part(parts, stem, '#5e7039', 0, 0.12, 0);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU;
        part(parts, new THREE.PlaneGeometry(0.055, 0.09), set.petal,
          Math.cos(a) * 0.045, 0.25, Math.sin(a) * 0.045, -0.25, -a + Math.PI / 2, 0);
      }
      part(parts, new THREE.SphereGeometry(0.025, 5, 4), set.center, 0, 0.255, 0);
      const geo = mergeGeometries(parts, false);
      const inst = new THREE.InstancedMesh(geo, this.m.crop, set.count);
      let n = 0, guard = 0;
      while (n < set.count && guard < set.count * 15) {
        guard++;
        const x = (this.rand() - 0.5) * 78;
        const z = (this.rand() - 0.5) * 70 - 2;
        if (!this._isOpenGround(x, z, 0.1)) continue;
        // flowers cluster in loose drifts
        if (fbm(x * 0.12, z * 0.12, 2) < 0.42) continue;
        dummy.position.set(x, groundHeight(x, z) + 0.03, z);
        dummy.rotation.y = this.rand() * TAU;
        const s = 0.75 + this.rand() * 0.85;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        inst.setMatrixAt(n, dummy.matrix);
        n++;
      }
      inst.count = n;
      inst.castShadow = false;
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    }

    // flower drift at the foot of the porch and around the well
    const bedSpots = [
      [-15.6, 0.2, 0.8, 1.3], [-5.4, 0.2, 2.4, 1.0], [4.2, 0.2, 11.9, 1.3],
      [17.0, 0.2, 9.8, 0.9], [24.2, 0.2, -3.9, 1.2],
    ];
    const bedGeo = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + 0.2;
      const list = [];
      const h = 0.26 + this.rand() * 0.2;
      part(list, new THREE.CylinderGeometry(0.008, 0.012, h, 3), '#546a38', 0, h / 2, 0);
      for (let k = 0; k < 5; k++) {
        const aa = k / 5 * TAU;
        part(list, new THREE.PlaneGeometry(0.06, 0.1), i % 2 ? '#ddc58e' : '#c7a7b4',
          Math.cos(aa) * 0.05, h + 0.01, Math.sin(aa) * 0.05, -0.2, -aa + Math.PI / 2, 0);
      }
      part(list, new THREE.SphereGeometry(0.026, 5, 4), '#d1ad5e', 0, h + 0.015, 0);
      const g = mergeGeometries(list, false);
      g.translate(Math.cos(a) * (0.2 + this.rand() * 0.7), 0, Math.sin(a) * (0.2 + this.rand() * 0.4));
      bedGeo.push(g);
    }
    const beds = mergeGeometries(bedGeo, false);
    for (const [x, y, z, s] of bedSpots) {
      const fm = mesh(beds, this.m.crop, false, true);
      fm.position.set(x, y, z); fm.scale.setScalar(s); this.scene.add(fm);
    }
  }

  _makeTrees() {
    const foliageGeos = [];
    for (let v = 0; v < 4; v++) {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      const vv = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        vv.set(p.getX(i), p.getY(i), p.getZ(i));
        const n = 1 + (fbm(vv.x * 2.2 + v * 5.1, vv.z * 2.2 - v * 1.7, 3) - 0.48) * 0.52;
        vv.multiplyScalar(n);
        p.setXYZ(i, vv.x, vv.y, vv.z);
      }
      g.computeVertexNormals();
      foliageGeos.push(g);
    }
    this.foliageGeos = foliageGeos;
    this.leafMats = [this.m.leafDark, this.m.leafMid, this.m.leafLight];
    const trunkGeo = new THREE.CylinderGeometry(0.24, 0.39, 1, 8, 4);

    const branchBetween = (parent, a, b, r, mat) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const geo = new THREE.CylinderGeometry(r * 0.55, r, len, 6);
      const m = mesh(geo, mat, true, true);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
      parent.add(m);
    };

    const appleTransforms = [];
    const makeTree = (x, z, scale, opts = {}) => {
      const tree = new THREE.Group();
      const y = groundHeight(x, z);
      tree.position.set(x, y, z);
      const trunkH = (opts.trunkH || 3.0) * scale;
      const trunk = mesh(trunkGeo, this.m.bark, true, true);
      trunk.scale.set(1.25 * scale, trunkH, 1.25 * scale);
      trunk.position.y = trunkH / 2;
      trunk.rotation.y = this.rand() * TAU;
      tree.add(trunk);
      const spread = (opts.spread || 1.45) * scale;
      const canopyY = trunkH * 0.88;
      const clusterCount = opts.apples ? 9 : 12;
      const leafCenters = [];
      for (let i = 0; i < clusterCount; i++) {
        const a = i / clusterCount * TAU + this.rand() * 0.4;
        const r = spread * (0.25 + this.rand() * 0.8);
        const px = Math.cos(a) * r;
        const pz = Math.sin(a) * r * 0.85;
        const py = canopyY + (this.rand() - 0.25) * spread * 1.2;
        const geo = foliageGeos[(this.rand() * foliageGeos.length) | 0];
        const mat = this.leafMats[(this.rand() * 3) | 0];
        const cluster = mesh(geo, mat, true, true);
        cluster.position.set(px, py, pz);
        const cs = spread * (0.38 + this.rand() * 0.3);
        cluster.scale.set(cs * (0.85 + this.rand() * 0.4), cs * (0.66 + this.rand() * 0.28), cs * (0.85 + this.rand() * 0.35));
        cluster.rotation.set(this.rand() * 0.3, this.rand() * TAU, this.rand() * 0.2);
        tree.add(cluster);
        leafCenters.push([px, py, pz, cs]);
        if (Math.abs(px) + Math.abs(pz) > 0.5) {
          branchBetween(tree, V(0, trunkH * 0.62, 0), V(px * 0.8, py - 0.2, pz * 0.8), 0.09 * scale, this.m.bark);
        }
      }
      const center = mesh(foliageGeos[0], this.m.leafMid, true, true);
      center.position.set(0, canopyY + spread * 1.15, 0);
      center.scale.set(spread * 0.92, spread * 0.62, spread * 0.82);
      tree.add(center);
      // roots
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * TAU + 0.3;
        const root = mesh(new THREE.CylinderGeometry(0.04 * scale, 0.14 * scale, 0.85 * scale, 5), this.m.bark, true);
        root.position.set(Math.cos(a) * 0.4 * scale, 0.1, Math.sin(a) * 0.4 * scale);
        root.rotation.z = 1.22; root.rotation.y = -a;
        tree.add(root);
      }
      if (opts.apples) {
        for (const [cx, cy, cz, cs] of leafCenters) {
          for (let i = 0; i < 5; i++) {
            const a = this.rand() * TAU, rr = 0.5 + this.rand() * 0.85;
            appleTransforms.push({
              p: V(x + cx + Math.cos(a) * cs * 0.6 * rr, y + cy - 0.2 + (this.rand() - 0.3) * cs * 0.8, z + cz + Math.sin(a) * cs * 0.6 * rr),
              s: 0.55 + this.rand() * 0.35,
            });
          }
        }
      }
      this.scene.add(tree);
      return tree;
    };

    const oakSpots = [
      [-16.2, 16.3, 1.22, {}], [-6.4, -15.1, 1.18, {}], [31.0, 15.6, 1.05, {}],
      [32.0, -2.6, 0.82, {}], [-32.0, 18.0, 0.9, {}], [11.7, -18.0, 1.0, {}],
      [-3.6, 20.4, 0.8, {}],
    ];
    for (const [x, z, s, o] of oakSpots) {
      makeTree(x, z, s, o);
      if (Math.abs(x) < 36 && Math.abs(z) < 36) this.addObstacleCircle(x, z, 0.55 * s);
    }

    // Apple orchard behind the house.
    const orchard = [];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const x = -30.8 + col * 3.7, z = -20.8 + row * 4.8;
        const tree = makeTree(x, z, 0.78, { apples: true, trunkH: 2.7, spread: 1.5 });
        this.addObstacleCircle(x, z, 0.4);
        orchard.push(tree);
      }
    }

    const appleGeo = new THREE.SphereGeometry(0.075, 7, 6);
    const apples = new THREE.InstancedMesh(appleGeo, this.m.apple, appleTransforms.length);
    const dummy = new THREE.Object3D();
    appleTransforms.forEach((a, i) => {
      dummy.position.copy(a.p);
      dummy.scale.setScalar(a.s);
      dummy.rotation.set(0, this.rand() * TAU, 0);
      dummy.updateMatrix();
      apples.setMatrixAt(i, dummy.matrix);
    });
    apples.castShadow = true;
    apples.instanceMatrix.needsUpdate = true;
    this.scene.add(apples);

    // A few slender birches for variety.
    const makeBirch = (x, z, s) => {
      const tree = new THREE.Group();
      tree.position.set(x, groundHeight(x, z), z);
      const whiteBark = standardMat({ color: 0xc0b8a5, roughness: 0.9 });
      const trunk = mesh(new THREE.CylinderGeometry(0.15 * s, 0.24 * s, 4.4 * s, 7), whiteBark, true, true);
      trunk.position.y = 2.2 * s; tree.add(trunk);
      for (let i = 0; i < 5; i++) {
        const mark = mesh(new THREE.BoxGeometry(0.18 * s, 0.025 * s, 0.04 * s), standardMat({ color: 0x382f25, roughness: 1 }), false);
        mark.position.set(0.1 * s, 1.2 * s + this.rand() * 2.5 * s, 0.25 * s); mark.rotation.z = -0.2; tree.add(mark);
      }
      for (let i = 0; i < 5; i++) {
        const c = mesh(this.foliageGeos[i % 4], i % 2 ? this.m.leafLight : this.m.leafMid, true, true);
        c.position.set((this.rand() - 0.5) * 1.8 * s, 3.5 * s + (this.rand() - 0.5) * 1.5 * s, (this.rand() - 0.5) * 1.6 * s);
        c.scale.set(1.0 * s, 0.9 * s, 0.95 * s); tree.add(c);
      }
      this.scene.add(tree);
    };
    makeBirch(37, 8.5, 1.0);
    makeBirch(-17.5, -21, 0.9);

    // A quiet, far tree line. One instanced draw call for all of it.
    const pineParts = [];
    part(pineParts, new THREE.CylinderGeometry(0.16, 0.28, 1.9, 5), '#4e3c2a', 0, 0.95, 0);
    part(pineParts, new THREE.ConeGeometry(1.45, 2.4, 7), '#2f442d', 0, 2.45, 0);
    part(pineParts, new THREE.ConeGeometry(1.15, 2.0, 7), '#3a5132', 0, 3.55, 0);
    part(pineParts, new THREE.ConeGeometry(0.82, 1.7, 7), '#455c36', 0, 4.55, 0);
    const pineGeo = mergeGeometries(pineParts, false);
    const pineMat = standardMat({ vertexColors: true, roughness: 0.95, flatShading: true });
    const pines = new THREE.InstancedMesh(pineGeo, pineMat, 520);
    let pn = 0, guard = 0;
    while (pn < 520 && guard < 6000) {
      guard++;
      const a = this.rand() * TAU;
      const r = 54 + Math.pow(this.rand(), 0.6) * 125;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = groundHeight(x, z);
      if (y < 1.0) continue;
      if (fbm(x * 0.04, z * 0.04, 2) < 0.38) continue;
      dummy.position.set(x, y - 0.2, z);
      dummy.rotation.y = this.rand() * TAU;
      const s = 1.4 + this.rand() * 2.1;
      dummy.scale.set(s, s * (0.8 + this.rand() * 0.4), s);
      dummy.updateMatrix();
      pines.setMatrixAt(pn, dummy.matrix);
      const pc = new THREE.Color().setHSL(0.31 + this.rand() * 0.04, 0.24, 0.20 + this.rand() * 0.1, THREE.SRGBColorSpace);
      pines.setColorAt(pn, pc);
      pn++;
    }
    pines.count = pn;
    pines.castShadow = false; pines.receiveShadow = false;
    pines.instanceMatrix.needsUpdate = true;
    if (pines.instanceColor) pines.instanceColor.needsUpdate = true;
    this.scene.add(pines);

    // Fallen leaves on the orchard grass.
    const leafGeo = new THREE.CircleGeometry(0.1, 5);
    leafGeo.rotateX(-Math.PI / 2);
    const leafMat = standardMat({ color: 0xa46a3f, roughness: 1, side: THREE.DoubleSide });
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 260);
    for (let i = 0; i < 260; i++) {
      const x = -32 + this.rand() * 13, z = -23 + this.rand() * 12;
      dummy.position.set(x, groundHeight(x, z) + 0.035, z);
      dummy.rotation.set(0, this.rand() * TAU, 0);
      dummy.scale.setScalar(0.5 + this.rand() * 0.8);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
    }
    leaves.receiveShadow = true;
    leaves.instanceMatrix.needsUpdate = true;
    this.scene.add(leaves);
  }

  _makeBushes() {
    const spots = [
      [-14.2, 8.8, 0.8], [-8.9, 10.3, 0.7], [-18.4, -2.3, 0.9], [-6.4, -6.7, 0.75],
      [16.7, 9.2, 0.55], [27.3, -3.8, 0.8], [2.1, 13.2, 0.7], [-31.5, -2.5, 0.8],
      [-11.7, 14.4, 0.95], [33.0, 6.5, 0.9],
    ];
    for (const [x, z, s] of spots) {
      const b = new THREE.Group();
      b.position.set(x, groundHeight(x, z), z);
      for (let i = 0; i < 4; i++) {
        const m = mesh(this.foliageGeos[(this.rand() * 4) | 0], i % 2 ? this.m.leafMid : this.m.leafDark, true, true);
        m.position.set((this.rand() - 0.5) * 0.9 * s, 0.35 * s + this.rand() * 0.25, (this.rand() - 0.5) * 0.8 * s);
        m.scale.set(0.55 * s, 0.38 * s, 0.5 * s);
        b.add(m);
      }
      if (this.rand() > 0.4) {
        const flowerMat = standardMat({ color: this.rand() > 0.5 ? 0xd8c6a2 : 0xb77a86, roughness: 0.9 });
        for (let i = 0; i < 4; i++) {
          const f = mesh(new THREE.SphereGeometry(0.06, 5, 4), flowerMat, false);
          f.position.set((this.rand() - 0.5) * 1.0 * s, 0.55 * s + this.rand() * 0.15, (this.rand() - 0.5) * 0.8 * s);
          b.add(f);
        }
      }
      this.scene.add(b);
    }
  }

  /* ---------------------------------------------------------------- */
  _makeAnimals() {
    this._makeChickenCoop();
    this._makeDog();
    this._makeCow();
  }

  _makeChickenCoop() {
    const g = new THREE.Group();
    g.position.set(-16.4, 0, -12.7);
    g.rotation.y = 0.12;
    g.add(boxMesh(3.3, 0.24, 2.7, this.m.stone, 0, 0.12, 0, true));
    g.add(boxMesh(3.15, 1.8, 2.55, this.m.woodWarm, 0, 1.05, 0, true));
    for (const x of [-1.55, 1.55]) {
      for (const z of [-1.25, 1.25]) g.add(boxMesh(0.12, 1.85, 0.12, this.m.woodDark, x, 1.05, z, true));
    }
    // roof
    const ang = Math.atan2(0.95, 1.55);
    for (const side of [-1, 1]) {
      const panel = mesh(new THREE.BoxGeometry(3.6, 0.12, 1.85), this.m.roof, true, true);
      panel.rotation.x = side * ang;
      panel.position.set(0, 2.28, side * 0.75);
      g.add(panel);
    }
    const ridge = mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.62, 5), this.m.roof, true);
    ridge.rotation.z = Math.PI / 2; ridge.position.y = 2.75; g.add(ridge);
    // pop hole + ramp
    const hole = mesh(new THREE.CircleGeometry(0.25, 12), standardMat({ color: 0x1d1712, roughness: 1 }), false);
    hole.position.set(0.65, 0.75, 1.286); g.add(hole);
    const ramp = boxMesh(0.72, 0.07, 1.1, this.m.woodPale, 0.65, 0.45, 1.76, true);
    ramp.rotation.x = -0.33; g.add(ramp);
    // little window
    const win = boxMesh(0.6, 0.5, 0.05, this.m.glass, -0.6, 1.35, 1.29, false); g.add(win);
    for (let i = 0; i < 6; i++) g.add(boxMesh(0.06, 0.52, 0.07, this.m.woodPale, -0.84 + i * 0.28, 1.35, 1.31, false));
    this.scene.add(g);
    this.addObstacleBox(-16.4, -12.7, 1.75, 1.45);

    // fenced run
    const run = { x0: -19.3, x1: -13.5, z0: -11.1, z1: -7.0 };
    this.chickenRun = run;
    const fenceGroup = new THREE.Group();
    const postGeo = new THREE.BoxGeometry(0.09, 0.75, 0.09);
    const railGeo = new THREE.BoxGeometry(1, 0.05, 0.05);
    const addFenceLine = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 1.4));
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = lerp(ax, bx, t), z = lerp(az, bz, t);
        const p = mesh(postGeo, this.m.woodPale, true);
        p.position.set(x, 0.38, z); fenceGroup.add(p);
      }
      for (const y of [0.28, 0.55]) {
        const r = mesh(railGeo, this.m.woodPale, true);
        r.scale.x = len; r.position.set((ax + bx) / 2, y, (az + bz) / 2);
        r.rotation.y = -Math.atan2(bz - az, bx - ax); fenceGroup.add(r);
      }
    };
    addFenceLine(run.x0, run.z0, run.x0, run.z1);
    addFenceLine(run.x1, run.z0, run.x1, run.z1);
    addFenceLine(run.x0, run.z0, run.x1, run.z0);
    addFenceLine(run.x0, run.z1, -17.5, run.z1);
    addFenceLine(-15.3, run.z1, run.x1, run.z1);
    this.scene.add(fenceGroup);
    const dirtGeometry = new THREE.CircleGeometry(2.6, 20);
    dirtGeometry.rotateX(-Math.PI / 2);
    const dirtPatch = mesh(dirtGeometry, this.m.dirt, false, true);
    dirtPatch.position.set(-16.4, 0.035, -9.0); dirtPatch.scale.set(1.25, 1, 0.8);
    this.scene.add(dirtPatch);
    // scattered straw
    for (let i = 0; i < 40; i++) {
      const straw = mesh(new THREE.BoxGeometry(0.2 + this.rand() * 0.25, 0.015, 0.015), this.m.hay, false);
      straw.position.set(-18.8 + this.rand() * 5.0, 0.05, -10.7 + this.rand() * 3.3);
      straw.rotation.y = this.rand() * TAU; this.scene.add(straw);
    }

    const colors = ['#e8e0cf', '#c7a477', '#e4d5bc', '#8f6f50'];
    for (let i = 0; i < 5; i++) {
      const hen = this._makeChicken(colors[i % colors.length], i === 0);
      const x = -17.6 + this.rand() * 2.5;
      const z = -9.8 + this.rand() * 1.8;
      hen.position.set(x, groundHeight(x, z) + 0.03, z);
      hen.rotation.y = this.rand() * TAU;
      this.scene.add(hen);
      const data = {
        angle: this.rand() * TAU, speed: 0.12 + this.rand() * 0.12,
        timer: this.rand() * 4, peck: 0, bob: this.rand() * 4, group: hen,
        cx: -16.4, cz: -9.2,
      };
      hen.userData.walker = data;
      this.chickens.push(hen);
      this.interactables.push({
        id: 'chicken' + i, x, z, r: 1.3, label: i === 0 ? '逗逗大公鸡' : '摸摸母鸡', key: 'pet', dynamic: 'chicken',
        owner: hen,
      });
    }
  }

  _makeChicken(color, rooster) {
    const g = new THREE.Group();
    const bodyColor = standardMat({ color, roughness: 0.95 });
    const body = mesh(new THREE.SphereGeometry(0.28, 12, 10), bodyColor, true, true);
    body.position.y = 0.42; body.scale.set(0.9, 0.95, 1.35); g.add(body);
    const neck = mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.24, 8), bodyColor, true);
    neck.position.set(0, 0.64, 0.19); neck.rotation.x = -0.25; g.add(neck);
    const head = mesh(new THREE.SphereGeometry(0.16, 10, 8), bodyColor, true);
    head.position.set(0, 0.79, 0.26); g.add(head);
    const beak = mesh(new THREE.ConeGeometry(0.055, 0.18, 5), standardMat({ color: 0xd3a151, roughness: 0.8 }), true);
    beak.position.set(0, 0.77, 0.43); beak.rotation.x = Math.PI / 2; g.add(beak);
    const combMat = standardMat({ color: rooster ? 0xa83e33 : 0xb95848, roughness: 0.85 });
    const comb = mesh(new THREE.SphereGeometry(0.07, 6, 5), combMat, true);
    comb.position.set(0, 0.93, 0.24); comb.scale.set(0.5, 0.8, 1.3); g.add(comb);
    const wattle = mesh(new THREE.SphereGeometry(0.035, 5, 4), combMat, false);
    wattle.position.set(0, 0.68, 0.4); g.add(wattle);
    for (const side of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.018, 5, 4), this.m.darkMetal, false);
      eye.position.set(side * 0.09, 0.83, 0.38); g.add(eye);
      const wing = mesh(new THREE.SphereGeometry(0.18, 8, 6), bodyColor, true);
      wing.position.set(side * 0.22, 0.44, 0.02); wing.scale.set(0.4, 0.7, 1.2); g.add(wing);
      const leg = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 4), standardMat({ color: 0xd6a252, roughness: 0.8 }), true);
      leg.position.set(side * 0.1, 0.14, 0.08); g.add(leg);
      for (let t = 0; t < 3; t++) {
        const toe = mesh(new THREE.BoxGeometry(0.025, 0.012, 0.11), standardMat({ color: 0xd6a252, roughness: 0.8 }), false);
        toe.position.set(side * 0.1, 0.02, 0.13); toe.rotation.y = (t - 1) * 0.45; g.add(toe);
      }
    }
    if (rooster) {
      for (let i = 0; i < 4; i++) {
        const tail = mesh(new THREE.ConeGeometry(0.04, 0.55, 4), standardMat({ color: i % 2 ? 0x5e4b33 : 0x3d3124, roughness: 0.85 }), true);
        tail.position.set(0, 0.64 + i * 0.06, -0.28);
        tail.rotation.x = -1.0 - i * 0.12; tail.rotation.z = (i - 1.5) * 0.26; g.add(tail);
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const tail = mesh(new THREE.ConeGeometry(0.09, 0.3, 5), bodyColor, true);
        tail.position.set(0, 0.5, -0.33); tail.rotation.x = -1.1;
        tail.rotation.z = (i - 1) * 0.25; g.add(tail);
      }
    }
    g.scale.setScalar(rooster ? 1.12 : 0.92);
    return g;
  }

  _makeDog() {
    const dog = new THREE.Group();
    dog.position.set(-14.3, 0, 0.6);
    dog.rotation.y = 1.1;
    const fur = standardMat({ color: 0xb17d48, roughness: 1 });
    const furLight = standardMat({ color: 0xd3aa75, roughness: 1 });
    const dark = standardMat({ color: 0x3d2b1e, roughness: 1 });
    const body = mesh(new THREE.CapsuleGeometry(0.22, 0.55, 5, 9), fur, true);
    body.rotation.z = Math.PI / 2; body.position.y = 0.46; dog.add(body);
    const chest = mesh(new THREE.SphereGeometry(0.23, 10, 8), furLight, true);
    chest.position.set(0.35, 0.45, 0); dog.add(chest);
    const head = mesh(new THREE.SphereGeometry(0.2, 12, 9), furLight, true);
    head.position.set(0.53, 0.7, 0); head.scale.set(1.05, 0.95, 0.9); dog.add(head);
    const snout = mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.2, 8), furLight, true);
    snout.position.set(0.69, 0.64, 0); snout.rotation.z = Math.PI / 2; dog.add(snout);
    const nose = mesh(new THREE.SphereGeometry(0.045, 6, 5), dark, false);
    nose.position.set(0.79, 0.65, 0); dog.add(nose);
    for (const side of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.022, 5, 4), dark, false);
      eye.position.set(0.64, 0.76, side * 0.08); dog.add(eye);
      const ear = mesh(new THREE.SphereGeometry(0.1, 7, 5), fur, true);
      ear.position.set(0.48, 0.82, side * 0.16); ear.scale.set(0.6, 1.3, 0.55); dog.add(ear);
      for (const fx of [-0.3, 0.28]) {
        const leg = mesh(new THREE.CylinderGeometry(0.052, 0.065, 0.42, 6), fur, true);
        leg.position.set(fx, 0.22, side * 0.17); dog.add(leg);
        const paw = mesh(new THREE.SphereGeometry(0.075, 6, 4), furLight, true);
        paw.position.set(fx + 0.02, 0.035, side * 0.17); paw.scale.z = 1.25; dog.add(paw);
      }
    }
    const tail = new THREE.Group();
    tail.position.set(-0.4, 0.58, 0);
    const tailMesh = mesh(new THREE.CapsuleGeometry(0.055, 0.32, 4, 6), fur, true);
    tailMesh.position.set(-0.12, 0.12, 0); tailMesh.rotation.z = -0.7; tail.add(tailMesh);
    dog.add(tail);
    this.dog = dog;
    this.dogTail = tail;
    this.scene.add(dog);
    this.interactables.push({ id: 'dog', x: -14.3, z: 1.7, r: 1.8, label: '摸摸阿麦', key: 'dog' });
    // bowl
    const bowl = mesh(new THREE.CylinderGeometry(0.18, 0.13, 0.09, 12), standardMat({ color: 0x6d7f7d, roughness: 0.45, metalness: 0.25 }), true);
    bowl.position.set(-12.8, 0.05, 1.3); this.scene.add(bowl);
    const water = mesh(new THREE.CircleGeometry(0.14, 12), standardMat({ color: 0x5a7680, roughness: 0.1, metalness: 0.3 }), false);
    water.rotation.x = -Math.PI / 2; water.position.set(-12.8, 0.095, 1.3); this.scene.add(water);
  }

  _makeCow() {
    const g = new THREE.Group();
    g.position.set(30.1, 0, 2.5);
    g.rotation.y = -0.6;
    const hide = standardMat({ color: 0xd8d0bf, roughness: 0.95 });
    const patch = standardMat({ color: 0x6e4d38, roughness: 0.95 });
    const body = mesh(new THREE.SphereGeometry(0.85, 16, 12), hide, true);
    body.position.y = 1.28; body.scale.set(1.5, 0.9, 1.0); g.add(body);
    for (const [x, y, z, sx, sy, sz] of [
      [0.35, 1.45, 0.55, 0.45, 0.35, 0.15], [-0.45, 1.25, 0.6, 0.3, 0.4, 0.12],
      [0.1, 1.1, -0.65, 0.5, 0.32, 0.12],
    ]) {
      const p = mesh(new THREE.SphereGeometry(0.6, 10, 8), patch, false);
      p.position.set(x, y, z); p.scale.set(sx, sy, sz); g.add(p);
    }
    const neck = mesh(new THREE.CylinderGeometry(0.26, 0.38, 0.7, 9), hide, true);
    neck.position.set(1.22, 1.32, 0); neck.rotation.z = -0.3; g.add(neck);
    const head = mesh(new THREE.SphereGeometry(0.36, 12, 10), hide, true);
    head.position.set(1.48, 1.58, 0); head.scale.set(1.2, 0.9, 0.92); g.add(head);
    const muzzle = mesh(new THREE.SphereGeometry(0.22, 10, 7), standardMat({ color: 0xc3a392, roughness: 0.9 }), true);
    muzzle.position.set(1.76, 1.44, 0); muzzle.scale.set(1.1, 0.75, 0.9); g.add(muzzle);
    for (const side of [-1, 1]) {
      const nostril = mesh(new THREE.SphereGeometry(0.032, 5, 4), this.m.darkMetal, false);
      nostril.position.set(1.92, 1.47, side * 0.09); g.add(nostril);
      const eye = mesh(new THREE.SphereGeometry(0.04, 5, 4), this.m.darkMetal, false);
      eye.position.set(1.65, 1.67, side * 0.27); g.add(eye);
      const ear = mesh(new THREE.SphereGeometry(0.13, 7, 5), hide, true);
      ear.position.set(1.32, 1.69, side * 0.34); ear.scale.set(0.8, 0.55, 1.25); g.add(ear);
      const horn = mesh(new THREE.ConeGeometry(0.06, 0.25, 6), standardMat({ color: 0xc8bda4, roughness: 0.7 }), true);
      horn.position.set(1.45, 1.89, side * 0.22); horn.rotation.z = side * 0.5; g.add(horn);
    }
    for (const lx of [1.1, -0.9]) {
      for (const lz of [-0.42, 0.42]) {
        const leg = mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.0, 7), hide, true);
        leg.position.set(lx, 0.5, lz); g.add(leg);
        const hoof = mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.14, 7), this.m.darkMetal, true);
        hoof.position.set(lx, 0.07, lz); g.add(hoof);
      }
    }
    const udder = mesh(new THREE.SphereGeometry(0.24, 8, 6), standardMat({ color: 0xc9a08f, roughness: 0.9 }), true);
    udder.position.set(-0.65, 0.72, 0); udder.scale.set(1.2, 0.7, 0.9); g.add(udder);
    const tail = new THREE.Group();
    tail.position.set(-1.2, 1.55, 0);
    const tailMesh = mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.9, 5), patch, true);
    tailMesh.position.y = -0.45; tail.add(tailMesh);
    const tuft = mesh(new THREE.SphereGeometry(0.08, 6, 4), patch, true);
    tuft.position.y = -0.92; tail.add(tuft);
    g.add(tail);
    this.cow = g;
    this.cowTail = tail;
    this.cowHead = head;
    this.scene.add(g);
    this.interactables.push({ id: 'cow', x: 30.1, z: 4.3, r: 2.6, label: '看看花卷', key: 'cow' });

    // Wooden pasture fence and hay.
    const postGeo = new THREE.BoxGeometry(0.14, 1.1, 0.14);
    const railGeo = new THREE.BoxGeometry(1, 0.07, 0.07);
    const fence = new THREE.Group();
    const line = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 1.7));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = mesh(postGeo, this.m.fence, true);
        p.position.set(lerp(ax, bx, t), 0.55, lerp(az, bz, t)); fence.add(p);
      }
      for (const y of [0.38, 0.8]) {
        const r = mesh(railGeo, this.m.fence, true);
        r.scale.x = len; r.position.set((ax + bx) / 2, y, (az + bz) / 2);
        r.rotation.y = -Math.atan2(bz - az, bx - ax); fence.add(r);
      }
    };
    line(27.0, 0.0, 33.0, 0.0);
    line(27.0, 0.0, 27.0, 7.0);
    line(33.0, 0.0, 33.0, 7.0);
    line(27.0, 7.0, 29.1, 7.0);
    line(31.2, 7.0, 33.0, 7.0);
    this.scene.add(fence);
    const trough = boxMesh(1.2, 0.28, 0.42, this.m.woodDark, 29.1, 0.3, 6.3, true);
    this.scene.add(trough);
    const hayPile = mesh(new THREE.SphereGeometry(0.45, 8, 6), this.m.hay, true);
    hayPile.position.set(32.1, 0.25, 6.0); hayPile.scale.y = 0.5; this.scene.add(hayPile);
  }

  /* ---------------------------------------------------------------- */
  _makeAtmosphere() {
    // Chimney smoke.
    this.smokePuffs = [];
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.tex.glow, color: 0xc7b9a4, transparent: true, opacity: 0,
        depthWrite: false, fog: false,
      });
      const puff = new THREE.Sprite(mat);
      puff.position.copy(this.chimneyTop);
      puff.scale.setScalar(0.6);
      puff.userData.phase = i / 16;
      this.scene.add(puff);
      this.smokePuffs.push(puff);
    }

    // Birds, high above the valley.
    this.birds = [];
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, -0.85, 0, 0.16, -0.28, 0, -0.22,
    ], 3));
    wingGeo.computeVertexNormals();
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x303738, side: THREE.DoubleSide });
    const birdMat2 = new THREE.MeshBasicMaterial({ color: 0x475153, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const bird = new THREE.Group();
      const left = new THREE.Mesh(wingGeo, i % 2 ? birdMat : birdMat2);
      const right = new THREE.Mesh(wingGeo, i % 2 ? birdMat : birdMat2);
      right.scale.x = -1;
      bird.add(left, right);
      bird.userData = {
        left, right,
        radius: 22 + this.rand() * 38,
        height: 14 + this.rand() * 14,
        speed: 0.025 + this.rand() * 0.03,
        phase: this.rand() * TAU,
        wingSpeed: 5 + this.rand() * 3,
        centerX: (this.rand() - 0.5) * 16,
        centerZ: (this.rand() - 0.5) * 12,
      };
      bird.scale.setScalar(0.75 + this.rand() * 0.6);
      this.scene.add(bird);
      this.birds.push(bird);
    }

    // Butterflies near the flower beds.
    this.butterflies = [];
    const wingMatPale = new THREE.MeshBasicMaterial({ color: 0xe7d3a5, side: THREE.DoubleSide });
    const wingMatOrange = new THREE.MeshBasicMaterial({ color: 0xc98b62, side: THREE.DoubleSide });
    const wingMatWhite = new THREE.MeshBasicMaterial({ color: 0xe4e0cf, side: THREE.DoubleSide });
    const centers = [[-14.4, 2.0], [1.4, 12.2], [17.4, 9.5], [-22, 11.7], [26, -3.4], [-30, -14]];
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Group();
      const leftPivot = new THREE.Group(), rightPivot = new THREE.Group();
      const wing = new THREE.Mesh(new THREE.CircleGeometry(0.1, 7), [wingMatPale, wingMatWhite, wingMatOrange][i % 3]);
      wing.scale.set(1.25, 0.85, 1); wing.rotation.x = -Math.PI / 2; wing.position.x = 0.075;
      const wingR = wing.clone(); wingR.position.x = -0.075;
      leftPivot.add(wing); rightPivot.add(wingR);
      const body = mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.18, 4), this.m.darkMetal, false);
      body.rotation.x = Math.PI / 2;
      b.add(leftPivot, rightPivot, body);
      const c = centers[i % centers.length];
      b.userData = {
        left: leftPivot, right: rightPivot, center: c,
        phase: this.rand() * TAU, radius: 0.5 + this.rand() * 1.1,
        height: 0.55 + this.rand() * 0.8, speed: 0.7 + this.rand() * 0.55,
      };
      b.scale.setScalar(0.8 + this.rand() * 0.35);
      this.scene.add(b);
      this.butterflies.push(b);
    }

    // Fireflies for the blue hour.
    const fCount = 130;
    const fPos = new Float32Array(fCount * 3);
    this.fireflyBase = [];
    for (let i = 0; i < fCount; i++) {
      const a = this.rand() * TAU;
      const r = 3 + Math.pow(this.rand(), 0.7) * 35;
      const x = -4 + Math.cos(a) * r;
      const z = 4 + Math.sin(a) * r;
      const y = 0.3 + this.rand() * 2.6;
      this.fireflyBase.push({ x, y, z, phase: this.rand() * TAU, speed: 0.5 + this.rand() });
      fPos[i * 3] = x; fPos[i * 3 + 1] = y; fPos[i * 3 + 2] = z;
    }
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      map: this.tex.glow, color: 0xffd27a, size: 0.3, transparent: true,
      opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.fireflies = new THREE.Points(fGeo, this.fireflyMat);
    this.scene.add(this.fireflies);

    // Dust in the late sun.
    const mCount = 190;
    const mPos = new Float32Array(mCount * 3);
    for (let i = 0; i < mCount; i++) {
      mPos[i * 3] = (this.rand() - 0.5) * 46;
      mPos[i * 3 + 1] = 0.4 + this.rand() * 6;
      mPos[i * 3 + 2] = (this.rand() - 0.5) * 42;
    }
    const mGeo = new THREE.BufferGeometry();
    mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
    this.motes = new THREE.Points(mGeo, new THREE.PointsMaterial({
      map: this.tex.glow, color: 0xffe2b1, size: 0.09, transparent: true,
      opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.motes);

    // Rain, dormant until the sky decides otherwise.
    const rainCount = 950;
    const rPos = new Float32Array(rainCount * 6);
    this.rainSpeeds = new Float32Array(rainCount);
    for (let i = 0; i < rainCount; i++) {
      const x = (this.rand() - 0.5) * 30, z = (this.rand() - 0.5) * 30, y = this.rand() * 18;
      rPos[i * 6] = x; rPos[i * 6 + 1] = y; rPos[i * 6 + 2] = z;
      rPos[i * 6 + 3] = x + 0.02; rPos[i * 6 + 4] = y + 0.38; rPos[i * 6 + 5] = z;
      this.rainSpeeds[i] = 10 + this.rand() * 8;
    }
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
    this.rain = new THREE.LineSegments(rGeo, new THREE.LineBasicMaterial({
      color: 0xc3d4d8, transparent: true, opacity: 0.44, depthWrite: false,
    }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    this.rainY = new Float32Array(rainCount);
    for (let i = 0; i < rainCount; i++) this.rainY[i] = this.rand() * 18;
  }

  _makeMoonAndStars() {
    const starCount = 1100;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = this.rand() * 2 - 1;
      const a = this.rand() * TAU;
      const r = 600;
      const y = Math.abs(u) * r * 0.9 + 18;
      const s = Math.sqrt(Math.max(0, r * r - y * y));
      positions[i * 3] = Math.cos(a) * s;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(a) * s;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xf2ecd9, size: 2.0, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    this.moonGroup = new THREE.Group();
    const moon = mesh(new THREE.SphereGeometry(7, 20, 16), new THREE.MeshBasicMaterial({ color: 0xe8e1c9 }), false, false);
    this.moonGroup.add(moon);
    const glowMat = new THREE.SpriteMaterial({
      map: this.tex.glow, color: 0xc7d5e8, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(58, 58, 1);
    this.moonGroup.add(glow);
    this.moonGroup.visible = false;
    this.scene.add(this.moonGroup);

    this.moonLight = new THREE.DirectionalLight(0x8ba7cc, 0);
    this.scene.add(this.moonLight);
  }

  /* ---------------------------------------------------------------- */
  /*  Crop plots                                                         */
  /* ---------------------------------------------------------------- */
  _preparePlots() {
    const field = this.field;
    const plotHolder = new THREE.Group();
    this.scene.add(plotHolder);
    this.plotHolder = plotHolder;

    const soilGeo = new THREE.PlaneGeometry(1.66, 1.66, 1, 1);
    soilGeo.rotateX(-Math.PI / 2);
    const sheenMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.16, metalness: 0.0,
      transparent: true, opacity: 0.07, depthWrite: false,
    });

    const weedGeos = [];
    for (let v = 0; v < 3; v++) {
      const parts = [];
      const wr = mulberry32(100 + v);
      for (let i = 0; i < 18 + v * 4; i++) {
        const a = wr() * TAU, rr = Math.sqrt(wr()) * 0.66;
        const h = 0.22 + wr() * 0.34;
        part(parts, new THREE.PlaneGeometry(0.035 + wr() * 0.035, h), i % 4 ? '#546a35' : '#718043',
          Math.cos(a) * rr, h / 2 + 0.02, Math.sin(a) * rr, 0.1, a, (wr() - 0.5) * 0.45);
      }
      if (v === 1) {
        part(parts, new THREE.CylinderGeometry(0.008, 0.012, 0.36, 3), '#5e6c3d', 0.2, 0.23, 0.22);
        part(parts, new THREE.SphereGeometry(0.055, 6, 4), '#cbbd6a', 0.2, 0.43, 0.22);
      }
      weedGeos.push(mergeGeometries(parts, false));
    }
    this.weedGeos = weedGeos;

    let idx = 0;
    for (let r = 0; r < field.rows; r++) {
      for (let c = 0; c < field.cols; c++) {
        const x = field.cx + (c - (field.cols - 1) / 2) * field.pitch;
        const z = field.cz + (r - (field.rows - 1) / 2) * field.pitch;
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        const soil = mesh(soilGeo, this.m.soil, false, true);
        soil.position.y = 0.075;
        soil.visible = false;
        const sheen = mesh(soilGeo, sheenMat, false, false);
        sheen.position.y = 0.086; sheen.visible = false;
        const weeds = mesh(weedGeos[idx % 3], this.m.crop, false, true);
        weeds.position.y = 0.055;
        weeds.rotation.y = (idx * 2.17) % TAU;
        weeds.scale.setScalar(0.95 + (idx % 5) * 0.05);
        const cropHolder = new THREE.Group();
        cropHolder.position.y = 0.08;
        g.add(soil, sheen, weeds, cropHolder);
        plotHolder.add(g);
        this.plots.push({
          i: idx, r, c, x, z, group: g, soil, sheen, weeds, cropHolder,
          state: null,
        });
        idx++;
      }
    }

    const hlGeo = new THREE.PlaneGeometry(2.35, 2.35);
    hlGeo.rotateX(-Math.PI / 2);
    const hlGlowMat = new THREE.MeshBasicMaterial({
      map: this.tex.glow, color: 0xffd08a, transparent: true, opacity: 0.3,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const hlPlane = mesh(hlGeo, hlGlowMat, false, false);
    hlPlane.position.y = 0.16; hlPlane.renderOrder = 4;
    this.highlightGlowMaterial = hlGlowMat;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.76, 0.03, 1.76)),
      this.m.highlightLine
    );
    edges.position.y = 0.135;
    this.highlightGroup = new THREE.Group();
    this.highlightGroup.add(hlPlane, edges);
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex.glow, color: 0xffe2a8, transparent: true, opacity: 0.8,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    marker.scale.set(0.62, 0.62, 1);
    marker.position.y = 1.16;
    marker.renderOrder = 6;
    this.highlightMarker = marker;
    this.highlightGroup.add(marker);
    this.highlightGroup.visible = false;
    this.scene.add(this.highlightGroup);
    this.highlightIndex = -1;
  }

  getPlot(i) { return this.plots[i]; }

  setHighlight(i) {
    if (i === this.highlightIndex) return;
    this.highlightIndex = i;
    const p = this.plots[i];
    if (!p) { this.highlightGroup.visible = false; return; }
    this.highlightGroup.position.set(p.x, 0, p.z);
    this.highlightGroup.visible = true;
  }

  hideHighlight() { this.highlightGroup.visible = false; this.highlightIndex = -1; }

  setPlot(i, data) {
    const p = this.plots[i];
    if (!p) return;
    p.state = { ...data, crop: data.crop ? { ...data.crop } : null };
    p.soil.visible = !!data.tilled;
    p.weeds.visible = !data.tilled;
    p.soil.material = data.watered ? this.m.soilWet : this.m.soil;
    p.sheen.visible = !!(data.tilled && data.watered && !data.crop);
    while (p.cropHolder.children.length) {
      const child = p.cropHolder.children.pop();
      p.cropHolder.remove(child);
    }
    if (data.tilled && data.crop) {
      const geo = this._cropGeometry(data.crop.type, data.crop.stage);
      if (geo) {
        const crop = mesh(geo, this.m.crop, true, true);
        crop.rotation.y = (i * 1.37) % TAU;
        const s = 0.92 + (i % 4) * 0.035;
        crop.scale.setScalar(s);
        p.cropHolder.add(crop);
      }
    }
  }

  _cropGeometry(type, stage) {
    this._cropCache ||= {};
    const key = type + stage;
    if (this._cropCache[key]) return this._cropCache[key];
    const parts = [];
    const R = mulberry32(type.charCodeAt(0) * 97 + stage * 31 + type.length * 13);
    const P = (geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
      part(parts, geo, color, x, y, z, rx, ry, rz, sx, sy, sz);

    if (type === 'carrot') {
      const leaves = 4 + stage * 2;
      const h = 0.12 + stage * 0.075;
      for (let i = 0; i < leaves; i++) {
        const a = i / leaves * TAU + R() * 0.3;
        const rr = 0.02 + R() * 0.045;
        const lg = new THREE.PlaneGeometry(0.045 + R() * 0.02, h * (0.7 + R() * 0.4));
        lg.translate(0, h * 0.35, 0);
        P(lg, i % 3 ? '#536a34' : '#6c7d43', Math.cos(a) * rr, 0.015, Math.sin(a) * rr,
          -0.45 + R() * 0.9, a, (R() - 0.5) * 0.8);
      }
      if (stage >= 2) {
        P(new THREE.CylinderGeometry(0.06, 0.075, 0.12, 8), '#c17835', 0, 0.04, 0);
      }
    } else if (type === 'tomato') {
      const H = 0.45 + stage * 0.22;
      P(new THREE.CylinderGeometry(0.022, 0.028, H + 0.2, 5), '#5e4830', 0, (H + 0.2) / 2, 0);
      const branches = 3 + stage;
      for (let i = 0; i < branches; i++) {
        const a = i / branches * TAU + R() * 0.5;
        const bh = 0.18 + R() * H * 0.65;
        const bx = Math.cos(a) * 0.14, bz = Math.sin(a) * 0.14;
        P(new THREE.CylinderGeometry(0.012, 0.02, bh, 4), '#4f6532', bx * 0.55, 0.16 + bh / 2, bz * 0.55,
          (R() - 0.5) * 0.2, a, Math.cos(a) * 0.2);
        const leafCount = 5 + (stage > 1 ? 3 : 0);
        for (let k = 0; k < leafCount; k++) {
          const lg = new THREE.PlaneGeometry(0.14, 0.09);
          lg.rotateX(-Math.PI / 2);
          const ly = 0.22 + (k + 1) / (leafCount + 1) * bh;
          P(lg, k % 2 ? '#5d773d' : '#6c8146',
            bx * 0.8 + Math.cos(a + k * 2.1) * 0.08, ly, bz * 0.8 + Math.sin(a + k * 2.1) * 0.08,
            0, a + k * 2.1, 0, 1 + R() * 0.4, 1, 1);
        }
        if (stage >= 2) {
          const fruitN = stage >= 3 ? 3 : 1;
          for (let f = 0; f < fruitN; f++) {
            const fa = a + (f - 1) * 0.7;
            const fs = stage >= 3 ? 0.075 + R() * 0.02 : 0.045;
            const col = stage >= 3 ? (f % 2 ? '#b7492f' : '#c95c3d') : '#7e8a43';
            P(new THREE.SphereGeometry(fs, 8, 6), col,
              bx * 0.85 + Math.cos(fa) * 0.1, 0.26 + bh * (0.45 + f * 0.15), bz * 0.85 + Math.sin(fa) * 0.1,
              0, 0, 0, 1, 0.9, 1);
          }
        }
      }
      if (stage === 0) {
        for (let i = 0; i < 2; i++) {
          const lg = new THREE.PlaneGeometry(0.1, 0.07);
          lg.rotateX(-Math.PI / 2);
          P(lg, '#668040', (i ? 1 : -1) * 0.07, 0.2, 0, 0, R(), 0.2);
        }
      }
    } else if (type === 'wheat') {
      const stems = 14 + stage * 7;
      const h = 0.36 + stage * 0.21;
      const color = stage >= 2 ? '#b7a05d' : '#718045';
      const headColor = stage >= 2 ? '#c9ae63' : '#8a9652';
      for (let i = 0; i < stems; i++) {
        const a = R() * TAU, rr = 0.04 + R() * 0.28;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        const sh = h * (0.8 + R() * 0.4);
        P(new THREE.CylinderGeometry(0.006, 0.009, sh, 3), color, x, sh / 2, z,
          (R() - 0.5) * 0.15, 0, (R() - 0.5) * 0.15);
        const hl = 0.1 + stage * 0.035;
        P(new THREE.ConeGeometry(0.035, hl, 4), headColor, x, sh + hl * 0.35, z,
          (R() - 0.5) * 0.12, R() * TAU, (R() - 0.5) * 0.12);
      }
      if (stage === 0) {
        for (let i = 0; i < 3; i++) {
          const lg = new THREE.PlaneGeometry(0.08, 0.12);
          P(lg, '#6b7f42', (R() - 0.5) * 0.1, 0.08, (R() - 0.5) * 0.1, -0.4, R() * TAU, 0.3);
        }
      }
    } else if (type === 'pumpkin') {
      const leafN = 2 + stage * 2;
      for (let i = 0; i < leafN; i++) {
        const a = i / leafN * TAU + R() * 0.6;
        const r = 0.08 + stage * 0.1 + R() * 0.12;
        const lg = new THREE.CircleGeometry(0.11 + stage * 0.02, 7);
        lg.rotateX(-Math.PI / 2);
        P(lg, i % 2 ? '#506b37' : '#5d7540', Math.cos(a) * r, 0.08, Math.sin(a) * r,
          0, a, 0, 1.1 + R() * 0.4, 1, 1.15);
        if (stage >= 1) {
          P(new THREE.CylinderGeometry(0.012, 0.018, r * 1.2, 4), '#4c6130',
            Math.cos(a) * r * 0.5, 0.07, Math.sin(a) * r * 0.5, Math.PI / 2, a, 0);
        }
      }
      if (stage >= 2) {
        const size = stage >= 3 ? 0.24 : 0.12;
        const col = stage >= 3 ? '#c6762e' : '#7a8a44';
        P(new THREE.SphereGeometry(size, 12, 9), col, 0.03, size * 0.72, -0.02, 0, R() * TAU, 0, 1.15, 0.72, 1.0);
        P(new THREE.CylinderGeometry(0.028, 0.04, 0.1, 5), '#68552f', 0.03, size * 1.34, -0.02, 0.2, 0, 0.1);
        if (stage >= 3) {
          for (let i = 0; i < 6; i++) {
            const a = i / 6 * TAU;
            P(new THREE.SphereGeometry(0.055, 6, 5), '#d88b3b',
              0.03 + Math.cos(a) * 0.22, size * 0.7, -0.02 + Math.sin(a) * 0.15, 0, 0, 0, 0.7, 0.8, 0.5);
          }
        }
      }
    } else if (type === 'sunflower') {
      const H = [0.22, 0.52, 0.78, 1.02][stage];
      P(new THREE.CylinderGeometry(0.018, 0.032, H, 6), '#5a703a', 0, H / 2, 0);
      const leafN = 2 + stage * 2;
      for (let i = 0; i < leafN; i++) {
        const a = i / leafN * TAU + 0.3;
        const ly = 0.2 + (i / leafN) * H * 0.75;
        const lg = new THREE.PlaneGeometry(0.19, 0.11);
        lg.translate(0.095, 0, 0);
        P(lg, i % 2 ? '#567039' : '#657d43', 0, ly, 0, 0, a, -0.3);
      }
      if (stage >= 2) {
        const headY = H + 0.06;
        const headScale = stage >= 3 ? 1 : 0.55;
        P(new THREE.CylinderGeometry(0.1 * headScale, 0.1 * headScale, 0.035, 12), '#5e4829',
          0, headY, 0.015, Math.PI / 2, 0, 0);
        const petals = stage >= 3 ? 14 : 8;
        for (let i = 0; i < petals; i++) {
          const a = i / petals * TAU;
          const pg = new THREE.PlaneGeometry(0.065 * headScale, 0.2 * headScale);
          pg.translate(0, 0.13 * headScale, 0);
          P(pg, stage >= 3 ? '#e0b642' : '#b6a64b',
            Math.sin(a) * 0.025, headY + Math.cos(a) * 0.16 * headScale, 0.03,
            0, 0, -a, 1, 1, 1);
        }
      }
    }
    if (stage > 0) {
      const coverCount = 4 + stage * 2;
      for (let i = 0; i < coverCount; i++) {
        const a = i / coverCount * TAU + R() * 0.5;
        const rr = 0.1 + R() * 0.4;
        const cg = new THREE.PlaneGeometry(0.05 + R() * 0.035, 0.11 + R() * 0.13);
        P(cg, i % 3 ? '#536a36' : '#667b42', Math.cos(a) * rr, 0.06, Math.sin(a) * rr,
          0.2, a, (R() - 0.5) * 0.6);
      }
    }
    const geo = mergeGeometries(parts, false);
    if (geo) {
      geo.computeBoundingSphere();
      this._cropCache[key] = geo;
    }
    return geo;
  }

  /* ---------------------------------------------------------------- */
  /*  Light & weather                                                   */
  /* ---------------------------------------------------------------- */
  setEnvironment(hours, weather = 'sunny', force = false) {
    this.hours = hours;
    this.weather = weather;
    const dayProgress = (hours - 6) / 13;
    const elevation = Math.sin(dayProgress * Math.PI) * 58;
    const azimuth = 92 + clamp(dayProgress, 0, 1) * 172;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta).normalize();

    const day = smoothstep(-2.5, 5.5, elevation);
    const night = 1 - smoothstep(-6.0, 1.0, elevation);
    const starlight = 1 - smoothstep(-7.0, -1.5, elevation);
    const lightsOn = 1 - smoothstep(2.0, 13.0, elevation);
    const golden = day * (1 - smoothstep(12, 34, elevation));
    const rain = weather === 'rain' ? 1 : 0;
    const cloudy = weather === 'cloudy' ? 1 : 0;
    const overcast = Math.max(rain, cloudy * 0.72);
    const weatherSun = weather === 'sunny' ? 1 : weather === 'cloudy' ? 0.46 : 0.18;

    const sunColor = new THREE.Color('#ffa963').lerp(new THREE.Color('#fff1d7'), smoothstep(4, 34, elevation));
    sunColor.lerp(new THREE.Color('#dce2df'), overcast * 0.6);
    this.sunLight.color.copy(sunColor);
    this.sunLight.intensity = day * (3.15 + smoothstep(5, 42, elevation) * 1.65) * weatherSun;
    const sunDist = 76;
    this.sunLight.position.copy(this.sunDir).multiplyScalar(sunDist).add(V(1, 0, 2));
    this.sunLight.target.position.set(1, 0, 2);
    this.sunLight.castShadow = true;

    const skyTint = new THREE.Color('#b7cee0').lerp(new THREE.Color('#f0c696'), golden * 0.7);
    this.hemi.color.copy(skyTint).lerp(new THREE.Color('#263850'), starlight);
    this.hemi.groundColor.set('#5a4b37').lerp(new THREE.Color('#10151b'), starlight);
    this.hemi.intensity = 0.1 + day * (0.56 - overcast * 0.18);
    this.fillLight.intensity = 0.08 + day * 0.22;
    this.fillLight.color.set(overcast ? 0xaebfca : 0xa4bedb);
    this.ambient.intensity = 0.035 + day * 0.06;

    // Sky shader
    const sky = this.sky.material.uniforms;
    sky.turbidity.value = 2.9 + overcast * 10 + golden * 1.8;
    sky.rayleigh.value = 2.2 + overcast * 1.1 + starlight * 0.5;
    sky.mieCoefficient.value = 0.0032 + golden * 0.0024 + rain * 0.003;
    sky.mieDirectionalG.value = 0.82;
    sky.sunPosition.value.copy(this.sunDir);

    // Fog & exposure
    const fogCol = new THREE.Color('#b8cbc4').lerp(new THREE.Color('#dba97a'), golden * 0.68);
    fogCol.lerp(new THREE.Color('#111a24'), starlight * 0.94);
    fogCol.lerp(new THREE.Color('#8b9490'), overcast * 0.45);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = 0.0032 + starlight * 0.0024 + overcast * 0.0014;
    this.renderer.toneMappingExposure = 0.76 + day * 0.19 - starlight * 0.08;

    // Window glow & lanterns
    this.m.glass.emissiveIntensity = 0.06 + lightsOn * 1.05;
    for (const lamp of this.lampLights) lamp.intensity = 1.2 + lightsOn * 15;

    if (this.m.water) {
      const u = this.m.water.uniforms;
      u.uSky.value.copy(fogCol).lerp(new THREE.Color('#8dacb8'), day * 0.18);
      u.uDeep.value.set('#263b3a').lerp(new THREE.Color('#0e161d'), starlight * 0.7);
      u.uShallow.value.set('#6b8372').lerp(new THREE.Color('#24333c'), starlight * 0.8);
      u.uSun.value.copy(this.sunDir);
      u.uSunColor.value.copy(sunColor);
      u.uFogColor.value.copy(fogCol);
      u.uFogDensity.value = this.scene.fog.density;
    }

    // Cloud tint
    const cloudCol = new THREE.Color('#fff0da').lerp(new THREE.Color('#ffc895'), golden * 0.55);
    cloudCol.lerp(new THREE.Color('#c4cbca'), overcast * 0.65);
    cloudCol.lerp(new THREE.Color('#33465c'), starlight * 0.85);
    for (const c of this.cloudSprites) {
      c.material.color.copy(cloudCol);
      c.material.opacity = c.userData.baseOpacity * (0.38 + day * 0.78)
        * (weather === 'rain' ? 1.15 : weather === 'cloudy' ? 1.0 : 0.72);
    }

    if (this.starMat) {
      this.starMat.opacity = starlight * (weather === 'rain' ? 0.06 : 0.92);
    }
    if (this.moonGroup) {
      const moonDir = this.sunDir.clone().negate();
      moonDir.y = Math.abs(moonDir.y) + 0.15;
      moonDir.normalize();
      this.moonGroup.position.copy(moonDir).multiplyScalar(480);
      this.moonGroup.visible = starlight > 0.03;
      this.moonGroup.children.forEach((c) => { if (c.material) c.material.opacity = starlight * 0.9; });
      this.moonLight.position.copy(moonDir).multiplyScalar(50);
      this.moonLight.intensity = starlight * (weather === 'rain' ? 0.05 : 0.38);
    }
    if (this.fireflyMat) this.fireflyMat.opacity = starlight * 0.92;
    if (this.motes) this.motes.material.opacity = (0.10 + day * 0.26) * (1 - overcast * 0.65);
    if (this.rain) this.rain.visible = weather === 'rain';
    this.env = { elevation, day, night, starlight, lightsOn, golden, overcast, sunColor, fogCol };
  }

  /* ---------------------------------------------------------------- */
  update(dt, playerPos) {
    this._elapsed += dt;
    const t = this._elapsed;
    for (const mat of this.windyMats) {
      if (mat.userData.shader) mat.userData.shader.uniforms.uTime.value = t;
    }
    if (this.m.water) this.m.water.uniforms.uTime.value = t;

    // lazy clouds
    for (const c of this.cloudSprites) {
      c.position.x += c.userData.speed * dt * 0.35;
      if (c.position.x > 260) c.position.x = -260;
    }

    // smoke from the chimney
    for (const puff of this.smokePuffs) {
      const u = (t * 0.055 + puff.userData.phase) % 1;
      const sway = Math.sin(t * 0.5 + puff.userData.phase * 19) * 0.5;
      puff.position.set(
        this.chimneyTop.x + u * 2.6 + sway * u,
        this.chimneyTop.y + u * 4.3,
        this.chimneyTop.z - u * 0.8 + Math.cos(t * 0.4 + puff.userData.phase * 13) * 0.4 * u
      );
      const s = 0.45 + u * 2.8;
      puff.scale.set(s, s * 0.85, 1);
      puff.material.opacity = Math.sin(u * Math.PI) * (0.18 - u * 0.07);
    }

    // birds
    for (const bird of this.birds) {
      const d = bird.userData;
      const a = d.phase + t * d.speed;
      bird.position.set(
        d.centerX + Math.cos(a) * d.radius,
        d.height + Math.sin(t * 0.4 + d.phase) * 0.7,
        d.centerZ + Math.sin(a) * d.radius
      );
      bird.rotation.y = -a;
      const flap = Math.sin(t * d.wingSpeed + d.phase) * 0.55;
      d.left.rotation.z = -0.1 - flap;
      d.right.rotation.z = 0.1 + flap;
    }

    // butterflies
    for (const b of this.butterflies) {
      const d = b.userData;
      const a = d.phase + t * d.speed;
      b.position.set(
        d.center[0] + Math.cos(a) * d.radius + Math.sin(a * 2.3) * 0.35,
        d.height + Math.sin(t * 1.9 + d.phase) * 0.22,
        d.center[1] + Math.sin(a * 0.85) * d.radius
      );
      b.rotation.y = -a + 0.5;
      const flap = Math.sin(t * 15 + d.phase) * 0.9;
      d.left.rotation.z = 0.35 + flap;
      d.right.rotation.z = -0.35 - flap;
    }

    // fireflies
    if (this.fireflyMat && this.fireflyMat.opacity > 0.015) {
      const arr = this.fireflies.geometry.attributes.position.array;
      for (let i = 0; i < this.fireflyBase.length; i++) {
        const f = this.fireflyBase[i];
        arr[i * 3] = f.x + Math.sin(t * 0.55 * f.speed + f.phase) * 0.7;
        arr[i * 3 + 1] = f.y + Math.sin(t * 0.8 * f.speed + f.phase * 2) * 0.35;
        arr[i * 3 + 2] = f.z + Math.cos(t * 0.45 * f.speed + f.phase) * 0.7;
      }
      this.fireflies.geometry.attributes.position.needsUpdate = true;
    }
    if (this.stars) this.stars.rotation.y = t * 0.0025;

    // chickens
    for (const hen of this.chickens) {
      const d = hen.userData.walker;
      d.timer -= dt;
      if (d.timer <= 0) {
        d.timer = 1.6 + Math.random() * 3.8;
        if (Math.random() < 0.45) { d.speed = 0.0; d.peck = 0.7 + Math.random() * 0.8; }
        else { d.angle += (Math.random() - 0.5) * 2.4; d.speed = 0.08 + Math.random() * 0.13; d.peck = 0; }
      }
      const run = this.chickenRun;
      const nx = hen.position.x + Math.sin(d.angle) * d.speed * dt;
      const nz = hen.position.z + Math.cos(d.angle) * d.speed * dt;
      if (nx < run.x0 + 0.4 || nx > run.x1 - 0.4) d.angle += Math.PI;
      else if (nz < run.z0 + 0.4 || nz > run.z1 - 0.4) d.angle += Math.PI;
      else { hen.position.x = nx; hen.position.z = nz; }
      hen.rotation.y = d.angle;
      const pecking = d.peck > 0;
      if (pecking) {
        d.peck -= dt;
        hen.rotation.x = Math.max(0, Math.sin((1 - Math.max(0, d.peck)) * 10)) * 0.38;
        d.bob += dt * 14;
      } else {
        hen.rotation.x = damp(hen.rotation.x, 0, 6, dt);
        d.bob += dt * (d.speed > 0.01 ? 11 : 2.5);
      }
      hen.position.y = groundHeight(hen.position.x, hen.position.z) + 0.03 + Math.abs(Math.sin(d.bob)) * 0.018;
      const inter = this.interactables.find((o) => o.owner === hen);
      if (inter) { inter.x = hen.position.x; inter.z = hen.position.z; }
    }

    // dog: contented tail wag, a little more when petted
    if (this.dog) {
      const happy = this.dogHappyUntil && t < this.dogHappyUntil;
      this.dogTail.rotation.y = Math.sin(t * (happy ? 15 : 4.5)) * (happy ? 0.85 : 0.25) + 0.2;
      this.dog.children[0].scale.y = 0.95 + Math.sin(t * 1.4) * 0.015;
      if (happy) this.dog.position.y = Math.abs(Math.sin(t * 8)) * 0.16;
    }
    if (this.cow) {
      this.cowTail.rotation.z = Math.sin(t * 1.2) * 0.25;
      this.cowTail.rotation.x = Math.sin(t * 0.8 + 1) * 0.15;
      this.cowHead.rotation.y = Math.sin(t * 0.32) * 0.12;
    }
    if (this.shopkeeper) {
      this.shopkeeper.position.y = 0.12 + Math.sin(t * 1.6) * 0.006;
      this.shopkeeper.rotation.y = Math.sin(t * 0.3) * 0.05;
    }

    // highlight pulse
    if (this.highlightGroup.visible) {
      this.highlightGlowMaterial.opacity = 0.22 + Math.sin(t * 3.2) * 0.06;
      this.m.highlightLine.opacity = 0.72 + Math.sin(t * 3.2) * 0.22;
      this.highlightMarker.position.y = 1.16 + Math.sin(t * 2.4) * 0.07;
      this.highlightMarker.material.opacity = 0.56 + Math.sin(t * 3.1) * 0.16;
      this.highlightMarker.scale.setScalar(0.6 + Math.sin(t * 3.1) * 0.05);
    }

    // rain follows the player
    if (this.rain && this.rain.visible) {
      const pos = this.rain.geometry.attributes.position;
      const arr = pos.array;
      const p = playerPos || { x: 0, z: 0 };
      this.rain.position.set(p.x, 0, p.z);
      for (let i = 0; i < this.rainSpeeds.length; i++) {
        let y = arr[i * 6 + 1] - this.rainSpeeds[i] * dt;
        if (y < 0.0) y += 18;
        const x = arr[i * 6];
        const z = arr[i * 6 + 2];
        arr[i * 6 + 1] = y;
        arr[i * 6 + 4] = y + 0.38;
        arr[i * 6] = x + dt * 1.2;
        arr[i * 6 + 3] = x + dt * 1.2 + 0.02;
        if (arr[i * 6] > 15) { arr[i * 6] -= 30; arr[i * 6 + 3] -= 30; }
      }
      pos.needsUpdate = true;
    }
  }

  celebrateDog() { this.dogHappyUntil = this._elapsed + 2.5; }

  findPlotTarget(px, pz, fx, fz, current = -1) {
    let best = -1, bestScore = -Infinity;
    for (const p of this.plots) {
      const dx = p.x - px, dz = p.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.75) continue;
      let dot = (dx * fx + dz * fz) / Math.max(dist, 0.001);
      if (dist < 1.0) dot = Math.max(dot, 1.1 - dist);
      if (dot < 0.12) continue;
      let score = dot * 2.1 - dist * 0.34;
      if (p.i === current) score += 0.36; // keep the outlined plot stable
      if (score > bestScore) { bestScore = score; best = p.i; }
    }
    return best;
  }
}
