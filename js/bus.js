export function createBus() {
  const listeners = new Map();

  function on(event, handler) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(handler);

    return () => {
      listeners.get(event)?.delete(handler);
    };
  }

  function emit(event, payload) {
    const handlers = listeners.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[bus] handler failed for "${event}"`, error);
      }
    }
  }

  function off(event, handler) {
    listeners.get(event)?.delete(handler);
  }

  function clear() {
    listeners.clear();
  }

  return {
    on,
    emit,
    off,
    clear,
  };
}
