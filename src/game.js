import * as THREE from 'three';
import { CROPS, ITEMS, WEATHER, seasonForDay, weatherForDay, formatInGameTime } from './data.js';
import { clamp, lerp, smoothstep, groundHeight, TAU } from './utils.js';

const SAVE_KEY = 'mistvale-farm-save-v1';
const SEC_PER_GAME_MINUTE = 2.4;
const SPAWN = { x: 8.85, z: 13.0 };

const clone = (v) => JSON.parse(JSON.stringify(v));
const angleDelta = (a, b) => {
  let d = (b - a + Math.PI) % TAU;
  if (d < 0) d += TAU;
  return d - Math.PI;
};

const QUEST_DEFS = [
  {
    name: '初来乍到',
    reward: 120,
    objectives: [
      { text: '开垦一块土地', test: (s) => s.stats.tilled >= 1 },
      { text: '在土里种下一颗种子', test: (s) => s.stats.planted >= 1 },
      { text: '给作物浇水', test: (s) => s.stats.watered >= 1 },
      { text: '回木屋好好睡一觉', test: (s) => s.stats.slept >= 1 },
    ],
  },
  {
    name: '把新鲜带回家',
    reward: 180,
    objectives: [
      { text: '收获 3 株作物', test: (s) => s.stats.harvested >= 3 },
      { text: '在出货箱卖一次收成', test: (s) => s.stats.sold >= 1 },
      { text: '去谷雨杂货铺买一包种子', test: (s) => s.stats.bought >= 1 },
    ],
  },
  {
    name: '山谷渐渐熟了',
    reward: 350,
    objectives: [
      { text: '累计收获 10 株作物', test: (s) => s.stats.harvested >= 10 },
      { text: '亲手种下 8 颗种子', test: (s) => s.stats.planted >= 8 },
      { text: '攒下 900 枚金币', test: (s) => s.money >= 900 },
    ],
  },
  {
    name: '四季与来客',
    reward: 600,
    objectives: [
      { text: '在农庄住满 4 天', test: (s) => s.stats.slept >= 4 },
      { text: '累计收获 20 株作物', test: (s) => s.stats.harvested >= 20 },
      { text: '攒下 1800 枚金币', test: (s) => s.money >= 1800 },
    ],
  },
];

export class Game {
  constructor(world, character, ui, renderer, camera, audio) {
    this.world = world;
    this.character = character;
    this.ui = ui;
    this.renderer = renderer;
    this.camera = camera;
    this.audio = audio;

    this.mode = 'title';
    this.keys = new Set();
    this.elapsed = 0;
    this.titleTime = 0;
    this.introTime = 0;
    this.introDuration = 2.6;
    this.sleepInProgress = false;
    this._envTimer = 0;
    this._hudTimer = 0;
    this._saveTimer = 0;
    this._targetTimer = 0;
    this._hintTimer = 0;
    this._warning22 = false;
    this._warning2330 = false;
    this._contextKey = null;
    this._lastPromptKey = null;
    this.targetPlot = -1;
    this.nearestObject = null;
    this._dragging = false;
    this._dragMoved = false;
    this._pointerStart = { x: 0, y: 0 };
    this._lastPointer = { x: 0, y: 0 };
    this.camYaw = 0.045;
    this.camPitch = 0.225;
    this.camDistance = 8.4;
    this.camDistanceTarget = 8.4;
    this.cameraFocus = new THREE.Vector3(SPAWN.x, 1.3, SPAWN.z);
    this.camGoal = new THREE.Vector3();
    this.camDir = new THREE.Vector3();
    this.moveDir = new THREE.Vector3();
    this.velocity = new THREE.Vector2();
    this.touchInput = { x: 0, y: 0 };
    this.playerX = SPAWN.x;
    this.playerZ = SPAWN.z;
    this.playerFacing = Math.PI;
    this.audioStarted = false;
    this.muted = false;
    this.hasSave = false;
    this.savedGame = null;
    this.saveNoticeShown = false;
    this._steps = 0;

    this.savedGame = this.readSave();
    this.hasSave = !!this.savedGame;
    this.state = this.savedGame ? this.hydrateState(this.savedGame.state) : this.makeInitialState();
    this.applyStateToWorld();
    this.previewPlayerFromState();
    this.ui.renderSeedOptions(this.state.seeds, this.state.selectedSeed);
    this.ui.setSeed(this.state.selectedSeed, this.state.seeds[this.state.selectedSeed] || 0);
    this.ui.setTool(this.state.tool);
    this.character.setTool(this.state.tool);
    this.character.root.visible = false;
    this.ui.renderQuest(this.questView());
    this.updateHudValues(false);
    this.bindEvents();
    this.updateTitleCamera(0);
  }

  /* ================================================================ */
  /*  State                                                            */
  /* ================================================================ */
  makeInitialState() {
    const plots = [];
    for (let i = 0; i < 24; i++) plots.push({ tilled: false, watered: false, crop: null });
    const plant = (i, type, stage, watered = false) => {
      plots[i] = { tilled: true, watered, crop: { type, stage } };
    };
    plant(0, 'wheat', 3);
    plant(1, 'tomato', 2, true);
    plant(2, 'sunflower', 3);
    plant(3, 'pumpkin', 2);
    plant(4, 'carrot', 2);
    plant(6, 'carrot', 1);
    plant(7, 'wheat', 1, true);
    plant(8, 'sunflower', 2);
    plant(9, 'tomato', 3);
    plant(10, null, 0); plots[10] = { tilled: true, watered: false, crop: null };
    plant(12, 'wheat', 2);
    plant(13, 'tomato', 3);
    plant(14, 'carrot', 2, true);
    plant(16, 'pumpkin', 1);
    plant(17, 'sunflower', 2);
    plant(18, 'pumpkin', 3);
    plant(19, 'tomato', 1);
    plant(21, null, 0); plots[21] = { tilled: true, watered: true, crop: null };
    plant(22, 'wheat', 2);
    plant(23, 'carrot', 3);

    return {
      day: 1,
      time: 17 * 60 + 50,
      weather: 'sunny',
      money: 420,
      energy: 100,
      maxEnergy: 100,
      water: 14,
      waterMax: 14,
      seeds: { carrot: 8, wheat: 6, tomato: 4, sunflower: 3, pumpkin: 2 },
      produce: {},
      plots,
      tool: 'hoe',
      selectedSeed: 'carrot',
      stats: { tilled: 0, planted: 0, watered: 0, harvested: 0, sold: 0, bought: 0, slept: 0 },
      questStage: 0,
      letterRead: false,
      dayFlags: { egg: false, milked: false, dock: false },
      introSeen: false,
    };
  }

  hydrateState(raw) {
    const base = this.makeInitialState();
    if (!raw || typeof raw !== 'object') return base;
    const s = { ...base, ...raw };
    s.stats = { ...base.stats, ...(raw.stats || {}) };
    s.seeds = { ...base.seeds, ...(raw.seeds || {}) };
    s.produce = { ...(raw.produce || {}) };
    s.dayFlags = { ...base.dayFlags, ...(raw.dayFlags || {}) };
    s.tool = ['hoe', 'can', 'seeds', 'sickle'].includes(raw.tool) ? raw.tool : 'hoe';
    s.selectedSeed = CROPS[raw.selectedSeed] ? raw.selectedSeed : 'carrot';
    s.money = Math.max(0, Number(raw.money) || 0);
    s.energy = clamp(Number(raw.energy) || 0, 0, Number(raw.maxEnergy) || 100);
    s.water = clamp(Number(raw.water) || 0, 0, Number(raw.waterMax) || 14);
    s.maxEnergy = Number(raw.maxEnergy) || 100;
    s.waterMax = Number(raw.waterMax) || 14;
    s.time = clamp(Number(raw.time) || 1040, 360, 1439);
    s.day = Math.max(1, Math.floor(Number(raw.day) || 1));
    s.weather = WEATHER[raw.weather] ? raw.weather : 'sunny';
    s.questStage = clamp(Math.floor(Number(raw.questStage) || 0), 0, QUEST_DEFS.length);
    s.plots = base.plots.map((p, i) => {
      const rp = Array.isArray(raw.plots) ? raw.plots[i] : null;
      if (!rp) return p;
      const crop = rp.crop && CROPS[rp.crop.type]
        ? { type: rp.crop.type, stage: clamp(Math.floor(Number(rp.crop.stage) || 0), 0, 3) }
        : null;
      return { tilled: !!rp.tilled, watered: !!rp.watered, crop };
    });
    return s;
  }

  readSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !parsed.state) return null;
      if (!Array.isArray(parsed.state.plots) || parsed.state.plots.length !== 24) return null;
      return parsed;
    } catch { return null; }
  }

  save() {
    if (this.mode !== 'playing' && !this.saveNoticeShown) return;
    try {
      const payload = {
        v: 1,
        savedAt: Date.now(),
        state: this.state,
        player: { x: this.playerX, z: this.playerZ, facing: this.playerFacing },
        camera: { yaw: this.camYaw, pitch: this.camPitch, distance: this.camDistance },
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      this.hasSave = true;
    } catch { /* a full localStorage should never stop the harvest */ }
  }

  deleteSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    this.hasSave = false;
    this.savedGame = null;
  }

  applyStateToWorld() {
    this.state.plots.forEach((p, i) => this.world.setPlot(i, p));
  }

  previewPlayerFromState() {
    const p = this.savedGame?.player;
    this.playerX = p?.x ?? SPAWN.x;
    this.playerZ = p?.z ?? SPAWN.z;
    this.playerFacing = p?.facing ?? Math.PI;
    this.placeCharacter();
    if (this.savedGame?.camera) {
      this.camYaw = Number(this.savedGame.camera.yaw) || this.camYaw;
      this.camPitch = clamp(Number(this.savedGame.camera.pitch) || this.camPitch, 0.06, 0.9);
      this.camDistance = clamp(Number(this.savedGame.camera.distance) || this.camDistance, 4.2, 11.5);
      this.camDistanceTarget = this.camDistance;
    }
  }

  placeCharacter() {
    this.character.root.position.set(this.playerX, groundHeight(this.playerX, this.playerZ) + 0.02, this.playerZ);
    this.character.root.rotation.y = this.playerFacing;
  }

  /* ================================================================ */
  /*  Lifecycle                                                        */
  /* ================================================================ */
  presentTitle() {
    this.mode = 'title';
    this.character.root.visible = false;
    this.ui.hideLoading();
    this.ui.showTitle(this.hasSave);
    this.updateTitleCamera(0);
  }

  async startNew() {
    if (this.mode === 'playing') return;
    this.deleteSave();
    this.state = this.makeInitialState();
    this.playerX = SPAWN.x;
    this.playerZ = SPAWN.z;
    this.playerFacing = Math.PI;
    this.camYaw = 0.045; this.camPitch = 0.225; this.camDistance = this.camDistanceTarget = 8.4;
    this.beginPlay('new');
  }

  async continueGame() {
    if (this.mode === 'playing') return;
    if (!this.savedGame) { this.startNew(); return; }
    this.state = this.hydrateState(this.savedGame.state);
    this.previewPlayerFromState();
    this.beginPlay('continue');
  }

  beginPlay(kind) {
    this.audio.start().then(() => this.audio.setWeather(this.state.weather)).catch(() => {});
    this.audioStarted = true;
    this.applyStateToWorld();
    this.placeCharacter();
    this.character.root.visible = true;
    this.character.setTool(this.state.tool);
    this.cameraFocus.set(this.playerX, 1.35, this.playerZ);
    this.mode = 'playing';
    this.introTime = this.introDuration;
    this._introFromPos = this.camera.position.clone();
    this._introFromFocus = new THREE.Vector3();
    this.camera.getWorldDirection(this.camDir);
    this._introFromFocus.copy(this.camera.position).addScaledVector(this.camDir, 8);
    this.ui.hideTitle();
    this.ui.showHud();
    this.ui.closeModal();
    this.ui.closeSeedPopover();
    this.updateHudValues(false);
    this.world.setEnvironment(this.state.time / 60, this.state.weather, true);
    this.audio.setWeather(this.state.weather);
    this.save();
    this._warning22 = false;
    this._warning2330 = false;
    this._envTimer = 0;
    this._hudTimer = 0;
    this._saveTimer = 0;
    this.keys.clear();

    setTimeout(() => {
      if (this.mode !== 'playing') return;
      if (kind === 'new') {
        this.ui.toast('欢迎来到雾谷农庄。山谷里的风已经等你很久了。');
      } else {
        this.ui.toast(`欢迎回来 · 第 ${this.state.day} 日`);
      }
    }, 1200);
    if (kind === 'new') {
      setTimeout(() => {
        if (this.mode === 'playing') this.ui.toast('按 1 拿起锄头，到菜圃旁翻一块土。');
      }, 4300);
      setTimeout(() => {
        if (this.mode === 'playing') this.ui.toast('信箱里好像有一封给你的信。', '');
      }, 7600);
    }
  }

  /* ================================================================ */
  /*  Input                                                             */
  /* ================================================================ */
  bindEvents() {
    this.onKeyDown = (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (this.ui.isModalOpen()) { this.closeModal(); return; }
        if (this.ui._seedOpen) { this.ui.closeSeedPopover(); return; }
      }
      if (this.mode !== 'playing') return;
      if (this.ui.isModalOpen() || this.ui.isTransitioning()) return;

      if (['w', 'a', 's', 'd', 'shift'].includes(key)) {
        this.keys.add(key);
        return;
      }
      if (key === 'e') { e.preventDefault(); this.performAction(); return; }
      if (key === 'q') { this.cycleSeed(); return; }
      if (key === '1') { this.selectTool('hoe'); return; }
      if (key === '2') { this.selectTool('can'); return; }
      if (key === '3') { this.selectTool('seeds'); return; }
      if (key === '4') { this.selectTool('sickle'); return; }
      if (key === 'b' || key === 'i') { this.openJournal(); return; }
      if (key === 'h') { this.togglePhotoMode(); return; }
      if (key === 'm') { this.toggleMute(); return; }
      if (key === '?' || (key === '/' && e.shiftKey)) { this.openGuide(); return; }
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());

    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.mode !== 'playing' || this.ui.isModalOpen() || this.ui.isTransitioning()) return;
      this._dragging = true;
      this._dragMoved = false;
      this._pointerStart = { x: e.clientX, y: e.clientY };
      this._lastPointer = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    });
    window.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastPointer.x;
      const dy = e.clientY - this._lastPointer.y;
      this._lastPointer = { x: e.clientX, y: e.clientY };
      if (Math.abs(e.clientX - this._pointerStart.x) + Math.abs(e.clientY - this._pointerStart.y) > 5) {
        if (!this._dragMoved) document.body.classList.add('is-dragging');
        this._dragMoved = true;
      }
      if (this._dragMoved) {
        this.camYaw -= dx * 0.0052;
        this.camPitch = clamp(this.camPitch + dy * 0.0034, 0.055, 0.92);
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (!this._dragging) return;
      const wasMoved = this._dragMoved;
      this._dragging = false;
      this._dragMoved = false;
      document.body.classList.remove('is-dragging');
      if (!wasMoved && e.button === 0 && e.pointerType !== 'touch' && this.mode === 'playing' && !this.ui.isModalOpen() && !this.ui.isTransitioning()) {
        this.performAction();
      }
    });
    window.addEventListener('pointercancel', () => {
      this._dragging = false; this._dragMoved = false;
      document.body.classList.remove('is-dragging');
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.mode !== 'playing' || this.ui.isModalOpen() || this.ui.isTransitioning()) return;
      e.preventDefault();
      this.camDistanceTarget = clamp(this.camDistanceTarget + Math.sign(e.deltaY) * 0.7, 4.2, 11.5);
    }, { passive: false });

    // Touch joystick and action button for phones and tablets.
    const joystick = document.getElementById('joystick');
    const thumb = document.getElementById('joystick-thumb');
    const actionBtn = document.getElementById('touch-action');
    if (joystick && thumb && this.ui.isTouch) {
      let activeId = null;
      const reset = () => {
        activeId = null;
        this.touchInput.x = 0; this.touchInput.y = 0;
        thumb.style.transform = 'translate(0px, 0px)';
      };
      const move = (e) => {
        if (activeId !== e.pointerId) return;
        const rect = joystick.getBoundingClientRect();
        let dx = e.clientX - (rect.left + rect.width / 2);
        let dy = e.clientY - (rect.top + rect.height / 2);
        const max = rect.width * 0.3;
        const len = Math.hypot(dx, dy);
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        this.touchInput.x = dx / max;
        this.touchInput.y = dy / max;
        thumb.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      joystick.addEventListener('pointerdown', (e) => {
        if (this.mode !== 'playing' || this.ui.isModalOpen() || this.ui.isTransitioning()) return;
        activeId = e.pointerId;
        try { joystick.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointers */ }
        move(e);
        e.preventDefault();
      });
      joystick.addEventListener('pointermove', (e) => { if (activeId === e.pointerId) { move(e); e.preventDefault(); } });
      window.addEventListener('pointermove', (e) => {
        if (activeId === null || e.pointerId !== activeId) return;
        move(e);
        e.preventDefault();
      }, { passive: false });
      window.addEventListener('pointerup', (e) => { if (e.pointerId === activeId) reset(); });
      window.addEventListener('pointercancel', (e) => { if (e.pointerId === activeId) reset(); });
      actionBtn?.addEventListener('click', () => {
        if (this.mode !== 'playing' || this.ui.isModalOpen() || this.ui.isTransitioning()) return;
        this.performAction();
      });
    }

    window.addEventListener('beforeunload', () => { if (this.mode === 'playing') this.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'playing') this.save(); });
  }

  /* ================================================================ */
  /*  Main update                                                      */
  /* ================================================================ */
  update(dt) {
    this.elapsed += dt;
    if (this.mode === 'title') {
      this.updateTitleCamera(dt);
      return;
    }
    const paused = this.ui.isModalOpen() || this.ui.isTransitioning();
    this._saveTimer += dt;
    if (this._saveTimer > 22 && !paused) { this._saveTimer = 0; this.save(); }

    if (!paused) {
      this.updateClock(dt);
      this.updateMovement(dt);
      this.updateHudTimer(dt);
      this.updateEnvironment(dt);
      this.updateAudio(dt);
      this.updateContext();
      this.updateHints(dt);
    } else {
      this.character.update(dt, false, false, 0);
    }
    this.updateCamera(dt);
    this.camDistance = lerp(this.camDistance, this.camDistanceTarget, 1 - Math.exp(-8 * dt));
  }

  updateTitleCamera(dt) {
    this.titleTime += dt;
    const t = this.titleTime;
    const sway = Math.sin(t * 0.045) * 0.55;
    this.camera.position.set(15.0 + sway, 6.5 + Math.sin(t * 0.11) * 0.1, 26.2 - sway * 0.55);
    this.camera.lookAt(-1.0, 2.1, -2.2);
    this.cameraFocus.set(-1.0, 2.1, -2.2);
  }

  updateClock(dt) {
    this.state.time += dt / SEC_PER_GAME_MINUTE;
    if (this.state.time >= 24 * 60) {
      this.state.time = 24 * 60;
      if (!this.sleepInProgress) {
        this.ui.toast('夜已经很深了。你靠着门廊，沉沉睡去……');
        this.performSleep(true);
      }
      return;
    }
    const h = this.state.time / 60;
    if (h >= 22 && !this._warning22) {
      this._warning22 = true;
      this.ui.toast('22:00 了，山谷开始安静下来。记得早点休息。');
    }
    if (h >= 23.5 && !this._warning2330) {
      this._warning2330 = true;
      this.ui.toast('再忙一会儿，就该回屋了。');
    }
  }

  updateMovement(dt) {
    const canMove = this.introTime <= 0.05 && !this.ui.isModalOpen() && !this.ui.isTransitioning();
    let ix = 0, iz = 0;
    const touchLen = Math.hypot(this.touchInput.x, this.touchInput.y);
    if (canMove) {
      if (this.keys.has('w')) iz += 1;
      if (this.keys.has('s')) iz -= 1;
      if (this.keys.has('d')) ix += 1;
      if (this.keys.has('a')) ix -= 1;
      if (touchLen > 0.12) { ix += this.touchInput.x; iz += -this.touchInput.y; }
    }
    const running = this.keys.has('shift') || touchLen > 0.92;
    const inputLen = Math.hypot(ix, iz);
    const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw), rz = -Math.sin(this.camYaw);
    let tx = 0, tz = 0;
    if (inputLen > 0) {
      ix /= inputLen; iz /= inputLen;
      tx = (fx * iz + rx * ix) * (running ? 5.15 : 2.95);
      tz = (fz * iz + rz * ix) * (running ? 5.15 : 2.95);
    }
    const accel = 1 - Math.exp(-(inputLen ? 12 : 9) * dt);
    this.velocity.x = lerp(this.velocity.x, tx, accel);
    this.velocity.y = lerp(this.velocity.y, tz, accel);
    if (Math.abs(this.velocity.x) < 0.01) this.velocity.x = 0;
    if (Math.abs(this.velocity.y) < 0.01) this.velocity.y = 0;

    const nx = clamp(this.playerX + this.velocity.x * dt, -35.2, 35.2);
    if (!this.world.collides(nx, this.playerZ, 0.36)) this.playerX = nx;
    else this.velocity.x = 0;
    const nz = clamp(this.playerZ + this.velocity.y * dt, -28.5, 28.5);
    if (!this.world.collides(this.playerX, nz, 0.36)) this.playerZ = nz;
    else this.velocity.y = 0;

    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const moving = speed > 0.14;
    if (moving) {
      const targetFacing = Math.atan2(this.velocity.x, this.velocity.y);
      this.playerFacing += angleDelta(this.playerFacing, targetFacing) * (1 - Math.exp(-12 * dt));
    }
    this.character.root.rotation.y = this.playerFacing;
    this.character.root.position.set(this.playerX, groundHeight(this.playerX, this.playerZ) + 0.02, this.playerZ);
    this.character.update(dt, moving, running && speed > 1.2, speed);
    if (this.character.stepEvent && moving) this.audio.step(running);
    if (this.introTime > 0) this.introTime = Math.max(0, this.introTime - dt);
  }

  updateCamera(dt) {
    const orbit = this.computeCameraGoal();
    const focusGoal = new THREE.Vector3(this.playerX, 1.32, this.playerZ);
    if (this.introTime > 0) {
      const k = smoothstep(0, 1, 1 - this.introTime / this.introDuration);
      this.camera.position.lerpVectors(this._introFromPos, orbit, k);
      this.cameraFocus.lerpVectors(this._introFromFocus, focusGoal, k);
      this.camera.lookAt(this.cameraFocus);
    } else {
      this.cameraFocus.lerp(focusGoal, 1 - Math.exp(-12 * dt));
      this.camera.position.lerp(orbit, 1 - Math.exp(-14 * dt));
      this.camera.lookAt(this.cameraFocus);
    }
  }

  computeCameraGoal() {
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    let dist = this.camDistance;
    let x = this.playerX + Math.sin(this.camYaw) * cp * dist;
    let y = 1.32 + sp * dist + 0.25;
    let z = this.playerZ + Math.cos(this.camYaw) * cp * dist;
    // Pull the camera in if a building would swallow it.
    for (let i = 0; i < 7 && dist > 2.2; i++) {
      if (!this.world.collides(x, z, 0.18)) break;
      dist -= 0.65;
      x = this.playerX + Math.sin(this.camYaw) * cp * dist;
      z = this.playerZ + Math.cos(this.camYaw) * cp * dist;
      y = 1.32 + sp * dist + 0.25;
    }
    const terrainY = groundHeight(x, z) + 0.5;
    this.camGoal.set(x, Math.max(y, terrainY), z);
    return this.camGoal;
  }

  updateHudTimer(dt) {
    this._hudTimer += dt;
    if (this._hudTimer > 0.25) {
      this._hudTimer = 0;
      this.ui.setHudState(this.state);
    }
  }

  updateEnvironment(dt) {
    this._envTimer += dt;
    if (this._envTimer < 0.4) return;
    this._envTimer = 0;
    this.world.setEnvironment(this.state.time / 60, this.state.weather);
    this.ui.setWeather(this.state.weather);
  }

  updateAudio(dt) {
    if (!this.audioStarted) return;
    this.audio.update(dt, this.state.time / 60, this.state.weather);
  }

  /* ================================================================ */
  /*  Context / prompts                                                */
  /* ================================================================ */
  updateContext() {
    if (this.introTime > 0.6) {
      this.world.hideHighlight();
      this.ui.hidePrompt();
      this.ui.hideTarget();
      return;
    }
    this.camera.getWorldDirection(this.camDir);
    const len = Math.hypot(this.camDir.x, this.camDir.z) || 1;
    const fx = this.camDir.x / len, fz = this.camDir.z / len;
    const plotIndex = this.world.findPlotTarget(this.playerX, this.playerZ, fx, fz, this.targetPlot);
    this.targetPlot = plotIndex;
    if (plotIndex >= 0) this.world.setHighlight(plotIndex); else this.world.hideHighlight();

    let nearest = null, nearestDist = Infinity;
    for (const obj of this.world.interactables) {
      const d = Math.hypot(obj.x - this.playerX, obj.z - this.playerZ);
      if (d <= obj.r && d < nearestDist) { nearest = obj; nearestDist = d; }
    }
    this.nearestObject = nearest;

    if (plotIndex >= 0) {
      const plot = this.state.plots[plotIndex];
      this.renderPlotContext(plotIndex, plot);
    } else if (nearest) {
      this.renderObjectContext(nearest);
    } else {
      this.hideContext();
    }
  }

  hideContext() {
    this.ui.hidePrompt();
    this.ui.hideTarget();
    this._contextKey = null;
  }

  renderObjectContext(obj) {
    const hints = {
      house: '休息到明天', bin: '出售收成', shop: '种子与杂货', well: '补满洒水壶',
      mail: '读一读', dog: '阿麦', chicken: '咕咕', cow: '花卷', barn: '干草与旧农具', dock: '水边',
    };
    const key = `obj:${obj.id}:${obj.label}`;
    this.ui.hideTarget();
    if (this._contextKey !== key) {
      this._contextKey = key;
      this.ui.showPrompt(obj.label, hints[obj.key] || '');
    }
  }

  bestToolForPlot(plot) {
    if (plot?.crop && plot.crop.stage >= 3) return 'harvest';
    return this.state.tool;
  }

  renderPlotContext(index, plot) {
    const crop = plot.crop;
    const cropData = crop ? CROPS[crop.type] : null;
    let promptText = '';
    let hint = '';
    const tool = this.state.tool;
    const noEnergy = this.state.energy < 1;

    if (crop && crop.stage >= 3) {
      promptText = `收获「${cropData.name}」`;
      hint = '成熟了';
      this.ui.showTarget({
        name: cropData.name, color: cropData.color,
        stageText: '已经成熟 · 可以收获',
      });
    } else if (crop) {
      const daysLeft = Math.max(0, 3 - crop.stage);
      const waterState = plot.watered ? '今日已浇水' : '待浇水';
      this.ui.showTarget({
        name: cropData.name, color: cropData.color,
        stageText: `${waterState} · 还需 ${daysLeft} 个夜晚`,
      });
      if (tool === 'can') {
        promptText = plot.watered ? '今天已经浇过水了' : `给「${cropData.name}」浇水`;
        hint = plot.watered ? '' : `水 ${this.state.water}/${this.state.waterMax}`;
      } else if (tool === 'sickle') {
        promptText = '这株作物还没有成熟';
        hint = `还需 ${daysLeft} 天`;
      } else if (tool === 'seeds') {
        promptText = '这里已经种着作物';
        hint = '换用锄头或水壶';
      } else {
        promptText = '小心，这里有一株作物';
        hint = '换 2 浇水';
      }
    } else if (plot.tilled) {
      this.ui.hideTarget();
      if (tool === 'seeds') {
        const seed = CROPS[this.state.selectedSeed];
        const count = this.state.seeds[this.state.selectedSeed] || 0;
        promptText = count > 0 ? `种下「${seed.name}」` : '这种种子用完了';
        hint = count > 0 ? `剩余 ${count} 颗` : '去杂货铺买一些';
      } else if (tool === 'can') {
        promptText = '浇湿这块土壤';
        hint = `水 ${this.state.water}/${this.state.waterMax}`;
      } else if (tool === 'sickle') {
        promptText = '这里没有可收获的作物';
        hint = '换 3 播种';
      } else {
        promptText = '这块土地已经松好了';
        hint = '换 3 播种';
      }
    } else {
      this.ui.hideTarget();
      if (tool === 'hoe') {
        promptText = '开垦这块土地';
        hint = '体力 -4';
      } else if (tool === 'can') {
        promptText = '要先翻松土地';
        hint = '按 1 用锄头';
      } else if (tool === 'seeds') {
        promptText = '先把杂草翻进土里';
        hint = '按 1 用锄头';
      } else {
        promptText = '先开垦这块土地';
        hint = '按 1 用锄头';
      }
    }
    if (noEnergy && !promptText.includes('已经')) { hint = '体力不足，回屋休息吧'; }
    const key = `plot:${index}:${this.state.tool}:${crop?.stage ?? 'x'}:${plot.watered}:${plot.tilled}:${this.state.selectedSeed}:${this.state.energy < 1}`;
    if (this._contextKey !== key) {
      this._contextKey = key;
      this.ui.showPrompt(promptText, hint);
    }
  }

  updateHints(dt = 1 / 60) {
    this._hintTimer += dt;
    if (this._hintTimer < 0.5) return;
    this._hintTimer = 0;
    if (!this.ui.el.interactionPrompt.classList.contains('hidden')) return;
    let hint = '';
    if (this.state.questStage === 0) {
      const st = this.state.stats;
      if (st.tilled < 1) hint = '按 1 拿起锄头，对着一块长草的土地按 E 开垦。';
      else if (st.planted < 1) hint = '按 3 拿出种子袋，在翻好的土地上按 E 播种。';
      else if (st.watered < 1) hint = '按 2 拿出洒水壶，给刚种下的作物浇一点水。';
      else if (st.slept < 1) hint = '天快黑了。走到木屋门口按 E，回屋休息。';
      else hint = '菜圃正在慢慢长大。按 Q 可以切换种子。';
    } else if (this.state.energy < 12) {
      hint = '体力所剩不多了，回木屋休息一下吧。';
    } else if (this.state.water <= 0) {
      hint = '洒水壶空了，去井边按 E 打满水。';
    } else if (this.state.plots.some((p) => p.crop && p.crop.stage >= 3)) {
      hint = '田里有作物成熟了，走到旁边按 E 收获。';
    } else if (this.state.time / 60 > 19) {
      hint = '天黑了，木屋的灯已经亮起来。按 E 回屋休息。';
    } else {
      hint = '按 Q 切换种子 · 按 B 打开农庄手记 · 按 H 进入拍照模式';
    }
    this.ui.setHint(hint);
  }

  /* ================================================================ */
  /*  Actions                                                          */
  /* ================================================================ */
  performAction() {
    if (this.mode !== 'playing' || this.ui.isModalOpen() || this.ui.isTransitioning() || this.introTime > 0.4) return;
    if (this.targetPlot >= 0) { this.farmAction(this.targetPlot); return; }
    if (this.nearestObject) { this.interactObject(this.nearestObject); return; }
  }

  farmAction(index) {
    const plot = this.state.plots[index];
    if (!plot) return;
    const crop = plot.crop;
    const cropData = crop ? CROPS[crop.type] : null;
    if (crop && crop.stage >= 3) {
      this.harvest(index);
      return;
    }
    if (this.state.tool === 'hoe') {
      if (crop) { this.ui.toast('小心一点，这里已经种了作物。', 'warn'); return; }
      if (plot.tilled) { this.ui.toast('这块地已经松好了，换种子袋播种吧。'); return; }
      if (!this.spendEnergy(4)) return;
      plot.tilled = true; plot.watered = false;
      this.state.stats.tilled += 1;
      this.world.setPlot(index, plot);
      this.character.triggerAction('hoe');
      this.audio.hoe();
      this.afterAction();
      this.ui.toast('土地翻松了，能闻到潮湿的泥土味。');
      return;
    }
    if (this.state.tool === 'can') {
      if (!plot.tilled) { this.ui.toast('先把土地翻松，再浇水。', 'warn'); return; }
      if (plot.watered) { this.ui.toast('今天已经浇过水了。'); return; }
      if (this.state.water <= 0) { this.ui.toast('洒水壶空了，去井边打满水吧。', 'warn'); return; }
      if (!this.spendEnergy(1)) return;
      this.state.water -= 1;
      plot.watered = true;
      if (crop) this.state.stats.watered += 1;
      this.world.setPlot(index, plot);
      this.character.triggerAction('can');
      this.audio.water();
      this.afterAction();
      this.ui.toast(crop ? `给${cropData.name}浇了水。` : '土壤被浇得湿润发黑。');
      return;
    }
    if (this.state.tool === 'seeds') {
      if (!plot.tilled) { this.ui.toast('要先把土地翻松，种子才能扎根。', 'warn'); return; }
      if (crop) { this.ui.toast('这块地已经种着作物了。', 'warn'); return; }
      const type = this.state.selectedSeed;
      const seed = CROPS[type];
      const count = this.state.seeds[type] || 0;
      if (count <= 0) { this.ui.toast(`${seed.name}种子用完了，去谷雨的铺子买一包吧。`, 'warn'); return; }
      if (!this.spendEnergy(1)) return;
      this.state.seeds[type] = count - 1;
      plot.crop = { type, stage: 0 };
      this.state.stats.planted += 1;
      this.world.setPlot(index, plot);
      this.character.triggerAction('seeds');
      this.audio.plant();
      this.afterAction();
      this.ui.toast(`种下了${seed.name}。记得每天浇水。`);
      return;
    }
    if (this.state.tool === 'sickle') {
      if (!crop) { this.ui.toast('这里没有可以收获的作物。'); return; }
      const left = Math.max(0, 3 - crop.stage);
      this.ui.toast(`${cropData.name}还需要 ${left} 个浇过水的夜晚。`);
    }
  }

  harvest(index) {
    const plot = this.state.plots[index];
    const crop = plot?.crop;
    if (!crop || crop.stage < 3) return;
    if (!this.spendEnergy(1)) return;
    const cropData = CROPS[crop.type];
    const amount = 1 + (Math.random() < 0.18 ? 1 : 0);
    this.state.produce[crop.type] = (this.state.produce[crop.type] || 0) + amount;
    plot.crop = null;
    plot.tilled = true;
    plot.watered = false;
    this.state.stats.harvested += amount;
    this.world.setPlot(index, plot);
    this.character.triggerAction('sickle');
    this.audio.harvest();
    this.afterAction(amount > 1 ? `收获 ${amount} 个${cropData.name}，这一株长得真好。` : `收获了 ${cropData.name}。`);
  }

  spendEnergy(cost) {
    if (this.state.energy < cost) {
      this.ui.toast('体力不够了。回木屋睡一觉，明天再继续吧。', 'warn');
      return false;
    }
    this.state.energy = Math.max(0, this.state.energy - cost);
    this.ui.setEnergy(this.state.energy, this.state.maxEnergy);
    return true;
  }

  afterAction(message) {
    this.ui.setEnergy(this.state.energy, this.state.maxEnergy);
    this.ui.setWater(this.state.water, this.state.waterMax);
    this.ui.setMoney(this.state.money);
    this.ui.renderSeedOptions(this.state.seeds, this.state.selectedSeed);
    this.ui.setSeed(this.state.selectedSeed, this.state.seeds[this.state.selectedSeed] || 0);
    this.checkQuest();
    this.save();
    if (message) this.ui.toast(message);
    this._hintTimer = 0;
  }

  cycleSeed() {
    const ids = Object.keys(CROPS);
    const i = ids.indexOf(this.state.selectedSeed);
    this.selectSeed(ids[(i + 1) % ids.length]);
  }

  selectSeed(type) {
    if (!CROPS[type]) return;
    this.state.selectedSeed = type;
    this.ui.setSeed(type, this.state.seeds[type] || 0);
    this.ui.renderSeedOptions(this.state.seeds, type);
    this.ui.setTool('seeds');
    this.character.setTool('seeds');
    this.state.tool = 'seeds';
    this.audio.select();
    this.save();
  }

  selectTool(tool) {
    if (!['hoe', 'can', 'seeds', 'sickle'].includes(tool)) return;
    this.state.tool = tool;
    this.character.setTool(tool);
    this.ui.setTool(tool);
    this.ui.closeSeedPopover();
    this.audio.click();
    this._contextKey = null;
    this.save();
  }

  openJournal(tab = 'backpack') {
    if (this.mode !== 'playing' || this.ui.isTransitioning()) return;
    this.keys.clear();
    this.ui.openJournal(this.journalState(), tab);
    this.audio.click();
  }

  openGuide() {
    if (this.mode !== 'playing' || this.ui.isTransitioning()) return;
    this.keys.clear();
    this.ui.openGuide();
    this.audio.click();
  }

  closeModal() {
    if (!this.ui.isModalOpen()) return;
    this.ui.closeModal();
    this.audio.click();
    this.save();
    this._contextKey = null;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.ui.setMuted(this.muted);
    if (!this.muted) this.audio.click();
  }

  togglePhotoMode() {
    const on = this.ui.togglePhotoMode();
    if (on) {
      this.ui.closeSeedPopover();
      this.ui.hidePrompt();
      this.ui.hideTarget();
    }
    this.keys.clear();
  }

  /* ================================================================ */
  /*  Interactions                                                     */
  /* ================================================================ */
  interactObject(obj) {
    const flags = this.state.dayFlags ||= {};
    switch (obj.id) {
      case 'house':
        this.keys.clear();
        this.ui.openRest(this.restState());
        this.audio.click();
        break;
      case 'bin':
        this.keys.clear();
        this.ui.openSell(this.shipState());
        this.audio.click();
        break;
      case 'shop':
        this.keys.clear();
        this.ui.openShop(this.shopState());
        this.audio.click();
        break;
      case 'well': {
        if (this.state.water >= this.state.waterMax) {
          this.ui.toast('洒水壶已经满了，井水在桶里轻轻晃。');
        } else {
          const add = this.state.waterMax - this.state.water;
          this.state.water = this.state.waterMax;
          this.ui.setWater(this.state.water, this.state.waterMax);
          this.character.triggerAction('can');
          this.audio.water();
          this.ui.toast(`打满了井水（+${add}）。水很凉，带着石头的味道。`);
          this.save();
        }
        break;
      }
      case 'mail': {
        if (this.state.letterRead) {
          this.ui.toast('信箱里只剩几片被风吹进来的叶子。');
        } else {
          this.state.letterRead = true;
          this.state.money += 80;
          this.ui.setMoney(this.state.money);
          this.audio.coin();
          this.save();
          this.keys.clear();
          this.ui.openLetter();
          this.ui.toast('信封里夹着 80 G 的见面礼。', 'reward');
        }
        break;
      }
      case 'dog':
        this.world.celebrateDog();
        this.audio.heart();
        this.ui.toast('阿麦把脑袋搁在你的掌心，尾巴摇得像风里的旗子。');
        break;
      case 'chicken': {
        this.audio.heart();
        if (!flags.egg) {
          flags.egg = true;
          this.state.produce.egg = (this.state.produce.egg || 0) + 1;
          this.ui.toast('母鸡在草堆里留下了一枚温热的鸡蛋。', 'reward');
          this.afterAction();
        } else {
          this.ui.toast('它咕咕地绕着你转了一圈，又去啄草籽了。');
        }
        break;
      }
      case 'cow':
        this.audio.heart();
        if (!flags.milked) {
          flags.milked = true;
          this.state.produce.milk = (this.state.produce.milk || 0) + 1;
          this.ui.toast('花卷甩了甩尾巴，留下了今早的一小桶牛奶。', 'reward');
          this.afterAction();
        } else {
          this.ui.toast('花卷把脑袋凑过来，鼻息温热。');
        }
        break;
      case 'barn':
        this.ui.toast('谷仓里有干草、旧犁和一段很长的午后阳光。');
        break;
      case 'dock':
        if (!flags.dock) {
          flags.dock = true;
          this.state.energy = Math.min(this.state.maxEnergy, this.state.energy + 8);
          this.ui.setEnergy(this.state.energy, this.state.maxEnergy);
          this.ui.toast('你坐在码头边，看了一会儿水面的光。体力恢复了一些。');
          this.save();
        } else {
          this.ui.toast('水面很静，只有几只水黾在打转。');
        }
        break;
      default:
        this.ui.toast(obj.label || '这里很安静。');
    }
  }

  buySeed(type) {
    const crop = CROPS[type];
    if (!crop) return;
    if (this.state.money < crop.seedPrice) {
      this.ui.toast('金币不够了。要不先去出货箱卖掉一些收成？', 'warn');
      this.audio.click();
      return;
    }
    this.state.money -= crop.seedPrice;
    this.state.seeds[type] = (this.state.seeds[type] || 0) + 1;
    this.state.stats.bought += 1;
    this.ui.setMoney(this.state.money);
    this.ui.renderSeedOptions(this.state.seeds, this.state.selectedSeed);
    this.ui.setSeed(this.state.selectedSeed, this.state.seeds[this.state.selectedSeed] || 0);
    this.audio.coin();
    this.checkQuest();
    this.save();
    this.ui.openShop(this.shopState());
  }

  sellAll() {
    const entries = Object.entries(this.state.produce || {}).filter(([, n]) => n > 0);
    if (!entries.length) {
      this.ui.toast('背包里还没有收成可以出货。');
      return;
    }
    let total = 0;
    for (const [key, n] of entries) {
      const item = CROPS[key] || ITEMS[key];
      if (!item) continue;
      total += item.sell * n;
    }
    this.state.produce = {};
    this.state.money += total;
    this.state.stats.sold += 1;
    this.ui.setMoney(this.state.money);
    this.audio.coin();
    this.checkQuest();
    this.save();
    this.ui.openSell(this.shipState());
    this.ui.toast(`出货完成，金币 +${total}。`, 'reward');
  }

  /* ================================================================ */
  /*  Sleep & quests                                                   */
  /* ================================================================ */
  restState() {
    const tomorrow = this.state.day + 1;
    return {
      nextDay: tomorrow,
      nextSeason: seasonForDay(tomorrow),
      tomorrowWeather: weatherForDay(tomorrow),
      wateredCount: this.state.plots.filter((p) => p.tilled && p.watered).length,
      growingCount: this.state.plots.filter((p) => p.crop && p.crop.stage < 3).length,
      money: this.state.money,
    };
  }

  sleep() {
    if (this.sleepInProgress) return;
    this.performSleep(false);
  }

  performSleep(auto) {
    if (this.sleepInProgress || this.mode !== 'playing') return;
    this.sleepInProgress = true;
    this.ui.closeModal();
    this.ui.closeSeedPopover();
    this.ui.hidePrompt();
    this.ui.hideTarget();
    this.keys.clear();
    this.audio.sleep();
    const grown = [];
    let matured = 0;
    for (const plot of this.state.plots) {
      if (plot.crop && plot.watered && plot.crop.stage < 3) {
        plot.crop.stage += 1;
        grown.push(plot.crop.type);
        if (plot.crop.stage >= 3) matured += 1;
      }
    }
    this.state.day += 1;
    this.state.time = 6 * 60 + 30;
    this.state.weather = weatherForDay(this.state.day);
    this.state.energy = this.state.maxEnergy;
    this.state.water = this.state.waterMax;
    this.state.stats.slept += 1;
    this.state.dayFlags = { egg: false, milked: false, dock: false };
    this._warning22 = false;
    this._warning2330 = false;
    for (const plot of this.state.plots) {
      if (plot.tilled) plot.watered = this.state.weather === 'rain';
    }
    this.applyStateToWorld();
    this.world.setEnvironment(this.state.time / 60, this.state.weather, true);
    this.audio.setWeather(this.state.weather);
    this.updateHudValues(false);
    this.save();

    const weather = WEATHER[this.state.weather];
    const growthNote = matured > 0
      ? `${matured} 株作物在夜里成熟了。`
      : grown.length > 0
        ? `${grown.length} 株作物悄悄长大了一截。`
        : '菜圃安静地睡了一夜。';
    let note = this.state.weather === 'rain'
      ? '清晨的雨替你浇好了菜圃。今天可以在屋里慢一点。'
      : `${growthNote} 阳光落在窗台上。`;
    if (auto) note = '你在门廊边睡着了。醒来时，天已经亮了。' + note;
    const data = {
      kicker: `第 ${this.state.day} 日 · ${seasonForDay(this.state.day)} · 清晨`,
      title: this.state.day === 2 ? '山谷醒来' : `第 ${this.state.day} 日`,
      note,
    };
    this.sleepInProgress = false;
    this.ui.playDayTransition(data, () => {
      this.ui.setHudState(this.state);
      this.checkQuest();
      this.updateHints(1);
      this.ui.toast(`早上好。今天是${seasonForDay(this.state.day)} · 第 ${this.state.day} 日，${weather.name}。`);
      this.save();
    });
    if (this.state.weather === 'rain') this.ui.toast('外面下雨了，菜圃已经替你浇好了。');
  }

  questView() {
    if (this.state.questStage >= QUEST_DEFS.length) {
      return {
        index: QUEST_DEFS.length + 1,
        name: '慢慢生活',
        reward: 0,
        objectives: [
          { text: '今天也去田里看看', done: false },
          { text: '和山谷里的某个人打个招呼', done: false },
          { text: '在太阳落下之前回家', done: false },
        ],
      };
    }
    const def = QUEST_DEFS[this.state.questStage];
    return {
      index: this.state.questStage + 1,
      name: def.name,
      reward: def.reward,
      objectives: def.objectives.map((o) => ({ text: o.text, done: !!o.test(this.state) })),
    };
  }

  checkQuest() {
    let advanced = false;
    while (this.state.questStage < QUEST_DEFS.length) {
      const def = QUEST_DEFS[this.state.questStage];
      if (!def.objectives.every((o) => o.test(this.state))) break;
      this.state.money += def.reward;
      this.state.questStage += 1;
      advanced = true;
      this.ui.toast(`「${def.name}」完成了 · 农庄手记 +${def.reward} G`, 'reward');
      this.ui.setMoney(this.state.money);
      this.audio.quest();
    }
    if (advanced) {
      this.ui.renderQuest(this.questView());
      this.save();
    } else {
      this.ui.renderQuest(this.questView());
    }
  }

  /* ================================================================ */
  /*  State snapshots for the UI                                       */
  /* ================================================================ */
  shopState() {
    return { money: this.state.money, seeds: this.state.seeds };
  }
  shipState() {
    return { money: this.state.money, produce: this.state.produce };
  }
  journalState() {
    return {
      money: this.state.money, seeds: this.state.seeds, produce: this.state.produce,
      water: this.state.water, waterMax: this.state.waterMax,
    };
  }

  updateHudValues(animate = true) {
    this.ui.setHudState(this.state);
    this.ui.setMoney(this.state.money);
    this.ui.setEnergy(this.state.energy, this.state.maxEnergy);
    this.ui.setWater(this.state.water, this.state.waterMax);
    this.ui.setTool(this.state.tool);
    this.ui.renderSeedOptions(this.state.seeds, this.state.selectedSeed);
    this.ui.setSeed(this.state.selectedSeed, this.state.seeds[this.state.selectedSeed] || 0);
    this.ui.renderQuest(this.questView());
    if (!animate) this.ui.setMoney(this.state.money);
  }

  /* ================================================================ */
  /*  Helpers / debug                                                  */
  /* ================================================================ */
  getTimeString() { return formatInGameTime(this.state.time); }

  debugTeleport(x, z) {
    this.playerX = x; this.playerZ = z; this.placeCharacter();
    this.cameraFocus.set(x, 1.35, z);
  }

  debugSetTime(hours) {
    this.state.time = clamp(hours * 60, 360, 1439);
    this.world.setEnvironment(this.state.time / 60, this.state.weather, true);
    this.ui.setHudState(this.state);
  }

  debugFace(yaw = 0.11, pitch = 0.235) {
    this.camYaw = yaw; this.camPitch = pitch; this.camDistanceTarget = this.camDistance;
  }

  debugAddMoney(n) {
    this.state.money += n;
    this.ui.setMoney(this.state.money);
  }

  debugAdvanceDay() {
    this.performSleep(false);
  }
}
