export function isLikelyUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function hostMatches(url: string, hosts: string[]): boolean {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}
