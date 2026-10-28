/** Show navigation feedback for redirects started by client-side actions. */
export function navigateToPage(url: string) {
  window.dispatchEvent(new Event("aicuber:page-navigation"));
  window.location.assign(url);
}
