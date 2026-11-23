'use client';

import React from 'react';
import { mountScene } from './scenes';

/** An experiment's 3D picture, or a network's diagram (`wide`), on a canvas that fills its parent. */
export function SceneCanvas({ scene, wide = false, drag = false, sharp = 1, label }: { scene: string; wide?: boolean; drag?: boolean; sharp?: number; label: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => (ref.current ? mountScene(ref.current, scene, { wide, drag, sharp }) : undefined), [scene, wide, drag, sharp]);
  return <canvas ref={ref} role="img" aria-label={label} />;
}
