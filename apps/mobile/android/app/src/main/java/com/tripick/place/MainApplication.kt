package com.tripick.place

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.tripick.place.filesave.FileSavePackage
import com.tripick.place.location.LocationTrackingPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // 백그라운드 위치 추적 foreground service 모듈 (autolink 불가, 수동 등록)
          add(LocationTrackingPackage())
          // 웹이 만든 이미지·PDF 를 다운로드 폴더에 저장하는 모듈 (WebView 는 data: URI 를 못 받는다)
          add(FileSavePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
