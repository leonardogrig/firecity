"use client";

import React, { useRef, useMemo, useCallback, useState, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import type { SiteData } from "./City";

interface Repo {
  repo_name: string;
  repo_stars: number;
  repo_description: string;
}

interface BuildingData {
  repo: Repo;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  floors: number;
}

// ── Seeded RNG ──────────────────────────────────────────────
function seededRng(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = (h ^ (h >>> 16)) * 0x45d9f3b;
    h = (h ^ (h >>> 16)) * 0x45d9f3b;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 0xffffffff;
  };
}

// ── Stars → building dimensions ─────────────────────────────
function starsToHeight(stars: number): number {
  if (stars === 0) return 8;
  if (stars <= 5) return 8 + stars * 4;
  if (stars <= 50) return 28 + (stars - 5) * 2;
  if (stars <= 500) return 118 + (stars - 50) * 0.5;
  if (stars <= 5000) return 343 + Math.pow(stars - 500, 0.5) * 3;
  return 450 + Math.log10(stars / 5000) * 100;
}

function starsToFloors(stars: number): number {
  return Math.max(1, Math.round(starsToHeight(stars) / 6));
}

// ── Spiral coordinate ───────────────────────────────────────
function spiralCoord(index: number): { x: number; z: number } {
  if (index === 0) return { x: 0, z: 0 };
  let x = 0, z = 0, dx = 1, dz = 0;
  let steps = 1, stepsTaken = 0, turns = 0;
  for (let i = 0; i < index; i++) {
    x += dx; z += dz; stepsTaken++;
    if (stepsTaken === steps) {
      stepsTaken = 0;
      const tmp = dx; dx = -dz; dz = tmp;
      turns++;
      if (turns % 2 === 0) steps++;
    }
  }
  return { x, z };
}

// ── City layout ─────────────────────────────────────────────
const CELL = 50, STREET = 30;

function layoutCity(repos: Repo[]): BuildingData[] {
  const sorted = [...repos].sort((a, b) => b.repo_stars - a.repo_stars);

  return sorted.map((repo, i) => {
    const rng = seededRng(repo.repo_name);
    const height = starsToHeight(repo.repo_stars);
    const floors = starsToFloors(repo.repo_stars);
    const width = 16 + rng() * 12;
    const depth = 14 + rng() * 10;
    const { x: sx, z: sz } = spiralCoord(i);
    return { repo, x: sx * (CELL + STREET), z: sz * (CELL + STREET), width, depth, height, floors };
  });
}

// ── Per-building window texture ─────────────────────────────
const WIN = 8;
const TILE_ROWS = 4;
const WINDOW_LIT_COLORS = ["#ffcc44", "#ffdd66", "#ffe088", "#44bbff", "#66ddff", "#88eeff"];
const WINDOW_OFF_COLOR = "#0c0c1a";
const FACE_COLORS = ["#1a1a2e", "#181830", "#1c1c28", "#161628", "#1e1a2a"];

// ── Desaturation targets ─────────────────────────────────────
const DESAT_COLOR = new THREE.Color("#111111");
const DESAT_EMISSIVE_WALL = new THREE.Color("#888888");
const DESAT_EMISSIVE_ROOF = new THREE.Color("#111111");

function createWindowTile(windowsX: number, litPct: number, seed: string, brandColors?: string[]): THREE.CanvasTexture {
  const w = windowsX * WIN;
  const h = TILE_ROWS * WIN;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = WINDOW_OFF_COLOR;
  ctx.fillRect(0, 0, w, h);

  const litColors = [...WINDOW_LIT_COLORS];
  if (brandColors && brandColors.length > 0) {
    for (const bc of brandColors) {
      litColors.push(bc, bc);
    }
  }

  const rng = seededRng(seed);
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < windowsX; col++) {
      const r = rng();
      if (r < litPct) {
        ctx.fillStyle = litColors[Math.floor(rng() * litColors.length)];
      } else {
        rng();
        ctx.fillStyle = WINDOW_OFF_COLOR;
      }
      ctx.fillRect(col * WIN + 1, row * WIN + 1, WIN - 2, WIN - 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function createBuildingMaterials(building: BuildingData, brandColors?: string[]): THREE.Material[] {
  const rng = seededRng(building.repo.repo_name + "mat");
  const faceColor = FACE_COLORS[Math.floor(rng() * FACE_COLORS.length)];

  const litPct = building.repo.repo_stars === 0
    ? 0.2
    : Math.min(0.95, 0.2 + Math.log10(building.repo.repo_stars + 1) / 4 * 0.75);

  const frontWindows = Math.max(2, Math.floor(building.width / 5));
  const sideWindows = Math.max(2, Math.floor(building.depth / 5));
  const tilesY = Math.max(1, Math.ceil(building.floors / TILE_ROWS));

  const frontTex = createWindowTile(frontWindows, litPct, building.repo.repo_name + "front", brandColors);
  frontTex.repeat.set(1, tilesY);

  const sideTex = createWindowTile(sideWindows, litPct, building.repo.repo_name + "side", brandColors);
  sideTex.repeat.set(1, tilesY);

  const wallProps = {
    emissive: new THREE.Color("#ffffff"),
    emissiveIntensity: 1.0,
    color: new THREE.Color(faceColor),
    roughness: 0.85,
    metalness: 0.05,
  };

  const sideMat = new THREE.MeshStandardMaterial({ ...wallProps, map: sideTex, emissiveMap: sideTex });
  const frontMat = new THREE.MeshStandardMaterial({ ...wallProps, map: frontTex, emissiveMap: frontTex });
  const roofMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2a3858"),
    emissive: new THREE.Color("#2a3858"),
    emissiveIntensity: 0.3,
    roughness: 0.9,
  });
  const bottomMat = new THREE.MeshStandardMaterial({ color: "#0a0a0a" });

  return [sideMat, sideMat, roofMat, bottomMat, frontMat, frontMat];
}

// ── Label texture for sprite-based labels ───────────────────
function createLabelTexture(name: string, stars: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 64);

  // Stars count
  if (stars > 0) {
    ctx.font = "bold 22px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffcc44";
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 6;
    ctx.fillText(`★ ${stars}`, 256, 16);
  }

  // Repo name
  ctx.font = "20px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#99aacc";
  ctx.shadowColor = "#000000";
  ctx.shadowBlur = 6;
  const displayName = name.length > 24 ? name.slice(0, 22) + "…" : name;
  ctx.fillText(displayName, 256, stars > 0 ? 46 : 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ── Building component ──────────────────────────────────────
function Building({
  building, index, riseProgress, hovered, active, onHover, onUnhover, onClick, brandColors,
  faviconUrl, brandColor, desaturated,
}: {
  building: BuildingData;
  index: number;
  riseProgress: React.RefObject<number>;
  hovered: boolean;
  active: boolean;
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
  brandColors?: string[];
  faviconUrl?: string;
  brandColor?: string;
  desaturated?: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const doneRef = useRef(false);
  const materials = useMemo(() => createBuildingMaterials(building, brandColors), [building, brandColors]);
  const labelTexture = useMemo(
    () => createLabelTexture(building.repo.repo_name, building.repo.repo_stars),
    [building.repo.repo_name, building.repo.repo_stars],
  );

  // Capture original material properties for desaturation lerp
  const originals = useMemo(() => materials.map((mat) => {
    if (mat instanceof THREE.MeshStandardMaterial) {
      return {
        emissiveIntensity: mat.emissiveIntensity,
        color: mat.color.clone(),
        emissive: mat.emissive.clone(),
        hasEmissiveMap: !!mat.emissiveMap,
      };
    }
    return null;
  }), [materials]);

  const desatRef = useRef(0);
  const labelRef = useRef<THREE.SpriteMaterial>(null);

  // Rise animation
  useFrame(() => {
    if (doneRef.current) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    const global = riseProgress.current ?? 0;

    if (global >= 1) {
      mesh.scale.y = 1;
      mesh.position.y = building.height / 2;
      doneRef.current = true;
      return;
    }

    const delay = index * 0.004;
    const local = Math.max(0, Math.min(1, (global - delay) / Math.max(0.05, 1 - delay)));
    const eased = 1 - Math.pow(1 - local, 3);
    const h = building.height;
    mesh.scale.y = 0.001 + eased * 0.999;
    mesh.position.y = (h * mesh.scale.y) / 2;
  });

  // Desaturation animation
  useFrame((_, delta) => {
    const target = desaturated ? 1 : 0;
    if (Math.abs(desatRef.current - target) < 0.002) {
      if (desatRef.current !== target) {
        desatRef.current = target;
        // Apply final state
        materials.forEach((mat, i) => {
          if (!(mat instanceof THREE.MeshStandardMaterial) || !originals[i]) return;
          const orig = originals[i];
          if (target === 0) {
            mat.emissiveIntensity = orig.emissiveIntensity;
            mat.color.copy(orig.color);
            mat.emissive.copy(orig.emissive);
          } else {
            mat.emissiveIntensity = orig.hasEmissiveMap ? 0.08 : 0.05;
            mat.color.copy(DESAT_COLOR);
            mat.emissive.copy(orig.hasEmissiveMap ? DESAT_EMISSIVE_WALL : DESAT_EMISSIVE_ROOF);
          }
        });
        if (labelRef.current) {
          labelRef.current.opacity = target === 0 ? (hovered ? 1 : 0.6) : 0.15;
        }
      }
      return;
    }

    desatRef.current += (target - desatRef.current) * Math.min(1, delta * 6);
    const t = desatRef.current;

    materials.forEach((mat, i) => {
      if (!(mat instanceof THREE.MeshStandardMaterial) || !originals[i]) return;
      const orig = originals[i];
      const targetIntensity = orig.hasEmissiveMap ? 0.08 : 0.05;
      mat.emissiveIntensity = THREE.MathUtils.lerp(orig.emissiveIntensity, targetIntensity, t);
      mat.color.copy(orig.color).lerp(DESAT_COLOR, t);
      const emissiveTarget = orig.hasEmissiveMap ? DESAT_EMISSIVE_WALL : DESAT_EMISSIVE_ROOF;
      mat.emissive.copy(orig.emissive).lerp(emissiveTarget, t);
    });

    if (labelRef.current) {
      const baseOpacity = hovered ? 1 : 0.6;
      labelRef.current.opacity = THREE.MathUtils.lerp(baseOpacity, 0.15, t);
    }
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[building.x, building.height / 2, building.z]}
        material={materials}
        onPointerEnter={(e) => { e.stopPropagation(); onHover(); }}
        onPointerLeave={(e) => { e.stopPropagation(); onUnhover(); }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <boxGeometry args={[building.width, building.height, building.depth]} />
      </mesh>

      {/* Favicon marker on the active (clicked) building */}
      {faviconUrl && brandColor && (
        <FaviconMarker
          url={faviconUrl}
          position={[building.x, building.height + 12, building.z]}
          brandColor={brandColor}
        />
      )}

      {/* Sprite label — no DOM, no jitter */}
      <sprite
        position={[building.x, building.height + (faviconUrl ? 20 : 6), building.z]}
        scale={[40, 5, 1]}
        renderOrder={10}
      >
        <spriteMaterial
          ref={labelRef}
          map={labelTexture}
          transparent
          depthTest={false}
          opacity={hovered ? 1 : 0.6}
          fog={false}
        />
      </sprite>

      {/* Tooltip — visible on hover or when building is selected */}
      {(hovered || active) && building.repo.repo_description && (
        <Html
          position={[building.x, building.height + (faviconUrl ? 34 : 20), building.z]}
          center
          style={{ pointerEvents: "none", zIndex: 100 }}
        >
          <div style={{
            background: "#12121ef0", border: "1px solid #334", borderRadius: 6,
            padding: "8px 12px", fontFamily: "monospace",
            boxShadow: "0 4px 24px #00000099", maxWidth: 420, minWidth: 280, textAlign: "center",
          }}>
            <div style={{ color: "#fff", fontWeight: "bold", fontSize: 12 }}>
              {building.repo.repo_name}
            </div>
            <div style={{ color: "#ffcc44", fontSize: 11, marginTop: 2 }}>
              {building.repo.repo_stars} stars &middot; {building.floors} floors
            </div>
            <div style={{
              color: "#99a", fontSize: 10, marginTop: 6, lineHeight: 1.5,
              whiteSpace: "normal",
            }}>
              {building.repo.repo_description}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// ── Billboard (screenshot) ──────────────────────────────────
function Billboard({
  screenshotUrl, brandColor, buildings,
}: {
  screenshotUrl: string;
  brandColor: string;
  buildings: BuildingData[];
}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      screenshotUrl,
      (tex) => {
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        setTexture(tex);
      },
      undefined,
      () => {}
    );
  }, [screenshotUrl]);

  const placement = useMemo(() => {
    let maxR = 200;
    for (const b of buildings) {
      const r = Math.sqrt(b.x * b.x + b.z * b.z) + Math.max(b.width, b.depth);
      if (r > maxR) maxR = r;
    }
    const dist = maxR + 120;
    const angle = Math.PI / 4;
    return {
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
      rotY: -angle + Math.PI,
    };
  }, [buildings]);

  if (!texture) return null;

  const screenW = 80;
  const screenH = 50;
  const boardY = 70;
  const frameW = screenW + 3;
  const frameH = screenH + 3;

  return (
    <group position={[placement.x, 0, placement.z]} rotation={[0, placement.rotY, 0]}>
      {/* Support beams */}
      <mesh position={[-screenW / 2 + 5, boardY / 2, 0]}>
        <boxGeometry args={[2.5, boardY, 2.5]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[screenW / 2 - 5, boardY / 2, 0]}>
        <boxGeometry args={[2.5, boardY, 2.5]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Back panel */}
      <mesh position={[0, boardY, -0.6]}>
        <boxGeometry args={[frameW, frameH, 1]} />
        <meshStandardMaterial color="#111122" metalness={0.3} roughness={0.5} />
      </mesh>

      {/* Glowing frame — top */}
      <mesh position={[0, boardY + frameH / 2, 0.2]}>
        <boxGeometry args={[frameW + 0.5, 0.6, 0.6]} />
        <meshStandardMaterial color={brandColor} emissive={brandColor} emissiveIntensity={2} />
      </mesh>
      {/* bottom */}
      <mesh position={[0, boardY - frameH / 2, 0.2]}>
        <boxGeometry args={[frameW + 0.5, 0.6, 0.6]} />
        <meshStandardMaterial color={brandColor} emissive={brandColor} emissiveIntensity={2} />
      </mesh>
      {/* left */}
      <mesh position={[-frameW / 2, boardY, 0.2]}>
        <boxGeometry args={[0.6, frameH + 0.5, 0.6]} />
        <meshStandardMaterial color={brandColor} emissive={brandColor} emissiveIntensity={2} />
      </mesh>
      {/* right */}
      <mesh position={[frameW / 2, boardY, 0.2]}>
        <boxGeometry args={[0.6, frameH + 0.5, 0.6]} />
        <meshStandardMaterial color={brandColor} emissive={brandColor} emissiveIntensity={2} />
      </mesh>

      {/* Screenshot */}
      <mesh position={[0, boardY, 0.5]}>
        <planeGeometry args={[screenW, screenH]} />
        <meshBasicMaterial map={texture} />
      </mesh>

      {/* Colored glow light */}
      <pointLight position={[0, boardY, 20]} color={brandColor} intensity={50} distance={80} decay={2} />
    </group>
  );
}

// ── Favicon marker on active building ───────────────────────
function FaviconMarker({ url, position, brandColor }: {
  url: string;
  position: [number, number, number];
  brandColor: string;
}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(url, (tex) => {
      tex.minFilter = THREE.LinearFilter;
      setTexture(tex);
    }, undefined, () => {});
  }, [url]);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.4;
    }
  });

  if (!texture) return null;

  return (
    <group position={position}>
      {/* Pole */}
      <mesh position={[0, -5, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 10, 6]} />
        <meshStandardMaterial color="#333340" metalness={0.5} roughness={0.3} />
      </mesh>

      {/* Rotating favicon */}
      <group ref={groupRef}>
        <mesh>
          <planeGeometry args={[10, 10]} />
          <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Glow */}
      <pointLight position={[0, 0, 0]} color={brandColor} intensity={25} distance={35} decay={2} />
    </group>
  );
}

// ── Brand accent lights at building bases ───────────────────
function BrandAccentLights({ buildings, brandColor }: {
  buildings: BuildingData[];
  brandColor: string;
}) {
  const topBuildings = buildings.slice(0, Math.min(4, buildings.length));

  return (
    <group>
      {topBuildings.map((b, i) => {
        const rng = seededRng(b.repo.repo_name + "accent");
        const offsetX = (rng() > 0.5 ? 1 : -1) * (b.width / 2 + 4);
        const offsetZ = (rng() - 0.5) * b.depth;
        return (
          <pointLight
            key={i}
            position={[b.x + offsetX, 3, b.z + offsetZ]}
            color={brandColor}
            intensity={20}
            distance={35}
            decay={2}
          />
        );
      })}
    </group>
  );
}

// ── Sky dome + stars ────────────────────────────────────────
function SkyDome() {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const tex = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2; canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#000002");
    g.addColorStop(0.2, "#010408");
    g.addColorStop(0.4, "#020810");
    g.addColorStop(0.6, "#040e1c");
    g.addColorStop(0.8, "#061428");
    g.addColorStop(1, "#081830");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 512);
    const t = new THREE.CanvasTexture(canvas);
    t.needsUpdate = true;
    return t;
  }, []);

  const starsGeo = useMemo(() => {
    const count = 600;
    const positions = new Float32Array(count * 3);
    const rng = seededRng("stars");
    for (let i = 0; i < count; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = rng() * Math.PI * 0.48;
      const r = 3400;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame(() => {
    if (groupRef.current) groupRef.current.position.copy(camera.position);
  });

  return (
    <group ref={groupRef}>
      <mesh renderOrder={-2}>
        <sphereGeometry args={[3500, 32, 48]} />
        <meshBasicMaterial map={tex} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      <points geometry={starsGeo} renderOrder={-2}>
        <pointsMaterial color="#ffffff" size={2.5} sizeAttenuation={false} transparent opacity={0.7} depthWrite={false} />
      </points>
    </group>
  );
}

// ── Ground ──────────────────────────────────────────────────
function Ground() {
  const floorTex = useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#28272a";
    ctx.fillRect(0, 0, size, size);

    const rng = seededRng("ground");
    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4) {
        const v = Math.floor(32 + rng() * 16);
        ctx.fillStyle = `rgb(${v}, ${v}, ${Math.floor(v * 0.95)})`;
        ctx.fillRect(x, y, 4, 4);
      }
    }

    ctx.strokeStyle = "#3d3a42";
    ctx.lineWidth = 3;
    for (let i = 0; i <= size; i += size / 8) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
    }

    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(60, 60);
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, []);

  return (
    <group>
      {/* Main visible terrain */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} renderOrder={0}>
        <planeGeometry args={[6000, 6000]} />
        <meshStandardMaterial
          map={floorTex}
          color="#ffffff"
          emissive="#1e1c22"
          emissiveIntensity={0.8}
          roughness={0.88}
          metalness={0.05}
          polygonOffset
          polygonOffsetFactor={4}
          polygonOffsetUnits={4}
        />
      </mesh>
      {/* Extended terrain blending to fog — well below main ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]} renderOrder={-1}>
        <planeGeometry args={[20000, 20000]} />
        <meshStandardMaterial
          color="#18161c"
          emissive="#0e0c14"
          emissiveIntensity={0.5}
          roughness={0.95}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ── Building sidewalks / pads ───────────────────────────────
function BuildingPads({ buildings }: { buildings: BuildingData[] }) {
  const geometry = useMemo(() => {
    const merged = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];

    for (const b of buildings) {
      const padW = b.width + 8;
      const padD = b.depth + 8;
      const padH = 1.5;
      const x = b.x, z = b.z;

      // Top face
      positions.push(
        x - padW / 2, padH, z - padD / 2,
        x + padW / 2, padH, z - padD / 2,
        x + padW / 2, padH, z + padD / 2,
        x - padW / 2, padH, z - padD / 2,
        x + padW / 2, padH, z + padD / 2,
        x - padW / 2, padH, z + padD / 2,
      );
      for (let i = 0; i < 6; i++) normals.push(0, 1, 0);

      // Front face
      positions.push(
        x - padW / 2, 0, z + padD / 2,
        x + padW / 2, 0, z + padD / 2,
        x + padW / 2, padH, z + padD / 2,
        x - padW / 2, 0, z + padD / 2,
        x + padW / 2, padH, z + padD / 2,
        x - padW / 2, padH, z + padD / 2,
      );
      for (let i = 0; i < 6; i++) normals.push(0, 0, 1);

      // Back face
      positions.push(
        x + padW / 2, 0, z - padD / 2,
        x - padW / 2, 0, z - padD / 2,
        x - padW / 2, padH, z - padD / 2,
        x + padW / 2, 0, z - padD / 2,
        x - padW / 2, padH, z - padD / 2,
        x + padW / 2, padH, z - padD / 2,
      );
      for (let i = 0; i < 6; i++) normals.push(0, 0, -1);

      // Left face
      positions.push(
        x - padW / 2, 0, z - padD / 2,
        x - padW / 2, 0, z + padD / 2,
        x - padW / 2, padH, z + padD / 2,
        x - padW / 2, 0, z - padD / 2,
        x - padW / 2, padH, z + padD / 2,
        x - padW / 2, padH, z - padD / 2,
      );
      for (let i = 0; i < 6; i++) normals.push(-1, 0, 0);

      // Right face
      positions.push(
        x + padW / 2, 0, z + padD / 2,
        x + padW / 2, 0, z - padD / 2,
        x + padW / 2, padH, z - padD / 2,
        x + padW / 2, 0, z + padD / 2,
        x + padW / 2, padH, z - padD / 2,
        x + padW / 2, padH, z + padD / 2,
      );
      for (let i = 0; i < 6; i++) normals.push(1, 0, 0);
    }

    merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    return merged;
  }, [buildings]);

  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshStandardMaterial
        color="#2a2a42"
        emissive="#1e1e32"
        emissiveIntensity={0.5}
        roughness={0.85}
        metalness={0.1}
      />
    </mesh>
  );
}

// ── Merged road geometry ────────────────────────────────────
function Roads({ buildings }: { buildings: BuildingData[] }) {
  const { geometry, uvs } = useMemo(() => {
    if (buildings.length < 2) return { geometry: null, uvs: null };
    const roadWidth = STREET * 0.6;

    const gridPositions = new Map<string, BuildingData>();
    for (const b of buildings) {
      const gx = Math.round(b.x / (CELL + STREET));
      const gz = Math.round(b.z / (CELL + STREET));
      gridPositions.set(`${gx},${gz}`, b);
    }

    const segments: { x: number; z: number; length: number; rotY: number }[] = [];
    const visited = new Set<string>();
    for (const b of buildings) {
      const gx = Math.round(b.x / (CELL + STREET));
      const gz = Math.round(b.z / (CELL + STREET));

      const rightKey = `${gx},${gz}-${gx + 1},${gz}`;
      if (!visited.has(rightKey) && gridPositions.has(`${gx + 1},${gz}`)) {
        visited.add(rightKey);
        const nb = gridPositions.get(`${gx + 1},${gz}`)!;
        segments.push({ x: (b.x + nb.x) / 2, z: b.z, length: CELL + STREET, rotY: 0 });
      }

      const fwdKey = `${gx},${gz}-${gx},${gz + 1}`;
      if (!visited.has(fwdKey) && gridPositions.has(`${gx},${gz + 1}`)) {
        visited.add(fwdKey);
        const nb = gridPositions.get(`${gx},${gz + 1}`)!;
        segments.push({ x: b.x, z: (b.z + nb.z) / 2, length: CELL + STREET, rotY: Math.PI / 2 });
      }
    }

    // Merge all road segments into a single geometry
    const positions: number[] = [];
    const normals: number[] = [];
    const uvsArr: number[] = [];
    const y = 0.2; // road surface height

    for (const seg of segments) {
      const hw = roadWidth / 2;
      const hl = seg.length / 2;
      const uRepeat = seg.length / 20;

      let corners: [number, number, number][];
      if (seg.rotY === 0) {
        // East-west road
        corners = [
          [seg.x - hl, y, seg.z - hw],
          [seg.x + hl, y, seg.z - hw],
          [seg.x + hl, y, seg.z + hw],
          [seg.x - hl, y, seg.z + hw],
        ];
      } else {
        // North-south road
        corners = [
          [seg.x - hw, y, seg.z - hl],
          [seg.x + hw, y, seg.z - hl],
          [seg.x + hw, y, seg.z + hl],
          [seg.x - hw, y, seg.z + hl],
        ];
      }

      // Two triangles
      positions.push(
        corners[0][0], corners[0][1], corners[0][2],
        corners[1][0], corners[1][1], corners[1][2],
        corners[2][0], corners[2][1], corners[2][2],
        corners[0][0], corners[0][1], corners[0][2],
        corners[2][0], corners[2][1], corners[2][2],
        corners[3][0], corners[3][1], corners[3][2],
      );
      for (let i = 0; i < 6; i++) normals.push(0, 1, 0);

      if (seg.rotY === 0) {
        uvsArr.push(0, 0, uRepeat, 0, uRepeat, 1, 0, 0, uRepeat, 1, 0, 1);
      } else {
        uvsArr.push(0, 0, 1, 0, 1, uRepeat, 0, 0, 1, uRepeat, 0, uRepeat);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvsArr, 2));

    return { geometry: geo, uvs: true };
  }, [buildings]);

  const roadTex = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#1e1e30";
    ctx.fillRect(0, 0, 128, 32);

    ctx.fillStyle = "#3a3a55";
    for (let x = 4; x < 128; x += 20) {
      ctx.fillRect(x, 14, 12, 4);
    }

    ctx.fillStyle = "#2a2a40";
    ctx.fillRect(0, 0, 128, 2);
    ctx.fillRect(0, 30, 128, 2);

    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, []);

  if (!geometry || !uvs) return null;

  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshStandardMaterial
        map={roadTex}
        emissive="#0e0e1a"
        emissiveIntensity={0.4}
        roughness={0.95}
        metalness={0.02}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}

// ── Street lamps (instanced, no per-lamp point lights) ──────
function StreetLamps({ buildings }: { buildings: BuildingData[] }) {
  const lampData = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < buildings.length; i += 3) {
      const b = buildings[i];
      const rng = seededRng(b.repo.repo_name + "lamp");
      out.push({
        x: b.x + (rng() > 0.5 ? 1 : -1) * (b.width / 2 + 8),
        z: b.z + (rng() - 0.5) * b.depth,
      });
    }
    return out;
  }, [buildings]);

  // Instanced pole meshes
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const globeRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < lampData.length; i++) {
      // Pole
      dummy.position.set(lampData[i].x, 5, lampData[i].z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleRef.current?.setMatrixAt(i, dummy.matrix);

      // Globe
      dummy.position.set(lampData[i].x, 10.5, lampData[i].z);
      dummy.updateMatrix();
      globeRef.current?.setMatrixAt(i, dummy.matrix);
    }
    if (poleRef.current) poleRef.current.instanceMatrix.needsUpdate = true;
    if (globeRef.current) globeRef.current.instanceMatrix.needsUpdate = true;
  }, [lampData]);

  const poleMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#333340" }), []);
  const globeMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#ffcc44", emissive: "#ffcc44", emissiveIntensity: 2,
  }), []);

  return (
    <group>
      <instancedMesh ref={poleRef} args={[undefined, undefined, lampData.length]} material={poleMat}>
        <cylinderGeometry args={[0.3, 0.3, 10, 6]} />
      </instancedMesh>
      <instancedMesh ref={globeRef} args={[undefined, undefined, lampData.length]} material={globeMat}>
        <sphereGeometry args={[0.8, 8, 8]} />
      </instancedMesh>
    </group>
  );
}

// ── Main scene ──────────────────────────────────────────────
export function CityScene({ repos, siteData, deselectRef }: {
  repos: Repo[];
  siteData?: SiteData;
  deselectRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const buildings = useMemo(() => layoutCity(repos), [repos]);
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const riseProgress = useRef(0);

  // Expose deselect callback for Canvas onPointerMissed
  useEffect(() => {
    if (deselectRef) deselectRef.current = () => setActiveName(null);
    return () => { if (deselectRef) deselectRef.current = null; };
  }, [deselectRef]);

  useFrame((_, delta) => {
    if (riseProgress.current < 1) {
      riseProgress.current = Math.min(1, riseProgress.current + delta * 0.6);
    }
  });

  const handleHover = useCallback((name: string) => setHoveredName(name), []);
  const handleUnhover = useCallback(() => setHoveredName(null), []);
  const handleClick = useCallback((name: string) => {
    setActiveName((prev) => (prev === name ? null : name));
  }, []);

  const brandColors = useMemo(() => {
    if (!siteData?.branding?.colors?.primary) return undefined;
    const colors: string[] = [];
    if (siteData.branding.colors.primary) colors.push(siteData.branding.colors.primary);
    if (siteData.branding.colors.accent && siteData.branding.colors.accent !== siteData.branding.colors.primary) {
      colors.push(siteData.branding.colors.accent);
    }
    return colors.length > 0 ? colors : undefined;
  }, [siteData]);

  const brandPrimary = siteData?.branding?.colors?.primary || "#ff4400";
  const faviconUrl = siteData?.branding?.images?.favicon || (siteData?.metadata?.favicon as string | undefined);

  return (
    <>
      <fog attach="fog" args={["#0a1428", 400, 2800]} />

      {/* Lighting — reduced to 2 directional + 1 hemisphere + 1 ambient */}
      <ambientLight intensity={1.0} color="#334466" />
      <directionalLight position={[300, 150, -200]} intensity={2.8} color="#8090c0" />
      <directionalLight position={[-200, 80, 200]} intensity={1.5} color="#405880" />
      <hemisphereLight args={["#203060", "#0a0a10", 2.2]} />

      <SkyDome />
      <Ground />
      <BuildingPads buildings={buildings} />
      <Roads buildings={buildings} />
      <StreetLamps buildings={buildings} />

      {/* Brand accent lights — reduced to 4 */}
      {siteData && (
        <BrandAccentLights buildings={buildings} brandColor={brandPrimary} />
      )}

      {/* Billboard */}
      {siteData?.screenshot && (
        <Billboard
          screenshotUrl={siteData.screenshot}
          brandColor={brandPrimary}
          buildings={buildings}
        />
      )}

      {/* Buildings */}
      {buildings.map((b, i) => {
        const isActive = activeName === b.repo.repo_name;
        const isHovered = hoveredName === b.repo.repo_name;
        return (
          <Building
            key={b.repo.repo_name}
            building={b}
            index={i}
            riseProgress={riseProgress}
            hovered={isHovered}
            active={isActive}
            onHover={() => handleHover(b.repo.repo_name)}
            onUnhover={handleUnhover}
            onClick={() => handleClick(b.repo.repo_name)}
            brandColors={brandColors}
            faviconUrl={isActive ? faviconUrl : undefined}
            brandColor={isActive ? brandPrimary : undefined}
            desaturated={!!activeName && !isActive}
          />
        );
      })}

      <OrbitControls
        target={[0, 30, 0]}
        maxDistance={1600}
        minDistance={40}
        maxPolarAngle={Math.PI / 2.1}
        autoRotate
        autoRotateSpeed={0.15}
        enableDamping
        dampingFactor={0.06}
      />
    </>
  );
}
