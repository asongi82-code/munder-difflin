/**
 * Default MCP server catalog (Workstream 3). A dependency-free, importable-by-both
 * (main + renderer) registry of the MCP servers Munder Difflin can wire into each
 * agent's per-session `settings.json`. Keep it free of electron/UI/node imports.
 *
 * Tiers gate consent:
 *   - 'safe-readonly' → no secret, no destructive write OUTSIDE the agent cwd; shipped
 *                       ON by default (`defaultEnabled:true`). `filesystem`/`git` are
 *                       scoped to the agent cwd at merge time (never whole-disk).
 *   - 'write'         → can mutate state beyond the workspace; OFF by default,
 *                       consent-gated.
 *   - 'secret'        → needs an API key / token / connection string; OFF by default,
 *                       consent-gated.
 *
 * The actual merge (catalog ∩ enabled, cwd-scoping of filesystem/git, id namespacing,
 * non-fatal resolution) is Workstream 3's `buildDefaultMcpServers`/`hookSettings`
 * job — this module only declares the entries, their tiers, and the seed defaults.
 *
 * NOTE: several reference servers ship as Python (uvx) rather than npm (npx). The
 * commands below reflect each server's real transport; entries that couldn't be
 * verified against an installed server are flagged `// TODO-verify`. Workstream 3
 * makes a server that fails to resolve non-fatal to the agent.
 */

export type McpTier = 'safe-readonly' | 'write' | 'secret';

export interface McpCatalogEntry {
  /** Stable catalog id (also the consent key in `config.mcpDefaults`). The merge
   *  step namespaces the written server id (e.g. `munder-<id>`) to avoid clobbering
   *  a user's own `~/.claude` MCP server of the same name. */
  id: string;
  /** Human label for the consent UI. */
  label: string;
  /** One-line description for the consent UI / hire import preview. */
  description: string;
  /** The MCP stdio server launch spec. `filesystem`/`git` carry a placeholder cwd
   *  arg that Workstream 3 replaces with the agent cwd at merge time. */
  spec: {
    command: string;
    args: string[];
    /** Required env (e.g. an API token). Present only on write/secret entries; the
     *  value is supplied via consent, never hard-coded here. */
    env?: Record<string, string>;
  };
  tier: McpTier;
  /** Seed for `config.mcpDefaults[id].enabled`. Always === (tier === 'safe-readonly'). */
  defaultEnabled: boolean;
}

/** The default MCP bundle. Safe/read-only servers are ON; anything that writes
 *  beyond the workspace or needs a secret is OFF until the user consents. */
export const MCP_CATALOG: McpCatalogEntry[] = [
  // ─── Safe, read-only, no-secret — shipped ON ──────────────────────────────
  {
    id: 'sequential-thinking',
    label: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning scratchpad. No I/O, no secrets.',
    spec: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'time',
    label: 'Time',
    description: 'Current time and timezone conversions.',
    // Reference time server ships as Python. // TODO-verify transport (uvx vs an npm port)
    spec: { command: 'uvx', args: ['mcp-server-time'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'fetch',
    label: 'Fetch',
    description: 'Fetch a URL and return its content as markdown (read-only HTTP GET).',
    // Reference fetch server ships as Python. // TODO-verify transport (uvx vs an npm port)
    spec: { command: 'uvx', args: ['mcp-server-fetch'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'context7',
    label: 'Context7 Docs',
    description: 'Up-to-date library/framework documentation lookups.',
    spec: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'filesystem',
    label: 'Filesystem (cwd)',
    description: 'Read/edit files within the agent workspace only (scoped to cwd at spawn).',
    // The trailing arg is the allowed root — Workstream 3 replaces this placeholder
    // with the agent cwd at merge time so it is NEVER whole-disk.
    spec: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '<cwd>'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'git',
    label: 'Git (cwd)',
    description: 'Inspect git status/log/diff for the workspace repo (scoped to cwd at spawn).',
    // Reference git server ships as Python; `--repository <cwd>` is set at merge time.
    // TODO-verify transport (uvx vs an npm port).
    spec: { command: 'uvx', args: ['mcp-server-git', '--repository', '<cwd>'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },

  // ─── Write / secret — shipped OFF, consent-gated ──────────────────────────
  {
    id: 'github-token',
    label: 'GitHub',
    description: 'Read/write GitHub issues, PRs, and repos. Requires a personal access token.',
    spec: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' }
    },
    tier: 'secret',
    defaultEnabled: false
  },
  {
    id: 'db',
    label: 'Database',
    description: 'Query a SQL database. Requires a connection string.',
    // TODO-verify exact server package for the user's DB engine (Postgres assumed).
    spec: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      env: { DATABASE_URL: '' }
    },
    tier: 'secret',
    defaultEnabled: false
  },
  {
    id: 'email-calendar',
    label: 'Email & Calendar',
    description: 'Read/send mail and read/write calendar events. Requires account credentials.',
    // TODO-verify provider package (Gmail/Google Calendar assumed).
    spec: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-gsuite'], env: { GOOGLE_OAUTH_TOKEN: '' } },
    tier: 'secret',
    defaultEnabled: false
  },
  {
    id: 'search-with-key',
    label: 'Web Search',
    description: 'Keyed web search. Requires a search-provider API key.',
    // TODO-verify provider package (Brave Search assumed).
    spec: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '' } },
    tier: 'secret',
    defaultEnabled: false
  },

  // ─── 칼테라 오피스 (Kaltela Office) — per-role integrations ──────────────
  // These three exist so a HIRE can list only the ids it needs in its
  // `mcpServers` allow-list (see AgentMeta.mcpServers in hive.ts) instead of
  // every agent sharing one global switch. Still OFF by default and
  // consent-gated like any other 'secret' entry — adding an id to a hire's
  // allow-list is necessary but not sufficient; the human still enables the
  // underlying server once (supplies the token) in settings.
  {
    id: 'notion',
    label: 'Notion',
    description: '칼테라 노션 DB(에피소드 보드, 주간 리포트, 광고 문의 기록) 읽기/쓰기. Requires a Notion internal integration token scoped to those DBs only.',
    // Official Notion MCP server. // TODO-verify package name/version at install time.
    spec: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: '' } },
    tier: 'secret',
    defaultEnabled: false
  },
  {
    id: 'metricool',
    label: 'Metricool',
    description: '인스타 게시물 성과 지표(조회수·도달·좋아요 등) 조회. Requires a Metricool user token + blog id.',
    // No verified community stdio server as of writing — Metricool's own MCP may
    // be a remote/HTTP connector rather than an npx stdio server like the rest of
    // this catalog. // TODO-verify transport once Metricool's official MCP ships;
    // placeholder keeps the catalog entry's shape consistent with the others.
    spec: { command: 'npx', args: ['-y', '@metricool/mcp-server'], env: { METRICOOL_USER_TOKEN: '', METRICOOL_BLOG_ID: '' } },
    tier: 'secret',
    defaultEnabled: false
  },
  {
    id: 'gmail-readonly',
    label: 'Gmail (읽기 전용)',
    description: '"칼테라 광고" 라벨 메일만 읽기. Requests ONLY the gmail.readonly OAuth scope — Google itself rejects any send/modify/delete call for this token, regardless of what the agent tries (stronger than app-side tool denial). One-time local setup: download the OAuth Desktop client\'s credentials.json from Google Cloud Console to `%USERPROFILE%\\.gmail-mcp\\credentials.json`, then run `npx -y @symbolstar/gmail-mcp auth` once. No env vars needed here — the server reads its own stored token file at spawn.',
    // 2026-10-19(v0.2, PRD 「8. 개발 순서」 11번): 두 번 교체됨.
    //   1차: @modelcontextprotocol/server-gsuite — npm에 존재하지 않는 패키지였다(실제
    //        조회로 확인).
    //   2차: @jdickey1/mcp-gmail — gmail.readonly 스코프에 실제 패키지였지만, 실제
    //        사용 중 발견한 버그로 교체함: 검색 결과가 0건이면 정상 작동하는데 1건이라도
    //        있으면 그 호출 자체가 실패한다(영업사원 하이브 에이전트가 실제 라벨로
    //        재현해 확인). Windows 브라우저 열기도 `&` 포함 URL을 셸 문자열로 넘겨
    //        끊어지는 버그가 있었다(별도로 겪고 고침).
    // 지금: @symbolstar/gmail-mcp(https://github.com/SymbolStar/gmail-mcp) — 소스를
    // 직접 받아 확인함(공개 저장소 없다고 떴던 npm 레지스트리 메타데이터와 달리
    // package.json엔 저장소 URL이 있었다). `GMAIL_SCOPES = ["…/auth/gmail.readonly"]`
    // 하나만 요청하고, 공식 `googleapis` 클라이언트로 구현이 단순·안전하다. 브라우저
    // 여는 코드도 `execFile(cmd, ['/c','start','',url])`로 인자를 분리해서 넘겨
    // Windows `&` 버그가 없다. 도구 네 가지: list_emails / get_email / search_emails
    // (Gmail 검색 문법 그대로 전달, label: 연산자 포함) / list_labels. get_thread는
    // 없다 — 같은 스레드 묶기는 search_emails가 돌려주는 threadId로 영업사원이 직접
    // 판단한다(employees/sales/CLAUDE.md 참고). 인증은 env가 아니라 고정 파일
    // 경로(`~/.gmail-mcp/credentials.json`, `~/.gmail-mcp/token.json`)만 본다 — 이
    // 서버 스펙엔 env가 필요 없다.
    spec: { command: 'npx', args: ['-y', '@symbolstar/gmail-mcp'] },
    tier: 'secret',
    defaultEnabled: false
  }
];

/** Look up a catalog entry by id. */
export function mcpCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id);
}

/** Whether an id is a known safe-readonly server (the only tier a hire manifest may
 *  request without surfacing for human consent — Workstream 3 validation). */
export function isSafeReadonlyMcp(id: string): boolean {
  return mcpCatalogEntry(id)?.tier === 'safe-readonly';
}

/** Seed for `DEFAULTS.mcpDefaults` — derived from the catalog so the two never
 *  drift (safe-readonly ON, write/secret OFF). */
export function defaultMcpDefaults(): Record<string, { enabled: boolean }> {
  const out: Record<string, { enabled: boolean }> = {};
  for (const e of MCP_CATALOG) out[e.id] = { enabled: e.defaultEnabled };
  return out;
}
