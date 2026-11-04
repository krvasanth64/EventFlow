# Run on the EventFlow Windows host (PowerShell).
Write-Host "EventFlow host diagnosis"
Write-Host "1. Network profiles"
Get-NetConnectionProfile | Format-Table InterfaceAlias,NetworkCategory,IPv4Connectivity -AutoSize
Write-Host "2. IPv4 address"
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^127\.' } | Format-Table InterfaceAlias,IPAddress,PrefixLength -AutoSize
Write-Host "3. Listener"
Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Format-Table LocalAddress,LocalPort,OwningProcess -AutoSize
Write-Host "4. Local HTTP health"
try { (Invoke-RestMethod 'http://127.0.0.1:8765/api/health') | ConvertTo-Json } catch { Write-Host $_.Exception.Message }
Write-Host "5. Tailscale Serve"
tailscale serve status
Write-Host "If the listener is 127.0.0.1 rather than 0.0.0.0, restart using the updated start-eventflow.bat."
Write-Host "On another LAN PC, use Test-NetConnection HOST-LAN-IP -Port 8765 (replace HOST-LAN-IP)."
