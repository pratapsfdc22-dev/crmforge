'use client';

import { useParams } from 'next/navigation';
import { TaskDetail } from '@/components/task-detail';
import type { Task } from '@/lib/types';

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = params.id as string;

  // TODO: Fetch initial task state from API
  // For now, use minimal placeholder — TaskDetail will poll for actual state via SSE
  // Use a fixed timestamp (ISO epoch) so it doesn't change between server/client renders (hydration safety)
  const initialTask: Task = {
    id: taskId,
    org_id: 'test-org-1',
    user_id: 'test-user',
    intent: 'Loading task...',
    state: 'queued',
    steps: [],
    created_at: '2026-08-18T02:00:00.000Z',
  };

  return (
    <div className="p-8 max-w-4xl">
      <TaskDetail taskId={taskId} initialTask={initialTask} />
    </div>
  );
}
