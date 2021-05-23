import { existsSync } from "../exists";

try {
  const isExist = existsSync(Deno.args[0]);
  Deno.stdout.write(new TextEncoder().encode(isExist ? "exist" : "not exist"));
} catch (err) {
  Deno.stdout.write(new TextEncoder().encode(err.message));
}
