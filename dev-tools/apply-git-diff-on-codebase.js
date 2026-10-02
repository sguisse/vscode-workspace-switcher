#!/usr/bin/env node
/**
 * Applies a YAML "generation manifest" (file create/update/delete list) to the workspace.
 *
 * Features:
 * - Full AST syntax validation via TypeScript Compiler API.
 * - Double-check regex gate for JSX corruption signatures (e.g. `prop="{val}"`).
 * - Workspace rollback on build or syntax failure.
 *
 * Usage: node dev-tools/apply-generation-manifest.js path/to/manifest.yaml
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const ts = require('typescript');

const WORKSPACE_ROOT = process.cwd();
const VALID_ACTIONS = new Set(['create', 'update', 'delete']);
const SYNTAX_CHECKED_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx']);

// Pattern for common LLM JSX corruption signatures
const JSX_CORRUPTION_REGEX = /="\{|\}"|=>"[[:space:]]*>/;

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function resolveTargetPath(entry, index) {
  if (!entry.filename || typeof entry.filename !== 'string') fail(`Entry #${index}: missing 'filename'.`);
  if (!entry.extension || typeof entry.extension !== 'string') fail(`Entry #${index}: missing 'extension'.`);
  if (!entry.path || typeof entry.path !== 'string') fail(`Entry #${index}: missing 'path'.`);
  if (!VALID_ACTIONS.has(entry.action)) fail(`Entry #${index}: 'action' must be one of create|update|delete.`);
  if (entry.action !== 'delete' && typeof entry.content !== 'string') {
    fail(`Entry #${index} (${entry.filename}.${entry.extension}): 'content' is required for action '${entry.action}'.`);
  }

  const targetDir = path.resolve(WORKSPACE_ROOT, entry.path);
  const targetFile = path.join(targetDir, `${entry.filename}.${entry.extension}`);

  const relative = path.relative(WORKSPACE_ROOT, targetFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`Entry #${index} (${entry.filename}.${entry.extension}): path escapes workspace root.`);
  }

  return targetFile;
}

function checkSyntax(entry, targetFile) {
  const errors = [];

  // 1. Regex Pre-Check for known LLM JSX corruption patterns
  const lines = entry.content.split('\n');
  lines.forEach((lineText, idx) => {
    if (JSX_CORRUPTION_REGEX.test(lineText)) {
      errors.push(`line ${idx + 1}: JSX corruption signature detected (quoted brace or truncated callback): "${lineText.trim()}"`);
    }
  });

  // 2. TypeScript Compiler AST Parsing
  const isJsx = targetFile.endsWith('.tsx') || targetFile.endsWith('.jsx');
  const result = ts.transpileModule(entry.content, {
    compilerOptions: {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      jsx: isJsx ? ts.JsxEmit.ReactJSX : ts.JsxEmit.None,
    },
    reportDiagnostics: true,
    fileName: targetFile,
  });

  (result.diagnostics || []).forEach((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      errors.push(`line ${line + 1}, col ${character + 1}: ${message}`);
    } else {
      errors.push(message);
    }
  });

  return errors; // Fixed! Now correctly returns the diagnostic array
}

function main() {
  const manifestArg = process.argv[2];
  if (!manifestArg) fail('Usage: node dev-tools/apply-generation-manifest.js path/to/manifest.yaml');

  const manifestPath = path.resolve(WORKSPACE_ROOT, manifestArg);
  if (!fs.existsSync(manifestPath)) fail(`Manifest not found: ${manifestPath}`);

  let manifest;
  try {
    manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    fail(`Failed to parse YAML manifest: ${err.message}`);
  }

  const files = manifest?.generation?.files;
  if (!Array.isArray(files) || files.length === 0) fail("Manifest must define 'generation.files' as a non-empty array.");

  console.log(`🚀 Validating ${files.length} manifest entr${files.length === 1 ? 'y' : 'ies'}...`);

  const resolvedEntries = [];
  const validationErrors = [];

  files.forEach((entry, index) => {
    const targetFile = resolveTargetPath(entry, index);
    resolvedEntries.push({ entry, targetFile });

    if (entry.action === 'delete') return;

    const ext = entry.extension.replace(/^\./, '');
    if (SYNTAX_CHECKED_EXTENSIONS.has(ext)) {
      const errors = checkSyntax(entry, targetFile);
      if (errors.length > 0) {
        validationErrors.push({ targetFile, errors });
      }
    }
  });

  if (validationErrors.length > 0) {
    console.error(`❌ Syntax validation failed for ${validationErrors.length} file(s). Zero disk writes performed.`);
    validationErrors.forEach(({ targetFile, errors }) => {
      console.error(`\n  ${path.relative(WORKSPACE_ROOT, targetFile)}`);
      errors.forEach((e) => console.error(`    - ${e}`));
    });
    process.exit(1);
  }

  console.log('✅ All entries passed syntax validation. Creating backups and applying to disk...');

  // Create in-memory backups for atomic rollback if `npm run build` fails
  const backups = new Map();
  resolvedEntries.forEach(({ targetFile }) => {
    if (fs.existsSync(targetFile)) {
      backups.set(targetFile, fs.readFileSync(targetFile));
    } else {
      backups.set(targetFile, null); // File didn't exist before
    }
  });

  try {
    resolvedEntries.forEach(({ entry, targetFile }) => {
      const relativeDisplay = path.relative(WORKSPACE_ROOT, targetFile);
      if (entry.action === 'delete') {
        if (fs.existsSync(targetFile)) {
          fs.unlinkSync(targetFile);
          console.log(`🗑️ Removed existing file: '${relativeDisplay}'`);
        }
        return;
      }

      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      const icon = entry.action === 'create' ? '➕ Creating new file' : '✏️ Modifying existing file';
      console.log(`${icon}: '${relativeDisplay}'`);
      fs.writeFileSync(targetFile, entry.content, 'utf8');
    });

    console.log('🧪 Running workspace build verification...');
    execFileSync('npm', ['run', 'build'], { cwd: WORKSPACE_ROOT, stdio: 'inherit' });

  } catch (err) {
    console.error('\n❌ Workspace build verification failed! Rolling back disk changes...');
    backups.forEach((content, file) => {
      if (content === null) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } else {
        fs.writeFileSync(file, content);
      }
    });
    fail('Rollback complete. Workspace restored to clean state.');
  }

  const commitMessage = manifest?.commit?.message;
  if (commitMessage) console.log(`\n${commitMessage}`);
}

main();
