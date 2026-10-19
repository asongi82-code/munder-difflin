/**
 * PRD.md 「0. 문서 정보」가 12번(마무리 점검) 전에 추가로 계획해 둔 "카드
 * 전체를 보는 화면"(시시오피스 스타일) — 「칼테라 에피소드 보드」 전체를
 * 상태별로 한 화면에서 보고, 카드 하나를 열어도 노션으로 나가지 않고 앱
 * 안에서 그대로 읽는다.
 *
 * 이 모듈이 하는 일은 전부 읽기뿐이다 — 기존 7·10번 모듈(kaltelaMorningReport,
 * kaltelaDirector)처럼 상태를 바꾸거나 글 내용을 판단하지 않는다. 카드 상세는
 * 어떤 소제목이 있을지 미리 알지 못해도 되도록 `notionPageAllSections`로
 * 본문에 있는 섹션을 전부 그대로 읽고, 속성도 `allPropertiesOf`로 DB에 어떤
 * 칸이 있든 전부 보여준다.
 */
import { readConfig } from './config';
import {
  notionIntegrationReady,
  notionQueryDatabase,
  notionRetrievePage,
  notionPageAllSections,
  allPropertiesOf,
  titleOf,
  selectOf,
  dateOf,
  numberOf
} from './notion';

const CACHE_TTL_MS = 60_000;

/** PRD 「3. 사용자 플로우」 "에피소드 카드 상태" 순서. 보드 화면의 칼럼 순서로
 *  그대로 쓴다 — 이 순서에 없는 값(빈 상태, 오타 등)은 맨 뒤 "기타" 칼럼에
 *  모아 지어내지 않고 그대로 보여준다. */
const STATUS_ORDER = ['아이디어', '대본작성', '대본확정', '작화', '발행완료'] as const;
const OTHER_STATUS = '기타';

export interface KaltelaBoardCard {
  id: string;
  title: string;
  url: string;
  kind: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  dueDate: string | null;
  publishedDate: string | null;
}

export interface KaltelaBoardColumn {
  status: string;
  cards: KaltelaBoardCard[];
}

export interface KaltelaBoardOverview {
  /** false ⇒ "노션 연결 확인 필요"만 보여주고 columns는 비워 둔다. */
  connected: boolean;
  reason?: string;
  columns: KaltelaBoardColumn[];
  totalCount: number;
}

function emptyOverview(connected: boolean, reason?: string): KaltelaBoardOverview {
  return { connected, reason, columns: [], totalCount: 0 };
}

let cache: { at: number; result: KaltelaBoardOverview } | null = null;

export async function getKaltelaBoardOverview(opts: { force?: boolean } = {}): Promise<KaltelaBoardOverview> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.result;

  const cfg = readConfig();
  const episodeDbId = cfg.kaltelaNotionEpisodeBoardId?.trim();
  const ready = notionIntegrationReady();
  if (!ready.ready) return cacheAndReturn(emptyOverview(false, ready.reason));
  if (!episodeDbId) {
    return cacheAndReturn(emptyOverview(false, '칼테라 에피소드 보드 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요'));
  }

  const pages = await notionQueryDatabase(episodeDbId, { page_size: 100 });
  if (!pages) {
    return cacheAndReturn(emptyOverview(false, '노션 쿼리 실패 — 에피소드 보드 DB id가 맞는지, 그 DB가 이 연동에 공유돼 있는지 확인해 주세요'));
  }

  const byStatus = new Map<string, KaltelaBoardCard[]>();
  for (const status of STATUS_ORDER) byStatus.set(status, []);
  byStatus.set(OTHER_STATUS, []);

  for (const page of pages) {
    const status = selectOf(page, '상태');
    const bucket = status && byStatus.has(status) ? status : OTHER_STATUS;
    byStatus.get(bucket)!.push({
      id: page.id,
      title: titleOf(page, '제목') ?? '(제목 없음)',
      url: page.url ?? '',
      kind: selectOf(page, '화 유형'),
      seriesName: selectOf(page, '시리즈 이름'),
      seriesIndex: numberOf(page, '시리즈 회차'),
      dueDate: dateOf(page, '발행 예정일'),
      publishedDate: dateOf(page, '게시일')
    });
  }

  const columns: KaltelaBoardColumn[] = [...STATUS_ORDER, OTHER_STATUS]
    .map((status) => ({ status, cards: byStatus.get(status) ?? [] }))
    .filter((col) => col.status !== OTHER_STATUS || col.cards.length > 0);

  return cacheAndReturn({ connected: true, columns, totalCount: pages.length });
}

function cacheAndReturn(result: KaltelaBoardOverview): KaltelaBoardOverview {
  cache = { at: Date.now(), result };
  return result;
}

export interface KaltelaCardDetail {
  ok: boolean;
  error?: string;
  title?: string;
  url?: string;
  /** 제목 속성을 뺀 나머지 전체 속성 — DB에 어떤 칸이 있든 그대로 보여준다. */
  properties?: Array<{ name: string; value: string }>;
  /** 본문의 모든 소제목 섹션을 그대로 — 빈 섹션(안내 문구만 있는 경우 포함)도
   *  감추지 않고 그대로 보여준다(지어내지 않음). */
  sections?: Array<{ heading: string; text: string }>;
}

/** 카드 하나를 "노션으로 나가지 않고" 그대로 읽어 온다 — 속성·본문 전부
 *  읽기만 하고 쓰지 않는다. MorningReportPanel/BoardPanel이 카드를 클릭했을
 *  때 이 함수로 상세를 띄운다. */
export async function getKaltelaCardDetail(cardId: string): Promise<KaltelaCardDetail> {
  const ready = notionIntegrationReady();
  if (!ready.ready) return { ok: false, error: ready.reason };

  const page = await notionRetrievePage(cardId);
  if (!page) return { ok: false, error: '노션에서 카드를 불러오지 못했습니다' };

  const title = titleOf(page, '제목') ?? '(제목 없음)';
  const properties = allPropertiesOf(page).filter(({ name }) => name !== '제목');
  const sections = (await notionPageAllSections(cardId)) ?? [];

  return { ok: true, title, url: page.url ?? '', properties, sections };
}
