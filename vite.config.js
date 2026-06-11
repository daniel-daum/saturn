const { existsSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = {
  appType: 'mpa',
  plugins: [
    {
      name: 'directory-index',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = (req.url ?? '/').split('?')[0]
          if (!url.endsWith('/') && !url.includes('.')) {
            const indexPath = resolve(__dirname, url.slice(1), 'index.html')
            if (existsSync(indexPath)) {
              req.url = url + '/index.html'
            }
          }
          next()
        })
      }
    }
  ]
}
