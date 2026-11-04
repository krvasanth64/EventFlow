# Run in an elevated PowerShell on the EventFlow host PC.
# Restricts inbound HTTP access to the trusted local subnet on Private networks.
$ErrorActionPreference = "Stop"
$ruleName = "EventFlow TCP 8765 - Private LAN"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8765 -Profile Private -RemoteAddress LocalSubnet | Out-Null
  Write-Host "Created Private LAN firewall rule for port 8765, LocalSubnet only."
} else {
  Write-Host "EventFlow firewall rule already exists. Inspect its settings:"
  Get-NetFirewallRule -DisplayName $ruleName | Get-NetFirewallPortFilter
  Get-NetFirewallRule -DisplayName $ruleName | Get-NetFirewallAddressFilter
}
Write-Host "EventFlow should be restarted with HOST=0.0.0.0; verify using Get-NetTCPConnection."
