; tyne.pro Ферма роликів — хуки установника NSIS.
; Після встановлення застосунку ставимо Python (потрібен рушію озвучки Piper),
; якщо його ще немає. Через winget, тихо, у профіль користувача (без прав адміністратора).
; Якщо winget недоступний або встановлення не вдалось — застосунок усе одно працює,
; просто озвучка потребуватиме ручного встановлення Python. Тому помилку не піднімаємо.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Перевіряю Python для озвучки…"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "try { if (-not (Get-Command python -ErrorAction SilentlyContinue)) { winget install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements --scope user --disable-interactivity } } catch {}"'
  Pop $0
!macroend
