// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

import { stringify } from "../../yaml";

console.log(
  stringify({
    foo: {
      bar: true,
      test: [
        "a",
        "b",
        {
          a: false,
        },
        {
          a: false,
        },
      ],
    },
    test: "foobar",
  }),
);
