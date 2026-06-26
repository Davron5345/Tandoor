package com.tandoor.snab;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

  private File getApkFile(int versionCode) {
    return new File(getContext().getCacheDir(), "snab-update-v" + versionCode + ".apk");
  }

  private boolean isValidApk(File file) {
    if (file == null || !file.exists() || file.length() < 3L * 1024L * 1024L) {
      return false;
    }
    try (FileInputStream fis = new FileInputStream(file)) {
      byte[] magic = new byte[2];
      if (fis.read(magic) < 2) return false;
      return magic[0] == 0x50 && magic[1] == 0x4B;
    } catch (Exception e) {
      return false;
    }
  }

  private void emitProgress(String phase, long loaded, long total, Integer percent, String label) {
    JSObject progress = new JSObject();
    progress.put("phase", phase);
    progress.put("loaded", loaded);
    if (total > 0) progress.put("total", total);
    if (percent != null) progress.put("percent", percent);
    if (label != null) progress.put("label", label);
    notifyListeners("apkUpdateProgress", progress);
  }

  private void openInstaller(Activity activity, File file, PluginCall call) {
    try {
      Uri uri = FileProvider.getUriForFile(
        activity,
        activity.getPackageName() + ".fileprovider",
        file
      );

      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(uri, "application/vnd.android.package-archive");
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      }

      activity.startActivity(intent);

      JSObject result = new JSObject();
      result.put("path", file.getAbsolutePath());
      result.put("size", file.length());
      call.resolve(result);
    } catch (Exception e) {
      String message = e.getMessage() != null ? e.getMessage() : "Install failed";
      if (message.contains("No Activity found")) {
        call.reject("Не удалось открыть установщик. Разрешите установку из этого приложения в настройках Android.");
      } else {
        call.reject(message);
      }
    }
  }

  @PluginMethod
  public void validateApk(PluginCall call) {
    int versionCode = call.getInt("versionCode", 0);
    File file = getApkFile(versionCode);
    JSObject result = new JSObject();
    result.put("valid", isValidApk(file));
    result.put("size", file.exists() ? file.length() : 0);
    call.resolve(result);
  }

  @PluginMethod
  public void install(PluginCall call) {
    String uriStr = call.getString("uri");
    Integer versionCode = call.getInt("versionCode");

    Activity activity = getActivity();
    if (activity == null) {
      call.reject("Activity недоступна — попробуйте снова");
      return;
    }

    try {
      File file = null;
      if (versionCode != null && versionCode > 0) {
        file = getApkFile(versionCode);
      }

      if (file != null && file.exists() && isValidApk(file)) {
        activity.runOnUiThread(() -> openInstaller(activity, file, call));
        return;
      }

      if (uriStr == null || uriStr.isEmpty()) {
        call.reject("Файл обновления не найден — скачайте заново");
        return;
      }

      Uri uri = Uri.parse(uriStr);
      if ("file".equals(uri.getScheme())) {
        file = new File(uri.getPath());
        if (!isValidApk(file)) {
          call.reject("Файл обновления повреждён — скачайте заново");
          return;
        }
        File finalFile = file;
        activity.runOnUiThread(() -> openInstaller(activity, finalFile, call));
        return;
      }

      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(uri, "application/vnd.android.package-archive");
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      activity.startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage() != null ? e.getMessage() : "Install failed");
    }
  }

  @PluginMethod
  public void downloadAndInstall(PluginCall call) {
    String url = call.getString("url");
    Integer versionCode = call.getInt("versionCode", 0);

    if (url == null || url.isEmpty()) {
      call.reject("url required");
      return;
    }
    if (versionCode == null || versionCode <= 0) {
      call.reject("versionCode required");
      return;
    }

    Activity activity = getActivity();
    if (activity == null) {
      call.reject("Activity недоступна — попробуйте снова");
      return;
    }

  File outFile = getApkFile(versionCode);
  if (isValidApk(outFile)) {
    emitProgress("downloaded", outFile.length(), outFile.length(), 100, "Обновление уже скачано");
    activity.runOnUiThread(() -> {
      emitProgress("installing", outFile.length(), outFile.length(), 100, "Открываем установщик Android…");
      openInstaller(activity, outFile, call);
    });
    return;
  }

  if (outFile.exists()) {
    outFile.delete();
  }

    new Thread(() -> {
      HttpURLConnection conn = null;
      try {
        emitProgress("downloading", 0, 0, 0, "Подключение к серверу…");

        conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(60000);
        conn.setReadTimeout(600000);
        conn.setRequestProperty("User-Agent", "MahallaSnab-Android");
        conn.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
        conn.connect();

        int status = conn.getResponseCode();
        if (status < 200 || status >= 300) {
          call.reject("Не удалось скачать APK (код " + status + ")");
          return;
        }

        long total = conn.getContentLengthLong();
        InputStream in = conn.getInputStream();
        FileOutputStream out = new FileOutputStream(outFile, false);

        byte[] buf = new byte[16384];
        int read;
        long done = 0;
        while ((read = in.read(buf)) != -1) {
          out.write(buf, 0, read);
          done += read;
          Integer percent = null;
          if (total > 0) {
            percent = (int) Math.min(99, done * 100 / total);
          }
          emitProgress("downloading", done, total, percent, null);
        }

        out.flush();
        out.close();
        in.close();
        conn.disconnect();
        conn = null;

        if (!isValidApk(outFile)) {
          outFile.delete();
          call.reject("Скачанный файл повреждён. Проверьте интернет и попробуйте снова.");
          return;
        }

        emitProgress("downloaded", outFile.length(), outFile.length(), 100, "Скачивание завершено");
        emitProgress("installing", outFile.length(), outFile.length(), 100, "Открываем установщик Android…");

        activity.runOnUiThread(() -> openInstaller(activity, outFile, call));
      } catch (Exception e) {
        if (outFile.exists()) outFile.delete();
        call.reject(e.getMessage() != null ? e.getMessage() : "Download failed");
      } finally {
        if (conn != null) conn.disconnect();
      }
    }).start();
  }
}
