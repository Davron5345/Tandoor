import { createHash } from 'crypto';

const DEVICE_SALT = process.env.DEVICE_ID_SALT || 'warehouse-device-v1';

export function buildDeviceId(ip, userAgent) {
  const raw = `${DEVICE_SALT}|${ip || ''}|${userAgent || ''}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export function parseDeviceLabel(userAgent) {
  const ua = String(userAgent || '').toLowerCase();

  let browser = 'Браузер';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('opr/') || ua.includes('opera')) browser = 'Opera';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('chrome/') || ua.includes('crios/')) browser = 'Chrome';
  else if (ua.includes('safari/')) browser = 'Safari';

  let os = 'Устройство';
  if (ua.includes('iphone')) os = 'iPhone';
  else if (ua.includes('ipad')) os = 'iPad';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  return `${browser} · ${os}`;
}

export function extractRequestDevice(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' && forwarded
    ? forwarded.split(',')[0].trim()
    : req?.socket?.remoteAddress) || null;
  const userAgent = req?.headers?.['user-agent'] || '';
  const deviceLabel = parseDeviceLabel(userAgent);
  const deviceId = buildDeviceId(ip, userAgent);
  return { ip, userAgent, deviceLabel, deviceId };
}
