const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const TEST_ORG_ID = process.env.NEXT_PUBLIC_TEST_ORG_ID || 'test-org-1';

// TODO: Replace with real Supabase session mechanism once auth is implemented
// Currently using test header for local development — will use Supabase client session in Phase 4

export async function fetchWithAuth<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_URL}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Test-Org': TEST_ORG_ID,
  };

  if (options?.headers && typeof options.headers === 'object') {
    Object.assign(headers, options.headers);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function getTasks(limit = 20, offset = 0) {
  return fetchWithAuth(`/tasks?limit=${limit}&offset=${offset}`);
}

export async function createTask(intent: string, connectionId?: string) {
  return fetchWithAuth('/tasks', {
    method: 'POST',
    body: JSON.stringify({ intent, connection_id: connectionId }),
  });
}

export function subscribeToTaskEvents(
  taskId: string,
  onMessage: (_event: any) => void,
  onError?: (_error: Error) => void,
  onClose?: () => void
): () => void {
  const url = new URL(`${API_URL}/tasks/${taskId}/events`);
  url.searchParams.set('X-Test-Org', TEST_ORG_ID);

  const eventSource = new EventSource(url.toString());

  eventSource.onmessage = (messageEvent: MessageEvent<string>) => {
    try {
      const data = JSON.parse(messageEvent.data);
      onMessage(data);
    } catch (err) {
      onError?.(new Error(`Failed to parse event: ${err instanceof Error ? err.message : String(err)}`));
    }
  };

  eventSource.onerror = (_event: Event) => {
    onError?.(new Error('EventSource connection failed'));
    eventSource.close();
    onClose?.();
  };

  return () => eventSource.close();
}
