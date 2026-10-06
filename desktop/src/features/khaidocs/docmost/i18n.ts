import { createInstance } from "i18next";
import Backend from "i18next-http-backend";

// KhaiDocs: Docmost gets an i18next instance of its own. The host app already
// owns the global instance, and initialising that one here would replace the
// app's translations. initReactI18next is left out for the same reason — it
// would make this instance react-i18next's global default. KhaiDocsApp hands
// it to an I18nextProvider instead.
const i18n = createInstance();

i18n
  .use(Backend)
  .init({
    fallbackLng: "en-US",
    debug: false,
    load: "currentOnly",
    backend: {
      loadPath: "/khaidocs/locales/{{lng}}/{{ns}}.json",
    },
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
