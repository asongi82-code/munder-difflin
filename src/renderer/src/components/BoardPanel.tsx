import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelButton } from './PixelButton';
import { KaltelaCardDetailModal } from './KaltelaCardDetailModal';

/**
 * PRD.md 「0. 문서 정보」가 12번(마무리 점검) 전에 추가로 계획해 둔 "카드
 * 전체를 보는 화면"(시시오피스 스타일) — 「칼테라 에피소드 보드」 전체를
 * 상태별 칼럼으로 한 화면에서 보여준다. 카드를 클릭해도 노션 브라우저로
 * 나가지 않고 KaltelaCardDetailModal이 속성·본문을 그대로 보여준다.
 *
 * src/main/kaltelaBoard.ts의 KaltelaBoardOverview를 그대로 받는다 — 렌더러는
 * main 모듈을 import할 수 없어 같은 모양을 여기 다시 선언한다(다른 패널들과
 * 같은 패턴).
 */
interface KaltelaBoardCardLike {
  id: string;
  title: string;
  url: string;
  kind: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  dueDate: string | null;
  publishedDate: string | null;
}
interface KaltelaBoardColumnLike {
  status: string;
  cards: KaltelaBoardCardLike[];
}
interface KaltelaBoardOverviewLike {
  connected: boolean;
  reason?: string;
  columns: KaltelaBoardColumnLike[];
  totalCount: number;
}

const POLL_MS = 60_000;

export function BoardPanel() {
  const [board, setBoard] = useState<KaltelaBoardOverviewLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const raw = await window.cth.getKaltelaBoardOverview({ force });
      setBoard(raw as KaltelaBoardOverviewLike);
    } catch {
      setBoard(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = setInterval(() => void load(), POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const refresh = async () => { setRefreshing(true); await load(true); };

  if (loading) return <Centered>불러오는 중…</Centered>;

  if (!board || !board.connected) {
    return (
      <Centered>
        노션 연결 확인 필요
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-ink-500)' }}>
          {board?.reason || "Settings → Connections에서 'notion' 연결을 켜고, 사무실 설정에서 칼테라 에피소드 보드 DB id를 넣어 주세요."}
        </div>
        <div style={{ marginTop: 10 }}>
          <PixelButton variant="secondary" size="sm" onClick={() => void load(true)}>다시 확인</PixelButton>
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
          전체 카드 보기
        </span>
        <span style={{
          fontFamily: 'var(--cth-font-mono)', fontSize: 11, padding: '1px 6px',
          background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-700)'
        }}>{board.totalCount}</span>
        <PixelButton variant="secondary" size="sm" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? '확인 중…' : '다시 불러오기'}
        </PixelButton>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10, background: 'var(--cth-paper-200)' }}>
        <div style={{ display: 'flex', gap: 10, height: '100%', alignItems: 'flex-start' }}>
          {board.columns.map((col) => (
            <BoardColumn key={col.status} column={col} onOpen={setOpenCardId} />
          ))}
        </div>
      </div>

      {openCardId && (
        <KaltelaCardDetailModal cardId={openCardId} onClose={() => setOpenCardId(null)} />
      )}
    </div>
  );
}

function BoardColumn({ column, onOpen }: { column: KaltelaBoardColumnLike; onOpen: (id: string) => void }) {
  return (
    <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-900)' }}>{column.status}</span>
        <span style={{
          fontFamily: 'var(--cth-font-mono)', fontSize: 10, padding: '0 5px',
          background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-700)'
        }}>{column.cards.length}</span>
      </div>
      {column.cards.length === 0 && <Muted>없음</Muted>}
      {column.cards.map((c) => (
        <button
          key={c.id}
          onClick={() => onOpen(c.id)}
          style={{
            display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left', width: '100%',
            padding: '6px 8px', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
            border: 'none', cursor: 'pointer'
          }}
        >
          <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', wordBreak: 'break-word' }}>{c.title}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {c.kind && <Tag>{c.kind}</Tag>}
            {c.seriesName && <Tag>{c.seriesName}{c.seriesIndex != null ? ` ${c.seriesIndex}화` : ''}</Tag>}
          </div>
          {(c.dueDate || c.publishedDate) && (
            <span style={{ fontSize: 10, color: 'var(--cth-ink-500)' }}>
              {c.publishedDate ? `게시 ${c.publishedDate}` : `예정 ${c.dueDate}`}
            </span>
          )}
        </button>
      ))}
    </div>
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
