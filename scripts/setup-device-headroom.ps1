param(
  [switch]$PersistStartup
)

# ==============================================================================
# AXION / SYSTEM-WIDE HEADROOM AGENT SETUP SCRIPT
# ==============================================================================
# Configures Headroom proxy routing and MCP server integrations across all
# AI agents (Claude Code, Cursor, Codex, Copilot, Aider, Antigravity, etc.)
# ==============================================================================

Write-Host "`n⚡ Configuring Headroom on this device for all AI agents..." -ForegroundColor Cyan

# 1. Set User Environment Variables (Persistent across all user shells)
[System.Environment]::SetEnvironmentVariable('OPENAI_BASE_URL', 'http://127.0.0.1:8787/v1', 'User')
[System.Environment]::SetEnvironmentVariable('ANTHROPIC_BASE_URL', 'http://127.0.0.1:8787', 'User')

Write-Host '  ✓ OPENAI_BASE_URL    -> http://127.0.0.1:8787/v1 [User Environment]' -ForegroundColor Green
Write-Host '  ✓ ANTHROPIC_BASE_URL -> http://127.0.0.1:8787    [User Environment]' -ForegroundColor Green

# 2. Register Headroom MCP into detected coding agents
Write-Host "`n⚡ Registering Headroom MCP server..." -ForegroundColor Cyan
headroom mcp install

# 3. Optional: Windows Startup Persistence
if ($PersistStartup) {
  $startupDir = [Environment]::GetFolderPath('Startup')
  $batPath = Join-Path $startupDir 'axion-headroom-proxy.bat'
  $batContent = "@echo off`r`nstart /B headroom proxy --port 8787`r`n"
  [System.IO.File]::WriteAllText($batPath, $batContent)
  Write-Host "  ✓ Registered Windows Startup persistence: $batPath" -ForegroundColor Green
}

# 4. Check health and proxy status
Write-Host "`n⚡ Running Headroom Doctor..." -ForegroundColor Cyan
headroom doctor

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " Headroom is ready! Dashboard: http://127.0.0.1:8787/dashboard" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green
