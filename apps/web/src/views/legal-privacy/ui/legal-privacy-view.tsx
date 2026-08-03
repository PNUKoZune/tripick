import {
  DocumentList,
  DocumentPageShell,
  DocumentParagraph,
  DocumentSection,
} from '@/shared/ui/document-page';

const UPDATED_AT = '2026년 7월 24일';
// TODO: 발신/고객문의 도메인 확정 시 실제 주소로 교체 (docs 백로그 "발신 도메인 확정")
const CONTACT_EMAIL = 'privacy@tripick.place';

export function LegalPrivacyView() {
  return (
    <DocumentPageShell
      label="개인정보처리방침"
      title="개인정보처리방침"
      description={`시행일 ${UPDATED_AT}`}
    >
      <DocumentSection>
        <DocumentParagraph>
          트리픽(TriPick, 이하 &quot;서비스&quot;)은 이용자의 개인정보를 중요하게 여기며,
          「개인정보 보호법」 등 관련 법령을 준수합니다. 본 방침은 서비스가 수집하는 개인정보의
          항목·목적·보유기간과 이용자의 권리를 안내합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="1. 수집하는 개인정보 항목">
        <DocumentList
          items={[
            '계정 정보: 카카오 계정 식별자, 닉네임·프로필 이미지, 이메일 주소',
            '취향 정보: 이용자가 갤러리에서 직접 선택해 업로드한 사진 및 추출된 취향 태그',
            '위치 정보: 여행 진행 중 미도착 판정을 위한 실시간 위치(이용자 동의 시)',
            '기기 정보: 푸시 알림 발송을 위한 FCM 토큰, 접속 로그',
            '여행 데이터: 생성한 일정, 친구·멤버 관계, 알림 내역',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="2. 개인정보의 수집·이용 목적">
        <DocumentList
          items={[
            '카카오 OAuth·이메일 인증을 통한 회원 식별 및 로그인',
            '취향 사진 분석을 통한 맞춤형 여행 일정 생성',
            '날씨·경로 이탈·혼잡 등 맥락 변화에 따른 알림 발송',
            '친구·멤버 기능 및 여행 공유 제공',
            '서비스 오류 진단 및 품질 개선',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="3. 보유 및 이용 기간">
        <DocumentParagraph>
          이용자의 개인정보는 회원 탈퇴 시까지 보유하며, 탈퇴 시 관련 법령이 정한 보관 의무가 없는 한
          지체 없이 파기합니다. 위치 정보는 미도착 판정에 사용된 뒤 일정 기간 캐시에 보관되며, 만료
          시 자동 삭제됩니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="4. 개인정보의 제3자 제공 및 처리 위탁">
        <DocumentParagraph>
          서비스는 이용자의 개인정보를 동의 없이 외부에 제공하지 않습니다. 다만 서비스 제공을 위해
          아래와 같이 외부 API·인프라에 필요한 최소한의 정보를 전송하거나 처리를 위탁합니다.
        </DocumentParagraph>
        <DocumentList
          items={[
            '카카오(로그인·지도·장소·경로): 계정 인증 및 지도·장소·경로 조회',
            'ODsay: 대중교통 경로 조회',
            '기상청: 여행지 날씨 예보 조회',
            '한국관광공사: 관광지 정보 및 혼잡 예측',
            '네이버(NCP API Hub): 장소 인지도 신호 조회',
            'Firebase(FCM): 푸시 알림 발송',
            'Sentry: 오류 로그 수집(개인 식별 정보 최소화)',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="5. 정보주체의 권리">
        <DocumentParagraph>
          이용자는 언제든지 자신의 개인정보를 열람·정정·삭제하거나 처리 정지를 요구할 수 있으며, 설정
          화면에서 직접 프로필을 수정하거나 계정을 탈퇴할 수 있습니다. 권리 행사는 아래 개인정보
          보호책임자에게 요청할 수 있습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="6. 개인정보의 파기">
        <DocumentParagraph>
          보유 기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적 파일은
          복구할 수 없는 방법으로 삭제하며, 출력물은 분쇄하거나 소각합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="7. 안전성 확보 조치">
        <DocumentParagraph>
          서비스는 접근 권한 관리, 전송 구간 암호화, 접속 기록 보관 등 개인정보를 안전하게 관리하기
          위한 기술적·관리적 조치를 시행합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="8. 개인정보 보호책임자">
        <DocumentParagraph>
          개인정보 처리에 관한 문의·불만·피해 구제는 아래로 연락해 주시기 바랍니다.
        </DocumentParagraph>
        <DocumentParagraph>
          이메일:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[color:var(--primary)] hover:underline">
            {CONTACT_EMAIL}
          </a>
        </DocumentParagraph>
      </DocumentSection>
    </DocumentPageShell>
  );
}
