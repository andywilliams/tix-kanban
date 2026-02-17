import { useState, useEffect } from 'react';

interface UserSettings {
  userName: string;
  workspaceDir?: string;
}

interface StandupConfig {
  enabled: boolean;
  time: string; // HH:MM format
}

interface SettingsPageProps {
  onSettingsChange?: (settings: UserSettings) => void;
}

export function SettingsPage({ onSettingsChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<UserSettings>({ userName: 'User', workspaceDir: '' });
  const [standupConfig, setStandupConfig] = useState<StandupConfig>({ enabled: false, time: '09:00' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [standupSaving, setStandupSaving] = useState(false);
  const [standupSaved, setStandupSaved] = useState(false);

  useEffect(() => {
    loadSettings();
    loadStandupConfig();
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

  const loadStandupConfig = async () => {
    try {
      const response = await fetch('/api/worker/status');
      if (response.ok) {
        const data = await response.json();
        if (data.standupScheduler) {
          // Parse cron time from status if available
          setStandupConfig({
            enabled: data.standupScheduler.enabled || false,
            time: data.standupScheduler.time || '09:00',
          });
        }
      }
    } catch (error) {
      console.error('Failed to load standup config:', error);
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
        body: JSON.stringify({ schedule: cronExpr }),
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
