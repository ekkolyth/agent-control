import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  zip: { artifactTemplate: 'Agent-Control-Extension-{{version}}.zip' },
  manifest: {
    name: 'Agent Control',
    permissions: [
      'debugger',
      'tabs',
      'storage',
      'scripting',
      'alarms',
      'webNavigation',
    ],
    host_permissions: ['<all_urls>'],
  },
})
