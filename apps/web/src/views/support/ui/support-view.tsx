import Link from 'next/link';
import { LuMail } from 'react-icons/lu';

import {
  DocumentList,
  DocumentPageShell,
  DocumentParagraph,
  DocumentSection,
} from '@/shared/ui/document-page';
import { SUPPORT_EMAIL } from '@/shared/config/contact';

const FAQ = [
  {
    q: '취향 사진은 어떻게 쓰이나요?',
    a: '갤러리에서 직접 선택해 올린 사진을 분석해 음식·분위기·자연/도시 취향 태그를 뽑고, 이 태그로 여행 일정을 맞춤 추천합니다. 사진은 취향 분석 목적으로만 사용하고, 다른 이용자에게 공개되지 않는 비공개 저장소에 두며 화면에는 잠시 뒤 만료되는 임시 링크로만 표시합니다.',
  },
  {
    q: '올린 사진을 지우고 싶어요.',
    a: '취향 설정 화면에서 사진을 하나씩 삭제할 수 있고, 삭제하면 저장소의 원본 파일도 함께 지워집니다. 이미 뽑힌 취향 태그는 남은 사진으로 다시 분석하면 갱신됩니다.',
  },
  {
    q: '미도착·날씨·혼잡 알림은 왜 오나요?',
    a: '일정 항목 시작 시각에 근처에 없거나, 날씨·혼잡 변화가 감지되면 일정 조정을 추천하는 알림을 보냅니다. 알림은 추천일 뿐 일정을 자동으로 바꾸지 않으며, 확인 후 직접 재계획을 요청할 수 있습니다.',
  },
  {
    q: '알림을 받고 싶지 않아요.',
    a: '설정 → 알림 설정에서 미도착·날씨·혼잡·친구 요청 등 항목별로 끌 수 있습니다. 끄면 푸시와 인박스 모두 받지 않습니다.',
  },
  {
    q: '위치 정보는 계속 수집되나요?',
    a: '여행 진행 중 미도착 판정을 위해서만 위치를 사용하며, 여행이 아닐 때는 수집하지 않습니다. 수집한 위치는 서버 캐시에 15분만 남았다가 자동으로 지워지고 이동 경로로 쌓이지 않습니다. 위치 권한은 기기 설정에서 언제든 해제할 수 있으며, 해제해도 미도착 알림 외 기능은 그대로 쓸 수 있습니다.',
  },
  {
    q: '일정이 마음에 들지 않아요.',
    a: '일정 화면의 재계획에서 다시 짤 수 있고, 전체가 아니라 특정 일차만 골라 다시 짜는 것도 됩니다. 오늘 일차를 다시 짜면 이미 지난 일정은 그대로 두고 지금 이후 시간만 채웁니다.',
  },
  {
    q: '공유 링크를 다시 비공개로 돌리고 싶어요.',
    a: '공유 링크는 주소를 아는 사람이면 로그인 없이 열람할 수 있습니다. 여행 화면의 공유에서 "공유 중지"를 누르면 링크가 즉시 무효가 되어 더 이상 열리지 않습니다.',
  },
  {
    q: '인증 메일이 오지 않아요.',
    a: '스팸함이나 프로모션함을 먼저 확인해 주세요. 그래도 없으면 로그인 화면에서 인증 메일을 다시 보낼 수 있습니다. 남용을 막기 위해 같은 주소로 보내는 횟수에 제한이 있어, 잠시 뒤 다시 시도하면 발송됩니다.',
  },
  {
    q: '계정을 삭제하고 싶어요.',
    a: '설정 → 회원 탈퇴에서 삭제할 수 있습니다. 탈퇴는 유예 기간 없이 즉시 처리되어 되돌릴 수 없고, 계정·여행 일정·올린 사진이 모두 지워집니다. 남기고 싶은 일정은 미리 저장해 두세요.',
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
          오후 6시까지(주말·공휴일 제외)이며, 접수된 문의에는 영업일 기준 3일 이내에 답변드리는 것을
          목표로 합니다.
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
        <DocumentParagraph>
          아래 내용을 함께 적어 주시면 더 빠르게 확인할 수 있어요.
        </DocumentParagraph>
        <DocumentList
          items={[
            '가입에 사용한 이메일 주소 또는 닉네임',
            '문제가 생긴 화면과 시각 (예: 8월 27일 오후 3시경 일정 재계획)',
            '사용 환경 (앱 / 모바일 브라우저 / PC 브라우저)',
            '가능하다면 화면 캡처',
          ]}
        />
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

      <DocumentSection heading="개인정보·약관 문의">
        <DocumentParagraph>
          개인정보 열람·정정·삭제 요청이나 처리 정지 요구는{' '}
          <Link
            href="/legal/privacy"
            className="font-semibold text-[color:var(--primary)] hover:underline"
          >
            개인정보처리방침
          </Link>
          의 개인정보 보호책임자 연락처로 보내주세요. 서비스 이용 조건은{' '}
          <Link
            href="/legal/terms"
            className="font-semibold text-[color:var(--primary)] hover:underline"
          >
            이용약관
          </Link>
          에서 확인할 수 있습니다.
        </DocumentParagraph>
      </DocumentSection>
    </DocumentPageShell>
  );
}
