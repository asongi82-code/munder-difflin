import { useEffect, useRef } from 'react';
import { KALTELA_SHEET_URL, type KaltelaCharacterName } from '@/scene/office/kaltelaCast';

// Sheet layout (kaltelaCast.ts): 32×48 frames, row 0 = front idle.
const FRAME_W = 32;
const FRAME_H = 48;
const SRC_ROW_FRONT = 0;

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('failed to load ' + url.slice(0, 40)));
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

export interface KaltelaSpritePortraitProps {
  character: KaltelaCharacterName;
  /** Pixels per source pixel — same contract as SpritePortrait. */
  scale?: number;
  background?: string;
}

/** Static front-standing preview of a kaltela cast member, cropped straight off
 *  its walk-sheet PNG — the kaltela-theme equivalent of SpritePortrait (which
 *  only knows how to paint the procedural OFFICE_CAST). Used by the Add/Edit
 *  Agent character picker so hiring under the kaltela theme shows the real
 *  roster (편집장/리서처/스토리 작가/연출 담당/성과 분석가/영업사원) instead of
 *  the generic office cast. */
export function KaltelaSpritePortrait({
  character,
  scale = 2,
  background = 'transparent'
}: KaltelaSpritePortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let cancelled = false;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    loadImage(KALTELA_SHEET_URL[character]).then((img) => {
      if (cancelled) return;
      ctx.drawImage(
        img,
        0, SRC_ROW_FRONT * FRAME_H, FRAME_W, FRAME_H,
        0, 0, Math.round(FRAME_W * scale), Math.round(FRAME_H * scale)
      );
    }).catch(() => { /* asset load race */ });
    return () => { cancelled = true; };
  }, [character, scale, background]);

  const w = Math.round(FRAME_W * scale);
  const h = Math.round(FRAME_H * scale);

  return (
    <canvas
      ref={canvasRef}
      width={w}
      height={h}
      style={{ width: w, height: h, imageRendering: 'pixelated' }}
    />
  );
}
