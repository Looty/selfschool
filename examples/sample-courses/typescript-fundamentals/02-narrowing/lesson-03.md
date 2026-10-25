---
id: l06
title: Type guards
quiz: quiz-03.yaml
sources: [3, 7]
---
Narrowing lets the compiler follow the checks you already write, so a value that starts out as a union ends up with a precise type inside each branch.

A type guard is an expression whose result tells the compiler which member of a union you are holding, so that inside the branch it can treat the variable as that narrower type and let you use members that only exist on it. The simplest guard is `typeof`, and it covers every primitive you will meet in everyday code: string, number, boolean, bigint, symbol and undefined. [3]

```ts
function pad(x: string | number) {
  if (typeof x === "string") {
    return x.padStart(4);   // x: string
  }
  return x.toFixed(2);      // x: number
}
```

## instanceof

For values created by a constructor, `instanceof` checks the prototype chain and narrows to the class type. [3]

```ts
function logValue(x: Date | string) {
  if (x instanceof Date) {
    console.log(x.toUTCString()); // x: Date
  } else {
    console.log(x.toUpperCase()); // x: string
  }
}
```

It only helps with classes (or anything with a constructor function), not with plain object types or interfaces, which do not exist at runtime.

## User-defined guards

When `typeof` is not enough, for example because both union members are object types, you write a user-defined guard. Its return type, `p is Fish`, is a promise you make to the compiler: if the function returns true, the argument is a Fish. The compiler does not check that promise against your function body, so a wrong guard silently breaks type safety everywhere it is used. [3]

```ts
type Fish = { swim(): void };
type Bird = { fly(): void };

function isFish(p: Fish | Bird): p is Fish {
  return "swim" in p;
}
```

Call it like any boolean function. In the true branch the argument is `Fish`; in the false branch the compiler removes `Fish` from the union, so what is left is `Bird`. [3]

```ts
function move(pet: Fish | Bird) {
  if (isFish(pet)) {
    pet.swim();
  } else {
    pet.fly();
  }
}
```

Guards also make filtering arrays type-safe, since `filter` accepts a predicate and uses its `is` type to produce the narrower array type:

```ts
const pets: (Fish | Bird)[] = [];
const fish: Fish[] = pets.filter(isFish);
```

Because the compiler trusts the signature, keep guards tiny and obviously correct. A guard that returns `true` for the wrong thing is worse than no guard.

## Narrowing with in

The `in` operator narrows by property name: in the true branch the compiler keeps the union members that have the property, and in the false branch the ones that do not. This is often shorter than writing a guard function, but it only works when the property names are distinct across the members of the union. [3]

```ts
function move(pet: Fish | Bird) {
  if ("swim" in pet) {
    return pet.swim(); // pet: Fish
  }
  return pet.fly();    // pet: Bird
}
```

:::low-confidence
How `in` narrows optional properties has changed between TypeScript versions. Check the release notes for your version before you rely on it. [7]
:::

:::key-takeaways
- `typeof` narrows primitives, and it cannot tell two object types apart.
- A user-defined guard is a claim the compiler trusts without checking.
- `in` narrows by property name, so it needs distinct names across the union members.
:::
