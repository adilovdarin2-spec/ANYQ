/**
 * The base dictionary.
 *
 * Complete by construction: every key lives here first, and the `Phrases` type
 * is derived from this object, so a key referenced anywhere and missing here is
 * a compile error rather than a blank on a till.
 *
 * Only the surface a cashier touches during a shift is here so far — signing
 * in, opening and closing, selling, taking payment, the receipt. The warehouse
 * and owner screens are still literal Russian in their components, and moving
 * them across is mechanical work that can happen a screen at a time without
 * anything breaking in between.
 */
export const ru = {
  // --- signing in ---------------------------------------------------------
  'login.title': 'Вход в кассу',
  'login.prompt': 'Введите PIN-код кассира',
  'login.submit': 'Войти',
  'login.submitting': 'Входим…',
  'login.failed': 'Не удалось войти',

  // --- the shift ----------------------------------------------------------
  'shift.open.title': 'Открыть смену',
  'shift.open.why': 'Без открытой смены продажи не проводятся — это требование кассовой дисциплины.',
  'shift.open.location': 'Точка',
  'shift.open.noLocation': 'У компании не настроена точка — обратитесь к владельцу',
  'shift.open.cash': 'Наличные в кассе на начало смены',
  'shift.open.submit': 'Открыть смену',
  'shift.open.loading': 'Загружаем товары точки…',

  'shift.bar.since': 'смена с {time}',
  'shift.bar.online': 'Онлайн',
  'shift.bar.offline': 'Офлайн',
  'shift.bar.needAttention': '{count} требуют внимания',
  'shift.bar.notSent': '{count} не отправлено',
  'shift.bar.longShift': 'Смена открыта {hours} ч — рекомендуем закрыть и снять Z-отчёт до 24 часов',

  'shift.close.title': 'Z-отчёт и закрытие смены',
  'shift.close.openedAt': 'Смена открыта',
  'shift.close.salesCount': 'Продаж за смену',
  'shift.close.total': 'Итого продаж',
  'shift.close.expectedCash': 'Наличными должно быть в кассе',
  'shift.close.countedCash': 'Пересчитано наличными фактически',
  'shift.close.matches': 'Сходится',
  'shift.close.short': 'Недостача {amount}',
  'shift.close.over': 'Излишек {amount}',
  'shift.close.submit': 'Закрыть смену',

  // --- selling ------------------------------------------------------------
  'cart.title': 'Корзина',
  'cart.empty': 'Корзина пуста',
  'cart.remove': 'Удалить',
  'cart.change': 'изменить',
  'cart.less': 'Меньше',
  'cart.more': 'Больше',
  'cart.perKg': 'за кг',
  'cart.perPiece': 'за шт.',
  'cart.subtotal': 'Подытог',
  'cart.total': 'Итого',
  'cart.checkout': 'Оплатить {amount}',
  'cart.inCart': 'в корзине',

  // --- payment ------------------------------------------------------------
  'payment.title': 'Оплата {amount}',
  'payment.cash': 'Наличные',
  'payment.kaspi': 'Kaspi QR',
  'payment.card': 'Карта',
  'payment.credit': 'В долг',
  'payment.mixed': 'Смешанная',
  'payment.confirm': 'Подтвердить оплату',
  'payment.received': 'Оплата получена',
  'payment.giveOnCredit': 'Отпустить в долг',
  'payment.kaspiHint': 'Покажите QR клиенту в приложении Kaspi.kz. Когда увидите подтверждение оплаты — нажмите кнопку ниже.',
  'payment.creditHint': 'Товар уходит в долг клиенту на {amount}. Долг появится в разделе «Расчёты».',

  'payment.split.title': 'Смешанная оплата · {amount}',
  'payment.split.hint': 'Впишите, сколько прошло каждым способом. Подтвердить можно, когда останется ноль — иначе чек разойдётся с деньгами в кассе.',
  'payment.split.fillRest': 'весь остаток',
  'payment.split.remaining': 'Осталось внести',
  'payment.split.overpaid': 'Введено больше суммы чека',
  'payment.split.balanced': 'Сходится',
  'payment.split.noChange': 'Сдача не вводится: впишите сумму чека, а сдачу отдайте из кассы.',
  'payment.split.remainingButton': 'Осталось внести {amount}',
  'payment.split.needTwo': 'Для смешанной нужно два способа',

  // --- the slip -----------------------------------------------------------
  'receipt.title': 'Чек',
  'receipt.brand': 'ANYQ Касса',
  'receipt.notFiscal': 'Товарный чек',
  'receipt.notSynced': 'не синхронизирован',
  'receipt.discount': 'Скидка',
  'receipt.pointsSpent': 'Списано баллов',
  'receipt.pointsEarned': 'Начислено баллов',
  'receipt.total': 'Итого',
  'receipt.payment': 'Оплата',
  'receipt.customer': 'Клиент',
  'receipt.print': 'Печать',
  'receipt.newSale': 'Новая продажа',

  // --- getting around -----------------------------------------------------
  'tab.sale': 'Касса',
  'tab.products': 'Товары',
  'tab.operations': 'Операции',
  'tab.profile': 'Профиль',
  'common.back': 'Назад',
  'common.cancel': 'Отмена',
  'common.loading': 'Загрузка…',

  // --- the language itself ------------------------------------------------
  'language.title': 'Язык',
  'language.partial': 'Складские и владельческие экраны пока на русском.',
} as const;
