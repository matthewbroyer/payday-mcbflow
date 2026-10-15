/* Sets light/dark before the page paints. Always light unless the user chose dark (suite rule).
   Theme key: 'payday.theme'. */
(function () {
  var t = null;
  try { t = localStorage.getItem('payday.theme'); } catch (e) {}
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
})();
