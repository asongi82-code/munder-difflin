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
