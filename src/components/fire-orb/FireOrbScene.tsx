"use client";

/* eslint-disable react-hooks/immutability -- Three.js render targets, materials and uniforms are intentionally mutable outside React render. */

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { Leva, useControls } from "leva";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { TexturePass } from "three/examples/jsm/postprocessing/TexturePass.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { DEFAULT_PARAMS, DEFAULT_WALL_PARAMS, LIGHT_COLORS, PALETTES } from "./palettes";
import type { FireOrbParams, FireWallParams } from "./palettes";
import { fireFrag, fireVert, sparkFrag, sparkVert } from "./shaders";

type V3 = [number, number, number];
type AnchorRef = MutableRefObject<THREE.Object3D | null>;

/* ------------------------------------------------------------------ */
/*  Матеріали та допоміжні функції                                     */
/* ------------------------------------------------------------------ */

const _c = new THREE.Color();
/** Палітра sRGB → лінійні Vector3 для шейдера */
function paletteToLinear(name: string): THREE.Vector3[] {
  const p = PALETTES[name] ?? PALETTES[DEFAULT_PARAMS.palette];
  return p.map(([r, g, b]) => {
    _c.setRGB(r, g, b, THREE.SRGBColorSpace);
    return new THREE.Vector3(_c.r, _c.g, _c.b);
  });
}

function createFireMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fireVert,
    fragmentShader: fireFrag,
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uScale: { value: DEFAULT_PARAMS.radius },
      uMode: { value: 0 },
      uBounds: { value: new THREE.Vector3(1, 1, 1) },
      uIntensity: { value: 1 },
      uTurb: { value: 0.7 },
      uFlame: { value: 1 },
      uSharp: { value: 3.5 },
      uCore: { value: 0.12 },
      uC1: { value: new THREE.Vector3() },
      uC2: { value: new THREE.Vector3() },
      uC3: { value: new THREE.Vector3() },
      uC4: { value: new THREE.Vector3() },
      uDepth: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uCamForward: { value: new THREE.Vector3() },
      uNear: { value: 0.05 },
      uFar: { value: 60 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.BackSide, // працює і коли камера всередині бокса
  });
}

function createSparkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: sparkVert,
    fragmentShader: sparkFrag,
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uPx: { value: 1000 },
      uSparkSize: { value: 1 },
      uSparkShape: { value: 0 },
      uScale: { value: DEFAULT_PARAMS.radius },
      uCenter: { value: new THREE.Vector3() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
}

function flicker(t: number): number {
  return (
    0.82 +
    0.14 * Math.sin(t * 9.1) +
    0.1 * Math.sin(t * 17.3 + 1.7) +
    0.08 * Math.sin(t * 31.7 + 4.1) +
    0.05 * Math.sin(t * 53.0)
  );
}

/* ------------------------------------------------------------------ */
/*  Постобробка: [сцена в RT з depth] → [вогонь поверх] → bloom → tone */
/* ------------------------------------------------------------------ */

class FirePass extends Pass {
  private fscene: THREE.Scene;
  private cam: THREE.Camera;
  constructor(fscene: THREE.Scene, cam: THREE.Camera) {
    super();
    this.fscene = fscene;
    this.cam = cam;
    this.needsSwap = false;
  }
  render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ) {
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.render(this.fscene, this.cam);
    renderer.autoClear = oldAuto;
  }
}

interface PostFXProps {
  fireScene: THREE.Scene;
  fireMats: THREE.ShaderMaterial[];
  bloom: number;
  exposure: number;
}

function PostFX({ fireScene, fireMats, bloom, exposure }: PostFXProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const rtRef = useRef<THREE.WebGLRenderTarget | null>(null);

  const fx = useMemo(() => {
    const composer = new EffectComposer(gl);
    const texturePass = new TexturePass(new THREE.Texture());
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      DEFAULT_PARAMS.bloom,
      0.7,
      0.3,
    );
    composer.addPass(texturePass);
    composer.addPass(new FirePass(fireScene, camera));
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    return { composer, texturePass, bloomPass };
  }, [gl, fireScene, camera]);

  // перебудова буферів при зміні розміру / dpr
  useEffect(() => {
    const w = Math.max(1, Math.floor(size.width * dpr));
    const h = Math.max(1, Math.floor(size.height * dpr));
    fx.composer.setPixelRatio(1);
    fx.composer.setSize(w, h);

    rtRef.current?.dispose();
    rtRef.current?.depthTexture?.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthTexture,
    });
    rtRef.current = rt;
    fx.texturePass.map = rt.texture;

    for (const material of fireMats) {
      material.uniforms.uDepth.value = depthTexture;
      material.uniforms.uRes.value.set(w, h);
    }
  }, [fx, fireMats, size.width, size.height, dpr]);

  useEffect(
    () => () => {
      rtRef.current?.dispose();
      rtRef.current?.depthTexture?.dispose();
      rtRef.current = null;
      fx.composer.dispose();
    },
    [fx],
  );

  // priority > 0 — беремо рендер на себе (R3F більше не викликає gl.render сам)
  useFrame((state, dt) => {
    const rt = rtRef.current;
    if (!rt) return;
    fx.bloomPass.strength = bloom;
    gl.toneMappingExposure = exposure;

    gl.setRenderTarget(rt);
    gl.clear();
    gl.render(state.scene, state.camera);
    gl.setRenderTarget(null);

    fx.composer.render(dt);
  }, 1);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Вогняна куля + іскри + світло                                      */
/* ------------------------------------------------------------------ */

interface FireOrbProps {
  p: FireOrbParams;
  active: boolean;
  anchorRef: AnchorRef;
  fireScene: THREE.Scene;
  fireMat: THREE.ShaderMaterial;
}

function FireOrb({ p, active, anchorRef, fireScene, fireMat }: FireOrbProps) {
  const boxRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const sparksRef = useRef<THREE.Points>(null);
  const sim = useRef(0);

  const sparkMat = useMemo(() => createSparkMaterial(), []);
  const sparkGeo = useMemo(() => {
    const n = p.sparkCount;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(n * 3), 3),
    );
    const seed = new Float32Array(n * 4);
    let randomSeed = 987654321;
    for (let i = 0; i < seed.length; i++) {
      randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
      seed[i] = randomSeed / 4294967296;
    }
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, [p.sparkCount]);
  useEffect(
    () => () => {
      sparkMat.dispose();
      sparkGeo.dispose();
    },
    [sparkMat, sparkGeo],
  );

  const colors = useMemo(() => paletteToLinear(p.palette), [p.palette]);
  const center = useMemo(() => new THREE.Vector3(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const v2 = useMemo(() => new THREE.Vector2(), []);

  useFrame((state, dt) => {
    const q = p;
    sim.current += Math.min(dt, 0.05) * q.speed;
    const t = sim.current;

    // позиція кулі: над якорем (долонею / кісткою)
    const anchor = anchorRef.current;
    if (anchor) anchor.getWorldPosition(center);
    else center.set(0.4, 1.0, 0.5);
    center.y += q.offsetY + Math.sin(t * 2.1) * 0.004;

    const cam = state.camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(fwd);

    const u = fireMat.uniforms;
    u.uTime.value = t;
    u.uMode.value = 0;
    u.uReveal.value = THREE.MathUtils.damp(
      u.uReveal.value,
      active ? 1 : 0,
      active ? 0.85 : 2.2,
      dt,
    );
    u.uCenter.value.copy(center);
    u.uScale.value = q.radius;
    u.uBounds.value.setScalar(q.radius * 2.6);
    u.uIntensity.value = q.intensity;
    u.uTurb.value = q.turbulence;
    u.uFlame.value = q.flameHeight;
    u.uSharp.value = q.sharpness;
    u.uCore.value = q.core;
    u.uC1.value.copy(colors[0]);
    u.uC2.value.copy(colors[1]);
    u.uC3.value.copy(colors[2]);
    u.uC4.value.copy(colors[3]);
    u.uCamForward.value.copy(fwd);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;

    // бокс, що охоплює кулю з язиками (півсторона 2.65 радіуса)
    if (boxRef.current) {
      boxRef.current.position.copy(center);
      boxRef.current.scale.setScalar(q.radius * 2.65);
    }

    // іскри
    const buf = state.gl.getDrawingBufferSize(v2);
    const su = sparkMat.uniforms;
    su.uTime.value = t;
    su.uReveal.value = u.uReveal.value;
    su.uSparkSize.value = q.sparkSize;
    su.uSparkShape.value =
      q.sparkShape === "diamond" ? 1 : q.sparkShape === "streak" ? 2 : 0;
    su.uCenter.value.copy(center);
    su.uScale.value = q.radius;
    su.uPx.value =
      buf.y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    if (sparksRef.current) sparksRef.current.visible = q.sparks;

    // світло вогню
    const l = lightRef.current;
    if (l) {
      const f = flicker(t);
      l.position.copy(center);
      l.position.x += Math.sin(t * 3.1) * 0.012;
      l.position.z += Math.cos(t * 2.7) * 0.012;
      l.intensity = 2.2 * q.light * f * q.intensity * u.uReveal.value;
      l.color.setHex(LIGHT_COLORS[q.palette] ?? 0xff4a14);
    }
  });

  return (
    <>
      <pointLight
        ref={lightRef}
        color={0xff4a14}
        intensity={2.2}
        distance={12}
        decay={2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.002}
        shadow-radius={4}
        shadow-camera-near={0.05}
        shadow-camera-far={12}
      />
      <points
        ref={sparksRef}
        geometry={sparkGeo}
        material={sparkMat}
        frustumCulled={false}
      />
      {/* куля живе в окремій сцені: її малює FirePass з урахуванням depth */}
      {createPortal(
        <mesh ref={boxRef} frustumCulled={false}>
          <boxGeometry args={[2, 2, 2]} />
          <primitive object={fireMat} attach="material" />
        </mesh>,
        fireScene,
      )}
    </>
  );
}

function FireWall({
  p,
  fireScene,
  fireMat,
}: {
  p: FireWallParams;
  fireScene: THREE.Scene;
  fireMat: THREE.ShaderMaterial;
}) {
  const boxRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const time = useRef(0);
  const center = useMemo(() => new THREE.Vector3(), []);
  const bounds = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const colors = useMemo(() => paletteToLinear(p.palette), [p.palette]);

  useFrame((state, dt) => {
    time.current += Math.min(dt, 0.05) * p.speed;
    center.set(0, p.height / 2, -p.distance);
    bounds.set(p.width / 2, p.height / 2, 0.42);

    const u = fireMat.uniforms;
    u.uMode.value = 1;
    u.uTime.value = time.current;
    u.uReveal.value = THREE.MathUtils.damp(u.uReveal.value, p.enabled ? 1 : 0, 0.8, dt);
    u.uCenter.value.copy(center);
    u.uBounds.value.copy(bounds);
    u.uScale.value = 0.42;
    u.uIntensity.value = p.intensity;
    u.uTurb.value = p.turbulence;
    u.uFlame.value = p.flameHeight;
    u.uSharp.value = 3.5;
    u.uCore.value = 0;
    u.uC1.value.copy(colors[0]);
    u.uC2.value.copy(colors[1]);
    u.uC3.value.copy(colors[2]);
    u.uC4.value.copy(colors[3]);
    state.camera.getWorldDirection(forward);
    u.uCamForward.value.copy(forward);
    if (state.camera instanceof THREE.PerspectiveCamera) {
      u.uNear.value = state.camera.near;
      u.uFar.value = state.camera.far;
    }

    if (boxRef.current) {
      boxRef.current.position.copy(center);
      boxRef.current.scale.copy(bounds);
    }
    if (lightRef.current) {
      lightRef.current.position.set(0, p.height * 0.36, -p.distance + 0.25);
      lightRef.current.intensity = p.enabled ? 0.28 * p.intensity * u.uReveal.value : 0;
      lightRef.current.color.setHex(LIGHT_COLORS[p.palette] ?? 0xff7a22);
    }
  });

  return (
    <>
      <pointLight ref={lightRef} color="#ff7a22" distance={7} decay={2} />
      {createPortal(
        <mesh ref={boxRef} frustumCulled={false}>
          <boxGeometry args={[2, 2, 2]} />
          <primitive object={fireMat} attach="material" />
        </mesh>,
        fireScene,
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Персонаж-заглушка (демонічний маг із піднятою рукою)               */
/* ------------------------------------------------------------------ */

const CLOTH = "#1a1412";
const SKIN = "#4a2119";
const HORN = "#241a16";
const EYE_COLOR = new THREE.Color().setRGB(3.0, 1.1, 0.25);

const S: V3 = [0.33, 1.42, 0.0];
const E: V3 = [0.5, 1.13, 0.18];
const W: V3 = [0.4, 1.07, 0.47];
const P: V3 = [0.4, 1.065, 0.55];
const LS: V3 = [-0.33, 1.42, 0.0];
const LE: V3 = [-0.42, 0.95, 0.06];

function Limb({ a, b, r, color }: { a: V3; b: V3; r: number; color: string }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const length = dir.length();
    return {
      pos: va.clone().addScaledVector(dir, 0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.normalize(),
      ),
      len: length,
    };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={quat} castShadow receiveShadow>
      <capsuleGeometry args={[r, Math.max(len - 2 * r, 0.001), 6, 14]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function Hero({ anchorRef }: { anchorRef: AnchorRef }) {
  const arm = useRef<THREE.Group>(null);
  const handAnchor = useRef<THREE.Object3D>(null);

  useLayoutEffect(() => {
    anchorRef.current = handAnchor.current;
    return () => {
      anchorRef.current = null;
    };
  }, [anchorRef]);

  useFrame(({ clock }) => {
    if (arm.current)
      arm.current.position.y = Math.sin(clock.elapsedTime * 1.3) * 0.012;
  });

  return (
    <group scale={1.3}>
      {/* роба */}
      <mesh position={[0, 0.7, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.26, 0.5, 1.4, 28]} />
        <meshStandardMaterial color={CLOTH} roughness={0.9} />
      </mesh>
      {/* плечі */}
      <mesh
        position={[0, 1.4, 0]}
        scale={[1.2, 0.55, 0.75]}
        castShadow
        receiveShadow
      >
        <sphereGeometry args={[0.3, 24, 16]} />
        <meshStandardMaterial color={CLOTH} roughness={0.9} />
      </mesh>
      {/* обличчя і каптур */}
      <mesh position={[0, 1.62, 0.02]} castShadow receiveShadow>
        <sphereGeometry args={[0.16, 20, 16]} />
        <meshStandardMaterial color={SKIN} roughness={0.7} />
      </mesh>
      <mesh
        position={[0, 1.65, -0.045]}
        scale={[1, 1.08, 1.02]}
        castShadow
        receiveShadow
      >
        <sphereGeometry args={[0.215, 24, 18]} />
        <meshStandardMaterial color={CLOTH} roughness={0.9} />
      </mesh>
      {/* очі, що світяться */}
      {[-1, 1].map((sx) => (
        <mesh key={`eye${sx}`} position={[sx * 0.05, 1.63, 0.165]}>
          <sphereGeometry args={[0.014, 10, 8]} />
          <meshBasicMaterial color={EYE_COLOR} />
        </mesh>
      ))}
      {/* роги */}
      {[-1, 1].map((sx) => (
        <mesh
          key={`horn${sx}`}
          position={[sx * 0.11, 1.84, -0.02]}
          rotation={[-0.18, 0, -sx * 0.35]}
          castShadow
          receiveShadow
        >
          <coneGeometry args={[0.035, 0.3, 10]} />
          <meshStandardMaterial color={HORN} roughness={0.5} />
        </mesh>
      ))}

      {/* опущена рука */}
      <Limb a={LS} b={LE} r={0.065} color={CLOTH} />
      <mesh position={[-0.43, 0.9, 0.07]} castShadow receiveShadow>
        <sphereGeometry args={[0.045, 12, 10]} />
        <meshStandardMaterial color={SKIN} roughness={0.7} />
      </mesh>

      {/* піднята рука з відкритою долонею */}
      <group ref={arm}>
        <Limb a={S} b={E} r={0.07} color={CLOTH} />
        <Limb a={E} b={W} r={0.062} color={CLOTH} />
        <mesh position={P} scale={[1.0, 0.35, 1.2]} castShadow receiveShadow>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshStandardMaterial color={SKIN} roughness={0.7} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={`f${i}`}
            position={[P[0] + (i - 1.5) * 0.022, P[1] + 0.02, P[2] + 0.075]}
            rotation={[0.75 + (i === 1 || i === 2 ? 0.1 : 0), 0, 0]}
            castShadow
            receiveShadow
          >
            <capsuleGeometry args={[0.0095, 0.045, 4, 8]} />
            <meshStandardMaterial color={SKIN} roughness={0.7} />
          </mesh>
        ))}
        <mesh
          position={[P[0] - 0.05, P[1] + 0.015, P[2] + 0.02]}
          rotation={[0.5, 0, 0.95]}
          castShadow
          receiveShadow
        >
          <capsuleGeometry args={[0.011, 0.04, 4, 8]} />
          <meshStandardMaterial color={SKIN} roughness={0.7} />
        </mesh>
        {/* якір, за яким рухається куля */}
        <object3D ref={handAnchor} position={P} />
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Власна модель (.glb з /public) — куля прив'язується до кістки кисті */
/* ------------------------------------------------------------------ */

function Model({
  url,
  anchorRef,
  eyeAnchorRef,
}: {
  url: string;
  anchorRef: AnchorRef;
  eyeAnchorRef: AnchorRef;
}) {
  const gltf = useGLTF(url);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(gltf.animations, group);

  useLayoutEffect(() => {
    const model = gltf.scene;

    // Нормалізація моделі та збільшення її для крупнішого кадру.
    model.scale.setScalar(1);
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const h = box.getSize(new THREE.Vector3()).y || 1;
    model.scale.multiplyScalar(2.34 / h);
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    model.position.x -= (box.min.x + box.max.x) / 2;
    model.position.z -= (box.min.z + box.max.z) / 2;
    model.position.y -= box.min.y;

    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    // пошук кістки правої кисті
    const bones: THREE.Object3D[] = [];
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.push(o);
    });
    let hand: THREE.Object3D | undefined;
    let leftEye: THREE.Object3D | undefined;
    let rightEye: THREE.Object3D | undefined;
    model.traverse((o) => {
      const normalized = o.name.toLowerCase().replace(/[^a-z]/g, "");
      if (!leftEye && /eyel$/.test(normalized)) leftEye = o;
      if (!rightEye && /eyer$/.test(normalized)) rightEye = o;
    });
    // L-бік цієї моделі розташований праворуч у початковому ракурсі камери.
    // Спершу перевіряємо його, щоб вогонь був на потрібному боці кадру.
    for (const re of [
      /handl$/i,
      /wrist.*l(?:a)?$/i,
      /righthand$/i,
      /handr$/i,
      /rhand$/i,
      /hand$/i,
      /rightwrist$/i,
      /wrist.*r(?:a)?$/i,
    ]) {
      hand = bones.find((b) => re.test(b.name.replace(/[^a-z]/gi, "")));
      if (hand) break;
    }
    if (!hand)
      console.warn(
        "[FireOrb] Кістку кисті не знайдено — куля стоїть у фіксованій точці.",
      );
    anchorRef.current = hand ?? null;
    let focusAnchor: THREE.Object3D | null = null;
    if (leftEye && rightEye && group.current) {
      model.updateMatrixWorld(true);
      const leftPosition = leftEye.getWorldPosition(new THREE.Vector3());
      const rightPosition = rightEye.getWorldPosition(new THREE.Vector3());
      const midpoint = leftPosition.add(rightPosition).multiplyScalar(0.5);
      focusAnchor = new THREE.Object3D();
      focusAnchor.position.copy(group.current.worldToLocal(midpoint));
      group.current.add(focusAnchor);
      eyeAnchorRef.current = focusAnchor;
    }
    return () => {
      anchorRef.current = null;
      eyeAnchorRef.current = null;
      if (focusAnchor) group.current?.remove(focusAnchor);
    };
  }, [gltf, anchorRef, eyeAnchorRef]);

  useEffect(() => {
    const first = names[0];
    if (first) actions[first]?.reset().play();
  }, [actions, names]);

  return (
    <group ref={group}>
      <primitive object={gltf.scene} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Світ                                                               */
/* ------------------------------------------------------------------ */

function CameraFlight({ focusOnEyes, eyeAnchorRef }: { focusOnEyes: boolean; eyeAnchorRef: AnchorRef }) {
  const currentTarget = useMemo(() => new THREE.Vector3(0.4, 1.3, 0.56), []);
  const desiredTarget = useMemo(() => new THREE.Vector3(), []);
  const desiredPosition = useMemo(() => new THREE.Vector3(), []);
  const homeTarget = useMemo(() => new THREE.Vector3(0.4, 1.3, 0.56), []);
  const homePosition = useMemo(() => new THREE.Vector3(0.95, 2.3, 4.5), []);
  const eyeOffset = useMemo(() => new THREE.Vector3(0, 0.12, 0.92), []);

  useFrame(({ camera }, dt) => {
    if (focusOnEyes && eyeAnchorRef.current) {
      eyeAnchorRef.current.getWorldPosition(desiredTarget);
      desiredPosition.copy(desiredTarget).add(eyeOffset);
    } else {
      desiredTarget.copy(homeTarget);
      desiredPosition.copy(homePosition);
    }
    const amount = 1 - Math.exp(-2.1 * dt);
    camera.position.lerp(desiredPosition, amount);
    currentTarget.lerp(desiredTarget, amount);
    camera.lookAt(currentTarget);
  });
  return null;
}

function World({
  p,
  wall,
  modelUrl,
  active,
  focusOnEyes,
}: {
  p: FireOrbParams;
  wall: FireWallParams;
  modelUrl?: string;
  active: boolean;
  focusOnEyes: boolean;
}) {
  const fireScene = useMemo(() => new THREE.Scene(), []);
  const fireMat = useMemo(() => createFireMaterial(), []);
  const wallMat = useMemo(() => createFireMaterial(), []);
  const fireMats = useMemo(() => [fireMat, wallMat], [fireMat, wallMat]);
  const anchorRef = useRef<THREE.Object3D | null>(null);
  const eyeAnchorRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => () => {
    fireMat.dispose();
    wallMat.dispose();
  }, [fireMat, wallMat]);

  return (
    <>
      <color attach="background" args={["#030202"]} />
      <fogExp2 attach="fog" args={[0x030202, 0.16]} />

      {/* земля */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial color="#15100d" roughness={0.95} />
      </mesh>

      {/* холодний контровий, щоб силует читався */}
      <directionalLight
        color="#3a4a80"
        intensity={0.35}
        position={[-2, 3, -3]}
      />
      <pointLight
        color="#7388c2"
        intensity={0.55}
        distance={5.5}
        decay={2}
        position={[0.4, 2.5, -1.8]}
      />
      <hemisphereLight args={["#161c30", "#050302", 0.12]} />

      {modelUrl ? (
        <Suspense fallback={null}>
          <Model url={modelUrl} anchorRef={anchorRef} eyeAnchorRef={eyeAnchorRef} />
        </Suspense>
      ) : (
        <Hero anchorRef={anchorRef} />
      )}

      <FireOrb
        p={p}
        active={active}
        anchorRef={anchorRef}
        fireScene={fireScene}
        fireMat={fireMat}
      />
      <FireWall p={wall} fireScene={fireScene} fireMat={wallMat} />
      <PostFX
        fireScene={fireScene}
        fireMats={fireMats}
        bloom={p.bloom}
        exposure={p.exposure}
      />
      <CameraFlight focusOnEyes={focusOnEyes} eyeAnchorRef={eyeAnchorRef} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Публічний компонент                                                */
/* ------------------------------------------------------------------ */

export interface FireOrbSceneProps {
  /** шлях до .glb у /public, напр. "/models/demon.glb"; без нього — персонаж-заглушка */
  modelUrl?: string;
  /** показати панель налаштувань (leva) */
  debug?: boolean;
  className?: string;
  /** стартові значення параметрів (читаються при першому рендері) */
  params?: Partial<FireOrbParams>;
  active?: boolean;
  focusOnEyes?: boolean;
}

export default function FireOrbScene({
  modelUrl,
  debug = false,
  className,
  params: override,
  active = false,
  focusOnEyes = false,
}: FireOrbSceneProps) {
  const d: FireOrbParams = {
    ...DEFAULT_PARAMS,
    radius: 0.12,
    flameHeight: 0.85,
    offsetY: modelUrl ? 0.08 : DEFAULT_PARAMS.offsetY,
    ...override,
  };

  const p = useControls("Вогняна куля", {
    palette: {
      value: d.palette,
      options: Object.keys(PALETTES),
      label: "палітра",
    },
    radius: {
      value: d.radius,
      min: 0.06,
      max: 0.5,
      step: 0.005,
      label: "радіус кулі",
    },
    offsetY: {
      value: d.offsetY,
      min: -0.2,
      max: 0.6,
      step: 0.005,
      label: "висота над долонею",
    },
    intensity: {
      value: d.intensity,
      min: 0.3,
      max: 3,
      step: 0.01,
      label: "яскравість",
    },
    turbulence: {
      value: d.turbulence,
      min: 0,
      max: 1.4,
      step: 0.01,
      label: "завихрення",
    },
    flameHeight: {
      value: d.flameHeight,
      min: 0.3,
      max: 2,
      step: 0.01,
      label: "довжина язиків",
    },
    sharpness: {
      value: d.sharpness,
      min: 1,
      max: 8,
      step: 0.01,
      label: "різкість ниток",
    },
    core: {
      value: d.core,
      min: 0,
      max: 0.6,
      step: 0.01,
      label: "свічення всередині",
    },
    speed: {
      value: d.speed,
      min: 0.2,
      max: 2.5,
      step: 0.01,
      label: "швидкість",
    },
    bloom: { value: d.bloom, min: 0, max: 2, step: 0.01, label: "bloom" },
    exposure: {
      value: d.exposure,
      min: 0.4,
      max: 2,
      step: 0.01,
      label: "експозиція",
    },
    light: {
      value: d.light,
      min: 0,
      max: 3,
      step: 0.01,
      label: "світло на персонажі",
    },
    sparks: { value: d.sparks, label: "іскри" },
    sparkCount: {
      value: d.sparkCount,
      min: 0,
      max: 300,
      step: 10,
      label: "кількість іскор",
    },
    sparkSize: {
      value: d.sparkSize,
      min: 0.4,
      max: 2.5,
      step: 0.05,
      label: "розмір іскор",
    },
    sparkShape: {
      value: d.sparkShape,
      options: { "м’які": "soft", ромби: "diamond", струмені: "streak" },
      label: "форма іскор",
    },
  }) as FireOrbParams;

  const wall = useControls("Стіна вогню", {
    enabled: { value: DEFAULT_WALL_PARAMS.enabled, label: "увімкнути стіну" },
    palette: {
      value: DEFAULT_WALL_PARAMS.palette,
      options: Object.keys(PALETTES),
      label: "палітра стіни",
    },
    width: { value: DEFAULT_WALL_PARAMS.width, min: 2, max: 8, step: 0.1, label: "ширина" },
    height: { value: DEFAULT_WALL_PARAMS.height, min: 1.5, max: 6, step: 0.1, label: "висота" },
    distance: { value: DEFAULT_WALL_PARAMS.distance, min: 0.6, max: 3.5, step: 0.05, label: "відстань за персонажем" },
    intensity: { value: DEFAULT_WALL_PARAMS.intensity, min: 0, max: 2, step: 0.01, label: "яскравість" },
    turbulence: { value: DEFAULT_WALL_PARAMS.turbulence, min: 0, max: 1.5, step: 0.01, label: "турбулентність" },
    flameHeight: { value: DEFAULT_WALL_PARAMS.flameHeight, min: 0.3, max: 1.5, step: 0.01, label: "висота язиків" },
    speed: { value: DEFAULT_WALL_PARAMS.speed, min: 0.1, max: 2.5, step: 0.01, label: "швидкість" },
  }) as FireWallParams;

  return (
    <div
      className={className}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <Leva
        hidden={!debug}
        titleBar={{
          title: "Керування вогнем",
          drag: false,
          filter: false,
          position: { y: 88 },
        }}
      />
      <Canvas
        shadows="soft"
        dpr={[1, 1.5]}
        camera={{ fov: 50, near: 0.05, far: 60, position: [0.95, 2.3, 4.5] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        <World
          p={p}
          modelUrl={modelUrl}
          active={active}
          focusOnEyes={focusOnEyes}
          wall={wall}
        />
      </Canvas>
    </div>
  );
}
