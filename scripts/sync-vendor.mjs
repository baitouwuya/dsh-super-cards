/**
 * Refresh the vendored Harness packages this plugin imports at load time.
 *
 * `lib/config.js` imports `@deepseek-ai/schemastery`, and that package imports
 * `@deepseek-ai/cosmokit`. A local plugin cannot resolve them from the app's
 * own `node_modules`, so the plugin keeps an exact copy of the pair the running
 * app was built with. After a DeepSeek Harness update, either the versions
 * drift or the copy goes stale; run
 *
 *   npm run sync:vendor
 *   npm run sync:vendor -- "/path/to/DeepSeek Harness.app/Contents/Resources/app.asar"
 *
 * to lift both packages out of the installed app bundle and into
 * `node_modules/@deepseek-ai/`. The versions written are the app's own, so the
 * settings projection, the volatile markers and the Cordis fiber all run the
 * same code as the host.
 */
import { closeSync, existsSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')
const VENDOR_TARGET = join(PLUGIN_ROOT, 'node_modules', '@deepseek-ai')
const PACKAGES = ['schemastery', 'cosmokit']

/** The installed desktop app ships the runtime inside one asar archive. */
const DEFAULT_ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'

/**
 * Read the asar header and return its file table.
 * @param {string} archive path to the asar archive.
 * @returns {{ header: object, dataOffset: number }} parsed header and payload base.
 */
function readArchive(archive) {
  const fd = openSync(archive, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    // Layout: [4, pickleSize, stringSize, jsonSize, ...json bytes]
    const headerSize = head.readUInt32LE(4)
    const payload = Buffer.alloc(headerSize)
    readSync(fd, payload, 0, headerSize, 8)
    const jsonLength = payload.readUInt32LE(4)
    const json = payload.subarray(8, 8 + jsonLength).toString('utf8')
    return { header: JSON.parse(json), dataOffset: 8 + headerSize }
  } finally {
    closeSync(fd)
  }
}

/**
 * Resolve one path inside the asar file table.
 * @param {object} header asar header.
 * @param {string} path slash-separated archive path.
 * @returns {object|undefined} the file or directory node.
 */
function findEntry(header, path) {
  let node = header
  for (const part of path.split('/').filter(Boolean)) {
    if (node === undefined || node.files === undefined) return undefined
    node = node.files[part]
  }
  return node
}

/**
 * Extract one archive subtree to disk.
 * @param {number} fd open archive descriptor.
 * @param {number} dataOffset payload base offset.
 * @param {object} node directory node.
 * @param {string} rel path relative to the destination root.
 * @param {string} out destination root.
 * @returns {void}
 */
function extractNode(fd, dataOffset, node, rel, out) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const childRel = rel === '' ? name : rel + '/' + name
    const target = join(out, childRel)
    if (child.files !== undefined) {
      if (child.link !== undefined) continue
      mkdirSync(target, { recursive: true })
      extractNode(fd, dataOffset, child, childRel, out)
      continue
    }
    if (child.link !== undefined || typeof child.size !== 'number' || child.size === 0) continue
    mkdirSync(dirname(target), { recursive: true })
    const buffer = Buffer.alloc(child.size)
    readSync(fd, buffer, 0, child.size, dataOffset + Number(child.offset))
    writeFileSync(target, buffer)
  }
}

const archive = resolve(process.argv[2] ?? process.env.DSH_ASAR ?? DEFAULT_ASAR)
if (!existsSync(archive)) {
  console.error('asar not found: ' + archive)
  console.error('Pass the app bundle path as the first argument, or set DSH_ASAR.')
  process.exit(1)
}

const { header, dataOffset } = readArchive(archive)
const fd = openSync(archive, 'r')
const versions = []
try {
  for (const name of PACKAGES) {
    const path = 'node_modules/@deepseek-ai/' + name
    const node = findEntry(header, path)
    if (node === undefined || node.files === undefined) {
      console.error('the archive does not contain ' + path)
      process.exit(1)
    }
    const target = join(VENDOR_TARGET, name)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    extractNode(fd, dataOffset, node, '', target)
    const manifest = findEntry(header, path + '/package.json')
    if (manifest !== undefined) {
      const text = Buffer.alloc(manifest.size)
      readSync(fd, text, 0, manifest.size, dataOffset + Number(manifest.offset))
      versions.push(name + '@' + JSON.parse(text.toString('utf8')).version)
    }
  }
} finally {
  closeSync(fd)
}

console.log('vendored ' + versions.join(', ') + ' from ' + archive)
console.log('into ' + VENDOR_TARGET)
console.log('now run: npm test, then reload the plugin (plugin_manager set_plugin).')