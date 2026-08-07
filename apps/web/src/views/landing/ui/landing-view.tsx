import { AuthStartActions } from '@/features/auth-start/ui/auth-start-actions';
import { AppFrame } from '@/shared/ui/app-frame';

/**
 * @MX:ANCHOR: 랜딩 "광안리의 하루" — SPEC-WEB-VISUAL-REDESIGN-001 M3 정본 구현.
 * 목업(docs/design-system/mockups/tripick-landing-mockup.html)의 hero 인라인 SVG ·
 * 4단계 플로우 · 미리 보는 결과 · 마무리 섹션 구조를 그대로 옮기되, CTA 는 실제
 * 인증 플로우(AuthStartActions — 이메일/카카오)로 화해(reconcile)한다.
 * @MX:REASON: fan_in — app/page.tsx 진입점이자 비로그인 사용자의 첫 화면.
 */
const STEPS = [
  {
    title: '좋아하는 사진 고르기',
    description: '바다였는지 골목이었는지, 사진이 당신의 취향을 대신 말해줘요.',
    warm: false,
  },
  {
    title: '여행 조건 알려주기',
    description: '어디로, 며칠 동안, 어떤 리듬으로 다닐지 — 가벼운 질문 몇 개면 충분해요.',
    warm: false,
  },
  {
    title: '완성된 일정 받아보기',
    description: '동선과 시간까지 계산된 하루하루가 카드로 정리돼요.',
    warm: false,
  },
  {
    title: '마음 바뀌면 다시 짜기',
    description: '비가 와도, 줄이 길어도 괜찮아요. 언제든 다시 부탁하면 그 자리에서 고쳐 드려요.',
    warm: true,
  },
] as const;

const PREVIEW_TIMELINE = [
  {
    time: '10:00',
    dot: '--t-morning',
    title: '광안리 해변 산책',
    desc: '아침 바다를 따라 느리게 시작하는 하루',
  },
  {
    time: '12:30',
    dot: '--t-noon',
    title: '로컬 밥집에서 점심',
    desc: '사진 속 한식 취향을 그대로 담았어요',
  },
  {
    time: '15:00',
    dot: '--t-gold',
    title: '바다가 보이는 카페',
    desc: '커피 한 잔만큼의 쉼표',
  },
  {
    time: '19:00',
    dot: '--t-dusk',
    title: '광안대교 야경과 저녁',
    desc: '다리에 불이 켜지면 오늘의 하이라이트',
  },
] as const;

const PREVIEW_TAGS = ['대중교통 동선', '걷기 적당히', '웨이팅 길면 대안 추천'] as const;

export function LandingView() {
  return (
    <AppFrame showNav={false}>
      <div className="wvr-scope min-h-dvh px-5 pb-16 pt-4 lg:px-10">
        <div className="mx-auto w-full max-w-[500px] lg:max-w-[560px]">
          {/* ===== 헤더 ===== */}
          <header className="flex items-center justify-between py-3.5">
            <span className="inline-flex items-baseline gap-0.5 text-[19px] font-extrabold tracking-[-0.02em] text-[color:var(--ink)]">
              트리픽
              <span
                aria-hidden="true"
                className="size-[7px] -translate-y-px rounded-full"
                style={{ background: 'var(--accent)' }}
              />
              <small className="ml-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-[color:var(--ink-faint)]">
                TRIPICK
              </small>
            </span>
            <span className="whitespace-nowrap rounded-full bg-[color:var(--primary-tint)] px-[11px] py-1.5 text-[12px] font-bold text-[color:var(--primary)]">
              가입 무료
            </span>
          </header>

          {/* ===== 히어로 ===== */}
          <section className="pt-6 lg:pt-10">
            <p className="wvr-rise wvr-rise-1 mb-2.5 text-[13px] font-bold tracking-[0.01em] text-[color:var(--primary)]">
              취향으로 골라주는 AI 여행 플래너
            </p>
            <h1 className="wvr-rise wvr-rise-2 text-balance text-[clamp(29px,8vw,38px)] font-extrabold leading-[1.3] tracking-[-0.035em] text-[color:var(--ink)] lg:text-[42px]">
              당신의 사진첩은 이미
              <br />
              <span
                style={{
                  backgroundImage:
                    'linear-gradient(transparent 60%, var(--hl) 60%, var(--hl) 92%, transparent 92%)',
                }}
              >
                다음 여행
              </span>
              을 알고 있어요
            </h1>
            <p className="wvr-rise wvr-rise-3 mt-3.5 max-w-[42ch] text-[16px] leading-[1.68] text-[color:var(--ink-sub)]">
              오래 들여다본 바다, 저장만 해 둔 골목길. 좋아하는 사진 몇 장을 고르면 트리픽이 그
              취향 그대로 국내 여행 일정을 만들어 드려요.
            </p>

            {/* 광안리의 저녁 — 인라인 SVG 장면 (REQ-WVR-010, 래스터 이미지 아님) */}
            <div className="wvr-rise wvr-rise-4 relative mt-6 overflow-hidden rounded-[26px] border border-[color:var(--line)] leading-none shadow-[var(--shadow-card)]">
              <GwangalliDuskScene />
              <span
                className="absolute bottom-3.5 left-3.5 inline-flex items-center gap-[7px] rounded-full py-[7px] pl-2.5 pr-[13px] text-[12.5px] font-bold leading-[1.2] tracking-[-0.01em] text-[color:var(--ink)]"
                style={{ background: 'var(--glass)' }}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
                부산 광안리 · 저녁 7시
              </span>
            </div>

            <div className="wvr-rise wvr-rise-5">
              <div className="mt-5">
                <AuthStartActions />
              </div>
              <p className="mt-3 text-center text-[13px] text-[color:var(--ink-faint)]">
                가입 무료 · 3분이면 충분해요
              </p>
            </div>
          </section>

          {/* ===== 4단계 플로우 ===== */}
          <section className="mt-[72px] lg:mt-[88px]">
            <p className="mb-2 text-[13px] font-bold text-[color:var(--primary)]">이렇게 진행돼요</p>
            <h2 className="text-balance text-[24px] font-extrabold leading-[1.4] tracking-[-0.03em] text-[color:var(--ink)]">
              사진 고르기부터 완성까지,
              <br />
              네 걸음이면 돼요
            </h2>

            <div className="relative mt-[30px] flex flex-col gap-[30px]">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-[30px] left-[23px] top-[50px] border-l-2 border-dotted"
                style={{ borderColor: 'var(--line-dot)' }}
              />
              {STEPS.map((step, index) => (
                <div key={step.title} className="relative grid grid-cols-[46px_1fr] items-start gap-4">
                  <span
                    className="relative flex size-[46px] items-center justify-center rounded-[16px] border"
                    style={{
                      background: step.warm ? 'var(--accent-tint)' : 'var(--primary-tint)',
                      color: step.warm ? 'var(--accent-deep)' : 'var(--primary)',
                      borderColor: 'var(--line)',
                    }}
                  >
                    <StepIcon index={index} />
                  </span>
                  <div>
                    <h3 className="mb-1 mt-0.5 text-[17px] font-bold tracking-[-0.02em] text-[color:var(--ink)]">
                      {step.title}
                    </h3>
                    <p className="text-[15px] leading-[1.62] text-[color:var(--ink-sub)]">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ===== 일정 미리보기 ===== */}
          <section className="mt-[72px] lg:mt-[88px]">
            <p className="mb-2 text-[13px] font-bold text-[color:var(--primary)]">미리 보는 결과</p>
            <h2 className="text-[24px] font-extrabold leading-[1.4] tracking-[-0.03em] text-[color:var(--ink)]">
              예를 들면, 이런 하루가 나와요
            </h2>
            <p className="mt-2.5 text-[15px] leading-[1.65] text-[color:var(--ink-sub)]">
              바다 사진을 오래 보고, 한식을 즐겨 찍는 취향이라면 —
            </p>

            <article className="mt-[26px] rounded-[22px] border border-[color:var(--line)] bg-[color:var(--card)] px-5 pb-5 pt-[22px] shadow-[var(--shadow-card)]">
              <span className="inline-block rounded-[8px] bg-[color:var(--primary-tint)] px-[9px] py-1 font-mono text-[11px] font-bold text-[color:var(--primary)]">
                DAY 1
              </span>
              <h3 className="mt-0.5 text-[20px] font-extrabold tracking-[-0.025em] text-[color:var(--ink)]">
                부산 감도 코스
              </h3>
              <p className="text-[14px] text-[color:var(--ink-sub)]">광안리 산책부터 저녁 식사까지</p>

              {/* 하루의 빛 타임라인 (시그니처 4-stop 그라데이션 — REQ-WVR-041 과 동일 시각 언어) */}
              <ol className="relative mt-[22px] flex flex-col gap-[22px]">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-2 left-[60px] top-2 w-[3px] rounded-full"
                  style={{
                    background:
                      'linear-gradient(180deg, var(--t-morning) 0%, var(--t-noon) 36%, var(--t-gold) 70%, var(--t-dusk) 100%)',
                  }}
                />
                {PREVIEW_TIMELINE.map((item) => (
                  <li key={item.time} className="relative grid grid-cols-[44px_32px_1fr] items-start">
                    <span className="pt-0.5 font-mono text-[13px] font-semibold text-[color:var(--ink-faint)]">
                      {item.time}
                    </span>
                    <span
                      aria-hidden="true"
                      className="relative mt-1 size-[13px] justify-self-center rounded-full border-[3px]"
                      style={{
                        background: `var(${item.dot})`,
                        borderColor: 'var(--card)',
                        boxShadow: '0 0 0 1px var(--line)',
                      }}
                    />
                    <div>
                      <strong className="block text-[16px] font-bold tracking-[-0.02em] text-[color:var(--ink)]">
                        {item.title}
                      </strong>
                      <p className="mt-0.5 text-[14px] leading-[1.55] text-[color:var(--ink-sub)]">
                        {item.desc}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-[22px] flex flex-wrap gap-2">
                {PREVIEW_TAGS.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[color:var(--line)] bg-[color:var(--card-soft)] px-[11px] py-1.5 text-[12.5px] font-semibold text-[color:var(--ink-sub)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <p
                className="mt-[18px] flex items-start gap-[9px] border-t border-dashed pt-4 text-[13.5px] leading-[1.55] text-[color:var(--ink-sub)]"
                style={{ borderColor: 'var(--line)' }}
              >
                <ReplanHintIcon />
                저녁 자리가 아쉬우면 그 한 곳만 골라서 다시 추천받을 수 있어요.
              </p>
            </article>
          </section>

          {/* ===== 마무리 ===== */}
          <section
            className="mt-[72px] rounded-[26px] px-6 py-[30px] lg:mt-[88px] lg:px-8 lg:py-9"
            style={{ background: 'var(--primary-tint)' }}
          >
            <h2 className="text-balance text-[24px] font-extrabold leading-[1.38] tracking-[-0.03em] text-[color:var(--ink)]">
              다음 여행은,
              <br />
              취향에서 시작해 보세요
            </h2>
            <p className="mt-3 text-[15px] leading-[1.65] text-[color:var(--ink-sub)]">
              검색창에 &lsquo;부산 가볼 만한 곳&rsquo;을 열 번 치는 대신 좋아하는 사진 몇 장을 골라
              주세요. 나머지는 트리픽이 정리할게요.
            </p>
            <div className="mt-[22px]">
              <AuthStartActions />
            </div>
          </section>

          {/* ===== 푸터 ===== */}
          <footer
            className="mt-16 border-t pb-11 pt-7 text-center text-[12.5px] text-[color:var(--ink-faint)]"
            style={{ borderColor: 'var(--line)' }}
          >
            트리픽 TriPick — 취향으로 골라주는 국내 여행 AI 플래너
          </footer>
        </div>
      </div>
    </AppFrame>
  );
}

/**
 * 해 질 무렵 광안리 바다와 광안대교 인라인 SVG. 목업 정본(viewBox 0 0 390 232)을
 * 그대로 옮기되 hex 를 전부 wvr-scope CSS 변수 참조로 대체했다(REQ-WVR-010, 하드코딩
 * hex 0개). 다크 모드에서는 별(--star)이 자동으로 나타난다.
 */
function GwangalliDuskScene() {
  return (
    <svg
      viewBox="0 0 390 232"
      role="img"
      aria-label="해 질 무렵 광안리 바다와 광안대교 일러스트"
      className="wvr-sun-halo block h-auto w-full"
    >
      <defs>
        <linearGradient id="wvr-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sky-top)" />
          <stop offset="1" stopColor="var(--sky-glow)" />
        </linearGradient>
        <radialGradient id="wvr-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--sun-halo)" />
          <stop offset="1" stopColor="var(--sun-halo)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 하늘 */}
      <rect x="0" y="0" width="390" height="152" fill="url(#wvr-sky)" />

      {/* 별 (다크 테마에서만 보임) */}
      <g fill="var(--star)">
        <circle cx="46" cy="30" r="1.3" />
        <circle cx="112" cy="18" r="1" />
        <circle cx="180" cy="40" r="1.2" />
        <circle cx="330" cy="24" r="1.1" />
        <circle cx="358" cy="58" r="1" />
      </g>

      {/* 해 */}
      <circle cx="288" cy="104" r="52" fill="url(#wvr-halo)" />
      <circle cx="288" cy="104" r="22" fill="var(--sun)" />

      {/* 갈매기 */}
      <g
        className="wvr-gulls"
        fill="none"
        stroke="var(--sil)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity=".75"
      >
        <path d="M58 56 q7 -7 14 0 q7 -7 14 0" />
        <path d="M96 42 q5 -5 10 0 q5 -5 10 0" />
      </g>

      {/* 먼 산 (황령산 자락) */}
      <path
        d="M0 152 L0 132 Q34 112 72 128 Q104 141 138 148 L150 152 Z"
        fill="var(--sil)"
        opacity=".24"
      />

      {/* 바다 */}
      <rect x="0" y="150" width="390" height="82" fill="var(--sea-1)" />
      <path
        d="M0 174 Q40 167 80 174 T160 174 T240 174 T320 174 T400 174 L400 232 L0 232 Z"
        fill="var(--sea-2)"
      />
      <path
        d="M0 200 Q45 193 90 200 T180 200 T270 200 T360 200 T450 200 L450 232 L0 232 Z"
        fill="var(--sea-3)"
      />

      {/* 노을 반사 */}
      <g fill="var(--sun)">
        <rect x="272" y="158" width="34" height="3.4" rx="1.7" opacity=".5" />
        <rect x="264" y="169" width="48" height="3.4" rx="1.7" opacity=".38" />
        <rect x="276" y="181" width="30" height="3.4" rx="1.7" opacity=".3" />
        <rect x="268" y="194" width="42" height="3.4" rx="1.7" opacity=".2" />
      </g>

      {/* 작은 배 */}
      <g fill="var(--sil)">
        <path d="M52 182 L86 182 L79 190 L58 190 Z" />
        <rect x="66" y="170" width="2" height="12" rx="1" />
      </g>

      {/* 광안대교 */}
      <g>
        <g fill="none" stroke="var(--bridge)" strokeWidth="2">
          <path d="M-10 120 Q60 142 122 100" />
          <path d="M122 100 Q195 152 268 100" />
          <path d="M268 100 Q330 142 400 120" />
        </g>
        <g stroke="var(--bridge)" strokeWidth="1" opacity=".6">
          <line x1="145" y1="117" x2="145" y2="147" />
          <line x1="163" y1="124" x2="163" y2="147" />
          <line x1="180" y1="127" x2="180" y2="147" />
          <line x1="196" y1="128" x2="196" y2="147" />
          <line x1="212" y1="127" x2="212" y2="147" />
          <line x1="229" y1="124" x2="229" y2="147" />
          <line x1="246" y1="117" x2="246" y2="147" />
        </g>
        <rect x="119" y="94" width="6" height="56" rx="1.5" fill="var(--bridge)" />
        <rect x="265" y="94" width="6" height="56" rx="1.5" fill="var(--bridge)" />
        <rect x="-10" y="146" width="410" height="5" rx="2" fill="var(--bridge)" />
        <g fill="var(--lights)">
          <circle cx="18" cy="144" r="1.6" />
          <circle cx="52" cy="144" r="1.6" />
          <circle cx="86" cy="144" r="1.6" />
          <circle cx="122" cy="144" r="1.6" />
          <circle cx="158" cy="144" r="1.6" />
          <circle cx="195" cy="144" r="1.6" />
          <circle cx="232" cy="144" r="1.6" />
          <circle cx="268" cy="144" r="1.6" />
          <circle cx="304" cy="144" r="1.6" />
          <circle cx="340" cy="144" r="1.6" />
          <circle cx="374" cy="144" r="1.6" />
        </g>
      </g>
    </svg>
  );
}

function StepIcon({ index }: { index: number }) {
  if (index === 0) {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="15" height="13" rx="2.5" />
        <circle cx="7.6" cy="8.4" r="1.4" />
        <path d="M5.6 14.6l3-3.5 2.4 2.7 2-2.3 2.6 3.1" />
        <circle cx="18" cy="17.5" r="4" fill="currentColor" stroke="none" />
        <path d="M16.4 17.5l1.2 1.2 2-2.4" stroke="var(--card)" strokeWidth="1.5" />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3.5" y="5.5" width="17" height="14" rx="2.5" />
        <path d="M3.5 10h17M8 3.5v3.5M16 3.5v3.5" />
        <circle cx="12" cy="14.5" r="1.8" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (index === 2) {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="4.5" y="3.5" width="15" height="8" rx="2" />
        <rect x="4.5" y="13.5" width="15" height="7" rx="2" />
        <path d="M8 7.5h6M8 17h4" />
      </svg>
    );
  }
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.5 9.5a7 7 0 0 1 12-2.3" />
      <path d="M17.8 3.6v3.8H14" />
      <path d="M18.5 14.5a7 7 0 0 1-12 2.3" />
      <path d="M6.2 20.4v-3.8H10" />
    </svg>
  );
}

function ReplanHintIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
      style={{ color: 'var(--accent-deep)' }}
    >
      <path d="M5.5 9.5a7 7 0 0 1 12-2.3M17.8 3.6v3.8H14M18.5 14.5a7 7 0 0 1-12 2.3M6.2 20.4v-3.8H10" />
    </svg>
  );
}
