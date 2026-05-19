import Link from 'next/link';
import { AuthStartActions } from '@/features/auth-start/ui/auth-start-actions';
import { AppFrame } from '@/shared/ui/app-frame';

const FLOW = [
  { title: '취향 저장', description: '여행 스타일, 시간, 이동수단' },
  { title: '멤버 추가', description: '참여자와 초대 대기자 관리' },
  { title: '취향 조율', description: '공통 기준과 절충 코스 생성' },
] as const;

export function LandingView() {
  return (
    <AppFrame showNav={false}>
      <section className="flex min-h-screen flex-col bg-white px-5 pb-6 pt-14">
        <header className="flex items-center justify-between">
          <div className="text-[23px] font-black leading-7 text-[color:var(--blue-600)]">
            Tripick
          </div>
          <Link
            href="/trips"
            className="text-[13px] font-black text-[color:var(--text-tertiary)]"
          >
            내 여행
          </Link>
        </header>

        <div className="flex flex-1 flex-col justify-center py-10">
          <div className="text-[13px] font-black leading-5 text-[color:var(--blue-600)]">
            국내 여행 취향 조율
          </div>
          <h1 className="mt-4 text-[42px] font-black leading-[1.08]">
            맞는 취향만
            <br />
            모아 일정으로
          </h1>
          <p className="mt-5 max-w-[25ch] text-[17px] font-bold leading-7 text-[color:var(--text-secondary)]">
            멤버 취향을 저장하고 공통 기준을 만듭니다.
          </p>

          <div className="mt-11 border-l-2 border-[color:var(--blue-100)] pl-5">
            {FLOW.map((step, index) => (
              <div key={step.title} className={index === FLOW.length - 1 ? '' : 'pb-6'}>
                <div className="relative">
                  <span className="absolute -left-[27px] top-1 size-3 rounded-full bg-[color:var(--blue-600)] ring-4 ring-white" />
                  <div className="text-[16px] font-black leading-6">{step.title}</div>
                  <div className="mt-1 text-[14px] font-bold leading-5 text-[color:var(--text-tertiary)]">
                    {step.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <AuthStartActions />
      </section>
    </AppFrame>
  );
}
