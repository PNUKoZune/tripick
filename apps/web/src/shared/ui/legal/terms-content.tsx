import Link from 'next/link';

import { DocumentList, DocumentParagraph, DocumentSection } from '@/shared/ui/document-page';
import { SUPPORT_EMAIL } from '@/shared/config/contact';

/**
 * 이용약관 본문. 페이지({@link LegalTermsView})와 가입 동의 화면의 모달이 **같은 원문**을
 * 쓰도록 셸에서 떼어냈다 — 둘로 복사하면 한쪽만 개정되는 사고가 난다.
 */
/**
 * 다른 문서를 가리키는 참조. 모달 안(`linkable=false`)에서는 링크로 두지 않는다 —
 * 누르면 가입하던 화면을 떠나 동의 절차가 끊긴다.
 */
function DocRef({
  href,
  linkable,
  children,
}: {
  href: string;
  linkable: boolean;
  children: React.ReactNode;
}) {
  if (!linkable) {
    return <span className="font-semibold text-[color:var(--ink)]">{children}</span>;
  }
  return (
    <Link href={href} className="font-semibold text-[color:var(--primary)] hover:underline">
      {children}
    </Link>
  );
}

export function TermsContent({ linkable = true }: { linkable?: boolean }) {
  return (
    <>
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
            '"공유 링크"란 회원이 자신의 여행 일정을 외부에 보여주기 위해 서비스에서 생성하는, 로그인 없이 열람 가능한 주소를 말합니다.',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="제3조 (약관의 효력 및 변경)">
        <DocumentParagraph>
          본 약관은 서비스 화면에 게시함으로써 효력이 발생합니다. 서비스는 관련 법령을 위배하지 않는
          범위에서 약관을 변경할 수 있으며, 변경 시 적용일과 사유를 명시하여 적용일 7일 전(회원에게
          불리하거나 중대한 변경은 30일 전)부터 공지합니다. 회원이 변경된 약관에 동의하지 않는 경우
          적용일 전까지 탈퇴할 수 있으며, 적용일 이후에도 서비스를 계속 이용하면 변경에 동의한
          것으로 봅니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제4조 (서비스의 제공)">
        <DocumentList
          items={[
            '취향 사진 분석 기반 국내 여행 일정 자동 생성 및 재계획',
            '날씨·경로 이탈(미도착)·혼잡 등 실시간 맥락 변화에 따른 일정 조정 추천 알림',
            '친구·멤버와의 여행 공유 및 조율, 공유 링크를 통한 일정 열람',
            '서비스는 현재 회원에게 무상으로 제공되며, 유료 기능을 도입하는 경우 사전에 공지하고 별도의 동의를 받습니다.',
            '서비스는 운영상·기술상 필요에 따라 제공 내용을 변경하거나 일부를 중단할 수 있습니다.',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="제5조 (회원가입 및 계정)">
        <DocumentParagraph>
          회원가입은 이용자가 약관에 동의하고 카카오 로그인 또는 이메일 인증을 완료하면 성립합니다.
          회원은 하나의 계정을 본인이 직접 관리해야 하며, 계정 정보의 부정 사용을 인지한 경우 즉시
          서비스에 통지해야 합니다. 서비스는 만 14세 미만 아동의 가입을 받지 않으며, 만 14세 미만
          임이 확인된 계정은 이용을 제한하고 관련 정보를 파기할 수 있습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제6조 (회원의 의무)">
        <DocumentList
          items={[
            '타인의 정보를 도용하거나 허위 정보를 등록하지 않을 것',
            '타인의 저작권·초상권 등 권리를 침해하는 사진·콘텐츠를 업로드하지 않을 것',
            '타인이 촬영 대상인 사진을 업로드할 때에는 해당 인물의 동의를 받을 것',
            '서비스의 정상적인 운영을 방해하거나, 자동화된 수단으로 과도한 요청을 발생시키지 않을 것',
            '관련 법령과 본 약관, 서비스 이용 안내를 준수할 것',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="제7조 (AI 추천의 한계와 면책)">
        <DocumentParagraph>
          AI 추천 일정과 알림은 참고용 정보이며, 영업시간·이동시간·날씨·혼잡 등은 외부 데이터에
          기반해 실제와 다를 수 있습니다. 회원은 최종 방문·이동 여부를 스스로 판단해야 하며,
          서비스는 추천 정보에 대한 완전성·정확성을 보증하지 않습니다. 특히 미도착·날씨·혼잡 알림은
          일정 조정을 &quot;추천&quot;할 뿐 일정을 자동으로 변경하지 않으므로, 알림의 지연·누락을
          이유로 한 여행 일정상의 손해에 대해서는 서비스가 책임을 지지 않습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제8조 (위치정보의 이용)">
        <DocumentParagraph>
          서비스는 여행 진행 중 일정 항목의 도착 여부를 판정해 알림을 보내기 위한 목적으로만 회원의
          위치 정보를 이용하며, 기기의 위치 권한을 허용한 경우에 한합니다. 회원은 기기 설정에서
          언제든지 위치 권한을 철회할 수 있고, 철회 시 미도착 알림을 제외한 나머지 기능은 그대로
          이용할 수 있습니다. 위치 정보의 보유 기간과 처리 방법은 개인정보처리방침에서 정합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제9조 (여행 공유 링크)">
        <DocumentParagraph>
          회원이 생성한 공유 링크는 로그인 없이 누구나 열람할 수 있으므로, 링크를 전달받은 사람은
          해당 여행의 제목·목적지·일정 내용을 볼 수 있습니다. 회원은 링크를 공개된 장소에 게시할 때
          이 점을 고려해야 하며, 공유를 원하지 않게 된 경우 서비스 화면에서 링크를 해제할 수
          있습니다. 링크 전달 이후 제3자의 열람으로 발생한 결과에 대해서는 서비스가 책임을 지지
          않습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제10조 (콘텐츠의 권리)">
        <DocumentParagraph>
          회원이 업로드한 콘텐츠의 저작권은 회원에게 있습니다. 서비스는 일정 생성·취향 분석 등
          서비스 제공에 필요한 범위에서만 콘텐츠를 이용하며, 이를 초과하는 목적으로 사용하지
          않습니다. 서비스는 회원의 콘텐츠를 광고·마케팅 소재로 사용하거나 AI 모델 학습 데이터로
          제3자에게 제공하지 않습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제11조 (개인정보의 보호)">
        <DocumentParagraph>
          서비스는 회원의 개인정보를 관련 법령과{' '}
          <DocRef href="/legal/privacy" linkable={linkable}>
            개인정보처리방침
          </DocRef>
          에 따라 보호합니다. 수집 항목·이용 목적·보유 기간, 처리 위탁과 국외 이전, 이용자의 권리
          행사 방법은 개인정보처리방침에서 정하며, 해당 방침은 본 약관의 일부를 이룹니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제12조 (서비스의 중단 및 공지)">
        <DocumentParagraph>
          서비스는 설비 점검·교체, 외부 API 장애, 천재지변 등의 사유로 서비스 제공을 일시적으로
          중단할 수 있으며, 사전에 예측 가능한 경우 서비스 화면에 미리 공지합니다. 회원에 대한 개별
          통지가 필요한 경우에는 회원이 등록한 이메일 또는 앱 알림으로 통지합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제13조 (계약 해지 및 탈퇴)">
        <DocumentParagraph>
          회원은 언제든지 설정 화면에서 탈퇴할 수 있으며, 탈퇴 시 계정과 관련 데이터는 관련 법령이
          정한 보관 의무가 없는 한 지체 없이 삭제됩니다. 탈퇴는 유예 기간 없이 즉시 처리되어 되돌릴
          수 없으므로, 필요한 일정은 미리 저장해 두시기 바랍니다. 서비스는 회원이 약관을 위반한 경우
          이용을 제한하거나 계약을 해지할 수 있으며, 이 경우 사유를 회원에게 통지합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제14조 (책임의 제한)">
        <DocumentParagraph>
          서비스는 천재지변, 외부 API 장애, 회원의 귀책 사유로 인한 손해에 대해 책임을 지지
          않습니다. 서비스는 무료로 제공되는 기능의 이용과 관련하여 발생한 손해에 대해 고의 또는
          중대한 과실이 없는 한 책임을 부담하지 않습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제15조 (문의)">
        <DocumentParagraph>
          서비스 이용과 관련한 문의는{' '}
          <DocRef href="/support" linkable={linkable}>
            고객센터
          </DocRef>{' '}
          또는{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-semibold text-[color:var(--primary)] hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          로 접수할 수 있습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="제16조 (준거법 및 관할)">
        <DocumentParagraph>
          본 약관은 대한민국 법령에 따라 해석되며, 서비스 이용과 관련하여 분쟁이 발생한 경우
          민사소송법상의 관할 법원을 제1심 관할 법원으로 합니다.
        </DocumentParagraph>
      </DocumentSection>
    </>
  );
}
