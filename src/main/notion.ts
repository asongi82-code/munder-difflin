/**
 * Shared Notion-query helper for the kaltela office (PRD.md 「8. 개발 순서」 6번·7번).
 *
 * Extracted out of kaltelaOffice.ts so the morning-report module (7번) can read
 * the same 'notion' integration record without duplicating the fetch/parsing
 * code. Behavior is unchanged from the original kaltelaOffice.ts version.
 */
import * as integrations from './integrations';
import { buildAuthHeaders, resolveUpstreamUrl } from '../shared/integrations';

export const NOTION_INTEGRATION_ID = 'notion';
const NOTION_VERSION = '2022-06-28';
const FETCH_TIMEOUT_MS = 10_000;

export type NotionPage = { id: string; url?: string; properties: Record<string, NotionProp> };
export type NotionProp = {
  type: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string } | null;
  date?: { start?: string } | null;
  number?: number | null;
  checkbox?: boolean;
};

export function titleOf(page: NotionPage, name: string): string | null {
  const p = page.properties?.[name];
  if (p?.type === 'title') {
    const text = (p.title ?? []).map((t) => t.plain_text ?? '').join('').trim();
    return text || null;
  }
  return null;
}
export function textOf(page: NotionPage, name: string): string | null {
  const p = page.properties?.[name];
  if (p?.type === 'rich_text') {
    const text = (p.rich_text ?? []).map((t) => t.plain_text ?? '').join('').trim();
    return text || null;
  }
  return null;
}
export function selectOf(page: NotionPage, name: string): string | null {
  const p = page.properties?.[name];
  return p?.type === 'select' ? (p.select?.name ?? null) : null;
}
export function dateOf(page: NotionPage, name: string): string | null {
  // 실제 노션 DB와 대조해 이름이 정확히 일치함을 확인했다(PRD 6-0). 다른
  // 이름의 date 속성으로 대신 떨어지는 fallback은 엉뚱한 날짜를 가져오는
  // 쪽이 더 위험해서(예: 발행 예정일 대신 최근갱신일을 집는 식) 두지 않는다.
  const p = page.properties?.[name];
  return p?.type === 'date' && p.date?.start ? p.date.start : null;
}
export function numberOf(page: NotionPage, name: string): number | null {
  const p = page.properties?.[name];
  return p?.type === 'number' && typeof p.number === 'number' ? p.number : null;
}
export function checkboxOf(page: NotionPage, name: string): boolean {
  const p = page.properties?.[name];
  return p?.type === 'checkbox' ? !!p.checkbox : false;
}

/** A page body block, as returned by the Notion blocks children API. Only the
 *  shapes the kaltela office actually reads (heading/paragraph/list/to_do rich
 *  text) are typed — everything else still has `id`/`type`/`has_children` so a
 *  caller can skip over block types it doesn't understand. */
export type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

const HEADING_TYPES = new Set(['heading_1', 'heading_2', 'heading_3']);

/** Plain text of whichever rich_text array a block type carries (heading_*,
 *  paragraph, bulleted/numbered_list_item, to_do, quote, callout) — '' for
 *  block types without one (image, divider, table, …). */
export function blockPlainText(block: NotionBlock): string {
  const body = block[block.type] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return (body?.rich_text ?? []).map((t) => t.plain_text ?? '').join('').trim();
}

/** GET a page's properties (title/select/date/… — NOT its body blocks) through
 *  the stored 'notion' integration. Null on anything short of a clean 200, same
 *  contract as notionQueryDatabase. */
export async function notionRetrievePage(pageId: string): Promise<NotionPage | null> {
  return notionGet<NotionPage>(`/pages/${pageId}`, `page ${pageId}`);
}

/** GET the top-level children blocks of a page or block through the stored
 *  'notion' integration. Single page (up to 100 blocks) — the kaltela card
 *  template's sub-heading sections are far short of that, so pagination isn't
 *  implemented. Null on failure, same contract as notionQueryDatabase. */
export async function notionGetBlockChildren(blockId: string): Promise<NotionBlock[] | null> {
  const json = await notionGet<{ results?: NotionBlock[] }>(`/blocks/${blockId}/children?page_size=100`, `block children ${blockId}`);
  return json && Array.isArray(json.results) ? json.results : null;
}

/** Plain-text content of the section under a top-level heading whose text
 *  CONTAINS `headingText` (e.g. "연속성 메모") — every block between that
 *  heading and the next heading, one per line. Null when the page has no
 *  matching heading (e.g. an idea card that was never written up) or the block
 *  fetch failed; the caller decides how to label that ("시리즈 1화" vs "조회
 *  실패") rather than this guessing. */
export async function notionPageSectionText(pageId: string, headingText: string): Promise<string | null> {
  const blocks = await notionGetBlockChildren(pageId);
  if (!blocks) return null;
  const startIdx = blocks.findIndex((b) => HEADING_TYPES.has(b.type) && blockPlainText(b).includes(headingText));
  if (startIdx === -1) return null;
  const lines: string[] = [];
  for (let i = startIdx + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (HEADING_TYPES.has(b.type)) break;
    const text = blockPlainText(b);
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

/** PATCH a page's properties through the stored 'notion' integration (state
 *  transitions, date stamps, caption/pinned-comment text — never the page
 *  body). `properties` uses the raw Notion property-value shape, e.g.
 *  `{ '상태': { select: { name: '대본작성' } } }`. Returns false on anything
 *  short of a clean 200; never throws. */
export async function notionUpdatePage(pageId: string, properties: Record<string, unknown>): Promise<boolean> {
  const rec = integrations.getRecord(NOTION_INTEGRATION_ID);
  if (!rec) { console.error(`[notion] no '${NOTION_INTEGRATION_ID}' integration record — add one in Settings → Connections → Integrations`); return false; }
  if (!rec.enabled) { console.error(`[notion] '${NOTION_INTEGRATION_ID}' integration exists but is disabled`); return false; }
  const secret = integrations.getSecret(rec.secretRef);
  if (!secret) { console.error(`[notion] '${NOTION_INTEGRATION_ID}' integration has no stored secret`); return false; }
  const target = resolveUpstreamUrl(rec.baseUrl, `/pages/${pageId}`);
  if (!target) { console.error(`[notion] could not resolve update URL for page ${pageId} against baseUrl ${rec.baseUrl}`); return false; }
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const r = await fetch(target, {
      method: 'PATCH',
      headers: {
        ...buildAuthHeaders(rec.authType, rec.authHeader, secret),
        'content-type': 'application/json',
        'Notion-Version': NOTION_VERSION
      },
      body: JSON.stringify({ properties })
    });
    clearTimeout(timer);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error(`[notion] update failed for page ${pageId}: HTTP ${r.status} ${text.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[notion] update threw for page ${pageId}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Shared GET helper for notionRetrievePage/notionGetBlockChildren — same
 *  null-on-failure, never-throws, secret-free-logging contract as
 *  notionQueryDatabase, just without its POST body. */
async function notionGet<T>(path: string, label: string): Promise<T | null> {
  const rec = integrations.getRecord(NOTION_INTEGRATION_ID);
  if (!rec) { console.error(`[notion] no '${NOTION_INTEGRATION_ID}' integration record — add one in Settings → Connections → Integrations`); return null; }
  if (!rec.enabled) { console.error(`[notion] '${NOTION_INTEGRATION_ID}' integration exists but is disabled`); return null; }
  const secret = integrations.getSecret(rec.secretRef);
  if (!secret) { console.error(`[notion] '${NOTION_INTEGRATION_ID}' integration has no stored secret`); return null; }
  const target = resolveUpstreamUrl(rec.baseUrl, path);
  if (!target) { console.error(`[notion] could not resolve URL for ${label} against baseUrl ${rec.baseUrl}`); return null; }
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const r = await fetch(target, {
      method: 'GET',
      headers: {
        ...buildAuthHeaders(rec.authType, rec.authHeader, secret),
        'Notion-Version': NOTION_VERSION
      }
    });
    clearTimeout(timer);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error(`[notion] GET failed for ${label}: HTTP ${r.status} ${text.slice(0, 300)}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.error(`[notion] GET threw for ${label}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Whether the stored 'notion' integration is configured enough to query
 *  (record exists, enabled, has a secret) — independent of any particular db
 *  id. The reason (when not ready) is returned, not just logged, so a caller
 *  can surface it in the UI — console.error in the main process never reaches
 *  the renderer DevTools console. */
export function notionIntegrationReady(): { ready: true } | { ready: false; reason: string } {
  const rec = integrations.getRecord(NOTION_INTEGRATION_ID);
  if (!rec) {
    // Settings → Connections lets the id drift from the 'notion' template's
    // suggested id if the label was edited while adding it — list what IS
    // registered so a mismatched id is obvious instead of a silent "not ready".
    const ids = integrations.listRecords().map((r) => r.id).join(', ') || '(none)';
    const reason = `'${NOTION_INTEGRATION_ID}' 연동을 찾을 수 없음 — 등록된 연동 id: ${ids}`;
    console.error(`[notion] no integration with id '${NOTION_INTEGRATION_ID}' — registered ids: ${ids}`);
    return { ready: false, reason };
  }
  if (!rec.enabled) {
    console.error(`[notion] '${NOTION_INTEGRATION_ID}' integration exists but is disabled`);
    return { ready: false, reason: `'notion' 연동이 꺼져 있음 (Settings → Connections에서 켜 주세요)` };
  }
  if (!integrations.hasSecret(rec.secretRef)) {
    console.error(`[notion] '${NOTION_INTEGRATION_ID}' integration has no stored secret`);
    return { ready: false, reason: `'notion' 연동에 토큰이 저장돼 있지 않음` };
  }
  return { ready: true };
}

/** POST a database query through the stored 'notion' integration. Returns
 *  null on anything short of a clean 200 — missing integration, missing
 *  secret, bad db id, network error, timeout. Never throws. Logs a short,
 *  secret-free reason to the main-process console on failure so a dead
 *  connection is debuggable instead of silently looking like "no data". */
export async function notionQueryDatabase(dbId: string, body: Record<string, unknown>): Promise<NotionPage[] | null> {
  const rec = integrations.getRecord(NOTION_INTEGRATION_ID);
  if (!rec) { console.error(`[notion] no '${NOTION_INTEGRATION_ID}' integration record — add one in Settings → Connections → Integrations`); return null; }
  if (!rec.enabled) { console.error(`[notion] '${NOTION_INTEGRATION_ID}' integration exists but is disabled`); return null; }
  const secret = integrations.getSecret(rec.secretRef);
  if (!secret) { console.error(`[notion] '${NOTION_INTEGRATION_ID}' integration has no stored secret`); return null; }
  const target = resolveUpstreamUrl(rec.baseUrl, `/databases/${dbId}/query`);
  if (!target) { console.error(`[notion] could not resolve query URL for db ${dbId} against baseUrl ${rec.baseUrl}`); return null; }
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
      console.error(`[notion] query failed for db ${dbId}: HTTP ${r.status} ${text.slice(0, 300)}`);
      return null;
    }
    const json = (await r.json()) as { results?: NotionPage[] };
    return Array.isArray(json.results) ? json.results : null;
  } catch (e) {
    console.error(`[notion] query threw for db ${dbId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
