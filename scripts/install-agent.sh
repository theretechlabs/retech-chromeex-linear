#!/usr/bin/env bash
# Instala o Retech Presence Agent como native messaging host (macOS/Linux).
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/theretechlabs/retech-chromeex-linear/main/scripts/install-agent.sh | bash
#   ./scripts/install-agent.sh              # a partir do clone do repo
#   ./scripts/install-agent.sh --uninstall
#
# O que faz: venv Python em ~/.local/share/retech-presence-agent, baixa os
# modelos (~42MB, 1x), registra o host com.retech.presence_agent nos browsers
# instalados. Depois disso o Chrome inicia/encerra o agente sozinho — câmera
# ligada só com timer ativo. Re-rodar o script atualiza a instalação.
set -euo pipefail

HOST_NAME="com.retech.presence_agent"
EXT_ID="knbbiaoppepegcmdplehglahbdkghclh"
BASE_URL="${RETECH_AGENT_BASE_URL:-https://raw.githubusercontent.com/theretechlabs/retech-chromeex-linear/main}"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/retech-presence-agent"
SHIM="$INSTALL_DIR/retech-presence-host"

case "$(uname -s)" in
  Darwin) OS=mac ;;
  Linux) OS=linux ;;
  *) echo "✗ SO não suportado por este script — no Windows use install-agent.ps1" >&2; exit 1 ;;
esac

browser_dirs() {
  if [ "$OS" = mac ]; then
    local base="$HOME/Library/Application Support"
    printf '%s\n' \
      "$base/Google/Chrome" \
      "$base/Chromium" \
      "$base/BraveSoftware/Brave-Browser" \
      "$base/Microsoft Edge"
  else
    printf '%s\n' \
      "$HOME/.config/google-chrome" \
      "$HOME/.config/chromium" \
      "$HOME/.config/BraveSoftware/Brave-Browser" \
      "$HOME/.config/microsoft-edge"
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  while IFS= read -r dir; do
    rm -f "$dir/NativeMessagingHosts/$HOST_NAME.json"
  done < <(browser_dirs)
  rm -rf "$INSTALL_DIR"
  echo "✓ Agente removido (o cadastro facial em ~/.cache/retech-presence-agent foi mantido;"
  echo "  apague aquela pasta também se quiser remover tudo)"
  exit 0
fi

# --- 1. Python >= 3.10 -------------------------------------------------------
PYTHON=""
for cand in python3 python3.13 python3.12 python3.11 python3.10; do
  if command -v "$cand" >/dev/null 2>&1 &&
     "$cand" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PYTHON="$(command -v "$cand")"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "✗ Python 3.10+ não encontrado." >&2
  if [ "$OS" = mac ]; then
    echo "  Instale com: xcode-select --install  (ou: brew install python3)" >&2
  else
    echo "  Debian/Ubuntu: sudo apt install python3 python3-venv" >&2
    echo "  Fedora:        sudo dnf install python3" >&2
  fi
  exit 1
fi
echo "• Python: $PYTHON"

# --- 2. Arquivos do agente (copia do clone ou baixa do GitHub) ---------------
mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../agent/presence_agent.py" ]; then
  echo "• Copiando agente do clone local"
  cp "$SCRIPT_DIR/../agent/presence_agent.py" "$SCRIPT_DIR/../agent/requirements.txt" "$INSTALL_DIR/"
else
  echo "• Baixando agente de $BASE_URL"
  curl -fsSL "$BASE_URL/agent/presence_agent.py" -o "$INSTALL_DIR/presence_agent.py"
  curl -fsSL "$BASE_URL/agent/requirements.txt" -o "$INSTALL_DIR/requirements.txt"
fi

# --- 3. venv + dependências (idempotente; re-rodar = atualizar) --------------
echo "• Criando venv + instalando dependências (1-3 min na primeira vez)…"
"$PYTHON" -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/requirements.txt"

# --- 4. Modelos (~42MB, só na primeira vez) ----------------------------------
echo "• Baixando/validando modelos…"
"$INSTALL_DIR/venv/bin/python" "$INSTALL_DIR/presence_agent.py" --download-models

# --- 5. Shim que o Chrome executa --------------------------------------------
cat > "$SHIM" <<EOF
#!/bin/sh
# Native messaging host do Retech Presence Agent (gerado por install-agent.sh).
# O Chrome executa isto ao conectar; argumentos extras (ex.: --camera 1) podem
# ser adicionados antes de "\$@".
exec "$INSTALL_DIR/venv/bin/python" "$INSTALL_DIR/presence_agent.py" --native "\$@"
EOF
chmod 755 "$SHIM"

# --- 6. Host manifest nos browsers instalados --------------------------------
INSTALLED_IN=""
while IFS= read -r dir; do
  [ -d "$dir" ] || continue
  mkdir -p "$dir/NativeMessagingHosts"
  cat > "$dir/NativeMessagingHosts/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Retech Presence Agent — presença por câmera para o Retech Linear Timer",
  "path": "$SHIM",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  INSTALLED_IN="$INSTALLED_IN\n  - $dir"
done < <(browser_dirs)
if [ -z "$INSTALLED_IN" ]; then
  echo "✗ Nenhum browser Chromium encontrado (Chrome/Chromium/Brave/Edge)." >&2
  exit 1
fi

# --- 7. Smoke test: fala o protocolo com o shim ------------------------------
echo "• Testando o host (a câmera pode acender por alguns segundos)…"
if "$INSTALL_DIR/venv/bin/python" - "$SHIM" <<'PY'
import json, struct, subprocess, sys, time
shim = sys.argv[1]
p = subprocess.Popen([shim, "chrome-extension://install-test/"],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL)
msg = json.dumps({"type": "get_enrollment", "id": "install-test"}).encode()
p.stdin.write(struct.pack("=I", len(msg)) + msg)
p.stdin.flush()
ok = False
deadline = time.time() + 45
try:
    while time.time() < deadline:
        header = p.stdout.read(4)
        if len(header) < 4:
            break
        (n,) = struct.unpack("=I", header)
        reply = json.loads(p.stdout.read(n))
        if reply.get("id") == "install-test":
            ok = reply.get("type") == "enrollment"
            break
finally:
    p.stdin.close()
    p.wait(timeout=10)
sys.exit(0 if ok else 1)
PY
then
  echo "✓ Host respondeu ao protocolo"
else
  echo "✗ Host não respondeu — veja se o Python do venv funciona:" >&2
  echo "  $INSTALL_DIR/venv/bin/python $INSTALL_DIR/presence_agent.py --download-models" >&2
  exit 1
fi

printf '✓ Instalado em %s para:%b\n' "$INSTALL_DIR" "$INSTALLED_IN"
echo
echo "Próximos passos:"
echo "  1. Reinicie o Chrome (o host manifest é lido na inicialização)"
echo "  2. Popup da extensão → marque \"Usar agente de câmera\" → Salvar"
echo "  3. Popup → \"Testar conexão\""
