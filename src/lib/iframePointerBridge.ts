/**
 * When the banner is iframed (Framer, portfolio), the parent page loses
 * pointer events and its custom cursor freezes at the iframe edge.
 *
 * This hides the iframe's own cursor and streams pointer coordinates to
 * the parent. Pair with public/framer-cursor-bridge.js on the Framer site.
 */

const MESSAGE_KEY = '__bubblebanner';

export const startIframePointerBridge = () => {
  if (typeof window === 'undefined' || window.parent === window) return () => {};

  document.documentElement.classList.add('bb-in-iframe');
  const style = document.createElement('style');
  style.textContent =
    'html.bb-in-iframe, html.bb-in-iframe body, html.bb-in-iframe * { cursor: none !important; }';
  document.head.appendChild(style);

  const send = (type: 'pointer' | 'leave', event: PointerEvent) => {
    window.parent.postMessage(
      { [MESSAGE_KEY]: 1, type, x: event.clientX, y: event.clientY },
      '*'
    );
  };

  const onMove = (event: PointerEvent) => send('pointer', event);
  const onLeave = (event: PointerEvent) => send('leave', event);

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerleave', onLeave, { passive: true });

  return () => {
    document.documentElement.classList.remove('bb-in-iframe');
    style.remove();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerleave', onLeave);
  };
};
