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
  const [prSaving, setPRSaving] = useState(false);
  const [prSaved, setPRSaved] = useState(false);
  const [reminderCheckConfig, setReminderCheckConfig] = useState<ReminderCheckConfig>({ enabled: false, interval: '0 9 * * 1-5' });
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderSaved, setReminderSaved] = useState(false);

  useEffect(() => {
    loadSettings();
    loadWorkerConfig();
    loadPRResolverStatus();
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
