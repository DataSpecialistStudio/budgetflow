@echo off
setlocal enabledelayedexpansion
title BudgetFlow - Setup
mode con: cols=90 lines=50

REM ============================================================
REM  BUDGETFLOW SETUP
REM  Walks you through creating the four free accounts and
REM  configures everything automatically.
REM  Run this from inside the budgetflow folder.
REM ============================================================

set "SRC=%~dp0"
set "PATH=%PATH%;%APPDATA%\npm"

cls
echo.
echo  ============================================================================
echo   BUDGETFLOW  -  website setup
echo  ============================================================================
echo.
echo   This will guide you through:
echo     1. Creating your Supabase project (database + auth)
echo     2. Creating your Resend account (emails)
echo     3. Setting up the GitHub repo (code + reminder bot cron)
echo     4. Deploying to Cloudflare Pages (the website itself)
echo.
echo   All free. Takes about 20 minutes.
echo   Have a browser open alongside this window.
echo.
pause

REM ── CHECK NODE ───────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Downloading installer...
  start "" "https://nodejs.org"
  echo Install Node.js LTS, then run this file again.
  pause & exit /b 1
)
for /f "delims=" %%V in ('node --version') do echo   Node.js %%V found.

REM ── CHECK GIT ────────────────────────────────────────────────
where git >nul 2>&1
if errorlevel 1 (
  echo Git is required. Downloading installer...
  start "" "https://git-scm.com/download/win"
  echo Install Git, restart this window, then run this file again.
  pause & exit /b 1
)
echo   Git found.

echo.
echo  ============================================================================
echo   STEP 1 — SUPABASE  (database + login)
echo  ============================================================================
echo.
echo   1a. Opening supabase.com — sign up with Google.
echo   1b. Click "New project". Name it: budgetflow
echo       Pick any region. Set a strong database password (save it somewhere).
echo   1c. Wait ~2 minutes for it to load.
echo   1d. Go to Settings ^> API.
echo       Copy the "Project URL" and the "anon public" key.
echo.
start "" "https://supabase.com"
echo.
set /p SUPABASE_URL="   Paste your Project URL here: "
set /p SUPABASE_ANON="   Paste your anon public key here: "
set /p SUPABASE_SERVICE="   Paste your service_role key here (Settings > API > service_role): "
set /p ADMIN_EMAIL="   Your Gmail address (gets the admin panel): "

echo.
echo   1e. Go to your Supabase project: SQL Editor tab
echo       Open the file schema.sql from this folder, paste it all, and click Run.
echo       You should see "Success. No rows returned".
echo.
start "" "%SUPABASE_URL%/project/default/sql"
echo.
echo   Press any key when the schema is done...
pause

REM ── STEP 2: RESEND ───────────────────────────────────────────
echo.
echo  ============================================================================
echo   STEP 2 — RESEND  (sends the reminder emails)
echo  ============================================================================
echo.
echo   2a. Opening resend.com — sign up.
echo   2b. Click "Add Domain" OR use the free sandbox (easiest to start).
echo       For the sandbox you don't need a domain — emails go to your own address.
echo   2c. Go to API Keys ^> Create API Key.
echo.
start "" "https://resend.com"
echo.
set /p RESEND_KEY="   Paste your Resend API key here: "
set /p FROM_EMAIL="   From email (use onboarding@resend.dev for sandbox): "

REM ── STEP 3: GITHUB ───────────────────────────────────────────
echo.
echo  ============================================================================
echo   STEP 3 — GITHUB  (stores code + runs daily reminder cron)
echo  ============================================================================
echo.
echo   3a. Opening github.com — sign up or log in.
echo   3b. Create a NEW repository called: budgetflow
echo       Set it to PRIVATE (your budget code stays private).
echo   3c. After creating, copy the HTTPS clone URL.
echo       It looks like: https://github.com/YOURNAME/budgetflow.git
echo.
start "" "https://github.com/new"
echo.
set /p GITHUB_REPO="   Paste the HTTPS URL of your new repo: "
set /p GITHUB_USERNAME="   Your GitHub username: "
set /p SITE_URL="   Your planned Cloudflare URL (guess for now, e.g. https://budgetflow-XYZ.pages.dev): "

REM ── WRITE CONFIG ─────────────────────────────────────────────
echo.
echo   Writing your config into js/config.js...
powershell -Command "(Get-Content '%SRC%js\config.js') -replace 'REPLACE_SUPABASE_URL','!SUPABASE_URL!' -replace 'REPLACE_SUPABASE_ANON_KEY','!SUPABASE_ANON!' -replace 'REPLACE_ADMIN_EMAIL','!ADMIN_EMAIL!' | Set-Content '%SRC%js\config.js'"
echo   Done.

REM ── INIT GIT AND PUSH ────────────────────────────────────────
echo.
echo   Initialising git and pushing to GitHub...
cd /d "%SRC%"
if not exist ".git" git init -b main
git add -A
git commit -m "Initial BudgetFlow setup" --allow-empty
git remote remove origin 2>nul
git remote add origin "!GITHUB_REPO!"
git push -u origin main
if errorlevel 1 (
  echo   Push failed. You may need to authenticate with GitHub.
  echo   Run: git push -u origin main
  echo   Then continue with step 4.
)
echo   Code pushed to GitHub.

REM ── GITHUB SECRETS ───────────────────────────────────────────
echo.
echo  ============================================================================
echo   STEP 3b — GITHUB SECRETS  (for the reminder bot)
echo  ============================================================================
echo.
echo   The reminder bot needs these secrets. Opening GitHub Secrets page...
echo   Add each one: Settings ^> Secrets and variables ^> Actions ^> New repository secret
echo.
echo   Secret name              Value
echo   ─────────────────────    ─────────────────────────────────
echo   SUPABASE_URL             !SUPABASE_URL!
echo   SUPABASE_SERVICE_KEY     !SUPABASE_SERVICE!
echo   RESEND_API_KEY           !RESEND_KEY!
echo   FROM_EMAIL               !FROM_EMAIL!
echo   SITE_URL                 !SITE_URL!
echo.
start "" "https://github.com/!GITHUB_USERNAME!/budgetflow/settings/secrets/actions"
echo.
echo   Press any key when all 5 secrets are saved...
pause

REM ── STEP 4: CLOUDFLARE ───────────────────────────────────────
echo.
echo  ============================================================================
echo   STEP 4 — CLOUDFLARE PAGES  (hosts your website for free)
echo  ============================================================================
echo.
echo   4a. Opening cloudflare.com — sign up.
echo   4b. Go to Workers ^& Pages ^> Pages ^> Connect to Git.
echo   4c. Connect your GitHub account and pick the budgetflow repo.
echo   4d. Build settings:
echo       - Framework preset: None
echo       - Build command:    (leave blank)
echo       - Build output dir: /
echo   4e. Click Deploy. It takes about 60 seconds.
echo   4f. Copy the .pages.dev URL and update the SITE_URL secret in GitHub.
echo.
start "" "https://dash.cloudflare.com"
echo.
echo   Press any key when your site is live...
pause

echo.
echo  ============================================================================
echo   STEP 5 — ENABLE GOOGLE LOGIN  (optional but recommended)
echo  ============================================================================
echo.
echo   5a. Go to your Supabase project: Authentication ^> Providers ^> Google
echo   5b. Enable it. You need a Google Cloud OAuth client:
echo       console.cloud.google.com ^> Credentials ^> Create Credentials ^> OAuth client ID
echo       Application type: Web application
echo       Authorised redirect: !SUPABASE_URL!/auth/v1/callback
echo   5c. Paste the Client ID and Secret into Supabase.
echo.
echo   Skip this for now — email+password login works without it.
echo.
pause

REM ── TEST REMINDER BOT ────────────────────────────────────────
echo.
echo  ============================================================================
echo   STEP 6 — TEST THE REMINDER BOT
echo  ============================================================================
echo.
echo   6a. Go to your GitHub repo: Actions tab
echo   6b. Click "Budget Reminder Bot" ^> "Run workflow" ^> "Run workflow"
echo   6c. Watch it run — should take about 30 seconds
echo   6d. Check your inbox for any errors in the Actions log
echo.
start "" "https://github.com/!GITHUB_USERNAME!/budgetflow/actions"
echo.
pause

cls
echo.
echo  ============================================================================
echo   SETUP COMPLETE
echo  ============================================================================
echo.
echo   Your BudgetFlow website:  !SITE_URL!
echo.
echo   Sign up at the site, complete the budget setup,
echo   and the reminder bot will email + WhatsApp you on payday.
echo.
echo   ─────────────────────────────────────────────────────────
echo   TO UPDATE THE SITE LATER:
echo     Edit any file in this folder, then run:
echo       git add -A ^&^& git commit -m "update" ^&^& git push
echo     Cloudflare rebuilds and deploys automatically.
echo   ─────────────────────────────────────────────────────────
echo.
echo   Admin panel (only your email can access it):
echo   !SITE_URL!/admin.html
echo.
pause
endlocal
