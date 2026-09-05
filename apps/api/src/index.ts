// The process. Everything the application actually is lives in app.ts, so a
// test can start the same object on an ephemeral port rather than testing a
// reconstruction of it — a test that assembles its own express app proves
// things about that app and not about the one that ships.
import { app } from './app';

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`ANYQ API listening on http://localhost:${PORT}`);
});
