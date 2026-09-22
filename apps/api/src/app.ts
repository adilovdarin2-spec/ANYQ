import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { pruneIdempotencyKeys } from './idempotency';
import { sendMorningSummaries } from './morning';
import { writeRateLimit } from './rateLimit';
import { metricsMiddleware, report } from './metrics-store';
import { drainFiscalQueue } from './fiscal-worker';
import { deepHealth } from './health';
import { networkFiscalProvider } from './fiscal-network';
import { authRouter } from './routes/auth';
import { companiesRouter } from './routes/companies';
import { cabinetRouter } from './routes/cabinet';
import { posRouter } from './routes/pos';
import { supplyRouter } from './routes/supply';

const defaultOrigins = ['http://localhost:5183', 'http://localhost:5184', 'http://localhost:5185'];

/**
 * Which front ends may talk to this server.
 *
 * Unset, this used to fall back to the three local development ports even in
 * production — which fails closed, so it is not a hole, but it fails in the one
 * place nobody is looking: the browser's console. Every screen would show a
 * network error, the server log would show nothing at all, and the person
 * debugging it has no reason to suspect CORS.
 *
 * Refused at start-up instead, with the answer in the message. A server that
 * will not boot is found in a minute; a shop whose till cannot reach it is found
 * by the queue.
 */
if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
  throw new Error(
    'ALLOWED_ORIGINS is not set. In production it would fall back to localhost, and every front end ' +
      'would be refused by CORS with nothing in the server log to say so. Set it to the deployed ' +
      'origins, comma-separated: https://kassa.example.kz,https://admin.example.kz,https://orders.example.kz',
  );
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : defaultOrigins;

const app = express();
// Express подписывается на каждом ответе: `X-Powered-By: Express`. Сама по
// себе подпись ничего не открывает, но она сообщает, что именно искать, и
// ничего не даёт взамен.
app.disable('x-powered-by');
// Railway terminates TLS and proxies every request through one internal hop,
// so req.ip must trust exactly that one hop — otherwise express-rate-limit
// (below) can't tell real clients apart and keys every login attempt off
// the same proxy address instead of the actual caller.
app.set('trust proxy', 1);
/**
 * Источники, которым уже отказали, — чтобы сказать про каждый один раз.
 *
 * С потолком: иначе любой, кто перебирает адреса, растит эту память сколько
 * захочет. Дойдя до потолка, перестаём запоминать — не перестаём отказывать.
 */
const refusedOrigins = new Set<string>();
const MAX_REFUSED_REMEMBERED = 50;

app.use(
  cors({
    /**
     * Имя файла должно доезжать до браузера.
     *
     * Касса и сервер стоят на разных доменах, а кросс-доменный ответ отдаёт
     * скрипту только простые заголовки: `Content-Disposition` браузер молча
     * прячет, пока сервер не разрешит его прочесть. Сервер имя считает — с
     * названием точки и датой, — клиент честно пытается его взять и не может,
     * и каждая выгрузка приезжает как `products.csv`, одинаковая для всех
     * точек и всех дней.
     *
     * Дороже всего это у выгрузок для 1С. Они названы `import.xml` и
     * `offers.xml` не для красоты: обработка «Обмен с сайтом» ищет файлы
     * ровно по этим именам. Без заголовка они приезжают как `1c-catalog.xml`
     * и `1c-offers.xml`, и бухгалтер переименовывает оба перед каждой
     * загрузкой — то самое ручное действие, ради отсутствия которого имена и
     * выбирались.
     */
    exposedHeaders: ['Content-Disposition'],
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // Отказ, а не ошибка. `callback(new Error(...))` уходил в обработчик
      // ошибок и превращался в 500 со стеком в логе — а браузер видел ответ
      // без CORS-заголовков и показывал «network error». То есть ровно тот
      // случай, ради которого написана проверка ALLOWED_ORIGINS выше: человек,
      // разбирающийся с этим, не имеет причин заподозрить CORS. Здесь мы
      // просто не выдаём разрешение, и запрос отклоняет браузер — как и
      // задумано, без пятисотки.
      if (!refusedOrigins.has(origin) && refusedOrigins.size < MAX_REFUSED_REMEMBERED) {
        refusedOrigins.add(origin);
        console.warn(
          `[cors] отказано источнику ${origin}. Разрешены: ${allowedOrigins.join(', ') || '(пусто)'}. ` +
            'Если это ваш собственный фронтенд — добавьте его в ALLOWED_ORIGINS ровно в том виде, ' +
            'в каком браузер шлёт Origin: со схемой, без завершающего слэша.',
        );
      }
      callback(null, false);
    },
  }),
);
// Before everything that can fail, so a request that is rejected by CORS, by
// the rate limiter or by a parse error is still counted. Metrics that only
// cover the requests which went well describe a server nobody is running.
app.use(metricsMiddleware);

/**
 * Сжатие ответов.
 *
 * Касса возит каталог целиком — иначе она не сможет торговать без сети — и
 * перечитывает его, пока смена открыта. Замер на пустой базе: 500 товаров —
 * 161 КБ, 3000 — 965 КБ, 10 000 — 3,2 МБ на один ответ. Это JSON из
 * повторяющихся ключей, он жмётся в разы, и до сих пор не жался вовсе: ни
 * сервер, ни край Railway тела не трогали.
 *
 * Кому это считается деньгами: планшет на складе сидит на мобильном интернете,
 * и оптовик с тремя тысячами позиций платил бы за мегабайт там, где хватает
 * сотни килобайт. То же касается выгрузок и отчётов — они текстовые и жмутся
 * так же.
 *
 * Порог по умолчанию — килобайт: мелкие ответы вроде `{"ok":true}` от сжатия
 * только толстеют, и их не трогают. Стоит здесь, до маршрутов, потому что
 * сжимать надо всё, что они отдадут.
 */
app.use(compression());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  /* Сюда ходят только по https, и пусть браузер это запомнит.

     Railway отвечает на http редиректом, но редирект — это первый запрос,
     который всё-таки ушёл открытым. Браузер, увидевший этот заголовок,
     следующие полгода на http даже не постучится.

     Ставится только если запрос и правда пришёл по https: на локальной
     разработке такой заголовок запер бы разработчику его собственный http.
     `preload` не ставим — это заявка в список браузеров, которую нельзя
     быстро отозвать, а домен ещё поменяется. */
  if (req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// Every mutating request, wherever it lands. Applied here rather than route by
// route, because a limit somebody has to remember to add is one the next
// endpoint will be missing. Reads are left alone: they cost little and a
// throttled dashboard helps nobody.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  writeRateLimit(req, res, next);
});

// Жив ли процесс — и больше ничего. По этому адресу Railway решает, удался ли
// деплой и не пора ли перезапустить службу, поэтому он намеренно ни от чего не
// зависит: падение здесь из-за недоступной базы заставило бы перезапускать API,
// который в этом не виноват и от перезапуска не починится.
app.get('/health', (_req, res) => res.json({ ok: true }));

// Может ли касса работать. Это зовёт внешняя проверка, которая живёт не на
// Railway (`scripts/uptime-check.mjs`), и падать здесь можно: по этому адресу
// никто службу не перезапускает. Почему проверок две, написано в health.ts.
app.get('/health/deep', async (_req, res) => {
  const health = await deepHealth();
  res.status(health.ok ? 200 : 503).json(health);
});

// The two numbers the pilot charter is written in, and the routes missing
// them. Guarded by the same shared secret as the maintenance hooks rather than
// a user session: this is for whoever runs the server, and latency figures per
// route are a map of where to push if somebody wanted to.
app.get('/metrics', (req, res) => {
  const secret = process.env.MAINTENANCE_SECRET;
  if (!secret || req.header('x-maintenance-secret') !== secret) {
    // 404 rather than 403: an endpoint that answers "wrong secret" has
    // confirmed it exists.
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json(report());
});

// Housekeeping the deployment's scheduler calls. Guarded by a shared secret
// rather than a user session: there is no user behind a cron job, and giving
// one an account is worse than a header.
// Drains the fiscal queue. Called on a schedule rather than run as a loop
// inside the API process: a loop in the web process competes with cashiers for
// the event loop, and a receipt that is a minute late costs nothing while a
// register that stutters costs a queue at the counter.
app.post('/maintenance/drain-fiscal-queue', async (req, res) => {
  const secret = process.env.MAINTENANCE_SECRET;
  if (!secret || req.header('x-maintenance-secret') !== secret) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json(await drainFiscalQueue(networkFiscalProvider()));
});

/**
 * Утренняя сводка владельцам.
 *
 * Единственная задача планировщика, которая обращается к людям, а не к очереди,
 * — и поэтому единственная, у которой время имеет значение. Планировщик зовёт
 * её раз в сутки утром; сервер сам решает, кому есть что сказать, и молчит там,
 * где вчера ничего не произошло.
 */
app.post('/maintenance/daily-summary', async (req, res) => {
  const secret = process.env.MAINTENANCE_SECRET;
  if (!secret || req.header('x-maintenance-secret') !== secret) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json(await sendMorningSummaries());
});

app.post('/maintenance/prune-idempotency-keys', async (req, res) => {
  const secret = process.env.MAINTENANCE_SECRET;
  if (!secret || req.header('x-maintenance-secret') !== secret) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  const removed = await pruneIdempotencyKeys();
  res.json({ removed });
});
app.use('/auth', authRouter);
app.use('/companies', companiesRouter);
app.use('/pos', posRouter);
app.use('/cabinet', cabinetRouter);
app.use('/supply', supplyRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Не найдено' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

export { app };
