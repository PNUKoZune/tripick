import {
  DocumentList,
  DocumentPageShell,
  DocumentParagraph,
  DocumentSection,
} from '@/shared/ui/document-page';

const UPDATED_AT = '2026년 7월 24일';

export function LegalTermsView() {
  return (
    <DocumentPageShell label="이용약관" title="이용약관" description={`시행일 ${UPDATED_AT}`}>
      <DocumentSection heading="제1조 (목적)">
        <DocumentParagraph>
          본 약관은 트리픽(TriPick, 이하 &quot;서비스&quot;)이 제공하는 AI 여행 일정 추천 및 관련
          기능의 이용 조건과 절차, 회원과 서비스 제공자의 권리·의무·책임 사항을 규정함을 목적으로
          합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제2조 (정의)">
        <DocumentList
          items={[
            '"회원"이란 본 약관에 동의하고 카카오 계정 또는 이메일로 서비스에 가입한 이용자를 말합니다.',
            '"콘텐츠"란 회원이 서비스에 업로드하는 취향 사진, 여행 일정, 친구·멤버 정보 등 일체의 자료를 말합니다.',
            '"AI 추천"이란 회원의 취향 분석과 외부 데이터를 바탕으로 서비스가 자동 생성하는 여행 일정·대안·알림을 말합니다.',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="제3조 (약관의 효력 및 변경)">
        <DocumentParagraph>
          본 약관은 서비스 화면에 게시함으로써 효력이 발생합니다. 서비스는 관련 법령을 위배하지 않는
          범위에서 약관을 변경할 수 있으며, 변경 시 적용일과 사유를 명시하여 적용일 7일 전(회원에게
          불리하거나 중대한 변경은 30일 전)부터 공지합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제4조 (서비스의 제공)">
        <DocumentList
          items={[
            '취향 사진 분석 기반 국내 여행 일정 자동 생성',
            '날씨·경로 이탈(미도착)·혼잡 등 실시간 맥락 변화에 따른 일정 조정 추천 알림',
            '친구·멤버와의 여행 공유 및 조율',
            '서비스는 운영상·기술상 필요에 따라 제공 내용을 변경하거나 일부를 중단할 수 있습니다.',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="제5조 (회원가입 및 계정)">
        <DocumentParagraph>
          회원가입은 이용자가 약관에 동의하고 카카오 로그인 또는 이메일 인증을 완료하면 성립합니다.
          회원은 하나의 계정을 본인이 직접 관리해야 하며, 계정 정보의 부정 사용을 인지한 경우 즉시
          서비스에 통지해야 합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제6조 (회원의 의무)">
        <DocumentList
          items={[
            '타인의 정보를 도용하거나 허위 정보를 등록하지 않을 것',
            '타인의 저작권·초상권 등 권리를 침해하는 사진·콘텐츠를 업로드하지 않을 것',
            '서비스의 정상적인 운영을 방해하는 행위를 하지 않을 것',
            '관련 법령과 본 약관, 서비스 이용 안내를 준수할 것',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="제7조 (AI 추천의 한계와 면책)">
        <DocumentParagraph>
          AI 추천 일정과 알림은 참고용 정보이며, 영업시간·이동시간·날씨·혼잡 등은 외부 데이터에
          기반해 실제와 다를 수 있습니다. 회원은 최종 방문·이동 여부를 스스로 판단해야 하며, 서비스는
          추천 정보에 대한 완전성·정확성을 보증하지 않습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제8조 (콘텐츠의 권리)">
        <DocumentParagraph>
          회원이 업로드한 콘텐츠의 저작권은 회원에게 있습니다. 서비스는 일정 생성·취향 분석 등 서비스
          제공에 필요한 범위에서만 콘텐츠를 이용하며, 이를 초과하는 목적으로 사용하지 않습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제9조 (계약 해지 및 탈퇴)">
        <DocumentParagraph>
          회원은 언제든지 설정 화면에서 탈퇴할 수 있으며, 탈퇴 시 계정과 관련 데이터는 관련 법령이
          정한 보관 의무가 없는 한 지체 없이 삭제됩니다. 서비스는 회원이 약관을 위반한 경우 이용을
          제한하거나 계약을 해지할 수 있습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제10조 (책임의 제한)">
        <DocumentParagraph>
          서비스는 천재지변, 외부 API 장애, 회원의 귀책 사유로 인한 손해에 대해 책임을 지지 않습니다.
          서비스는 무료로 제공되는 기능의 이용과 관련하여 발생한 손해에 대해 고의 또는 중대한 과실이
          없는 한 책임을 부담하지 않습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제11조 (준거법 및 관할)">
        <DocumentParagraph>
          본 약관은 대한민국 법령에 따라 해석되며, 서비스 이용과 관련하여 분쟁이 발생한 경우
          민사소송법상의 관할 법원을 제1심 관할 법원으로 합니다.
        </DocumentParagraph>
      </DocumentSection>
    </DocumentPageShell>
  );
}
