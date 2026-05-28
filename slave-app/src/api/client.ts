export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const pwd = localStorage.getItem('slaveapp_pwd') ?? ''
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-app-password': pwd,
      ...(options?.headers ?? {}),
    },
  })

  if (res.status === 401) {
    localStorage.removeItem('slaveapp_pwd')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = `HTTP ${res.status}`
    try {
      const body = JSON.parse(text) as Record<string, unknown>
      if (body.error) message = String(body.error)
    } catch {
      if (text) message += `: ${text.slice(0, 300)}`
    }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}
