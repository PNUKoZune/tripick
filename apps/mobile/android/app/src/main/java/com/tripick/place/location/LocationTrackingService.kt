package com.tripick.place.location

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * 여행 진행 중 위치 추적을 백그라운드(화면 꺼짐·앱 백그라운드)에서도 허용하기 위한
 * foregroundServiceType="location" 포그라운드 서비스.
 *
 * 위치 요청·이벤트 emit 은 LocationTrackingModule 이 담당하고,
 * 이 서비스는 안드로이드가 백그라운드 위치를 허용하도록 "지속 알림"만 유지한다.
 */
class LocationTrackingService : Service() {

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // 시스템이 종료해도 재시작하지 않는다 (추적은 JS 가 명시적으로 다시 시작).
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun buildNotification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "여행 위치 추적", NotificationManager.IMPORTANCE_LOW),
        )
      }
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("TriPick 여행 진행 중")
      .setContentText("실시간 위치로 경로 이탈을 확인하고 있어요.")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "tripick-location"
    private const val NOTIFICATION_ID = 4815

    fun start(context: Context) {
      val intent = Intent(context, LocationTrackingService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, LocationTrackingService::class.java))
    }
  }
}
