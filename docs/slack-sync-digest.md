# Slack Sync with Digest

The tix-kanban application automatically runs `slx digest` after every successful slack sync operation. This ensures that whenever new Slack messages are synced, a digest is automatically generated.

## How It Works

### 1. Automatic Cron Job Sync
When slack sync is enabled via the cron job scheduler:
- The sync runs according to the configured interval (default: every hour)
- After successful sync, `slx digest` is automatically executed
- Both sync and digest results are logged

Location: `src/server/worker.ts` (lines 1110-1117)

### 2. Manual Sync
When triggering a manual sync via the UI or API:
- POST request to `/api/slx/sync` triggers the sync
- After successful sync, `slx digest` is automatically executed
- The digest is available in the Slack view under the "Digest" tab

Location: `src/server/index.ts` (lines 2625-2631)

## Configuration

### Enable Automatic Sync
1. Go to Settings page
2. Find "Slack Sync (slx)" section
3. Toggle "Enable Slack Sync" to ON
4. Set desired interval (cron expression)
5. Click "Save slx Config"

### Manual Sync
1. Go to Slack page
2. Click "Sync Now" button
3. The sync and digest will run automatically

## Viewing the Digest

After sync completes:
1. Go to Slack page
2. Click on "Digest" tab
3. View the AI-generated digest of your Slack activity

## Troubleshooting

If digest is not appearing after sync:
1. Check server logs for any `slx digest` errors
2. Ensure `slx` CLI tool is installed and configured
3. Verify Claude API access is configured in slx
4. Check that the sync completed successfully before digest runs