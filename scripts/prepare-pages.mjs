import { cpSync, writeFileSync } from 'node:fs';
cpSync('site', 'dist-pages', { recursive: true });
cpSync('public/favicon.svg', 'dist-pages/favicon.svg');
writeFileSync('dist-pages/.nojekyll', '');
