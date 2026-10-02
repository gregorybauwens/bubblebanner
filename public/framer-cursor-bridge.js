/**
 * Paste into Framer: Site Settings → Custom Code → End of <body>
 *   <script src="https://bubblebanner.vercel.app/framer-cursor-bridge.js"></script>
 *
 * Keeps Framer's custom cursor moving while the pointer is over the
 * bubblebanner iframe.
 */
(function () {
  if (window.__bbCursorBridge) return;
  window.__bbCursorBridge = true;

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.__bubblebanner !== 1 || data.type !== 'pointer') return;

    var frames = document.getElementsByTagName('iframe');
    var iframe = null;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === event.source) {
        iframe = frames[i];
        break;
      }
    }
    if (!iframe) return;

    var rect = iframe.getBoundingClientRect();
    var x = rect.left + data.x;
    var y = rect.top + data.y;
    var opts = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      view: window,
    };

    window.dispatchEvent(new PointerEvent('pointermove', opts));
    window.dispatchEvent(new MouseEvent('mousemove', opts));
  });
})();
