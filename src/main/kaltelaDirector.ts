/**
 * PRD.md 「8. 개발 순서」 10번 — 연출 담당 (P1-1), 4-5 「연출 표 화면」.
 *
 * 이 모듈이 기계적으로 안전하게 할 수 있는 일만 맡는다:
 *   - "연출 표" 섹션이 아직 비어 있는 대본확정 카드 목록을 읽는다.
 *   - 선택한 카드의 "최종 대본"/"연출 표" 본문 섹션을 그대로 읽어 보여준다
 *     (쓰지 않음).
 *   - "연출 표"가 비어 있지 않을 때만 — PRD 완료 기준(캔바에 그대로 붙여넣을
 *     표가 나와 있어야 함)을 지키려는 최소한의 존재 확인 — 상태를 작화로
 *     바꾼다.
 *
 * 이 모듈이 하지 않는 일: 화면·연출 칸을 실제로 채우는 것(앵글·화면 범위·
 * 동작·표정을 정하는 연출 판단)과, "연출 표" 섹션 본문을 쓰는 것, 그리고 PRD
 * 예외 처리("저장 전 원본 표와 비교해 화면·연출 외 칸이 바뀌었으면 저장하지
 * 않고 다시 작성한다")의 실제 비교 — 셋 다 카드 본문을 이해하고 수정해야 하는
 * 일이다. 특히 화면·연출 칸은 PRD 2장 형식상 한 칸 안에 여러 줄바꿈을 담으므로
 * (`① 인물 / ② 인물 / ③ 인물 / ▶캔바`를 줄로 나눔), 줄 단위로 표를 다시
 * 쪼개 "다른 칸이 바뀌었는지" 기계적으로 비교하면 같은 줄바꿈 때문에 행이
 * 어긋나 틀린 결론을 낼 위험이 크다 — 「8. 개발 순서」 8·9번이 피한 "글 내용을
 * 이해해야 하는 판단"과 같은 이유로, 이 비교도 실제 연출 담당 하이브 에이전트
 * (employees/director/CLAUDE.md, 이미 이 예외 처리를 적어 둠)가 자기 Claude
 * 세션 + 노션 MCP로 직접 한다. renderer가 하이브 메시지로 작업을 요청한다
 * (NextEpisodePanel의 "저장하고 대본확정"과 같은 패턴). 상태를 작화로 바꾸고
 * 편집장에게 알리는 것도 PRD상 같은 작업 흐름의 마지막 단계라 에이전트가 자기
 * 노션 MCP·하이브 메시지로 끝낸다 — 이 모듈의 `confirmKaltelaDirectorTable`은
 * 대표가 화면에서 결과를 직접 확인한 뒤 누르는 별도의 안전 확인 버튼이다.
 */
import { readConfig } from './config';
import {
  notionIntegrationReady,
  notionQueryDatabase,
  notionRetrievePage,
  notionUpdatePage,
  notionPageSectionText,
  titleOf,
  selectOf,
  numberOf
} from './notion';

const QUEUE_CACHE_TTL_MS = 60_000;

/** "연출 표" 섹션에 실제 표가 채워졌는지 판단한다. 단순히 "비어 있지 않음"으로
 *  보면 「에피소드 카드 양식」이 남겨 둔 안내 문구("(연출 담당이 화면·연출
 *  칸만 채운 표: …)")만 있고 아직 아무도 손대지 않은 카드까지 "완료"로 잘못
 *  읽는다 — 표라면 반드시 있어야 할 "|" 문자가 있는지로 가려낸다
 *  (NextEpisodePanel의 looksLikeScriptTable과 같은 원칙). */
function looksLikeFilledTable(text: string | null): boolean {
  if (!text) return false;
  const pipeCount = text.match(/\|/g)?.length ?? 0;
  return pipeCount >= 4;
}

export interface KaltelaDirectorCard {
  id: string;
  title: string;
  url: string;
  seriesName: string | null;
  seriesIndex: number | null;
}

export interface KaltelaDirectorQueueResult {
  /** false ⇒ "노션 연결 확인 필요"만 보여주고 나머지는 비워 둔다. */
  connected: boolean;
  reason?: string;
  items: KaltelaDirectorCard[];
}

function emptyQueue(connected: boolean, reason?: string): KaltelaDirectorQueueResult {
  return { connected, reason, items: [] };
}

let queueCache: { at: number; result: KaltelaDirectorQueueResult } | null = null;

/** 대본확정 카드 중 "연출 표" 섹션이 아직 비어 있는 카드. 성과 분석가(9번)의
 *  7일 체크 대상과 달리 DB 속성이 아니라 본문 섹션이라 카드마다 본문을 한 번
 *  더 읽어야 한다 — 대본확정 상태로 동시에 쌓이는 화 수가 적어(주 2화 일정)
 *  감당할 수 있는 범위로 본다. */
export async function getKaltelaDirectorQueue(opts: { force?: boolean } = {}): Promise<KaltelaDirectorQueueResult> {
  if (!opts.force && queueCache && Date.now() - queueCache.at < QUEUE_CACHE_TTL_MS) return queueCache.result;

  const cfg = readConfig();
  const episodeDbId = cfg.kaltelaNotionEpisodeBoardId?.trim();
  const ready = notionIntegrationReady();
  if (!ready.ready) return cacheAndReturn(emptyQueue(false, ready.reason));
  if (!episodeDbId) {
    return cacheAndReturn(emptyQueue(false, '칼테라 에피소드 보드 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요'));
  }

  const pages = await notionQueryDatabase(episodeDbId, { page_size: 100 });
  if (!pages) {
    return cacheAndReturn(emptyQueue(false, '노션 쿼리 실패 — 에피소드 보드 DB id가 맞는지, 그 DB가 이 연동에 공유돼 있는지 확인해 주세요'));
  }

  const confirmed = pages.filter((p) => selectOf(p, '상태') === '대본확정');
  const items: KaltelaDirectorCard[] = [];
  for (const p of confirmed) {
    const directionTable = await notionPageSectionText(p.id, '연출 표');
    if (looksLikeFilledTable(directionTable)) continue; // 이미 채워진 카드는 대기열에서 뺀다
    items.push({
      id: p.id,
      title: titleOf(p, '제목') ?? '(제목 없음)',
      url: p.url ?? '',
      seriesName: selectOf(p, '시리즈 이름'),
      seriesIndex: numberOf(p, '시리즈 회차')
    });
  }

  return cacheAndReturn({ connected: true, items });
}

function cacheAndReturn(result: KaltelaDirectorQueueResult): KaltelaDirectorQueueResult {
  queueCache = { at: Date.now(), result };
  return result;
}

export interface KaltelaDirectorDetail {
  ok: boolean;
  error?: string;
  cardTitle?: string;
  cardUrl?: string;
  /** 노션 "상태" 속성 현재 값. */
  status?: string | null;
  /** "최종 대본" 섹션 원문 (컷/화면·연출/나레이션/대사/효과음 표). 섹션이
   *  없으면 빈 문자열. */
  scriptTable?: string;
  /** "연출 표" 섹션 원문 — 연출 담당이 아직 채우지 않았으면 null. */
  directionTable?: string | null;
}

/** 카드 하나의 최종 대본/연출 표 본문을 그대로 읽어 온다(쓰지 않음). */
export async function getKaltelaDirectorCardDetail(cardId: string): Promise<KaltelaDirectorDetail> {
  const ready = notionIntegrationReady();
  if (!ready.ready) return { ok: false, error: ready.reason };

  const page = await notionRetrievePage(cardId);
  if (!page) return { ok: false, error: '노션에서 카드를 불러오지 못했습니다' };

  const title = titleOf(page, '제목') ?? '(제목 없음)';
  const scriptTable = (await notionPageSectionText(cardId, '최종 대본')) ?? '';
  const directionTableRaw = await notionPageSectionText(cardId, '연출 표');
  const directionTable = looksLikeFilledTable(directionTableRaw) ? directionTableRaw : null;

  return {
    ok: true,
    cardTitle: title,
    cardUrl: page.url ?? '',
    status: selectOf(page, '상태'),
    scriptTable,
    directionTable
  };
}

export interface KaltelaDirectorConfirmResult {
  ok: boolean;
  error?: string;
  cardTitle?: string;
}

/** "연출 표" 섹션이 채워진 뒤, 대표가 화면에서 직접 확인하고 누르는 마지막
 *  확인 버튼. 섹션이 비어 있으면(아직 연출 담당이 작업을 끝내지 않음) 저장하지
 *  않고 이유를 돌려준다 — 화면·연출 외 칸이 바뀌었는지까지의 판단은 이미
 *  연출 담당 에이전트의 몫(employees/director/CLAUDE.md 「예외 처리」)이라, 이
 *  함수는 "완전히 비어 있지는 않다"는 가장 바깥쪽 안전장치만 기계적으로
 *  확인한다. */
export async function confirmKaltelaDirectorTable(cardId: string): Promise<KaltelaDirectorConfirmResult> {
  const detail = await getKaltelaDirectorCardDetail(cardId);
  if (!detail.ok) return { ok: false, error: detail.error };
  if (!detail.directionTable) {
    return { ok: false, error: '아직 "연출 표" 섹션이 채워지지 않았습니다 — 연출 담당 작업이 끝난 뒤 다시 확인해 주세요', cardTitle: detail.cardTitle };
  }

  const updated = await notionUpdatePage(cardId, { '상태': { select: { name: '작화' } } });
  if (!updated) return { ok: false, error: '노션 저장 실패 — 상태를 작화로 바꾸지 못했습니다', cardTitle: detail.cardTitle };

  queueCache = null; // 작화로 바뀐 카드는 다음 목록 로드에서 자연히 빠진다
  return { ok: true, cardTitle: detail.cardTitle };
}
