import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';

/**
 * PRD.md 「8. 개발 순서」 7번 — 편집장 아침 보고 (4-2 패널, P0-1).
 *
 * src/main/kaltelaMorningReport.ts의 KaltelaMorningReport를 그대로 받아
 * 보여준다. 렌더러는 main 모듈을 import할 수 없어 같은 모양을 여기 다시
 * 선언한다 (OfficeFloor.tsx의 KaltelaOfficeSnapshotLike와 같은 패턴).
 *
 * 노션 연결이 안 돼 있으면(`connected: false`) 그 사실만 보여주고 끝낸다 —
 * 나머지 칸을 지어내지 않는다.
 */
interface KaltelaReportCardLike {
  id: string;
  title: string;
  url: string;
  detail?: string;
}
interface KaltelaMorningReportLike {
  connected: boolean;
  reason?: string;
  todayLabel: string;
  generatedAt: string;
  decisionCount: number;
  noIdeaCards: boolean;
  adDisclosureWarnings: KaltelaReportCardLike[];
  confirmedCards: KaltelaReportCardLike[];
  writingCards: KaltelaReportCardLike[];
  renderingCards: KaltelaReportCardLike[];
  checksToday: KaltelaReportCardLike[];
  checksUpcoming29: KaltelaReportCardLike[];
  overdueWriting: KaltelaReportCardLike[];
  scheduleOk: boolean;
  scheduleNote: string;
}

const POLL_MS = 60_000;

function openCard(card: KaltelaReportCardLike): void {
  if (card.url) void window.cth.openExternal(card.url);
}

function CardRow({ card, accent }: { card: KaltelaReportCardLike; accent?: boolean }) {
  return (
    <button
      onClick={() => openCard(card)}
      disabled={!card.url}
      title={card.url ? '노션에서 열기' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', gap: 1, width: '100%', textAlign: 'left',
        padding: '5px 7px', marginBottom: 4, border: 'none', cursor: card.url ? 'pointer' : 'default',
        background: accent ? 'var(--cth-coral-light)' : 'var(--cth-paper-100)',
        boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
      }}
    >
      <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)' }}>{card.title}</span>
      {card.detail && <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{card.detail}</span>}
    </button>
  );
}

function ReportSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 9, lineHeight: '12px',
        color: 'var(--cth-ink-500)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6
      }}>
        {title}
        {count != null && (
          <span style={{
            fontFamily: 'var(--cth-font-mono)', fontSize: 11, padding: '0 5px',
            background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-700)'
          }}>{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export function MorningReportPanel() {
  const agents = useStore((s) => s.agents);
  const [report, setReport] = useState<KaltelaMorningReportLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const raw = await window.cth.getKaltelaMorningReport({ force });
      setReport(raw as KaltelaMorningReportLike);
    } catch {
      setReport(null);
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

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(''), 2500); };

  const researcher = agents.find((a) => a.character === 'researcher');
  const requestResearch = async () => {
    if (!researcher) { flash('리서처가 아직 고용되지 않았습니다'); return; }
    const res = await window.cth.hiveSend(
      { to: researcher.id, act: 'request', subject: '다음 화 추천 요청', body: '편집장 아침 보고 기준 주 2화 일정이 부족합니다. 다음 화 TOP2를 추천해 주세요.' },
      'human'
    );
    flash(res.ok ? `${researcher.name}에게 요청을 보냈습니다` : `요청 실패: ${res.error ?? '?'}`);
  };

  const runCheck = async () => { setRefreshing(true); await load(true); flash('다시 불러왔습니다'); };

  if (loading) {
    return <Centered>불러오는 중…</Centered>;
  }
  if (!report || !report.connected) {
    return (
      <Centered>
        노션 연결 확인 필요
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-ink-500)' }}>
          {report?.reason || "Settings → Connections에서 'notion' 연결을 켜고, 사무실 설정에서 칼테라 에피소드 보드 DB id를 넣어 주세요."}
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
          {report.todayLabel} 아침 보고
        </span>
        {report.decisionCount > 0 && (
          <span style={{
            fontFamily: 'var(--cth-font-mono)', fontSize: 11, padding: '1px 6px',
            background: 'var(--cth-coral)', color: 'var(--cth-ink-900)',
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-900)'
          }}>대표 결정 필요 {report.decisionCount}</span>
        )}
        {note && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--cth-ink-500)' }}>{note}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, background: 'var(--cth-paper-200)' }}>
        {report.adDisclosureWarnings.length > 0 && (
          <ReportSection title="⚠ 광고 화 발행 전 확인" count={report.adDisclosureWarnings.length}>
            {report.adDisclosureWarnings.map((c) => <CardRow key={c.id} card={c} accent />)}
          </ReportSection>
        )}

        {report.noIdeaCards && (
          <ReportSection title="아이디어 카드">
            <Muted>아이디어 카드가 없음, 메모 먼저 추가</Muted>
          </ReportSection>
        )}

        <ReportSection title="주 2화 일정">
          <Muted>{report.scheduleOk ? '기준 충족 (작화 1편 + 대본확정 1편 이상)' : report.scheduleNote}</Muted>
        </ReportSection>

        {(report.checksToday.length > 0 || report.checksUpcoming29.length > 0) && (
          <ReportSection title="오늘 성과 체크" count={report.checksToday.length}>
            {report.checksToday.map((c) => <CardRow key={`${c.id}-today`} card={c} />)}
            {report.checksUpcoming29.map((c) => <CardRow key={`${c.id}-soon`} card={c} />)}
          </ReportSection>
        )}

        {report.overdueWriting.length > 0 && (
          <ReportSection title="대본작성 지연 (3일 초과)" count={report.overdueWriting.length}>
            {report.overdueWriting.map((c) => <CardRow key={c.id} card={c} accent />)}
          </ReportSection>
        )}

        <ReportSection title="대본확정" count={report.confirmedCards.length}>
          {report.confirmedCards.length === 0 && <Muted>없음</Muted>}
          {report.confirmedCards.map((c) => <CardRow key={c.id} card={c} />)}
        </ReportSection>

        <ReportSection title="대본작성 중 (클로드 채팅)" count={report.writingCards.length}>
          {report.writingCards.length === 0 && <Muted>없음</Muted>}
          {report.writingCards.map((c) => <CardRow key={c.id} card={c} />)}
        </ReportSection>

        <ReportSection title="작화 대기" count={report.renderingCards.length}>
          {report.renderingCards.length === 0 && <Muted>없음</Muted>}
          {report.renderingCards.map((c) => <CardRow key={c.id} card={c} />)}
        </ReportSection>

        <ReportSection title="영업 문의 확인 필요">
          <Muted>지메일 연동 전 (「8. 개발 순서」 11번 예정)</Muted>
        </ReportSection>
      </div>

      <div style={{
        display: 'flex', gap: 6, padding: 8, flexWrap: 'wrap',
        background: 'var(--cth-cream-100)', borderTop: '1px solid var(--cth-ink-700)', flexShrink: 0
      }}>
        <PixelButton
          variant="secondary" size="sm"
          onClick={() => void requestResearch()}
          disabled={!researcher}
          title={researcher ? undefined : '리서처가 아직 고용되지 않았습니다'}
        >리서처에게 추천 요청</PixelButton>
        <PixelButton variant="secondary" size="sm" onClick={() => void runCheck()} disabled={refreshing}>
          {refreshing ? '확인 중…' : '성과 체크 실행'}
        </PixelButton>
        <PixelButton
          variant="secondary" size="sm" disabled
          title="지메일 연동 전 (「8. 개발 순서」 11번 예정)"
        >메일 확인 실행</PixelButton>
      </div>
    </div>
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
