// Builds only what the service being deployed actually needs.
//
// Every service used to run the same command and build all three front ends.
// That was merely wasteful until the bundle check arrived, and then it was
// fatal: the front-end variables (VITE_API_URL and friends) are set on the
// front-end services, so when the *api* service built the tills it built them
// with no API address, they fell back to http://localhost:4000, and the check
// correctly refused to ship them. The api service's build failed over bundles
// the api service does not serve.
//
// The fix is not to hand every service every variable. It is to stop building
// what a service does not serve: the api needs a Prisma client and nothing else,
// and each front end needs itself. Builds get faster and a missing variable can
// only ever break the service it belongs to.
//
// RAILWAY_SERVICE_NAME is what railway-start.js already switches on, so a
// service is described in exactly one way across both.

const { spawnSync } = require('child_process');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const service = process.env.RAILWAY_SERVICE_NAME || '';
const FRONTENDS = ['admin', 'pos', 'orders'];

// The Prisma client is generated for every service: the api imports it directly,
// and the front ends share a workspace whose install step expects it to exist.
run('npm', ['run', 'generate', '--workspace=packages/db']);

if (service === 'api') {
  // Nothing else. The api serves JSON; it has no bundle to build and no
  // VITE_* variables, which is precisely why it must not build any.
  console.log('[build] api: Prisma client only, no front end to build');
} else if (FRONTENDS.includes(service)) {
  run('npm', ['run', 'build', `--workspace=apps/${service}`]);
  // Checked immediately, so a bundle with a local address in it fails the build
  // of the service that would have served it — rather than at a counter.
  run('node', ['scripts/check-bundle.mjs', service]);
} else if (service === 'maintenance') {
  console.log('[build] maintenance: nothing to build, it only calls the API');
} else if (service === 'backup') {
  // Клиент Prisma выше уже сгенерирован — им копия спрашивает версию сервера,
  // когда `pg_dump` в системе не той версии. Фронтендов у этой службы нет.
  console.log('[build] backup: Prisma client only; нужен pg_dump — NIXPACKS_PKGS=postgresql_16');
} else {
  // A new service, or one whose name does not match. Building everything is the
  // safe answer for an unknown, and saying so is better than silently doing it.
  console.log(`[build] unknown service ${JSON.stringify(service)} — building everything`);
  for (const app of FRONTENDS) run('npm', ['run', 'build', `--workspace=apps/${app}`]);
  run('node', ['scripts/check-bundle.mjs']);
}
