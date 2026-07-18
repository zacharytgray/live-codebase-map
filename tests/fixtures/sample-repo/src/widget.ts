import { add, mul } from "./util.js";
import { readFileSync } from "node:fs";

export class Widget {
  count = 0;

  render(): number {
    return add(this.count, 1);
  }

  static make(): Widget {
    return new Widget();
  }
}

function helper(): number {
  return mul(2, 3);
}
