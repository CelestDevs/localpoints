/**
 * build.js — Minificação de produção Local Points
 *
 * Usa Terser para minificação robusta de JS (instalado via npm).
 * CSS e HTML são processados com parser interno.
 *
 * Uso: node build.js
 * Requer: npm install (terser como devDependency)
 */

const fs   = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, 'public');
const DEST = path.join(__dirname, 'dist');

// ── Verificar se Terser está disponível ──────────────────────
let terser = null;
try {
  terser = require('terser');
} catch(e) {
  console.log('⚠  Terser não encontrado — usando minificação básica (npm install para melhor resultado)');
}

// ── Utilitários ───────────────────────────────────────────────
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src,  entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ── Minificação JS com Terser ─────────────────────────────────
async function minifyJS(code, filePath) {
  if (terser) {
    try {
      const result = await terser.minify(code, {
        compress: {
          drop_console: false,   // manter console.log/warn (usados para debug de produção)
          drop_debugger: true,
          dead_code: true,
          passes: 2,
        },
        mangle: false,           // NÃO renomear variáveis/funções — seguro para onclick=""
        format: {
          comments: false,       // remover todos os comentários
          semicolons: true,
        },
      });
      if (result.code) return result.code;
    } catch(e) {
      console.warn(`  ⚠  Terser falhou em ${filePath}: ${e.message} — usando fallback`);
    }
  }
  // Fallback: remoção básica de comentários e espaços
  return basicMinifyJS(code);
}

function basicMinifyJS(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')           // bloco comentários
    .replace(/^\s*\/\/.*$/gm, '')                // linha comentários
    .replace(/\n\s*\n/g, '\n')                   // linhas vazias
    .split('\n').map(l => l.trimEnd()).join('\n') // trailing spaces
    .trim();
}

// ── Minificação CSS ───────────────────────────────────────────
function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

// ── Processar HTML ────────────────────────────────────────────
async function processHTML(content, filePath) {
  let result = content;

  // Minificar <script> inline (sem src=)
  const scriptMatches = [];
  const scriptRegex = /<script(?:\s(?![^>]*\bsrc\s*=)[^>]*)?>[\s\S]*?<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    if (!/src\s*=/i.test(match[0])) {
      scriptMatches.push({ full: match[0], index: match.index });
    }
  }

  // Processar de trás para frente para preservar índices
  for (const m of scriptMatches.reverse()) {
    const open  = m.full.match(/^<script[^>]*>/i)[0];
    const close = '</script>';
    const inner = m.full.slice(open.length, m.full.length - close.length);
    try {
      const mini = await minifyJS(inner, filePath);
      const replacement = open + '\n' + mini + '\n' + close;
      result = result.slice(0, m.index) + replacement + result.slice(m.index + m.full.length);
    } catch(e) {
      // mantém original se falhar
    }
  }

  // Minificar <style> inline
  result = result.replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi, m => {
    const open  = m.match(/^<style[^>]*>/i)[0];
    const close = '</style>';
    const inner = m.slice(open.length, m.length - close.length);
    try { return open + minifyCSS(inner) + close; }
    catch(e) { return m; }
  });

  return result;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('\n🔨 Local Points Build — Minificação de produção');
  console.log('='.repeat(55));
  console.log(terser ? '  Engine: Terser (completo)' : '  Engine: Básico (instale terser para melhor resultado)');
  console.log('');

  // Limpar e recriar dist/
  if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true });
  fs.mkdirSync(DEST, { recursive: true });
  copyDirSync(SRC, DEST);
  console.log('  ✅ Copiado public/ → dist/\n');

  // ── Cache-busting do CSS via BUILD_ID ──────────────────────────
  // Lê o BUILD_ID definido manualmente em sw.js e adiciona ?v=BUILD_ID
  // em todos os <link> de style.css. Isso garante que cada deploy peça
  // uma URL fisicamente diferente — imune a qualquer SW/CDN servindo
  // uma cópia antiga de style.css com o mesmo nome de arquivo.
  const swSrcPath = path.join(DEST, 'sw.js');
  let buildId = null;
  if (fs.existsSync(swSrcPath)) {
    const m = fs.readFileSync(swSrcPath, 'utf8').match(/const BUILD_ID\s*=\s*['"]([^'"]+)['"]/);
    if (m) buildId = m[1];
  }
  if (buildId) {
    console.log(`  🔖 BUILD_ID detectado em sw.js: ${buildId}`);
    const htmlForCss = [];
    (function findHTML(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) findHTML(full);
        else if (e.name.endsWith('.html')) htmlForCss.push(full);
      }
    })(DEST);
    let cssCount = 0;
    for (const f of htmlForCss) {
      let html = fs.readFileSync(f, 'utf8');
      const before = html;
      html = html.replace(
        /(href=["'][^"']*style\.css)(["'])/g,
        `$1?v=${buildId}$2`
      );
      if (html !== before) {
        fs.writeFileSync(f, html, 'utf8');
        cssCount++;
      }
    }
    console.log(`  🔖 Cache-busting (?v=${buildId}) aplicado em ${cssCount} arquivo(s) HTML\n`);
  } else {
    console.warn('  ⚠ BUILD_ID não encontrado em sw.js — cache-busting do CSS não aplicado\n');
  }

  let totalOrig = 0, totalMini = 0;

  function stats(filePath, orig, mini) {
    totalOrig += orig;
    totalMini += mini;
    const pct  = (((orig - mini) / orig) * 100).toFixed(1);
    const rel  = path.relative(DEST, filePath);
    console.log(`  ${rel.padEnd(42)} ${(orig/1024).toFixed(1).padStart(6)} KB → ${(mini/1024).toFixed(1).padStart(6)} KB  (-${pct}%)`);
  }

  // HTMLs
  function findFiles(dir, ext, result = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) findFiles(full, ext, result);
      else if (e.name.endsWith(ext) && !e.name.endsWith('.bak') && !e.name.endsWith('.bak2')) result.push(full);
    }
    return result;
  }

  console.log('  HTML:');
  for (const f of findFiles(DEST, '.html')) {
    const orig = fs.readFileSync(f, 'utf8');
    const mini = await processHTML(orig, f);
    fs.writeFileSync(f, mini, 'utf8');
    stats(f, Buffer.byteLength(orig), Buffer.byteLength(mini));
  }

  console.log('\n  JS:');
  const jsFiles = findFiles(path.join(DEST, 'assets', 'js'), '.js');
  const swFile  = path.join(DEST, 'sw.js');
  if (fs.existsSync(swFile)) jsFiles.push(swFile);
  for (const f of jsFiles) {
    if (f.endsWith('.min.js')) continue;
    const orig = fs.readFileSync(f, 'utf8');
    const mini = await minifyJS(orig, f);
    fs.writeFileSync(f, mini, 'utf8');
    stats(f, Buffer.byteLength(orig), Buffer.byteLength(mini));
  }

  console.log('\n  CSS:');
  for (const f of findFiles(path.join(DEST, 'assets', 'css'), '.css')) {
    const orig = fs.readFileSync(f, 'utf8');
    const mini = minifyCSS(orig);
    fs.writeFileSync(f, mini, 'utf8');
    stats(f, Buffer.byteLength(orig), Buffer.byteLength(mini));
  }

  console.log('\n' + '='.repeat(55));
  const pct = (((totalOrig - totalMini) / totalOrig) * 100).toFixed(1);
  console.log(`  Total: ${(totalOrig/1024).toFixed(1)} KB → ${(totalMini/1024).toFixed(1)} KB  (-${pct}%)`);
  console.log(`  Build em: dist/\n`);
}

main().catch(e => { console.error('Build falhou:', e); process.exit(1); });
