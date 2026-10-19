import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelButton } from './PixelButton';
import { KaltelaCardDetailModal } from './KaltelaCardDetailModal';

/**
 * 성과분석도 "카드 전체를 보는 화면"(시시오피스 스타일, BoardPanel 참고)으로
 * 보고 싶다는 PRD 밖 추가 요청 — 팔로워 추이(월별/연별)와 조회수 높은 게시물
 * TOP10을 한 화면에서 보여준다.
 *
 * src/main/kaltelaPerformanceOverview.ts의 KaltelaPerformanceOverview를 그대로
 * 받는다 — 렌더러는 main 모듈을 import할 수 없어 같은 모양을 여기 다시
 * 선언한다(다른 패널들과 같은 패턴). 전부 읽기만 하고 아무것도 쓰지 않는다.
 */
type KaltelaViewsWindowLike = '24시간' | '7일' | '29일';
interface KaltelaFollowerPointLike {
  period: string;
  followerCount: number;
  change: number | null;
}
interface KaltelaTopPostLike {
  id: string;
  title: string;
  url: string;
  instagramUrl: string | null;
  kind: string | null;
  seriesName: string | null;
  publishedDate: string | null;
  views: number;
  viewsWindow: KaltelaViewsWindowLike;
}
interface KaltelaPerformanceOverviewLike {
  connected: boolean;
  reason?: string;
  followerDbMissing: boolean;
  episodeDbMissing: boolean;
  followerMonthly: KaltelaFollowerPointLike[];
  followerYearly: KaltelaFollowerPointLike[];
  topPosts: KaltelaTopPostLike[];
}

const POLL_MS = 60_000;

export function PerformanceOverviewPanel() {
  const [data, setData] = useState<KaltelaPerformanceOverviewLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followerRange, setFollowerRange] = useState<'monthly' | 'yearly'>('monthly');
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const raw = await window.cth.getKaltelaPerformanceOverview({ force });
      setData(raw as KaltelaPerformanceOverviewLike);
    } catch {
      setData(null);
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

  if (!data || !data.connected) {
    return (
      <Centered>
        노션 연결 확인 필요
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-ink-500)' }}>
          {data?.reason || "Settings → Connections에서 'notion' 연결을 켜고, 사무실 설정에서 칼테라 에피소드 보드·인스타 팔로워 기록 DB id를 넣어 주세요."}
        </div>
        <div style={{ marginTop: 10 }}>
          <PixelButton variant="secondary" size="sm" onClick={() => void load(true)}>다시 확인</PixelButton>
        </div>
      </Centered>
    );
  }

  const followerPoints = followerRange === 'monthly' ? data.followerMonthly : data.followerYearly;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        background: 'var(--cth-cream-100)', borderBottom: '1px solid var(--cth-ink-700)', flexShrink: 0
      }}>
        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, color: 'var(--cth-ink-900)' }}>
          성과분석 전체 보기
        </span>
        <PixelButton variant="secondary" size="sm" onClick={() => void refresh()} disabled={refreshing} style={{ marginLeft: 'auto' }}>
          {refreshing ? '확인 중…' : '다시 불러오기'}
        </PixelButton>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, background: 'var(--cth-paper-200)' }}>
        <SectionTitle>팔로워 추이</SectionTitle>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <PixelButton variant={followerRange === 'monthly' ? 'primary' : 'secondary'} size="sm" onClick={() => setFollowerRange('monthly')}>월별</PixelButton>
          <PixelButton variant={followerRange === 'yearly' ? 'primary' : 'secondary'} size="sm" onClick={() => setFollowerRange('yearly')}>연별</PixelButton>
        </div>

        {data.followerDbMissing && <Muted>「인스타 팔로워 기록」 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요.</Muted>}
        {!data.followerDbMissing && followerPoints.length === 0 && <Muted>기록이 없습니다.</Muted>}
        {!data.followerDbMissing && followerPoints.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <FollowerLineChart points={followerPoints} />
          </div>
        )}

        <SectionTitle>조회수 높은 게시물 TOP10</SectionTitle>
        {data.episodeDbMissing && <Muted>「칼테라 에피소드 보드」 DB id가 비어 있음 — 사무실 설정에서 넣어 주세요.</Muted>}
        {!data.episodeDbMissing && data.topPosts.length === 0 && <Muted>발행완료 + 조회수 기록이 있는 게시물이 없습니다.</Muted>}
        {!data.episodeDbMissing && data.topPosts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.topPosts.map((post, i) => (
              <TopPostRow key={post.id} rank={i + 1} post={post} onOpenCard={setOpenCardId} />
            ))}
          </div>
        )}
      </div>

      {openCardId && (
        <KaltelaCardDetailModal cardId={openCardId} onClose={() => setOpenCardId(null)} />
      )}
    </div>
  );
}

/** 팔로워 추이 선 그래프. 단일 시리즈라 범례는 두지 않고(범례는 시리즈
 *  2개부터), 모든 점에 라벨을 달지 않고 첫/끝 값만 직접 라벨로 보여준다 —
 *  나머지 값은 점에 올리면 뜨는 title 툴팁으로 읽는다. 격자선은 수치를
 *  가늠하는 보조선일 뿐이라 잉크색을 가장 옅게 뺐다(recessive). */
function FollowerLineChart({ points }: { points: KaltelaFollowerPointLike[] }) {
  const W = 320;
  const H = 130;
  const padL = 4;
  const padR = 4;
  const padT = 16;
  const padB = 20;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = points.map((p) => p.followerCount);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = maxV - minV;
  const pad = span > 0 ? span * 0.15 : Math.max(1, maxV * 0.1);
  const yMin = Math.max(0, minV - pad);
  const yMax = maxV + pad;
  const yRange = yMax - yMin || 1;

  const x = (i: number) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.followerCount).toFixed(1)}`).join(' ');
  const gridValues = [yMax, (yMax + yMin) / 2, yMin];

  // 축 라벨은 겹치지 않도록 최대 6개 정도만 — 첫/끝은 항상 포함한다.
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  const lastIdx = points.length - 1;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }} role="img" aria-label="팔로워 추이 선 그래프">
      {gridValues.map((gv, i) => (
        <line
          key={i}
          x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)}
          stroke="var(--cth-ink-100)" strokeWidth={1} strokeDasharray="2 3"
        />
      ))}
      <path d={linePath} fill="none" stroke="var(--cth-sky)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => {
        const isFirst = i === 0;
        const isLast = i === lastIdx;
        const showAxisLabel = isFirst || isLast || i % labelStep === 0;
        return (
          <g key={p.period}>
            <circle cx={x(i)} cy={y(p.followerCount)} r={3} fill="var(--cth-sky)" stroke="var(--cth-paper-100)" strokeWidth={1}>
              <title>
                {`${p.period} · ${p.followerCount.toLocaleString()}명${p.change == null ? '' : ` (${p.change >= 0 ? '+' : ''}${p.change.toLocaleString()})`}`}
              </title>
            </circle>
            {(isFirst || isLast) && (
              <text
                x={x(i)} y={y(p.followerCount) - 7}
                textAnchor={isFirst ? 'start' : 'end'}
                fontFamily="var(--cth-font-mono)" fontSize={10} fill="var(--cth-ink-900)"
              >
                {p.followerCount.toLocaleString()}
              </text>
            )}
            {showAxisLabel && (
              <text
                x={x(i)} y={H - 4}
                textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
                fontFamily="var(--cth-font-mono)" fontSize={9} fill="var(--cth-ink-500)"
              >
                {p.period}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function TopPostRow({ rank, post, onOpenCard }: { rank: number; post: KaltelaTopPostLike; onOpenCard: (id: string) => void }) {
  const openInstagram = () => { if (post.instagramUrl) void window.cth.openExternal(post.instagramUrl); };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
      background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
    }}>
      <span style={{ width: 20, flexShrink: 0, fontFamily: 'var(--cth-font-display)', fontSize: 11, color: 'var(--cth-ink-500)', textAlign: 'center' }}>
        {rank}
      </span>
      <button
        onClick={() => onOpenCard(post.id)}
        title="노션 카드 보기"
        style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer'
        }}
      >
        <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', wordBreak: 'break-word' }}>{post.title}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {post.kind && <Tag>{post.kind}</Tag>}
          {post.seriesName && <Tag>{post.seriesName}</Tag>}
          {post.publishedDate && <span style={{ fontSize: 10, color: 'var(--cth-ink-500)' }}>게시 {post.publishedDate}</span>}
        </div>
      </button>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 13, color: 'var(--cth-ink-900)' }}>{post.views.toLocaleString()}</div>
        <div style={{ fontSize: 10, color: 'var(--cth-ink-500)' }}>{post.viewsWindow} 조회수</div>
      </div>
      {post.instagramUrl && (
        <PixelButton variant="secondary" size="sm" onClick={openInstagram} title="인스타그램에서 보기">보기</PixelButton>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, color: 'var(--cth-ink-900)', margin: '4px 0 8px' }}>
      {children}
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
  return <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', marginBottom: 16 }}>{children}</div>;
}
