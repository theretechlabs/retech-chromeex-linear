import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Retech Linear Timer',
  version: '0.2.0',
  description:
    'Time tracking em issues do Linear com play/pause automático por presença (idle + câmera), registro de atividade no ticket e lembrete de pausa.',
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
  permissions: ['storage', 'alarms', 'notifications', 'idle', 'tabs', 'offscreen'],
  host_permissions: ['https://api.linear.app/*'],
  optional_host_permissions: ['https://*/*', 'http://*/*']
})
