import * as THREE from 'three';
import { clamp, damp, TAU, setShadow } from './utils.js';

const std = (o) => new THREE.MeshStandardMaterial(o);

export class Character {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.position.set(7.8, 0, 13.2);
    this.root.rotation.y = Math.PI;
    this.scene = scene;
    scene.add(this.root);

    this.phase = 0;
    this.idleTime = 0;
    this.actionTimer = 0;
    this.actionKind = null;
    this.stepEvent = false;
    this.tool = 'hoe';
    this.tools = {};
    this.build();
    this.setTool('hoe');
  }

  build() {
    const skin = std({ color: 0xc99a7a, roughness: 0.92 });
    const shirt = std({ color: 0xd8cdb6, roughness: 0.96 });
    const shirtDark = std({ color: 0xb8ab93, roughness: 0.96 });
    const denim = std({ color: 0x3e5764, roughness: 0.94 });
    const denimDark = std({ color: 0x304650, roughness: 0.94 });
    const boot = std({ color: 0x4b3729, roughness: 0.82 });
    const hair = std({ color: 0x3b2b21, roughness: 0.92 });
    const straw = std({ color: 0xd7bd83, roughness: 0.94 });
    const strawDark = std({ color: 0xa98e5e, roughness: 0.95 });
    const leather = std({ color: 0x74502f, roughness: 0.8 });
    const brass = std({ color: 0xa8894d, roughness: 0.35, metalness: 0.7 });
    this.mats = { skin, shirt, denim, boot, hair, straw };

    const torso = new THREE.Group();
    torso.position.y = 0.88;
    this.root.add(torso);
    this.torso = torso;

    // Hips / overalls.
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.08, 4, 10), denim);
    hips.position.y = 0.04; hips.scale.set(1, 0.65, 0.72);
    torso.add(hips);
    // Torso shirt.
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.3, 5, 12), shirt);
    chest.position.y = 0.36; chest.scale.set(1, 1, 0.68);
    torso.add(chest);
    // Overalls bib.
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.065), denim);
    bib.position.set(0, 0.38, 0.135);
    torso.add(bib);
    const bibTop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.07), denimDark);
    bibTop.position.set(0, 0.55, 0.14); torso.add(bibTop);
    // straps
    for (const side of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.3, 0.04), denimDark);
      strap.position.set(side * 0.13, 0.5, 0.11); strap.rotation.z = side * 0.11; torso.add(strap);
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8), brass);
      button.rotation.x = Math.PI / 2; button.position.set(side * 0.13, 0.44, 0.17); torso.add(button);
    }
    // collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.07, 8, 1, true), shirtDark);
    collar.position.y = 0.57; torso.add(collar);

    // neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 7), skin);
    neck.position.y = 0.61; torso.add(neck);

    // head group
    const headGroup = new THREE.Group();
    headGroup.position.y = 0.71;
    torso.add(headGroup);
    this.headGroup = headGroup;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 18, 14), skin);
    head.scale.set(0.92, 1.12, 0.9);
    headGroup.add(head);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.07, 6), skin);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, -0.015, 0.145); headGroup.add(nose);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), skin);
      ear.position.set(side * 0.135, -0.01, 0); headGroup.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 5), std({ color: 0x2f241d, roughness: 0.35 }));
      eye.position.set(side * 0.055, 0.025, 0.128); headGroup.add(eye);
    }
    // hair
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.154, 16, 12, 0, TAU, 0, Math.PI * 0.62), hair);
    hairCap.position.y = 0.025; hairCap.scale.set(0.95, 1.04, 0.96); headGroup.add(hairCap);
    const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), hair);
    fringe.position.set(0.045, 0.075, 0.125); fringe.scale.set(1.6, 0.45, 0.5); headGroup.add(fringe);
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 7), hair);
    hairBack.position.set(0, -0.06, -0.105); hairBack.scale.set(1.0, 1.1, 0.6); headGroup.add(hairBack);

    // straw hat
    const hat = new THREE.Group();
    hat.position.y = 0.12;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.03, 22), straw);
    brim.rotation.x = 0.04; hat.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.185, 0.18, 16), straw);
    crown.position.y = 0.1; hat.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.188, 0.19, 0.045, 16), denimDark);
    band.position.y = 0.045; hat.add(band);
    hat.rotation.x = -0.06;
    headGroup.add(hat);

    // Arms. Character's local forward is +Z.
    const arm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.245, 0.47, 0);
      torso.add(shoulder);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.17, 4, 8), shirt);
      upper.position.y = -0.1; upper.scale.z = 0.88; shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.22;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.053, 0.17, 4, 8), skin);
      fore.position.y = -0.1; elbow.add(fore);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.06, 8), shirtDark);
      cuff.position.y = -0.006; elbow.add(cuff);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), skin);
      hand.position.y = -0.215; hand.scale.set(0.9, 1.15, 0.62); elbow.add(hand);
      return { shoulder, elbow, hand };
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    this.armL.shoulder.rotation.z = 0.06;
    this.armR.shoulder.rotation.z = -0.06;

    // Legs.
    const leg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.105, 0.88, 0);
      this.root.add(hip);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.22, 4, 9), denim);
      thigh.position.y = -0.17; hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.36;
      hip.add(knee);
      const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.23, 4, 8), denim);
      calf.position.y = -0.16; knee.add(calf);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.07, 0.07, 8), denimDark);
      cuff.position.y = -0.3; knee.add(cuff);
      const bootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.15, 0.24), boot);
      bootMesh.position.set(0, -0.4, 0.035); knee.add(bootMesh);
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.083, 7, 5), boot);
      toe.position.set(0, -0.43, 0.11); toe.scale.set(0.8, 0.55, 1.1); knee.add(toe);
      return { hip, knee };
    };
    this.legL = leg(-1);
    this.legR = leg(1);

    // Satchel at the hip.
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.22, 0.11), leather);
    bag.position.set(0.22, 0.92, -0.03); bag.rotation.z = -0.12; this.root.add(bag);
    const bagFlap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.12), std({ color: 0x8d633b, roughness: 0.85 }));
    bagFlap.position.set(0.22, 0.98, -0.02); bagFlap.rotation.z = -0.12; this.root.add(bagFlap);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 4, 14, Math.PI), leather);
    strap.position.set(0.05, 1.25, 0.02); strap.rotation.z = 0.3; this.root.add(strap);

    // Tool root in the right hand.
    this.toolRoot = new THREE.Group();
    this.toolRoot.position.set(0, -0.2, 0.04);
    this.armR.elbow.add(this.toolRoot);
    this.buildTools();

    setShadow(this.root, true, true);
    // The glass-like character shadows are expensive and low gain; keep full.
  }

  buildTools() {
    const wood = std({ color: 0x8b6945, roughness: 0.85 });
    const steel = std({ color: 0x8f9697, roughness: 0.3, metalness: 0.82 });
    const canMat = std({ color: 0x5c7c72, roughness: 0.5, metalness: 0.38 });
    const pouchMat = std({ color: 0xa48754, roughness: 0.95 });

    const hoe = new THREE.Group();
    const hoeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.0, 7), wood);
    hoeHandle.position.y = -0.5; hoe.add(hoeHandle);
    const hoeHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.055, 0.1), steel);
    hoeHead.position.set(-0.12, -0.98, 0); hoeHead.rotation.z = 0.1; hoe.add(hoeHead);
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.07, 8), steel);
    ferrule.position.y = -0.93; hoe.add(ferrule);
    hoe.rotation.set(-0.3, 0.1, 0.2);
    this.toolRoot.add(hoe); this.tools.hoe = hoe;

    const can = new THREE.Group();
    const canBody = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.28, 14), canMat);
    canBody.position.y = -0.34; can.add(canBody);
    const canBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 14), canMat);
    canBottom.position.y = -0.48; can.add(canBottom);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.5, 7), canMat);
    spout.position.set(0.19, -0.31, 0.08); spout.rotation.z = -0.8; spout.rotation.x = -0.3; can.add(spout);
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.045, 0.06, 10), steel);
    rose.position.set(0.36, -0.17, 0.16); rose.rotation.z = -0.8; can.add(rose);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 5, 12, Math.PI), canMat);
    handle.position.set(-0.02, -0.19, 0); handle.rotation.z = Math.PI; can.add(handle);
    const handle2 = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 5, 10, Math.PI), canMat);
    handle2.position.set(-0.11, -0.35, 0); handle2.rotation.y = Math.PI / 2; can.add(handle2);
    can.rotation.set(-0.2, 0.2, 0.15);
    this.toolRoot.add(can); this.tools.can = can;

    const seeds = new THREE.Group();
    const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.12, 9, 7), pouchMat);
    pouch.scale.set(1, 1.2, 0.65); pouch.position.y = -0.39; seeds.add(pouch);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 4, 8), std({ color: 0x6f5837, roughness: 0.9 }));
    tie.position.set(0, -0.28, 0); tie.rotation.x = Math.PI / 2; seeds.add(tie);
    for (let i = 0; i < 8; i++) {
      const seed = new THREE.Mesh(new THREE.SphereGeometry(0.014, 4, 3), std({ color: 0xb59758, roughness: 0.9 }));
      seed.position.set((Math.random() - 0.5) * 0.1, -0.25 + Math.random() * 0.05, 0.05);
      seeds.add(seed);
    }
    this.toolRoot.add(seeds); this.tools.seeds = seeds;

    const sickle = new THREE.Group();
    const sHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.03, 0.38, 7), wood);
    sHandle.position.y = -0.18; sickle.add(sHandle);
    const blade = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 5, 12, Math.PI * 0.9), steel);
    blade.position.set(0.11, -0.4, 0); blade.rotation.z = -0.4; sickle.add(blade);
    sickle.rotation.set(-0.2, 0, 0.1);
    this.toolRoot.add(sickle); this.tools.sickle = sickle;

    for (const k in this.tools) this.tools[k].visible = false;
  }

  setTool(tool) {
    this.tool = tool;
    for (const k in this.tools) this.tools[k].visible = k === tool;
    this.toolRoot.visible = !!this.tools[tool];
  }

  triggerAction(kind = 'hoe') {
    this.actionTimer = kind === 'can' ? 0.55 : 0.46;
    this.actionKind = kind;
    this.actionProgress = 0;
  }

  setPosition(x, y, z) { this.root.position.set(x, y, z); }

  update(dt, moving, running, speed = 0) {
    this.idleTime += dt;
    this.stepEvent = false;
    const prev = this.phase;
    if (moving) this.phase += dt * (running ? 11.5 : 7.4);
    const p = this.phase;
    const stride = moving ? (running ? 0.78 : 0.58) : 0;
    const walkBlend = moving ? 1 : 0;
    // smooth stride values
    const swing = Math.sin(p) * stride * walkBlend;
    const bounce = moving ? Math.abs(Math.sin(p)) * (running ? 0.055 : 0.032) : Math.sin(this.idleTime * 1.7) * 0.006;

    this.root.position.y += 0; // vertical is managed by the game
    this.torso.position.y = 0.88 + bounce;
    this.torso.rotation.z = Math.sin(p) * 0.025 * walkBlend;
    this.torso.rotation.x = moving ? 0.035 : 0;

    this.legL.hip.rotation.x = swing;
    this.legR.hip.rotation.x = -swing;
    this.legL.knee.rotation.x = Math.max(0, -Math.sin(p + 0.6)) * 0.55 * walkBlend;
    this.legR.knee.rotation.x = Math.max(0, -Math.sin(p + Math.PI + 0.6)) * 0.55 * walkBlend;

    let armSwing = -swing * 0.85;
    this.armL.shoulder.rotation.x = moving ? armSwing : Math.sin(this.idleTime * 1.4) * 0.025;
    this.armR.shoulder.rotation.x = moving ? -armSwing : -Math.sin(this.idleTime * 1.4) * 0.02;
    this.armL.elbow.rotation.x = 0.12 + (moving ? Math.max(0, -Math.sin(p)) * 0.22 : 0.03);
    this.armR.elbow.rotation.x = 0.12 + (moving ? Math.max(0, Math.sin(p)) * 0.18 : 0.03);
    this.armL.shoulder.rotation.z = 0.06;
    this.armR.shoulder.rotation.z = -0.06;
    this.headGroup.rotation.y = moving ? Math.sin(p * 0.5) * 0.025 : Math.sin(this.idleTime * 0.28) * 0.16;
    this.headGroup.rotation.x = moving ? 0.02 : Math.sin(this.idleTime * 0.5) * 0.015;

    // Action animation: a decisive swing of the right arm.
    if (this.actionTimer > 0) {
      this.actionTimer = Math.max(0, this.actionTimer - dt);
      const total = this.actionKind === 'can' ? 0.55 : 0.46;
      const t = 1 - this.actionTimer / total;
      const arc = Math.sin(Math.min(1, t) * Math.PI);
      if (this.actionKind === 'can') {
        this.armR.shoulder.rotation.x = -0.55 - arc * 0.75;
        this.armR.elbow.rotation.x = 0.2 + arc * 0.3;
        this.armL.shoulder.rotation.x = -0.2 - arc * 0.4;
      } else if (this.actionKind === 'seeds') {
        this.armR.shoulder.rotation.x = -0.4 - arc * 0.8;
        this.armR.elbow.rotation.x = 0.4;
        this.armL.shoulder.rotation.x = -0.25 - arc * 0.6;
      } else if (this.actionKind === 'sickle') {
        this.armR.shoulder.rotation.x = -0.3 - arc * 1.4;
        this.armR.shoulder.rotation.z = -0.06 - arc * 0.4;
        this.armR.elbow.rotation.x = 0.2 + arc * 0.5;
      } else {
        // hoe
        this.armR.shoulder.rotation.x = 0.45 - arc * 1.7;
        this.armL.shoulder.rotation.x = 0.1 - arc * 0.55;
        this.armR.elbow.rotation.x = 0.2 + arc * 0.5;
        this.torso.rotation.x = 0.05 + arc * 0.2;
      }
    }

    if (moving && Math.sign(Math.sin(prev)) !== Math.sign(Math.sin(this.phase)) && Math.abs(speed) > 0.1) {
      this.stepEvent = true;
    }
    void clamp;
  }
}
