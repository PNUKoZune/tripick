package com.tripick.place.appinfo

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.tripick.place.BuildConfig

/**
 * 설치된 앱 자신의 버전을 JS 에 알려주는 모듈.
 *
 * 설정 화면의 "버전" 은 웹 빌드 버전(`NEXT_PUBLIC_APP_VERSION` = apps/web/package.json)을 보여
 * 왔는데, 앱에서 보면 스토어에 올라간 버전(versionName)과 달라 사용자가 헷갈린다. 웹 배포와 앱
 * 릴리스는 주기가 달라 두 숫자를 억지로 맞출 수도 없으니, 앱 안에서는 앱 버전을 보여준다.
 */
class AppInfoModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> =
    mapOf(
      "version" to BuildConfig.VERSION_NAME,
      "build" to BuildConfig.VERSION_CODE.toString(),
    )

  companion object {
    const val NAME = "TripickAppInfo"
  }
}
