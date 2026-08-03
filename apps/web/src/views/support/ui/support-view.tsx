import { LuMail } from 'react-icons/lu';

import { DocumentPageShell, DocumentParagraph, DocumentSection } from '@/shared/ui/document-page';

// TODO: 발신/고객문의 도메인 확정 시 실제 주소로 교체 (docs 백로그 "발신 도메인 확정")
const SUPPORT_EMAIL = 'support@tripick.place';

const FAQ = [
  {
    q: '취향 사진은 어떻게 쓰이나요?',
    a: '갤러리에서 직접 선택해 올린 사진을 분석해 음식·분위기·자연/도시 취향 태그를 뽑고, 이 태그로 여행 일정을 맞춤 추천합니다. 사진은 취향 분석 목적으로만 사용합니다.',
  },
  {
    q: '미도착·날씨·혼잡 알림은 왜 오나요?',
    a: '일정 항목 시작 시각에 근처에 없거나, 날씨·혼잡 변화가 감지되면 일정 조정을 추천하는 알림을 보냅니다. 알림은 추천일 뿐 일정을 자동으로 바꾸지 않으며, 확인 후 직접 재계획을 요청할 수 있습니다.',
  },
  {
    q: '위치 정보는 계속 수집되나요?',
    a: '여행 진행 중 미도착 판정을 위해서만 위치를 사용하며, 여행이 아닐 때는 수집하지 않습니다. 위치 권한은 기기 설정에서 언제든 해제할 수 있습니다.',
  },
  {
    q: '계정을 삭제하고 싶어요.',
    a: '설정 → 계정에서 탈퇴할 수 있습니다. 탈퇴 시 계정과 관련 데이터는 보관 의무가 없는 한 지체 없이 삭제됩니다.',
  },
];

export function SupportView() {
  return (
    <DocumentPageShell
      label="고객센터"
      title="고객센터"
      description="궁금한 점이나 불편한 점을 알려주세요."
    >
      <DocumentSection heading="문의하기">
        <DocumentParagraph>
          아래 이메일로 문의를 보내주시면 순차적으로 답변드립니다. 운영 시간은 평일 오전 10시부터
          오후 6시까지(주말·공휴일 제외)입니다.
        </DocumentParagraph>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="mt-1 flex h-12 items-center justify-between rounded-[12px] bg-[color:var(--card-soft)] px-4 text-[14px] font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--line)]"
        >
          <span>{SUPPORT_EMAIL}</span>
          <span className="flex items-center gap-1.5 text-[12px] text-[color:var(--ink-faint)]">
            <LuMail className="size-3.5" aria-hidden />
            메일 보내기
          </span>
        </a>
      </DocumentSection>

      <DocumentSection heading="자주 묻는 질문">
        <div className="space-y-4">
          {FAQ.map((item) => (
            <div key={item.q}>
              <p className="text-[14px] font-bold text-[color:var(--ink)]">Q. {item.q}</p>
              <p className="mt-1 text-[14px] leading-[22px] text-[color:var(--ink-sub)]">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </DocumentSection>
    </DocumentPageShell>
  );
}
