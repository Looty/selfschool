/** Only `promisify` for node-style callbacks; the api uses it once, on execFile, which is stubbed to throw. */
export const promisify =
  <A extends unknown[], R>(fn: (...args: [...A, (err: Error | null, result: R) => void]) => void) =>
  (...args: A) =>
    new Promise<R>((resolve, reject) => fn(...args, (err, result) => (err ? reject(err) : resolve(result))));
