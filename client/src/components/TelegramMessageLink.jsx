import { IconTelegram } from './ActionIcons';

/**
 * Синяя иконка Telegram → открывает исходное сообщение в группе/теме.
 */
export default function TelegramMessageLink({ url, className = '', title = 'Открыть сообщение в Telegram' }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`tg-message-link${className ? ` ${className}` : ''}`}
      title={title}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
    >
      <IconTelegram />
    </a>
  );
}
