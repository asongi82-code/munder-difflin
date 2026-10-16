import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';

/**
 * PRD.md 「8. 개발 순서」 8번 — 리서처 → 스토리 작가 (P0-2).
 *
 * 화면 4-3(다음 화 고르기) + 4-4(대본 프롬프트 / 대본 붙여넣기)를 한 패널에서
 * 이어서 보여준다. src/main/kaltelaNextEpisode.ts가 만드는 모양을 그대로
 * 받는다 — 렌더러는 main 모듈을 import할 수 없어 같은 모양을 여기 다시
 * 선언한다(MorningReportPanel.tsx와 같은 패턴).
 *
 * "저장하고 대본확정" 버튼은 이 프로세스가 직접 노션에 쓰지 않는다 — 최종
 * 대본에서 연속성 메모를 뽑고 태그를 다는 일은 글 내용을 이해해야 하는
 * 판단이라, 실제 스토리 작가 하이브 에이전트에게 하이브 메시지로 넘긴다
 * (MorningReportPanel의 "리서처에게 추천 요청"과 같은 패턴). 상태가
 * 대본확정으로 바뀌는 건 그 에이전트가 PRD 2장 작동 방식 ②를 끝낸 뒤다.
 */
interface KaltelaNextPickLike {
  id: string;
  title: string;
  url: string;
  seriesName: string | null;
  seriesIndex: number | null;
  kind: string | null;
  draftReady: boolean;
  researcherMemo: string;
}
interface KaltelaNextPicksLike {
  connected: boolean;
  reason?: string;
  picks: KaltelaNextPickLike[];
}
interface KaltelaSelectResultLike {
  ok: boolean;
  error?: string;
  cardId?: string;
  cardTitle?: string;
  seriesName?: string | null;
  seriesIndex?: number | null;
  isAd?: boolean;
  prompt?: string;
}

const POLL_MS = 60_000;

/** PRD 예외 처리: "붙여넣은 대본에 표가 없으면 저장하지 않고 다시 요청한다."
 *  표 형식 자체의 정확한 파싱(연속성 메모 추출 등)은 스토리 작가 에이전트의
 *  몫이라, 여기서는 "표가 있기는 한지"만 가볍게 확인한다. */
function looksLikeScriptTable(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const pipeCount = t.match(/\|/g)?.length ?? 0;
  const mentionsColumns = /컷|화면|연출|나레이션|대사|효과음/.test(t);
  return pipeCount >= 4 && mentionsColumns;
}

export function NextEpisodePanel() {
  const agents = useStore((s) => s.agents);
  const writer = agents.find((a) => a.character === 'writer');

  const [picksState, setPicksState] = useState<KaltelaNextPicksLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KaltelaSelectResultLike | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [scriptTable, setScriptTable] = useState('');
  const [caption, setCaption] = useState('');
  const [pinnedComment, setPinnedComment] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [handedOff, setHandedOff] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPicks = useCallback(async (force = false) => {
    try {
      const raw = await window.cth.getKaltelaNextPicks({ force });
      setPicksState(raw as KaltelaNextPicksLike);
    } catch {
      setPicksState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPicks();
    timer.current = setInterval(() => void loadPicks(), POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [loadPicks]);

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(''), 2500); };

  const pick = async (pickId: string) => {
    setSelecting(pickId);
    try {
      const res = (await window.cth.selectKaltelaEpisode(pickId)) as KaltelaSelectResultLike;
      if (!res.ok) { flash(`선택 실패: ${res.error ?? '?'}`); return; }
      setSelected(res);
      setScriptTable(''); setCaption(''); setPinnedComment(''); setSubmitError(''); setHandedOff(false);
      void loadPicks(true);
    } finally {
      setSelecting(null);
    }
  };

  const backToList = () => { setSelected(null); void loadPicks(true); };

  const copyPrompt = () => {
    if (selected?.prompt) void window.cth.copyToClipboard(selected.prompt);
    flash('프롬프트를 복사했습니다');
  };

  const submitFinalScript = async () => {
    setSubmitError('');
    if (!looksLikeScriptTable(scriptTable)) {
      setSubmitError('최종 대본 표 형식을 찾지 못했습니다 — 클로드에서 받은 표를 그대로 다시 붙여넣어 주세요');
      return;
    }
    if (!writer) { setSubmitError('스토리 작가가 아직 고용되지 않았습니다'); return; }
    if (!selected?.cardId) { setSubmitError('선택된 카드가 없습니다'); return; }

    const body = [
      `카드: ${selected.cardTitle ?? ''} (${selected.cardId})`,
      '아래 최종 대본 표/캡션/고정 댓글을 PRD 2장 「스토리 작가 ② 최종 대본 정리」대로 카드에 정리해 저장하고, 상태를 대본확정으로 바꿔 주세요.',
      '',
      '## 최종 대본 표',
      scriptTable.trim(),
      '',
      '## 캡션',
      caption.trim() || '(없음)',
      '',
      '## 고정 댓글',
      pinnedComment.trim() || '(없음)'
    ].join('\n');

    const res = await window.cth.hiveSend(
      { to: writer.id, act: 'request', subject: `최종 대본 정리 요청 — ${selected.cardTitle ?? ''}`, body },
      'human'
    );
    if (!res.ok) { setSubmitError(`전달 실패: ${res.error ?? '?'}`); return; }
    setHandedOff(true);
    flash(`${writer.name}에게 전달했습니다`);
  };

  if (loading) return <Centered>불러오는 중…</Centered>;

  if (!picksState || !picksState.connected) {
    return (
      <Centered>
        노션 연결 확인 필요
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-ink-500)' }}>
          {picksState?.reason || "Settings → Connections에서 'notion' 연결을 켜고, 사무실 설정에서 칼테라 에피소드 보드 DB id를 넣어 주세요."}
        </div>
        <div style={{ marginTop: 10 }}>
          <PixelButton variant="secondary" size="sm" onClick={() => void loadPicks(true)}>다시 확인</PixelButton>
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
          {selected ? '대본 프롬프트 / 대본 붙여넣기' : '다음 화 고르기'}
        </span>
        {selected && (
          <PixelButton variant="ghost" size="sm" onClick={backToList}>← 목록으로</PixelButton>
        )}
        {note && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--cth-ink-500)' }}>{note}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, background: 'var(--cth-paper-200)' }}>
        {!selected && <PickList picks={picksState.picks} selecting={selecting} onPick={(id) => void pick(id)} />}
        {selected && (
          <PromptAndPaste
            selected={selected}
            scriptTable={scriptTable} setScriptTable={setScriptTable}
            caption={caption} setCaption={setCaption}
            pinnedComment={pinnedComment} setPinnedComment={setPinnedComment}
            submitError={submitError}
            handedOff={handedOff}
            writerName={writer?.name}
            onCopyPrompt={copyPrompt}
            onSubmit={() => void submitFinalScript()}
          />
        )}
      </div>
    </div>
  );
}

function PickList({
  picks, selecting, onPick
}: { picks: KaltelaNextPickLike[]; selecting: string | null; onPick: (id: string) => void }) {
  if (picks.length === 0) {
    return (
      <Muted>
        리서처가 추천한 "아이디어" 카드가 없습니다 — 아침 보고 패널에서 [리서처에게 추천 요청]을 눌러 주세요.
      </Muted>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {picks.map((p) => (
        <div key={p.id} style={{
          padding: 10, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 11, color: 'var(--cth-ink-900)' }}>{p.title}</span>
            {p.kind && <Tag>{p.kind}</Tag>}
            {p.seriesName && <Tag>{p.seriesName}{p.seriesIndex != null ? ` ${p.seriesIndex}화` : ''}</Tag>}
            {p.draftReady && <Tag accent>빨리 갈 수 있음</Tag>}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--cth-ink-700)', whiteSpace: 'pre-wrap' }}>
            {p.researcherMemo || '(리서처 메모 없음)'}
          </div>
          <div style={{ marginTop: 8 }}>
            <PixelButton size="sm" disabled={selecting === p.id} onClick={() => onPick(p.id)}>
              {selecting === p.id ? '선택 중…' : '이걸로 하기'}
            </PixelButton>
          </div>
        </div>
      ))}
    </div>
  );
}

function PromptAndPaste({
  selected, scriptTable, setScriptTable, caption, setCaption, pinnedComment, setPinnedComment,
  submitError, handedOff, writerName, onCopyPrompt, onSubmit
}: {
  selected: KaltelaSelectResultLike;
  scriptTable: string; setScriptTable: (v: string) => void;
  caption: string; setCaption: (v: string) => void;
  pinnedComment: string; setPinnedComment: (v: string) => void;
  submitError: string;
  handedOff: boolean;
  writerName?: string;
  onCopyPrompt: () => void;
  onSubmit: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>
        <strong>{selected.cardTitle}</strong>
        {selected.seriesName && <span> · {selected.seriesName}{selected.seriesIndex != null ? ` ${selected.seriesIndex}화` : ''}</span>}
        {selected.isAd && <Tag accent>광고 화</Tag>}
      </div>

      <div>
        <SectionLabel>클로드 채팅에 붙여넣을 프롬프트</SectionLabel>
        <textarea
          readOnly value={selected.prompt ?? ''}
          style={{ ...textareaStyle, height: 160, background: 'var(--cth-cream-100)' }}
        />
        <div style={{ marginTop: 6 }}>
          <PixelButton size="sm" onClick={onCopyPrompt}>복사</PixelButton>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--cth-ink-300)' }} />

      <div>
        <SectionLabel>최종 대본 표 붙여넣기</SectionLabel>
        <textarea
          value={scriptTable} onChange={(e) => setScriptTable(e.target.value)}
          placeholder="클로드에서 완성한 최종 대본 표를 그대로 붙여넣어 주세요"
          style={{ ...textareaStyle, height: 140 }}
        />
      </div>
      <div>
        <SectionLabel>캡션</SectionLabel>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} style={{ ...textareaStyle, height: 60 }} />
      </div>
      <div>
        <SectionLabel>고정 댓글</SectionLabel>
        <textarea value={pinnedComment} onChange={(e) => setPinnedComment(e.target.value)} style={{ ...textareaStyle, height: 40 }} />
      </div>

      {submitError && <div style={{ color: 'var(--cth-coral)', fontSize: 12 }}>{submitError}</div>}
      {handedOff && (
        <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
          {writerName ?? '스토리 작가'}에게 전달했습니다 — 정리가 끝나면 카드 상태가 대본확정으로 바뀝니다.
        </div>
      )}

      <div>
        <PixelButton onClick={onSubmit}>저장하고 대본확정</PixelButton>
      </div>
    </div>
  );
}

const textareaStyle = {
  width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--cth-font-mono)', fontSize: 12,
  padding: 8, background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', border: 'none', resize: 'vertical' as const
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--cth-font-display)', fontSize: 9, lineHeight: '12px',
      color: 'var(--cth-ink-500)', marginBottom: 6
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
