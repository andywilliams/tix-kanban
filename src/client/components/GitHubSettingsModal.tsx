import { useState, useEffect } from 'react';
import { GitHubConfig, GitHubAuthStatus } from '../types';

interface GitHubSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GitHubSettingsModal({ isOpen, onClose }: GitHubSettingsModalProps) {
  const [config, setConfig] = useState<GitHubConfig>({
    repos: [],
    defaultBranch: 'main',
    branchPrefix: 'tix/',
    autoLink: true,
  });
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus>({ authenticated: false });
  const [loading, setLoading] = useState(false);
  const [newRepo, setNewRepo] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      checkAuth();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/github/config');
      if (response.ok) {
        const data = await response.json();
        setConfig(data.config);
      }
    } catch (error) {
      console.error('Failed to load GitHub config:', error);
    }
  };

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/github/auth');
      if (response.ok) {
        const data = await response.json();
        setAuthStatus(data);
      }
    } catch (error) {
      console.error('Failed to check GitHub auth:', error);
    }
  };

  const saveConfig = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/github/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      
      if (response.ok) {
        onClose();
      } else {
        console.error('Failed to save GitHub config');
      }
    } catch (error) {
      console.error('Failed to save GitHub config:', error);
    } finally {
      setLoading(false);
    }
  };

  const addRepo = () => {
    if (newRepo && !config.repos.includes(newRepo)) {
      setConfig(prev => ({
        ...prev,
        repos: [...prev.repos, newRepo],
      }));
      setNewRepo('');
    }
  };

  const removeRepo = (repo: string) => {
    setConfig(prev => ({
      ...prev,
      repos: prev.repos.filter(r => r !== repo),
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal github-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>GitHub Integration Settings</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-content">
          {/* Auth Status */}
          <div className="section">
            <h3>Authentication Status</h3>
            <div className={`auth-status ${authStatus.authenticated ? 'authenticated' : 'not-authenticated'}`}>
              {authStatus.authenticated ? (
                <div className="auth-success">
                  ✅ Authenticated as <strong>{authStatus.username}</strong>
                </div>
              ) : (
                <div className="auth-failure">
                  ❌ Not authenticated. Run <code>gh auth login</code> in terminal.
                </div>
              )}
            </div>
          </div>

          {/* Repository Configuration */}
          <div className="section">
            <h3>Repositories</h3>
            <div className="repo-list">
              {config.repos.map((repo) => (
                <div key={repo} className="repo-item">
                  <span>{repo}</span>
                  <button 
                    className="remove-btn"
                    onClick={() => removeRepo(repo)}
                    aria-label={`Remove ${repo}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            
            <div className="add-repo">
              <input
                type="text"
                value={newRepo}
                onChange={e => setNewRepo(e.target.value)}
                placeholder="owner/repo"
                onKeyDown={e => e.key === 'Enter' && addRepo()}
              />
              <button onClick={addRepo}>Add Repository</button>
            </div>
          </div>

          {/* Branch Settings */}
          <div className="section">
            <h3>Branch Settings</h3>
            <div className="form-group">
              <label htmlFor="defaultBranch">Default Branch</label>
              <input
                id="defaultBranch"
                type="text"
                value={config.defaultBranch}
                onChange={e => setConfig(prev => ({ ...prev, defaultBranch: e.target.value }))}
                placeholder="main"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="branchPrefix">Branch Prefix</label>
              <input
                id="branchPrefix"
                type="text"
                value={config.branchPrefix}
                onChange={e => setConfig(prev => ({ ...prev, branchPrefix: e.target.value }))}
                placeholder="tix/"
              />
            </div>
          </div>

          {/* Auto-link Setting */}
          <div className="section">
            <div className="form-group checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={config.autoLink}
                  onChange={e => setConfig(prev => ({ ...prev, autoLink: e.target.checked }))}
                />
                Auto-link tasks to PRs when created
              </label>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button 
            className="save-btn" 
            onClick={saveConfig} 
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}