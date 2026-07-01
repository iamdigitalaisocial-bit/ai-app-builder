'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

type Status = 'idle' | 'running' | 'completed' | 'failed' | 'awaiting-input';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  content?: string;
}

interface StepUpdate {
  runId?: string;
  step: string;
  status: string;
  message: string;
  detail?: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

interface Project {
  id: string;
  name: string;
  updatedAt: string;
}

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [currentStep, setCurrentStep] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [stepProgress, setStepProgress] = useState<Record<string, string>>({});
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const buildFileTree = (files: string[], fileContents: Record<string, { content: string }>): FileNode[] => {
    const root: FileNode[] = [];
    const map = new Map<string, FileNode>();

    for (const filePath of files.sort()) {
      const parts = filePath.split('/');
      let current = root;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

        if (isLast) {
          // File
          current.push({
            name: parts[i],
            path: currentPath,
            type: 'file',
            content: fileContents[currentPath]?.content || '',
          });
        } else {
          // Folder - find or create
          let folder = current.find(n => n.name === parts[i] && n.type === 'folder') as FileNode | undefined;
          if (!folder) {
            folder = { name: parts[i], path: currentPath, type: 'folder', children: [] };
            current.push(folder);
          }
          current = folder.children!;
        }
      }
    }
    return root;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || status === 'running') return;

    setStatus('running');
    setCurrentStep('Starting...');
    setLogs([]);
    setFiles([]);
    setSelectedFile(null);
    setStepProgress({});
    addLog('Starting workflow...');
    addLog(`Prompt: ${prompt}`);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const update: StepUpdate = JSON.parse(data);
            
            if (update.runId) {
              setRunId(update.runId);
            }

            const stepLabel = update.step?.replace(/_/g, ' ') || '';
            const icon = update.status === 'completed' ? '✅' : 
                         update.status === 'failed' ? '❌' : 
                         update.status === 'running' ? '🔄' : '⏸️';
            
            addLog(`${icon} ${stepLabel}: ${update.message}`);
            
            if (update.status === 'running') {
              setCurrentStep(update.message);
              setStepProgress(prev => ({ ...prev, [update.step]: 'running' }));
            } else if (update.status === 'completed' || update.status === 'failed') {
              setStepProgress(prev => ({ ...prev, [update.step]: update.status }));
            }

            // Handle completion payload with files
            if (update.payload?.files && update.payload?.fileContents) {
              const fileList = update.payload.files as string[];
              const fileContents = update.payload.fileContents as Record<string, { content: string }>;
              const tree = buildFileTree(fileList, fileContents);
              setFiles(tree);
              addLog(`📁 Generated ${fileList.length} files`);
            }

            // Handle deployment URL
            if (update.payload?.deployUrl) {
              addLog(`🚀 Deployment ready: ${update.payload.deployUrl}`);
            }

            // Handle clarification questions
            if (update.payload?.questions) {
              const questions = update.payload.questions as string[];
              addLog('💬 Clarification needed:');
              questions.forEach((q: string) => addLog(`   • ${q}`));
            }

            // Handle errors
            if (update.payload?.errors) {
              const errors = update.payload.errors as Array<{ step: string; message: string }>;
              if (errors.length > 0) {
                addLog(`⚠️ ${errors.length} error(s) occurred`);
                errors.forEach((err: { step: string; message: string }) => {
                  addLog(`   ✗ [${err.step}] ${err.message}`);
                });
              }
            }

            // Update final status
            if (update.status === 'completed' || update.status === 'failed') {
              if (update.step === 'completion_notifier' || update.step === 'workflow') {
                setStatus(update.status === 'failed' ? 'failed' : 'completed');
                setCurrentStep('');
                addLog(update.status === 'completed' ? '✅ Workflow completed' : '❌ Workflow failed');
              }
            }
          } catch (parseErr) {
            // Skip malformed JSON
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        addLog('⏹️ Workflow cancelled');
        setStatus('idle');
      } else {
        setStatus('failed');
        setCurrentStep('');
        addLog(`❌ Error: ${error.message}`);
      }
    }
  };

  const handleNewProject = () => {
    setPrompt('');
    setStatus('idle');
    setCurrentStep('');
    setLogs([]);
    setFiles([]);
    setSelectedFile(null);
    setActiveProject(null);
    setRunId(null);
    setStepProgress({});
  };

  const handleSelectFile = (node: FileNode) => {
    if (node.type === 'file') {
      setSelectedFile(node);
    }
  };

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path}>
        <div
          className={`cursor-pointer hover:bg-gray-100 px-2 py-1 rounded text-sm select-none flex items-center gap-1 ${
            selectedFile?.path === node.path ? 'bg-blue-50 text-blue-700' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleSelectFile(node)}
        >
          <span>{node.type === 'folder' ? '📁' : '📄'}</span>
          <span>{node.name}</span>
        </div>
        {node.type === 'folder' && node.children && renderFileTree(node.children, depth + 1)}
      </div>
    ));
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'running': return '🟡 Running';
      case 'completed': return '🟢 Completed';
      case 'failed': return '🔴 Failed';
      case 'awaiting-input': return '💬 Needs Input';
      default: return '⚪ Idle';
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-white flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-lg">Projects</h2>
          <button
            onClick={handleNewProject}
            className="mt-2 w-full rounded bg-black px-3 py-2 text-sm text-white hover:bg-gray-800 transition-colors"
          >
            + New Project
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {projects.length === 0 && (
            <p className="text-sm text-gray-500 px-2">No projects yet.</p>
          )}
          {projects.map((project) => (
            <div
              key={project.id}
              className={`rounded px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 ${
                activeProject === project.id ? 'bg-gray-100' : ''
              }`}
              onClick={() => setActiveProject(project.id)}
            >
              <div className="font-medium truncate">{project.name}</div>
              <div className="text-xs text-gray-500">{project.updatedAt}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex">
        {/* Chat + Controls */}
        <section className="w-96 border-r bg-white flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-1">
              <h1 className="text-xl font-bold">App Builder</h1>
              <span className="text-xs px-2 py-1 rounded bg-gray-100">{getStatusBadge()}</span>
            </div>
            <p className="text-sm text-gray-600">Describe the app you want to build.</p>
          </div>

          <form onSubmit={handleSubmit} className="p-4 border-b space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your app, e.g. 'A task management app with user auth, projects, and a Kanban board view'"
              className="w-full h-32 rounded border p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={status === 'running'}
            />
            <button
              type="submit"
              className="w-full rounded bg-black px-3 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              disabled={status === 'running' || !prompt.trim()}
            >
              {status === 'running' ? (
                <>
                  <span className="animate-pulse">⚙️</span> Running...
                </>
              ) : (
                '🚀 Generate'
              )}
            </button>
            {status === 'running' && (
              <button
                type="button"
                onClick={() => { abortRef.current?.abort(); }}
                className="w-full rounded border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                ⏹ Cancel
              </button>
            )}
          </form>

          <div className="flex-1 overflow-auto p-4">
            {/* Step Progress */}
            {Object.keys(stepProgress).length > 0 && (
              <div className="mb-4">
                <h2 className="text-sm font-semibold mb-2">Progress</h2>
                <div className="space-y-1">
                  {Object.entries(stepProgress).map(([step, stepStatus]) => (
                    <div key={step} className="text-xs flex items-center gap-2">
                      <span>{stepStatus === 'completed' ? '✅' : stepStatus === 'failed' ? '❌' : '🔄'}</span>
                      <span className={stepStatus === 'running' ? 'font-medium text-blue-600' : ''}>
                        {step.replace(/_/g, ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <h2 className="text-sm font-semibold mb-2">Logs</h2>
            <div className="space-y-1 text-xs font-mono text-gray-700 max-h-96 overflow-auto">
              {logs.length === 0 && (
                <p className="text-gray-500 italic">No logs yet. Generate an app to see progress.</p>
              )}
              {logs.map((log, index) => (
                <div key={index} className="leading-relaxed">{log}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </section>

        {/* Workspace */}
        <section className="flex-1 flex flex-col">
          <header className="h-12 border-b bg-white flex items-center px-4 justify-between">
            <h2 className="font-semibold">Workspace</h2>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              {runId && <span className="text-xs text-gray-400">Run: {runId.slice(0, 8)}</span>}
              <span className="capitalize">{currentStep || getStatusBadge()}</span>
            </div>
          </header>

          <div className="flex-1 flex">
            {/* Files */}
            <div className="w-72 border-r bg-white overflow-auto p-2">
              <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
                Files ({files.length})
              </h3>
              {files.length === 0 && (
                <p className="text-sm text-gray-500 italic">No files generated yet.</p>
              )}
              {renderFileTree(files)}
            </div>

            {/* Editor / Preview */}
            <div className="flex-1 overflow-auto bg-white p-4">
              {selectedFile ? (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-semibold text-gray-700">{selectedFile.path}</span>
                    {selectedFile.content && (
                      <span className="text-xs text-gray-400">
                        {selectedFile.content.split('\n').length} lines
                      </span>
                    )}
                  </div>
                  <pre className="rounded border bg-gray-50 p-4 text-xs overflow-auto whitespace-pre-wrap font-mono leading-relaxed">
                    {selectedFile.content || '(empty)'}
                  </pre>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center">
                    <div className="text-4xl mb-2">📄</div>
                    <p className="text-sm">Select a file to preview its content</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
