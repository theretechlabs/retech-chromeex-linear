# Roadmap — Retech Linear Timer

> Atualizado em 2026-07-14 (v0.3.1). Este doc é o plano vivo do projeto; o README aponta pra cá.

## ✅ Entregue

- **v0.1** — Timer manual com widget no `linear.app`, comentário `init_task`/`-end_task` na issue, badge, lembrete (notificação + webhook n8n/WhatsApp).
- **v0.2** — Play/pause automático por presença: inatividade (`chrome.idle`), aba da issue, agente de câmera com prova de vida por piscada (anti-spoofing com re-arm).
- **v0.3** — Reconhecimento facial (YuNet+SFace, embedding local): só o rosto cadastrado mantém o timer; play/resume manual com verificação; voz nos eventos (pause/resume/não reconhecido); **agente auto-gerenciado via native messaging** (Chrome liga/desliga o processo; câmera acesa só com timer rodando); instalador de um comando (macOS/Linux/Windows); popup com status/instalação guiada/teste.
- **v0.3.1** — Sem foto cadastrada o play é bloqueado ("Cadastre seu rosto") — não cadastrar não é mais bypass da verificação.

## 🔜 v0.4 — melhorias internas

- [ ] **OAuth do Linear** no lugar da API key manual ("Sign in with Linear") — também é pré-requisito da trilha de produto abaixo.
- [ ] Relatório semanal: script agrega os comentários `init_task`/`-end_task` via API.
- [ ] Dashboard de horas por dev/projeto.
- [ ] Launcher `.exe` no Windows (elimina o flash de console do shim `.bat`).
- [ ] Teste real do instalador no Windows (única perna sem validação em máquina de verdade).

## 🚀 Trilha produto — Linear Integration Directory

Objetivo: transformar a extensão em produto público listado no [Integration Directory do Linear](https://linear.app/integrations) (~250 integrações).

**Fatos levantados (2026-07-14):**

- O Linear **não tem sistema de plugins de UI** — nada roda "dentro" do app deles. Nosso widget via content script já é o máximo possível nessa direção.
- O que existe é o directory: vitrine de apps externos integrados via API/OAuth. Submissão por formulário + assets para `integrations@linear.app` ([guia](https://linear.app/developers/integration-directory)).
- Requisitos deles: app **útil à comunidade**, construído por **empresa formal** (recusam explicitamente scripts e apps de hobby), **OAuth** recomendado como padrão, workspace separado para o app.
- O directory só **linka** — a distribuição da extensão em si é a **Chrome Web Store** (listagem pública; a unlisted não serve pra isso).

**Passos, em ordem:**

1. [ ] **OAuth do Linear** (v0.4) — "Sign in with Linear", workspace dedicado do app.
2. [ ] **Generalizar o registro de tempo** — o formato `init_task`/`-end_task` é contrato interno da extração da Retech; produto público precisa de formato configurável ou padrão próprio (mantendo o modo Retech por config).
3. [ ] **Publicar na Chrome Web Store** (pública) — single purpose "time tracking em issues do Linear", justificar permissões (`nativeMessaging`/câmera é o ponto sensível do review: deixar o reconhecimento facial 100% opt-in e bem explicado na listing).
4. [ ] **Landing/página do produto** — o formulário do directory pede página no padrão de copy deles.
5. [ ] **Submeter ao directory** — formulário + assets para `integrations@linear.app`.

**Riscos/atritos conhecidos:**

- Reconhecimento facial com agente local é incomum pra produto público — review da Web Store e do Linear podem estranhar; mitigar com opt-in claro e privacidade documentada (nada sai da máquina, embedding irreversível, câmera só com timer).
- Manter dois modos de comentário (Retech interno vs. público) sem quebrar o parser da extração.
- Suporte: produto público implica issues de terceiros (Python/webcam/SO variados).

## 💡 Ideias sem prioridade

- Enroll multi-foto (média de embeddings — mais robusto a óculos/luz).
- Detecção de múltiplos monitores/câmeras (escolher câmera no popup).
- Autostart opcional do agente (LaunchAgent/systemd) para quem prefere câmera sempre pronta.
- Firefox (WebExtensions + native messaging têm equivalentes).
