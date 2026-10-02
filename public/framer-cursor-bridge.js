/**
 * Framer: Site Settings → Custom Code → End of <body>
 *   <script src="https://bubblebanner.vercel.app/framer-cursor-bridge.js"></script>
 *
 * Then Publish the site (the editor canvas does not run this script).
 *
 * Makes bubblebanner iframes ignore the pointer so Framer keeps receiving
 * real mouse events (and its custom cursor keeps moving). Clicks and
 * drags are forwarded into the iframe.
 */
(function () {
  if (window.__bbCursorBridge) return;
  window.__bbCursorBridge = true;

  function bannerFrames() {
    return Array.prototype.filter.call(document.getElementsByTagName('iframe'), function (frame) {
      return /bubblebanner\.vercel\.app/i.test(frame.src || '');
    });
  }

  function frameAt(x, y) {
    var frames = bannerFrames();
    for (var i = 0; i < frames.length; i++) {
      var rect = frames[i].getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return frames[i];
      }
    }
    return null;
  }

  function punchThrough() {
    bannerFrames().forEach(function (frame) {
      frame.style.setProperty('pointer-events', 'none', 'important');
    });
  }

  function send(frame, type, event) {
    if (!frame || !frame.contentWindow) return;
    var rect = frame.getBoundingClientRect();
    frame.contentWindow.postMessage(
      {
        __bubblebanner: 1,
        type: 'input',
        event: type,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        button: event.button,
        buttons: event.buttons,
      },
      '*'
    );
  }

  var active = null;

  function onMove(event) {
    if (!event.isTrusted) return;
    punchThrough();
    var frame = frameAt(event.clientX, event.clientY);
    if (active && active !== frame) send(active, 'pointerleave', event);
    if (frame) send(frame, 'pointermove', event);
    active = frame;
  }

  function onDown(event) {
    if (!event.isTrusted) return;
    var frame = frameAt(event.clientX, event.clientY);
    if (!frame) return;
    active = frame;
    send(frame, 'pointerdown', event);
  }

  function onUp(event) {
    if (!event.isTrusted) return;
    if (active) send(active, 'pointerup', event);
  }

  function onCancel(event) {
    if (active) send(active, 'pointercancel', event);
  }

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  setInterval(punchThrough, 1000);
  punchThrough();
})();
