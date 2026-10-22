// Apply saved appearance before React renders to avoid a light flash.
(() => {
  let value = {};
  try { value = JSON.parse(localStorage.getItem('lexiday-preferences-v1') || '{}'); } catch { /* Use system. */ }
  const mode = ['light', 'dark'].includes(value.appearance) ? value.appearance : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.mode = mode;
  document.documentElement.style.colorScheme = mode;
  document.documentElement.dataset.palette = ['forest', 'ocean', 'violet', 'amber'].includes(value.palette) ? value.palette : 'forest';
})();
