/**
 * Manifest / wiring invariants for the Super Cards bundle.
 *
 * These are cross-file checks the two half-owners cannot make on their own:
 * the package declares the files it ships, the patch row matches the package,
 * display resources exist in both locales, and both halves advertise the same
 * wire contract (`render_ui`).
 */
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const read = (relative) => readFileSync(new URL(relative, ROOT), 'utf8')
const pkg = JSON.parse(read('package.json'))

test('package identity and bundle declaration', () => {
  assert.equal(pkg.name, 'dsh-super-cards')
  assert.equal(pkg.type, 'module')
  assert.ok(pkg.private !== true, 'a published package is not private')
  assert.equal(pkg.publishConfig.access, 'public')
  assert.match(pkg.repository.url, /github\.com\/baitouwuya\/dsh-super-cards/)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.ok(Array.isArray(pkg.dsh.client.inject))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-tool'))
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['./icon'], './icon.svg')
  assert.ok(pkg.exports['./locale/*.json'])
  assert.ok(pkg.files.includes('index.js'))
  assert.ok(pkg.files.includes('lib/*.js'))
  assert.ok(pkg.files.includes('client.js'))
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.ok(pkg.files.includes('icon.svg'))
})

test('shipped files exist', () => {
  for (const file of ['index.js', 'lib/shared.js', 'lib/blocks.js', 'lib/spec.js', 'lib/tools.js', 'lib/config.js', 'lib/service.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json', 'README.md', 'SPEC.md', 'ARCHITECTURE.md']) {
    const stat = statSync(new URL(file, ROOT))
    assert.ok(stat.size > 0, `${file} is empty`)
  }
})

test('patch inserts the declared row', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /insert:/)
  assert.match(patch, /id:\s*super-cards/)
  assert.match(patch, /name:\s*'dsh-super-cards'/)
})

test('display metadata is complete in both locales', () => {
  for (const locale of ['en', 'zh']) {
    const dict = JSON.parse(read(`locale/${locale}.json`))
    assert.equal(typeof dict.meta.title, 'string')
    assert.equal(typeof dict.meta.description, 'string')
    assert.ok(dict.meta.title.trim().length > 0)
    assert.ok(dict.meta.description.trim().length > 20)
  }
  const en = JSON.parse(read('locale/en.json'))
  const zh = JSON.parse(read('locale/zh.json'))
  assert.notEqual(en.meta.title, zh.meta.title, 'zh title must be localized')
})

test('icon is a self-contained SVG inside the size limit', () => {
  const svg = read('icon.svg')
  assert.match(svg.trimStart(), /^<svg[\s>]/)
  assert.match(svg, /viewBox="0 0 64 64"/)
  // A namespace URI is not a fetch; only references that would load something remote are banned.
  assert.ok(!/(?:href|src)\s*=\s*['"]https?:/i.test(svg), 'icon must not reference remote resources')
  assert.ok(!/url\(\s*['"]?https?:/i.test(svg), 'icon must not reference remote resources')
  assert.ok(Buffer.byteLength(svg) < 256 * 1024)
})

test('host half exports the plugin contract with the render_ui wire name', async () => {
  const mod = await import(pathToFileURL(new URL('index.js', ROOT).pathname).href)
  assert.equal(typeof mod.apply, 'function')
  assert.ok(Array.isArray(mod.inject))
  assert.ok(mod.inject.includes('tools'))
  assert.ok(mod.inject.includes('systemPrompt'))
  assert.equal(typeof mod.default, 'undefined', 'must not mix export forms')
  // The row config is declared as a dependency-free Standard Schema.
  assert.equal(typeof mod.Config['~standard'].validate, 'function', 'Config must be a Standard Schema')
  // The tool name lives in the tool-definition module; the source must carry
  // the exact wire name that the client keys its view by.
  const source = read('lib/tools.js')
  assert.match(source, /name:\s*'render_ui'/)
  // The modular Host half: the entry defers to ./lib and ships those modules.
  assert.match(read('index.js'), /from '\.\/lib\//)
})

test('client half registers the matching toolview key', () => {
  const source = read('client.js')
  assert.match(source, /__ModuleLoader__\.load\(/)
  assert.match(source, /id:\s*'dsh-super-cards'/)
  assert.match(source, /'tool\.call\.toolview'/)
  // The wire name must be literally present at the registration site or in the
  // constant that feeds it; a typo would silently never render.
  assert.ok(
    /key:\s*'render_ui'/.test(source) || /KEY\s*=\s*'render_ui'/.test(source),
    "client must key its toolview by the exact wire name 'render_ui'",
  )
  assert.ok(!/require\(\s*'@deepseek-ai\//.test(source), 'client must not import Harness packages')
})