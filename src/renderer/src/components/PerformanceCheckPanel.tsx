import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';

/**
 * PRD.md 「8. 개발 순서」 9번 — 성과 분석가 (P0-3), 4-6 「성과 입력 화면 (7일
 * 체크용)」.
 *
 * src/main/kaltelaPerformance.ts가 하는 일은 오늘 7일 체크 대상 목록을 읽고,
 * 비팔로워 비율/프로필 방문/(릴스일 때만) 팔로우를 쓰는 것뿐이다(이미 값이
 * 있는 칸은 건너뜀). 댓글 원문 저장·정리와 Metricool 자동 숫자 매칭은 글
 * 내용을 이해해야 하는 판단이거나(댓글 분류) 아직 연결되지 않은 외부
 * 서비스라(Metricool) 이 코드가 지어낼 수 없다 — 저장이 끝나면 실제 성과
 * 분석가 하이브 에이전트에게 하이브 메시지로 넘긴다(NextEpisodePanel의
 * "저장하고 대본확정"과 같은 패턴).
 *
 * 주간 리포트도 화 유형별·CTA 유형별 판단이 필요해 코드가 만들지 않는다 —
 * "오늘이 월요일"이라는 사실만 기계적으로 확인해 알려 주고, 실제 리포트가
 * 지금 필요한지(지난 리포트 후 7일 이상 지났는지)는 에이전트 자신이 노션을
 * 읽어 판단하게 요청한다.
 */
interface KaltelaCheckItemLike {
  id: string;
  title: string;
  url: string;
  format: string | null;
  d7CheckDate: string | null;
  needsNonFollowerRatio: boolean;
  needsProfileVisits: boolean;
  needsReelsFollow: boolean;
}
interface KaltelaChecksLike {
  connected: boolean;
  reason?: string;
  items: KaltelaCheckItemLike[];
}
interface KaltelaCheckSubmitResultLike {
  ok: boolean;
  error?: string;
  cardTitle?: string;
  savedFields: string[];
  skippedFields: string[];
}

const POLL_MS = 60_000;

function isMondayToday(): boolean {
  return new Date().getDay() === 1;
}

export function PerformanceCheckPanel() {
  const agents = useStore((s) => s.agents);
  const analyst = agents.find((a) => a.character === 'analyst');

  const [checks, setChecks] = useState<KaltelaChecksLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [handedOff, setHandedOff] = useState<Record<string, boolean>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const raw = await window.cth.getKaltela7DayChecks({ force });
      setChecks(raw as KaltelaChecksLike);
    } catch {
      setChecks(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = setInterval(() => void load(), POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(''), 3000); };

  const requestWeeklyReport = async () => {
    if (!analyst) { flash('성과 분석가가 아직 고용되지 않았습니다'); return; }
    const res = await window.cth.hiveSend(
      {
        to: analyst.id,
        act: 'request',
        subject: '주간 리포트 요청',
        body: [
          '칼테라 주간 리포트를 요청합니다 (PRD 2장 P0-3 ③).',
          isMondayToday() ? '오늘은 월요일입니다.' : '오늘은 월요일이 아닙니다 — 지난 리포트 후 7일 이상 지났는지 직접 확인해 주세요.',
          '지금이 리포트를 낼 때가 맞는지 판단하고, 맞다면 화 유형별·CTA 유형별 비교와 판단 규칙을 적용해 결론 3줄을 편집장에게 보고하고 「칼테라 주간 리포트」에 쌓아 주세요.'
        ].join('\n')
      },
      'human'
    );
    flash(res.ok ? `${analyst.name}에게 요청을 보냈습니다` : `요청 실패: ${res.error ?? '?'}`);
  };

  if (loading) return <Centered>불러오는 중…</Centered>;

  if (!checks || !checks.connected) {
    return (
      <Centered>
        노션 연결 확인 필요
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-ink-500)' }}>
          {checks?.reason || "Settings → Connections에서 'notion' 연결을 켜고, 사무실 설정에서 칼테라 에피소드 보드 DB id를 넣어 주세요."}
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
          7일 체크 입력
        </span>
        <span style={{
          fontFamily: 'var(--cth-font-mono)', fontSize: 11, padding: '1px 6px',
          background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-700)'
        }}>{checks.items.length}</span>
        {note && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--cth-ink-500)' }}>{note}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, background: 'var(--cth-paper-200)' }}>
        {checks.items.length === 0 && <Muted>오늘 입력할 7일 체크 대상이 없습니다.</Muted>}
        {checks.items.map((item) => (
          <CheckCard
            key={item.id}
            item={item}
            analystId={analyst?.id}
            analystName={analyst?.name}
            handedOff={!!handedOff[item.id]}
            onHandedOff={() => setHandedOff((prev) => ({ ...prev, [item.id]: true }))}
            onSaved={() => void load(true)}
            flash={flash}
          />
        ))}
      </div>

      <div style={{
        display: 'flex', gap: 6, padding: 8, flexWrap: 'wrap', alignItems: 'center',
        background: 'var(--cth-cream-100)', borderTop: '1px solid var(--cth-ink-700)', flexShrink: 0
      }}>
        <PixelButton variant="secondary" size="sm" onClick={() => void requestWeeklyReport()} disabled={!analyst}
          title={analyst ? undefined : '성과 분석가가 아직 고용되지 않았습니다'}
        >주간 리포트 요청</PixelButton>
        {isMondayToday() && <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>오늘은 월요일</span>}
      </div>
    </div>
  );
}

function CheckCard({
  item, analystId, analystName, handedOff, onHandedOff, onSaved, flash
}: {
  item: KaltelaCheckItemLike;
  analystId?: string;
  analystName?: string;
  handedOff: boolean;
  onHandedOff: () => void;
  onSaved: () => void;
  flash: (msg: string) => void;
}) {
  const [nonFollowerRatio, setNonFollowerRatio] = useState('');
  const [profileVisits, setProfileVisits] = useState('');
  const [reelsFollows, setReelsFollows] = useState('');
  const [commentsRaw, setCommentsRaw] = useState('');
  const [saving, setSaving] = useState(false);

  const openCard = () => { if (item.url) void window.cth.openExternal(item.url); };

  const save = async () => {
    setSaving(true);
    try {
      const input = {
        nonFollowerRatio: item.needsNonFollowerRatio && nonFollowerRatio.trim() ? Number(nonFollowerRatio) : undefined,
        profileVisits: item.needsProfileVisits && profileVisits.trim() ? Number(profileVisits) : undefined,
        reelsFollows: item.needsReelsFollow && reelsFollows.trim() ? Number(reelsFollows) : undefined
      };
      const res = (await window.cth.submitKaltela7DayCheck(item.id, input)) as KaltelaCheckSubmitResultLike;
      if (!res.ok) { flash(`저장 실패: ${res.error ?? '?'}`); return; }

      let msg = res.savedFields.length > 0 ? `저장됨: ${res.savedFields.join(', ')}` : '저장할 값 없음';
      if (res.skippedFields.length > 0) msg += ` (이미 값 있어 건너뜀: ${res.skippedFields.join(', ')})`;
      flash(msg);

      if (analystId && commentsRaw.trim()) {
        const body = [
          `카드: ${item.title} (${item.url || item.id})`,
          'PRD 2장 P0-3 작동 방식 ①·②대로 이 화의 Metricool 자동 숫자(조회수·도달·좋아요·댓글·저장·공유·팔로우·릴스 지표)를 매칭해 아직 비어 있는 칸만 채우고,',
          '아래 댓글 원문을 카드 본문 "성과·댓글 요약" 섹션에 저장한 뒤 분류·정리해 주세요. 정리 후 원문은 지우고 요약만 남겨 주세요.',
          '',
          `(오피스 앱이 이미 저장함: ${res.savedFields.join(', ') || '없음'}${res.skippedFields.length ? ` / 이미 값 있어 건너뜀: ${res.skippedFields.join(', ')}` : ''})`,
          '',
          '## 댓글 원문',
          commentsRaw.trim()
        ].join('\n');
        const hiveRes = await window.cth.hiveSend(
          { to: analystId, act: 'request', subject: `7일 체크 정리 요청 — ${item.title}`, body },
          'human'
        );
        if (hiveRes.ok) { onHandedOff(); flash(`${analystName ?? '성과 분석가'}에게 전달했습니다`); }
        else flash(`전달 실패: ${hiveRes.error ?? '?'}`);
      }

      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      padding: 10, marginBottom: 10, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
    }}>
      <button
        onClick={openCard} disabled={!item.url} title={item.url ? '노션에서 열기' : undefined}
        style={{
          display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', background: 'none', border: 'none',
          padding: 0, cursor: item.url ? 'pointer' : 'default', textAlign: 'left'
        }}
      >
        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 11, color: 'var(--cth-ink-900)' }}>{item.title}</span>
        {item.format && <Tag>{item.format}</Tag>}
        {item.d7CheckDate && <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>7일 체크 {item.d7CheckDate}</span>}
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
        {item.needsNonFollowerRatio && (
          <Field label="비팔로워 비율 (%)" value={nonFollowerRatio} onChange={setNonFollowerRatio} />
        )}
        {item.needsProfileVisits && (
          <Field label="프로필 방문" value={profileVisits} onChange={setProfileVisits} />
        )}
        {item.needsReelsFollow && (
          <Field label="릴스 팔로우" value={reelsFollows} onChange={setReelsFollows} />
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 11, color: 'var(--cth-ink-500)', marginBottom: 3, display: 'block' }}>댓글 원문</label>
        <textarea
          value={commentsRaw} onChange={(e) => setCommentsRaw(e.target.value)}
          placeholder="답글까지 펼쳐 전체 복사한 댓글을 그대로 붙여넣어 주세요"
          style={{
            width: '100%', boxSizing: 'border-box', fontFamily: 'var(--cth-font-mono)', fontSize: 12, height: 70,
            padding: 8, background: 'var(--cth-cream-100)', color: 'var(--cth-ink-900)',
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', border: 'none', resize: 'vertical'
          }}
        />
      </div>

      {handedOff && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--cth-ink-500)' }}>
          {analystName ?? '성과 분석가'}에게 전달했습니다 — 정리가 끝나면 댓글 원문이 요약으로 바뀝니다.
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <PixelButton size="sm" disabled={saving} onClick={() => void save()}>{saving ? '저장 중…' : '저장'}</PixelButton>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--cth-ink-500)', marginBottom: 3, display: 'block' }}>{label}</label>
      <input
        type="number" value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 8px', background: 'var(--cth-paper-100)',
          border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', fontFamily: 'var(--cth-font-ui)',
          fontSize: 13, color: 'var(--cth-ink-900)', outline: 'none'
        }}
      />
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
