// Verify, bump the build ID, and build into site/b<ID>/ (e.g. b6, or b6-1 on a side branch).
// Run before every push: `npm run release`.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
// Verify first so a failing check never burns a build number.
run('npx tsc --noEmit');
run('npx vitest run');

const info = JSON.parse(readFileSync('build.json', 'utf8'));
// Side branches keep main's build number and count sub-builds: 6-1, 6-2, ...
if (info.sub === undefined) info.build += 1;
else info.sub += 1;
writeFileSync('build.json', `${JSON.stringify(info, null, 2)}\n`);
const id = info.sub === undefined ? `${info.build}` : `${info.build}-${info.sub}`;
run('npx vite build');

// Point the README's play link at the new build.
const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
const url = `https://raw.githack.com/johnmerm/Worldwar198x/${branch}/site/b${id}/index.html`;
const readme = readFileSync('README.md', 'utf8').replace(
  /<!-- play-link -->.*<!-- \/play-link -->/,
  `<!-- play-link -->**[▶ Play build ${id}](${url})**<!-- /play-link -->`,
);
writeFileSync('README.md', readme);
console.log(`\nBuild ${id} ready: ${url}`);
