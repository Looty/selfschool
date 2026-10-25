---
id: l07
title: Exhaustiveness checks
sources: [3]
---
After this lesson you can make the compiler tell you when a new union member is not handled anywhere in your code.

## The problem

Discriminated unions grow. Someone adds a third shape, and every `switch` that handled the old two now silently returns `undefined` for the new one, or falls through to a default that does the wrong thing.

```ts
interface Circle { kind: "circle"; radius: number }
interface Square { kind: "square"; sideLength: number }
interface Triangle { kind: "triangle"; base: number; height: number }
type Shape = Circle | Square | Triangle;

function getArea(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "square":
      return shape.sideLength ** 2;
  }
}
```

With `strict` (specifically `strictNullChecks`) enabled, this already fails: "Function lacks ending return statement and return type does not include 'undefined'". But that error is incidental. It disappears if the function returns `void` or a type that allows `undefined`, so you want something that does not depend on it. [3]

## never and the exhaustive default

`never` is the type of values that cannot exist. After every member of a union has been narrowed away, the variable that remains has type `never`. Assigning it to a `never`-typed variable compiles only when nothing is left; if a case is missing, the leftover member is not assignable to `never` and you get an error at that line. [3]

```ts
function getArea(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "square":
      return shape.sideLength ** 2;
    default: {
      const _exhaustive: never = shape;
      //    ~~~~~~~~~~~ error: Type 'Triangle' is not assignable to type 'never'
      return _exhaustive;
    }
  }
}
```

Adding the `triangle` case makes the error go away, because `shape` in the default branch is then `never`.

## A reusable helper

Wrap the check in a function so the intent is obvious, and so the program fails loudly at runtime if bad data (for example from JSON) slips past the types:

```ts
function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

function getArea(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "square":
      return shape.sideLength ** 2;
    case "triangle":
      return (shape.base * shape.height) / 2;
    default:
      return assertNever(shape);
  }
}
```

The compile-time error catches missing cases when you edit the union; the runtime throw catches values that violate the types. Both matter, because types are erased and external data is not checked by the compiler.

## Where this pays off

- Reducers and state machines: every new action or state is flagged in every consumer.
- Rendering code: a UI component per variant of a message or event type.
- Serialization: a switch on a tagged union that must handle every variant.

## Limits

The check only works when the compiler can narrow the value down to `never`. If the discriminant is typed as plain `string`, or the data is `any`, there is nothing to exhaust. Exhaustiveness also does not exist at runtime by itself; only the thrown error in `assertNever` does.

:::key-takeaways
- After handling every union member, the remaining type is `never`.
- Assigning the leftover to a `never` variable turns a missing case into a compile error.
- A small `assertNever` helper also throws at runtime for data that breaks the types.
:::
