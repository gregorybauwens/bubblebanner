/**
 * When iframed on Framer, the parent script (public/framer-cursor-bridge.js)
 * sets pointer-events: none on the iframe so Framer's cursor keeps moving.
 * This file applies incoming pointer events from that parent.
 */

const MESSAGE_KEY = '__bubblebanner';

const dispatch = (type: string, x: number, y: number, button = 0, buttons = 0) => {
  const target = document.elementFromPoint(x, y) || document.body;
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button,
    buttons,
    view: window,
  });
  target.dispatchEvent(event);
};

export const startIframePointerBridge = () => {
  if (typeof window === 'undefined' || window.parent === window) return () => {};

  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data[MESSAGE_KEY] !== 1 || data.type !== 'input') return;
    if (typeof data.x !== 'number' || typeof data.y !== 'number') return;
    dispatch(data.event, data.x, data.y, data.button ?? 0, data.buttons ?? 0);
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
};
