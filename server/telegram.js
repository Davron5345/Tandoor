import TelegramBot from 'node-telegram-bot-api';
import { logTelegramMessage } from './services.js';
import { getSetting } from './services/telegram.js';

let bot = null;
let enabled = false;
let currentToken = null;

function setupHandlers(instance) {
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
      `/help — эта справка\n\n` +
      `Уведомления о документах прихода/расхода отправляются автоматически из системы учёта.`,
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
