import { Texture } from 'pixi.js';

/** Load an image URL into a nearest-neighbor-filtered Pixi texture. Shared by
 *  OfficeFloor (tilesets/backgrounds) and any per-theme cast loader that reads
 *  raw sprite-sheet PNGs (e.g. kaltelaCast.ts) instead of drawing procedurally. */
export function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = Texture.from(img);
      tex.source.scaleMode = 'nearest';
      resolve(tex);
    };
    img.onerror = () => reject(new Error('failed to load ' + url.slice(0, 40)));
    img.src = url;
  });
}
