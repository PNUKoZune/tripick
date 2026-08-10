package com.tripick.place.location

import android.annotation.SuppressLint
import android.location.Location
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * 여행 진행 중 백그라운드 위치 추적 네이티브 모듈.
 *
 * - start: foreground service 를 띄우고 FusedLocationProvider 로 위치 업데이트를 구독한다.
 * - 위치가 갱신되면 `TripickLocationUpdate` 이벤트로 JS 에 좌표를 emit 한다.
 * - stop: 업데이트 구독을 해제하고 service 를 내린다.
 *
 * 권한(ACCESS_FINE_LOCATION)은 JS(App.tsx)에서 미리 요청한다.
 */
class LocationTrackingModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val fusedClient = LocationServices.getFusedLocationProviderClient(reactContext)
  private var callback: LocationCallback? = null

  override fun getName(): String = NAME

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun start() {
    if (callback != null) return // 이미 추적 중

    LocationTrackingService.start(reactContext)

    val request =
      LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
        .setMinUpdateIntervalMillis(FASTEST_INTERVAL_MS)
        .setMinUpdateDistanceMeters(MIN_DISTANCE_M)
        .build()

    val cb =
      object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
          result.lastLocation?.let { emitLocation(it) }
        }
      }
    callback = cb

    try {
      fusedClient.requestLocationUpdates(request, cb, reactContext.mainLooper)
    } catch (e: SecurityException) {
      emitError(1, e.message ?: "위치 권한이 없어요.")
      stop()
    }
  }

  @ReactMethod
  fun stop() {
    callback?.let { fusedClient.removeLocationUpdates(it) }
    callback = null
    LocationTrackingService.stop(reactContext)
  }

  // NativeEventEmitter 가 요구하는 no-op (JS 경고 방지)
  @ReactMethod fun addListener(eventName: String) = Unit

  @ReactMethod fun removeListeners(count: Int) = Unit

  private fun emitLocation(location: Location) {
    val payload =
      Arguments.createMap().apply {
        putDouble("lat", location.latitude)
        putDouble("lng", location.longitude)
        putDouble("accuracy", location.accuracy.toDouble())
        putDouble("timestamp", location.time.toDouble())
      }
    emit(EVENT_NAME, payload)
  }

  private fun emitError(code: Int, message: String) {
    val payload =
      Arguments.createMap().apply {
        putInt("code", code)
        putString("message", message)
      }
    emit(EVENT_ERROR, payload)
  }

  private fun emit(event: String, payload: WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, payload)
  }

  companion object {
    const val NAME = "LocationTracking"
    const val EVENT_NAME = "TripickLocationUpdate"
    const val EVENT_ERROR = "TripickLocationError"
    private const val INTERVAL_MS = 5000L
    private const val FASTEST_INTERVAL_MS = 3000L
    private const val MIN_DISTANCE_M = 10f
  }
}
