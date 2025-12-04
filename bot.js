require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ==================== ЛОГИРОВАНИЕ ====================

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

function log(message, data = null) {
  const timestamp = new Date().toLocaleString('ru-RU');
  const logMessage = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ''}`;
  
  console.log(logMessage);
  
  const dateStr = new Date().toISOString().split('T')[0];
  const logFile = path.join(logsDir, `bot-${dateStr}.log`);
  fs.appendFileSync(logFile, logMessage + '\n');
}

// ==================== ЗАЩИТА ОТ ДВОЙНЫХ КЛИКОВ ====================

const activeRequests = {};

function isRequestActive(userId, actionType) {
  const key = `${userId}_${actionType}`;
  return activeRequests[key] === true;
}

function setRequestActive(userId, actionType, active = true) {
  const key = `${userId}_${actionType}`;
  activeRequests[key] = active;
}

function wrapAction(actionType) {
  return (ctx, next) => {
    const userId = ctx.from.id;
    
    if (isRequestActive(userId, actionType)) {
      ctx.answerCallbackQuery('⏳ Подождите, данные обрабатываются...', { show_alert: false });
      return;
    }
    
    setRequestActive(userId, actionType, true);
    
    Promise.resolve(next()).finally(() => {
      setRequestActive(userId, actionType, false);
    });
  };
}

// ==================== КОНСТАНТЫ И ДАННЫЕ ====================

const TEACHERS = ['Босс', 'Саша', 'Артём', 'Наташа', 'Олеся', 'Никита'];
const STUDENTS = ['Глеб', 'Даша', 'Софа', 'Акбар', 'Маша', 'Милена', 'Глеб мск', 'Андрей', 'Набережных', 'Полушкина', 'Тимур', 'Таня', 'Злата','Святослав', 'Лиза', 'Ксюша', 'Ярослав', 'Саша', 'Эми', 'Ева', 'Арсентий'];
const PRICES = [
  { label: '1000 ₽', value: 1000 },
  { label: '700 ₽', value: 700 },
  { label: '600 ₽', value: 600 }
];

const userState = {};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function createTwoColumnButtons(items, prefix) {
  const buttons = [];
  for (let i = 0; i < items.length; i += 2) {
    const row = [];
    row.push({ text: items[i], callback_data: `${prefix}_${i}` });
    if (i + 1 < items.length) {
      row.push({ text: items[i + 1], callback_data: `${prefix}_${i + 1}` });
    }
    buttons.push(row);
  }
  return buttons;
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

function getDates() {
  const today = new Date();
  return {
    today: formatDate(today),
    yesterday: formatDate(new Date(today.getTime() - 86400000)),
    dayBefore: formatDate(new Date(today.getTime() - 172800000))
  };
}

function createConfirmationMessage(state) {
  return (
    `<b>✅ Проверьте данные перед отправкой:</b>\n\n` +
    `👤 Преподаватель: <b>${state.teacher}</b>\n` +
    `👨‍🎓 Ученик: <b>${state.student}</b>\n` +
    `📅 Дата: <b>${state.date}</b>\n` +
    `💰 Стоимость: <b>${state.occurred ? state.price : 0} ₽</b>\n` +
    `📊 Статус: <b>${state.occurred ? '✅ Состоялось' : '❌ Не состоялось'}</b>\n\n` +
    `Всё верно?`
  );
}

function createSuccessMessage(state) {
  return (
    `<b>🎉 Данные успешно отправлены!</b>\n\n` +
    `👤 ${state.teacher}\n` +
    `👨‍🎓 ${state.student}\n` +
    `📅 ${state.date}\n` +
    `💰 ${state.occurred ? state.price : 0} ₽\n` +
    `📊 ${state.occurred ? '✅ Состоялось' : '❌ Не состоялось'}\n\n` +
    `Записано в таблицу! ✓`
  );
}

function createLoadingMessage(state) {
  return (
    `⏳ <b>Отправка данных...</b>\n\n` +
    `👤 ${state.teacher}\n` +
    `👨‍🎓 ${state.student}\n` +
    `📅 ${state.date}\n` +
    `💰 ${state.occurred ? state.price : 0} ₽\n\n` +
    `Пожалуйста, ждите...`
  );
}

function safeSendOrEdit(ctx, method, ...args) {
  return ctx[method](...args).catch(() => {});
}

async function sendToGoogleSheets(teacher, student, date, price, occurred) {
  try {
    const response = await axios.post(process.env.GOOGLE_APPS_SCRIPT_URL, {
      teacher,
      student,
      date,
      price,
      occurred,
      timestamp: new Date().toISOString()
    });
    
    if (!response.data.success) {
      throw new Error(response.data.message || 'Unknown error');
    }
    
    return response.data;
  } catch (error) {
    log('❌ ОШИБКА сети при отправке в Google Sheets', {
      error: error.message,
      teacher,
      student,
      date
    });
    throw error;
  }
}

// ==================== КОМАНДЫ ====================

bot.start((ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name;
  
  log('👤 Новый пользователь запустил бота', { userId, name: userName });
  
  ctx.reply(
    '👋 Добро пожаловать в систему учёта занятий!\n\nНажмите кнопку ниже, чтобы начать.',
    {
      reply_markup: {
        inline_keyboard: [[{ text: '📅 Записать занятие', callback_data: 'record_lesson' }]]
      }
    }
  );
});

bot.command('help', (ctx) => {
  log('📖 Пользователь запросил справку', { userId: ctx.from.id });
  
  ctx.reply(
    '📖 Справка:\n\n' +
    '1. Нажмите "📅 Записать занятие"\n' +
    '2. Выберите себя\n' +
    '3. Выберите ученика\n' +
    '4. Выберите дату\n' +
    '5. Выберите стоимость\n' +
    '6. Подтвердите статус\n' +
    '7. Проверьте данные и подтвердите\n\n' +
    'Данные автоматически запишутся в таблицу!'
  );
});

// ==================== ВЫБОР ПРЕПОДАВАТЕЛЯ ====================

bot.action('record_lesson', wrapAction('record_lesson'), (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'teacher' };
  
  log('🎬 Начало процесса записи занятия', { userId });
  
  ctx.editMessageText('👤 Выберите себя:', {
    reply_markup: { inline_keyboard: createTwoColumnButtons(TEACHERS, 'teacher') }
  }).catch(() => {});
});

bot.action(/^teacher_(\d+)$/, wrapAction('teacher_select'), (ctx) => {
  const userId = ctx.from.id;
  const teacherIndex = parseInt(ctx.match[1]);
  const teacher = TEACHERS[teacherIndex];
  
  userState[userId].teacher = teacher;
  userState[userId].step = 'student';
  
  log('🎯 Преподаватель выбран', { userId, teacher });
  
  safeSendOrEdit(
    ctx,
    'editMessageText',
    `✅ Преподаватель: <b>${teacher}</b>\n\n👨‍🎓 Выберите ученика:`,
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: createTwoColumnButtons(STUDENTS, 'student') }
    }
  );
});

// ==================== ВЫБОР УЧЕНИКА ====================

bot.action(/^student_(\d+)$/, wrapAction('student_select'), (ctx) => {
  const userId = ctx.from.id;
  const studentIndex = parseInt(ctx.match[1]);
  const student = STUDENTS[studentIndex];
  
  userState[userId].student = student;
  userState[userId].step = 'date';
  
  log('👨‍🎓 Ученик выбран', { userId, student });
  
  const dates = getDates();
  const dateButtons = [
    [{ text: `📍 Сегодня (${dates.today})`, callback_data: `date_${dates.today}` }],
    [{ text: `📍 Вчера (${dates.yesterday})`, callback_data: `date_${dates.yesterday}` }],
    [{ text: `📍 Позавчера (${dates.dayBefore})`, callback_data: `date_${dates.dayBefore}` }],
    [{ text: '📝 Другая дата', callback_data: 'date_custom' }]
  ];
  
  safeSendOrEdit(
    ctx,
    'editMessageText',
    `✅ Ученик: <b>${student}</b>\n\n📅 Выберите дату:`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: dateButtons } }
  );
});

// ==================== ВЫБОР ДАТЫ ====================

bot.action(/^date_(.+)$/, wrapAction('date_select'), (ctx) => {
  const userId = ctx.from.id;
  const date = ctx.match[1];
  
  if (date === 'custom') {
    userState[userId].step = 'custom_date';
    
    log('📅 Пользователь выбрал ввод своей даты', { userId });
    
    safeSendOrEdit(
      ctx,
      'editMessageText',
      '📅 Введите дату:\n\n<b>ДД.ММ.ГГГГ</b>\n\nПример: <b>01.12.2025</b>',
      { parse_mode: 'HTML' }
    );
    return;
  }
  
  userState[userId].date = date;
  userState[userId].step = 'price';
  
  log('📅 Дата выбрана', { userId, date });
  
  const priceButtons = PRICES.map(p => [{ text: p.label, callback_data: `price_${p.value}` }]);
  
  safeSendOrEdit(
    ctx,
    'editMessageText',
    `✅ Дата: <b>${date}</b>\n\n💰 Выберите стоимость:`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: priceButtons } }
  );
});

// ==================== ВВОД СВОЕЙ ДАТЫ ====================

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const message = ctx.message.text;
  
  if (userState[userId]?.step !== 'custom_date') return;
  
  const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
  if (!dateRegex.test(message)) {
    log('❌ Неправильный формат даты', { userId, input: message });
    
    ctx.reply('❌ Неправильный формат! Используйте ДД.ММ.ГГГГ', { parse_mode: 'HTML' });
    return;
  }
  
  userState[userId].date = message;
  userState[userId].step = 'price';
  
  log('📅 Пользовательская дата введена', { userId, date: message });
  
  const priceButtons = PRICES.map(p => [{ text: p.label, callback_data: `price_${p.value}` }]);
  
  ctx.reply(
    `✅ Дата: <b>${message}</b>\n\n💰 Выберите стоимость:`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: priceButtons } }
  );
});

// ==================== ВЫБОР СТОИМОСТИ ====================

bot.action(/^price_(\d+)$/, wrapAction('price_select'), (ctx) => {
  const userId = ctx.from.id;
  const price = parseInt(ctx.match[1]);
  
  userState[userId].price = price;
  userState[userId].step = 'status';
  
  log('💰 Стоимость выбрана', { userId, price });
  
  safeSendOrEdit(
    ctx,
    'editMessageText',
    `✅ Стоимость: <b>${price} ₽</b>\n\nСостоялось ли занятие?`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Да', callback_data: 'status_yes' }],
          [{ text: '❌ Нет', callback_data: 'status_no' }]
        ]
      }
    }
  );
});

// ==================== ВЫБОР СТАТУСА И ПОКАЗ ИТОГОВ ====================

async function showConfirmation(ctx, occurred) {
  const userId = ctx.from.id;
  const state = userState[userId];
  
  if (!state?.teacher || !state?.student || !state?.date || state.price === undefined) {
    log('❌ ОШИБКА: Неполные данные', { userId, state });
    
    ctx.reply('❌ Ошибка! Начните заново.');
    return;
  }
  
  userState[userId].occurred = occurred;
  userState[userId].step = 'confirmation';
  
  log('📋 Показ итогового экрана', {
    userId,
    teacher: state.teacher,
    student: state.student,
    date: state.date,
    price: state.price,
    occurred
  });
  
  safeSendOrEdit(
    ctx,
    'editMessageText',
    createConfirmationMessage(state),
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Да, отправить', callback_data: 'confirm_yes' },
            { text: '❌ Отмена', callback_data: 'confirm_no' }
          ]
        ]
      }
    }
  );
}

bot.action('status_yes', wrapAction('status_yes'), (ctx) => {
  log('✅ Статус: Занятие состоялось', { userId: ctx.from.id });
  showConfirmation(ctx, true);
});

bot.action('status_no', wrapAction('status_no'), (ctx) => {
  log('❌ Статус: Занятие НЕ состоялось', { userId: ctx.from.id });
  showConfirmation(ctx, false);
});

// ==================== ПОДТВЕРЖДЕНИЕ И ОТМЕНА ====================

bot.action('confirm_yes', wrapAction('confirm_yes'), async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  
  if (!state || !state.teacher || !state.student || !state.date) {
    log('❌ ОШИБКА: Состояние потеряно или неполное', { userId });
    
    safeSendOrEdit(
      ctx,
      'editMessageText',
      '❌ <b>Сеанс истёк!</b>\n\nДанные были потеряны. Начните заново!',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '📅 Записать занятие', callback_data: 'record_lesson' }]]
        }
      }
    );
    return;
  }
  
  log('✅ Пользователь подтвердил отправку', { userId });
  
  try {
    safeSendOrEdit(
      ctx,
      'editMessageText',
      createLoadingMessage(state),
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[]] }
      }
    );
    
    await sendToGoogleSheets(
      state.teacher,
      state.student,
      state.date,
      state.occurred ? state.price : 0,
      state.occurred
    );
    
    log('✅ Данные успешно отправлены в Google Sheets', {
      teacher: state.teacher,
      student: state.student,
      date: state.date
    });
    
    safeSendOrEdit(
      ctx,
      'editMessageText',
      createSuccessMessage(state),
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '📅 Новая запись', callback_data: 'record_lesson' }]] }
      }
    );
    
    delete userState[userId];
  } catch (error) {
    log('❌ ОШИБКА при отправке в Google Sheets', {
      userId,
      error: error.message,
      teacher: state.teacher,
      student: state.student
    });
    
    safeSendOrEdit(
      ctx,
      'editMessageText',
      '❌ <b>Ошибка при отправке!</b>\n\nПроверьте подключение и попробуйте заново.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '📅 Записать занятие', callback_data: 'record_lesson' }]]
        }
      }
    );
  }
});

bot.action('confirm_no', wrapAction('confirm_no'), (ctx) => {
  const userId = ctx.from.id;
  
  log('🔄 Пользователь отменил запись', { userId });
  
  if (userState[userId]) {
    delete userState[userId];
  }
  
  safeSendOrEdit(
    ctx,
    'editMessageText',
    `❌ <b>Запись отменена.</b>\n\nВсе данные удалены. Начните заново!`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '📅 Записать занятие', callback_data: 'record_lesson' }]]
      }
    }
  );
});

// ==================== ЗАПУСК ====================

log('🚀 Бот запускается...');

bot.launch();

log('🤖 Бот успешно запущен!');

process.once('SIGINT', () => {
  log('⛔ Бот остановлен (SIGINT)');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  log('⛔ Бот остановлен (SIGTERM)');
  bot.stop('SIGTERM');
});

log('✅ Обработчики событий подключены');
