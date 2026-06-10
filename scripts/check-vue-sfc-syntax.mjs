import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const root = process.cwd();
const vueFiles = [];
const ignored = new Set(['node_modules', 'dist', 'target', '.git']);

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignored.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (entry.endsWith('.vue')) vueFiles.push(full);
  }
}

function extractScriptBlocks(source) {
  const blocks = [];
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(source))) blocks.push(match[1]);
  return blocks;
}

walk(root);
const failures = [];
for (const file of vueFiles) {
  const source = readFileSync(file, 'utf8');
  const blocks = extractScriptBlocks(source);
  blocks.forEach((block, index) => {
    const result = ts.transpileModule(block, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: `${file}#script-${index + 1}.ts`,
      reportDiagnostics: true,
    });
    for (const diagnostic of result.diagnostics || []) {
      if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
      const pos =
        typeof diagnostic.start === 'number'
          ? ts.getLineAndCharacterOfPosition(
              ts.createSourceFile(file, block, ts.ScriptTarget.Latest, true),
              diagnostic.start,
            )
          : null;
      const line = pos ? pos.line + 1 : '?';
      const col = pos ? pos.character + 1 : '?';
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      failures.push(`${relative(root, file)}:${line}:${col}: ${message}`);
    }
  });
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Vue SFC script syntax check OK (${vueFiles.length} .vue files).`);
