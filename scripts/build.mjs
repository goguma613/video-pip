// 사용법: node scripts/build.mjs        → video-pip.user.js 생성
//         node scripts/build.mjs --dev  → 감시 + http://localhost:8787/video-pip.user.js 제공
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { banner } from './meta.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dev = process.argv.includes('--dev');

const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'video-pip.user.js',
  bundle: true,
  format: 'iife',
  target: ['chrome116', 'firefox128'],
  charset: 'utf8',          // 한글을 \uXXXX로 바꾸지 않음 → 설치하는 사람이 읽을 수 있게
  minify: false,
  legalComments: 'none',
  loader: { '.css': 'text' },
  define: { __VERSION__: JSON.stringify(version) },
  banner: { js: banner(version) },
  logLevel: 'info',
};

if (dev) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: '.', port: 8787 });
  console.log(`\n설치/업데이트 URL: http://localhost:${port}/video-pip.user.js\n`);
} else {
  await esbuild.build(options);
}
