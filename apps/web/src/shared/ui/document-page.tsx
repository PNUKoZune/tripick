import Link from 'next/link';
import type { ReactNode } from 'react';

import { AppFrame, PageContainer } from './app-frame';

/**
 * 설정 하위 정적 문서(약관·개인정보·고객센터) 공통 셸.
 * 뒤로가기 헤더 + 본문 컨테이너를 제공하고, 내용은 {@link DocumentSection} 으로 채운다.
 * PageHeader 를 쓰지 않는 이유: nav 밖 진입 페이지라 좌측 뒤로가기가 필요(trip-create 헤더와 동형).
 */
export function DocumentPageShell({
  label,
  title,
  description,
  backHref = '/settings',
  backLabel = '설정',
  children,
}: {
  /** 데스크탑 전용 'Tripick · X' 작은 라벨 */
  label: string;
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <AppFrame>
      <header className="px-4 pt-5 lg:border-b lg:border-[#E5E8EB] lg:bg-white lg:px-0 lg:pt-0">
        <div className="mx-auto flex w-full max-w-[1160px] items-center gap-2 pb-3 lg:gap-3 lg:px-8 lg:py-4 xl:px-10">
          <Link
            href={backHref}
            aria-label="뒤로"
            className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[#FAFBFC] lg:size-auto lg:gap-1 lg:rounded-[12px] lg:border lg:border-[#E5E8EB] lg:bg-white lg:px-3 lg:py-2 lg:text-[13px] lg:font-semibold lg:text-[#6B7684] lg:hover:bg-[#FAFBFC] lg:hover:text-[#191F28]"
          >
            <span aria-hidden className="text-[20px] text-[#191F28] lg:text-inherit">
              ‹
            </span>
            <span className="hidden lg:inline">{backLabel}</span>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="hidden text-[12px] font-semibold tracking-wide text-[#3182F6] lg:block">
              Tripick · {label}
            </div>
            <h1 className="text-[20px] font-bold text-[#191F28] lg:mt-0.5 lg:text-[22px] lg:leading-[30px]">
              {title}
            </h1>
            {description ? (
              <p className="mt-1 text-[13px] text-[#6B7684]">{description}</p>
            ) : null}
          </div>
        </div>
      </header>
      <PageContainer>
        <div className="space-y-4">{children}</div>
      </PageContainer>
    </AppFrame>
  );
}

/** 문서 한 절(제목 + 내용) 카드. */
export function DocumentSection({
  heading,
  children,
}: {
  heading?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[16px] border border-[#E5E8EB] bg-white p-4 lg:p-5">
      {heading ? (
        <h2 className="mb-2 text-[15px] font-bold text-[#191F28]">{heading}</h2>
      ) : null}
      <div className="space-y-2 text-[14px] leading-[22px] text-[#4E5968]">{children}</div>
    </section>
  );
}

/** 본문 문단. */
export function DocumentParagraph({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

/** 불릿 목록. */
export function DocumentList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-[#C4CAD1]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
