"use client";

import { useRef, useMemo, useCallback, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

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
function layoutCity(repos: Repo[]): BuildingData[] {
  const sorted = [...repos].sort((a, b) => b.repo_stars - a.repo_stars);
  const CELL = 50, STREET = 30;

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
// Generates a small tileable canvas with a 4-row × N-column window pattern,
// then uses RepeatWrapping to tile it across the full building height.
const WIN = 8;  // pixels per window cell
const TILE_ROWS = 4; // rows in the tile pattern
const WINDOW_LIT_COLORS = ["#ffcc44", "#ffdd66", "#ffe088", "#44bbff", "#66ddff", "#88eeff"];
const WINDOW_OFF_COLOR = "#0c0c1a";
const FACE_COLORS = ["#1a1a2e", "#181830", "#1c1c28", "#161628", "#1e1a2a"];

function createWindowTile(windowsX: number, litPct: number, seed: string): THREE.CanvasTexture {
  const w = windowsX * WIN;
  const h = TILE_ROWS * WIN;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = WINDOW_OFF_COLOR;
  ctx.fillRect(0, 0, w, h);

  const rng = seededRng(seed);
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < windowsX; col++) {
      const r = rng();
      if (r < litPct) {
        ctx.fillStyle = WINDOW_LIT_COLORS[Math.floor(rng() * WINDOW_LIT_COLORS.length)];
      } else {
        rng(); // consume to keep sequence aligned
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

function createBuildingMaterials(building: BuildingData): THREE.Material[] {
  const rng = seededRng(building.repo.repo_name + "mat");
  const faceColor = FACE_COLORS[Math.floor(rng() * FACE_COLORS.length)];

  // Lit percentage: more stars = more windows lit
  const litPct = building.repo.repo_stars === 0
    ? 0.2
    : Math.min(0.95, 0.2 + Math.log10(building.repo.repo_stars + 1) / 4 * 0.75);

  const frontWindows = Math.max(2, Math.floor(building.width / 5));
  const sideWindows = Math.max(2, Math.floor(building.depth / 5));

  // How many times to tile vertically to cover all floors
  const tilesY = Math.max(1, Math.ceil(building.floors / TILE_ROWS));

  // Create unique tileable textures for front and side faces
  const frontTex = createWindowTile(frontWindows, litPct, building.repo.repo_name + "front");
  frontTex.repeat.set(1, tilesY);

  const sideTex = createWindowTile(sideWindows, litPct, building.repo.repo_name + "side");
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

  // Box face order: [+x, -x, +y, -y, +z, -z]
  return [sideMat, sideMat, roofMat, bottomMat, frontMat, frontMat];
}

// ── Building component ──────────────────────────────────────
function Building({
  building, index, riseProgress, hovered, onHover, onUnhover,
}: {
  building: BuildingData;
  index: number;
  riseProgress: React.RefObject<number>;
  hovered: boolean;
  onHover: () => void;
  onUnhover: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materials = useMemo(() => createBuildingMaterials(building), [building]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const global = riseProgress.current ?? 0;
    if (global >= 1) return;

    const delay = index * 0.004;
    const local = Math.max(0, Math.min(1, (global - delay) / Math.max(0.05, 1 - delay)));
    const eased = 1 - Math.pow(1 - local, 3);
    const h = building.height;
    mesh.scale.y = 0.001 + eased * 0.999;
    mesh.position.y = (h * mesh.scale.y) / 2;
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[building.x, building.height / 2, building.z]}
        material={materials}
        onPointerEnter={(e) => { e.stopPropagation(); onHover(); }}
        onPointerLeave={(e) => { e.stopPropagation(); onUnhover(); }}
      >
        <boxGeometry args={[building.width, building.height, building.depth]} />
      </mesh>

      {/* Always-visible label: stars on top, name below */}
      <Html
        position={[building.x, building.height + 6, building.z]}
        center
        distanceFactor={350}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          fontFamily: "monospace", textAlign: "center",
        }}>
          <div style={{
            color: "#ffcc44", fontSize: 10, fontWeight: "bold",
            textShadow: "0 0 6px #000, 0 0 3px #000",
          }}>
            {building.repo.repo_stars > 0 ? `${building.repo.repo_stars}` : ""}
          </div>
          <div style={{
            color: hovered ? "#fff" : "#99a",
            fontSize: 10, fontWeight: hovered ? "bold" : "normal",
            whiteSpace: "nowrap", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis",
            textShadow: "0 0 6px #000, 0 0 3px #000",
            transition: "color 0.15s",
          }}>
            {building.repo.repo_name}
          </div>
        </div>
      </Html>

      {/* Hover tooltip with description */}
      {hovered && building.repo.repo_description && (
        <Html
          position={[building.x, building.height + 20, building.z]}
          center
          style={{ pointerEvents: "none", zIndex: 100 }}
        >
          <div style={{
            background: "#12121ef0", border: "1px solid #334", borderRadius: 6,
            padding: "8px 12px", fontFamily: "monospace",
            boxShadow: "0 4px 24px #00000099", maxWidth: 240, textAlign: "center",
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

// ── Sky dome ────────────────────────────────────────────────
function SkyDome() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  const tex = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2; canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#000206");
    g.addColorStop(0.25, "#040e28");
    g.addColorStop(0.5, "#0c2048");
    g.addColorStop(0.75, "#183060");
    g.addColorStop(1, "#203860");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 512);
    const t = new THREE.CanvasTexture(canvas);
    t.needsUpdate = true;
    return t;
  }, []);

  useFrame(() => {
    if (meshRef.current) meshRef.current.position.copy(camera.position);
  });

  return (
    <mesh ref={meshRef} renderOrder={-1}>
      <sphereGeometry args={[3500, 32, 48]} />
      <meshBasicMaterial map={tex} side={THREE.BackSide} depthWrite={false} />
    </mesh>
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

    // Dark asphalt base
    ctx.fillStyle = "#1a1a28";
    ctx.fillRect(0, 0, size, size);

    // Subtle noise grain for texture
    const rng = seededRng("ground");
    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4) {
        const v = Math.floor(20 + rng() * 12);
        ctx.fillStyle = `rgb(${v}, ${v}, ${v + 8})`;
        ctx.fillRect(x, y, 4, 4);
      }
    }

    // Grid lines (roads)
    ctx.strokeStyle = "#2a2a40";
    ctx.lineWidth = 2;
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
      {/* Main visible floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[6000, 6000]} />
        <meshStandardMaterial
          map={floorTex}
          color="#ffffff"
          emissive="#141420"
          emissiveIntensity={0.6}
          roughness={0.92}
          metalness={0.05}
        />
      </mesh>
      {/* Darker ground extending beyond to fog */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
        <planeGeometry args={[20000, 20000]} />
        <meshStandardMaterial color="#0c0c16" emissive="#060610" emissiveIntensity={0.3} roughness={0.98} />
      </mesh>
    </group>
  );
}

// ── Street lamps (every 3rd building) ───────────────────────
function StreetLamps({ buildings }: { buildings: BuildingData[] }) {
  const lamps = useMemo(() => {
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

  return (
    <group>
      {lamps.map((l, i) => (
        <group key={i} position={[l.x, 0, l.z]}>
          <mesh position={[0, 5, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 10, 6]} />
            <meshStandardMaterial color="#333340" />
          </mesh>
          <mesh position={[0, 10.5, 0]}>
            <sphereGeometry args={[0.8, 8, 8]} />
            <meshStandardMaterial color="#ffcc44" emissive="#ffcc44" emissiveIntensity={2} />
          </mesh>
          <pointLight position={[0, 10, 0]} color="#ffcc44" intensity={15} distance={40} decay={2} />
        </group>
      ))}
    </group>
  );
}

// ── Main scene ──────────────────────────────────────────────
export function CityScene({ repos }: { repos: Repo[] }) {
  const buildings = useMemo(() => layoutCity(repos), [repos]);
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const riseProgress = useRef(0);

  useFrame((_, delta) => {
    if (riseProgress.current < 1) {
      riseProgress.current = Math.min(1, riseProgress.current + delta * 0.6);
    }
  });

  const handleHover = useCallback((name: string) => setHoveredName(name), []);
  const handleUnhover = useCallback(() => setHoveredName(null), []);

  return (
    <>
      <fog attach="fog" args={["#0a1428", 400, 2800]} />

      {/* Lighting */}
      <ambientLight intensity={1.0} color="#334466" />
      <directionalLight position={[300, 150, -200]} intensity={2.8} color="#8090c0" />
      <directionalLight position={[-200, 80, 200]} intensity={1.5} color="#405880" />
      <hemisphereLight args={["#203060", "#0a0a10", 2.2]} />

      <SkyDome />
      <Ground />
      <StreetLamps buildings={buildings} />

      {/* Buildings */}
      {buildings.map((b, i) => (
        <Building
          key={b.repo.repo_name}
          building={b}
          index={i}
          riseProgress={riseProgress}
          hovered={hoveredName === b.repo.repo_name}
          onHover={() => handleHover(b.repo.repo_name)}
          onUnhover={handleUnhover}
        />
      ))}

      {/* Orbit controls */}
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
