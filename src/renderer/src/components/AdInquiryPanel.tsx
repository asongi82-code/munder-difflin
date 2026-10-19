import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';

/**
 * PRD.md 「8. 개발 순서」 11번 — 영업사원 (P1-2), 4-7 「광고 문의 화면」.
 *
 * src/main/kaltelaSales.ts가 만드는 모양을 그대로 받는다 — 렌더러는 main
 * 모듈을 import할 수 없어 같은 모양을 여기 다시 선언한다(DirectorPanel.tsx와
 * 같은 패턴).
 *
 * 메일 확인, DM이 진짜 광고 문의인지 판단, 문의 카드 생성, 답장 초안 작성은
 * 이 패널이 하지 않는다 — 전부 글 내용을 이해해야 하는 판단이라, 실제
 * 영업사원 하이브 에이전트에게 하이브 메시지로 요청한다. [DM 붙여넣기]는
 * 대표가 붙여넣은 DM 원문을 그대로 영업사원에게 전달할 뿐, 이 패널이 업체·
 * 제품·조건을 뽑아 카드를 만들지 않는다. **보내기 버튼은 어디에도 없다** —
 * PRD·CLAUDE.md 모두 "결정과 발송은 대표가 한다"는 원칙을 지킨다.
 */
interface KaltelaAdInquiryLike {
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
interface KaltelaAdInquiriesLike {
  connected: boolean;
  reason?: string;
  items: KaltelaAdInquiryLike[];
}
interface KaltelaAdInquiryDraftLike {
  ok: boolean;
  error?: string;
  draft: string | null;
}

const POLL_MS = 60_000;
const STATUS_ORDER = ['문의', '조율 중', '확정', '진행 안 함'];

function won(n: number | null): string {
  return n == null ? '' : `${n.toLocaleString('ko-KR')}원`;
}

export function AdInquiryPanel() {
  const agents = useStore((s) => s.agents);
  const sales = agents.find((a) => a.character === 'sales');

  const [list, setList] = useState<KaltelaAdInquiriesLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<KaltelaAdInquiryDraftLike | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [dmText, setDmText] = useState('');
  const [dmSending, setDmSending] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadList = useCallback(async (force = false) => {
    try {
      const raw = await window.cth.getKaltelaAdInquiries({ force });
      setList(raw as KaltelaAdInquiriesLike);
    } catch {
      setList(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDraft = useCallback(async (inquiryId: string) => {
    const raw = await window.cth.getKaltelaAdInquiryDraft(inquiryId);
    setDraft(raw as KaltelaAdInquiryDraftLike);
  }, []);

  useEffect(() => {
    void loadList();
    timer.current = setInterval(() => {
      void loadList();
      if (selectedId) void loadDraft(selectedId);
    }, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [loadList, loadDraft, selectedId]);

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(''), 2500); };

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDraft(null);
    setLoadingDraft(true);
    try {
      await loadDraft(id);
    } finally {
      setLoadingDraft(false);
    }
  };

  const backToList = () => { setSelectedId(null); setDraft(null); void loadList(true); };

  const copyDraft = () => {
    if (draft?.draft) void window.cth.copyToClipboard(draft.draft);
    flash('답장 초안을 복사했습니다');
  };

  const requestDraftCheck = async (inquiry: KaltelaAdInquiryLike) => {
    if (!sales) { flash('영업사원이 아직 고용되지 않았습니다'); return; }
    const res = await window.cth.hiveSend(
      {
        to: sales.id,
        act: 'request',
        subject: `답장 초안 요청 — ${inquiry.company}`,
        body: `문의 ${inquiry.company} (${inquiry.id})의 진행 상태(${inquiry.status ?? '?'})에 맞는 답장 초안을 PRD 2장 P1-2대로 작성해 카드 본문 "답장 초안" 소제목에 저장해 주세요.`
      },
      'human'
    );
    flash(res.ok ? `${sales.name}에게 요청을 보냈습니다` : `요청 실패: ${res.error ?? '?'}`);
  };

  const submitDm = async () => {
    if (!sales) { flash('영업사원이 아직 고용되지 않았습니다'); return; }
    if (!dmText.trim()) return;
    setDmSending(true);
    try {
      const res = await window.cth.hiveSend(
        {
          to: sales.id,
          act: 'request',
          subject: '인스타 DM 광고 문의 확인 요청',
          body: [
            'PRD 2장 P1-2 작동 방식 1대로, 아래 DM이 우리 계정에 광고·협찬을 맡기려는 진짜 문의인지 먼저 판단해 주세요.',
            '일반 홍보·뉴스레터면 건너뛰고, 애매하면 편집장 아침 보고에 "확인 필요"로 올려 주세요.',
            '진짜 문의면 「광고 문의 기록」에 새 카드를 만들고(연락 경로 = DM), 날짜·업체·제품·조건·담당자·연락처를 채워 주세요.',
            '',
            '## DM 원문',
            dmText.trim()
          ].join('\n')
        },
        'human'
      );
      if (!res.ok) { flash(`전달 실패: ${res.error ?? '?'}`); return; }
      setDmText('');
      flash(`${sales.name}에게 전달했습니다`);
    } finally {
      setDmSending(false);
    }
  };

  if (loading) return <Centered>불러오는 중…</Centered>;

  if (!list || !list.connected) {
    return (
      <Centered>
        노션 연결 확인 필요
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-ink-500)' }}>
          {list?.reason || "Settings → Connections에서 'notion' 연결을 켜고, 사무실 설정에서 광고 문의 기록 DB id를 넣어 주세요."}
        </div>
        <div style={{ marginTop: 10 }}>
          <PixelButton variant="secondary" size="sm" onClick={() => void loadList(true)}>다시 확인</PixelButton>
        </div>
      </Centered>
    );
  }

  const selected = selectedId ? list.items.find((i) => i.id === selectedId) ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        background: 'var(--cth-cream-100)', borderBottom: '1px solid var(--cth-ink-700)', flexShrink: 0
      }}>
        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, color: 'var(--cth-ink-900)' }}>
          {selected ? '문의 상세 / 답장 초안' : '광고 문의 기록'}
        </span>
        {!selected && (
          <span style={{
            fontFamily: 'var(--cth-font-mono)', fontSize: 11, padding: '1px 6px',
            background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-700)'
          }}>{list.items.length}</span>
        )}
        {selected && (
          <PixelButton variant="ghost" size="sm" onClick={backToList}>← 목록으로</PixelButton>
        )}
        {note && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--cth-ink-500)' }}>{note}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, background: 'var(--cth-paper-200)' }}>
        {!selected && (
          <>
            <DmPasteBox
              value={dmText} onChange={setDmText} sending={dmSending} disabled={!sales}
              onSubmit={() => void submitDm()}
            />
            <div style={{ height: 12 }} />
            <GroupedList items={list.items} onOpen={(id) => void openDetail(id)} />
          </>
        )}
        {selected && loadingDraft && <Muted>불러오는 중…</Muted>}
        {selected && !loadingDraft && (
          <DetailView
            inquiry={selected}
            draft={draft}
            salesName={sales?.name}
            onCopyDraft={copyDraft}
            onRequestDraft={() => void requestDraftCheck(selected)}
          />
        )}
      </div>
    </div>
  );
}

function DmPasteBox({
  value, onChange, sending, disabled, onSubmit
}: { value: string; onChange: (v: string) => void; sending: boolean; disabled: boolean; onSubmit: () => void }) {
  return (
    <div style={{ padding: 10, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
      <SectionLabel>인스타 DM 붙여넣기</SectionLabel>
      <textarea
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="광고·협찬 문의로 보이는 DM 내용을 그대로 붙여넣어 주세요"
        style={{ ...textareaStyle, height: 70 }}
      />
      <div style={{ marginTop: 6 }}>
        <PixelButton size="sm" disabled={disabled || sending || !value.trim()} onClick={onSubmit}
          title={disabled ? '영업사원이 아직 고용되지 않았습니다' : undefined}
        >{sending ? '전달 중…' : 'DM 붙여넣기'}</PixelButton>
      </div>
    </div>
  );
}

function GroupedList({ items, onOpen }: { items: KaltelaAdInquiryLike[]; onOpen: (id: string) => void }) {
  if (items.length === 0) {
    return <Muted>아직 기록된 광고 문의가 없습니다.</Muted>;
  }
  const groups = STATUS_ORDER.map((status) => ({
    status,
    items: items.filter((i) => i.status === status)
  })).filter((g) => g.items.length > 0);
  const others = items.filter((i) => !STATUS_ORDER.includes(i.status ?? ''));
  if (others.length > 0) groups.push({ status: '(상태 없음)', items: others });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {groups.map((g) => (
        <div key={g.status}>
          <SectionLabel>{g.status} <Tag>{g.items.length}</Tag></SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.items.map((inq) => (
              <button
                key={inq.id}
                onClick={() => onOpen(inq.id)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', width: '100%',
                  padding: 10, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                  border: 'none', cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 11, color: 'var(--cth-ink-900)' }}>{inq.company}</span>
                  {inq.contactChannel && <Tag>{inq.contactChannel}</Tag>}
                  {inq.advertiserDeadline && <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>마감 {inq.advertiserDeadline}</span>}
                </div>
                {inq.product && <div style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{inq.product}</div>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailView({
  inquiry, draft, salesName, onCopyDraft, onRequestDraft
}: {
  inquiry: KaltelaAdInquiryLike;
  draft: KaltelaAdInquiryDraftLike | null;
  salesName?: string;
  onCopyDraft: () => void;
  onRequestDraft: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, color: 'var(--cth-ink-700)' }}>
        <strong style={{ fontFamily: 'var(--cth-font-display)', fontSize: 12 }}>{inquiry.company}</strong>
        {inquiry.status && <Tag accent>{inquiry.status}</Tag>}
        {inquiry.url && (
          <button
            onClick={() => void window.cth.openExternal(inquiry.url)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--cth-ink-500)', textDecoration: 'underline' }}
          >노션에서 열기</button>
        )}
      </div>

      <div>
        <SectionLabel>문의 정보</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 12 }}>
          <Field label="연락 경로" value={inquiry.contactChannel} />
          <Field label="문의일" value={inquiry.inquiryDate} />
          <Field label="광고주 마감" value={inquiry.advertiserDeadline} />
          <Field label="제품" value={inquiry.product} />
          <Field label="담당자" value={inquiry.contactPerson} />
          <Field label="연락처" value={inquiry.contactInfo} />
          <Field label="제안 금액" value={won(inquiry.proposedAmount)} />
          <Field label="확정 금액" value={won(inquiry.confirmedAmount)} />
          <Field label="입금 예정일" value={inquiry.paymentDueDate} />
          <Field label="입금 확인" value={inquiry.paymentConfirmed ? '완료' : null} />
        </div>
        {inquiry.requestedTerms && (
          <div style={{ marginTop: 8 }}>
            <SectionLabel>요청 조건</SectionLabel>
            <div style={{ fontSize: 12, color: 'var(--cth-ink-700)', whiteSpace: 'pre-wrap' }}>{inquiry.requestedTerms}</div>
          </div>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--cth-ink-300)' }} />

      <div>
        <SectionLabel>답장 초안</SectionLabel>
        {!draft?.draft && (
          <>
            <Muted>아직 작성된 답장 초안이 없습니다.</Muted>
            <div style={{ marginTop: 8 }}>
              <PixelButton size="sm" onClick={onRequestDraft} disabled={!salesName}
                title={salesName ? undefined : '영업사원이 아직 고용되지 않았습니다'}
              >답장 초안 요청</PixelButton>
            </div>
          </>
        )}
        {draft?.draft && (
          <>
            <pre style={{
              margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--cth-font-mono)', fontSize: 12,
              padding: 8, background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', maxHeight: 220, overflowY: 'auto'
            }}>{draft.draft}</pre>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <PixelButton size="sm" onClick={onCopyDraft}>초안 복사</PixelButton>
              <PixelButton size="sm" variant="secondary" onClick={onRequestDraft} disabled={!salesName}>다시 요청</PixelButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--cth-ink-500)' }}>{label}</div>
      <div style={{ color: 'var(--cth-ink-900)' }}>{value}</div>
    </div>
  );
}

const textareaStyle = {
  width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--cth-font-mono)', fontSize: 12,
  padding: 8, background: 'var(--cth-cream-100)', color: 'var(--cth-ink-900)',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', border: 'none', resize: 'vertical' as const
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--cth-font-display)', fontSize: 9, lineHeight: '12px',
      color: 'var(--cth-ink-500)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6
    }}>{children}</div>
  );
}

function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span style={{
      fontFamily: 'var(--cth-font-mono)', fontSize: 10, padding: '1px 6px',
      background: accent ? 'var(--cth-coral)' : 'var(--cth-cream-200)',
      boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', color: 'var(--cth-ink-900)'
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
