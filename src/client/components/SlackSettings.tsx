import React, { useState, useEffect } from 'react';
import './SlackSettings.css';

interface SlxConfig {
  user: { name: string; slackId?: string };
  channels: Array<{ name: string; priority: 'high' | 'normal' | 'low' }>;
  sync: {
    dmsEnabled: boolean;
    mentionsOnly: boolean;
    maxMessages: number;
    lookbackHours: number;
    autoSyncEnabled?: boolean;
    autoSyncIntervalHours?: number;
  };
  output: { dir: string; format: 'daily' | 'channel' };
}

export default function SlackSettings() {
  const [config, setConfig] = useState<SlxConfig | null>(null);
  const [newChannel, setNewChannel] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'normal' | 'low'>('normal');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    const res = await fetch('/api/slx/config');
    const data = await res.json();
    setConfig(data);
  }

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    try {
      await fetch('/api/slx/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      alert('Slack settings saved!');
    } catch (err: any) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function addChannel() {
    if (!config || !newChannel.trim()) return;
    const name = newChannel.startsWith('#') ? newChannel : `#${newChannel}`;
    setConfig({
      ...config,
      channels: [...config.channels, { name, priority: newPriority }]
    });
    setNewChannel('');
  }

  function removeChannel(name: string) {
    if (!config) return;
    setConfig({
      ...config,
      channels: config.channels.filter(c => c.name !== name)
    });
  }

  if (!config) return <div className="slack-settings">Loading...</div>;

  return (
    <div className="slack-settings">
      <h2>Slack Settings</h2>

      <section>
        <h3>User</h3>
        <label>
          Your Slack name:
          <input
            type="text"
            value={config.user.name}
            onChange={e => setConfig({ ...config, user: { ...config.user, name: e.target.value } })}
          />
        </label>
      </section>

      <section>
        <h3>Channels</h3>
        <div className="channel-list">
          {config.channels.map(ch => (
            <div key={ch.name} className="channel-item">
              <span>{ch.name}</span>
              <span className={`priority ${ch.priority}`}>{ch.priority}</span>
              <button onClick={() => removeChannel(ch.name)}>Remove</button>
            </div>
          ))}
        </div>
        <div className="add-channel">
          <input
            type="text"
            placeholder="#channel-name"
            value={newChannel}
            onChange={e => setNewChannel(e.target.value)}
          />
          <select value={newPriority} onChange={e => setNewPriority(e.target.value as any)}>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <button onClick={addChannel}>Add</button>
        </div>
      </section>

      <section>
        <h3>Sync Settings</h3>
        <label>
          <input
            type="checkbox"
            checked={config.sync.dmsEnabled}
            onChange={e => setConfig({ ...config, sync: { ...config.sync, dmsEnabled: e.target.checked } })}
          />
          Enable DMs
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.sync.mentionsOnly}
            onChange={e => setConfig({ ...config, sync: { ...config.sync, mentionsOnly: e.target.checked } })}
          />
          Mentions only
        </label>
        <label>
          Max messages per channel:
          <input
            type="number"
            value={config.sync.maxMessages}
            onChange={e => setConfig({ ...config, sync: { ...config.sync, maxMessages: parseInt(e.target.value) } })}
          />
        </label>
        <label>
          Lookback hours:
          <input
            type="number"
            value={config.sync.lookbackHours}
            onChange={e => setConfig({ ...config, sync: { ...config.sync, lookbackHours: parseInt(e.target.value) } })}
          />
        </label>
      </section>

      <section>
        <h3>Auto-Sync</h3>
        <label>
          <input
            type="checkbox"
            checked={config.sync.autoSyncEnabled || false}
            onChange={e => setConfig({ ...config, sync: { ...config.sync, autoSyncEnabled: e.target.checked } })}
          />
          Enable auto-sync
        </label>
        {config.sync.autoSyncEnabled && (
          <label>
            Sync every (hours):
            <input
              type="number"
              value={config.sync.autoSyncIntervalHours || 1}
              onChange={e => setConfig({ ...config, sync: { ...config.sync, autoSyncIntervalHours: parseInt(e.target.value) } })}
            />
          </label>
        )}
      </section>

      <button onClick={saveConfig} disabled={saving} className="save-btn">
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}