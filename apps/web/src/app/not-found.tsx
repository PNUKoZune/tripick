import Link from 'next/link';

import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

/**
 * 앱 브랜드를 유지하는 404. 기본 Next 화면은 셸(하단 탭·팔레트) 밖이라
 * 주소를 잘못 눌렀을 때 앱이 아예 죽은 것처럼 보인다.
 * 하단 탭을 그대로 두어 오타 한 번으로 앱 밖에 나간 느낌이 들지 않게 한다.
 */
export default function NotFound() {
  return (
    <AppFrame themed>
      <PageHeader title="페이지를 찾을 수 없어요" label="404" />
      <PageContainer>
        <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] p-6 text-center">
          <div className="text-[13px] leading-[20px] text-[color:var(--ink-sub)]">
            주소가 바뀌었거나 삭제된 화면이에요.
            <br />
            아래에서 다시 시작해 주세요.
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/"
              className="inline-flex h-11 items-center rounded-[12px] bg-[color:var(--btn-bg)] px-5 text-[14px] font-bold text-[color:var(--btn-text)] shadow-[var(--shadow-btn)] transition-colors hover:bg-[color:var(--btn-bg-press)]"
            >
              내 여행으로
            </Link>
            <Link
              href="/support"
              className="inline-flex h-11 items-center rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-5 text-[14px] font-bold text-[color:var(--ink-sub)] transition-colors hover:bg-[color:var(--card-soft)]"
            >
              고객센터
            </Link>
          </div>
        </div>
      </PageContainer>
    </AppFrame>
  );
}
