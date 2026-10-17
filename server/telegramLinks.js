/**
 * Ссылка на сообщение в супергруппе / теме форума.
 * chat_id вида -100123… → https://t.me/c/123…/messageId
 * с темой: https://t.me/c/123…/threadId/messageId
 */
export function buildTelegramMessageUrl(chatId, messageId, threadId = null) {
  const chat = String(chatId || '').trim();
  const msg = String(messageId || '').trim();
  if (!chat || !msg || chat === 'paste') return null;
  if (!/^-?\d+$/.test(chat) || !/^\d+$/.test(msg)) return null;

  let internal = chat;
  if (chat.startsWith('-100')) internal = chat.slice(4);
  else if (chat.startsWith('-')) internal = chat.slice(1);
  if (!internal || !/^\d+$/.test(internal)) return null;

  const thread = String(threadId || '').trim();
  if (thread && /^\d+$/.test(thread) && thread !== '0') {
    return `https://t.me/c/${internal}/${thread}/${msg}`;
  }
  return `https://t.me/c/${internal}/${msg}`;
}

export function telegramUrlFromInboxRow(row) {
  if (!row) return null;
  return buildTelegramMessageUrl(row.chat_id, row.message_id, row.thread_id);
}
