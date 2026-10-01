import type { Mesh, MeshBasicMaterial } from 'three';

export interface ConnectionGuide {
  guide: Mesh;
  guideMat: MeshBasicMaterial;
  guideRadius: number;
}

/** Reuse the target ring for approach, capture and a single settling ripple. */
export function updateConnectionGuide(
  target: ConnectionGuide,
  time: number,
  proximity: number,
  magnet: boolean,
  progress: number,
  phase: string,
  age: number,
): void {
  const near = Math.max(0, Math.min(1, proximity));
  let scale = 1 + 0.035 * Math.sin(time * 2.6);
  let opacity = 0.08 + near * 0.42;
  if (magnet) {
    const t = Math.max(0, Math.min(1, progress));
    const ease = t * t * (3 - 2 * t);
    scale = 1 - ease * 0.42;
    opacity = 0.6 + ease * 0.25;
  } else if (phase === 'seated' || phase === 'flowing') {
    const t = Math.max(0, Math.min(1, age / 0.55));
    scale = 0.58 + (1 - (1 - t) ** 3) * 1.35;
    opacity = (phase === 'flowing' ? 0.55 : 0.85) * (1 - t) ** 2;
  } else {
    scale -= near * 0.15;
  }
  target.guide.scale.setScalar(target.guideRadius * scale);
  target.guideMat.opacity = opacity;
  target.guide.visible = opacity > 0.005;
}
