"use client";

import { Canvas } from "@react-three/fiber";
import { CityScene } from "./CityScene";
import { Suspense, useRef } from "react";

interface Repo {
  repo_name: string;
  repo_stars: number;
  repo_description: string;
}

export interface SiteData {
  screenshot?: string;
  summary?: string;
  branding?: {
    colorScheme?: string;
    colors?: {
      primary?: string;
      accent?: string;
      background?: string;
      textPrimary?: string;
      link?: string;
    };
    images?: {
      favicon?: string;
      logo?: string;
      ogImage?: string;
    };
  };
  metadata?: {
    title?: string;
    ogTitle?: string;
    description?: string;
    ogDescription?: string;
    favicon?: string;
    sourceURL?: string;
    [key: string]: unknown;
  };
}

export function City({ repos, siteData }: { repos: Repo[]; siteData?: SiteData }) {
  const deselectRef = useRef<(() => void) | null>(null);

  return (
    <div style={{ width: "100%", height: "100%", flex: 1, position: "relative" }}>
      <Canvas
        camera={{ fov: 55, near: 1, far: 4000, position: [300, 350, 500] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0 }}
        onPointerMissed={() => deselectRef.current?.()}
      >
        <Suspense fallback={null}>
          <CityScene repos={repos} siteData={siteData} deselectRef={deselectRef} />
        </Suspense>
      </Canvas>
    </div>
  );
}
