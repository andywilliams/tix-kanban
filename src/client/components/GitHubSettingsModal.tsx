import { useState, useEffect } from 'react';
import { GitHubConfig, GitHubAuthStatus, RepoConfig } from '../types';

// Normalize repo entry to RepoConfig object
const normalizeRepo = (repo: string | RepoConfig, fallbackBranch: string): RepoConfig => {
  if (typeof repo === 'string') {
    return { name: repo, defaultBranch: fallbackBranch };
  }
  return repo;
};

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
    if (!newRepo) return;
    const repoNames = config.repos.map(r => typeof r === 'string' ? r : r.name);
    if (repoNames.includes(newRepo)) return;
    
    setConfig(prev => ({
      ...prev,
      repos: [...prev.repos, { name: newRepo, defaultBranch: prev.defaultBranch }],
    }));
    setNewRepo('');
  };

  const removeRepo = (repoName: string) => {
    setConfig(prev => ({
      ...prev,
      repos: prev.repos.filter(r => (typeof r === 'string' ? r : r.name) !== repoName),
    }));
  };

  const updateRepoBranch = (repoName: string, branch: string) => {
    setConfig(prev => ({
      ...prev,
      repos: prev.repos.map(r => {
        const normalized = normalizeRepo(r, prev.defaultBranch);
        if (normalized.name === repoName) {
          return { ...normalized, defaultBranch: branch };
        }
        return normalized;
      }),
    }));
  };

  if (!isOpen) return null;

  const normalizedRepos = config.repos.map(r => normalizeRepo(r, config.defaultBranch));

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
            <h3>Authentication</h3>
            <div className={`auth-status ${authStatus.authenticated ? 'authenticated' : 'not-authenticated'}`}>
              {authStatus.authenticated ? (
                <span>✅ Authenticated as <strong>{authStatus.username}</strong></span>
              ) : (
                <span>❌ Not authenticated. Run <code>gh auth login</code> in terminal.</span>
              )}
            </div>
          </div>

          {/* Repository Configuration */}
          <div className="section">
            <h3>Repositories</h3>
            <p className="section-hint">Add repos and set their default branch individually.</p>
            
            <div className="repo-list">
              {normalizedRepos.map((repo) => (
                <div key={repo.name} className="repo-item">
                  <span className="repo-name">{repo.name}</span>
                  <div className="repo-item-controls">
                    <select
                      value={repo.defaultBranch}
                      onChange={e => updateRepoBranch(repo.name, e.target.value)}
                      className="repo-branch-select"
                      title="Default branch"
                    >
                      <option value="main">main</option>
                      <option value="master">master</option>
                      <option value="develop">develop</option>
                    </select>
                    <button 
                      className="remove-btn"
                      onClick={() => removeRepo(repo.name)}
                      aria-label={`Remove ${repo.name}`}
                    >
                      ×
                    </button>
                  </div>
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
              <button onClick={addRepo}>Add</button>
            </div>
          </div>

          {/* Branch Settings */}
          <div className="section">
            <h3>Defaults</h3>
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
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
