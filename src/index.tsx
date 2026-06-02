import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import appHtml from '../public/app.html?raw'

const app = new Hono()

// 静态资源（统一放在 /static/ 下，由 Cloudflare Pages 直接服务）
app.use('/static/*', serveStatic({ root: './public' }))

app.get('/', (c) => {
  return c.html(appHtml)
})

export default app
