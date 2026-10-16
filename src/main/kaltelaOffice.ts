/**
 * PRD.md 「8. 개발 순서」 6번 — 사무실 글씨와 정보 표시의 데이터 쪽.
 *
 * OfficeFloor가 그리는 3곳(편집장실 체크리스트 / 대표 모니터 팔로워 수 / 오른쪽
 * 보드)에 노션 값을 채워 준다. 노션 토큰은 새로 저장소를 만들지 않고 기존
 * Integrations 레지스트리(Settings → Connections)의 'notion' 항목을 그대로 쓴다
 * — 토큰은 main 프로세스 밖으로 나가지 않는다. 토큰·DB ID가 비어 있거나 요청이
 * 실패하면 null을 돌려주고, 렌더러는 그 값을 '—'로 보여준다(지어내지 않음).
 */
import * as integrations from './integrations';
import { buildAuthHeaders, resolveUpstreamUrl } from '../shared/integrations';
import { readConfig } from './config';

const NOTION_INTEGRATION_ID = 'notion';
const NOTION_VERSION = '2022-06-28';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export interface KaltelaWeekCard {
  title: string;
  /** e.g. "금 10/16" */
  dayLabel: string;
  isAd: boolean;
  state: 'done' | 'doing' | 'scheduled';
  /** Only set for state === 'doing'. */
  stageLabel?: string;
}

export interface KaltelaOfficeSnapshot {
  /** Whether the notion integration is configured enough to have been queried
   *  (token + at least one db id present) — NOT whether every value resolved. */
  connected: boolean;
  /** Index into the 6 checklist stage names, or null if it couldn't be determined. */
  stageIndex: number | null;
  followerCount: number | null;
  todayLabel: string;
  week: KaltelaWeekCard[];
}

type NotionPage = { id: string; properties: Record<string, NotionProp> };
type NotionProp = {
  type: string;
  title?: Array<{ plain_text?: string }>;
  select?: { name?: string } | null;
  date?: { start?: string } | null;
  number?: number | null;
};

function titleOf(page: NotionPage, name: string): string | null {
  const p = page.properties?.[name];
  if (p?.type === 'title') {
    const text = (p.title ?? []).map((t) => t.plain_text ?? '').join('').trim();
    return text || null;
  }
  return null;
}
function selectOf(page: NotionPage, name: string): string | null {
  const p = page.properties?.[name];
  return p?.type === 'select' ? (p.select?.name ?? null) : null;
}
function dateOf(page: NotionPage, name: string): string | null {
  // 실제 노션 DB와 대조해 이름이 정확히 일치함을 확인했다(PRD 6-0). 다른
  // 이름의 date 속성으로 대신 떨어지는 fallback은 엉뚱한 날짜를 가져오는
  // 쪽이 더 위험해서(예: 발행 예정일 대신 최근갱신일을 집는 식) 두지 않는다.
  const p = page.properties?.[name];
  return p?.type === 'date' && p.date?.start ? p.date.start : null;
}
function numberOf(page: NotionPage, name: string): number | null {
  const p = page.properties?.[name];
  return p?.type === 'number' && typeof p.number === 'number' ? p.number : null;
}

/** POST a database query through the stored 'notion' integration. Returns
 *  null on anything short of a clean 200 — missing integration, missing
 *  secret, bad db id, network error, timeout. Never throws. Logs a short,
 *  secret-free reason to the main-process console on failure so a dead
 *  connection is debuggable instead of silently looking like "no data". */
async function notionQueryDatabase(dbId: string, body: Record<string, unknown>): Promise<NotionPage[] | null> {
  const rec = integrations.getRecord(NOTION_INTEGRATION_ID);
  if (!rec) { console.error(`[kaltelaOffice] no '${NOTION_INTEGRATION_ID}' integration record — add one in Settings → Connections → Integrations`); return null; }
  if (!rec.enabled) { console.error(`[kaltelaOffice] '${NOTION_INTEGRATION_ID}' integration exists but is disabled`); return null; }
  const secret = integrations.getSecret(rec.secretRef);
  if (!secret) { console.error(`[kaltelaOffice] '${NOTION_INTEGRATION_ID}' integration has no stored secret`); return null; }
  const target = resolveUpstreamUrl(rec.baseUrl, `/databases/${dbId}/query`);
  if (!target) { console.error(`[kaltelaOffice] could not resolve query URL for db ${dbId} against baseUrl ${rec.baseUrl}`); return null; }
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const r = await fetch(target, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(rec.authType, rec.authHeader, secret),
        'content-type': 'application/json',
        'Notion-Version': NOTION_VERSION
      },
      body: JSON.stringify(body)
    });
    clearTimeout(timer);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error(`[kaltelaOffice] notion query failed for db ${dbId}: HTTP ${r.status} ${text.slice(0, 300)}`);
      return null;
    }
    const json = (await r.json()) as { results?: NotionPage[] };
    return Array.isArray(json.results) ? json.results : null;
  } catch (e) {
    console.error(`[kaltelaOffice] notion query threw for db ${dbId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

const STATUS_STAGE: Record<string, number> = {
  '아이디어': 0,
  '대본작성': 1,
  '대본확정': 2,
  '작화': 3
};
/** 발행완료 카드가 체크 기간(29일) 안이면 성과분석 단계로 센다. */
const PUBLISHED_CHECK_WINDOW_DAYS = 29;

function weekdayKo(d: Date): string {
  return ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
}
function dayLabel(d: Date): string {
  return `${weekdayKo(d)} ${d.getMonth() + 1}/${d.getDate()}`;
}
function startOfWeekMonday(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffToMonday = (d.getDay() + 6) % 7; // Sun=0 → 6 days back; Mon=1 → 0
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

let cache: { at: number; snapshot: KaltelaOfficeSnapshot } | null = null;

export async function getKaltelaOfficeSnapshot(): Promise<KaltelaOfficeSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;

  const now = new Date();
  const cfg = readConfig();
  const episodeDbId = cfg.kaltelaNotionEpisodeBoardId?.trim();
  const followerDbId = cfg.kaltelaNotionFollowerDbId?.trim();
  const rec = integrations.getRecord(NOTION_INTEGRATION_ID);
  const connected = !!(rec?.enabled && integrations.hasSecret(rec.secretRef) && (episodeDbId || followerDbId));

  let stageIndex: number | null = null;
  const week: KaltelaWeekCard[] = [];

  if (episodeDbId) {
    const pages = await notionQueryDatabase(episodeDbId, { page_size: 50 });
    if (pages) {
      // 진행 중인 가장 앞선 화 — 아이디어 단계 카드는 발행 예정일이 아직
      // 없는 게 정상(스케줄이 안 잡혔을 뿐 진행 중은 맞음)이라, 날짜 유무로
      // 거르지 않고 활성 상태(아이디어~작화) 중 가장 진행된 단계를 쓴다.
      // 활성 카드가 하나도 없을 때만 — 전부 발행완료일 때 — 체크 기간(29일)
      // 안의 가장 최근 발행완료 카드로 성과분석 단계를 센다.
      let activeStage: number | null = null;
      let latestPublished: string | null = null;
      for (const page of pages) {
        const status = selectOf(page, '상태');
        if (!status) continue;
        if (status in STATUS_STAGE) {
          const s = STATUS_STAGE[status];
          if (activeStage == null || s > activeStage) activeStage = s;
        } else if (status === '발행완료') {
          const published = dateOf(page, '게시일');
          if (published && (!latestPublished || published > latestPublished)) latestPublished = published;
        }
      }
      if (activeStage != null) {
        stageIndex = activeStage;
      } else if (latestPublished) {
        const ageDays = (now.getTime() - new Date(latestPublished).getTime()) / 86_400_000;
        stageIndex = ageDays >= 0 && ageDays <= PUBLISHED_CHECK_WINDOW_DAYS ? 4 : null;
      } else {
        stageIndex = null;
      }

      const monday = startOfWeekMonday(now);
      const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
      for (const page of pages) {
        const due = dateOf(page, '발행 예정일');
        if (!due) continue;
        const dueDate = new Date(due);
        if (dueDate < monday || dueDate > sunday) continue;
        const title = titleOf(page, '제목') ?? '(제목 없음)';
        const kind = selectOf(page, '화 유형') ?? '';
        const status = selectOf(page, '상태');
        const published = dateOf(page, '게시일');
        week.push({
          title,
          dayLabel: dayLabel(dueDate),
          isAd: kind.includes('광고'),
          state: published || status === '발행완료' ? 'done' : 'doing',
          stageLabel: !published && status !== '발행완료' ? (status ?? undefined) : undefined
        });
      }
      week.sort((a, b) => (a.dayLabel < b.dayLabel ? -1 : 1));
    }
  }

  let followerCount: number | null = null;
  if (followerDbId) {
    const pages = await notionQueryDatabase(followerDbId, { page_size: 50 });
    if (pages) {
      let latest: { date: string; count: number } | null = null;
      for (const page of pages) {
        const d = dateOf(page, '날짜');
        const n = numberOf(page, '팔로워수');
        if (d == null || n == null) continue;
        if (!latest || d > latest.date) latest = { date: d, count: n };
      }
      followerCount = latest?.count ?? null;
    }
  }

  const snapshot: KaltelaOfficeSnapshot = {
    connected,
    stageIndex,
    followerCount,
    todayLabel: `${now.getMonth() + 1}.${now.getDate()} (${weekdayKo(now)})`,
    week
  };
  cache = { at: Date.now(), snapshot };
  return snapshot;
}
