// Bump the build number, verify, and build into site/b<N>/.
// Run before every push: `npm run release`.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
// Verify first so a failing check never burns a build number.
run('npx tsc --noEmit');
run('npx vitest run');

const info = JSON.parse(readFileSync('build.json', 'utf8'));
info.build += 1;
writeFileSync('build.json', `${JSON.stringify(info, null, 2)}\n`);
run('npx vite build');

// Point the README's play link at the new build.
const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
const url = `https://raw.githack.com/johnmerm/Worldwar198x/${branch}/site/b${info.build}/index.html`;
const readme = readFileSync('README.md', 'utf8').replace(
  /<!-- play-link -->.*<!-- \/play-link -->/,
  `<!-- play-link -->**[▶ Play build ${info.build}](${url})**<!-- /play-link -->`,
);
writeFileSync('README.md', readme);
console.log(`\nBuild ${info.build} ready: ${url}`);
