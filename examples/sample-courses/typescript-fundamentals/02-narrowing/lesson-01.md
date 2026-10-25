---
id: l04
title: Narrowing with typeof
resources: [../resources/narrowing-cheatsheet.md]
sources: [2, 3]
---
After this lesson you can use `typeof` checks to make the compiler treat a union-typed value as one specific type inside a branch.

## Why narrowing exists

A union type such as `string | number` says a value is one of several types, but at any given line you usually know more than that. TypeScript analyzes the control flow of your code and refines ("narrows") the type of a variable after checks you already write, such as `if` statements. [3]

```ts
function padLeft(padding: number | string, input: string): string {
  if (typeof padding === "number") {
    return " ".repeat(padding) + input; // padding: number
  }
  return padding + input; // padding: string
}
```

Without the check, `" ".repeat(padding)` is an error, because `string` is not assignable to a `number` parameter. Inside the `if` body the compiler knows `padding` is a `number`; after the `if` returns, the only remaining member of the union is `string`. [3]

## What typeof returns

In JavaScript, `typeof` produces one of a fixed set of strings: `"string"`, `"number"`, `"bigint"`, `"boolean"`, `"symbol"`, `"undefined"`, `"object"` and `"function"`. TypeScript understands comparisons against these strings as type guards. [3]

```ts
function describe(value: string | number | boolean | undefined): string {
  if (typeof value === "string") return `text of length ${value.length}`;
  if (typeof value === "number") return `number ${value.toFixed(1)}`;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return "nothing"; // value: undefined
}
```

Each check removes one member from the union for the rest of the function, so the last line sees only `undefined`. Compare with the list of primitive types in the handbook's everyday types page. [2] A one-page summary of the narrowing forms in this chapter is in the [narrowing cheatsheet](../resources/narrowing-cheatsheet.md).

## The null trap

`typeof null` is `"object"` in JavaScript, a historical quirk. TypeScript models it: checking `typeof x === "object"` narrows a `string[] | null` value to `string[] | null`, not to `string[]`. The compiler will then warn you when you iterate a possibly-null value. [3]

```ts
function printAll(strs: string | string[] | null) {
  if (typeof strs === "object") {
    for (const s of strs) {
      //                ~~~~ error: 'strs' is possibly 'null'
      console.log(s);
    }
  } else if (typeof strs === "string") {
    console.log(strs);
  }
}
```

## Truthiness as a guard

Conditions, `&&`, `||` and `!` also narrow, because `null`, `undefined`, `0`, `""` and `NaN` are falsy. Checking truthiness is the usual way to rule out `null` and `undefined`. [3]

```ts
function printAll(strs: string | string[] | null) {
  if (strs && typeof strs === "object") {
    for (const s of strs) console.log(s); // strs: string[]
  } else if (typeof strs === "string") {
    console.log(strs);
  }
}
```

Be careful when the type includes `string` or `number`: an empty string or `0` is falsy too, so a truthiness check also skips those valid values. [3]

## typeof does not tell object types apart

Anything that is not a primitive reports `"object"` (or `"function"`), so `typeof` cannot distinguish `Dog` from `Cat`. For that you need discriminated unions, `in` or user-defined type guards, which the next lessons cover.

:::key-takeaways
- Narrowing refines a union to a more specific type inside a branch, following ordinary control flow.
- `typeof x === "string"` and its siblings narrow primitives.
- `typeof null` is `"object"`, so an object check alone does not rule out `null`.
- Truthiness checks narrow too, but they also reject `0` and `""`.
:::
