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
  fileCount?: number;
  status?: string;
}

const STEPS = [
  { id: 'spec_analyzer', label: 'Spec' },
  { id: 'clarification_gate', label: 'Clarify' },
  { id: 'stack_planner', label: 'Plan' },
  { id: 'repo_scaffolder', label: 'Generate' },
  { id: 'dependency_resolver', label: 'Deps' },
  { id: 'validator', label: 'Validate' },
  { id: 'repair_agent', label: 'Repair' },
  { id: 'security_gate', label: 'Security' },
  { id: 'deploy_agent', label: 'Deploy' },
  { id: 'completion_notifier', label: 'Done' },
];

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'tsx' || ext === 'jsx') return '⚛';
  if (ext === 'ts' || ext === 'js') return '𝒋';
  if (ext === 'css') return '🎨';
  if (ext === 'json') return '{}';
  if (ext === 'md') return '📝';
  if (ext === 'prisma') return '🗄';
  if (name.startsWith('.env')) return '🔑';
  return '📄';
}

function FileTreeNode({
  node, depth, selected, onSelect,
}: {
  node: FileNode; depth: number; selected: string | null; onSelect: (n: FileNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isFolder = node.type === 'folder';
  const isSelected = selected === node.path;

  return (
    <div>
      <div
        onClick={() => { if (isFolder) setOpen(o => !o); else onSelect(node); }}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        className={`flex items-center gap-1.5 py-[3px] pr-2 rounded-md cursor-pointer text-[13px] select-none transition-colors ${
          isSelected
            ? 'bg-indigo-100 text-indigo-700 font-medium'
            : 'hover:bg-slate-100 text-slate-600'
        }`}
      >
        <span className="text-[10px] w-3 text-slate-400">{isFolder ? (open ? '▾' : '▸') : ''}</span>
        <span className="text-[13px]">{isFolder ? '📁' : getFileIcon(node.name)}</span>
        <span className="truncate">{node.name}</span>
      </div>
      {isFolder && open && node.children?.map(child => (
        <FileTreeNode key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}

export default function Home() {
  const [dark, setDark] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [currentStep, setCurrentStep] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [stepProgress, setStepProgress] = useState<Record<string, string>>({});
  const [totalFiles, setTotalFiles] = useState(0);
  const [activeTab, setActiveTab] = useState<'logs' | 'files'>('logs');
  const [clarificationQs, setClarificationQs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // theme tokens
  const t = dark ? {
    bg: 'bg-zinc-900', surface: 'bg-zinc-800', border: 'border-zinc-700',
    text: 'text-zinc-100', muted: 'text-zinc-400', faint: 'text-zinc-600',
    input: 'bg-zinc-800 border-zinc-600 text-zinc-100 placeholder-zinc-500',
    hover: 'hover:bg-zinc-700', selected: 'bg-indigo-900 text-indigo-300',
    tag: 'bg-zinc-700 text-zinc-300', logbg: 'bg-zinc-900',
    codebg: 'bg-zinc-800', codebar: 'bg-zinc-750 border-zinc-700 text-zinc-400',
  } : {
    bg: 'bg-slate-50', surface: 'bg-white', border: 'border-slate-200',
    text: 'text-slate-800', muted: 'text-slate-500', faint: 'text-slate-400',
    input: 'bg-white border-slate-300 text-slate-800 placeholder-slate-400',
    hover: 'hover:bg-slate-50', selected: 'bg-indigo-50 text-indigo-700',
    tag: 'bg-slate-100 text-slate-600', logbg: 'bg-slate-50',
    codebg: 'bg-slate-50', codebar: 'bg-white border-slate-200 text-slate-500',
  };

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const buildFileTree = (paths: string[], contents: Record<string, { content: string }>): FileNode[] => {
    const root: FileNode[] = [];
    for (const p of paths.sort()) {
      const parts = p.split('/');
      let cur = root;
      let curPath = '';
      parts.forEach((part, i) => {
        curPath = curPath ? `${curPath}/${part}` : part;
        if (i === parts.length - 1) {
          cur.push({ name: part, path: curPath, type: 'file', content: contents[curPath]?.content || '' });
        } else {
          let folder = cur.find(n => n.name === part && n.type === 'folder');
          if (!folder) { folder = { name: part, path: curPath, type: 'folder', children: [] }; cur.push(folder); }
          cur = folder.children!;
        }
      });
    }
    return root;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || status === 'running') return;
    setStatus('running'); setCurrentStep('Starting...'); setLogs([]); setFiles([]);
    setSelectedFile(null); setStepProgress({}); setTotalFiles(0); setClarificationQs([]);
    setActiveTab('logs');
    addLog('🚀 Starting workflow...');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const u: StepUpdate = JSON.parse(raw);
            if (u.runId) setRunId(u.runId);
            const icon = u.status === 'completed' ? '✅' : u.status === 'failed' ? '❌' : u.status === 'running' ? '⚙️' : '⏸';
            addLog(`${icon} ${u.step?.replace(/_/g, ' ')}: ${u.message}`);
            if (u.status === 'running') { setCurrentStep(u.message); setStepProgress(p => ({ ...p, [u.step]: 'running' })); }
            else if (['completed','failed','skipped'].includes(u.status)) setStepProgress(p => ({ ...p, [u.step]: u.status }));
            if (u.step === 'clarification_gate' && (u.payload?.questions as string[])?.length) setClarificationQs(u.payload!.questions as string[]);
            if (u.step === 'completion_notifier' && u.payload) {
              const p = u.payload as Record<string, unknown>;
              const fc = p.fileContents as Record<string, { content: string }> || {};
              const fn = p.files as string[] || Object.keys(fc);
              setTotalFiles(fn.length);
              if (fn.length) { setFiles(buildFileTree(fn, fc)); setActiveTab('files'); }
              setStatus(u.status === 'failed' ? 'failed' : 'completed');
              setProjects(prev => [{
                id: p.runId as string || crypto.randomUUID(),
                name: prompt.slice(0, 45) + (prompt.length > 45 ? '…' : ''),
                updatedAt: new Date().toLocaleString(),
                fileCount: fn.length,
                status: u.status === 'failed' ? 'failed' : 'completed',
              }, ...prev.slice(0, 19)]);
            }
          } catch { /* skip malformed */ }
        }
      }
      if (status === 'running') setStatus('completed');
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name !== 'AbortError') { addLog(`❌ ${e.message}`); setStatus('failed'); }
      else { addLog('⏹ Cancelled'); setStatus('idle'); }
    }
  };

  const reset = () => {
    setPrompt(''); setStatus('idle'); setCurrentStep(''); setLogs([]); setFiles([]);
    setSelectedFile(null); setActiveProject(null); setRunId(null); setStepProgress({});
    setTotalFiles(0); setClarificationQs([]);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const statusLabel = { idle: 'Ready', running: currentStep || 'Running…', completed: `Done · ${totalFiles} files`, failed: 'Failed', 'awaiting-input': 'Needs input' }[status];
  const statusDot = { idle: 'bg-slate-400', running: 'bg-amber-400 animate-pulse', completed: 'bg-emerald-500', failed: 'bg-red-500', 'awaiting-input': 'bg-blue-400 animate-pulse' }[status];

  return (
    <div className={`flex h-screen font-[Inter,sans-serif] ${t.bg} ${t.text} overflow-hidden transition-colors duration-200`}>

      {/* ── Sidebar ── */}
      <aside className={`w-56 flex-shrink-0 ${t.surface} border-r ${t.border} flex flex-col`}>
        <div className={`p-4 border-b ${t.border} flex items-center gap-2`}>
          <span className="text-xl">⚡</span>
          <span className="font-semibold text-[15px] tracking-tight">App Builder</span>
        </div>
        <div className={`p-3 border-b ${t.border}`}>
          <button
            onClick={reset}
            className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 px-3 py-2 text-[13px] font-semibold text-white transition-colors"
          >
            + New project
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {projects.length === 0 && (
            <p className={`text-[12px] ${t.faint} text-center px-2 pt-4`}>No projects yet.</p>
          )}
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => setActiveProject(p.id)}
              className={`rounded-lg px-3 py-2 cursor-pointer transition-colors text-[12px] ${
                activeProject === p.id ? `${t.selected} font-medium` : `${t.hover} ${t.muted}`
              }`}
            >
              <div className={`font-medium truncate ${t.text}`}>{p.name}</div>
              <div className={`flex items-center gap-1.5 mt-0.5 ${t.faint}`}>
                <span className={p.status === 'failed' ? 'text-red-400' : 'text-emerald-500'}>●</span>
                <span>{p.fileCount} files · {p.updatedAt}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Theme toggle */}
        <div className={`p-3 border-t ${t.border}`}>
          <button
            onClick={() => setDark(d => !d)}
            className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-[12px] ${t.tag} transition-colors ${t.hover}`}
          >
            <span>{dark ? '☀️ Light mode' : '🌙 Dark mode'}</span>
            <span className={`w-8 h-4 rounded-full transition-colors ${dark ? 'bg-indigo-500' : 'bg-slate-300'} relative`}>
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${dark ? 'left-4' : 'left-0.5'}`} />
            </span>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className={`flex items-center justify-between px-5 py-3 border-b ${t.border} ${t.surface} flex-shrink-0`}>
          <div className="flex items-center gap-2.5">
            <span className={`w-2 h-2 rounded-full ${statusDot}`} />
            <span className={`text-[13px] font-medium ${t.text}`}>{statusLabel}</span>
            {runId && <span className={`text-[11px] font-mono ${t.faint} hidden sm:block`}>#{runId.slice(0, 8)}</span>}
          </div>
          {totalFiles > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('logs')}
                className={`text-[12px] px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  activeTab === 'logs' ? 'bg-indigo-600 text-white' : `${t.tag} ${t.hover}`
                }`}
              >📋 Logs</button>
              <button
                onClick={() => setActiveTab('files')}
                className={`text-[12px] px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  activeTab === 'files' ? 'bg-indigo-600 text-white' : `${t.tag} ${t.hover}`
                }`}
              >📁 Files ({totalFiles})</button>
            </div>
          )}
        </header>

        {/* Prompt */}
        <div className={`px-5 py-4 border-b ${t.border} ${t.surface} flex-shrink-0`}>
          <form onSubmit={handleSubmit} className="flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); } }}
              placeholder="Describe the app you want to build…  (⌘↵ to generate)"
              rows={3}
              disabled={status === 'running'}
              className={`flex-1 rounded-xl border px-4 py-3 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-shadow ${t.input}`}
            />
            <div className="flex flex-col gap-2">
              <button
                type="submit"
                disabled={status === 'running' || !prompt.trim()}
                className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 text-white text-[13px] font-semibold transition-colors whitespace-nowrap"
              >
                {status === 'running' ? '⚙️ Running…' : '🚀 Generate'}
              </button>
              {status === 'running' && (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="px-5 py-2 rounded-xl border border-red-300 text-red-500 hover:bg-red-50 text-[13px] transition-colors"
                >
                  ⏹ Stop
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Clarification */}
        {clarificationQs.length > 0 && status === 'awaiting-input' && (
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-200 flex-shrink-0">
            <p className="text-[12px] font-semibold text-blue-600 mb-1.5">💬 A bit more info needed:</p>
            <ul className="space-y-1">{clarificationQs.map((q, i) => <li key={i} className="text-[12px] text-blue-700">• {q}</li>)}</ul>
            <p className="text-[11px] text-blue-400 mt-2">Update your prompt above, then generate again.</p>
          </div>
        )}

        {/* Step pills */}
        {Object.keys(stepProgress).length > 0 && (
          <div className={`px-5 py-2.5 border-b ${t.border} ${t.surface} flex-shrink-0`}>
            <div className="flex gap-1.5 flex-wrap">
              {STEPS.map(s => {
                const st = stepProgress[s.id];
                const cls = !st
                  ? `${t.tag} opacity-50`
                  : st === 'running' ? 'bg-amber-100 text-amber-700 animate-pulse'
                  : st === 'completed' ? 'bg-emerald-100 text-emerald-700'
                  : st === 'skipped' ? `${t.tag} opacity-60`
                  : 'bg-red-100 text-red-600';
                const dot = !st ? '·' : st === 'running' ? '…' : st === 'completed' ? '✓' : st === 'skipped' ? '–' : '✗';
                return (
                  <span key={s.id} className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${cls}`}>
                    {dot} {s.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'logs' || files.length === 0 ? (
            <div className={`h-full overflow-y-auto p-5 font-mono text-[12px] leading-relaxed ${t.logbg}`}>
              {logs.length === 0 && status === 'idle' ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="text-5xl mb-4">⚡</div>
                  <p className={`${t.text} text-[15px] font-medium font-[Inter,sans-serif]`}>Describe your app above</p>
                  <p className={`${t.faint} text-[13px] mt-1 font-[Inter,sans-serif]`}>The AI will plan, build, validate and package your full-stack app.</p>
                </div>
              ) : logs.map((log, i) => (
                <div key={i} className={`
                  ${log.includes('✅') || log.includes('🟢') ? 'text-emerald-600' : ''}
                  ${log.includes('❌') || log.includes('🔴') ? 'text-red-500' : ''}
                  ${log.includes('⚙️') ? 'text-amber-600' : ''}
                  ${log.includes('🚀') ? 'text-indigo-600 font-medium' : ''}
                  ${!log.match(/[✅❌⚙️🚀]/) ? t.muted : ''}
                `}>{log}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          ) : (
            <div className="h-full flex">
              {/* File tree */}
              <div className={`w-52 flex-shrink-0 border-r ${t.border} ${t.surface} overflow-y-auto py-2`}>
                {files.map(node => (
                  <FileTreeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    selected={selectedFile?.path || null}
                    onSelect={setSelectedFile}
                  />
                ))}
              </div>
              {/* Code preview */}
              <div className={`flex-1 overflow-auto ${t.codebg}`}>
                {selectedFile ? (
                  <>
                    <div className={`flex items-center justify-between px-4 py-2 border-b ${t.codebar} sticky top-0`}>
                      <span className="text-[12px] font-mono font-medium">{selectedFile.path}</span>
                      <span className="text-[11px] uppercase tracking-wide opacity-60">{selectedFile.name.split('.').pop()}</span>
                    </div>
                    <pre className={`p-4 text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-words ${t.muted}`}>{selectedFile.content || '(empty)'}</pre>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className={`text-[13px] ${t.faint}`}>← Select a file to preview</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
