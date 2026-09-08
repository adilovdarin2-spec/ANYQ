const { spawnSync } = require('child_process');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  process.exit(result.status ?? 1);
}

function runOrExit(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const service = process.env.RAILWAY_SERVICE_NAME || '';

if (service === 'api') {
  runOrExit('npm', ['run', 'migrate:deploy', '--workspace=packages/db']);
  run('npm', ['run', 'start', '--workspace=apps/api']);
} else if (service === 'admin') {
  run('npm', ['run', 'start', '--workspace=apps/admin']);
} else if (service === 'pos') {
  run('npm', ['run', 'start', '--workspace=apps/pos']);
} else if (service === 'orders') {
  run('npm', ['run', 'start', '--workspace=apps/orders']);
} else if (service === 'maintenance') {
  // Its own service rather than a loop inside the API: a drain competing with
  // cashiers for the event loop costs a queue at the counter, and a receipt a
  // minute late costs nothing. Needs API_URL and MAINTENANCE_SECRET.
  run('node', ['scripts/maintenance.mjs', '--loop']);
} else {
  console.error('Unknown RAILWAY_SERVICE_NAME:', JSON.stringify(service));
  process.exit(1);
}
