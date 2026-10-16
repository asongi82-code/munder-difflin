/**
 * PRD.md 「8. 개발 순서」 7번 — 편집장 아침 보고 (P0-1).
 *
 * 「칼테라 에피소드 보드」 하나만 읽어서 결정론적으로 계산한다. P0-1에 적힌
 * 항목 중 이 보고가 채우지 못하는 두 가지는 아직 데이터가 존재하지 않아서다
 * (지어내지 않는다):
 *   - "영업사원이 올린 '확인 필요' 메일" — 영업사원(지메일 읽기, 「8. 개발
 *     순서」 11번)이 아직 없다.
 *   - "새 리서치/성과 결과에 따른 대본확정 화 재제안" — 리서처(8번)가 내는
 *     판단이라, 노션 값만으로는 지어낼 수 없다.
 * 두 항목은 해당 단계가 구현되면 이 모듈에 추가한다.
 *
 * 노션 연결(통합 레지스트리 'notion' + 토큰 + 에피소드 보드 DB id)이 없거나
 * 쿼리가 실패하면 `connected: false`만 돌려주고 나머지 칸은 전부 비워 둔다 —
 * 렌더러는 그 경우 "노션 연결 확인 필요"만 보여주고 보고를 지어내지 않는다.
 */
import { readConfig } from './config';
import { notionIntegrationReady, notionQueryDatabase, titleOf, selectOf, dateOf, type NotionPage } from './notion';

const CACHE_TTL_MS = 60_000;
/** "대본작성 시작일" 기준 이 일수를 넘으면 지연 카드로 올린다. */
const OVERDUE_WRITING_DAYS = 3;
/** 29일 체크 예정일이 이 일수 이내로 다가오면 "임박"으로 올린다 (27일째부터). */
const CHECK29_WARNING_DAYS = 2;

export interface KaltelaReportCard {
  id: string;
  title: string;
  /** Notion page URL — the panel opens this on click. Empty if the API didn't return one. */
  url: string;
  detail?: string;
}

export interface KaltelaMorningReport {
  /** false ⇒ render ONLY the "노션 연결 확인 필요" message; every other field is empty/default. */
  connected: boolean;
  /** Set only when connected is false — shown in the panel so the reason is
   *  visible without main-process terminal access (console.error there never
   *  reaches the renderer DevTools console). */
  reason?: string;
  todayLabel: string;
  generatedAt: string;
  /** Badge count for "대표 결정 필요" (4-2 상단). */
  decisionCount: number;
  /** "아이디어" 상태 카드가 하나도 없음 — "아이디어 카드가 없음, 메모 먼저 추가" 표시용. */
  noIdeaCards: boolean;
  /** 발행 전인 광고 화 — 광고 표시 확인을 상기시키는 경고 (보고 맨 위). */
  adDisclosureWarnings: KaltelaReportCard[];
  confirmedCards: KaltelaReportCard[];
  writingCards: KaltelaReportCard[];
  renderingCards: KaltelaReportCard[];
  /** 오늘이 24시간/7일/29일 체크일인 카드. detail에 어떤 체크인지 담는다. */
  checksToday: KaltelaReportCard[];
  /** 29일 체크가 2일 이내로 다가온 카드 ("29일 체크 임박"). */
  checksUpcoming29: KaltelaReportCard[];
  overdueWriting: KaltelaReportCard[];
  /** 작화 중 1편 + 대본확정 1편 이상 기준을 충족하는지. */
  scheduleOk: boolean;
  scheduleNote: string;
}

function emptyReport(connected: boolean, reason?: string): KaltelaMorningReport {
  const now = new Date();
  return {
    connected,
    reason,
    todayLabel: `${now.getMonth() + 1}.${now.getDate()} (${weekdayKo(now)})`,
    generatedAt: now.toISOString(),
    decisionCount: 0,
    noIdeaCards: false,
    adDisclosureWarnings: [],
    confirmedCards: [],
    writingCards: [],
    renderingCards: [],
    checksToday: [],
    checksUpcoming29: [],
    overdueWriting: [],
    scheduleOk: true,
    scheduleNote: ''
  };
}

function weekdayKo(d: Date): string {
  return ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Whole days from one yyyy-mm-dd date to another (positive if `to` is later). */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
function card(page: NotionPage, detail?: string): KaltelaReportCard {
  return { id: page.id, title: titleOf(page, '제목') ?? '(제목 없음)', url: page.url ?? '', detail };
}

let cache: { at: number; report: KaltelaMorningReport } | null = null;

export async function getKaltelaMorningReport(opts: { force?: boolean } = {}): Promise<KaltelaMorningReport> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.report;

  const cfg = readConfig();
  const episodeDbId = cfg.kaltelaNotionEpisodeBoardId?.trim();
  const ready = notionIntegrationReady();
  if (!ready.ready) {
    const report = emptyReport(false, ready.reason);
    cache = { at: Date.now(), report };
    return report;
  }
  if (!episodeDbId) {
    const reason = '칼테라 에피소드 보드 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요';
    console.error('[kaltelaMorningReport] kaltelaNotionEpisodeBoardId is not set — add it in the kaltela office settings panel');
    const report = emptyReport(false, reason);
    cache = { at: Date.now(), report };
    return report;
  }

  const pages = await notionQueryDatabase(episodeDbId!, { page_size: 100 });
  if (!pages) {
    // Configured but the live query failed — surface as disconnected so the
    // panel shows "노션 연결 확인 필요" instead of a quietly-empty report. The
    // specific HTTP/network reason is already logged by notionQueryDatabase
    // (main-process console only); summarize here for the UI.
    const report = emptyReport(false, '노션 쿼리 실패 — 에피소드 보드 DB id가 맞는지, 그 DB가 이 연동에 공유돼 있는지 확인해 주세요');
    cache = { at: Date.now(), report };
    return report;
  }

  const report = emptyReport(true);
  const todayIso = isoDate(new Date());
  let ideaCount = 0, confirmedCount = 0, renderingCount = 0;

  for (const page of pages) {
    const status = selectOf(page, '상태');
    const kind = selectOf(page, '화 유형') ?? '';
    const published = dateOf(page, '게시일');
    const dueDate = dateOf(page, '발행 예정일');

    if (status === '아이디어') ideaCount++;
    if (status === '대본확정') {
      confirmedCount++;
      report.confirmedCards.push(card(page));
    }
    if (status === '대본작성') {
      report.writingCards.push(card(page));
      const started = dateOf(page, '대본작성 시작일');
      if (started) {
        const elapsed = daysBetween(started, todayIso);
        if (elapsed > OVERDUE_WRITING_DAYS) {
          report.overdueWriting.push(card(page, `대본작성 시작 ${elapsed}일째`));
        }
      }
    }
    if (status === '작화') {
      renderingCount++;
      report.renderingCards.push(card(page));
    }

    if (kind.includes('광고') && !published) {
      report.adDisclosureWarnings.push(card(page, dueDate ? `발행 예정일 ${dueDate} · 광고 표시 확인 필요` : '광고 표시 확인 필요'));
    }

    const d24 = dateOf(page, '24시간 체크일');
    const d7 = dateOf(page, '7일 체크일');
    const d29 = dateOf(page, '29일 체크일');
    if (d24 === todayIso) report.checksToday.push(card(page, '24시간 체크'));
    if (d7 === todayIso) report.checksToday.push(card(page, '7일 체크 · 댓글 복사 필요'));
    if (d29 === todayIso) report.checksToday.push(card(page, '29일 체크'));
    if (d29 && d29 > todayIso) {
      const until = daysBetween(todayIso, d29);
      if (until > 0 && until <= CHECK29_WARNING_DAYS) {
        report.checksUpcoming29.push(card(page, `29일 체크 임박 (D-${until})`));
      }
    }
  }

  report.noIdeaCards = ideaCount === 0;
  report.scheduleOk = renderingCount >= 1 && confirmedCount >= 1;
  report.scheduleNote = report.scheduleOk
    ? ''
    : `주 2화 기준 부족 — 작화 중 ${renderingCount}편, 대본확정 ${confirmedCount}편 (기준: 작화 1편 + 대본확정 1편 이상)`;
  report.decisionCount = report.adDisclosureWarnings.length + report.overdueWriting.length + (report.scheduleOk ? 0 : 1);

  cache = { at: Date.now(), report };
  return report;
}
