import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Retech Linear Timer',
  version: '0.7.0',
  // Chave pública que FIXA o ID da extensão (knbbiaoppepegcmdplehglahbdkghclh)
  // em qualquer instalação load-unpacked — o host manifest do native messaging
  // (agente de câmera) autoriza esse ID em allowed_origins. A chave privada
  // (retech-timer.pem) fica fora do git; só é necessária para um futuro upload
  // na Web Store com o mesmo ID.
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmBIVThWqncfQvRuU96wYjtXELrqrbBrJU8fVziwo92TYVmyDbhZ4uDp5jI+UY3m4OxxQjEH4eIttVed5SEYT+Qt8p2t0VdA2Loj6zYWFsJ/uCpNCkME7M9he8Qfse6jgxhzkwdQ6LlRI6X2QTbX5iJVTUh2WxbJ+RqhjHMJe1Wt1FGGZs2bw8agtNqub2U6NmrqdbbDnCasjmZ2KENIJf/8QxlwrUzDUWZsX8sUt4Jcv8FuQt3dfEvTKP64O3iRBaanXpBnR2LPU/9hCT825odWXjs2b8a/9DuDGd06yqKwyWKsBnZvsLRsA92j0ts4Ee58p9ObWx+AAhJaYikGNfQIDAQAB',
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
  permissions: ['storage', 'alarms', 'notifications', 'idle', 'tabs', 'offscreen', 'nativeMessaging'],
  host_permissions: ['https://api.linear.app/*'],
  optional_host_permissions: ['https://*/*', 'http://*/*']
})
