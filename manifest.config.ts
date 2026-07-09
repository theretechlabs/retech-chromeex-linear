import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Retech Linear Timer',
  version: '0.1.0',
  description:
    'Play/pause de time tracking em issues do Linear, com registro automático de atividade no ticket e lembrete de pausa.',
  icons: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png'
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Retech Linear Timer'
  },
  background: {
    service_worker: 'src/background.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: ['https://linear.app/*'],
      js: ['src/content.ts'],
      run_at: 'document_idle'
    }
  ],
  permissions: ['storage', 'alarms', 'notifications'],
  host_permissions: ['https://api.linear.app/*'],
  optional_host_permissions: ['https://*/*', 'http://*/*']
})
