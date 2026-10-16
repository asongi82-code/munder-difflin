/**
 * PRD.md 「8. 개발 순서」 8번 — 리서처 → 스토리 작가 (P0-2).
 *
 * 이 모듈이 실제로 하는 일은 노션 읽기/쓰기와 프롬프트 조립뿐이다. 리서처의
 * 진짜 판단(사연 뼈대, 성과 해석, 추천 이유)은 실제 리서처 하이브 에이전트
 * (employees/researcher/CLAUDE.md)가 자기 Claude 세션으로 수행해 카드의
 * "리서처 메모" 속성에 이미 적어 둔 것을 읽기만 한다 — 이 코드가 점수를
 * 매기거나 사연을 지어내지 않는다.
 *
 * 같은 이유로, 최종 대본에서 연속성 메모를 뽑고 태그를 다는 일
 * (PRD 2장 「스토리 작가 ② 최종 대본 정리」 2~6단계)은 글의 내용을 이해해야
 * 하는 판단이라 이 모듈이 아니라 실제 스토리 작가 하이브 에이전트에게 넘긴다
 * (renderer가 하이브 메시지로 전달 — NextEpisodePanel.tsx 참고). 이 모듈은
 * "이걸로 하기"(상태 → 대본작성, 안전하게 기계적으로 할 수 있는 전환)까지만
 * 책임진다.
 */
import { readConfig } from './config';
import {
  notionIntegrationReady,
  notionQueryDatabase,
  notionRetrievePage,
  notionUpdatePage,
  notionPageSectionText,
  titleOf,
  textOf,
  selectOf,
  dateOf,
  numberOf,
  checkboxOf,
  type NotionPage
} from './notion';

const PICKS_CACHE_TTL_MS = 60_000;
/** PRD 2장 P0-2: "아이디어 카드가 2개 미만이면 TOP1만, 0개면 추천하지 않는다." */
const MAX_PICKS = 2;

export interface KaltelaNextPick {
  id: string;
  title: string;
  url: string;
  seriesName: string | null;
  seriesIndex: number | null;
  kind: string | null;
  /** "초안 있음" 체크 — "빨리 갈 수 있음" 표시용. */
  draftReady: boolean;
  /** 리서처가 적어 둔 사연 뼈대·성과 참고점·추천 이유 — 그대로 보여준다. */
  researcherMemo: string;
}

export interface KaltelaNextPicksResult {
  /** false ⇒ "노션 연결 확인 필요"만 보여주고 나머지는 비워 둔다. */
  connected: boolean;
  reason?: string;
  picks: KaltelaNextPick[];
}

function emptyPicks(connected: boolean, reason?: string): KaltelaNextPicksResult {
  return { connected, reason, picks: [] };
}

let picksCache: { at: number; result: KaltelaNextPicksResult } | null = null;

/** 리서처가 "아이디어" 카드에 메모를 남긴 것 중 가장 최근에 손댄 2장(=최근 검토
 *  순)을 TOP2로 보여준다. 점수를 새로 매기지 않는다 — 어떤 둘을 고를지는
 *  리서처 자신의 판단이고, 이 코드가 할 수 있는 건 "리서처가 가장 최근에 메모
 *  를 채운 카드가 가장 최신 추천"이라는 정직한 대리 지표뿐이다. */
export async function getKaltelaNextPicks(opts: { force?: boolean } = {}): Promise<KaltelaNextPicksResult> {
  if (!opts.force && picksCache && Date.now() - picksCache.at < PICKS_CACHE_TTL_MS) return picksCache.result;

  const cfg = readConfig();
  const episodeDbId = cfg.kaltelaNotionEpisodeBoardId?.trim();
  const ready = notionIntegrationReady();
  if (!ready.ready) return cacheAndReturn(emptyPicks(false, ready.reason));
  if (!episodeDbId) {
    return cacheAndReturn(emptyPicks(false, '칼테라 에피소드 보드 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요'));
  }

  const pages = await notionQueryDatabase(episodeDbId, { page_size: 100 });
  if (!pages) {
    return cacheAndReturn(emptyPicks(false, '노션 쿼리 실패 — 에피소드 보드 DB id가 맞는지, 그 DB가 이 연동에 공유돼 있는지 확인해 주세요'));
  }

  const candidates = pages
    .filter((p) => selectOf(p, '상태') === '아이디어' && !!textOf(p, '리서처 메모')?.trim())
    .sort((a, b) => (dateOf(b, '최근갱신일') ?? '').localeCompare(dateOf(a, '최근갱신일') ?? ''))
    .slice(0, MAX_PICKS);

  const picks: KaltelaNextPick[] = candidates.map((p) => ({
    id: p.id,
    title: titleOf(p, '제목') ?? '(제목 없음)',
    url: p.url ?? '',
    seriesName: selectOf(p, '시리즈 이름'),
    seriesIndex: numberOf(p, '시리즈 회차'),
    kind: selectOf(p, '화 유형'),
    draftReady: checkboxOf(p, '초안 있음'),
    researcherMemo: textOf(p, '리서처 메모') ?? ''
  }));

  return cacheAndReturn({ connected: true, picks });
}

function cacheAndReturn(result: KaltelaNextPicksResult): KaltelaNextPicksResult {
  picksCache = { at: Date.now(), result };
  return result;
}

export interface KaltelaSelectResult {
  ok: boolean;
  error?: string;
  cardId?: string;
  cardTitle?: string;
  seriesName?: string | null;
  seriesIndex?: number | null;
  isAd?: boolean;
  /** 클로드 채팅에 그대로 붙여넣을 프롬프트 한 덩어리. */
  prompt?: string;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** PRD 2장 P0-2 「스토리 작가 ① 프롬프트 준비」. 선택된 카드 + 리서처 메모 +
 *  같은 시리즈 이전 화들의 "연속성 메모" 섹션을 그대로 모아 프롬프트 한
 *  덩어리로 조립하고, 상태를 대본작성으로 옮긴다("대본작성 시작일" = 오늘).
 *  이 두 속성은 평범한 select/date 칸이라 안전하게 기계적으로 쓸 수 있다 —
 *  카드 본문(연속성 메모 등)은 여기서 쓰지 않는다. */
export async function selectKaltelaEpisode(cardId: string): Promise<KaltelaSelectResult> {
  const cfg = readConfig();
  const episodeDbId = cfg.kaltelaNotionEpisodeBoardId?.trim();
  const ready = notionIntegrationReady();
  if (!ready.ready) return { ok: false, error: ready.reason };
  if (!episodeDbId) return { ok: false, error: '칼테라 에피소드 보드 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요' };

  const page = await notionRetrievePage(cardId);
  if (!page) return { ok: false, error: '노션에서 카드를 불러오지 못했습니다' };

  const title = titleOf(page, '제목') ?? '(제목 없음)';
  const kind = selectOf(page, '화 유형');
  const seriesName = selectOf(page, '시리즈 이름');
  const seriesIndex = numberOf(page, '시리즈 회차');
  const researcherMemo = textOf(page, '리서처 메모') ?? '';
  const isAd = (kind ?? '').includes('광고');

  const continuity = seriesName
    ? await gatherContinuityNotes(episodeDbId, seriesName, seriesIndex, cardId)
    : null;

  const sections: string[] = [`# ${title}`];
  if (kind) sections.push(`화 유형: ${kind}`);
  if (seriesName) sections.push(`시리즈: ${seriesName}${seriesIndex != null ? ` ${seriesIndex}화` : ''}`);
  sections.push('## 리서처 메모 (사연 뼈대 · 성과 참고점 · 추천 이유)');
  sections.push(researcherMemo || '(메모 없음)');
  if (seriesName) {
    sections.push('## 이전 화 연속성 메모');
    sections.push(continuity && continuity.trim() ? continuity : '시리즈 1화 — 이전 화 연속성 메모 없음');
  }
  if (isAd) {
    sections.push('## 광고 화 안내');
    sections.push('광고주 요구사항은 영업사원 연동(「8. 개발 순서」 11번) 전까지 여기에 자동으로 붙지 않습니다 — 영업사원이 카드에 남긴 요구사항을 직접 확인해 주세요.');
  }

  const updated = await notionUpdatePage(cardId, {
    '상태': { select: { name: '대본작성' } },
    '대본작성 시작일': { date: { start: isoDate(new Date()) } }
  });
  if (!updated) return { ok: false, error: '노션 저장 실패 — 상태를 대본작성으로 바꾸지 못했습니다' };

  picksCache = null; // the picked card no longer qualifies ("상태" changed) — next list load should drop it

  return {
    ok: true,
    cardId,
    cardTitle: title,
    seriesName,
    seriesIndex,
    isAd,
    prompt: sections.join('\n\n')
  };
}

/** 같은 시리즈에서 이 회차보다 앞선 화들을 회차순으로 모아, 각 화 본문의
 *  "연속성 메모" 섹션 텍스트를 이어붙인다. 시리즈 이름만 있고 회차 번호가
 *  없는 카드는 전체 시리즈 카드를 다 끌어오되 자기 자신은 제외한다. */
async function gatherContinuityNotes(
  episodeDbId: string,
  seriesName: string,
  beforeIndex: number | null,
  selfId: string
): Promise<string | null> {
  const seriesPages = await notionQueryDatabase(episodeDbId, {
    filter: { property: '시리즈 이름', select: { equals: seriesName } },
    sorts: [{ property: '시리즈 회차', direction: 'ascending' }],
    page_size: 50
  });
  if (!seriesPages) return null;

  const prior = seriesPages.filter((p: NotionPage) => {
    if (p.id === selfId) return false;
    if (beforeIndex == null) return true;
    const idx = numberOf(p, '시리즈 회차');
    return idx == null || idx < beforeIndex;
  });
  if (prior.length === 0) return null;

  const notes: string[] = [];
  for (const p of prior) {
    const idx = numberOf(p, '시리즈 회차');
    const section = await notionPageSectionText(p.id, '연속성 메모');
    if (section && section.trim()) {
      notes.push(`[${seriesName} ${idx ?? '?'}화]\n${section.trim()}`);
    }
  }
  return notes.join('\n\n');
}
