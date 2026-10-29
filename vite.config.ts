/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { parse } from 'yaml';

/** Lädt *.yaml-Dateien als JSON-Modul (Fragenkatalog). */
function yamlPlugin(): Plugin {
  return {
    name: 'gyoquiz-yaml',
    transform(code, id) {
      if (!/\.ya?ml$/.test(id)) return null;
      return { code: `export default ${JSON.stringify(parse(code))};`, map: null };
    },
  };
}

export default defineConfig({
  // Relativer Pfad, damit die Seite unter https://<user>.github.io/gyoquiz/ und mit eigener Domain läuft.
  base: './',
  plugins: [yamlPlugin()],
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
