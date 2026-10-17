import TelegramBot from 'node-telegram-bot-api';
import { logTelegramMessage } from './services.js';
import { getSetting } from './services/telegram.js';
import { handleIncomingMessage, handleIncomingPhoto } from './services/telegramPrihod.js';

let bot = null;
let enabled = false;
let currentToken = null;

function isGroupChat(msg) {
  return msg?.chat?.type === 'group' || msg?.chat?.type === 'supergroup';
}

function topicThreadId(msg) {
  return msg.chat?.is_forum && msg.message_thread_id ? msg.message_thread_id : null;
}

function topicTitleFromMessage(msg, threadId) {
  if (msg.forum_topic_created?.name) return msg.forum_topic_created.name;
  if (msg.forum_topic_edited?.name) return msg.forum_topic_edited.name;
  const root = msg.reply_to_message;
  if (root?.forum_topic_created?.name && (!threadId || root.message_id === threadId)) {
    return root.forum_topic_created.name;
  }
  return null;
}

function senderName(msg) {
  const from = msg.from || {};
  const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  return full || from.username || msg.author_signature || null;
}

function largestPhoto(msg) {
  const photos = msg.photo;
  if (!Array.isArray(photos) || !photos.length) return null;
  return photos[photos.length - 1];
}

async function downloadTelegramFile(instance, fileId) {
  const file = await instance.getFile(fileId);
  const token = currentToken;
  if (!file?.file_path || !token) throw new Error('Не удалось скачать файл из Telegram');
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telegram file ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const path = String(file.file_path).toLowerCase();
  let mimeType = 'image/jpeg';
  if (path.endsWith('.png')) mimeType = 'image/png';
  else if (path.endsWith('.webp')) mimeType = 'image/webp';
  else if (path.endsWith('.gif')) mimeType = 'image/gif';
  return { buffer: buf, mimeType };
}

async function replyInTopic(instance, msg, threadId, outcome) {
  if (!outcome?.topic?.notify) return;
  for (const result of outcome.results || []) {
    if (!result.reply) continue;
    try {
      await instance.sendMessage(msg.chat.id, result.reply, {
        ...(threadId ? { message_thread_id: threadId } : {}),
        reply_to_message_id: msg.message_id,
        allow_sending_without_reply: true,
      });
    } catch (err) {
      console.error('Telegram приход: не удалось ответить в тему:', err.message);
    }
  }
}

async function onGroupMessage(instance, msg, edited) {
  if (!isGroupChat(msg)) return;
  const threadId = topicThreadId(msg);
  const photo = !edited ? largestPhoto(msg) : null;

  if (photo) {
    let outcome;
    try {
      const { buffer, mimeType } = await downloadTelegramFile(instance, photo.file_id);
      outcome = await handleIncomingPhoto({
        chatId: msg.chat.id,
        threadId,
        chatTitle: msg.chat.title || null,
        topicTitle: topicTitleFromMessage(msg, threadId),
        messageId: msg.message_id,
        fromName: senderName(msg),
        fromUserId: msg.from?.id,
        date: new Date((msg.date || Math.floor(Date.now() / 1000)) * 1000),
        imageBuffer: buffer,
        mimeType,
        caption: msg.caption || '',
        telegramFileId: photo.file_id,
      });
    } catch (err) {
      console.error('Telegram приход (фото):', err.message);
      try {
        await instance.sendMessage(msg.chat.id, `⚠️ Ошибка обработки фото: ${err.message}`, {
          ...(threadId ? { message_thread_id: threadId } : {}),
          reply_to_message_id: msg.message_id,
          allow_sending_without_reply: true,
        });
      } catch { /* */ }
      return;
    }
    await replyInTopic(instance, msg, threadId, outcome);
    return;
  }

  let outcome;
  try {
    outcome = handleIncomingMessage({
      chatId: msg.chat.id,
      threadId,
      chatTitle: msg.chat.title || null,
      topicTitle: topicTitleFromMessage(msg, threadId),
      messageId: msg.message_id,
      fromName: senderName(msg),
      fromUserId: msg.from?.id,
      text: msg.text || msg.caption || '',
      date: new Date((msg.date || Math.floor(Date.now() / 1000)) * 1000),
      edited,
    });
  } catch (err) {
    console.error('Telegram приход: ошибка обработки сообщения:', err.message);
    return;
  }
  await replyInTopic(instance, msg, threadId, outcome);
}

function setupHandlers(instance) {
  instance.on('message', (msg) => { onGroupMessage(instance, msg, false); });
  instance.on('edited_message', (msg) => { onGroupMessage(instance, msg, true); });

  instance.onText(/^\/topic(@\w+)?$/, (msg) => {
    const threadId = topicThreadId(msg);
    instance.sendMessage(msg.chat.id,
      `Chat ID: ${msg.chat.id}\n` +
      `Тема: ${threadId || 'общая'}\n\n` +
      'Чтобы сообщения этой темы становились приходами, включите её в системе: Закупки → Приходы из Telegram → Темы.',
      threadId ? { message_thread_id: threadId } : {},
    );
  });

  instance.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    instance.sendMessage(chatId,
      `👋 Добро пожаловать!\n\n` +
      `Ваш Chat ID: \`${chatId}\`\n\n` +
      `Скопируйте этот ID и укажите его в карточке контрагента (поставщика или клиента) для получения уведомлений.`,
      { parse_mode: 'Markdown' }
    );
  });

  instance.onText(/\/help/, (msg) => {
    instance.sendMessage(msg.chat.id,
      `📋 *Справка*\n\n` +
      `/start — получить ваш Chat ID\n` +
      `/help — эта справка\n` +
      `/topic — ID группы и темы (для приходов из темы)\n\n` +
      `Уведомления о документах прихода/расхода отправляются автоматически из системы учёта.\n` +
      `В теме, включённой для приходов, пишите: «Жалилдан:» и строки «Сон-45,8кг» — бот создаст приход.\n` +
      `Или отправьте *фото* тетради — при настроенном OpenRouter бот распознает позиции через ИИ (жёлтая пометка).`,
      { parse_mode: 'Markdown' }
    );
  });
}

export async function stopTelegram() {
  if (bot) {
    try {
      await bot.stopPolling();
    } catch {
      // polling may not be running
    }
    bot = null;
  }
  enabled = false;
  currentToken = null;
}

export async function initTelegram(token) {
  if (!token || token === 'your_bot_token_from_botfather') {
    return null;
  }

  if (token === currentToken && bot) {
    return bot;
  }

  await stopTelegram();

  try {
    bot = new TelegramBot(token, { polling: true });
    setupHandlers(bot);
    enabled = true;
    currentToken = token;
    console.log('✅ Telegram бот запущен');
    return bot;
  } catch (err) {
    bot = null;
    enabled = false;
    currentToken = null;
    console.error('❌ Ошибка запуска Telegram бота:', err.message);
    throw err;
  }
}

export function isTelegramEnabled() {
  return enabled && bot !== null;
}

function formatDocumentMessage(doc, counterparty) {
  const typeLabel = doc.type === 'prihod' ? '📥 Приход' : '📤 Расход';
  const role = counterparty?.type === 'supplier' ? 'Поставщик' : 'Клиент';

  let text = `${typeLabel}\n\n`;
  text += `📄 Документ: ${doc.number}\n`;
  text += `📅 Дата: ${doc.date}\n`;
  if (counterparty) text += `👤 ${role}: ${counterparty.name}\n`;
  text += `💰 Сумма: ${formatMoney(doc.total_amount)}\n`;
  if (doc.comment) text += `📝 ${doc.comment}\n`;

  if (doc.items?.length) {
    text += `\n📦 Товары:\n`;
    for (const item of doc.items) {
      text += `• ${item.product_name} — ${item.quantity} ${item.unit || 'шт'} × ${formatMoney(item.price)}\n`;
    }
  }

  return text;
}

function formatMoney(amount) {
  return new Intl.NumberFormat('ru-RU').format(amount || 0) + ' сум';
}

export async function sendDocumentNotification(doc, counterparty) {
  if (!isTelegramEnabled()) {
    return { success: false, error: 'Telegram бот не настроен' };
  }

  const chatId = counterparty?.telegram_chat_id;
  if (!chatId) {
    return { success: false, error: 'У контрагента не указан Telegram Chat ID' };
  }

  const message = formatDocumentMessage(doc, counterparty);

  try {
    await bot.sendMessage(chatId, message);
    logTelegramMessage({
      counterparty_id: counterparty.id,
      document_id: doc.id,
      chat_id: chatId,
      message,
      status: 'sent',
    });
    return { success: true };
  } catch (err) {
    logTelegramMessage({
      counterparty_id: counterparty.id,
      document_id: doc.id,
      chat_id: chatId,
      message,
      status: 'error',
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}

export async function sendCustomMessage(counterparty, text, documentId = null) {
  if (!isTelegramEnabled()) {
    return { success: false, error: 'Telegram бот не настроен' };
  }

  const chatId = counterparty?.telegram_chat_id;
  if (!chatId) {
    return { success: false, error: 'У контрагента не указан Telegram Chat ID' };
  }

  try {
    await bot.sendMessage(chatId, text);
    logTelegramMessage({
      counterparty_id: counterparty.id,
      document_id: documentId,
      chat_id: chatId,
      message: text,
      status: 'sent',
    });
    return { success: true };
  } catch (err) {
    logTelegramMessage({
      counterparty_id: counterparty.id,
      document_id: documentId,
      chat_id: chatId,
      message: text,
      status: 'error',
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}

export async function sendShopOrderNotification(order, branch) {
  if (!isTelegramEnabled()) {
    return { success: false, error: 'Telegram бот не настроен' };
  }

  const branchSettingsRaw = getSetting(`shop_settings:${order.branch_id}`);
  let branchNotifyChatId = '';
  if (branchSettingsRaw) {
    try {
      branchNotifyChatId = JSON.parse(branchSettingsRaw).notifyChatId || '';
    } catch { /* ignore */ }
  }
  const targetChatId = branchNotifyChatId || getSetting('shop_notify_chat_id');

  if (!targetChatId) {
    return { success: false, error: 'Не указан Chat ID для уведомлений о заказах' };
  }

  const deliveryLabel = order.delivery_type === 'delivery' ? '🚚 Доставка' : '🏪 Самовывоз';
  let text = `🛒 *Новый заказ №${order.number}*\n\n`;
  text += `🏢 Филиал: ${branch?.name || order.branch_id}\n`;
  if (order.department_name) text += `🏷 Отдел: ${order.department_name}\n`;
  text += `👤 ${order.customer_name}\n`;
  text += `📞 ${order.customer_phone}\n`;
  text += `${deliveryLabel}\n`;
  if (order.address) text += `📍 ${order.address}\n`;
  if (order.comment) text += `📝 ${order.comment}\n`;
  text += `\n💰 *Итого:* ${formatMoney(order.total_amount)}\n\n`;
  text += `📦 *Товары:*\n`;
  for (const item of order.items || []) {
    const name = item.variant_name ? `${item.product_name} — ${item.variant_name}` : item.product_name;
    text += `• ${name} — ${item.quantity} ${item.unit || 'шт'} × ${formatMoney(item.price)}\n`;
  }

  try {
    await bot.sendMessage(targetChatId, text, { parse_mode: 'Markdown' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export { formatDocumentMessage, formatMoney };
