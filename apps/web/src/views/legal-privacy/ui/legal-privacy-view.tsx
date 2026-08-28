import {
  DocumentList,
  DocumentPageShell,
  DocumentParagraph,
  DocumentSection,
} from '@/shared/ui/document-page';
import { LEGAL_UPDATED_AT, PRIVACY_EMAIL } from '@/shared/config/contact';

/** 미도착 판정용 위치 캐시 TTL. 서버 `arrival-alert.constants.ts` 의 LOCATION_TTL_SEC 과 같은 값. */
const LOCATION_TTL_LABEL = '15분';

function MailLink() {
  return (
    <a
      href={`mailto:${PRIVACY_EMAIL}`}
      className="font-semibold text-[color:var(--primary)] hover:underline"
    >
      {PRIVACY_EMAIL}
    </a>
  );
}

export function LegalPrivacyView() {
  return (
    <DocumentPageShell
      label="개인정보처리방침"
      title="개인정보처리방침"
      description={`시행일 ${LEGAL_UPDATED_AT}`}
    >
      <DocumentSection>
        <DocumentParagraph>
          트리픽(TriPick, 이하 &quot;서비스&quot;)은 이용자의 개인정보를 중요하게 여기며,
          「개인정보 보호법」·「위치정보의 보호 및 이용 등에 관한 법률」 등 관련 법령을 준수합니다.
          본 방침은 서비스가 수집하는 개인정보의 항목·목적·보유기간, 처리 위탁과 국외 이전, 그리고
          이용자의 권리와 행사 방법을 안내합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="1. 수집하는 개인정보 항목">
        <DocumentParagraph>
          서비스는 회원가입과 서비스 제공에 필요한 최소한의 정보만 수집합니다. 아래 &quot;선택&quot;
          항목은 동의하지 않아도 서비스의 기본 기능을 이용할 수 있습니다.
        </DocumentParagraph>
        <DocumentList
          items={[
            '[필수] 계정 정보: 이메일 주소, 비밀번호(단방향 암호화 저장), 닉네임 — 이메일 가입 시',
            '[필수] 계정 정보: 카카오 회원번호, 카카오 계정 이메일, 닉네임·프로필 이미지 — 카카오 로그인 시',
            '[선택] 프로필 정보: 친구 추가용 핸들, 직접 올린 프로필 이미지',
            '[선택] 취향 정보: 이용자가 갤러리에서 직접 선택해 올린 사진과 그로부터 추출된 취향 태그',
            '[선택] 위치 정보: 여행 진행 중 미도착 판정을 위한 실시간 위치(기기 권한 허용 시에만)',
            '[선택] 기기 정보: 푸시 알림 발송을 위한 FCM 토큰(알림 허용 시에만)',
            '[필수] 여행 데이터: 생성한 여행·일정, 친구·멤버 관계, 알림 내역, 탈퇴 사유(익명)',
            '[자동 수집] 서비스 이용 과정에서 접속 IP·브라우저 정보·접속 일시·오류 로그가 자동으로 생성·수집됩니다.',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="2. 개인정보의 수집·이용 목적">
        <DocumentList
          items={[
            '카카오 OAuth·이메일 인증을 통한 회원 식별, 로그인, 비밀번호 재설정',
            '취향 사진 분석을 통한 맞춤형 여행 일정 생성 및 재계획',
            '날씨·경로 이탈(미도착)·혼잡 등 맥락 변화에 따른 알림 발송',
            '친구·멤버 기능 및 여행 공유 링크 제공',
            '서비스 오류 진단, 부정 이용 방지, 품질 개선',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="3. 보유 및 이용 기간">
        <DocumentParagraph>
          개인정보는 수집·이용 목적이 달성되면 지체 없이 파기하며, 항목별 보유 기간은 다음과
          같습니다.
        </DocumentParagraph>
        <DocumentList
          items={[
            '계정·프로필·여행 데이터: 회원 탈퇴 시까지 (탈퇴 즉시 삭제, 유예 기간 없음)',
            '취향 사진과 취향 태그: 이용자가 직접 삭제하거나 탈퇴할 때까지 — 탈퇴 시 저장소의 원본 파일까지 함께 삭제',
            `위치 정보: 서버 캐시에 ${LOCATION_TTL_LABEL} 동안만 보관되며 만료 시 자동 삭제 (별도의 이동 경로 이력은 저장하지 않음)`,
            'FCM 토큰: 알림 해제 또는 탈퇴 시까지',
            '접속 로그·오류 로그: 수집일로부터 최대 90일 (오류 진단 목적, 위탁사 보관 정책에 따름)',
            '탈퇴 사유: 계정과 연결되지 않는 익명 통계 형태로 보관 (개인을 다시 식별할 수 없음)',
            '관련 법령이 별도의 보관을 요구하는 경우에는 해당 기간 동안 분리 보관 후 파기합니다.',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="4. 개인정보의 제3자 제공">
        <DocumentParagraph>
          서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 따라 수사기관 등이
          적법한 절차로 요구하는 경우에는 예외로 합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="5. 개인정보 처리의 위탁">
        <DocumentParagraph>
          서비스 제공을 위해 아래와 같이 처리를 위탁하고 있으며, 위탁 계약 시 개인정보가 안전하게
          관리되도록 필요한 사항을 규정하고 있습니다.
        </DocumentParagraph>
        <DocumentList
          items={[
            'Vercel Inc. — 웹 서비스 호스팅',
            'Railway Corp. — API 서버 및 데이터베이스(계정·여행·취향 태그) 운영',
            'Cloudflare, Inc. — 사진 파일 저장(객체 스토리지) 및 도메인 관리',
            'RunPod, Inc. — 취향 사진 분석·일정 생성을 위한 AI 추론 서버 운영',
            'Google LLC (Firebase) — 푸시 알림 발송',
            'Resend, Inc. — 이메일 인증·비밀번호 재설정 메일 발송',
            'Functional Software, Inc. (Sentry) — 오류 로그 수집 (개인 식별 정보 최소화)',
            '카카오 — 카카오 로그인을 통한 회원 인증',
          ]}
        />
        <DocumentParagraph>
          이와 별개로 지도·경로·날씨·관광 정보 조회를 위해 카카오(지도·장소·길찾기), ODsay(대중교통
          경로), 기상청(날씨 예보), 한국관광공사(관광지 정보·혼잡 예측), 네이버클라우드(장소 인지도
          조회)에 조회 조건(좌표·검색어 등)을 전송합니다. 이때 계정을 식별할 수 있는 정보는 함께
          보내지 않습니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="6. 개인정보의 국외 이전">
        <DocumentParagraph>
          위 수탁사 중 다음 사업자는 국외에 서버를 두고 있어, 서비스 이용 시점에 정보통신망을 통해
          개인정보가 국외로 이전됩니다. 이전되는 개인정보는 각 수탁 업무 수행에 필요한 범위로
          한정되며, 보유 기간은 위 3항의 기간과 같습니다.
        </DocumentParagraph>
        <DocumentList
          items={[
            'Vercel Inc. (미국) — 접속 로그·요청 정보 / 웹 서비스 호스팅',
            'Railway Corp. (미국) — 계정·여행·취향 태그·위치 캐시 / 서버·데이터베이스 운영',
            'Cloudflare, Inc. (미국) — 프로필 이미지·취향 사진 / 파일 저장',
            'RunPod, Inc. (미국, 연산 리전 유럽) — 취향 사진·일정 생성 입력값 / AI 추론',
            'Google LLC (미국) — FCM 토큰·알림 내용 / 푸시 발송',
            'Resend, Inc. (미국) — 이메일 주소·메일 본문 / 메일 발송',
            'Functional Software, Inc. (미국) — 오류 로그 / 오류 진단',
          ]}
        />
        <DocumentParagraph>
          국외 이전을 원하지 않는 경우 회원 탈퇴를 통해 거부할 수 있으나, 이전되는 정보가 서비스
          제공에 필수적이어서 서비스 이용은 제한됩니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="7. 위치정보의 처리">
        <DocumentParagraph>
          서비스는 여행이 진행 중인 동안, 일정 항목에 제때 도착했는지 판정해 알림을 보내기 위한
          목적으로만 위치 정보를 이용합니다.
        </DocumentParagraph>
        <DocumentList
          items={[
            '수집은 기기의 위치 권한을 허용하고 여행이 진행 중일 때만 이루어지며, 그 외에는 수집하지 않습니다.',
            `수집한 위치는 서버 캐시에 ${LOCATION_TTL_LABEL} TTL 로만 저장되고 만료 시 자동 삭제되며, 이동 경로 이력으로 축적하지 않습니다.`,
            '위치 정보를 제3자에게 제공하거나 광고 목적으로 이용하지 않습니다.',
            '기기 설정 또는 브라우저 설정에서 위치 권한을 언제든지 철회할 수 있으며, 철회 시 미도착 알림만 동작하지 않고 나머지 기능은 그대로 이용할 수 있습니다.',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="8. 쿠키 등 자동 수집 장치의 운영">
        <DocumentParagraph>
          서비스는 광고·행태정보 수집 목적의 쿠키를 사용하지 않습니다. 카카오 로그인 과정에서
          요청 위·변조를 막기 위한 일회성 쿠키를 사용하며, 로그인 상태 유지에는 이용자 기기의
          브라우저 저장소(localStorage)를 사용합니다.
        </DocumentParagraph>
        <DocumentParagraph>
          브라우저 설정에서 쿠키 저장을 거부할 수 있으나, 이 경우 카카오 로그인이 정상적으로
          완료되지 않을 수 있습니다. 저장된 로그인 정보는 로그아웃 시 삭제됩니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="9. 정보주체와 법정대리인의 권리·의무 및 행사 방법">
        <DocumentParagraph>
          이용자는 언제든지 자신의 개인정보를 열람·정정·삭제하거나 처리 정지를 요구할 수 있습니다.
        </DocumentParagraph>
        <DocumentList
          items={[
            '열람·정정: 설정 → 프로필에서 닉네임·핸들·프로필 이미지를 직접 확인하고 수정할 수 있습니다.',
            '삭제: 취향 사진은 취향 설정 화면에서 개별 삭제할 수 있고, 계정 전체는 설정 → 회원 탈퇴로 삭제할 수 있습니다.',
            '처리 정지: 알림 수신은 설정 → 알림에서 항목별로 끌 수 있고, 위치 처리는 기기 권한 철회로 중지할 수 있습니다.',
            '위 방법으로 처리하기 어려운 요청은 아래 개인정보 보호책임자에게 이메일로 요청할 수 있으며, 접수일로부터 10일 이내에 처리 결과를 알려드립니다.',
            '법정대리인이나 위임받은 자를 통해서도 권리를 행사할 수 있으며, 이 경우 위임 사실을 확인할 수 있는 자료를 요청할 수 있습니다.',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="10. 만 14세 미만 아동의 개인정보">
        <DocumentParagraph>
          서비스는 만 14세 미만 아동의 회원가입을 받지 않으며, 만 14세 미만 아동의 개인정보를
          수집하지 않습니다. 만 14세 미만 아동의 개인정보가 수집된 사실을 확인한 경우 지체 없이
          해당 정보를 파기합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="11. 개인정보의 파기">
        <DocumentParagraph>
          보유 기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적 파일
          형태의 정보는 복구할 수 없는 방법으로 삭제하며, 출력물은 분쇄하거나 소각합니다. 회원
          탈퇴 시에는 계정과 여행 데이터뿐 아니라 저장소에 올려 둔 프로필·취향 사진 원본까지 함께
          삭제합니다.
        </DocumentParagraph>
      </DocumentSection>

      <DocumentSection heading="12. 안전성 확보 조치">
        <DocumentList
          items={[
            '접근 권한 관리: 개인정보 처리 시스템의 접근 권한을 최소 인원으로 제한하고 인증 토큰의 유효기간을 두어 관리합니다.',
            '전송 구간 암호화: 앱·웹과 서버 사이의 모든 통신을 HTTPS 로 암호화합니다.',
            '비밀번호 보호: 비밀번호는 복호화할 수 없는 방식으로 단방향 암호화해 저장합니다.',
            '취향 사진 보호: 취향 사진은 외부에서 직접 접근할 수 없는 비공개 저장소에 두고, 열람 시마다 짧은 시간 뒤 만료되는 임시 링크로만 제공합니다.',
            '접속 기록 보관: 개인정보 처리 시스템의 접속 기록과 오류 로그를 보관하고 점검합니다.',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="13. 개인정보 보호책임자">
        <DocumentParagraph>
          개인정보 처리에 관한 문의·불만·피해 구제는 아래로 연락해 주시기 바랍니다. 접수된 문의에는
          성실하게 답변드리겠습니다.
        </DocumentParagraph>
        <DocumentList
          items={[
            <>
              개인정보 보호책임자: TriPick 운영자 (이메일 <MailLink />)
            </>,
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="14. 권익침해 구제 방법">
        <DocumentParagraph>
          개인정보 침해로 인한 상담·분쟁 조정이 필요한 경우 아래 기관에 문의할 수 있습니다.
        </DocumentParagraph>
        <DocumentList
          items={[
            '개인정보 분쟁조정위원회 — 1833-6972 (www.kopico.go.kr)',
            '개인정보침해 신고센터 — 118 (privacy.kisa.or.kr)',
            '대검찰청 사이버수사과 — 1301 (www.spo.go.kr)',
            '경찰청 사이버수사국 — 182 (ecrm.police.go.kr)',
          ]}
        />
      </DocumentSection>

      <DocumentSection heading="15. 개인정보처리방침의 변경">
        <DocumentParagraph>
          본 방침의 내용이 변경되는 경우, 변경 사항과 적용일을 서비스 화면에 적용일 7일 전(이용자
          권리에 중대한 영향을 미치는 변경은 30일 전)부터 공지합니다. 시행일은 문서 상단에
          표시합니다.
        </DocumentParagraph>
      </DocumentSection>
    </DocumentPageShell>
  );
}
