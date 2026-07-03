import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ApiError } from "@kloop/shared";
import "./styles.css";
import "./lib/i18n";
import { App } from "./App";
import { useAuth } from "./lib/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => {
        if (err instanceof ApiError && err.status === 401) {
          useAuth.getState().clear();
          return false;
        }
        return count < 2;
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
