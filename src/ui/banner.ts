// Full-width anime-style alert cards ("LAUNCH DETECTED" etc.).

export type BannerKind = 'alert' | 'sensor' | 'notice';

let hideTimer: number | undefined;

export function showBanner(title: string, sub: string, kind: BannerKind = 'alert') {
  const el = document.getElementById('banner');
  if (!el) return;
  el.className = `banner ${kind}`;
  el.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'banner-title';
  h.textContent = title;
  const s = document.createElement('div');
  s.className = 'banner-sub';
  s.textContent = sub;
  el.append(h, s);
  el.hidden = false;
  // Restart the entry animation.
  void el.offsetWidth;
  el.classList.add('show');
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.classList.remove('show');
    el.hidden = true;
  }, 3800);
}
