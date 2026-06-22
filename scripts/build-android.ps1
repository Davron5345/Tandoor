# Сборка debug APK на Windows (нужны Android Studio + SDK)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

if (-not $env:JAVA_HOME) {
  $candidates = @(
    "$env:ProgramFiles\Android\Android Studio\jbr",
    "${env:ProgramFiles(x86)}\Android\Android Studio\jbr",
    "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
  )
  foreach ($jbr in $candidates) {
    if (Test-Path "$jbr\bin\java.exe") {
      $env:JAVA_HOME = $jbr
      break
    }
  }
}

if (-not $env:ANDROID_HOME) {
  $sdk = "$env:LOCALAPPDATA\Android\Sdk"
  if (Test-Path $sdk) { $env:ANDROID_HOME = $sdk }
}

if (-not $env:JAVA_HOME) {
  Write-Host "JAVA_HOME не найден. Установите Android Studio:" -ForegroundColor Red
  Write-Host "https://developer.android.com/studio"
  Write-Host ""
  Write-Host "Или скачайте готовый APK из GitHub → Actions → Android APK → Artifacts"
  exit 1
}

if (-not $env:ANDROID_HOME) {
  Write-Host "Android SDK не найден. Откройте Android Studio один раз и установите SDK." -ForegroundColor Red
  exit 1
}

Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"

if (-not $env:VITE_API_URL) {
  $env:VITE_API_URL = 'https://tandoor-production.up.railway.app'
}

npm run setup
npm run build
npx cap sync android
Set-Location android
& .\gradlew.bat assembleDebug --no-daemon

$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
if (Test-Path $apk) {
  Write-Host ""
  Write-Host "Готово: $apk" -ForegroundColor Green
} else {
  Write-Host "APK не найден после сборки." -ForegroundColor Red
  exit 1
}
