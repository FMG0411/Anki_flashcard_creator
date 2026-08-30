import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    // Global ignores MUST come first
    { ignores: ['dist/**', 'node_modules/**', 'build.js', 'build.ps1'] },
    
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/no-explicit-any": "error",
        },
    },
    {
        ignores: ["dist/", "node_modules/"],
    }
);