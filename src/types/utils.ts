export type DeepImmutable<T> =
  T extends (...args: any[]) => any
    ? T
    : T extends Array<infer U>
      ? ReadonlyArray<DeepImmutable<U>>
      : T extends object
        ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
        : T

export type Permutations<T extends string, U extends string = T> = [T] extends [never]
  ? never
  : T extends string
    ? T | `${T}.${Permutations<Exclude<U, T>>}`
    : never
