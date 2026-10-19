import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { HarnessConfig } from '@/store/config';

const DEFAULT_DESK_NAMES = {
  editor: '편집장', researcher: '리서처', writer: '스토리 작가',
  analyst: '성과 분석가', sales: '영업사원', director: '연출 담당'
};
const DESK_ORDER: Array<keyof typeof DEFAULT_DESK_NAMES> = ['editor', 'researcher', 'writer', 'analyst', 'sales', 'director'];
const DEFAULT_STAGE_NAMES = ['리서치', '대본작성', '대본최종', '연출', '성과분석', '영업관리'];

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px 4px',
  background: 'var(--cth-paper-100)',
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 13,
  color: 'var(--cth-ink-900)',
  outline: 'none'
};
const labelStyle: CSSProperties = {
  fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-500)', marginBottom: 3, display: 'block'
};
const headStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 6
};

/** Settings panel for PRD.md 「8. 개발 순서」 6번 — the kaltela office's own
 *  on-screen text: the 6 desk nameplates, the 6 checklist stage names, and
 *  the two notion database ids the checklist/monitor/board read from. The
 *  notion TOKEN itself is not here — it lives in Settings → Connections'
 *  'notion' integration (IntegrationsRegistry), unchanged by this panel. */
export function KaltelaOfficeSettings({ config }: { config: HarnessConfig }) {
  const [deskNames, setDeskNames] = useState({ ...DEFAULT_DESK_NAMES, ...(config.kaltelaDeskNames ?? {}) });
  const [stageNames, setStageNames] = useState(
    config.kaltelaStageNames?.length === 6 ? config.kaltelaStageNames : DEFAULT_STAGE_NAMES
  );
  const [episodeBoardId, setEpisodeBoardId] = useState(config.kaltelaNotionEpisodeBoardId ?? '');
  const [followerDbId, setFollowerDbId] = useState(config.kaltelaNotionFollowerDbId ?? '');
  const [adInquiryDbId, setAdInquiryDbId] = useState(config.kaltelaNotionAdInquiryDbId ?? '');
  const [note, setNote] = useState('');

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(''), 1800); };

  const saveDeskName = async (key: keyof typeof DEFAULT_DESK_NAMES, value: string) => {
    const next = { ...deskNames, [key]: value };
    setDeskNames(next);
    try { await window.cth.updateConfig({ kaltelaDeskNames: next }); flash('저장됨'); }
    catch { flash('저장 실패'); }
  };
  const saveStageName = async (idx: number, value: string) => {
    const next = [...stageNames]; next[idx] = value;
    setStageNames(next);
    try { await window.cth.updateConfig({ kaltelaStageNames: next }); flash('저장됨'); }
    catch { flash('저장 실패'); }
  };
  const saveDbId = async (field: 'kaltelaNotionEpisodeBoardId' | 'kaltelaNotionFollowerDbId' | 'kaltelaNotionAdInquiryDbId', value: string) => {
    try { await window.cth.updateConfig({ [field]: value.trim() || undefined }); flash('저장됨'); }
    catch { flash('저장 실패'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={headStyle}>칼테라 오피스 글씨</div>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
          책상 이름표와 편집장실 체크리스트 단계 이름. 배경 그림은 그대로 두고 앱이 그 위에 그린다.
        </span>
      </div>

      <div>
        <div style={{ ...labelStyle, marginBottom: 6 }}>책상 이름표</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {DESK_ORDER.map((key) => (
            <div key={key}>
              <label style={labelStyle}>{DEFAULT_DESK_NAMES[key]}</label>
              <input
                style={inputStyle}
                value={deskNames[key] ?? ''}
                placeholder={DEFAULT_DESK_NAMES[key]}
                onChange={(e) => setDeskNames({ ...deskNames, [key]: e.target.value })}
                onBlur={(e) => { void saveDeskName(key, e.target.value); }}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ ...labelStyle, marginBottom: 6 }}>체크리스트 단계 (순서대로 6개)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {stageNames.map((name, i) => (
            <div key={i}>
              <label style={labelStyle}>{i + 1}. {DEFAULT_STAGE_NAMES[i]}</label>
              <input
                style={inputStyle}
                value={name}
                placeholder={DEFAULT_STAGE_NAMES[i]}
                onChange={(e) => { const next = [...stageNames]; next[i] = e.target.value; setStageNames(next); }}
                onBlur={(e) => { void saveStageName(i, e.target.value); }}
              />
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--cth-ink-300)' }} />

      <div>
        <div style={headStyle}>노션 데이터 연결</div>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
          체크리스트 현재 단계·오른쪽 보드의 이번 주 연재는 「칼테라 에피소드 보드」에서, 대표 모니터의 팔로워 수는 「인스타 팔로워 기록」에서 읽는다.
          토큰은 여기 없다 — Settings → Connections에서 'notion' 연결을 켜고 토큰을 넣어야 값이 채워진다. 연결이 없거나 DB id가 비어 있으면 '—'로 표시된다.
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>칼테라 에피소드 보드 DB id</label>
            <input
              style={inputStyle}
              value={episodeBoardId}
              placeholder="노션 DB URL의 32자리 id"
              onChange={(e) => setEpisodeBoardId(e.target.value)}
              onBlur={(e) => { void saveDbId('kaltelaNotionEpisodeBoardId', e.target.value); }}
            />
          </div>
          <div>
            <label style={labelStyle}>인스타 팔로워 기록 DB id</label>
            <input
              style={inputStyle}
              value={followerDbId}
              placeholder="노션 DB URL의 32자리 id"
              onChange={(e) => setFollowerDbId(e.target.value)}
              onBlur={(e) => { void saveDbId('kaltelaNotionFollowerDbId', e.target.value); }}
            />
          </div>
          <div>
            <label style={labelStyle}>광고 문의 기록 DB id</label>
            <input
              style={inputStyle}
              value={adInquiryDbId}
              placeholder="노션 DB URL의 32자리 id"
              onChange={(e) => setAdInquiryDbId(e.target.value)}
              onBlur={(e) => { void saveDbId('kaltelaNotionAdInquiryDbId', e.target.value); }}
            />
          </div>
        </div>
      </div>

      {note && <span style={{ fontSize: 12, color: 'var(--cth-mint)' }}>{note}</span>}
    </div>
  );
}
