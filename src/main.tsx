import ReactDOM from "react-dom/client";
import App from "./App";

// NOTE: intentionally NOT wrapped in <React.StrictMode>. StrictMode double-
// mounts every component in dev, and each Terminal mount spawns a real shell
// process — so StrictMode makes every terminal spawn, get killed, and respawn
// on open, bleeding the killed shell's exit output ("[process exited]", the
// shell's session-save message) into the fresh terminal. One mount = one shell.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
