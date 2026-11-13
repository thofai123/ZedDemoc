export const API_BASE = (import.meta.env.VITE_API_URL || 'https://zeddemoc.onrender.com/api').replace(/\/$/, '');

export async function apiRequest(path, options = {}, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error('Cannot reach ZedDemoc server. Check your internet connection or wait 30s for Render to wake up.');
  }

  const rawText = await response.text();
  let data = {};

  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`Server returned non-JSON response (HTTP ${response.status}).`);
    }
  }

  if (!response.ok) {
    throw new Error(data.error || `Server error (HTTP ${response.status}).`);
  }

  return data;
}

export function formatCountdown(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
