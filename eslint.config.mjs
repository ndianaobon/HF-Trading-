import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  { ignores: [".next/**", ".next-*/**", "node_modules/**", ".pgdata/**", "storage/**", "views/**", "public/vendor/**", "public/assets/css/**"] },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["public/assets/js/**/*.js"],
    languageOptions: { globals: { window: "readonly", document: "readonly", lucide: "readonly", LightweightCharts: "readonly" } },
    rules: { "@next/next/no-img-element": "off" },
  },
];

export default eslintConfig;
