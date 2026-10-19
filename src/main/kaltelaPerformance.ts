/**
 * PRD.md 「8. 개발 순서」 9번 — 성과 분석가 (P0-3), 7일 체크 입력 화면(4-6) 쪽.
 *
 * 이 모듈이 기계적으로 안전하게 할 수 있는 부분만 맡는다:
 *   - 오늘 7일 체크 대상(발행완료 + 7일 체크일 ≤ 오늘 + 비팔로워 비율/프로필
 *     방문 중 하나라도 비어 있음) 카드 목록을 읽는다.
 *   - 대표가 입력한 비팔로워 비율 / 프로필 방문 / (릴스일 때만) 팔로우 수를
 *     단순 number 속성에 쓴다 — **이미 값이 있는 칸은 건너뛴다**(PRD 예외 처리
 *     "이미 값이 있는 칸은 덮어쓰지 않는다").
 *
 * 이 모듈이 하지 않는 일 (판단이 필요하거나 아직 연결되지 않아 지어낼 수 없음):
 *   - Metricool 자동 숫자(조회수·도달·좋아요·댓글·저장·공유·팔로우·릴스 지표)
 *     — 검증된 Metricool MCP 서버가 아직 없다(`employees/analyst/CLAUDE.md`
 *     참고, `// TODO-verify`).
 *   - "댓글 원문"은 DB 속성이 아니라 카드 본문 "성과·댓글 요약" 소제목 아래
 *     텍스트 블록이다(PRD 6-0). 그 블록 구조를 이 코드가 모르는 채로 썼다가
 *     카드를 깨뜨릴 위험이 있어 — 「8. 개발 순서」 8번의 "최종 대본 정리"와
 *     같은 이유로 — 쓰지 않는다. 댓글 분류·정리·요약 교체도 글 내용을 이해해야
 *     하는 판단이다.
 * 두 가지 모두 renderer가 (저장 성공 후) 실제 성과 분석가 하이브 에이전트에게
 * 하이브 메시지로 넘긴다 — MorningReportPanel의 "리서처에게 추천 요청",
 * NextEpisodePanel의 "저장하고 대본확정"과 같은 패턴.
 */
import { readConfig } from './config';
import {
  notionIntegrationReady,
  notionQueryDatabase,
  notionRetrievePage,
  notionUpdatePage,
  titleOf,
  selectOf,
  dateOf,
  numberOf
} from './notion';

const CHECKS_CACHE_TTL_MS = 60_000;

export interface KaltelaCheckItem {
  id: string;
  title: string;
  url: string;
  /** "게시물" | "릴스" | null — 릴스일 때만 "팔로우" 입력칸(릴스 팔로우)을 보여준다. */
  format: string | null;
  d7CheckDate: string | null;
  needsNonFollowerRatio: boolean;
  needsProfileVisits: boolean;
  needsReelsFollow: boolean;
}

export interface KaltelaChecksResult {
  /** false ⇒ "노션 연결 확인 필요"만 보여주고 나머지는 비워 둔다. */
  connected: boolean;
  reason?: string;
  items: KaltelaCheckItem[];
}

function emptyChecks(connected: boolean, reason?: string): KaltelaChecksResult {
  return { connected, reason, items: [] };
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let checksCache: { at: number; result: KaltelaChecksResult } | null = null;

/** 발행완료 + 7일 체크일이 오늘이거나 지났는데 비팔로워 비율/프로필 방문 중
 *  하나라도 아직 비어 있는 카드. 둘 다 채워지면 자연스럽게 목록에서 빠진다 —
 *  별도의 "처리됨" 플래그를 새로 만들지 않는다. */
export async function getKaltela7DayChecks(opts: { force?: boolean } = {}): Promise<KaltelaChecksResult> {
  if (!opts.force && checksCache && Date.now() - checksCache.at < CHECKS_CACHE_TTL_MS) return checksCache.result;

  const cfg = readConfig();
  const episodeDbId = cfg.kaltelaNotionEpisodeBoardId?.trim();
  const ready = notionIntegrationReady();
  if (!ready.ready) return cacheAndReturn(emptyChecks(false, ready.reason));
  if (!episodeDbId) {
    return cacheAndReturn(emptyChecks(false, '칼테라 에피소드 보드 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요'));
  }

  const pages = await notionQueryDatabase(episodeDbId, { page_size: 100 });
  if (!pages) {
    return cacheAndReturn(emptyChecks(false, '노션 쿼리 실패 — 에피소드 보드 DB id가 맞는지, 그 DB가 이 연동에 공유돼 있는지 확인해 주세요'));
  }

  const todayIso = isoDate(new Date());
  const items: KaltelaCheckItem[] = [];
  for (const page of pages) {
    if (selectOf(page, '상태') !== '발행완료') continue;
    const d7 = dateOf(page, '7일 체크일');
    if (!d7 || d7 > todayIso) continue;
    const needsNonFollowerRatio = numberOf(page, '비팔로워 비율') == null;
    const needsProfileVisits = numberOf(page, '프로필 방문') == null;
    const format = selectOf(page, '형식');
    const needsReelsFollow = format === '릴스' && numberOf(page, '팔로우') == null;
    if (!needsNonFollowerRatio && !needsProfileVisits && !needsReelsFollow) continue;

    items.push({
      id: page.id,
      title: titleOf(page, '제목') ?? '(제목 없음)',
      url: page.url ?? '',
      format,
      d7CheckDate: d7,
      needsNonFollowerRatio,
      needsProfileVisits,
      needsReelsFollow
    });
  }
  items.sort((a, b) => (a.d7CheckDate ?? '').localeCompare(b.d7CheckDate ?? ''));

  return cacheAndReturn({ connected: true, items });
}

function cacheAndReturn(result: KaltelaChecksResult): KaltelaChecksResult {
  checksCache = { at: Date.now(), result };
  return result;
}

export interface KaltelaCheckSubmitInput {
  nonFollowerRatio?: number;
  profileVisits?: number;
  reelsFollows?: number;
}

export interface KaltelaCheckSubmitResult {
  ok: boolean;
  error?: string;
  cardTitle?: string;
  /** 실제로 저장한 속성 이름들. */
  savedFields: string[];
  /** 값을 보냈지만 기존 값이 이미 있어 건너뛴 속성 이름들(덮어쓰지 않음). */
  skippedFields: string[];
}

/** 비팔로워 비율 / 프로필 방문 / (릴스일 때만) 팔로우를 쓴다. 각 칸은 현재
 *  값이 비어 있을 때만 쓰고, 이미 값이 있으면 건너뛴다(PRD 예외 처리). 댓글
 *  원문 저장·정리와 Metricool 자동 숫자는 여기서 하지 않는다 — 호출자(렌더러)
 *  가 이 결과를 보고 성과 분석가 하이브 에이전트에게 하이브 메시지로 넘긴다. */
export async function submitKaltela7DayCheck(cardId: string, input: KaltelaCheckSubmitInput): Promise<KaltelaCheckSubmitResult> {
  const ready = notionIntegrationReady();
  if (!ready.ready) return { ok: false, error: ready.reason, savedFields: [], skippedFields: [] };

  const page = await notionRetrievePage(cardId);
  if (!page) return { ok: false, error: '노션에서 카드를 불러오지 못했습니다', savedFields: [], skippedFields: [] };

  const title = titleOf(page, '제목') ?? '(제목 없음)';
  const format = selectOf(page, '형식');
  const properties: Record<string, unknown> = {};
  const savedFields: string[] = [];
  const skippedFields: string[] = [];

  const trySet = (propName: string, value: number | undefined) => {
    if (value == null || Number.isNaN(value)) return;
    if (numberOf(page, propName) != null) { skippedFields.push(propName); return; }
    properties[propName] = { number: value };
    savedFields.push(propName);
  };

  trySet('비팔로워 비율', input.nonFollowerRatio);
  trySet('프로필 방문', input.profileVisits);
  if (format === '릴스') trySet('팔로우', input.reelsFollows);

  if (savedFields.length > 0) {
    const ok = await notionUpdatePage(cardId, properties);
    if (!ok) return { ok: false, error: '노션 저장 실패', cardTitle: title, savedFields: [], skippedFields };
  }

  checksCache = null; // the card may now have dropped off the "needs input" list
  return { ok: true, cardTitle: title, savedFields, skippedFields };
}
