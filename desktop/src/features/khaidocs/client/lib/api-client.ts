import axios, { AxiosInstance } from "axios";

const api: AxiosInstance = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => {
    // we need the response headers for these endpoints
    const exemptEndpoints = [
      "/api/pages/export",
      "/api/spaces/export",
      "/api/docx-export",
      "/api/bases/export-csv",
    ];
    if (response.request.responseURL) {
      const path = new URL(response.request.responseURL)?.pathname;
      if (path && exemptEndpoints.includes(path)) {
        return response;
      }
    }

    return response.data;
  },
  (error) => {
    // KhaiDocs has no login of its own: a 401 means the Khai session ended,
    // which the host app handles; there is nowhere in here to redirect to.
    return Promise.reject(error);
  },
);

export default api;
