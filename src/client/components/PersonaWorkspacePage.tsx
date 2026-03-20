import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Persona } from '../types';
import { usePersonas } from '../hooks/usePersonas';

interface WorkspaceFile {
  name: string;
  path: string;
  size: number;
  modified: Date;
}

export function PersonaWorkspacePage() {
  const { personas, loading: personasLoading } = usePersonas();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Initialize selected persona from URL
  useEffect(() => {
    const personaParam = searchParams.get('persona');
    if (personaParam && personas.some(p => p.id === personaParam)) {
      setSelectedPersona(personaParam);
    } else if (personas.length > 0 && !selectedPersona) {
      setSelectedPersona(personas[0].id);
    }
  }, [searchParams, personas, selectedPersona]);

  // Load files when persona changes
  useEffect(() => {
    if (selectedPersona) {
      loadFiles();
    }
  }, [selectedPersona]);

  // Load file content when selected file changes
  useEffect(() => {
    if (selectedPersona && selectedFile) {
      loadFileContent();
    }
  }, [selectedPersona, selectedFile]);

  const loadFiles = async () => {
    if (!selectedPersona) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/personas/${selectedPersona}/workspace/files`);
      const data = await res.json();
      setFiles(data.files || []);
      
      // Auto-select CONTEXT.md if it exists
      if (!selectedFile && (data.files || []).some((f: WorkspaceFile) => f.path === 'CONTEXT.md')) {
        setSelectedFile('CONTEXT.md');
      }
    } catch (error) {
      console.error('Failed to load workspace files:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFileContent = async () => {
    if (!selectedPersona || !selectedFile) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/personas/${selectedPersona}/workspace/file?filename=${encodeURIComponent(selectedFile)}`);
      const data = await res.json();
      setFileContent(data.content || '');
      setEditContent(data.content || '');
    } catch (error) {
      console.error('Failed to load file content:', error);
      setFileContent('');
      setEditContent('');
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedPersona || !selectedFile) return;

    // Capture values at call time to avoid stale closure issues if user switches file/persona before response arrives
    const personaToSave = selectedPersona;
    const fileToSave = selectedFile;
    const contentToSave = editContent;

    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/personas/${personaToSave}/workspace/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fileToSave, content: contentToSave }),
      });

      if (res.ok) {
        // Only update UI state if user is still viewing the same file
        if (selectedPersona === personaToSave && selectedFile === fileToSave) {
          setFileContent(contentToSave);
          setIsEditing(false);
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        }
      } else {
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Failed to save file:', error);
      setSaveStatus('error');
    }
  };

  const handlePersonaChange = (personaId: string) => {
    setSelectedPersona(personaId);
    setSearchParams({ persona: personaId });
    setSelectedFile(null);
    setFileContent('');
    setEditContent('');
    setIsEditing(false);
  };

  const currentPersona = personas.find(p => p.id === selectedPersona);
  const canEdit = selectedFile === 'CONTEXT.md' || selectedFile === 'MEMORY.md';

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div style={{ 
      padding: '2rem', 
      maxWidth: '1400px', 
      margin: '0 auto',
      height: 'calc(100vh - 4rem)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '2rem', fontWeight: 600 }}>
          📁 Persona Workspaces
        </h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          View and edit workspace files for each persona
        </p>
      </div>

      {/* Persona Selector */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ 
          display: 'block', 
          marginBottom: '0.5rem', 
          fontSize: '0.9rem',
          fontWeight: 500,
        }}>
          Select Persona
        </label>
        <select
          value={selectedPersona || ''}
          onChange={(e) => handlePersonaChange(e.target.value)}
          style={{
            padding: '0.6rem 1rem',
            fontSize: '1rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            color: 'var(--text)',
            cursor: 'pointer',
            minWidth: '300px',
          }}
        >
          {personas.map(p => (
            <option key={p.id} value={p.id}>
              {p.emoji} {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Main Content */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '300px 1fr', 
        gap: '1.5rem',
        flex: 1,
        minHeight: 0,
      }}>
        {/* File List */}
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '0.75rem',
          border: '1px solid var(--border)',
          padding: '1rem',
          overflowY: 'auto',
        }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>
            Workspace Files
          </h3>
          
          {loading && files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              Loading...
            </div>
          ) : files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              No files yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {files.map(file => (
                <button
                  key={file.path}
                  onClick={() => { setSelectedFile(file.path); setIsEditing(false); }}
                  style={{
                    padding: '0.75rem',
                    background: selectedFile === file.path ? 'var(--accent-bg)' : 'transparent',
                    border: '1px solid',
                    borderColor: selectedFile === file.path ? 'var(--accent)' : 'var(--border)',
                    borderRadius: '0.5rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    color: selectedFile === file.path ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                    {file.path.includes('/') ? '📄' : file.name === 'CONTEXT.md' ? '⚙️' : file.name === 'MEMORY.md' ? '🧠' : '📝'} {file.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {formatFileSize(file.size)} • {formatDate(file.modified)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* File Viewer/Editor */}
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '0.75rem',
          border: '1px solid var(--border)',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          {!selectedFile ? (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flex: 1,
              color: 'var(--text-muted)',
            }}>
              Select a file to view or edit
            </div>
          ) : (
            <>
              {/* File Header */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '1rem',
                paddingBottom: '1rem',
                borderBottom: '1px solid var(--border)',
              }}>
                <div>
                  <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem', fontWeight: 600 }}>
                    {selectedFile}
                  </h3>
                  {currentPersona && (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {currentPersona.emoji} {currentPersona.name}
                    </p>
                  )}
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {saveStatus === 'saved' && (
                      <span style={{ fontSize: '0.85rem', color: 'var(--success)' }}>
                        ✓ Saved
                      </span>
                    )}
                    {saveStatus === 'error' && (
                      <span style={{ fontSize: '0.85rem', color: 'var(--danger)' }}>
                        ✗ Error saving
                      </span>
                    )}
                    {!isEditing ? (
                      <button
                        onClick={() => setIsEditing(true)}
                        style={{
                          padding: '0.5rem 1rem',
                          background: 'var(--accent)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '0.5rem',
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        ✏️ Edit
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setIsEditing(false);
                            setEditContent(fileContent);
                          }}
                          style={{
                            padding: '0.5rem 1rem',
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            border: '1px solid var(--border)',
                            borderRadius: '0.5rem',
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveFile}
                          disabled={saveStatus === 'saving'}
                          style={{
                            padding: '0.5rem 1rem',
                            background: 'var(--success)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.5rem',
                            cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
                            fontWeight: 500,
                          }}
                        >
                          {saveStatus === 'saving' ? 'Saving...' : '💾 Save'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* File Content */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {loading ? (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    flex: 1,
                  }}>
                    Loading...
                  </div>
                ) : isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '1rem',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      borderRadius: '0.5rem',
                      color: 'var(--text)',
                      fontFamily: 'monospace',
                      fontSize: '0.9rem',
                      lineHeight: '1.5',
                      resize: 'none',
                    }}
                  />
                ) : (
                  <div style={{
                    flex: 1,
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                    lineHeight: '1.5',
                  }}>
                    {fileContent || <span style={{ color: 'var(--text-muted)' }}>(empty file)</span>}
                  </div>
                )}
              </div>

              {/* Help Text */}
              {canEdit && !isEditing && (
                <div style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                }}>
                  <strong>💡 Tip:</strong> {selectedFile === 'CONTEXT.md' 
                    ? 'This content is injected into every task this persona works on. Use it for project guidelines, code styles, or things to always remember.'
                    : 'This file stores long-term learnings and notes. The persona can write to it during tasks.'}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
