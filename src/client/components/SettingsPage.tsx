import { useState, useEffect } from 'react';

interface UserSettings {
  userName: string;
  workspaceDir?: string;
  repoPaths?: Record<string, string>;
  githubUsername?: string;
  prResolver?: {
    enabled: boolean;
    frequency: string;
    lastRun?: string;
  };
}

interface StandupConfig {
  enabled: boolean;
  time: string; // HH:MM format
}

interface SlxSyncConfig {
  enabled: boolean;
  interval: string; // cron expression
  lastRun?: string;
}

interface ReminderCheckConfig {
  enabled: boolean;
  interval: string; // cron expression
  lastRun?: string;
}

interface ConcurrencyConfig {
  maxConcurrentPersonas: number;
  allowDuplicatePersonas: boolean;
}

interface SettingsPageProps {
  onSettingsChange?: (settings: UserSettings) => void;
}

export function SettingsPage({ onSettingsChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<UserSettings>({ userName: 'User', workspaceDir: '', repoPaths: {} });
  const [standupConfig, setStandupConfig] = useState<StandupConfig>({ enabled: false, time: '09:00' });
  const [prResolverStatus, setPRResolverStatus] = useState<{
    enabled: boolean;
    frequency: string;
    lastRun?: string;
    isRunning?: boolean;
  }>({ enabled: false, frequency: '0 */6 * * *' });
  const [newRepoKey, setNewRepoKey] = useState('');
  const [newRepoPath, setNewRepoPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [standupSaving, setStandupSaving] = useState(false);
  const [standupSaved, setStandupSaved] = useState(false);
  const [slxSyncConfig, setSlxSyncConfig] = useState<SlxSyncConfig>({ enabled: false, interval: '0 */1 * * *' });
  const [slxSaving, setSlxSaving] = useState(false);
  const [slxSaved, setSlxSaved] = useState(false);
  const [reminderCheckConfig, setReminderCheckConfig] = useState<ReminderCheckConfig>({ enabled: false, interval: '0 9 * * 1-5' });
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderSaved, setReminderSaved] = useState(false);
  const [prSaving, setPRSaving] = useState(false);
  const [prSaved, setPRSaved] = useState(false);
  const [concurrencyConfig, setConcurrencyConfig] = useState<ConcurrencyConfig>({ maxConcurrentPersonas: 1, allowDuplicatePersonas: false });
  const [concurrencySaving, setConcurrencySaving] = useState(false);
  const [concurrencySaved, setConcurrencySaved] = useState(false);
  const [concurrencyError, setConcurrencyError] = useState<string | null>(null);

  // Provider state
  const [providerConfig, setProviderConfig] = useState<{ ticketProvider: string; messageProvider: string }>({ ticketProvider: 'tix', messageProvider: 'slx' });
  const [availableProviders, setAvailableProviders] = useState<{ tickets: string[]; messages: string[] }>({ tickets: [], messages: [] });
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerSaved, setProviderSaved] = useState(false);
  const [providerSyncing, setProviderSyncing] = useState(false);
  const [providerSyncResult, setProviderSyncResult] = useState<string>('');

  // Backup state
  const [backupDir, setBackupDir] = useState('');
  const [backupDirSaving, setBackupDirSaving] = useState(false);
  const [backupDirSaved, setBackupDirSaved] = useState(false);
  const [backupDirError, setBackupDirError] = useState('');
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupTriggering, setBackupTriggering] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{ lastBackup?: string; nextBackup?: string } | null>(null);
  const [backupFiles, setBackupFiles] = useState<Array<{ name: string; path: string; size: number; createdAt: string; encrypted: boolean }>>([]);
  const [backupPassword, setBackupPassword] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [backupCategories, setBackupCategories] = useState<Record<string, boolean>>({});
  const [categoriesSaving, setCategoriesSaving] = useState(false);

  useEffect(() => {
    loadSettings();
    loadWorkerConfig();
    loadPRResolverStatus();
    loadBackupStatus();
    loadBackupCategories();
    loadProviders();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadWorkerConfig = async () => {
    try {
      const response = await fetch('/api/worker/status');
      if (response.ok) {
        const data = await response.json();
        const status = data.status || data;

        // Parse standup config
        let time = '09:00';
        if (status.standupTime) {
          const parts = status.standupTime.split(' ');
          if (parts.length >= 2) {
            const mins = parts[0].padStart(2, '0');
            const hrs = parts[1].padStart(2, '0');
            time = `${hrs}:${mins}`;
          }
        }
        setStandupConfig({
          enabled: status.standupEnabled ?? false,
          time,
        });

        // Parse slx sync config
        setSlxSyncConfig({
          enabled: status.slxSyncEnabled ?? false,
          interval: status.slxSyncInterval ?? '0 */1 * * *',
          lastRun: status.lastSlxSyncRun,
        });

        // Parse reminder check config
        setReminderCheckConfig({
          enabled: status.reminderCheckEnabled ?? false,
          interval: status.reminderCheckInterval ?? '0 9 * * 1-5',
          lastRun: status.lastReminderCheckRun,
        });

        // Parse concurrency config
        setConcurrencyConfig({
          maxConcurrentPersonas: status.maxConcurrentPersonas ?? 1,
          allowDuplicatePersonas: status.allowDuplicatePersonas ?? false,
        });
      }
    } catch (error) {
      console.error('Failed to load worker config:', error);
    }
  };

  const saveStandupConfig = async () => {
    setStandupSaving(true);
    setStandupSaved(false);
    try {
      // Toggle enabled state
      await fetch('/api/worker/standup/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: standupConfig.enabled }),
      });

      // Set time (convert HH:MM to cron expression)
      const [hours, minutes] = standupConfig.time.split(':');
      const cronExpr = `${minutes} ${hours} * * 1-5`; // Mon-Fri
      await fetch('/api/worker/standup/time', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronExpression: cronExpr }),
      });

      setStandupSaved(true);
      setTimeout(() => setStandupSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save standup config:', error);
    } finally {
      setStandupSaving(false);
    }
  };

  const triggerStandup = async () => {
    try {
      const response = await fetch('/api/worker/standup/trigger', { method: 'POST' });
      if (response.ok) {
        alert('Standup generated! Check the Standups page.');
      }
    } catch (error) {
      console.error('Failed to trigger standup:', error);
    }
  };

  const saveSlxSyncConfig = async () => {
    setSlxSaving(true);
    setSlxSaved(false);
    try {
      const toggleRes = await fetch('/api/worker/slx-sync/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: slxSyncConfig.enabled }),
      });
      if (!toggleRes.ok) throw new Error('Failed to toggle slx sync');

      const intervalRes = await fetch('/api/worker/slx-sync/interval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronExpression: slxSyncConfig.interval }),
      });
      if (!intervalRes.ok) throw new Error('Failed to update slx sync interval');

      setSlxSaved(true);
      setTimeout(() => setSlxSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save slx sync config:', error);
    } finally {
      setSlxSaving(false);
    }
  };

  const triggerSlxSync = async () => {
    try {
      const response = await fetch('/api/worker/slx-sync/trigger', { method: 'POST' });
      if (response.ok) {
        alert('Slack sync triggered! Check the Slack page for results.');
      } else {
        alert('Failed to trigger Slack sync. Check server logs.');
      }
    } catch (error) {
      console.error('Failed to trigger slx sync:', error);
      alert('Failed to trigger Slack sync. Is the server running?');
    }
  };

  const saveReminderCheckConfig = async () => {
    setReminderSaving(true);
    setReminderSaved(false);
    try {
      const toggleRes = await fetch('/api/worker/reminder-check/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: reminderCheckConfig.enabled }),
      });
      if (!toggleRes.ok) throw new Error('Failed to toggle reminder check');

      const intervalRes = await fetch('/api/worker/reminder-check/interval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: reminderCheckConfig.interval }),
      });
      if (!intervalRes.ok) throw new Error('Failed to update reminder check interval');

      setReminderSaved(true);
      setTimeout(() => setReminderSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save reminder check config:', error);
    } finally {
      setReminderSaving(false);
    }
  };

  const triggerReminderCheck = async () => {
    try {
      const response = await fetch('/api/worker/reminder-check/trigger', { method: 'POST' });
      if (response.ok) {
        alert('Reminder check triggered! Check console or Slack for results.');
      } else {
        alert('Failed to trigger reminder check. Check server logs.');
      }
    } catch (error) {
      console.error('Failed to trigger reminder check:', error);
      alert('Failed to trigger reminder check. Is the server running?');
    }
  };

  const saveConcurrencyConfig = async () => {
    setConcurrencySaving(true);
    setConcurrencySaved(false);
    setConcurrencyError(null);
    
    // Store original values for potential rollback
    const originalConfig = { ...concurrencyConfig };
    
    try {
      const maxRes = await fetch('/api/worker/max-concurrent-personas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max: concurrencyConfig.maxConcurrentPersonas }),
      });
      if (!maxRes.ok) throw new Error('Failed to update max concurrent personas');

      const dupRes = await fetch('/api/worker/allow-duplicate-personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow: concurrencyConfig.allowDuplicatePersonas }),
      });
      if (!dupRes.ok) throw new Error('Failed to update allow duplicate personas');

      setConcurrencySaved(true);
      setTimeout(() => setConcurrencySaved(false), 2000);
    } catch (error) {
      console.error('Failed to save concurrency config:', error);
      setConcurrencyError(error instanceof Error ? error.message : 'Failed to save concurrency settings');
      
      // Attempt rollback of first setting if second failed
      if (originalConfig.maxConcurrentPersonas !== concurrencyConfig.maxConcurrentPersonas) {
        try {
          await fetch('/api/worker/max-concurrent-personas', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ max: originalConfig.maxConcurrentPersonas }),
          });
        } catch (rollbackError) {
          console.error('Failed to rollback concurrency config:', rollbackError);
        }
      }
    } finally {
      setConcurrencySaving(false);
    }
  };

  const loadPRResolverStatus = async () => {
    try {
      const response = await fetch('/api/pr-resolver/status');
      if (response.ok) {
        const data = await response.json();
        setPRResolverStatus(data.status || data);
      }
    } catch (error) {
      console.error('Failed to load PR resolver status:', error);
    }
  };

  const savePRResolverConfig = async () => {
    setPRSaving(true);
    setPRSaved(false);
    try {
      // Toggle enabled state
      await fetch('/api/pr-resolver/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: prResolverStatus.enabled }),
      });

      // Update frequency
      await fetch('/api/pr-resolver/frequency', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency: prResolverStatus.frequency }),
      });

      setPRSaved(true);
      setTimeout(() => setPRSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save PR resolver config:', error);
    } finally {
      setPRSaving(false);
    }
  };

  const triggerPRResolver = async (dryRun: boolean) => {
    try {
      const response = await fetch('/api/pr-resolver/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      if (response.ok) {
        alert(dryRun ? 'PR resolver dry run started!' : 'PR resolver started! Check the Reports page for results.');
      }
    } catch (error) {
      console.error('Failed to trigger PR resolver:', error);
    }
  };

  const loadProviders = async () => {
    try {
      const res = await fetch('/api/providers');
      if (res.ok) {
        const data = await res.json();
        setAvailableProviders(data.available || { tickets: [], messages: [] });
        setProviderConfig({
          ticketProvider: data.config?.ticketProvider || 'tix',
          messageProvider: data.config?.messageProvider || 'slx',
        });
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  };

  const saveProviderConfig = async () => {
    setProviderSaving(true);
    setProviderSaved(false);
    try {
      const res = await fetch('/api/providers/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(providerConfig),
      });
      if (res.ok) {
        setProviderSaved(true);
        setTimeout(() => setProviderSaved(false), 2000);
      } else {
        const data = await res.json();
        alert(`Failed to save: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to save provider config:', error);
    } finally {
      setProviderSaving(false);
    }
  };

  const triggerProviderSync = async () => {
    setProviderSyncing(true);
    setProviderSyncResult('');
    try {
      const res = await fetch('/api/providers/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        const parts = [];
        if (data.results?.tickets) parts.push(`Tickets: ${data.results.tickets.count} from ${data.results.tickets.provider}`);
        if (data.results?.messages) parts.push(`Messages: ${data.results.messages.count} from ${data.results.messages.provider}`);
        setProviderSyncResult(parts.join(' · ') || 'Sync complete');
      } else {
        setProviderSyncResult(`Error: ${data.error}`);
      }
    } catch (error) {
      setProviderSyncResult('Sync failed');
    } finally {
      setProviderSyncing(false);
    }
  };

  const loadBackupStatus = async () => {
    try {
      const [statusRes, filesRes, settingsRes] = await Promise.all([
        fetch('/api/backup/status'),
        fetch('/api/backup/files'),
        fetch('/api/settings'),
      ]);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setBackupStatus(data.status);
        setBackupEnabled(data.status?.enabled ?? false);
      }
      if (filesRes.ok) {
        const data = await filesRes.json();
        setBackupFiles(data.backups || []);
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setBackupDir(data.settings?.backupDir || '');
      }
    } catch (error) {
      console.error('Failed to load backup status:', error);
    }
  };

  const loadBackupCategories = async () => {
    try {
      const res = await fetch('/api/backup/categories');
      if (res.ok) {
        const data = await res.json();
        setBackupCategories(data.categories || {});
      }
    } catch (error) {
      console.error('Failed to load backup categories:', error);
    }
  };

  const saveBackupDir = async () => {
    setBackupDirSaving(true);
    setBackupDirSaved(false);
    setBackupDirError('');
    try {
      const res = await fetch('/api/settings/backup-dir', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupDir: backupDir || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBackupDirError(data.error || 'Failed to save backup directory');
      } else {
        setBackupDirSaved(true);
        setTimeout(() => setBackupDirSaved(false), 2000);
        await loadBackupStatus();
      }
    } catch (error) {
      setBackupDirError('Failed to save backup directory');
    } finally {
      setBackupDirSaving(false);
    }
  };

  const toggleBackup = async (enabled: boolean) => {
    setBackupEnabled(enabled);
    try {
      await fetch('/api/backup/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch (error) {
      console.error('Failed to toggle backup:', error);
    }
  };

  const triggerBackup = async () => {
    setBackupTriggering(true);
    try {
      const res = await fetch('/api/backup/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: backupPassword || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Backup created: ${data.backupPath}${data.encrypted ? ' (encrypted)' : ''}`);
        await loadBackupStatus();
      } else {
        alert(`Backup failed: ${data.error}`);
      }
    } catch (error) {
      alert('Backup failed — check console for details');
    } finally {
      setBackupTriggering(false);
    }
  };

  const restoreBackup = async () => {
    if (!confirm('Restore backup? This will overwrite your current data.')) return;
    setRestoring(true);
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: restorePassword || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Restored successfully from backup.`);
      } else {
        alert(`Restore failed: ${data.error}`);
      }
    } catch (error) {
      alert('Restore failed — check console for details');
    } finally {
      setRestoring(false);
    }
  };

  const saveBackupCategories = async () => {
    setCategoriesSaving(true);
    try {
      await fetch('/api/backup/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: backupCategories }),
      });
    } catch (error) {
      console.error('Failed to save categories:', error);
    } finally {
      setCategoriesSaving(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
        onSettingsChange?.(data.settings);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
      </div>

      <div className="settings-sections">
        <div className="settings-section">
          <h3>User Profile</h3>
          <p className="settings-description">
            Configure your display name. This is used in chat messages and task comments.
          </p>

          <div className="form-group">
            <label htmlFor="userName">Display Name</label>
            <input
              id="userName"
              type="text"
              value={settings.userName}
              onChange={e => setSettings(prev => ({ ...prev, userName: e.target.value }))}
              placeholder="Enter your name"
            />
          </div>
        </div>

        <div className="settings-section">
          <h3>Workspace</h3>
          <p className="settings-description">
            Configure the root directory where your repositories are located. This allows AI agents to work on tasks in the correct project directory.
          </p>

          <div className="form-group">
            <label htmlFor="workspaceDir">Workspace Directory</label>
            <input
              id="workspaceDir"
              type="text"
              value={settings.workspaceDir || ''}
              onChange={e => setSettings(prev => ({ ...prev, workspaceDir: e.target.value }))}
              placeholder="e.g., /Users/yourname/development or /root/clawd/repos"
            />
            <small className="form-help">
              Path to the directory containing your Git repositories. If a task has a 'repo' field (owner/repo format), the agent will work in workspaceDir/repoName.
            </small>
          </div>
        </div>
        <div className="settings-section">
          <h3>Repository Paths</h3>
          <p className="settings-description">
            Map GitHub repositories to their local paths. The worker uses these to run in the correct directory. Falls back to workspaceDir/repoName if not mapped.
          </p>

          {Object.entries(settings.repoPaths || {}).map(([repo, localPath]) => (
            <div key={repo} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <code style={{ minWidth: '200px', fontSize: '13px', color: '#94a3b8' }}>{repo}</code>
              <input
                type="text"
                value={localPath}
                onChange={e => {
                  const updated = { ...settings.repoPaths };
                  updated[repo] = e.target.value;
                  setSettings(prev => ({ ...prev, repoPaths: updated }));
                }}
                style={{ flex: 1 }}
              />
              <button
                onClick={() => {
                  const updated = { ...settings.repoPaths };
                  delete updated[repo];
                  setSettings(prev => ({ ...prev, repoPaths: updated }));
                }}
                style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', fontSize: '13px' }}
              >
                ✕
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <input
              type="text"
              value={newRepoKey}
              onChange={e => setNewRepoKey(e.target.value)}
              placeholder="owner/repo"
              style={{ width: '200px' }}
            />
            <input
              type="text"
              value={newRepoPath}
              onChange={e => setNewRepoPath(e.target.value)}
              placeholder="/Users/you/dev/project"
              style={{ flex: 1 }}
            />
            <button
              onClick={() => {
                if (newRepoKey.trim() && newRepoPath.trim()) {
                  const updated = { ...(settings.repoPaths || {}), [newRepoKey.trim()]: newRepoPath.trim() };
                  setSettings(prev => ({ ...prev, repoPaths: updated }));
                  setNewRepoKey('');
                  setNewRepoPath('');
                }
              }}
              style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px' }}
            >
              Add
            </button>
          </div>
          <small className="form-help" style={{ marginTop: '4px', display: 'block' }}>
            Example: andywilliams/em-transactions-api → /Users/andrewwilliams/development/equals/em-transactions-api
          </small>
        </div>

        <div className="settings-section">
          <h3>GitHub</h3>
          <p className="settings-description">
            Configure your GitHub username for PR comment resolution and other GitHub-based features.
          </p>

          <div className="form-group">
            <label htmlFor="githubUsername">GitHub Username</label>
            <input
              id="githubUsername"
              type="text"
              value={settings.githubUsername || ''}
              onChange={e => setSettings(prev => ({ ...prev, githubUsername: e.target.value }))}
              placeholder="e.g., octocat"
            />
            <small className="form-help">
              Your GitHub username. Required for PR comment resolution.
            </small>
          </div>
        </div>

        <div className="settings-section">
          <h3>PR Comment Resolver</h3>
          <p className="settings-description">
            Automatically scan your open PRs for unresolved comments and address them with helpful responses or code suggestions.
          </p>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={prResolverStatus.enabled}
                onChange={e => setPRResolverStatus(prev => ({ ...prev, enabled: e.target.checked }))}
                style={{ width: '18px', height: '18px' }}
                disabled={!settings.githubUsername}
              />
              Enable PR comment resolver
            </label>
            {!settings.githubUsername && (
              <small className="form-help" style={{ color: '#ef4444' }}>
                Configure your GitHub username first
              </small>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="prFrequency">Check Frequency</label>
            <select
              id="prFrequency"
              value={prResolverStatus.frequency}
              onChange={e => setPRResolverStatus(prev => ({ ...prev, frequency: e.target.value }))}
              style={{ maxWidth: '300px' }}
            >
              <option value="0 */2 * * *">Every 2 hours</option>
              <option value="0 */4 * * *">Every 4 hours</option>
              <option value="0 */6 * * *">Every 6 hours</option>
              <option value="0 */12 * * *">Every 12 hours</option>
              <option value="0 9,17 * * 1-5">9 AM & 5 PM (weekdays)</option>
              <option value="0 9 * * 1-5">Daily at 9 AM (weekdays)</option>
            </select>
            <small className="form-help">
              How often to check PRs for unresolved comments
            </small>
          </div>

          {prResolverStatus.lastRun && (
            <div className="form-group">
              <label>Last Run</label>
              <div style={{ fontSize: '14px', color: '#94a3b8' }}>
                {new Date(prResolverStatus.lastRun).toLocaleString()}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              className="save-btn"
              onClick={savePRResolverConfig}
              disabled={prSaving || !settings.githubUsername}
            >
              {prSaving ? 'Saving...' : prSaved ? 'Saved!' : 'Save PR Resolver Settings'}
            </button>
            <button
              className="save-btn"
              onClick={() => triggerPRResolver(true)}
              style={{ backgroundColor: '#f59e0b' }}
              disabled={!settings.githubUsername}
            >
              Dry Run
            </button>
            <button
              className="save-btn"
              onClick={() => triggerPRResolver(false)}
              style={{ backgroundColor: '#6366f1' }}
              disabled={!settings.githubUsername}
            >
              Run Now
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>Automated Standups</h3>
          <p className="settings-description">
            Generate daily standups automatically from git commits, GitHub PRs, and task activity. Runs Monday–Friday at the configured time.
          </p>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={standupConfig.enabled}
                onChange={e => setStandupConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                style={{ width: '18px', height: '18px' }}
              />
              Enable automated standups
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="standupTime">Standup Time</label>
            <input
              id="standupTime"
              type="time"
              value={standupConfig.time}
              onChange={e => setStandupConfig(prev => ({ ...prev, time: e.target.value }))}
              style={{ maxWidth: '160px' }}
            />
            <small className="form-help">
              When to generate the daily standup (your local time). The server must be running at this time.
            </small>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              className="save-btn"
              onClick={saveStandupConfig}
              disabled={standupSaving}
            >
              {standupSaving ? 'Saving...' : standupSaved ? 'Saved!' : 'Save Standup Settings'}
            </button>
            <button
              className="save-btn"
              onClick={triggerStandup}
              style={{ backgroundColor: '#6366f1' }}
            >
              Generate Now
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>Slack Sync (slx)</h3>
          <p className="settings-description">
            Automatically sync Slack messages and activity using the slx tool. Fetches data from your configured Slack channels and caches it locally.
          </p>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={slxSyncConfig.enabled}
                onChange={e => setSlxSyncConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                style={{ width: '18px', height: '18px' }}
              />
              Enable Slack sync
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="slxInterval">Sync Frequency</label>
            <select
              id="slxInterval"
              value={slxSyncConfig.interval}
              onChange={e => setSlxSyncConfig(prev => ({ ...prev, interval: e.target.value }))}
              style={{ maxWidth: '300px' }}
            >
              <option value="*/30 * * * *">Every 30 minutes</option>
              <option value="0 */1 * * *">Every hour</option>
              <option value="0 */2 * * *">Every 2 hours</option>
              <option value="0 */4 * * *">Every 4 hours</option>
              <option value="0 */6 * * *">Every 6 hours</option>
              <option value="0 */12 * * *">Every 12 hours</option>
            </select>
            <small className="form-help">
              How often to fetch new Slack messages. Requires slx to be installed and configured.
            </small>
          </div>

          {slxSyncConfig.lastRun && (
            <div className="form-group">
              <label>Last Sync</label>
              <div style={{ fontSize: '14px', color: '#94a3b8' }}>
                {new Date(slxSyncConfig.lastRun).toLocaleString()}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              className="save-btn"
              onClick={saveSlxSyncConfig}
              disabled={slxSaving}
            >
              {slxSaving ? 'Saving...' : slxSaved ? 'Saved!' : 'Save Slack Sync Settings'}
            </button>
            <button
              className="save-btn"
              onClick={triggerSlxSync}
              style={{ backgroundColor: '#6366f1' }}
            >
              Sync Now
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>Reminder Rules</h3>
          <p className="settings-description">
            Automatically check reminder rules and send notifications based on task conditions.
            <a href="/settings/reminders" style={{ marginLeft: '8px' }}>Manage Rules →</a>
          </p>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={reminderCheckConfig.enabled}
                onChange={e => setReminderCheckConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                style={{ width: '18px', height: '18px' }}
              />
              Enable reminder checks
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="reminderInterval">Check Frequency</label>
            <select
              id="reminderInterval"
              value={reminderCheckConfig.interval}
              onChange={e => setReminderCheckConfig(prev => ({ ...prev, interval: e.target.value }))}
            >
              <option value="0 9 * * 1-5">Daily at 9 AM (weekdays)</option>
              <option value="0 9,15 * * 1-5">Twice daily at 9 AM & 3 PM (weekdays)</option>
              <option value="0 */4 * * 1-5">Every 4 hours (weekdays)</option>
              <option value="0 9 * * *">Daily at 9 AM (every day)</option>
              <option value="0 */6 * * *">Every 6 hours</option>
              <option value="0 */2 * * 1-5">Every 2 hours (weekdays)</option>
              <option value="0 8,12,17 * * 1-5">3 times daily (8 AM, 12 PM, 5 PM weekdays)</option>
            </select>
            <small className="form-help">
              When the reminder rules should be evaluated
            </small>
            {reminderCheckConfig.lastRun && (
              <small className="form-help" style={{ marginTop: '4px' }}>
                Last run: {new Date(reminderCheckConfig.lastRun).toLocaleString()}
              </small>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button
              className="save-btn"
              onClick={saveReminderCheckConfig}
              disabled={reminderSaving}
            >
              {reminderSaving ? 'Saving...' : reminderSaved ? 'Saved!' : 'Save Reminder Settings'}
            </button>
            <button
              className="save-btn"
              onClick={triggerReminderCheck}
              style={{ backgroundColor: '#6366f1' }}
            >
              Check Now
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>Worker Concurrency</h3>
          <p className="settings-description">
            Control how many persona tasks can run simultaneously. Increase concurrency to process multiple tasks in parallel, or keep it at 1 for sequential processing (safer, more predictable).
          </p>

          <div className="form-group">
            <label htmlFor="maxConcurrentPersonas">Max Concurrent Personas</label>
            <input
              id="maxConcurrentPersonas"
              type="number"
              min="1"
              max="10"
              value={concurrencyConfig.maxConcurrentPersonas}
              onChange={e => setConcurrencyConfig(prev => ({ ...prev, maxConcurrentPersonas: parseInt(e.target.value) || 1 }))}
              style={{ maxWidth: '120px' }}
            />
            <small className="form-help">
              Maximum number of personas that can work on tasks simultaneously (1-10). Default: 1 (sequential processing).
            </small>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={concurrencyConfig.allowDuplicatePersonas}
                onChange={e => setConcurrencyConfig(prev => ({ ...prev, allowDuplicatePersonas: e.target.checked }))}
                style={{ width: '18px', height: '18px' }}
              />
              Allow duplicate personas
            </label>
            <small className="form-help" style={{ marginTop: '4px' }}>
              When enabled, the same persona type can work on multiple tasks concurrently (e.g., two developer personas). When disabled, each persona type can only work on one task at a time.
            </small>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button
              className="save-btn"
              onClick={saveConcurrencyConfig}
              disabled={concurrencySaving}
            >
              {concurrencySaving ? 'Saving...' : concurrencySaved ? 'Saved!' : 'Save Concurrency Settings'}
            </button>
          </div>
          {concurrencyError && (
            <div style={{ color: '#ef4444', marginTop: '8px', fontSize: '0.9rem' }}>
              {concurrencyError}
            </div>
          )}
        </div>
      </div>

      {/* Providers Section */}
      <div className="settings-section">
        <h2>Providers</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.9rem' }}>
          Choose where Forge pulls tickets and messages from. Switching providers lets you use different tools without changing how the board works.
        </p>

        <div className="form-group">
          <label htmlFor="ticketProvider">Ticket Source</label>
          <select
            id="ticketProvider"
            value={providerConfig.ticketProvider}
            onChange={e => setProviderConfig(prev => ({ ...prev, ticketProvider: e.target.value }))}
          >
            {availableProviders.tickets.length > 0
              ? availableProviders.tickets.map(p => <option key={p} value={p}>{p}</option>)
              : <option value="tix">tix (Notion sync)</option>
            }
          </select>
          <small className="form-help">
            <strong>tix</strong> — syncs from Notion via the tix CLI
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="messageProvider">Message Source</label>
          <select
            id="messageProvider"
            value={providerConfig.messageProvider}
            onChange={e => setProviderConfig(prev => ({ ...prev, messageProvider: e.target.value }))}
          >
            {availableProviders.messages.length > 0
              ? availableProviders.messages.map(p => <option key={p} value={p}>{p}</option>)
              : <option value="slx">slx (Slack sync)</option>
            }
          </select>
          <small className="form-help">
            <strong>slx</strong> — syncs from Slack via the slx CLI
          </small>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', alignItems: 'center' }}>
          <button className="save-btn" onClick={saveProviderConfig} disabled={providerSaving}>
            {providerSaving ? 'Saving...' : providerSaved ? 'Saved!' : 'Save Providers'}
          </button>
          <button
            className="save-btn"
            onClick={triggerProviderSync}
            disabled={providerSyncing}
            style={{ backgroundColor: '#6366f1' }}
          >
            {providerSyncing ? 'Syncing...' : '🔄 Sync Now'}
          </button>
        </div>
        {providerSyncResult && (
          <small style={{ marginTop: '8px', display: 'block', color: providerSyncResult.startsWith('Error') ? 'var(--error, #ef4444)' : 'var(--success, #22c55e)' }}>
            {providerSyncResult}
          </small>
        )}
      </div>

      {/* Backup Section */}
      <div className="settings-section">
        <h2>Backup</h2>

        <div className="form-group">
          <label htmlFor="backupDir">Backup Directory</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              id="backupDir"
              type="text"
              value={backupDir}
              onChange={e => setBackupDir(e.target.value)}
              placeholder="~/.tix-kanban-backups (default)"
              style={{ flex: 1 }}
            />
            <button className="save-btn" onClick={saveBackupDir} disabled={backupDirSaving}>
              {backupDirSaving ? 'Saving...' : backupDirSaved ? 'Saved!' : 'Set'}
            </button>
          </div>
          {backupDirError && <small style={{ color: 'var(--error, #ef4444)', marginTop: '4px', display: 'block' }}>{backupDirError}</small>}
          <small className="form-help">Leave empty to use the default (~/.tix-kanban-backups). Supports ~ paths. Directory is created automatically if it doesn't exist.</small>
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={backupEnabled}
              onChange={e => toggleBackup(e.target.checked)}
              style={{ width: '18px', height: '18px' }}
            />
            Enable automatic backups
          </label>
          {backupStatus?.lastBackup && (
            <small className="form-help">Last backup: {new Date(backupStatus.lastBackup).toLocaleString()}</small>
          )}
        </div>

        {Object.keys(backupCategories).length > 0 && (
          <div className="form-group">
            <label>Include in backup</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
              {Object.entries(backupCategories).map(([key, enabled]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', textTransform: 'capitalize' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => setBackupCategories(prev => ({ ...prev, [key]: e.target.checked }))}
                    style={{ width: '16px', height: '16px' }}
                  />
                  {key.replace(/-/g, ' ')}
                </label>
              ))}
            </div>
            <button className="save-btn" onClick={saveBackupCategories} disabled={categoriesSaving} style={{ marginTop: '10px' }}>
              {categoriesSaving ? 'Saving...' : 'Save Categories'}
            </button>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="backupPassword">Encryption Password (optional)</label>
          <input
            id="backupPassword"
            type="password"
            value={backupPassword}
            onChange={e => setBackupPassword(e.target.value)}
            placeholder="Leave empty for unencrypted backup"
          />
          <small className="form-help">AES-256-GCM encryption. Password is never stored — keep it safe.</small>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          <button className="save-btn" onClick={triggerBackup} disabled={backupTriggering}>
            {backupTriggering ? 'Backing up...' : '💾 Backup Now'}
          </button>
        </div>

        {backupFiles.length > 0 && (
          <div className="form-group" style={{ marginTop: '20px' }}>
            <label>Available Backups ({backupFiles.length})</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
              {backupFiles.slice(0, 5).map(f => (
                <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--bg-secondary, #1e1e2e)', borderRadius: '6px', fontSize: '0.85rem' }}>
                  <span>{f.name} {f.encrypted && '🔒'}</span>
                  <span style={{ color: 'var(--text-secondary, #888)' }}>{new Date(f.createdAt).toLocaleString()} · {f.size ? `${(f.size / 1024).toFixed(0)}KB` : ''}</span>
                </div>
              ))}
            </div>

            <div className="form-group" style={{ marginTop: '16px' }}>
              <label htmlFor="restorePassword">Restore Password (if encrypted)</label>
              <input
                id="restorePassword"
                type="password"
                value={restorePassword}
                onChange={e => setRestorePassword(e.target.value)}
                placeholder="Required only for encrypted backups"
              />
            </div>
            <button
              className="save-btn"
              onClick={restoreBackup}
              disabled={restoring}
              style={{ backgroundColor: 'var(--error, #ef4444)', marginTop: '8px' }}
            >
              {restoring ? 'Restoring...' : '⚠️ Restore Latest Backup'}
            </button>
          </div>
        )}
      </div>

      <div className="settings-actions">
        <button
          className="save-btn"
          onClick={saveSettings}
          disabled={saving || !settings.userName.trim()}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
