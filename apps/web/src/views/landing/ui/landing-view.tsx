import Link from 'next/link';
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  LuClock,
  LuCloudRain,
  LuCompass,
  LuFootprints,
  LuImage,
  LuMapPin,
  LuRefreshCw,
  LuSparkles,
  LuUsers,
} from 'react-icons/lu';

import { GuestGuard } from '@/entities/session';
import { AuthStartActions } from '@/features/auth-start/ui/auth-start-actions';
import { AppFrame } from '@/shared/ui/app-frame';

/**
 * @MX:ANCHOR: 랜딩 "광안리의 하루" — SPEC-WEB-VISUAL-REDESIGN-001 M3 정본 구현.
 * 목업(docs/design-system/mockups/tripick-landing-mockup.html)의 hero 인라인 SVG ·
 * 단계 플로우 · 미리 보는 결과 · 마무리 섹션 구조를 잇되, CTA 는 실제 인증
 * 플로우(AuthStartActions — 이메일/카카오)로 화해(reconcile)한다.
 * @MX:REASON: fan_in — app/page.tsx 진입점이자 비로그인 사용자의 첫 화면.
 *
 * 폭 전략: 모바일은 500px 단일 컬럼(앱 웹뷰의 첫 화면이기도 하다), 데스크탑은
 * 1120px 다단. 예전엔 lg 에서도 560px 한 줄이라 PC 로 열면 좁은 띠 하나만 남았다.
 * 문구는 실제 동작만 적는다 — 자동으로 일정을 바꾸지 않는다는 점처럼 오해하면
 * 신뢰를 잃는 대목은 섹션을 따로 둬서 명시한다.
 */

type Feature = {
  icon: IconType;
  title: string;
  description: string;
  /** 따뜻한 계열(주황) 강조. 재계획·알림처럼 "여행 중" 성격의 기능에 쓴다. */
  warm?: boolean;
};

const FEATURES: readonly Feature[] = [
  {
    icon: LuImage,
    title: '사진이 취향을 말해요',
    description:
      '사진첩에서 고른 몇 장을 분석해 음식·분위기·자연/도시 취향 태그를 뽑아요. 고른 태그는 언제든 끄고 켤 수 있어요.',
  },
  {
    icon: LuCompass,
    title: '이름값 대신 취향으로',
    description:
      '전국 장소를 취향 유사도로 먼저 찾고, 블로그·카페에서 얼마나 이야기되는 곳인지로 한 번 더 순서를 고릅니다.',
  },
  {
    icon: LuClock,
    title: '시간표까지 맞춘 하루',
    description:
      '영업시간, 장소 사이 이동 시간, 취침·기상 시간을 지켜 하루를 채워요. 도보·대중교통·자동차 중 고른 수단으로 계산합니다.',
  },
  {
    icon: LuRefreshCw,
    title: '마음에 안 드는 날만 다시',
    description:
      '여행 전체를 갈아엎지 않아도 돼요. 특정 일차만 골라 다시 짜고, 오늘이라면 지금 시각 이후만 다시 채웁니다.',
    warm: true,
  },
  {
    icon: LuCloudRain,
    title: '여행 중에 먼저 알려줘요',
    description:
      '비 소식, 붐빌 것 같은 날, 시작 시각이 지났는데 도착하지 않은 일정을 알림으로 알려드려요.',
    warm: true,
  },
  {
    icon: LuUsers,
    title: '동행자 취향까지 함께',
    description:
      '친구를 여행에 초대하면 멤버들의 취향을 같이 반영해요. 일정 변경은 만든 사람이 확인한 뒤 반영됩니다.',
  },
] as const;

const STEPS = [
  {
    title: '취향 알려주기',
    description: '좋아하는 사진을 고르거나, 선호하는 테마를 눌러 주세요. 1분이면 충분해요.',
    warm: false,
  },
  {
    title: '여행 조건 입력',
    description: '어디로, 며칠 동안, 누구와, 어떤 리듬으로 다닐지 골라 주세요.',
    warm: false,
  },
  {
    title: '완성된 일정 받기',
    description: '일차별 카드와 지도, 이동 시간까지 계산된 하루하루가 정리돼요.',
    warm: false,
  },
  {
    title: '마음 바뀌면 다시',
    description: '비가 와도, 줄이 길어도 괜찮아요. 그 날만 골라 다시 부탁하면 됩니다.',
    warm: true,
  },
] as const;

/** 히어로 밑 신뢰 칩. 실제로 붙어 있는 데이터 출처만 적는다. */
const SOURCE_CHIPS = [
  '한국관광공사 관광정보',
  '카카오맵 장소·길찾기',
  '기상청 단기예보',
  '네이버 블로그·카페 언급량',
] as const;

const PREVIEW_TIMELINE = [
  {
    time: '10:00',
    dot: '--t-morning',
    title: '광안리 해변 산책',
    desc: '아침 바다를 따라 느리게 시작하는 하루',
    move: '숙소에서 도보 12분',
  },
  {
    time: '12:30',
    dot: '--t-noon',
    title: '로컬 밥집에서 점심',
    desc: '사진 속 한식 취향을 그대로 담았어요',
    move: '도보 9분 · 브레이크타임 15:00 전',
  },
  {
    time: '15:00',
    dot: '--t-gold',
    title: '바다가 보이는 카페',
    desc: '커피 한 잔만큼의 쉼표',
    move: '버스 2정거장 · 11분',
  },
  {
    time: '19:00',
    dot: '--t-dusk',
    title: '광안대교 야경과 저녁',
    desc: '다리에 불이 켜지면 오늘의 하이라이트',
    move: '도보 6분 · 일몰 19:24',
  },
] as const;

const PREVIEW_TAGS = ['대중교통 동선', '걷기 적당히', '바다 뷰 선호', '한식 비중 높게'] as const;

const ALERTS = [
  {
    icon: LuCloudRain,
    tone: '--t-noon',
    title: '2일차 오후에 비 소식이 있어요',
    body: '야외 일정 2곳이 걸쳐 있어요. 실내 코스로 다시 짜 볼까요?',
  },
  {
    icon: LuUsers,
    tone: '--t-gold',
    title: '3일차 방문객이 몰릴 것 같아요',
    body: '그 장소의 평소 수준보다 붐빌 것으로 예상되는 날이에요.',
  },
  {
    icon: LuMapPin,
    tone: '--t-dusk',
    title: '아직 도착하지 않으셨네요',
    body: '14:00 카페 일정이 시작된 지 15분이 지났어요. 남은 하루를 다시 짜 드릴까요?',
  },
] as const;

const FAQS = [
  {
    q: '어떤 지역까지 되나요?',
    a: '국내 전국입니다. 시·군·구 같은 행정구역은 물론 광안리·남이섬처럼 행정구역 이름이 아닌 곳도 좌표로 찾아 그 주변에서 후보를 고릅니다. 하루마다 다른 지역을 지정할 수도 있어요.',
  },
  {
    q: '올린 사진은 어떻게 보관되나요?',
    a: '비공개 저장소에 올라가고, 화면에 띄우는 순간에만 15분짜리 임시 링크로 불러옵니다. 링크를 아는 사람이 계속 열어 볼 수 있는 구조가 아니에요. 사진과 태그는 취향 화면에서 언제든 지울 수 있습니다.',
  },
  {
    q: '일정이 저절로 바뀌나요?',
    a: '아니요. 날씨·혼잡·미도착은 알림으로 알려 드릴 뿐이고, 실제로 다시 짜는 건 직접 요청할 때만 합니다. 이미 지난 일정과 다녀온 장소는 그대로 두고요.',
  },
  {
    q: '앱으로도 쓸 수 있나요?',
    a: '웹 브라우저에서 바로 쓸 수 있고, 알림은 웹 푸시로 받습니다. 여행 중 위치를 확인해 미도착을 알려 주는 기능은 모바일 앱에서 더 정확하게 동작해요.',
  },
  {
    q: '일정을 다른 사람에게 보여줄 수 있나요?',
    a: '여행마다 공유 링크를 만들 수 있어요. 링크를 받은 사람은 로그인 없이 일차별 일정과 지도를 볼 수 있습니다.',
  },
] as const;

const NAV_LINKS = [
  { href: '#features', label: '기능' },
  { href: '#how', label: '이용 흐름' },
  { href: '#preview', label: '결과 미리보기' },
  { href: '#faq', label: '자주 묻는 질문' },
] as const;

/**
 * 모바일 앱의 첫 진입 경로이자 웹의 비로그인 랜딩.
 * 이미 로그인한 사용자에겐 보여줄 이유가 없으므로 GuestGuard 로 `/`(여행 목록) 로 되돌린다.
 * 본문은 클라이언트 훅을 쓰지 않는 서버 컴포넌트로 남겨, 가드와 CTA 만 클라이언트에서 돈다.
 */
export function LandingView() {
  return (
    <GuestGuard>
      <LandingContent />
    </GuestGuard>
  );
}

function LandingContent() {
  return (
    <AppFrame showNav={false} themed>
      <LandingHeader />

      <div className="px-5 pb-[calc(64px+var(--safe-bottom))] lg:px-10">
        <div className="mx-auto w-full max-w-[500px] md:max-w-[720px] lg:max-w-[1120px]">
          <HeroSection />
          <FeatureSection />
          <HowSection />
          <PreviewSection />
          <AlertSection />
          <FaqSection />
          <ClosingSection />
        </div>
      </div>

      <LandingFooter />
    </AppFrame>
  );
}

/* ============================================================
   헤더
   ============================================================ */

/**
 * 상단 고정 헤더. 데스크탑에서만 섹션 앵커를 노출한다 — 모바일에서 앵커까지 늘어놓으면
 * 로고와 CTA 가 밀려 첫 화면이 좁아진다.
 *
 * 배경은 클래스(불투명 --bg)로 깔고 인라인 style 의 color-mix 로 덮는다. color-mix 를
 * 모르는 구형 웹뷰에선 인라인 선언만 버려져 불투명 배경이 남으므로, 글자가 비쳐 겹치는
 * 사고가 없다.
 */
function LandingHeader() {
  return (
    <header
      className="sticky top-0 z-30 border-b border-[color:var(--line)] bg-[color:var(--bg)] backdrop-blur"
      style={{ background: 'color-mix(in srgb, var(--bg) 86%, transparent)' }}
    >
      <div className="mx-auto flex w-full max-w-[500px] items-center justify-between px-5 pb-3 pt-[calc(12px+var(--safe-top))] md:max-w-[720px] lg:max-w-[1120px] lg:px-10 lg:pb-4 lg:pt-4">
        <Link href="/start" className="inline-flex items-baseline gap-0.5" aria-label="트리픽 홈">
          <span className="text-[19px] font-extrabold tracking-[-0.02em] text-[color:var(--ink)]">
            트리픽
          </span>
          <span
            aria-hidden="true"
            className="size-[7px] -translate-y-px rounded-full"
            style={{ background: 'var(--accent)' }}
          />
          <small className="ml-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-[color:var(--ink-faint)]">
            TRIPICK
          </small>
        </Link>

        <nav aria-label="주요 섹션" className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[14px] font-semibold text-[color:var(--ink-sub)] transition-colors hover:text-[color:var(--ink)]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 lg:gap-3">
          <Link
            href="/login"
            className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-[color:var(--ink-sub)] transition-colors hover:text-[color:var(--ink)] lg:text-[14px]"
          >
            로그인
          </Link>
          <Link
            href="/signup"
            className="whitespace-nowrap rounded-full bg-[color:var(--primary-tint)] px-[13px] py-[7px] text-[12.5px] font-bold text-[color:var(--primary)] transition-colors hover:bg-[color:var(--primary)] hover:text-[color:var(--btn-text)] lg:px-4 lg:py-2 lg:text-[14px]"
          >
            무료로 시작
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ============================================================
   히어로
   ============================================================ */

/**
 * 히어로. 그림은 **한 번만** 그린다 — 모바일용/데스크탑용으로 두 벌 두면 SVG 안의
 * `id`(그라데이션)가 중복돼 `url(#…)` 이 숨겨진(display:none) 첫 번째 사본을 가리키고,
 * 보이는 쪽은 하늘·햇무리가 통째로 안 칠해진다. 그래서 DOM 순서(문구 → 그림 → CTA)를
 * 모바일 기준으로 두고, 데스크탑에서만 grid 좌표로 그림을 오른쪽 열에 옮긴다.
 */
function HeroSection() {
  return (
    <section className="grid pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-x-14 lg:pt-[72px]">
      <div className="lg:col-start-1 lg:row-start-1">
        <p className="wvr-rise wvr-rise-1 mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-[color:var(--primary-tint)] px-3 py-1.5 text-[12.5px] font-bold tracking-[0.01em] text-[color:var(--primary)]">
          <LuSparkles aria-hidden="true" className="size-[14px]" />
          취향으로 골라주는 AI 여행 플래너
        </p>
        <h1 className="wvr-rise wvr-rise-2 text-balance text-[clamp(29px,8vw,38px)] font-extrabold leading-[1.3] tracking-[-0.035em] text-[color:var(--ink)] lg:text-[52px] lg:leading-[1.22]">
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
        <p className="wvr-rise wvr-rise-3 mt-3.5 max-w-[42ch] text-[16px] leading-[1.68] text-[color:var(--ink-sub)] lg:mt-5 lg:text-[18px]">
          오래 들여다본 바다, 저장만 해 둔 골목길. 좋아하는 사진 몇 장을 고르면 트리픽이 그 취향
          그대로 국내 여행 일정을 짜고, 영업시간과 이동 시간까지 맞춰 하루를 정리해 드려요.
        </p>

      </div>

      {/* 모바일은 그림이 CTA 위 — 첫 화면에서 그림이 문장보다 먼저 읽힌다.
          데스크탑은 오른쪽 열로 옮겨 문구·CTA 두 행에 걸쳐 세로 중앙에 둔다. */}
      <div className="wvr-rise wvr-rise-4 mt-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:self-center">
        <HeroScene />
      </div>

      <div className="wvr-rise wvr-rise-5 mt-5 lg:col-start-1 lg:row-start-2 lg:mt-8 lg:max-w-[400px]">
        <AuthStartActions />
        <p className="mt-3 text-center text-[13px] text-[color:var(--ink-faint)] lg:text-left">
          가입 무료 · 3분이면 첫 일정을 받아볼 수 있어요
        </p>
      </div>

      {/* 데이터 출처 — 그리드 두 컬럼을 가로지르게 두어 히어로 전체의 바닥선이 된다. */}
      <div className="mt-12 border-t border-[color:var(--line)] pt-6 lg:col-span-2 lg:row-start-3 lg:mt-16">
        <p className="text-[12.5px] font-semibold text-[color:var(--ink-faint)]">
          이런 데이터를 확인해 후보를 고릅니다
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {SOURCE_CHIPS.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-[color:var(--line)] bg-[color:var(--card)] px-[11px] py-1.5 text-[12.5px] font-semibold text-[color:var(--ink-sub)]"
            >
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** 광안리 장면 + 캡션. 히어로가 모바일·데스크탑에서 각각 다른 자리에 두므로 조각으로 뺐다. */
function HeroScene() {
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-[color:var(--line)] leading-none shadow-[var(--shadow-card)] lg:rounded-[24px]">
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
  );
}

/* ============================================================
   기능
   ============================================================ */

function FeatureSection() {
  return (
    <section id="features" className="mt-[72px] scroll-mt-24 lg:mt-[128px]">
      <SectionHeading
        eyebrow="트리픽이 하는 일"
        title={
          <>
            검색 탭 스무 개 대신,
            <br />
            일정 하나로 정리해요
          </>
        }
        description="가고 싶은 곳을 모으는 것부터 시간표를 맞추는 것까지 — 여행 준비에서 손이 많이 가는 부분을 대신합니다."
      />

      <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:mt-12 lg:grid-cols-3 lg:gap-5">
        {FEATURES.map((feature) => (
          <li
            key={feature.title}
            className="rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card)] p-5 shadow-[var(--shadow-card)] lg:p-6"
          >
            <span
              className="flex size-11 items-center justify-center rounded-[14px] border border-[color:var(--line)]"
              style={{
                background: feature.warm ? 'var(--accent-tint)' : 'var(--primary-tint)',
                color: feature.warm ? 'var(--accent-deep)' : 'var(--primary)',
              }}
            >
              <feature.icon aria-hidden="true" className="size-[21px]" />
            </span>
            <h3 className="mt-4 text-[17px] font-bold tracking-[-0.02em] text-[color:var(--ink)]">
              {feature.title}
            </h3>
            <p className="mt-1.5 text-[14.5px] leading-[1.62] text-[color:var(--ink-sub)]">
              {feature.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ============================================================
   이용 흐름
   ============================================================ */

/**
 * 4단계. 모바일은 점선 세로 타임라인, 데스크탑은 가로 4열이다 — 세로 타임라인을 넓은
 * 화면에 그대로 두면 왼쪽 46px 열만 쓰고 오른쪽이 텅 빈다.
 */
function HowSection() {
  return (
    <section id="how" className="mt-[72px] scroll-mt-24 lg:mt-[128px]">
      <SectionHeading
        eyebrow="이렇게 진행돼요"
        title={
          <>
            사진 고르기부터 완성까지,
            <br />
            네 걸음이면 돼요
          </>
        }
      />

      <div className="relative mt-8 flex flex-col gap-[30px] lg:mt-14 lg:grid lg:grid-cols-4 lg:gap-8">
        {/* 연결선: 모바일은 아이콘 열을 따라 세로, 데스크탑은 아이콘 중심을 잇는 가로. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[30px] left-[23px] top-[50px] border-l-2 border-dotted lg:bottom-auto lg:left-[56px] lg:right-[56px] lg:top-[23px] lg:border-l-0 lg:border-t-2"
          style={{ borderColor: 'var(--line-dot)' }}
        />
        {STEPS.map((step, index) => (
          <div
            key={step.title}
            className="relative grid grid-cols-[46px_1fr] items-start gap-4 lg:grid-cols-1 lg:gap-0"
          >
            <span
              className="relative flex size-[46px] items-center justify-center rounded-[16px] border lg:mx-auto"
              style={{
                background: step.warm ? 'var(--accent-tint)' : 'var(--primary-tint)',
                color: step.warm ? 'var(--accent-deep)' : 'var(--primary)',
                borderColor: 'var(--line)',
              }}
            >
              <StepIcon index={index} />
            </span>
            <div className="lg:mt-4 lg:text-center">
              <span className="hidden font-mono text-[11px] font-bold tracking-[0.08em] text-[color:var(--ink-faint)] lg:block">
                STEP {index + 1}
              </span>
              <h3 className="mb-1 mt-0.5 text-[17px] font-bold tracking-[-0.02em] text-[color:var(--ink)] lg:mt-1.5">
                {step.title}
              </h3>
              <p className="text-[15px] leading-[1.62] text-[color:var(--ink-sub)] lg:text-[14.5px]">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   결과 미리보기
   ============================================================ */

function PreviewSection() {
  return (
    <section id="preview" className="mt-[72px] scroll-mt-24 lg:mt-[128px]">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:items-start lg:gap-14">
        <div className="lg:sticky lg:top-24">
          <SectionHeading
            eyebrow="미리 보는 결과"
            title={<>예를 들면, 이런 하루가 나와요</>}
            description="바다 사진을 오래 보고 한식을 즐겨 찍는 취향이라면 — 트리픽은 이렇게 하루를 정리합니다."
          />
          <ul className="mt-6 flex flex-wrap gap-2">
            {PREVIEW_TAGS.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-[color:var(--line)] bg-[color:var(--card-soft)] px-[11px] py-1.5 text-[12.5px] font-semibold text-[color:var(--ink-sub)]"
              >
                {tag}
              </li>
            ))}
          </ul>
          <p className="mt-5 hidden text-[14.5px] leading-[1.65] text-[color:var(--ink-sub)] lg:block">
            장소마다 이동 수단과 걸리는 시간, 영업시간을 함께 확인해 배치합니다. 한 곳이 마음에 안
            들면 그 자리만 다른 후보로 바꿀 수도 있어요.
          </p>
        </div>

        <article className="mt-8 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card)] px-5 pb-5 pt-[22px] shadow-[var(--shadow-card)] lg:mt-0 lg:rounded-[24px] lg:px-7 lg:pb-7 lg:pt-7">
          <div className="flex items-center justify-between">
            <span className="inline-block rounded-[8px] bg-[color:var(--primary-tint)] px-[9px] py-1 font-mono text-[11px] font-bold text-[color:var(--primary)]">
              DAY 1
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[color:var(--ink-faint)]">
              <LuFootprints aria-hidden="true" className="size-[14px]" />
              걷기 4.1km
            </span>
          </div>
          <h3 className="mt-2 text-[20px] font-extrabold tracking-[-0.025em] text-[color:var(--ink)] lg:text-[22px]">
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
                  <p className="mt-1 text-[12.5px] font-medium text-[color:var(--ink-faint)]">
                    {item.move}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p
            className="mt-[22px] flex items-start gap-[9px] border-t border-dashed pt-4 text-[13.5px] leading-[1.55] text-[color:var(--ink-sub)]"
            style={{ borderColor: 'var(--line)' }}
          >
            <LuRefreshCw
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
              style={{ color: 'var(--accent-deep)' }}
            />
            저녁 자리가 아쉬우면 그 한 곳만 골라서 다시 추천받을 수 있어요.
          </p>
        </article>
      </div>
    </section>
  );
}

/* ============================================================
   여행 중 알림
   ============================================================ */

/**
 * "알림은 알림일 뿐" 을 못박는 섹션. 자동 재계획으로 오해하면 여행 중에 일정이 제멋대로
 * 바뀐다고 읽히므로, 카드 아래 문장으로 명시한다.
 */
function AlertSection() {
  return (
    <section className="mt-[72px] lg:mt-[128px]">
      <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--card-soft)] px-5 py-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:items-center lg:gap-14 lg:px-10 lg:py-12">
        <div>
          <SectionHeading
            eyebrow="여행 중에도"
            title={
              <>
                상황이 바뀌면
                <br />
                먼저 알려드려요
              </>
            }
            description="비 예보, 붐빌 것 같은 날, 시작 시각이 지났는데 도착하지 않은 일정 — 트리픽이 여행 중에 확인해 알림함으로 보냅니다."
          />
          <p className="mt-5 inline-flex items-start gap-2 rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card)] px-3.5 py-3 text-[13.5px] leading-[1.55] text-[color:var(--ink-sub)]">
            <LuSparkles
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
              style={{ color: 'var(--primary)' }}
            />
            일정이 저절로 바뀌지는 않아요. 다시 짜는 건 알림을 확인하고 요청할 때만 합니다.
          </p>
        </div>

        <ul className="mt-8 flex flex-col gap-3 lg:mt-0">
          {ALERTS.map((alert) => (
            <li
              key={alert.title}
              className="flex items-start gap-3.5 rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)] p-4 shadow-[var(--shadow-card)]"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full"
                style={{ background: `var(${alert.tone})`, color: 'var(--card)' }}
              >
                <alert.icon aria-hidden="true" className="size-[17px]" />
              </span>
              <div>
                <strong className="block text-[15px] font-bold tracking-[-0.015em] text-[color:var(--ink)]">
                  {alert.title}
                </strong>
                <p className="mt-1 text-[13.5px] leading-[1.55] text-[color:var(--ink-sub)]">
                  {alert.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ============================================================
   FAQ
   ============================================================ */

/** JS 없이 접히도록 `<details>` 로 짠다 — 랜딩은 서버 컴포넌트로 남겨야 첫 페인트가 빠르다. */
function FaqSection() {
  return (
    <section id="faq" className="mt-[72px] scroll-mt-24 lg:mt-[128px]">
      <SectionHeading eyebrow="자주 묻는 질문" title={<>궁금한 점이 있으신가요?</>} center />

      <div className="mx-auto mt-8 max-w-[760px] lg:mt-10">
        <ul className="flex flex-col gap-3">
          {FAQS.map((faq) => (
            <li key={faq.q}>
              <details className="group rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)] px-5 py-4 open:shadow-[var(--shadow-card)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-bold tracking-[-0.015em] text-[color:var(--ink)] [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-full text-[color:var(--ink-faint)] transition-transform group-open:rotate-45"
                    style={{ background: 'var(--card-soft)' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
                      <path
                        d="M6 1.5v9M1.5 6h9"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </summary>
                <p className="mt-3 text-[14.5px] leading-[1.68] text-[color:var(--ink-sub)]">
                  {faq.a}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ============================================================
   마무리 · 푸터
   ============================================================ */

function ClosingSection() {
  return (
    <section
      className="mt-[72px] rounded-[20px] px-6 py-[30px] lg:mt-[128px] lg:rounded-[28px] lg:px-16 lg:py-16 lg:text-center"
      style={{ background: 'var(--primary-tint)' }}
    >
      <h2 className="text-balance text-[24px] font-extrabold leading-[1.38] tracking-[-0.03em] text-[color:var(--ink)] lg:text-[38px] lg:leading-[1.3]">
        다음 여행은,
        <br className="lg:hidden" /> 취향에서 시작해 보세요
      </h2>
      <p className="mt-3 text-[15px] leading-[1.65] text-[color:var(--ink-sub)] lg:mx-auto lg:mt-5 lg:max-w-[48ch] lg:text-[17px]">
        검색창에 &lsquo;부산 가볼 만한 곳&rsquo;을 열 번 치는 대신 좋아하는 사진 몇 장을 골라
        주세요. 나머지는 트리픽이 정리할게요.
      </p>
      <div className="mt-[22px] lg:mx-auto lg:mt-8 lg:max-w-[400px]">
        <AuthStartActions />
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="mt-16 border-t border-[color:var(--line)] px-5 lg:px-10">
      <div className="mx-auto flex w-full max-w-[500px] flex-col gap-4 py-7 pb-11 text-[12.5px] text-[color:var(--ink-faint)] md:max-w-[720px] lg:max-w-[1120px] lg:flex-row lg:items-center lg:justify-between lg:py-8">
        <p>트리픽 TriPick — 취향으로 골라주는 국내 여행 AI 플래너</p>
        <nav aria-label="약관 및 고객 지원" className="flex items-center gap-5">
          <Link href="/legal/terms" className="hover:text-[color:var(--ink-sub)]">
            이용약관
          </Link>
          <Link href="/legal/privacy" className="hover:text-[color:var(--ink-sub)]">
            개인정보처리방침
          </Link>
          <Link href="/support" className="hover:text-[color:var(--ink-sub)]">
            고객센터
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** 섹션 머리. eyebrow → 제목 → 설명(선택) 순서를 모든 섹션이 공유해 리듬이 흔들리지 않게 한다. */
function SectionHeading({
  eyebrow,
  title,
  description,
  center = false,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: string;
  /** 데스크탑에서 가운데 정렬. 본문도 가운데로 모으는 섹션(FAQ)에서만 켠다. */
  center?: boolean;
}) {
  return (
    <div className={center ? 'lg:text-center' : undefined}>
      <p className="mb-2 text-[13px] font-bold text-[color:var(--primary)]">{eyebrow}</p>
      <h2 className="text-balance text-[24px] font-extrabold leading-[1.4] tracking-[-0.03em] text-[color:var(--ink)] lg:text-[34px] lg:leading-[1.32]">
        {title}
      </h2>
      {description ? (
        <p
          className={`mt-3 max-w-[52ch] text-[15px] leading-[1.65] text-[color:var(--ink-sub)] lg:text-[16.5px] ${center ? 'lg:mx-auto' : ''}`}
        >
          {description}
        </p>
      ) : null}
    </div>
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
