import type { ru } from './ru';

/**
 * Kazakh, covering the till.
 *
 * Deliberately partial. Everything a cashier reads during a shift is here;
 * the warehouse and owner screens are not, and fall back to Russian phrase by
 * phrase rather than showing a key or a blank.
 *
 * Saying that plainly is better than pretending otherwise. A shop is told in
 * the language settings which parts are translated, so nobody switches to
 * Kazakh expecting the whole product and discovers the gap in the middle of a
 * stocktake.
 */
// Keys are checked against the Russian dictionary; values are just strings.
// `Partial<typeof ru>` would demand each value be the identical Russian
// literal, because ru is declared `as const` — which is exactly backwards.
export const kk: Partial<Record<keyof typeof ru, string>> = {
  // --- signing in ---------------------------------------------------------
  'login.title': 'Кассаға кіру',
  'login.prompt': 'Кассир PIN-кодын енгізіңіз',
  'login.submit': 'Кіру',
  'login.submitting': 'Кіру орындалуда…',
  'login.failed': 'Кіру мүмкін болмады',

  // --- the shift ----------------------------------------------------------
  'shift.open.title': 'Ауысымды ашу',
  'shift.open.why': 'Ашық ауысымсыз сату жүргізілмейді — бұл касса тәртібінің талабы.',
  'shift.open.location': 'Нүкте',
  'shift.open.noLocation': 'Компанияда нүкте бапталмаған — иесіне хабарласыңыз',
  'shift.open.cash': 'Ауысым басындағы кассадағы қолма-қол ақша',
  'shift.open.submit': 'Ауысымды ашу',
  'shift.open.loading': 'Нүкте тауарлары жүктелуде…',

  'shift.bar.since': 'ауысым {time}-дан',
  'shift.bar.online': 'Желіде',
  'shift.bar.offline': 'Желіден тыс',
  'shift.bar.needAttention': '{count} назар аударуды қажет етеді',
  'shift.bar.notSent': '{count} жіберілмеген',
  'shift.bar.longShift': 'Ауысым {hours} сағат ашық — 24 сағатқа дейін жабуды және Z-есепті алуды ұсынамыз',

  'shift.close.title': 'Z-есеп және ауысымды жабу',
  'shift.close.openedAt': 'Ауысым ашылған',
  'shift.close.salesCount': 'Ауысымдағы сатылым саны',
  'shift.close.total': 'Сатылым жиыны',
  'shift.close.expectedCash': 'Кассада қолма-қол болуы тиіс',
  'shift.close.countedCash': 'Нақты қайта саналған қолма-қол ақша',
  'shift.close.matches': 'Сәйкес келеді',
  'shift.close.short': 'Кем шықты: {amount}',
  'shift.close.over': 'Артық шықты: {amount}',
  'shift.close.submit': 'Ауысымды жабу',

  // --- selling ------------------------------------------------------------
  'cart.title': 'Себет',
  'cart.empty': 'Себет бос',
  'cart.remove': 'Жою',
  'cart.change': 'өзгерту',
  'cart.less': 'Азырақ',
  'cart.more': 'Көбірек',
  'cart.perKg': 'кг үшін',
  'cart.perPiece': 'дана үшін',
  'cart.subtotal': 'Аралық жиын',
  'cart.total': 'Жиыны',
  'cart.checkout': 'Төлеу {amount}',
  'cart.inCart': 'себетте',

  // --- payment ------------------------------------------------------------
  'payment.title': 'Төлем {amount}',
  'payment.cash': 'Қолма-қол',
  'payment.kaspi': 'Kaspi QR',
  'payment.card': 'Карта',
  'payment.credit': 'Қарызға',
  'payment.mixed': 'Аралас',
  'payment.confirm': 'Төлемді растау',
  'payment.received': 'Төлем алынды',
  'payment.giveOnCredit': 'Қарызға беру',
  'payment.kaspiHint': 'Kaspi.kz қосымшасында клиентке QR көрсетіңіз. Төлем расталғанын көргенде — төмендегі түймені басыңыз.',
  'payment.creditHint': 'Тауар клиентке {amount} сомасына қарызға беріледі. Қарыз «Есеп айырысу» бөлімінде көрінеді.',

  'payment.split.title': 'Аралас төлем · {amount}',
  'payment.split.hint': 'Әр тәсілмен қанша өткенін жазыңыз. Нөл қалғанда ғана растауға болады — әйтпесе чек кассадағы ақшамен сәйкес келмейді.',
  'payment.split.fillRest': 'бүкіл қалдық',
  'payment.split.remaining': 'Енгізу қалды',
  'payment.split.overpaid': 'Чек сомасынан артық енгізілді',
  'payment.split.balanced': 'Сәйкес келеді',
  'payment.split.noChange': 'Қайтарым енгізілмейді: чек сомасын жазыңыз, қайтарымды кассадан беріңіз.',
  'payment.split.remainingButton': 'Енгізу қалды: {amount}',
  'payment.split.needTwo': 'Аралас төлем үшін екі тәсіл қажет',

  // --- the slip -----------------------------------------------------------
  'receipt.title': 'Чек',
  'receipt.brand': 'ANYQ Касса',
  'receipt.notFiscal': 'Тауар чегі',
  'receipt.notSynced': 'синхрондалмаған',
  'receipt.discount': 'Жеңілдік',
  'receipt.pointsSpent': 'Есептен шыққан ұпай',
  'receipt.pointsEarned': 'Есептелген ұпай',
  'receipt.total': 'Жиыны',
  'receipt.payment': 'Төлем',
  'receipt.customer': 'Клиент',
  'receipt.print': 'Басып шығару',
  'receipt.newSale': 'Жаңа сатылым',

  // --- getting around -----------------------------------------------------
  'tab.sale': 'Касса',
  'tab.products': 'Тауарлар',
  'tab.operations': 'Операциялар',
  'tab.profile': 'Профиль',
  'common.back': 'Артқа',
  'common.cancel': 'Болдырмау',
  'common.loading': 'Жүктелуде…',

  // --- the operations menu ------------------------------------------------
  'ops.orders': 'Сайттан тапсырыстар',
  'ops.batches': 'Партиялар',
  'ops.transfers': 'Ауыстырулар',
  'ops.incoming': 'Қабылдау',
  'ops.counts': 'Түгендеу',
  'ops.returns': 'Қайтарулар',
  'ops.replenishment': 'Не тапсырыс беру',
  'ops.purchaseOrders': 'Жеткізушіге тапсырыс',
  'ops.bins': 'Ұяшықтар',
  'ops.binCount': 'Ұяшықтар бойынша санау',
  'ops.reconciliation': 'Журналмен салыстыру',
  'ops.import': 'Тауарларды импорттау',
  'ops.settlements': 'Есеп айырысу және қарыздар',
  'ops.writeOffs': 'Есептен шығару және карантин',
  'ops.supplierReturns': 'Жеткізушіге қайтару',
  'ops.fiscal': 'Фискалдандыру',
  'ops.production': 'Өндіріс',
  'ops.stockHistory': 'Қойма тарихы',

  // --- the warehouse ------------------------------------------------------
  'warehouse.queued': 'Жіберуді күтіп тұрған қойма операциялары: {count}. Байланыс пайда болғанда өздері кетеді.',
  'warehouse.blockedTitle': '{kind}: сервер қабылдамады',
  'warehouse.blockedWaiting': 'Қалған қойма операциялары күтуде: келесілері осының өткеніне есептелген.',
  'warehouse.blockedQueue': 'Кезекте әлі {count}.',
  'warehouse.retry': 'Қайталау',
  'warehouse.discard': 'Операцияны болдырмау',

  'incoming.title': 'Қабылдау',
  'incoming.none': 'Қабылдау әлі болған жоқ',
  'incoming.new': 'Жаңа қабылдау',
  'incoming.supplier': 'Жеткізуші',
  'incoming.noSupplier': 'Жеткізушісіз',
  'incoming.photo': 'Жүкқұжат фотосы',
  'incoming.submit': 'Есепке алу',

  'count.title': 'Ұяшықтар бойынша санау',
  'count.pickBin': 'Ұяшықты таңдаңыз',
  'count.unplaced': 'Орналастырылмаған тауар',
  'count.noBins': 'Ұяшықтар жоқ — оларды «Ұяшықтар» бөлімінде құрыңыз',
  'count.whole': 'Ұяшық толық қайта саналады: онда табылмаған нәрсе — онда жоқ. Сондықтан дүкенді жаппай, күніне бір стеллажды санауға болады.',
  'count.enterFound': 'қанша тапқаныңызды жазыңыз. Бос жол «таппадым» дегенді білдіреді, бұл да нәтиже.',
  'count.system': 'жүйеде',
  'count.lastResult': 'Соңғы санаудың қорытындысы',
  'count.agreed': 'Алшақтық жоқ — ұяшық сәйкес келді',
  'count.submit': 'Санауды сақтау',

  'bins.title': 'Ұяшықтар',
  'bins.zone': '{zone} аймағы',
  'bins.empty': 'бос',
  'bins.positions': 'атауы: {count}',
  'bins.blocked': 'бұғатталған',
  'bins.block': 'Бұғаттау',
  'bins.unblock': 'Бұғаттан шығару',
  'bins.delete': 'Жою',

  'writeOff.title': 'Есептен шығару және карантин',
  'writeOff.reason': 'Себебі',
  'writeOff.note': 'Не болды',
  'writeOff.submit': 'Есептен шығару',

  'supplierReturn.title': 'Жеткізушіге қайтарулар',
  'supplierReturn.none': 'Қайтарулар әлі болған жоқ',
  'supplierReturn.new': 'Қайтаруды рәсімдеу',
  'supplierReturn.delivery': 'Жеткізілім',
  'supplierReturn.why': 'Ақау мен шатасқан тауар жеткізушіге қайтарылады, есептен шығарылмайды: оның алдындағы қарыз қайтарылғанның құнына кемиді.',

  'pick.title': 'Тапсырысты жинау',
  'pick.ordered': 'тапсырыс берілген: {count}',
  'pick.missing': '{count} жетпейді',
  'pick.complete': 'Толық жиналды',
  'pick.save': 'Жинауды сақтау',
  'pick.ship': 'Жіберу',
  'pick.shipPartial': 'Толық емес жіберу',
  'pick.nothing': 'Нөл жиналды',

  // --- the language itself ------------------------------------------------
  'language.title': 'Тіл',
  'language.partial': 'Қойма және иеге арналған экрандар әзірге орыс тілінде.',
};
