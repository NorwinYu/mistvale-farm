import * as THREE from 'three';
import './style.css';
import { createTextures } from './textures.js';
import { FarmWorld } from './world.js';
import { Character } from './character.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (s) => document.querySelector(s);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let renderer, scene, camera, world, character, game, ui, audio, composer, bloomPass;

async function boot() {
  ui = new UI();
  ui.setLoading(0.06, '正在解开山谷的晨雾…');
  await wait(80);

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
  } catch (err) {
    fail(err);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  const stage = $('#stage');
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '雾谷农庄 3D 场景');

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 2200);
  camera.position.set(16, 9, 31);
  scene.add(camera);

  ui.setLoading(0.18, '正在铺开草甸…');
  await nextFrame();

  const textures = createTextures(renderer);
  ui.setLoading(0.32, '正在把石头垒成墙…');
  await wait(70);
  world = new FarmWorld(scene, renderer, textures);
  await nextFrame();
  ui.setLoading(0.62, '正在种下第一排向日葵…');
  await wait(80);

  character = new Character(scene);
  character.root.visible = false;
  ui.setLoading(0.8, '正在生起木屋的炉火…');
  await nextFrame();

  audio = new AudioEngine();
  game = new Game(world, character, ui, renderer, camera, audio);
  ui.bindGame(game);
  window.__FARM__ = { game, world, character, ui, audio, scene, camera, renderer };

  // A restrained post chain: scene -> bloom -> ACES/sRGB output.
  const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType, samples: 2,
  });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.105, 0.55, 3.0);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  window.addEventListener('resize', onResize);
  window.addEventListener('pagehide', () => { if (game?.mode === 'playing') game.save(); });
  onResize();

  ui.setLoading(0.94, '正在等一壶水烧开…');
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
    last = now;
    game.update(dt);
    world.update(dt, { x: game.playerX, z: game.playerZ });
    renderer.info.reset();
    composer.render(dt);
    if (window.__STATS) {
      window.__STATS.calls = renderer.info.render.calls;
      window.__STATS.triangles = renderer.info.render.triangles;
      window.__STATS.mode = game.mode;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  ui.setLoading(1, '欢迎来到雾谷农庄');
  await wait(500);
  await nextFrame();
  ui.hideLoading();
  await wait(500);
  game.presentTitle();
  window.__READY = true;
  window.__STATS = {
    renderer: renderer.getContext().getParameter(renderer.getContext().VERSION),
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    mode: 'title',
  };
}

function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(w, h);
  if (composer) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
  }
}

function fail(err) {
  console.error('Mistvale Farm failed to start:', err);
  ui?.hideLoading();
  $('#fatal-error')?.classList.remove('hidden');
  $('#title-screen')?.classList.add('hidden');
}

boot().catch(fail);
