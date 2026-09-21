import type { Observable } from 'rxjs';

/** Resolve with the first `count` values from `obs$`, or reject after `timeoutMs`. */
export function collect<T>(obs$: Observable<T>, count: number, timeoutMs = 2000): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const values: T[] = [];
    if (count === 0) {
      resolve(values);
      return;
    }
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error(`collect(): timed out after ${timeoutMs}ms with ${values.length}/${count}`));
    }, timeoutMs);
    const sub = obs$.subscribe({
      next: (v) => {
        values.push(v);
        if (values.length >= count) {
          clearTimeout(timer);
          sub.unsubscribe();
          resolve(values);
        }
      },
      error: (err) => {
        clearTimeout(timer);
        reject(err);
      },
      complete: () => {
        clearTimeout(timer);
        resolve(values);
      },
    });
  });
}
