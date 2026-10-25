# Narrowing cheatsheet

| Check | Narrows | Example |
|---|---|---|
| `typeof x === "string"` | primitives | `string \| number` to `string` |
| `x` (truthiness) | removes `null`, `undefined`, `0`, `""` | `string \| null` to `string` |
| `x === y` | to the overlapping type | `string \| number` and `string \| boolean` to `string` |
| `"swim" in x` | by property name | `Fish \| Bird` to `Fish` |
| `x instanceof Date` | class instances | `Date \| string` to `Date` |
| `x.kind === "circle"` | discriminated unions | `Shape` to `Circle` |
| `isFish(x)` with `x is Fish` | anything you can test | user-defined type guard |
| `const _: never = x` | proves a union is exhausted | exhaustiveness check |

Source: TypeScript Handbook, Narrowing. https://www.typescriptlang.org/docs/handbook/2/narrowing.html
