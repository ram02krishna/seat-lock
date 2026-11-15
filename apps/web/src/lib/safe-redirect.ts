/**
 * Only allow same-site relative paths as post-login redirect targets.
 * Blocks protocol-relative, absolute, backslash-based, and control-character redirects.
 */
export function safeRedirect(target: string | null | undefined, fallback = '/'): string {
  if (!target) return fallback;

  const value = target.trim();
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, 'https://seatlock.invalid');
    if (parsed.origin !== 'https://seatlock.invalid') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
