import { RegistryProvider } from "./lib/react.tsx";
import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell.tsx";

const root = createRoot(document.getElementById("root")!);
root.render(
  <RegistryProvider>
    <Shell />
  </RegistryProvider>
);
