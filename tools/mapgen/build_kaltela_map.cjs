// One-off generator for assets/maps/kaltela.tmj — the 칼테라 오피스 theme's
// minimal Tiled map. No real tile art: `tilesets: []` so TiledMapRenderer
// skips drawing floor/walls/furniture entirely (see buildTileLayers's early
// return) and OfficeFloor instead layers the hand-drawn office_bg.png as a
// background sprite. This map supplies only what the engine still needs from
// a .tmj: a collision grid (for pathfinding/facing) and named spawn points
// (desk-ceo + pc-1..pc-5, from PRD 4-1's 자리 배치 table).
//
// tilewidth/tileheight = 8px, map = 960×640px (PRD's 2× background) → 120×80
// tiles. Run with `node tools/mapgen/build_kaltela_map.cjs` to regenerate.

const fs = require('fs');
const path = require('path');

const TILE = 8;
const MAP_W_PX = 960;
const MAP_H_PX = 640;
const W = MAP_W_PX / TILE; // 120
const H = MAP_H_PX / TILE; // 80

// Seat coords — 1× pixel coords ×2 (this map is already drawn at 2×).
// These are PRD 4-1's original numbers. An earlier pass "corrected" them by
// scanning office_bg.png's pink desk rectangles and centering the character
// in each one — that was wrong: scanning the actual MOCKUP
// (kaltela_office_mockup.png) for each character's own body color gives a
// center-x that matches the PRD table exactly (e.g. editor cx=300, same as
// the table), because the artist seated characters off-center in their desk
// (toward the side away from the monitor), not centered on it. The real bug
// behind the visible drift was the seat-offset nudge in Character.ts being
// scaled by the character's display scale — fixed there; coordinates here
// are back to the PRD table.
const SEATS_2X = {
  'desk-ceo': [300, 77],   // 편집장
  'pc-1': [54, 171],       // 리서처
  'pc-2': [143, 171],      // 스토리 작가
  'pc-3': [314, 171],      // 성과 분석가
  'pc-4': [400, 171],      // 영업사원
  'pc-5': [54, 253],       // 연출 담당
};
for (const k of Object.keys(SEATS_2X)) SEATS_2X[k] = [SEATS_2X[k][0] * 2, SEATS_2X[k][1] * 2];

// Where agents first appear and walk in from — open floor, bottom-center.
const ENTRANCE_2X = [480, 600];

// ─── collision grid (0 = walkable, 1 = blocked) ────────────────────────────
const grid = Array.from({ length: H }, () => Array(W).fill(0));
const block = (tx, ty) => { if (tx >= 0 && tx < W && ty >= 0 && ty < H) grid[ty][tx] = 1; };

// Border wall so pathfinding/wandering never walks off the background art.
for (let x = 0; x < W; x++) { block(x, 0); block(x, H - 1); }
for (let y = 0; y < H; y++) { block(0, y); block(W - 1, y); }

// One blocked tile directly SOUTH of each desk seat — the signal
// facingForSeat() in OfficeFloor.tsx reads to decide an agent faces 'down'
// (front view, toward the camera) instead of 'up'. PRD 4-1/5장: all 6 staff
// are front-facing — only the separately-drawn 대표(칼테라) decoration is
// rear-facing (뒷모습), and that one isn't a seat at all (see OfficeFloor.tsx).
for (const [x2, y2] of Object.values(SEATS_2X)) {
  const tx = Math.floor(x2 / TILE);
  const ty = Math.floor(y2 / TILE);
  block(tx, ty + 1);
}

const collisionData = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) collisionData.push(grid[y][x]);

const spawnObjects = Object.entries(SEATS_2X).map(([name, [x, y]], i) => ({
  id: i + 1,
  name,
  point: true,
  x,
  y,
  width: 0,
  height: 0
}));
spawnObjects.push({
  id: spawnObjects.length + 1,
  name: 'entrance',
  point: true,
  x: ENTRANCE_2X[0],
  y: ENTRANCE_2X[1],
  width: 0,
  height: 0
});

const tmj = {
  width: W,
  height: H,
  tilewidth: TILE,
  tileheight: TILE,
  type: 'map',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  infinite: false,
  tilesets: [],
  layers: [
    {
      name: 'collision',
      type: 'tilelayer',
      width: W,
      height: H,
      data: collisionData
    },
    {
      name: 'spawn-points',
      type: 'objectgroup',
      objects: spawnObjects
    }
  ]
};

// Vite's `@/assets` alias resolves to src/renderer/src/assets — the only place
// a `?raw`/`?url` import can actually find this file (NOT the project-root
// assets/ folder the source PNGs were delivered into).
const outPath = path.join(__dirname, '..', '..', 'src', 'renderer', 'src', 'assets', 'maps', 'kaltela.tmj');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(tmj), 'utf8');
console.log(`wrote ${outPath} (${W}x${H} tiles @ ${TILE}px, ${spawnObjects.length} spawn points)`);
