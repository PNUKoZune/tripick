package com.tripick.place

import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "TriPick"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    applyWindowInsetsAsPadding()
  }

  /**
   * 시스템 바 인셋을 루트 컨테이너 패딩으로 얹는다.
   *
   * targetSdk 35+ 는 Android 15 부터 edge-to-edge 가 강제고 16(targetSdk 36)에선 opt-out 도
   * 무시된다 — 창이 상태바·내비바 밑까지 깔린다. 화면 전체가 웹뷰 한 장인 셸이라 그대로 두면
   * 웹 헤더가 상태바에, 하단 탭·바텀시트가 내비바에 잘린다.
   *
   * 웹의 `env(safe-area-inset-*)` 도 (viewport-fit=cover 를 켜면) 같은 값을 주지만, 그건 웹뷰가
   * 인셋을 노출하는 크로미움 버전에서만이다. 여기서 먼저 걷어내면 웹뷰가 안전 영역 안에만 그려져
   * env() 는 0 이 되므로 두 겹으로 밀리지 않는다.
   *
   * ime 인셋을 같이 보는 이유 — edge-to-edge 에선 `adjustResize` 가 창을 줄여주지 않아,
   * 키보드가 올라와도 웹뷰가 그대로면 입력창이 가린다. 둘 중 큰 쪽을 하단 패딩으로 쓴다.
   */
  private fun applyWindowInsetsAsPadding() {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val bars =
          windowInsets.getInsets(
              WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
