import Link from 'next/link';
import { AuthStartActions } from '@/features/auth-start/ui/auth-start-actions';
import { AppFrame, PageSection } from '@/shared/ui/app-frame';

export function LandingView() {
  return (
    <AppFrame showNav={false}>
      <section className="relative min-h-[390px] overflow-hidden bg-[color:var(--blue-600)] px-5 pb-8 pt-12 text-white">
        <div className="absolute left-[-80px] top-[-80px] size-56 rounded-full bg-white/10" />
        <div className="absolute bottom-[-70px] right-[-60px] size-52 rounded-full bg-white/12" />
        <div className="relative z-10 flex min-h-[310px] flex-col justify-end">
          <div className="mb-7 flex size-20 items-center justify-center rounded-[24px] bg-white text-[17px] font-black tracking-[-0.02em] text-[color:var(--blue-600)] shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
            Tripick
          </div>
          <h1 className="max-w-[9ch] text-[44px] font-black leading-[0.98] tracking-[-0.04em]">
            취향이 맞는 여행
          </h1>
          <p className="mt-4 max-w-[26ch] text-[16px] font-semibold leading-6 text-white/78">
            국내 여행 동행 취향을 먼저 맞추고 일정으로 이어갑니다.
          </p>
        </div>
      </section>

      <PageSection className="space-y-7 bg-white">
        <section className="space-y-4">
          <FeatureRow title="취향 설정" description="내 여행 스타일, 생활 리듬, 이동 수단 저장" />
          <FeatureRow title="멤버 관리" description="초대 전 대기 멤버와 참여 멤버를 함께 관리" />
          <FeatureRow title="취향 조율" description="멤버별 선호를 비교하고 절충 코스를 생성" />
        </section>

        <AuthStartActions />

        <div className="text-center text-[13px] font-semibold leading-6 text-[color:var(--text-tertiary)]">
          이미 준비 중인 여행이 있다면{' '}
          <Link className="text-[color:var(--blue-600)]" href="/coordination">
            조율 화면
          </Link>
          으로 이동
        </div>
      </PageSection>
    </AppFrame>
  );
}

function FeatureRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="mt-1 size-9 shrink-0 rounded-[12px] bg-[color:var(--blue-50)]" />
      <div>
        <div className="text-[16px] font-black leading-6">{title}</div>
        <div className="mt-1 text-[14px] font-medium leading-5 text-[color:var(--text-secondary)]">
          {description}
        </div>
      </div>
    </div>
  );
}
