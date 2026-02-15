const TAP_MAX_DURATION_MS = 280;
const TAP_MAX_DISTANCE_PX = 10;

function toPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const clientX = event.clientX;
  const clientY = event.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

/**
 * Normalized pointer/touch helper.
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   onPointerDown?: Function,
 *   onPointerMove?: Function,
 *   onPointerUp?: Function,
 *   onTap?: Function,
 * }} handlers
 * @returns {Function} cleanup
 */
export function addPointerHandlers(canvas, handlers = {}) {
  if (!canvas) {
    return () => {};
  }

  const {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onTap,
  } = handlers;

  let activePointerId = null;
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let moved = false;

  const handlePointerDown = (event) => {
    activePointerId = event.pointerId;

    const point = toPoint(canvas, event);
    downX = point.x;
    downY = point.y;
    downAt = performance.now();
    moved = false;

    if (typeof canvas.setPointerCapture === 'function') {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignore capture errors from unsupported edge cases.
      }
    }

    if (typeof onPointerDown === 'function') {
      onPointerDown(point.x, point.y, event);
    }
  };

  const handlePointerMove = (event) => {
    const point = toPoint(canvas, event);

    if (activePointerId === event.pointerId) {
      if (!moved) {
        const dx = point.x - downX;
        const dy = point.y - downY;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > TAP_MAX_DISTANCE_PX * TAP_MAX_DISTANCE_PX) {
          moved = true;
        }
      }

      if (typeof onPointerMove === 'function') {
        onPointerMove(point.x, point.y, event);
      }
      return;
    }

    // Allow hover move for mouse when no pointer is actively pressed.
    if (activePointerId === null && event.pointerType === 'mouse' && typeof onPointerMove === 'function') {
      onPointerMove(point.x, point.y, event);
    }
  };

  const handlePointerUp = (event) => {
    if (activePointerId !== event.pointerId) {
      return;
    }

    const point = toPoint(canvas, event);
    const elapsed = performance.now() - downAt;

    if (typeof onPointerUp === 'function') {
      onPointerUp(point.x, point.y, event);
    }

    if (!moved && elapsed <= TAP_MAX_DURATION_MS && typeof onTap === 'function') {
      onTap(point.x, point.y, event);
    }

    if (typeof canvas.releasePointerCapture === 'function') {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Ignore release failures.
      }
    }

    activePointerId = null;
  };

  const handlePointerCancel = (event) => {
    if (activePointerId === event.pointerId) {
      activePointerId = null;
    }
  };

  canvas.addEventListener('pointerdown', handlePointerDown, { passive: true });
  canvas.addEventListener('pointermove', handlePointerMove, { passive: true });
  canvas.addEventListener('pointerup', handlePointerUp, { passive: true });
  canvas.addEventListener('pointercancel', handlePointerCancel, { passive: true });

  return () => {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerCancel);
  };
}
