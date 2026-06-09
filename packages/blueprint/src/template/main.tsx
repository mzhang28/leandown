import "@leandown/blueprint/styles.css";
import { mount } from "@leandown/blueprint/app";

const pages = import.meta.glob("./**/*.md") as Record<
  string,
  () => Promise<{ default: string; html: string }>
>;

mount(document.getElementById("root")!, pages);
