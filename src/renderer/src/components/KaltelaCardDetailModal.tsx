import { useEffect, useState } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';

/**
 * PRD.md 「0. 문서 정보」가 12번(마무리 점검) 전에 추가로 계획해 둔 "카드
 * 전체를 보는 화면"(시시오피스 스타일)의 카드 상세 — 어느 패널에서 카드를
 * 클릭해도(아침 보고·보드 화면 모두) 노션 브라우저로 나가지 않고 이 모달이
 * 속성·본문 섹션을 그대로 보여준다.
 *
 * src/main/kaltelaBoard.ts의 KaltelaCardDetail을 그대로 받는다 — 렌더러는
 * main 모듈을 import할 수 없어 같은 모양을 여기 다시 선언한다(DirectorPanel
 * 등과 같은 패턴). 읽기만 하고 아무것도 쓰지 않는다.
 */
interface KaltelaCardDetailLike {
  ok: boolean;
  error?: string;
  title?: string;
  url?: string;
  properties?: Array<{ name: string; value: string }>;
  sections?: Array<{ heading: string; text: string }>;
}

export function KaltelaCardDetailModal({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<KaltelaCardDetailLike | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setLoading(true);
    window.cth.getKaltelaCardDetail(cardId)
      .then((raw) => { if (alive) setDetail(raw as KaltelaCardDetailLike); })
      .catch(() => { if (alive) setDetail({ ok: false, error: '카드를 불러오지 못했습니다' }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cardId]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(26, 19, 32, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 500
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: '92vw' }}>
        <PixelPanel variant="dialog" title={detail?.ok ? (detail.title ?? '카드') : '카드'} style={{ padding: 0 }} noPadding>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, maxHeight: '80vh', overflowY: 'auto' }}>
            {loading && <Muted>불러오는 중…</Muted>}
            {!loading && detail && !detail.ok && <Muted>{detail.error ?? '카드를 불러오지 못했습니다'}</Muted>}
            {!loading && detail?.ok && (
              <>
                {detail.properties && detail.properties.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {detail.properties.map((p) => (
                      <div key={p.name} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                        <span style={{ width: 110, flexShrink: 0, color: 'var(--cth-ink-500)' }}>{p.name}</span>
                        <span style={{ color: 'var(--cth-ink-900)', wordBreak: 'break-word' }}>{p.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                {detail.sections && detail.sections.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {detail.sections.map((s, i) => (
                      <div key={`${s.heading}-${i}`}>
                        <SectionLabel>{s.heading}</SectionLabel>
                        {s.text.trim() ? (
                          <pre style={{
                            margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--cth-font-mono)', fontSize: 12,
                            padding: 8, background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
                            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
                          }}>{s.text}</pre>
                        ) : <Muted>(비어 있음)</Muted>}
                      </div>
                    ))}
                  </div>
                )}

                {(!detail.sections || detail.sections.length === 0) && (!detail.properties || detail.properties.length === 0) && (
                  <Muted>이 카드엔 아직 속성·본문이 없습니다.</Muted>
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              {detail?.url ? (
                <button
                  onClick={() => void window.cth.openExternal(detail.url!)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--cth-ink-500)', textDecoration: 'underline' }}
                >노션에서 열기</button>
              ) : <span />}
              <PixelButton variant="secondary" size="sm" onClick={onClose}>닫기</PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
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

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{children}</div>;
}
