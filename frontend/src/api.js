let csrfToken = '';

export function setCsrf(token) { csrfToken = token || ''; }

export async function api(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'GET' ? {} : { 'X-CSRF-Token': csrfToken }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  let result;
  try { result = await response.json(); }
  catch { result = { error: `The server returned an unreadable response (${response.status}).` }; }
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
      window.dispatchEvent(new Event('session-expired'));
    }
    const error = new Error(result.error || `Request failed (${response.status}).`);
    error.code = result.code;
    error.status = response.status;
    throw error;
  }
  if (result.csrfToken) setCsrf(result.csrfToken);
  return result;
}
