/**
 * PRD.md 「8. 개발 순서」 11번 — 영업사원 (P1-2), 4-7 「광고 문의 화면」.
 *
 * 이 모듈이 기계적으로 안전하게 할 수 있는 일만 맡는다:
 *   - 「광고 문의 기록」 DB를 그대로 읽어 목록으로 보여준다 (진행 상태별 묶음은
 *     렌더러가 한다).
 *   - 선택한 문의의 "답장 초안" 본문 섹션을 그대로 읽어 보여준다(쓰지 않음).
 *
 * 이 모듈이 하지 않는 일: 메일/DM 내용을 읽고 진짜 광고 문의인지 판단하는 것,
 * 문의 항목(업체·제품·조건 등)을 뽑아 카드를 만드는 것, 답장 초안을 쓰는 것,
 * 일정을 조율하는 것 — 전부 글 내용을 이해해야 하는 판단이다. 지메일도 이
 * 프로세스가 직접 읽지 않는다 — 'notion' 연동처럼 앱 전역에 연결해 둔 지메일
 * REST 연동이 없고, PRD 7장대로 영업사원 하이브 에이전트에게만 읽기 전용
 * `gmail-readonly` MCP를 붙였다(employees/sales/CLAUDE.md의 mcpDenyTools로
 * 보내기·삭제 도구를 금지). 메일 확인·DM 판단·카드 생성·답장 작성은 전부 그
 * 에이전트가 자기 세션으로 한다 — renderer가 하이브 메시지로 요청한다
 * (NextEpisodePanel의 "저장하고 대본확정"과 같은 패턴). "답장 초안" 섹션
 * 이름은 「에피소드 카드 양식」 같은 공식 노션 템플릿이 아직 없어 이 프로젝트가
 * 새로 정한 규칙이다 — employees/sales/CLAUDE.md에 같이 적어 둔다.
 */
import { readConfig } from './config';
import {
  notionIntegrationReady,
  notionQueryDatabase,
  notionPageSectionText,
  titleOf,
  textOf,
  selectOf,
  dateOf,
  numberOf,
  checkboxOf
} from './notion';

const LIST_CACHE_TTL_MS = 60_000;

export interface KaltelaAdInquiry {
  id: string;
  url: string;
  company: string;
  status: string | null;
  contactChannel: string | null;
  inquiryDate: string | null;
  advertiserDeadline: string | null;
  product: string | null;
  requestedTerms: string | null;
  contactPerson: string | null;
  contactInfo: string | null;
  proposedAmount: number | null;
  confirmedAmount: number | null;
  paymentDueDate: string | null;
  paymentConfirmed: boolean;
  resultReportDone: boolean;
}

export interface KaltelaAdInquiriesResult {
  /** false ⇒ "노션 연결 확인 필요"만 보여주고 나머지는 비워 둔다. */
  connected: boolean;
  reason?: string;
  items: KaltelaAdInquiry[];
}

function emptyInquiries(connected: boolean, reason?: string): KaltelaAdInquiriesResult {
  return { connected, reason, items: [] };
}

let listCache: { at: number; result: KaltelaAdInquiriesResult } | null = null;

/** 「광고 문의 기록」 DB의 모든 문의를 그대로 읽는다. 상태별로 묶어 보여주는
 *  건 화면(렌더러)이 한다 — 여기서는 문의일 최신순으로만 정렬한다. */
export async function getKaltelaAdInquiries(opts: { force?: boolean } = {}): Promise<KaltelaAdInquiriesResult> {
  if (!opts.force && listCache && Date.now() - listCache.at < LIST_CACHE_TTL_MS) return listCache.result;

  const cfg = readConfig();
  const dbId = cfg.kaltelaNotionAdInquiryDbId?.trim();
  const ready = notionIntegrationReady();
  if (!ready.ready) return cacheAndReturn(emptyInquiries(false, ready.reason));
  if (!dbId) {
    return cacheAndReturn(emptyInquiries(false, '광고 문의 기록 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요'));
  }

  const pages = await notionQueryDatabase(dbId, { page_size: 100 });
  if (!pages) {
    return cacheAndReturn(emptyInquiries(false, '노션 쿼리 실패 — 광고 문의 기록 DB id가 맞는지, 그 DB가 이 연동에 공유돼 있는지 확인해 주세요'));
  }

  const items: KaltelaAdInquiry[] = pages
    .map((p) => ({
      id: p.id,
      url: p.url ?? '',
      company: titleOf(p, '업체') ?? '(업체 없음)',
      status: selectOf(p, '진행 상태'),
      contactChannel: selectOf(p, '연락 경로'),
      inquiryDate: dateOf(p, '문의일'),
      advertiserDeadline: dateOf(p, '광고주 마감'),
      product: textOf(p, '제품'),
      requestedTerms: textOf(p, '요청 조건'),
      contactPerson: textOf(p, '담당자'),
      contactInfo: textOf(p, '연락처'),
      proposedAmount: numberOf(p, '제안 금액'),
      confirmedAmount: numberOf(p, '확정 금액'),
      paymentDueDate: dateOf(p, '입금 예정일'),
      paymentConfirmed: checkboxOf(p, '입금 확인'),
      resultReportDone: checkboxOf(p, '결과 보고 완료')
    }))
    .sort((a, b) => (b.inquiryDate ?? '').localeCompare(a.inquiryDate ?? ''));

  return cacheAndReturn({ connected: true, items });
}

function cacheAndReturn(result: KaltelaAdInquiriesResult): KaltelaAdInquiriesResult {
  listCache = { at: Date.now(), result };
  return result;
}

export interface KaltelaAdInquiryDraft {
  ok: boolean;
  error?: string;
  /** "답장 초안" 섹션 원문 — 영업사원이 아직 쓰지 않았으면 null. */
  draft: string | null;
}

/** 문의 하나의 "답장 초안" 본문 섹션을 그대로 읽어 온다(쓰지 않음). 업체명·
 *  URL 등 속성은 호출자(렌더러)가 이미 로드해 둔 목록에서 가져온다 — 여기서
 *  페이지 속성을 다시 조회하지 않는다. */
export async function getKaltelaAdInquiryDraft(inquiryId: string): Promise<KaltelaAdInquiryDraft> {
  const ready = notionIntegrationReady();
  if (!ready.ready) return { ok: false, error: ready.reason, draft: null };

  const cfg = readConfig();
  const dbId = cfg.kaltelaNotionAdInquiryDbId?.trim();
  if (!dbId) return { ok: false, error: '광고 문의 기록 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요', draft: null };

  const draftRaw = await notionPageSectionText(inquiryId, '답장 초안');
  const draft = draftRaw && draftRaw.trim() ? draftRaw : null;

  return { ok: true, draft };
}
