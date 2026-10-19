import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';

/**
 * PRD.md 「8. 개발 순서」 10번 — 연출 담당 (P1-1), 4-5 「연출 표 화면」.
 *
 * src/main/kaltelaDirector.ts가 만드는 모양을 그대로 받는다 — 렌더러는 main
 * 모듈을 import할 수 없어 같은 모양을 여기 다시 선언한다(NextEpisodePanel.tsx
 * 와 같은 패턴).
 *
 * 화면·연출 칸을 실제로 채우는 것과 "연출 표" 섹션을 저장하는 것은 이 패널이
 * 하지 않는다 — 글의 내용을 이해해야 하는 연출 판단이라, 실제 연출 담당
 * 하이브 에이전트에게 하이브 메시지로 요청한다(NextEpisodePanel의 "저장하고
 * 대본확정"과 같은 패턴). "연출 표"가 채워지면 그대로 보여주고, 화면·연출
 * 칸을 눈으로 확인하기 쉽게 표로 강조해 보여준다(4-5 요구사항) — 다만 그
 * 강조는 화면 표시용일 뿐 저장을 막는 자동 검사가 아니다. "다른 칸이 바뀌었는
 * 지"는 연출 담당 에이전트 자신의 몫(employees/director/CLAUDE.md 예외
 * 처리)이고, 대표가 직접 눈으로 확인한 뒤 [작화로 전환] 버튼을 누른다.
 */
interface KaltelaDirectorCardLike {
  id: string;
  title: string;
  url: string;
  seriesName: string | null;
  seriesIndex: number | null;
}
interface KaltelaDirectorQueueLike {
  connected: boolean;
  reason?: string;
  items: KaltelaDirectorCardLike[];
}
interface KaltelaDirectorDetailLike {
  ok: boolean;
  error?: string;
  cardTitle?: string;
  cardUrl?: string;
  status?: string | null;
  scriptTable?: string;
  directionTable?: string | null;
}
interface KaltelaDirectorConfirmResultLike {
  ok: boolean;
  error?: string;
  cardTitle?: string;
}

const POLL_MS = 60_000;

/** 화면 표시용 best-effort 마크다운 표 파서. 저장을 막는 검사가 아니라
 *  "화면·연출 칸만 강조"(PRD 4-5)를 보여주기 위한 것이라, 못 읽으면 그냥
 *  원문을 그대로 보여준다(아래 TableView). */
function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
  const toCells = (line: string) => line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
  const isSeparator = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const rows = lines.map(toCells).filter((cells) => !isSeparator(cells));
  if (rows.length < 2) return null;
  const [headers, ...body] = rows;
  return { headers, rows: body };
}

/** 화면·연출 칸은 노션 표 셀 안에서 "<br>" 태그로 줄을 나눈다(① 인물 / ②
 *  인물 / ▶캔바). 실제 줄바꿈으로 보이게 "<br>"를 <br/> 엘리먼트로 바꾼다 —
 *  그 외 태그는 손대지 않는다. */
function cellLines(text: string): React.ReactNode {
  const parts = text.split(/<br\s*\/?>/gi);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {part}
    </Fragment>
  ));
}

export function DirectorPanel() {
  const agents = useStore((s) => s.agents);
  const director = agents.find((a) => a.character === 'director');

  const [queue, setQueue] = useState<KaltelaDirectorQueueLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KaltelaDirectorDetailLike | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [note, setNote] = useState('');
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadQueue = useCallback(async (force = false) => {
    try {
      const raw = await window.cth.getKaltelaDirectorQueue({ force });
      setQueue(raw as KaltelaDirectorQueueLike);
    } catch {
      setQueue(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (cardId: string) => {
    const raw = await window.cth.getKaltelaDirectorCardDetail(cardId);
    setDetail(raw as KaltelaDirectorDetailLike);
  }, []);

  useEffect(() => {
    void loadQueue();
    timer.current = setInterval(() => {
      void loadQueue();
      if (selectedId) void loadDetail(selectedId);
    }, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [loadQueue, loadDetail, selectedId]);

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(''), 2500); };

  const openDetail = async (cardId: string) => {
    setSelectedId(cardId);
    setDetail(null);
    setLoadingDetail(true);
    try {
      await loadDetail(cardId);
    } finally {
      setLoadingDetail(false);
    }
  };

  const backToList = () => { setSelectedId(null); setDetail(null); void loadQueue(true); };

  const requestWork = async () => {
    if (!director || !detail?.ok) return;
    const body = [
      `카드: ${detail.cardTitle ?? ''} (${selectedId ?? ''})`,
      'PRD 2장 P1-1대로 아래 최종 대본 표의 "화면·연출" 칸만 채워 주세요. 다른 칸은 한 글자도 바꾸지 말고,',
      '완성한 표를 같은 카드의 "연출 표" 소제목에 저장해 주세요. 저장 전 화면·연출 외 칸이 바뀌었는지 꼭 확인해 주세요.',
      '',
      '## 최종 대본 표',
      (detail.scriptTable ?? '').trim() || '(비어 있음 — 카드에서 직접 확인해 주세요)'
    ].join('\n');

    const res = await window.cth.hiveSend(
      { to: director.id, act: 'request', subject: `연출 표 작업 요청 — ${detail.cardTitle ?? ''}`, body },
      'human'
    );
    if (!res.ok) { flash(`전달 실패: ${res.error ?? '?'}`); return; }
    if (selectedId) setRequested((prev) => ({ ...prev, [selectedId]: true }));
    flash(`${director.name}에게 전달했습니다`);
  };

  const copyDirectionTable = () => {
    if (detail?.directionTable) void window.cth.copyToClipboard(detail.directionTable);
    flash('연출 표를 복사했습니다');
  };

  const confirmAndSendToRendering = async () => {
    if (!selectedId) return;
    setConfirming(true);
    try {
      const res = (await window.cth.confirmKaltelaDirectorTable(selectedId)) as KaltelaDirectorConfirmResultLike;
      if (!res.ok) { flash(`전환 실패: ${res.error ?? '?'}`); return; }
      flash(`${res.cardTitle ?? ''} — 작화로 전환했습니다`);
      backToList();
    } finally {
      setConfirming(false);
    }
  };

  if (loading) return <Centered>불러오는 중…</Centered>;

  if (!queue || !queue.connected) {
    return (
      <Centered>
        노션 연결 확인 필요
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-ink-500)' }}>
          {queue?.reason || "Settings → Connections에서 'notion' 연결을 켜고, 사무실 설정에서 칼테라 에피소드 보드 DB id를 넣어 주세요."}
        </div>
        <div style={{ marginTop: 10 }}>
          <PixelButton variant="secondary" size="sm" onClick={() => void loadQueue(true)}>다시 확인</PixelButton>
        </div>
      </Centered>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        background: 'var(--cth-cream-100)', borderBottom: '1px solid var(--cth-ink-700)', flexShrink: 0
      }}>
        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, color: 'var(--cth-ink-900)' }}>
          {selectedId ? '연출 표' : '연출 작업 대기열'}
        </span>
        {!selectedId && (
          <span style={{
            fontFamily: 'var(--cth-font-mono)', fontSize: 11, padding: '1px 6px',
            background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-700)'
          }}>{queue.items.length}</span>
        )}
        {selectedId && (
          <PixelButton variant="ghost" size="sm" onClick={backToList}>← 목록으로</PixelButton>
        )}
        {note && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--cth-ink-500)' }}>{note}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, background: 'var(--cth-paper-200)' }}>
        {!selectedId && (
          <QueueList items={queue.items} onOpen={(id) => void openDetail(id)} />
        )}
        {selectedId && loadingDetail && <Muted>카드를 불러오는 중…</Muted>}
        {selectedId && !loadingDetail && detail && (
          <DetailView
            detail={detail}
            directorName={director?.name}
            requested={!!requested[selectedId]}
            confirming={confirming}
            onRequestWork={() => void requestWork()}
            onCopy={copyDirectionTable}
            onConfirm={() => void confirmAndSendToRendering()}
          />
        )}
      </div>
    </div>
  );
}

function QueueList({ items, onOpen }: { items: KaltelaDirectorCardLike[]; onOpen: (id: string) => void }) {
  if (items.length === 0) {
    return <Muted>연출 표 작업이 필요한 대본확정 카드가 없습니다.</Muted>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((c) => (
        <button
          key={c.id}
          onClick={() => onOpen(c.id)}
          style={{
            display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', width: '100%',
            padding: 10, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
            border: 'none', cursor: 'pointer'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 11, color: 'var(--cth-ink-900)' }}>{c.title}</span>
            {c.seriesName && <Tag>{c.seriesName}{c.seriesIndex != null ? ` ${c.seriesIndex}화` : ''}</Tag>}
          </div>
        </button>
      ))}
    </div>
  );
}

function DetailView({
  detail, directorName, requested, confirming, onRequestWork, onCopy, onConfirm
}: {
  detail: KaltelaDirectorDetailLike;
  directorName?: string;
  requested: boolean;
  confirming: boolean;
  onRequestWork: () => void;
  onCopy: () => void;
  onConfirm: () => void;
}) {
  if (!detail.ok) {
    return <Muted>{detail.error ?? '카드를 불러오지 못했습니다'}</Muted>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, color: 'var(--cth-ink-700)' }}>
        <strong>{detail.cardTitle}</strong>
        {detail.cardUrl && (
          <button
            onClick={() => void window.cth.openExternal(detail.cardUrl!)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--cth-ink-500)', textDecoration: 'underline' }}
          >노션에서 열기</button>
        )}
      </div>

      <div>
        <SectionLabel>최종 대본 표 (원본)</SectionLabel>
        <TableView text={detail.scriptTable ?? ''} />
      </div>

      <div style={{ height: 1, background: 'var(--cth-ink-300)' }} />

      {!detail.directionTable && (
        <div>
          <SectionLabel>연출 표</SectionLabel>
          <Muted>아직 작업 전입니다.</Muted>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <PixelButton size="sm" onClick={onRequestWork} disabled={!directorName}
              title={directorName ? undefined : '연출 담당이 아직 고용되지 않았습니다'}
            >{requested ? '다시 요청' : '연출 작업 요청'}</PixelButton>
            {requested && (
              <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
                {directorName ?? '연출 담당'}에게 전달했습니다 — 작업이 끝나면 아래에 연출 표가 나타납니다.
              </span>
            )}
          </div>
        </div>
      )}

      {detail.directionTable && (
        <div>
          <SectionLabel>연출 표 (화면·연출 칸 강조)</SectionLabel>
          <TableView text={detail.directionTable} highlight />
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-ink-500)' }}>
            화면·연출 외 칸이 바뀌지 않았는지 직접 확인한 뒤 전환해 주세요.
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <PixelButton size="sm" onClick={onCopy}>표 전체 복사</PixelButton>
            <PixelButton size="sm" disabled={confirming} onClick={onConfirm}>
              {confirming ? '전환 중…' : '작화로 전환'}
            </PixelButton>
          </div>
        </div>
      )}
    </div>
  );
}

/** 표 형태로 파싱되면 표로, 안 되면 원문 그대로(pre) 보여준다 — 화면 표시용
 *  best-effort라 실패해도 안전하다(parseMarkdownTable 설명 참고). */
function TableView({ text, highlight }: { text: string; highlight?: boolean }) {
  if (!text.trim()) return <Muted>(비어 있음)</Muted>;
  const parsed = parseMarkdownTable(text);
  if (!parsed) {
    return (
      <pre style={{
        margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--cth-font-mono)', fontSize: 12,
        padding: 8, background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
        boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', maxHeight: 220, overflowY: 'auto'
      }}>{text}</pre>
    );
  }
  const dirCol = highlight ? parsed.headers.findIndex((h) => h.includes('연출')) : -1;
  return (
    <div style={{ overflow: 'auto', maxHeight: 260, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: 'var(--cth-font-mono)' }}>
        <thead>
          <tr>
            {parsed.headers.map((h, i) => (
              <th key={i} style={{
                textAlign: 'left', padding: '4px 6px', whiteSpace: 'nowrap',
                background: i === dirCol ? 'var(--cth-coral)' : 'var(--cth-cream-200)',
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', color: 'var(--cth-ink-900)'
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parsed.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} style={{
                  padding: '4px 6px', whiteSpace: 'pre-wrap', verticalAlign: 'top',
                  background: i === dirCol ? 'var(--cth-coral-light)' : 'var(--cth-paper-100)',
                  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', color: 'var(--cth-ink-900)'
                }}>{cellLines(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--cth-font-display)', fontSize: 9, lineHeight: '12px',
      color: 'var(--cth-ink-500)', marginBottom: 6
    }}>{children}</div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'var(--cth-font-mono)', fontSize: 10, padding: '1px 6px',
      background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', color: 'var(--cth-ink-900)'
    }}>{children}</span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 16, textAlign: 'center', color: 'var(--cth-ink-700)', fontSize: 13, background: 'var(--cth-paper-200)', height: '100%'
    }}>{children}</div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{children}</div>;
}
