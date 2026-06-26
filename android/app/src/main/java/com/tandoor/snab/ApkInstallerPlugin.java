package com.tandoor.snab;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void install(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("uri required");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity недоступна — попробуйте снова");
            return;
        }

        try {
            Uri uri = Uri.parse(uriStr);
            if ("file".equals(uri.getScheme())) {
                File file = new File(uri.getPath());
                uri = FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    file
                );
            }

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }

            activity.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            String message = e.getMessage() != null ? e.getMessage() : "Install failed";
            if (message.contains("No Activity found")) {
                call.reject("Не удалось открыть установщик. Разрешите установку из этого приложения в настройках Android.");
            } else {
                call.reject(message);
            }
        }
    }
}
