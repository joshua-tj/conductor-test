import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(() => {
  const conductorPort = Number(process.env.CONDUCTOR_PORT)
  const webPort = Number.isFinite(conductorPort) && conductorPort > 0 ? conductorPort : 5173
  const apiPort = Number(process.env.PORT ?? (Number.isFinite(conductorPort) && conductorPort > 0 ? conductorPort + 1 : 8787))
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: webPort,
      proxy: { '/api': `http://localhost:${apiPort}` },
    },
  }
})
