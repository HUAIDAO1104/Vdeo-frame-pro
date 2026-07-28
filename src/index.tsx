import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import appHtml from '../public/app.html?raw'

const app = new Hono()

const WINDOWS_RELEASE_URL =
  'https://github.com/HUAIDAO1104/Vdeo-frame-pro/releases/download/desktop-v0.1.2/SalesKitStudio_0.1.2_x64-setup.exe'
const WINDOWS_RELEASE_VERSION = '0.1.2'
const WINDOWS_RELEASE_NAME = 'SalesKitStudio_0.1.2_x64-setup.exe'
const WINDOWS_RELEASE_SHA256 = 'c7b33c73f64a382fab20626521ce8f2d11c4152e057afd100262e6c465086c3f'

// 静态资源（统一放在 /static/ 下，由 Cloudflare Pages 直接服务）
app.use('/static/*', serveStatic({ root: './public' }))

app.get('/download/windows', async (c) => {
  const range = c.req.header('Range')
  const cache = caches.default
  const cacheKey = new Request(
    new URL(`/download/windows?version=${WINDOWS_RELEASE_VERSION}`, c.req.url).toString(),
  )

  if (!range) {
    const cached = await cache.match(cacheKey)
    if (cached) return cached
  }

  const upstream = await fetch(WINDOWS_RELEASE_URL, {
    headers: range ? { Range: range } : undefined,
    redirect: 'follow',
  })

  if (!upstream.ok && upstream.status !== 206) {
    return c.json(
      {
        error: '安装包镜像暂时不可用',
        status: upstream.status,
        directUrl: WINDOWS_RELEASE_URL,
      },
      502,
    )
  }

  const headers = new Headers()
  headers.set('Content-Type', 'application/vnd.microsoft.portable-executable')
  headers.set('Content-Disposition', `attachment; filename="${WINDOWS_RELEASE_NAME}"`)
  headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('X-App-Version', WINDOWS_RELEASE_VERSION)
  headers.set('X-Checksum-SHA256', WINDOWS_RELEASE_SHA256)

  for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }

  const response = new Response(upstream.body, {
    status: upstream.status,
    headers,
  })

  if (!range && upstream.status === 200) {
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
  }

  return response
})

app.get('/', (c) => {
  return c.html(appHtml)
})

export default app
