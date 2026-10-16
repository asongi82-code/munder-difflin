// 칼테라 오피스 cast — loads the hand-drawn walk-sheet PNGs directly (unlike
// cast.ts's office roster, which paints every frame procedurally).
//
// 2025-10 재교체: kaltela_sprites 팩(32×48 프레임, sheet_layout.json 기준
// 가로 4칸×세로 8줄 — 0 front / 1 back / 2 side_right / 3 side_left / 4
// front_walk / 5 back_walk / 6 side_walk_right / 7 side_walk_left, 각 walk
// 줄 4프레임, walk_fps 6). 이전 72×104(3열×24px, 4행×26px) 포맷을 완전히
// 대체한다 — 이번 팩은 front/back/side가 전부 실제로 다른 그림이라, 기존
// CharacterSprite 엔진의 "down/up/right만 쓰고 left는 right를 좌우반전"
// 가정을 깨고 side_left 전용 그림을 그대로 쓴다 (CharacterSprite.ts의
// `frames.length > 3` 분기 참고).

import { Texture, Rectangle } from 'pixi.js';
import { loadTexture } from './loadTexture';
import type { CastMember } from './cast';

import kaltelaUrl from '@/assets/sprites/kaltela_walk_sheet.png?url';
import editorUrl from '@/assets/sprites/editor_walk_sheet.png?url';
import researcherUrl from '@/assets/sprites/researcher_walk_sheet.png?url';
import writerUrl from '@/assets/sprites/writer_walk_sheet.png?url';
import directorUrl from '@/assets/sprites/director_walk_sheet.png?url';
import analystUrl from '@/assets/sprites/analyst_walk_sheet.png?url';
import salesUrl from '@/assets/sprites/sales_walk_sheet.png?url';

export type KaltelaCharacterName =
  | 'kaltela' | 'editor' | 'researcher' | 'writer' | 'director' | 'analyst' | 'sales';

/** Exported so the Add/Edit Agent character picker (KaltelaSpritePortrait) can
 *  crop a static preview frame straight off the sheet without going through
 *  the Pixi Texture/loadSheet cache below. */
export const KALTELA_SHEET_URL: Record<KaltelaCharacterName, string> = {
  kaltela: kaltelaUrl,
  editor: editorUrl,
  researcher: researcherUrl,
  writer: writerUrl,
  director: directorUrl,
  analyst: analystUrl,
  sales: salesUrl
};

/** Roster metadata — PRD 5장 「캐릭터」 색상표. `shirt` drives the in-scene
 *  selection glow (reused from cast.ts's convention), not an actual recolor:
 *  the PNGs are already colored per character. */
export const KALTELA_CAST: CastMember[] = [
  { name: 'kaltela', displayName: '칼테라', shirt: '#F7B6D2', blurb: '대표 — @kaltela_toon' },
  { name: 'editor', displayName: '편집장', shirt: '#5B6EAE', blurb: '아침 보고 · 일정 관리' },
  { name: 'researcher', displayName: '리서처', shirt: '#8FD9C4', blurb: '다음 화 추천' },
  { name: 'writer', displayName: '스토리 작가', shirt: '#C7A8F0', blurb: '대본 프롬프트 준비 · 정리' },
  { name: 'director', displayName: '연출 담당', shirt: '#F6A85C', blurb: '화면·연출 채우기' },
  { name: 'analyst', displayName: '성과 분석가', shirt: '#A97C50', blurb: '성과·댓글 정리' },
  { name: 'sales', displayName: '영업사원', shirt: '#E86A6A', blurb: '광고 문의 관리' }
];

export const KALTELA_CAST_BY_NAME: Record<string, CastMember> =
  Object.fromEntries(KALTELA_CAST.map((c) => [c.name, c]));

export const KALTELA_DEFAULT_CHARACTER: KaltelaCharacterName = 'editor';

const FRAME_W = 32;
const FRAME_H = 48;

// sheet_layout.json row indices (source sheet, 4 cols × 8 rows).
const SRC_ROW_FRONT = 0;
const SRC_ROW_BACK = 1;
const SRC_ROW_SIDE_RIGHT = 2;
const SRC_ROW_SIDE_LEFT = 3;
const SRC_ROW_FRONT_WALK = 4;
const SRC_ROW_BACK_WALK = 5;
const SRC_ROW_SIDE_WALK_RIGHT = 6;
const SRC_ROW_SIDE_WALK_LEFT = 7;

const sheetCache = new Map<KaltelaCharacterName, Promise<Texture>>();
const frameCache = new Map<KaltelaCharacterName, Texture[][]>();

function loadSheet(name: KaltelaCharacterName): Promise<Texture> {
  let p = sheetCache.get(name);
  if (!p) {
    p = loadTexture(KALTELA_SHEET_URL[name]);
    sheetCache.set(name, p);
  }
  return p;
}

function frameAt(base: Texture, row: number, col: number): Texture {
  return new Texture({
    source: base.source,
    frame: new Rectangle(col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H)
  });
}

/** Build one CharacterSprite row: [stand, walk-pose-A, walk-pose-B, stand,
 *  stand, stand, stand] — CharacterSprite's ANIM_FRAMES only ever indexes
 *  cols 0–2 (idle=[0], walk/type/read=[0,1,2,1]), so this samples the idle
 *  row's single pose for col 0 and the matching *_walk row's 1st/3rd of its
 *  4 real frames for cols 1–2 (a representative bounce, not all 4 frames —
 *  CharacterSprite has no 4-frame walk cycle to play them against). The
 *  trailing 4 cols are never read; CharacterSprite only reuses cols 0–2. */
function buildRow(base: Texture, idleRow: number, walkRow: number): Texture[] {
  const stand = frameAt(base, idleRow, 0);
  const walkA = frameAt(base, walkRow, 0);
  const walkB = frameAt(base, walkRow, 2);
  return [stand, walkA, walkB, stand, stand, stand, stand];
}

/** Frame grid CharacterSprite expects: 4 rows (down, up, right, left) × 7
 *  cols. The 4th row is new — CharacterSprite only mirrors `right` into
 *  `left` when `frames.length <= 3`; kaltela's pack has real side_left art,
 *  so it supplies its own row instead (see CharacterSprite.hasDedicatedLeft). */
export async function getKaltelaCastFrames(name: string): Promise<Texture[][]> {
  const key = name as KaltelaCharacterName;
  const cached = frameCache.get(key);
  if (cached) return cached;
  const base = await loadSheet(key);
  const frames: Texture[][] = [
    buildRow(base, SRC_ROW_FRONT, SRC_ROW_FRONT_WALK),
    buildRow(base, SRC_ROW_BACK, SRC_ROW_BACK_WALK),
    buildRow(base, SRC_ROW_SIDE_RIGHT, SRC_ROW_SIDE_WALK_RIGHT),
    buildRow(base, SRC_ROW_SIDE_LEFT, SRC_ROW_SIDE_WALK_LEFT)
  ];
  frameCache.set(key, frames);
  return frames;
}
