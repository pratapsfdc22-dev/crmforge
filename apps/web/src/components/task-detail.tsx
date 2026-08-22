'use client';

import { useEffect, useState } from 'react';
import { subscribeToTaskEvents } from '@/lib/api';
import type { Task, SSEEvent, TaskState } from '@/lib/types';

const stateColors: Record<TaskState, string> = {
  queued: 'bg-slate-100 text-slate-800',
  planning: 'bg-blue-100 text-blue-800',
  awaiting_approval: 'bg-amber-100 text-amber-800',
  executing: 'bg-purple-100 text-purple-800',
  verifying: 'bg-cyan-100 text-cyan-800',
  succeeded: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const stepStatusColors: Record<string, string> = {
  pending: 'bg-slate-50 border-slate-200',
  in_progress: 'bg-blue-50 border-blue-200',
  completed: 'bg-green-50 border-green-200',
  failed: 'bg-red-50 border-red-200',
};

export function TaskDetail({ taskId, initialTask }: { taskId: string; initialTask: Task }) {
  const [task, setTask] = useState<Task>(initialTask);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Format timestamps only after hydration to prevent server/client mismatch
  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    // SSE connection with reconnect logic for timeout events
    let unsubscribe: (() => void) | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    const connect = () => {
      // Close any existing connection before creating a new one
      unsubscribe?.();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);

      setIsConnecting(true);
      setError(null);

      unsubscribe = subscribeToTaskEvents(
        taskId,
        (event: SSEEvent) => {
          if (!isMounted) return;
          setLastEventTime(new Date());

          switch (event.type) {
            case 'connected':
              setIsConnecting(false);
              break;

            case 'state_change':
              setTask((prev) => ({
                ...prev,
                state: event.state || prev.state,
                plan: event.plan || prev.plan,
                steps: event.steps || prev.steps,
                error: event.error,
              }));
              break;

            case 'step_update':
              if (event.step) {
                setTask((prev) => {
                  const steps = [...prev.steps];
                  steps[event.step!.step_index] = event.step!;
                  return { ...prev, steps };
                });
              }
              break;

            case 'completed':
              setTask((prev) => ({
                ...prev,
                state: event.finalState || prev.state,
                error: event.error,
                completed_at: new Date().toISOString(),
              }));
              setIsConnecting(false);
              break;

            case 'timeout':
              // Server closed connection after 60s — reconnect automatically
              setError('Connection timeout (60s). Reconnecting...');
              if (isMounted) {
                reconnectTimeout = setTimeout(() => {
                  if (isMounted) connect();
                }, 500);
              }
              break;

            case 'error':
              setError(event.message || 'An error occurred');
              setIsConnecting(false);
              break;
          }
        },
        (err) => {
          if (!isMounted) return;
          setError(err.message);
          setIsConnecting(false);
        },
        () => {
          // Connection closed — only reconnect if task isn't finished
          if (!isMounted) return;
          if (task.state !== 'succeeded' && task.state !== 'failed') {
            reconnectTimeout = setTimeout(() => {
              if (isMounted) connect();
            }, 1000);
          }
        }
      );
    };

    // Initiate connection
    connect();

    return () => {
      isMounted = false;
      unsubscribe?.();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [taskId]);

  const stateLabel = task.state.replace(/_/g, ' ').charAt(0).toUpperCase() + task.state.slice(1).replace(/_/g, ' ');
  const isRunning = task.state !== 'succeeded' && task.state !== 'failed';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Task {task.id.slice(0, 8)}</h1>
            <p className="text-muted-foreground mt-1">{task.intent}</p>
          </div>
          <div className="flex items-center gap-3">
            {isConnecting && (
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <div className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                Listening for updates...
              </div>
            )}
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${stateColors[task.state]}`}>
              {stateLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* Plan section */}
      {task.plan && (
        <div className="space-y-3">
          <h2 className="font-semibold">Plan</h2>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-sm mb-3">{task.plan.summary}</p>
            {task.plan.rationale && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Rationale:</span> {task.plan.rationale}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Steps execution timeline */}
      <div className="space-y-3">
        <h2 className="font-semibold">Execution Timeline</h2>
        {task.steps && task.steps.length > 0 ? (
          <div className="space-y-2">
            {task.steps.map((step) => (
              <div
                key={step.step_index}
                className={`p-4 rounded-lg border-2 transition-colors ${stepStatusColors[step.status]}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{step.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-white/50">Step {step.step_index + 1}</span>
                    </div>
                    {step.description && (
                      <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
                    )}
                    {step.error && (
                      <p className="text-xs text-red-600 mt-2">Error: {step.error}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                    {step.status === 'in_progress' && (
                      <div className="inline-flex items-center gap-1 text-blue-600">
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
                        Running
                      </div>
                    )}
                    {step.status === 'completed' && step.completed_at && (
                      <div>
                        Done at {new Date(step.completed_at).toLocaleTimeString()}
                      </div>
                    )}
                    {step.status === 'failed' && (
                      <div className="text-red-600">Failed</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm text-muted-foreground">
            {isRunning ? 'Steps will appear as execution begins...' : 'No steps recorded'}
          </div>
        )}
      </div>

      {/* Result summary */}
      {task.state === 'succeeded' && (
        <div className="p-4 rounded-lg bg-green-50 border border-green-200">
          <h3 className="font-semibold text-green-900 mb-2">Completed Successfully</h3>
          <p className="text-sm text-green-800">
            Task finished at{' '}
            {hydrated && task.completed_at ? new Date(task.completed_at).toLocaleString() : '—'}
          </p>
        </div>
      )}

      {task.state === 'failed' && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <h3 className="font-semibold text-red-900 mb-2">Failed</h3>
          {task.error && (
            <p className="text-sm text-red-800">{task.error}</p>
          )}
        </div>
      )}

      {/* Metadata */}
      <div className="text-xs text-muted-foreground space-y-1 p-4 rounded-lg bg-slate-50">
        <div>Created: {hydrated ? new Date(task.created_at).toLocaleString() : '—'}</div>
        {task.started_at && (
          <div>Started: {hydrated ? new Date(task.started_at).toLocaleString() : '—'}</div>
        )}
        {task.completed_at && (
          <div>Completed: {hydrated ? new Date(task.completed_at).toLocaleString() : '—'}</div>
        )}
        {lastEventTime && (
          <div>Last update: {hydrated ? lastEventTime.toLocaleTimeString() : '—'}</div>
        )}
      </div>
    </div>
  );
}
