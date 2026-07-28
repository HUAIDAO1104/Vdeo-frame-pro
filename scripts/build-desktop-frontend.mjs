import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'public')
const output = resolve(root, 'desktop-dist')

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

const html = await readFile(resolve(source, 'app.html'), 'utf8')
await writeFile(resolve(output, 'index.html'), html)

for (const entry of ['static', 'badge_4k.png', 'favicon.ico']) {
  await cp(resolve(source, entry), resolve(output, entry), {
    recursive: true,
    force: true,
  })
}

console.log(`Desktop frontend built at ${output}`)
