/**
 * PRD.md 「0. 문서 정보」가 12번(마무리 점검) 전에 추가로 계획해 둔 "카드 전체를
 * 보는 화면"(시시오피스 스타일, BoardPanel/kaltelaBoard.ts 참고)을 성과분석에도
 * 적용한 화면 — PRD 밖 추가 요청. 팔로워 추이(월별·연별)와 조회수 높은 게시물
 * TOP10을 읽기만 한다. kaltelaPerformance.ts(7일 체크 입력)와 달리 아무것도
 * 쓰지 않는다.
 *
 * 조회수는 체크 기간별로 칸이 따로 있다(「24시간 조회수」/「7일 조회수」/
 * 「29일 조회수」, 실제 노션 DB 확인 결과 — PRD 6-0의 "조회수(24h·7일·29일)"
 * 설명을 이 세 칸으로 구체화). 발행 후 29일이 안 지난 화는 29일 조회수가 아직
 * 비어 있으므로, 체크 기간이 가장 늦게 끝난 쪽부터(29일 → 7일 → 24시간) 실제로
 * 값이 있는 첫 칸을 대표 조회수로 쓰고 어느 기간인지(`viewsWindow`)를 같이
 * 돌려준다 — 서로 다른 체크 기간의 숫자를 섞어서 비교하는 것처럼 보이지
 * 않도록, 지어내지 않는다.
 */
import { readConfig } from './config';
import {
  notionIntegrationReady,
  notionQueryDatabase,
  titleOf,
  selectOf,
  dateOf,
  numberOf,
  urlOf
} from './notion';

const CACHE_TTL_MS = 60_000;

export type KaltelaViewsWindow = '24시간' | '7일' | '29일';

export interface KaltelaFollowerPoint {
  /** "2026-10" (월별) 또는 "2026" (연별). */
  period: string;
  /** 그 기간에 가장 마지막으로 기록된 팔로워 수(해당 기간의 종가 격). */
  followerCount: number;
  /** 바로 앞 기간 종가 대비 증감. 첫 기간이면 null. */
  change: number | null;
}

export interface KaltelaTopPost {
  id: string;
  title: string;
  /** 노션 카드 url — 인스타그램 url이 없을 때 그대로 연다. */
  url: string;
  instagramUrl: string | null;
  kind: string | null;
  seriesName: string | null;
  publishedDate: string | null;
  views: number;
  viewsWindow: KaltelaViewsWindow;
}

export interface KaltelaPerformanceOverview {
  /** false ⇒ "노션 연결 확인 필요"만 보여주고 나머지는 비워 둔다. */
  connected: boolean;
  reason?: string;
  /** 「인스타 팔로워 기록」 DB id가 비어 있어 팔로워 추이를 아예 못 읽었음. */
  followerDbMissing: boolean;
  /** 「칼테라 에피소드 보드」 DB id가 비어 있어 TOP10을 아예 못 읽었음. */
  episodeDbMissing: boolean;
  followerMonthly: KaltelaFollowerPoint[];
  followerYearly: KaltelaFollowerPoint[];
  topPosts: KaltelaTopPost[];
}

function emptyOverview(connected: boolean, reason?: string): KaltelaPerformanceOverview {
  return {
    connected,
    reason,
    followerDbMissing: false,
    episodeDbMissing: false,
    followerMonthly: [],
    followerYearly: [],
    topPosts: []
  };
}

let cache: { at: number; result: KaltelaPerformanceOverview } | null = null;

export async function getKaltelaPerformanceOverview(
  opts: { force?: boolean } = {}
): Promise<KaltelaPerformanceOverview> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.result;

  const cfg = readConfig();
  const episodeDbId = cfg.kaltelaNotionEpisodeBoardId?.trim();
  const followerDbId = cfg.kaltelaNotionFollowerDbId?.trim();
  const ready = notionIntegrationReady();
  if (!ready.ready) return cacheAndReturn(emptyOverview(false, ready.reason));
  if (!episodeDbId && !followerDbId) {
    return cacheAndReturn(
      emptyOverview(false, '칼테라 에피소드 보드·인스타 팔로워 기록 DB id가 모두 비어 있음 — 사무실 설정에서 넣어 주세요')
    );
  }

  let followerMonthly: KaltelaFollowerPoint[] = [];
  let followerYearly: KaltelaFollowerPoint[] = [];
  if (followerDbId) {
    const pages = await notionQueryDatabase(followerDbId, { page_size: 100 });
    if (pages) {
      const rows: Array<{ date: string; count: number }> = [];
      for (const page of pages) {
        const d = dateOf(page, '날짜');
        const n = numberOf(page, '팔로워수');
        if (d == null || n == null) continue;
        rows.push({ date: d, count: n });
      }
      rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      followerMonthly = closingValuesByPeriod(rows, (d) => d.slice(0, 7));
      followerYearly = closingValuesByPeriod(rows, (d) => d.slice(0, 4));
    }
  }

  let topPosts: KaltelaTopPost[] = [];
  if (episodeDbId) {
    const pages = await notionQueryDatabase(episodeDbId, { page_size: 100 });
    if (pages) {
      const candidates: KaltelaTopPost[] = [];
      for (const page of pages) {
        if (selectOf(page, '상태') !== '발행완료') continue;
        const byWindow: Array<[KaltelaViewsWindow, number | null]> = [
          ['29일', numberOf(page, '29일 조회수')],
          ['7일', numberOf(page, '7일 조회수')],
          ['24시간', numberOf(page, '24시간 조회수')]
        ];
        const found = byWindow.find(([, v]) => v != null);
        if (!found || found[1] == null) continue;
        candidates.push({
          id: page.id,
          title: titleOf(page, '제목') ?? '(제목 없음)',
          url: page.url ?? '',
          instagramUrl: urlOf(page, '게시물URL'),
          kind: selectOf(page, '화 유형'),
          seriesName: selectOf(page, '시리즈 이름'),
          publishedDate: dateOf(page, '게시일'),
          views: found[1],
          viewsWindow: found[0]
        });
      }
      candidates.sort((a, b) => b.views - a.views);
      topPosts = candidates.slice(0, 10);
    }
  }

  return cacheAndReturn({
    connected: true,
    followerDbMissing: !followerDbId,
    episodeDbMissing: !episodeDbId,
    followerMonthly,
    followerYearly,
    topPosts
  });
}

function cacheAndReturn(result: KaltelaPerformanceOverview): KaltelaPerformanceOverview {
  cache = { at: Date.now(), result };
  return result;
}

/** `rows`는 날짜 오름차순이어야 한다. 각 기간 버킷에서 가장 마지막(최신)
 *  값만 그 기간의 대표값으로 쓰고, 바로 앞 기간 대표값과의 차이를 `change`로
 *  함께 돌려준다 — 기간 내 값을 더하거나 평균 내지 않는다(팔로워 수는
 *  누적값이라 더하면 지어낸 숫자가 된다). */
function closingValuesByPeriod(
  rows: Array<{ date: string; count: number }>,
  keyOf: (date: string) => string
): KaltelaFollowerPoint[] {
  const lastByPeriod = new Map<string, number>();
  for (const row of rows) lastByPeriod.set(keyOf(row.date), row.count);
  const periods = [...lastByPeriod.keys()].sort();
  let prev: number | null = null;
  return periods.map((period) => {
    const followerCount = lastByPeriod.get(period)!;
    const point: KaltelaFollowerPoint = {
      period,
      followerCount,
      change: prev == null ? null : followerCount - prev
    };
    prev = followerCount;
    return point;
  });
}
