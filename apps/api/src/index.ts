import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { pruneIdempotencyKeys } from './idempotency';
import { writeRateLimit } from './rateLimit';
import { authRouter } from './routes/auth';
import { companiesRouter } from './routes/companies';
import { posRouter } from './routes/pos';
import { supplyRouter } from './routes/supply';

const defaultOrigins = ['http://localhost:5183', 'http://localhost:5184', 'http://localhost:5185'];
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : defaultOrigins;

const app = express();
// Railway terminates TLS and proxies every request through one internal hop,
// so req.ip must trust exactly that one hop — otherwise express-rate-limit
// (below) can't tell real clients apart and keys every login attempt off
// the same proxy address instead of the actual caller.
app.set('trust proxy', 1);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
  }),
);
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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

app.get('/health', (_req, res) => res.json({ ok: true }));

// Housekeeping the deployment's scheduler calls. Guarded by a shared secret
// rather than a user session: there is no user behind a cron job, and giving
// one an account is worse than a header.
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
app.use('/supply', supplyRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Не найдено' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`ANYQ API listening on http://localhost:${PORT}`);
});
