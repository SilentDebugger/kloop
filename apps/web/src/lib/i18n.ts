import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";

/**
 * i18n scaffold — English ships; add a locale by dropping a JSON file in
 * src/locales and registering it here. The user's language preference is
 * stored on their profile and applied after login.
 */
export const resources = { en: { translation: en } } as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
