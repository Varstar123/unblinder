import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamped into the bundle at build time and printed to the on-screen log on boot.
// Without it there is no way to tell, from a phone, whether you are looking at the
// build you just deployed or a cached one — and "my fix isn't working" and "my fix
// isn't there" look exactly the same from the outside.
const BUILD_ID = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
})
