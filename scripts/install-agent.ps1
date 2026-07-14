# Instala o Retech Presence Agent como native messaging host (Windows).
#
# Uso:
#   iwr -useb https://raw.githubusercontent.com/theretechlabs/retech-chromeex-linear/main/scripts/install-agent.ps1 | iex
#   .\scripts\install-agent.ps1              # a partir do clone do repo
#   .\scripts\install-agent.ps1 -Uninstall
#
# O que faz: venv Python em %LOCALAPPDATA%\retech-presence-agent, baixa os
# modelos (~42MB, 1x), registra o host com.retech.presence_agent no registro
# (HKCU) para Chrome e Edge. Re-rodar o script atualiza a instalação.
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$HostName = 'com.retech.presence_agent'
$ExtId = 'knbbiaoppepegcmdplehglahbdkghclh'
$BaseUrl = if ($env:RETECH_AGENT_BASE_URL) { $env:RETECH_AGENT_BASE_URL }
           else { 'https://raw.githubusercontent.com/theretechlabs/retech-chromeex-linear/main' }
$InstallDir = Join-Path $env:LOCALAPPDATA 'retech-presence-agent'
$Shim = Join-Path $InstallDir 'retech-presence-host.bat'
$ManifestPath = Join-Path $InstallDir "$HostName.json"
# Brave e Chromium leem a chave do Chrome; Edge tem a própria.
$RegKeys = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
)

if ($Uninstall) {
  foreach ($key in $RegKeys) {
    if (Test-Path $key) { Remove-Item $key -Force }
  }
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  Write-Host '✓ Agente removido (o cadastro facial em %USERPROFILE%\.cache\retech-presence-agent foi mantido)'
  exit 0
}

# --- 1. Python >= 3.10 -------------------------------------------------------
$Python = $null
foreach ($cand in @(@('py', '-3'), @('python3'), @('python'))) {
  try {
    $v = & $cand[0] $cand[1..($cand.Length)] -c 'import sys; print("%d.%d" % sys.version_info[:2]); raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>$null
    if ($LASTEXITCODE -eq 0) { $Python = $cand; break }
  } catch { }
}
if (-not $Python) {
  Write-Error "Python 3.10+ não encontrado. Instale com: winget install Python.Python.3.12 (ou python.org) e rode de novo."
}
Write-Host "• Python: $($Python -join ' ')"

# --- 2. Arquivos do agente ---------------------------------------------------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$LocalAgent = Join-Path $PSScriptRoot '..\agent\presence_agent.py'
if ($PSScriptRoot -and (Test-Path $LocalAgent)) {
  Write-Host '• Copiando agente do clone local'
  Copy-Item $LocalAgent (Join-Path $InstallDir 'presence_agent.py') -Force
  Copy-Item (Join-Path $PSScriptRoot '..\agent\requirements.txt') (Join-Path $InstallDir 'requirements.txt') -Force
} else {
  Write-Host "• Baixando agente de $BaseUrl"
  Invoke-WebRequest -UseBasicParsing "$BaseUrl/agent/presence_agent.py" -OutFile (Join-Path $InstallDir 'presence_agent.py')
  Invoke-WebRequest -UseBasicParsing "$BaseUrl/agent/requirements.txt" -OutFile (Join-Path $InstallDir 'requirements.txt')
}

# --- 3. venv + dependências --------------------------------------------------
Write-Host '• Criando venv + instalando dependências (1-3 min na primeira vez)…'
& $Python[0] $Python[1..($Python.Length)] -m venv (Join-Path $InstallDir 'venv')
$VenvPython = Join-Path $InstallDir 'venv\Scripts\python.exe'
& $VenvPython -m pip install -q --upgrade pip
& $VenvPython -m pip install -q -r (Join-Path $InstallDir 'requirements.txt')

# --- 4. Modelos --------------------------------------------------------------
Write-Host '• Baixando/validando modelos…'
& $VenvPython (Join-Path $InstallDir 'presence_agent.py') --download-models
if ($LASTEXITCODE -ne 0) { Write-Error 'Falha ao baixar os modelos' }

# --- 5. Shim .bat (Chrome só executa .exe/.bat como host; python.exe, nunca
#        pythonw.exe — stdio destacado quebra o native messaging) -------------
@"
@echo off
"$VenvPython" "$(Join-Path $InstallDir 'presence_agent.py')" --native %*
"@ | Set-Content -Path $Shim -Encoding ASCII

# --- 6. Host manifest + registro ---------------------------------------------
@"
{
  "name": "$HostName",
  "description": "Retech Presence Agent — presença por câmera para o Retech Linear Timer",
  "path": "$($Shim -replace '\\', '\\\\')",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ExtId/"]
}
"@ | Set-Content -Path $ManifestPath -Encoding UTF8

foreach ($key in $RegKeys) {
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $ManifestPath
}

# --- 7. Smoke test -----------------------------------------------------------
Write-Host '• Testando o host (a câmera pode acender por alguns segundos)…'
$Test = @'
import json, struct, subprocess, sys, time
shim = sys.argv[1]
p = subprocess.Popen([shim, "chrome-extension://install-test/"],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL, shell=False)
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
'@
$TestFile = Join-Path $InstallDir 'smoke_test.py'
$Test | Set-Content -Path $TestFile -Encoding UTF8
& $VenvPython $TestFile $Shim
if ($LASTEXITCODE -ne 0) { Write-Error 'Host não respondeu ao protocolo' }
Remove-Item $TestFile -Force

Write-Host "✓ Instalado em $InstallDir (Chrome e Edge via HKCU)"
Write-Host ''
Write-Host 'Próximos passos:'
Write-Host '  1. Reinicie o Chrome (o registro é lido na inicialização)'
Write-Host '  2. Popup da extensão → marque "Usar agente de câmera" → Salvar'
Write-Host '  3. Popup → "Testar conexão"'
