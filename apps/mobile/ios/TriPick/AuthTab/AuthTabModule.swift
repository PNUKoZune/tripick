import AuthenticationServices
import UIKit

/**
 로그인용 외부 페이지(카카오 OAuth)를 **앱 안에서** 여는 모듈. Android 의
 `TripickAuthTab`(Custom Tabs)과 같은 이름·같은 JS 계약을 쓴다.

 왜 웹뷰가 아닌가 — 임베디드 웹뷰로 OAuth 를 태우면 앱이 카카오 계정 입력창을 들여다볼 수
 있는 구조가 된다. `ASWebAuthenticationSession` 은 Safari 프로세스에서 돌아 자격증명이
 앱과 분리되고, 주소창이 보여 사용자가 도메인을 확인할 수 있다.

 왜 `SFSafariViewController` 가 아닌가 — 그쪽은 복귀 URL 을 가로채지 못해 앱이 커스텀 스킴
 딥링크로 다시 열릴 때까지 화면 위에 그대로 남는다. 인증 세션은 `callbackURLScheme` 과 맞는
 리다이렉트를 만나면 스스로 닫고 그 URL 을 돌려준다.

 Android 와 다른 점 — 여기서는 복귀 URL 이 **이 promise 의 결과로** 온다(딥링크로 앱이 다시
 열리지 않는다). 그래서 서버는 iOS 요청에 `intent://` 가 아니라 `tripick://` 를 돌려준다.
 */
@objc(TripickAuthTab)
class AuthTabModule: NSObject {

  /// 서버가 돌려주는 복귀 URL 의 스킴. 서버(`APP_SCHEME`)·Android intent 와 같은 값이어야 한다.
  private static let callbackScheme = "tripick"

  /// 세션 객체를 잡고 있지 않으면 시작 직후 해제돼 화면이 그대로 닫힌다.
  private var session: ASWebAuthenticationSession?
  private let anchorProvider = AuthTabPresentationAnchor()

  /**
   - Parameters:
     - url: 열 주소. http/https 만 받는다 — 이 통로로 임의 스킴을 넘겨 다른 앱을 띄우지 못하게.
     - toolbarColor: Android 전용(Custom Tabs 툴바 색). iOS 에는 대응 API 가 없어 무시한다.

   결과: 복귀 URL 문자열, 또는 사용자가 취소했으면 `nil`. 취소를 reject 로 주면 JS 가
   "인앱 브라우저 실패" 로 보고 Safari 로 다시 띄우게 되므로 여기서는 성공으로 돌려준다.
   */
  @objc
  func open(
    _ url: String,
    toolbarColor: String?,
    resolver resolve: @escaping (Any?) -> Void,
    rejecter reject: @escaping (String?, String?, Error?) -> Void
  ) {
    guard let target = URL(string: url),
          let scheme = target.scheme?.lowercased(),
          scheme == "http" || scheme == "https"
    else {
      reject(AuthTabModule.errorCode, "웹 주소만 열 수 있어요.", nil)
      return
    }

    DispatchQueue.main.async {
      let session = ASWebAuthenticationSession(
        url: target,
        callbackURLScheme: AuthTabModule.callbackScheme
      ) { [weak self] callbackURL, error in
        self?.session = nil
        if let callbackURL = callbackURL {
          resolve(callbackURL.absoluteString)
          return
        }
        // 사용자가 닫은 경우. 로그인 시작 전으로 돌아가면 되므로 실패가 아니다.
        if let error = error as? ASWebAuthenticationSessionError,
           error.code == .canceledLogin {
          resolve(nil)
          return
        }
        reject(
          AuthTabModule.errorCode,
          error?.localizedDescription ?? "로그인 창을 열지 못했어요.",
          error
        )
      }
      session.presentationContextProvider = self.anchorProvider
      // 기본값(false) 유지 — Safari 세션을 공유해 이미 카카오에 로그인돼 있으면 그대로 통과한다.
      session.prefersEphemeralWebBrowserSession = false
      self.session = session

      if !session.start() {
        self.session = nil
        reject(AuthTabModule.errorCode, "로그인 창을 열지 못했어요.", nil)
      }
    }
  }

  private static let errorCode = "auth_tab_failed"
}

/// 인증 세션을 띄울 창. 씬 기반이 아닌 셸이라 AppDelegate 의 window 를 먼저 본다.
final class AuthTabPresentationAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    if let window = UIApplication.shared.delegate?.window ?? nil {
      return window
    }
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    return scene?.windows.first ?? ASPresentationAnchor()
  }
}
