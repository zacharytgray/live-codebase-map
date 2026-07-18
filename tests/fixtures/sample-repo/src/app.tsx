import { Widget } from "./widget";

export const App = () => {
  const w = Widget.make();
  return w.render();
};
