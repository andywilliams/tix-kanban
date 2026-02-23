import React, { useState, useEffect } from 'react';
import './SlackView.css';

export default function SlackView() {
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<'mentions' | 'channels' | 'dms' | 'digest'>('mentions');

  useEffect(() => {
    loadData();
    loadStatus();
  }, []);

  async function loadData() {
    const res = await fetch('/api/slx/data');
    const d = await res.json();
    setData(d);
  }

  async function loadStatus() {
    const res = await fetch('/api/slx/status');
    const s = await res.json();
    setStatus(s);
  }

  async function triggerSync() {
    setSyncing(true);
    try {
      await fetch('/api/slx/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      await loadData();
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }

  if (!data) return <div className="slack-view">Loading...</div>;

  return (
    <div className="slack-view">
      <div className="slack-header">
        <h2>Slack</h2>
        <button onClick={triggerSync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {status && (
        <div className="slack-status">
          Last sync: {new Date(status.lastSync).toLocaleString()} ({status.mentionCount} mentions)
        </div>
      )}

      <div className="slack-tabs">
        <button className={tab === 'mentions' ? 'active' : ''} onClick={() => setTab('mentions')}>
          Mentions {data.mentions?.length > 0 && `(${data.mentions.length})`}
        </button>
        <button className={tab === 'channels' ? 'active' : ''} onClick={() => setTab('channels')}>
          Channels
        </button>
        <button className={tab === 'dms' ? 'active' : ''} onClick={() => setTab('dms')}>
          DMs
        </button>
        <button className={tab === 'digest' ? 'active' : ''} onClick={() => setTab('digest')}>
          Digest
        </button>
      </div>

      <div className="slack-content">
        {tab === 'mentions' && (
          <div className="mentions">
            {data.mentions?.length === 0 ? (
              <p>No mentions</p>
            ) : (
              data.mentions?.map((m: any, i: number) => (
                <div key={i} className="mention-item">
                  <div className="mention-meta">
                    <strong>{m.author}</strong> in {m.channel}
                    <span className="mention-time">{m.timestamp}</span>
                  </div>
                  <div className="mention-text">{m.text}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'channels' && (
          <div className="channels">
            {data.channels?.map((ch: any, i: number) => (
              <div key={i} className="channel-item">
                <h3>#{ch.name}</h3>
                <pre>{ch.content}</pre>
              </div>
            ))}
          </div>
        )}

        {tab === 'dms' && (
          <div className="dms">
            {data.dms?.map((dm: any, i: number) => (
              <div key={i} className="dm-item">
                <h3>DM with {dm.name}</h3>
                <pre>{dm.content}</pre>
              </div>
            ))}
          </div>
        )}

        {tab === 'digest' && (
          <div className="digest">
            <pre>{data.digest || 'No digest available. Run slx digest first.'}</pre>
          </div>
        )}
      </div>
    </div>
  );
}