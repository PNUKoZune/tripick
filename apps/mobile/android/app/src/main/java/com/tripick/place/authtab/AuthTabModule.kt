package com.tripick.place.authtab

import android.graphics.Color
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 로그인용 외부 페이지(카카오 OAuth)를 **인앱 브라우저(Custom Tabs)** 로 여는 모듈.
 *
 * 왜 웹뷰가 아니라 여기인가 — 임베디드 웹뷰로 OAuth 를 태우면 앱이 카카오 계정 입력창을
 * 들여다볼 수 있는 구조가 된다. Custom Tabs 는 화면만 앱 태스크 위에 얹힐 뿐 실행은 브라우저
 * 프로세스라 자격증명이 앱과 분리되고, 주소창이 보여 사용자가 도메인을 확인할 수 있다.
 *
 * 왜 시스템 브라우저(`Linking.openURL`)가 아닌가 — 앱이 통째로 전환됐다가 돌아와야 해서
 * 로그인 한 번에 앱이 두 번 바뀐다. Custom Tabs 는 쿠키 저장소를 크롬과 공유하므로
 * 서버가 심는 state·bind 쿠키 왕복은 그대로 성립한다(서버·카카오 콘솔 변경 없음).
 *
 * 닫기는 따로 없다 — 로그인이 끝나면 서버가 `intent://` 로 앱을 열고, MainActivity 가
 * singleTask 라 앞으로 오면서 그 위에 얹혀 있던 탭이 함께 정리된다.
 */
class AuthTabModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /**
   * @param url 열 주소. http/https 만 받는다 — 이 통로로 임의 스킴을 넘겨 다른 앱을 띄우지 못하게.
   * @param toolbarColor 상단 바 색(`#RRGGBB`). 앱 배경과 맞춰 "앱 안에서 열린" 모양을 유지한다.
   */
  @ReactMethod
  fun open(url: String, toolbarColor: String?, promise: Promise) {
    val uri = runCatching { Uri.parse(url) }.getOrNull()
    if (uri == null || uri.scheme?.lowercase() !in WEB_SCHEMES) {
      promise.reject(ERROR_CODE, "웹 주소만 열 수 있어요.")
      return
    }

    // 현재 액티비티에서 띄워야 앱 태스크 위에 얹힌다. applicationContext 로 띄우면 NEW_TASK 가
    // 필요해 별도 태스크로 빠지고, 그러면 시스템 브라우저와 다를 게 없어진다.
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject(ERROR_CODE, "화면이 없어 인앱 브라우저를 열지 못했어요.")
      return
    }

    val builder =
      CustomTabsIntent.Builder()
        .setShowTitle(true)
        // 주소창을 접지 않는다 — 로그인 중인 도메인이 계속 보여야 인앱 브라우저가 피싱 창처럼
        // 쓰이지 않는다. OAuth 를 웹뷰가 아니라 여기로 보내는 이유가 이것이다.
        .setUrlBarHidingEnabled(false)
        .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
    parseColor(toolbarColor)?.let { color ->
      builder.setDefaultColorSchemeParams(
        CustomTabColorSchemeParams.Builder().setToolbarColor(color).build(),
      )
    }

    try {
      builder.build().launchUrl(activity, uri)
      promise.resolve(null)
    } catch (e: Exception) {
      // 브라우저가 아예 없는 기기 등. JS 가 받아서 시스템 브라우저 위임으로 폴백한다.
      promise.reject(ERROR_CODE, e.message ?: "인앱 브라우저를 열지 못했어요.", e)
    }
  }

  private fun parseColor(value: String?): Int? {
    if (value.isNullOrBlank()) return null
    return runCatching { Color.parseColor(value) }.getOrNull()
  }

  companion object {
    const val NAME = "TripickAuthTab"
    private const val ERROR_CODE = "auth_tab_failed"
    private val WEB_SCHEMES = setOf("http", "https")
  }
}
