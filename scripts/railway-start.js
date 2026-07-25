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
} else {
  console.error('Unknown RAILWAY_SERVICE_NAME:', JSON.stringify(service));
  process.exit(1);
}
