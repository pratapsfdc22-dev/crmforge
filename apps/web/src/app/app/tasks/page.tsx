'use client';

import { useEffect, useState } from 'react';
import { getTasks, createTask } from '@/lib/api';
import type { Task } from '@/lib/types';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

const stateColors: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-800',
  planning: 'bg-blue-100 text-blue-800',
  awaiting_approval: 'bg-amber-100 text-amber-800',
  executing: 'bg-purple-100 text-purple-800',
  verifying: 'bg-cyan-100 text-cyan-800',
  succeeded: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

export default function TasksListPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [intentInput, setIntentInput] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        setLoading(true);
        const response = await getTasks(20, 0);
        if (response && typeof response === 'object' && 'tasks' in response) {
          setTasks((response as any).tasks || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks');
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, []);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intentInput.trim()) return;

    try {
      setCreating(true);
      await createTask(intentInput);
      setIntentInput('');
      setShowNewModal(false);
      // Refresh list
      const refreshed = await getTasks(20, 0);
      if (refreshed && typeof refreshed === 'object' && 'tasks' in refreshed) {
        setTasks((refreshed as any).tasks || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const stateLabel = (state: string) =>
    state
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Tasks</h1>
        <Button onClick={() => setShowNewModal(true)}>New Task</Button>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-lg bg-slate-100 animate-pulse border border-slate-200"
            />
          ))}
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="p-8 rounded-lg bg-slate-50 border border-slate-200 text-center text-muted-foreground">
          <p>No tasks yet</p>
          <p className="text-sm mt-1">Create one to get started</p>
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="space-y-2">
          {tasks.map((task) => (
            <Link
              key={task.id}
              href={`/app/tasks/${task.id}`}
              className="block p-4 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium truncate">{task.intent}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${stateColors[task.state]}`}>
                      {stateLabel(task.state)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {task.steps && task.steps.length > 0 && `${task.steps.length} step${task.steps.length !== 1 ? 's' : ''}`}
                    {task.steps && task.steps.length > 0 && ' • '}
                    Created {new Date(task.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                  {task.completed_at && new Date(task.completed_at).toLocaleTimeString()}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* New Task Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Create New Task</h2>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Task Description</label>
                <textarea
                  value={intentInput}
                  onChange={(e) => setIntentInput(e.target.value)}
                  placeholder="What should the AI do?"
                  className="w-full px-3 py-2 border rounded-md resize-none h-24"
                  disabled={creating}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewModal(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={creating || !intentInput.trim()}>
                  {creating ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
