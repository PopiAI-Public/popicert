/**
 * Freno para el trabajo caro de la parte pública (generar PDF, verificar
 * firmas): como mucho `max` a la vez en todo el proceso, y el resto espera en
 * cola. Así, aunque alguien se salte el límite por IP (con muchas IPv6, por
 * ejemplo), no puede dejar sin CPU al resto de la app.
 */
export function createSemaphore(max: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= max) await new Promise<void>((resolve) => queue.push(resolve));
    running++;
    try {
      return await task();
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}

/** Caché LRU pequeña en memoria. */
export function createLru<V>(maxEntries: number) {
  const map = new Map<string, V>();
  return {
    get(key: string): V | undefined {
      const value = map.get(key);
      if (value !== undefined) {
        map.delete(key);
        map.set(key, value);
      }
      return value;
    },
    set(key: string, value: V): void {
      map.delete(key);
      map.set(key, value);
      while (map.size > maxEntries) map.delete(map.keys().next().value!);
    },
  };
}
