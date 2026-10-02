// Builds the Windows installer (Setup.exe) for the POS application.
//
// Equivalent to `npm run dist`. The NSIS installer it produces installs
// cleanly on any 64-bit Windows machine and creates Start Menu / Desktop
// shortcuts. Output lands in ./release-builds

const { spawnSync } = require('child_process');
const path = require('path');

const binary = path.join(
  __dirname,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
);

const args = ['--win', 'nsis', '--x64', '--publish', 'never'];

console.log('Building Windows installer...');

const result = spawnSync(binary, args, {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

if (result.status !== 0) {
  console.error('Installer build failed.');
  process.exit(result.status === null ? 1 : result.status);
}

console.log('Installer build complete. See the release-builds folder.');