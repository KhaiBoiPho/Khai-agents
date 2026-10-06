// KhaiDocs: Docmost's entry point used to render its own app into #root here.
// Inside the desktop app that root belongs to the host, and several modules
// import `queryClient` from this file, so importing it mounted a second React
// tree over the whole app. The providers now live in ../KhaiDocsApp.tsx; this
// module keeps only the shared query client those imports expect.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});
