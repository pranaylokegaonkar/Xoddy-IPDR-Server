import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import { getToken } from "./lib/token";
import "./index.css";

// Authenticate API requests with the stored bearer token (signed session id).
// This makes auth work inside the Replit preview iframe, where browsers block
// the third-party session cookie. Must be set before any query runs.
setAuthTokenGetter(() => getToken());

createRoot(document.getElementById("root")!).render(<App />);
