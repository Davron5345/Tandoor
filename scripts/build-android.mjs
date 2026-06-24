import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function findJavaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const candidates = [
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files (x86)\\Android\\Android Studio\\jbr',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Android Studio', 'jbr'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))) {
      return dir;
    }
  }
  return null;
}

function findAndroidHome() {
  if (process.env.ANDROID_HOME) return process.env.ANDROID_HOME;
  const sdk = join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
  return existsSync(sdk) ? sdk : null;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const javaHome = findJavaHome();
const androidHome = findAndroidHome();

if (!javaHome || !androidHome) {
  console.error('\nНа этом компьютере нет Java/Android SDK для локальной сборки.');
  console.error('Варианты:');
  console.error('  1. Установить Android Studio: https://developer.android.com/studio');
  console.error('  2. Скачать APK из GitHub → Actions → «Android APK» → Artifacts\n');
  process.exit(1);
}

const env = {
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  VITE_API_URL: process.env.VITE_API_URL || 'https://tandoor-production.up.railway.app',
  CAPACITOR_SERVER_URL: process.env.CAPACITOR_SERVER_URL
    || process.env.VITE_API_URL
    || 'https://tandoor-production.up.railway.app',
};

console.log(`JAVA_HOME=${javaHome}`);
console.log(`ANDROID_HOME=${androidHome}`);

run('npm', ['run', 'cap:sync'], { env });

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(gradle, ['assembleDebug', '--no-daemon'], {
  cwd: join(root, 'android'),
  env,
});

const apk = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (existsSync(apk)) {
  console.log(`\nГотово: ${apk}\n`);
} else {
  console.error('APK не найден после сборки.');
  process.exit(1);
}
