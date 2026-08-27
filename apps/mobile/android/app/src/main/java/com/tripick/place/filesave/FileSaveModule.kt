package com.tripick.place.filesave

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * 웹이 만든 파일(이미지·PDF)을 다운로드 폴더에 저장하는 네이티브 모듈.
 *
 * 웹은 html-to-image·jsPDF 결과를 `data:` URI 로 만들어 `<a download>` 로 흘리는데,
 * Android WebView 의 DownloadListener 는 http/https 만 받아 그 요청을 통째로 버린다
 * (`IllegalArgumentException: Can only download HTTP/HTTPS URIs`). 성공·실패 신호도 없어
 * 사용자에겐 "눌러도 아무 일이 없는" 버튼이 된다. 그래서 base64 를 브리지로 받아 여기서 쓴다.
 *
 * - Android 10(Q) 이상: MediaStore.Downloads — 권한 없이 공용 다운로드 폴더에 쓴다.
 * - Q 미만: 앱 전용 외부 저장소(Downloads) — 공용 폴더는 WRITE_EXTERNAL_STORAGE 런타임 권한이
 *   필요한데, 저장 한 번 때문에 저장소 권한을 요구하지 않으려고 앱 폴더로 떨어뜨린다.
 */
class FileSaveModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun saveBase64(fileName: String, mimeType: String, base64: String, promise: Promise) {
    try {
      // 웹이 dataURL 째로 보내도 받아들인다("data:image/png;base64,...").
      val payload = base64.substringAfterLast(",")
      val bytes = Base64.decode(payload, Base64.DEFAULT)
      val safeName = sanitize(fileName)
      val path =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          saveToMediaStore(safeName, mimeType, bytes)
        } else {
          saveToAppDownloads(safeName, bytes)
        }
      promise.resolve(path)
    } catch (e: Exception) {
      promise.reject(ERROR_CODE, e.message ?: "파일을 저장하지 못했어요.", e)
    }
  }

  private fun saveToMediaStore(fileName: String, mimeType: String, bytes: ByteArray): String {
    val resolver = reactContext.contentResolver
    val values =
      ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, fileName)
        put(MediaStore.Downloads.MIME_TYPE, mimeType)
        // 쓰는 동안 다른 앱에 노출되지 않게 잠갔다가, 다 쓰고 푼다.
        put(MediaStore.Downloads.IS_PENDING, 1)
      }
    val uri =
      resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("다운로드 폴더에 파일을 만들지 못했어요.")

    resolver.openOutputStream(uri)?.use { it.write(bytes) }
      ?: throw IllegalStateException("다운로드 폴더에 쓸 수 없어요.")

    values.clear()
    values.put(MediaStore.Downloads.IS_PENDING, 0)
    resolver.update(uri, values, null, null)
    return uri.toString()
  }

  private fun saveToAppDownloads(fileName: String, bytes: ByteArray): String {
    val dir =
      reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        ?: throw IllegalStateException("저장 폴더를 열 수 없어요.")
    if (!dir.exists()) dir.mkdirs()
    val file = File(dir, fileName)
    file.writeBytes(bytes)
    return file.absolutePath
  }

  /** 경로 구분자·제어문자를 걷어내 파일명으로만 쓰이게 한다. */
  private fun sanitize(fileName: String): String {
    val trimmed = fileName.substringAfterLast('/').substringAfterLast('\\').trim()
    val cleaned = trimmed.replace(Regex("[\\p{Cntrl}:*?\"<>|]"), "")
    return cleaned.ifBlank { "tripick" }
  }

  companion object {
    const val NAME = "TripickFileSave"
    private const val ERROR_CODE = "E_FILE_SAVE"
  }
}
