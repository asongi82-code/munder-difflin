// Theme registry — the pluggable "office theme" contract.
//
// Phase 0 of the TV-show-offices feature (card tvshow-phase0-abstraction):
// extract the ~40% of constants that were hard-coded inside OfficeFloor.tsx
// (errand spots, coffee-economy tile coords, prop anchors, seat names, tileset
// URLs, palette, monitor gids) into a ThemeConfig so the scene becomes
// swappable per show. This phase ships the EXISTING office unchanged as
// `theme: 'office'`: every value below is copied byte-for-byte from the old
// in-file literals, so the office renders and behaves identically.
//
// The engine (TiledMapRenderer / BFS pathfinding / Camera / sprite animation)
// is already fully generic and needs no change. cast.ts is read-only here
// (uncommitted human WIP) — the office theme references its existing exports.

import type { Texture } from 'pixi.js';
import { colors } from '@/design/tokens';
import {
  CAST_BY_NAME,
  getCastFrames,
  DEFAULT_CHARACTER,
  type CastMember,
  type OfficeCharacterName,
} from './cast';

import officeTilesetUrl from '@/assets/tilesets/office-tileset.png?url';
import a5FloorsWallsUrl from '@/assets/tilesets/a5-office-floors-walls.png?url';
import interiorsUrl from '@/assets/tilesets/interiors.png?url';
// .tmj is Tiled JSON; imported as raw text and parsed by the loader.
import officeMapRaw from '@/assets/maps/office.tmj?raw';
import brooklyn99MapRaw from '@/assets/maps/brooklyn99.tmj?raw';
import kaltelaMapRaw from '@/assets/maps/kaltela.tmj?raw';
import kaltelaBgUrl from '@/assets/office/office_bg.png?url';
import { KALTELA_CAST_BY_NAME, getKaltelaCastFrames, KALTELA_DEFAULT_CHARACTER } from './kaltelaCast';

/** Theme identifiers. 'office' and 'kaltela' (this fork's own office, PRD 4-1)
 *  are real; the five TV-show themes (friends, brooklyn99, siliconvalley, got,
 *  hogwarts) land in later phases of that separate feature. */
export type ThemeId =
  | 'office'
  | 'kaltela'
  | 'friends'
  | 'brooklyn99'
  | 'siliconvalley'
  | 'got'
  | 'hogwarts';

export interface Tile { x: number; y: number; }
export type Facing = 'up' | 'down' | 'left' | 'right';

/** Kinds of small idle errands around the office (incl. plant watering).
 *  'smoke' is the boss special: cigar at the open window, god only. */
export type ErrandKind =
  | 'water' | 'window' | 'dispenser' | 'fridge' | 'shelf' | 'bin' | 'smoke' | 'sweep';

/** One idle-errand anchor: a stand tile + facing, an `fx` tile for the ambient
 *  animation, a duration, and an optional god-only restriction. */
export interface ErrandSpot {
  kind: ErrandKind;
  stand: Tile;
  facing: Facing;
  fx: Tile;
  duration: number;
  godOnly?: boolean;
}

/** One tileset atlas + its placement in the global gid space. `embedded` marks
 *  the atlas whose metadata already lives inline in the map's own `tilesets[0]`
 *  (the loader keeps the map's copy and only patches the appended atlases). */
export interface TilesetEntry {
  url: string;
  embedded?: boolean;
  firstgid?: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  columns?: number;
  tilecount?: number;
}

/** Desk-monitor overlay gids. The map paints an OFF monitor block; DeskScreen
 *  overlays the matching ON tiles while the desk's agent is seated. */
export interface MonitorConfig {
  /** gid of the OFF monitor block's top-left tile, as painted in the map. */
  offTopLeftGid: number;
  /** Matching ON tiles as [gid, dx, dy] relative to the block's top-left. */
  onGids: ReadonlyArray<readonly [number, number, number]>;
}

/** The coffee economy's fixed tiles: sideboard (mug rack) → counter machine →
 *  sink → back to the sideboard. `maxCups` caps the clean-mug stock. */
export interface CoffeeConfig {
  trayTile: Tile;
  trayStand: Tile;
  machineStand: Tile;
  sinkTile: Tile;
  sinkStand: Tile;
  maxCups: number;
}

/** Clickable prop anchors (tile coords). calendar → TRIGGERS, boards → TASKS,
 *  clock → CLOSING TIME. */
export interface AnchorConfig {
  calendar: Tile;
  boards: Tile;
  clock: Tile;
  /** Where the ASK ME board hangs. Omitted = OfficeFloor's own hardcoded
   *  office-wall position (the right wall run, office theme only) — a theme
   *  whose floor isn't that tileset (kaltela) must set this explicitly or the
   *  board lands wherever that hardcoded tile happens to fall on its art. */
  askBoard?: Tile;
}

/** Theme palette. `background` is the canvas clear color; `noteColors` are the
 *  kanban note colors keyed by task status. */
export interface PaletteConfig {
  background: number;
  noteColors: Record<string, number>;
}

/** Per-theme cast loader — the indirection point so a future show can swap its
 *  own roster + sprite frames. The office theme points at cast.ts's exports. */
export interface ThemeCast {
  byName: Record<string, CastMember>;
  getFrames: (name: string) => Promise<Texture[][]>;
  defaultCharacter: string;
}

/** The full contract a theme must supply. See report §A (theme contract). */
export interface ThemeConfig {
  id: ThemeId;
  /** Raw Tiled JSON text; parsed + tileset-patched by themeLoader. */
  mapRaw: string;
  /** Ordered atlases — order matches both the texture load order and the map's
   *  tileset array (texture[i] ↔ tilesets[i]). */
  tilesets: TilesetEntry[];
  /** Desk-claim order, by spawn-point name (seat 0 = god / desk-ceo). */
  primarySeatNames: string[];
  /** Paired café table seats, in order. */
  cafeSeatNames: string[];
  /** Café standing spots: [spawn-point name, kind]. */
  cafeStands: ReadonlyArray<readonly [string, 'coffee' | 'vending']>;
  coffee: CoffeeConfig;
  anchors: AnchorConfig;
  errandSpots: ErrandSpot[];
  monitor: MonitorConfig;
  palette: PaletteConfig;
  cast: ThemeCast;
  /** A raster image drawn beneath every tile/character layer, at its own
   *  native pixel size (independent of tileSize) — for a theme whose floor is
   *  one hand-drawn picture (kaltela) rather than a tileset. Omitted for every
   *  tile-based theme (office, brooklyn99, …). */
  backgroundImage?: { url: string; width: number; height: number };
  /** Per-seat sprite scale override, keyed by spawn-point name (PRD 5장 「크기
   *  비율」: kaltela staff render bigger than the office default, and the
   *  desk-ceo seat bigger again). A seat not listed, or a theme that omits
   *  this entirely, uses CharacterSprite's own default scale. */
  seatScale?: Record<string, number>;
  /** Walk animation rate (real frames/sec) for every seated agent in this
   *  theme, passed straight to CharacterSprite. Omitted = CharacterSprite's
   *  own ~9fps default (office, brooklyn99, …). kaltela's sheet_layout.json
   *  specifies 6. */
  castWalkFps?: number;
  /** Seated leg/back crop override, in the cast sheet's own native pixels —
   *  see Character.ts's SEAT_LEG_CROP/SEAT_BACK_CROP (tuned for a 32px-tall
   *  native frame). Omitted = those office-tuned defaults. */
  castSeatLegCrop?: number;
  castSeatBackCrop?: number;
  /** Extra px the thought bubble lifts above its own built-in headroom — see
   *  Character.ts's CharacterOptions.bubbleHeadroom. Omitted = 0 (office,
   *  brooklyn99, …, whose ~32px-tall native frame ThoughtBubble is tuned for). */
  castBubbleHeadroom?: number;
  /** Fixed character → spawn-point-name seat assignment, for a theme whose
   *  desks are each labeled for one specific role (kaltela's nameplates +
   *  PRD 4-1 자리 배치 table) rather than generic interchangeable desks. A
   *  theme that omits this (office, brooklyn99, …) falls back to claiming the
   *  next free seat in `primarySeatNames` order regardless of character. */
  seatForCharacter?: Record<string, string>;
}

/** The existing office, expressed as a theme. Values are copied verbatim from
 *  the former in-file constants in OfficeFloor.tsx / DeskScreen.ts. */
export const OFFICE_THEME: ThemeConfig = {
  id: 'office',
  mapRaw: officeMapRaw,
  tilesets: [
    // office-tileset.png — embedded in the map (firstgid 1); keep the map's copy.
    { url: officeTilesetUrl, embedded: true },
    { url: a5FloorsWallsUrl, firstgid: 513, image: 'a5', imagewidth: 256, imageheight: 512, tilewidth: 16, tileheight: 16, columns: 16, tilecount: 512 },
    { url: interiorsUrl, firstgid: 1025, image: 'interiors', imagewidth: 256, imageheight: 1424, tilewidth: 16, tileheight: 16, columns: 16, tilecount: 1424 },
  ],
  primarySeatNames: [
    'desk-ceo',
    'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5', 'pc-6',
    'desk-chief-architect', 'desk-product-manager', 'desk-team-lead',
    'desk-backend-engineer', 'desk-ui-ux-expert', 'desk-data-engineer',
    'desk-project-manager', 'desk-market-researcher', 'desk-agent-organizer',
  ],
  cafeSeatNames: ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'],
  cafeStands: [
    ['cafe-stand-coffee', 'coffee'],
    ['cafe-stand-vending', 'vending'],
  ],
  coffee: {
    trayTile: { x: 29, y: 15 },     // the sideboard (counter piece)
    trayStand: { x: 29, y: 16 },
    machineStand: { x: 26, y: 20 }, // below the counter machine
    sinkTile: { x: 28, y: 18 },     // free counter top, right end
    sinkStand: { x: 28, y: 20 },
    maxCups: 4,
  },
  anchors: {
    calendar: { x: 4, y: 1 },
    boards: { x: 6, y: 10 },
    clock: { x: 1, y: 1 },
  },
  errandSpots: [
    // plants (droplets ride on the character via startWatering)
    { kind: 'water', stand: { x: 2, y: 20 }, facing: 'left', fx: { x: 1, y: 20 }, duration: 4.5 },
    { kind: 'water', stand: { x: 22, y: 20 }, facing: 'right', fx: { x: 23, y: 20 }, duration: 4.5 },
    { kind: 'water', stand: { x: 30, y: 20 }, facing: 'right', fx: { x: 31, y: 20 }, duration: 4.5 },
    // the CEO office is the god's domain: its plant, window, cigar. Workers
    // never set foot in there for errands.
    { kind: 'water', stand: { x: 6, y: 4 }, facing: 'up', fx: { x: 6, y: 3 }, duration: 4.5, godOnly: true },
    { kind: 'smoke', stand: { x: 2, y: 3 }, facing: 'up', fx: { x: 2, y: 1 }, duration: 18, godOnly: true },
    { kind: 'water', stand: { x: 17, y: 4 }, facing: 'up', fx: { x: 17, y: 3 }, duration: 4.5 },
    // the two public wall windows — wind streaks drift into the room
    { kind: 'window', stand: { x: 10, y: 3 }, facing: 'up', fx: { x: 10, y: 1 }, duration: 5 },
    { kind: 'window', stand: { x: 15, y: 3 }, facing: 'up', fx: { x: 14, y: 1 }, duration: 5 },
    // water dispensers (hallway + the top-right corner one)
    { kind: 'dispenser', stand: { x: 16, y: 3 }, facing: 'down', fx: { x: 16, y: 4 }, duration: 3.5 },
    { kind: 'dispenser', stand: { x: 32, y: 4 }, facing: 'up', fx: { x: 32, y: 3 }, duration: 3.5 },
    // the café fridge (door light spills out) + the shelf beside it
    { kind: 'fridge', stand: { x: 29, y: 20 }, facing: 'up', fx: { x: 29, y: 19 }, duration: 3.2 },
    { kind: 'shelf', stand: { x: 30, y: 20 }, facing: 'up', fx: { x: 30, y: 18 }, duration: 4 },
    // garbage bins (entrance + café) — a paper ball arcs in
    { kind: 'bin', stand: { x: 18, y: 20 }, facing: 'left', fx: { x: 17, y: 20 }, duration: 2.6 },
    { kind: 'bin', stand: { x: 31, y: 16 }, facing: 'right', fx: { x: 32, y: 16 }, duration: 2.6 },
  ],
  monitor: {
    offTopLeftGid: 365,
    onGids: [
      [367, 0, 0], [368, 1, 0],
      [383, 0, 1], [384, 1, 1],
    ],
  },
  palette: {
    background: colors.ink[900],
    noteColors: { todo: 0xf2df8a, doing: 0x9ecbf0, blocked: 0xf0a3a3, done: 0xa8e0b0 },
  },
  cast: {
    byName: CAST_BY_NAME as Record<string, CastMember>,
    getFrames: (name: string) => getCastFrames(name as OfficeCharacterName),
    defaultCharacter: DEFAULT_CHARACTER,
  },
};

/** Brooklyn Nine-Nine — the 99th precinct (TV-show offices Phase 2, structure).
 *  The map (brooklyn99.tmj) is a precinct bullpen: Captain Holt's glass office
 *  in the back corner (`desk-ceo`), an 8-desk detective bullpen (`pc-1..8`), a
 *  briefing room (boardroom zone) + break room (cafeteria zone) with the coffee
 *  economy. PLACEHOLDER ART: the map reuses the office tileset gids, so the
 *  tilesets / monitor / palette / cast below reuse the office theme verbatim —
 *  Pam's license-clean B99 tileset + cast likenesses (§C/§D) drop into those
 *  same seams later. Only the layout-bound anchors (seats, café, coffee, props,
 *  errands) are authored to brooklyn99.tmj's own coordinates. */
export const BROOKLYN99_THEME: ThemeConfig = {
  id: 'brooklyn99',
  mapRaw: brooklyn99MapRaw,
  // PLACEHOLDER: brooklyn99.tmj uses the office gid space, so the same atlases
  // (office-tileset embedded @1, a5 @513, interiors @1025) resolve every tile.
  tilesets: OFFICE_THEME.tilesets,
  primarySeatNames: [
    'desk-ceo',                                            // Captain Holt's glass office
    'pc-1', 'pc-2', 'pc-3', 'pc-4',                        // bullpen — front row
    'pc-5', 'pc-6', 'pc-7', 'pc-8',                        // bullpen — back row
  ],
  cafeSeatNames: ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'],
  cafeStands: [
    ['cafe-stand-coffee', 'coffee'],
    ['cafe-stand-vending', 'vending'],
  ],
  coffee: {
    trayTile: { x: 33, y: 18 },
    trayStand: { x: 33, y: 19 },
    machineStand: { x: 30, y: 21 },
    sinkTile: { x: 31, y: 18 },
    sinkStand: { x: 31, y: 19 },
    maxCups: 4,
  },
  anchors: {
    calendar: { x: 4, y: 1 },   // briefing-room top wall → TRIGGERS
    boards: { x: 14, y: 1 },    // over the bullpen → TASKS
    clock: { x: 1, y: 1 },      // top-left corner → CLOSING TIME
  },
  // Placeholder errand anchors authored to brooklyn99.tmj's open floor (verified
  // walkable against the map's collision layer + desk stamps). The godOnly spots
  // sit inside Holt's glass office.
  errandSpots: [
    // public plants around the bullpen
    { kind: 'water', stand: { x: 2, y: 13 }, facing: 'left', fx: { x: 1, y: 13 }, duration: 4.5 },
    { kind: 'water', stand: { x: 24, y: 15 }, facing: 'right', fx: { x: 25, y: 15 }, duration: 4.5 },
    { kind: 'water', stand: { x: 13, y: 15 }, facing: 'down', fx: { x: 13, y: 16 }, duration: 4.5 },
    // Captain Holt's glass office — god's domain (plant + cigar at the window)
    { kind: 'water', stand: { x: 28, y: 6 }, facing: 'up', fx: { x: 28, y: 5 }, duration: 4.5, godOnly: true },
    { kind: 'smoke', stand: { x: 34, y: 2 }, facing: 'up', fx: { x: 34, y: 0 }, duration: 18, godOnly: true },
    // public windows on the north wall — wind streaks drift in
    { kind: 'window', stand: { x: 14, y: 1 }, facing: 'up', fx: { x: 14, y: 0 }, duration: 5 },
    { kind: 'window', stand: { x: 22, y: 1 }, facing: 'up', fx: { x: 22, y: 0 }, duration: 5 },
    // water dispensers (bullpen + entrance corridor)
    { kind: 'dispenser', stand: { x: 8, y: 15 }, facing: 'down', fx: { x: 8, y: 16 }, duration: 3.5 },
    { kind: 'dispenser', stand: { x: 17, y: 20 }, facing: 'down', fx: { x: 17, y: 21 }, duration: 3.5 },
    // break-room fridge + shelf (by the coffee economy)
    { kind: 'fridge', stand: { x: 29, y: 21 }, facing: 'up', fx: { x: 29, y: 20 }, duration: 3.2 },
    { kind: 'shelf', stand: { x: 34, y: 18 }, facing: 'up', fx: { x: 34, y: 17 }, duration: 4 },
    // garbage bins (entrance + break room)
    { kind: 'bin', stand: { x: 19, y: 20 }, facing: 'left', fx: { x: 18, y: 20 }, duration: 2.6 },
    { kind: 'bin', stand: { x: 34, y: 15 }, facing: 'up', fx: { x: 34, y: 14 }, duration: 2.6 },
  ],
  // PLACEHOLDER: brooklyn99.tmj paints the office desk stamp (monitor gid 365).
  monitor: OFFICE_THEME.monitor,
  // PLACEHOLDER: office palette + cast until Pam's B99 art (§C/§D) lands.
  palette: OFFICE_THEME.palette,
  cast: OFFICE_THEME.cast,
};

/** 칼테라 오피스 — this fork's own office (「칼테라 오피스 PRD」 4·5·7장). The
 *  floor is drawn from office_bg.png (one hand-drawn 480×320 picture, laid
 *  down at 2× = 960×640) rather than a tileset, so `tilesets` is empty and the
 *  real art comes from `backgroundImage` (rendered by OfficeFloor beneath the
 *  tile/character layers). kaltela.tmj supplies only what the engine still
 *  needs from a .tmj: a collision grid + the 6 named desk seats. No café/coffee
 *  economy, no idle errands — PRD doesn't call for them, and office_bg.png's
 *  plants/window/whiteboard are already static set dressing, not interactive
 *  props. Desk nameplates, the progress checklist, the follower-count monitor
 *  and the weekly board (PRD 4-1's "앱이 글씨를 그리는 자리") are NOT drawn yet —
 *  that's 「8. 개발 순서」 step 6, not this step. */
export const KALTELA_THEME: ThemeConfig = {
  id: 'kaltela',
  mapRaw: kaltelaMapRaw,
  tilesets: [],
  backgroundImage: { url: kaltelaBgUrl, width: 960, height: 640 },
  // Seat 0 = desk-ceo (편집장, replaces Michael/god — see PRD 7장). pc-1..pc-5
  // are fixed per role via seatForCharacter below — build_kaltela_map.cjs's
  // own spawn-point coordinates (÷2 back to 1x) match PRD 4-1's per-role desk
  // coordinates exactly (pc-1=54,171=리서처, pc-2=143,171=스토리 작가,
  // pc-3=314,171=성과 분석가, pc-4=400,171=영업사원, pc-5=54,253=연출 담당), and each
  // desk's nameplate (「8. 개발 순서」 6번) is drawn at that same fixed position —
  // so the character sitting there must match, not just claim whatever seat is
  // free next (that used to cause a hired-later employee to sit under another
  // role's nameplate).
  primarySeatNames: ['desk-ceo', 'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5'],
  seatForCharacter: {
    researcher: 'pc-1',
    writer: 'pc-2',
    analyst: 'pc-3',
    sales: 'pc-4',
    director: 'pc-5'
  },
  cafeSeatNames: [],
  cafeStands: [],
  // No coffee economy in this office. maxCups: 0 means the tray's cup-drawing
  // loop (`i < cleanCups`) never runs, so these placeholder (0,0) tiles are
  // never actually rendered — any coordinate here would do.
  coffee: {
    trayTile: { x: 0, y: 0 },
    trayStand: { x: 0, y: 0 },
    machineStand: { x: 0, y: 0 },
    sinkTile: { x: 0, y: 0 },
    sinkStand: { x: 0, y: 0 },
    maxCups: 0
  },
  // Calendar/boards/clock are small code-drawn icons (OfficeFloor.tsx), not
  // part of office_bg.png — parked in the blank strip left of the editor's
  // office frame, below the "칼테라 오피스" sign, so they don't sit on top of
  // any hand-painted desk or the PRD's own information panels.
  anchors: {
    // calendar/clock/askBoard are small, similarly-sized icon props — kept in
    // one horizontal row (same y, 4-tile/32px x-steps) instead of stacked, so
    // they read as one icon strip under the title card. `boards` is a much
    // bigger ensemble (82px, two cork boards + an archive table) that actually
    // renders at x:55–119 (BOARD_CENTER_PAD's own +15, not this +8/+13 icon
    // convention) — y:18 put its two cork frames directly under the icon row
    // (calendar's x:48–64 and askBoard's x:96–126 both land inside that
    // range), so icons and boards visibly overlapped. y:21 drops the boards'
    // top ~13px below the icon row's bottom edge instead.
    calendar: { x: 5, y: 15 },
    clock: { x: 9, y: 15 },
    askBoard: { x: 12, y: 15 },
    boards: { x: 5, y: 21 }
  },
  // Anchored to the 4 plant pots and the window actually drawn in
  // office_bg.png (measured by scanning the art for the pot/window pixel
  // clusters, then converting 1x art-pixel coords → 2x map-tile coords via
  // /4, since this map's tile = 8px over the 2x background). The two desk-top
  // pots (flower, sprout) flank the "대표 모니터" display desk, not an agent's
  // own seat, so they're approached from the north (open floor between the
  // pc-3/pc-4 desk row and the monitor desk) rather than from the south,
  // which is the decorative 대표(칼테라) sprite's side.
  errandSpots: [
    // 잎 화분 — floor-level pot left of the 편집장실 frame.
    { kind: 'water', stand: { x: 30, y: 30 }, facing: 'up', fx: { x: 30, y: 22 }, duration: 4.5 },
    // 선인장 — floor-level pot right of the 편집장실 frame, below the window.
    { kind: 'water', stand: { x: 95, y: 30 }, facing: 'up', fx: { x: 95, y: 22 }, duration: 4.5 },
    // 꽃 화분 — sits on the 대표 모니터 desk, left of the monitor.
    { kind: 'water', stand: { x: 44, y: 55 }, facing: 'down', fx: { x: 44, y: 64 }, duration: 4.5 },
    // 새싹 화분 — sits on the 대표 모니터 desk, right of the monitor.
    { kind: 'water', stand: { x: 82, y: 55 }, facing: 'down', fx: { x: 82, y: 63 }, duration: 4.5 },
    // 창문 — the city-view window, top-right.
    { kind: 'window', stand: { x: 104, y: 18 }, facing: 'up', fx: { x: 104, y: 16 }, duration: 5 },
    // 빗자루질 — no swept-mess art on the floor, so this is just an open patch
    // of walkable floor (clear of every desk/seat/south-of-seat block) between
    // the two middle desk rows.
    { kind: 'sweep', stand: { x: 60, y: 35 }, facing: 'down', fx: { x: 60, y: 35 }, duration: 5 },
  ],
  // No tileset ⇒ no monitor gids to overlay. DeskScreen's gid lookup just
  // no-ops when nothing resolves (see its own comment), so desks render with
  // no screen-glow animation — acceptable; office_bg.png already paints a
  // static monitor icon at each desk.
  monitor: { offTopLeftGid: 0, onGids: [] },
  palette: OFFICE_THEME.palette,
  cast: {
    byName: KALTELA_CAST_BY_NAME,
    getFrames: getKaltelaCastFrames,
    defaultCharacter: KALTELA_DEFAULT_CHARACTER
  },
  // 2025-10 재교체 스프라이트(kaltela_sprites, 32×48 프레임)는 정수배 1배/2배만
  // 쓰라는 요청이 있어 전부 2배로 통일했다(이전 3배/4배 비율 구분은 더 이상
  // 적용되지 않음). 대표(칼테라)는 hive 에이전트/자리가 아니라 OfficeFloor가
  // 따로 그리는 장식 캐릭터라 여기엔 없다 — founderScale 참고.
  seatScale: {
    'desk-ceo': 2,
    'pc-1': 2,
    'pc-2': 2,
    'pc-3': 2,
    'pc-4': 2,
    'pc-5': 2
  },
  castWalkFps: 6,
  // office's SEAT_LEG_CROP/SEAT_BACK_CROP (8/2) are tuned for its 32px-tall
  // native frame; kaltela_sprites' frame is 48px tall (32×48), so the same
  // crop fraction scales to 12/3 (8×48/32, 2×48/32) — otherwise the new,
  // fuller-bodied art's legs would poke out below the desk.
  castSeatLegCrop: 12,
  castSeatBackCrop: 3,
  // ThoughtBubble's own OFFSET_Y(-38) clears office's ~32px×1.08 native frame;
  // kaltela's is 48px×2x (96px tall), so the bubble needs roughly 96-35≈61
  // more px of lift to clear the head instead of covering the face.
  castBubbleHeadroom: 62
};

/** All registered themes. Phase 0 ships only the office; show themes register
 *  here as their content lands (Phase 2). 'kaltela' is this fork's own office,
 *  outside that phased rollout. */
export const THEMES: Partial<Record<ThemeId, ThemeConfig>> = {
  office: OFFICE_THEME,
  brooklyn99: BROOKLYN99_THEME,
  kaltela: KALTELA_THEME,
};

/** Look up a theme by id, falling back to the office theme if unknown/missing
 *  (a bad/absent show bundle must never break the floor — see report §E). */
export function getTheme(id: ThemeId): ThemeConfig {
  return THEMES[id] ?? OFFICE_THEME;
}
