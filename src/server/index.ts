import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { apiRouter } from './routes/api.js'
import { cronSystem } from '../cron/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 3000

// Middleware
app.use(express.json())
app.use(express.static(path.join(__dirname, '../../public')))

// API routes
app.use('/api', apiRouter)

// Serve React SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'))
})

// Start cron system
cronSystem.start()

app.listen(port, () => {
  console.log(`🦊 tix-kanban server running on http://localhost:${port}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...')
  cronSystem.stop()
  process.exit(0)
})