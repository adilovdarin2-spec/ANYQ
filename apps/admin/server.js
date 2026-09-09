import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../../scripts/static-server.mjs';

// Everything this used to do by hand — MIME types, the SPA fallback, the
// security headers — now lives in one place, because all three copies were the
// same file and every fix had to be made three times. Cache headers and gzip
// arrived with the move; see the comments there for why they matter to a shop
// on a bad connection.
serveStatic({
  name: 'admin',
  rootDir: path.dirname(fileURLToPath(import.meta.url)),
  defaultPort: 4173,
  // A superadmin panel has no legitimate reason to be inside somebody else's page.
  frameAncestors: 'DENY',
});
