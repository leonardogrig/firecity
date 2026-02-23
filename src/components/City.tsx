"use client";

import { Canvas } from "@react-three/fiber";
import { CityScene } from "./CityScene";
import { Suspense } from "react";

interface Repo {
  repo_name: string;
  repo_stars: number;
  repo_description: string;
}

export function City({ repos }: { repos: Repo[] }) {
  return (
    <div style={{ width: "100%", height: "100%", flex: 1, position: "relative" }}>
      <Canvas
        camera={{ fov: 55, near: 0.5, far: 4000, position: [300, 350, 500] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0 }}
      >
        <Suspense fallback={null}>
          <CityScene repos={repos} />
        </Suspense>
      </Canvas>
    </div>
  );
}
